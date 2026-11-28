// Chipfall game core: authoritative logic, independent of transport and storage.
// A host (node.ts for local play/tests, worker.ts for Cloudflare) feeds it connections and
// messages and calls tick(); the core answers RPCs and pushes events as JSON over WebSockets.
//
// Wire protocol (one JSON object per WebSocket message):
//   client → server  {t:'auth', token} | {t:'rpc', id, m, p} | {t:'ping'}
//   server → client  {t:'hello', serverNow, authed} | {t:'res', id, ok, data|error} | {t:'ev', e, d} | {t:'pong'}
import { DUNGEON_IDS, ITEMS, expToNext, trainXpToNext, type DungeonId, type FactionId } from '../../shared/content';
import type { PlayerView } from '../../shared/protocol';
import { manilaString } from '../../shared/time';
import {
  accountForToken,
  addGold,
  addStack,
  charForAccount,
  charStats,
  createCharacter,
  createSession,
  equip,
  getChar,
  insertAccount,
  inventory,
  prepareAccount,
  touchSeen,
  upgradeItem,
  verifyLogin,
} from './characters';
import { clock } from './clock';
import { config, log } from './config';
import { GameError, fail, get, run, tx, type Row } from './db';
import { ackRun, dungeonStatuses, retreat, runView, startRun, tickDungeons, useAbility } from './dungeons';
import { bonusAccess, claimIdle, idleSession, previewIdle, setActivity } from './idle';
import { buyListing, cancelListing, createListing, myListings, priceGuide, searchListings, tradeHistory } from './market';
import { rankings } from './rankings';
import { seedIfEmpty } from './seed';
import { cancelTrade, confirmTrade, myTrades, openTrade, tradeParties, updateOffer } from './trades';
import { WarManager } from './war/manager';
import { worldBotsTick, worldSummary } from './worldBots';

export interface Conn {
  id: number;
  data: { charId?: number; isDev?: boolean };
  sendRaw(text: string): void;
  close(): void;
}

const conns = new Set<Conn>();
const byChar = new Map<number, Set<Conn>>(); // online characters -> their connections
let connSeq = 1;

/** Optional extension points (the world simulation plugs in here). */
export const hooks: {
  onBind?: (conn: Conn, charId: number) => void;
  onUnbind?: (conn: Conn, charId: number, lastConn: boolean) => void;
  extraHandlers?: Record<string, (ctx: { conn: Conn; charId: number | null; isDev: boolean }, p: any) => any>;
  onTick?: (now: number) => void;
  onWarChange?: () => void;
  onPlayerChanged?: (charId: number) => void;
} = {};

export function send(conn: Conn, e: string, d: unknown) {
  try {
    conn.sendRaw(JSON.stringify({ t: 'ev', e, d }));
  } catch {
    /* connection closing */
  }
}
export function emitTo(charId: number, e: string, d: unknown) {
  const set = byChar.get(charId);
  if (!set) return;
  const text = JSON.stringify({ t: 'ev', e, d });
  for (const c of set) {
    try {
      c.sendRaw(text);
    } catch {
      /* ignore */
    }
  }
}
export function emitAll(e: string, d: unknown) {
  const text = JSON.stringify({ t: 'ev', e, d });
  for (const c of conns) {
    try {
      c.sendRaw(text);
    } catch {
      /* ignore */
    }
  }
}
export function onlineCharIds(): number[] {
  return [...byChar.keys()];
}
export function connCount() {
  return conns.size;
}

export const wars = new WarManager({
  broadcast: () => {
    emitAll('war', wars.scheduleView());
    hooks.onWarChange?.();
  },
  resolved: (result) => emitAll('warResult', result),
  playersChanged: (ids) => ids.forEach((id) => pushPlayer(id)),
});

/** Prepare storage-dependent state. Call once after useBackend(). */
export async function initGame() {
  clock.load();
  await seedIfEmpty();
  wars.load();
}

// ------------------------------------------------------------------ views

function playerView(charId: number, returnSummary: PlayerView['idle']['returnSummary'] = null): PlayerView {
  const c = getChar(charId);
  const acc = c.account_id ? get<Row>('SELECT is_dev FROM accounts WHERE id = ?', c.account_id) : undefined;
  const s = idleSession(charId);
  const d = dungeonStatuses(charId);
  const access = bonusAccess(c.faction);
  const now = clock.now();
  return {
    serverNow: now,
    character: {
      id: c.id,
      name: c.name,
      faction: c.faction,
      role: c.role,
      level: c.level,
      exp: c.exp,
      expToNext: expToNext(c.level),
      gold: c.gold,
      trainLevel: c.train_level,
      trainXp: c.train_xp,
      trainXpToNext: trainXpToNext(c.train_level),
      stats: charStats(c),
      weaponId: c.weapon_item_id,
      armorId: c.armor_item_id,
      isDev: !!acc?.is_dev && config.devTools,
    },
    inventory: inventory(charId),
    idle: { activity: s.activity, zone: s.zone, lastClaimAt: s.last_claim_at, pending: previewIdle(charId), returnSummary },
    dungeons: { periodKey: d.periodKey, nextResetAt: d.nextResetAt, list: d.list, activeRunId: d.activeRunId },
    bonusZone: access && access.expiresAt > now ? { expiresAt: access.expiresAt } : null,
    war: {
      joinedWarId: wars.joinedWarId(charId),
      unseenResultWarId: (() => {
        const last = wars.lastResultFor(charId);
        return last && last > c.last_war_seen ? last : null;
      })(),
    },
    clockOffsetMs: clock.offset(),
  };
}

function pushPlayer(charId: number) {
  hooks.onPlayerChanged?.(charId);
  try {
    emitTo(charId, 'player', playerView(charId));
  } catch (e) {
    log('pushPlayer failed', (e as Error).message);
  }
}

function pushTrade(tradeId: number) {
  const [a, b] = tradeParties(tradeId);
  for (const id of [a, b]) emitTo(id, 'trades', myTrades(id));
}

// ------------------------------------------------------------------- RPC

interface Ctx {
  conn: Conn;
  charId: number | null;
  isDev: boolean;
}

type Handler = (ctx: Ctx, p: any) => any | Promise<any>;

function needChar(ctx: Ctx): number {
  if (!ctx.charId) fail('Please sign in.');
  return ctx.charId;
}
function needDev(ctx: Ctx) {
  if (!config.devTools) fail('Developer tools are disabled on this server.');
  if (!ctx.isDev) fail('Developer tools are only available to developer accounts.');
}

function bindConn(conn: Conn, account: Row) {
  const ch = charForAccount(account.id);
  if (!ch) fail('Account has no pilot.');
  if (conn.data.charId === ch.id) return ch.id;
  if (conn.data.charId) unbindConn(conn);
  conn.data.charId = ch.id;
  conn.data.isDev = !!account.is_dev;
  let set = byChar.get(ch.id);
  if (!set) byChar.set(ch.id, (set = new Set()));
  set.add(conn);

  const now = clock.now();
  const pending = previewIdle(ch.id);
  const absent = now - ch.last_seen_at;
  const hasRewards = pending.exp + pending.gold + pending.trainXp + Object.keys(pending.items).length + pending.gear.length > 0;
  const summary = absent >= 60_000 && pending.elapsedMs >= 60_000 && hasRewards ? pending : null;
  touchSeen(ch.id);
  send(conn, 'player', playerView(ch.id, summary));
  send(conn, 'war', wars.scheduleView());
  send(conn, 'trades', myTrades(ch.id));
  const d = dungeonStatuses(ch.id);
  const runId = d.activeRunId ?? d.unseenRunId;
  if (runId) send(conn, 'dungeon', runView(runId));
  hooks.onBind?.(conn, ch.id);
  return ch.id;
}

function unbindConn(conn: Conn) {
  const id = conn.data.charId;
  if (!id) return;
  const set = byChar.get(id);
  set?.delete(conn);
  if (set && set.size === 0) byChar.delete(id);
  conn.data.charId = undefined;
  try {
    touchSeen(id);
  } catch {
    /* ignore */
  }
  hooks.onUnbind?.(conn, id, !byChar.has(id));
}

const handlers: Record<string, Handler> = {
  'server.info': () => ({
    serverNow: clock.now(),
    manilaNow: manilaString(clock.now()),
    clockOffsetMs: clock.offset(),
    devTools: config.devTools,
    warTarget: config.warTargetPerFaction,
  }),

  'auth.register': async (ctx, p) => {
    const prepared = await prepareAccount(String(p.username ?? ''), String(p.password ?? ''));
    const token = tx(() => {
      const accId = insertAccount(prepared);
      createCharacter({ accountId: accId, name: String(p.name ?? ''), faction: p.faction, role: p.role });
      return createSession(accId);
    });
    bindConn(ctx.conn, accountForToken(token)!);
    return { token };
  },
  'auth.login': async (ctx, p) => {
    const acc = await verifyLogin(p.username, p.password);
    const token = createSession(acc.id);
    bindConn(ctx.conn, acc);
    return { token };
  },
  'auth.resume': (ctx, p) => {
    const acc = accountForToken(p.token);
    if (!acc) fail('Session expired. Please sign in again.');
    bindConn(ctx.conn, acc);
    return { ok: true };
  },
  'auth.logout': (ctx, p) => {
    if (p?.token) run('DELETE FROM sessions WHERE token = ?', String(p.token));
    return { ok: true };
  },

  'player.get': (ctx) => playerView(needChar(ctx)),

  'idle.claim': (ctx, p) => {
    const id = needChar(ctx);
    const r = claimIdle(id, String(p.claimId ?? ''));
    pushPlayer(id);
    return r;
  },
  'idle.set': (ctx, p) => {
    const id = needChar(ctx);
    const r = setActivity(id, p.activity, String(p.zone ?? 'quarry'), String(p.claimId ?? ''));
    pushPlayer(id);
    return r;
  },

  'gear.equip': (ctx, p) => {
    const id = needChar(ctx);
    equip(id, Number(p.itemId));
    pushPlayer(id);
    return { ok: true };
  },
  'gear.upgrade': (ctx, p) => {
    const id = needChar(ctx);
    const r = upgradeItem(id, Number(p.itemId));
    pushPlayer(id);
    return r;
  },

  'dungeon.start': (ctx, p) => {
    const id = needChar(ctx);
    if (!DUNGEON_IDS.includes(p.dungeonId)) fail('Unknown dungeon.');
    const runId = startRun(id, p.dungeonId as DungeonId);
    const v = runView(runId);
    emitTo(id, 'dungeon', v);
    pushPlayer(id);
    return v;
  },
  'dungeon.get': (ctx, p) => {
    const id = needChar(ctx);
    const owner = get<{ character_id: number }>('SELECT character_id FROM dungeon_runs WHERE id = ?', Number(p.runId));
    if (!owner || owner.character_id !== id) fail('Run not found.');
    return runView(Number(p.runId));
  },
  'dungeon.ability': (ctx, p) => {
    const id = needChar(ctx);
    return useAbility(id, Number(p.runId));
  },
  'dungeon.retreat': (ctx, p) => {
    const id = needChar(ctx);
    const v = retreat(id, Number(p.runId));
    emitTo(id, 'dungeon', v);
    pushPlayer(id);
    return v;
  },
  'dungeon.ack': (ctx, p) => {
    const id = needChar(ctx);
    ackRun(id, Number(p.runId));
    return { ok: true };
  },

  'market.search': (ctx, p) => {
    needChar(ctx);
    return searchListings(p ?? {});
  },
  'market.mine': (ctx) => myListings(needChar(ctx)),
  'market.list': (ctx, p) => {
    const id = needChar(ctx);
    const l = createListing(id, p);
    pushPlayer(id);
    emitAll('market', { changed: true });
    return l;
  },
  'market.cancel': (ctx, p) => {
    const id = needChar(ctx);
    const r = cancelListing(id, Number(p.listingId));
    pushPlayer(id);
    emitAll('market', { changed: true });
    return r;
  },
  'market.buy': (ctx, p) => {
    const id = needChar(ctx);
    const r = buyListing(id, Number(p.listingId), Number(p.qty ?? 1), p.unitPrice === undefined ? undefined : Number(p.unitPrice));
    pushPlayer(id);
    pushPlayer(r.sellerId);
    emitTo(r.sellerId, 'toast', {
      kind: 'sale',
      text: `${getChar(id).name} bought ${r.qty} ${ITEMS[r.templateId].name} — you received ${r.sellerNet} Gold (fee ${r.fee}).`,
    });
    emitAll('market', { changed: true });
    return r;
  },
  'market.history': (ctx, p) => tradeHistory(p?.scope === 'all' ? null : needChar(ctx)),
  'market.price': (ctx, p) => priceGuide(String(p.templateId)),

  'trade.open': (ctx, p) => {
    const id = needChar(ctx);
    const v = openTrade(id, String(p.name ?? ''));
    pushTrade(v.id);
    return v;
  },
  'trade.offer': (ctx, p) => {
    const id = needChar(ctx);
    const v = updateOffer(id, Number(p.tradeId), p.offer);
    pushTrade(v.id);
    return v;
  },
  'trade.confirm': (ctx, p) => {
    const id = needChar(ctx);
    const v = confirmTrade(id, Number(p.tradeId), Number(p.version));
    pushTrade(v.id);
    if (v.status === 'completed') {
      pushPlayer(v.a.charId);
      pushPlayer(v.b.charId);
    }
    return v;
  },
  'trade.cancel': (ctx, p) => {
    const id = needChar(ctx);
    const v = cancelTrade(id, Number(p.tradeId));
    pushTrade(v.id);
    return v;
  },
  'trade.list': (ctx) => myTrades(needChar(ctx)),

  'war.schedule': () => wars.scheduleView(),
  'war.join': (ctx, p) => {
    const id = needChar(ctx);
    const cid = wars.join(id, p?.order);
    pushPlayer(id);
    return { combatantId: cid };
  },
  'war.queue': (ctx, p) => wars.queue(needChar(ctx), !!p?.on),
  'war.queued': (ctx) => ({ queued: wars.isQueued(needChar(ctx)) }),
  'war.order': (ctx, p) => wars.setOrder(needChar(ctx), p.order),
  'war.ability': (ctx) => wars.ability(needChar(ctx)),
  'war.result': (ctx, p) => wars.result(Number(p.warId)),
  'war.results': () => wars.recentResults(),
  'war.seen': (ctx, p) => {
    const id = needChar(ctx);
    run('UPDATE characters SET last_war_seen = MAX(last_war_seen, ?) WHERE id = ?', Number(p.warId), id);
    pushPlayer(id);
    return { ok: true };
  },

  'rank.get': (ctx, p) => rankings(wars, p.board ?? 'kills', p.scope ?? 'weekly', (p.faction ?? 'all') as FactionId | 'all', ctx.charId),
  'world.summary': () => worldSummary(new Set(byChar.keys())),

  // ------------------------------------------------------------- dev tools
  'dev.clock': (ctx, p) => {
    needDev(ctx);
    if (p.action === 'advance') clock.advance(Number(p.ms));
    else if (p.action === 'set') clock.setNow(Number(p.at));
    else if (p.action === 'reset') clock.setOffset(0);
    else fail('Unknown clock action.');
    emitAll('clock', { offsetMs: clock.offset(), serverNow: clock.now() });
    for (const id of byChar.keys()) pushPlayer(id);
    emitAll('war', wars.scheduleView());
    return { serverNow: clock.now(), manilaNow: manilaString(clock.now()), offsetMs: clock.offset() };
  },
  'dev.testWar': (ctx, p) => {
    needDev(ctx);
    const id = wars.startTest(Number(p?.seconds) || config.testWarSec, { passiveBots: !!p?.passiveBots });
    return { warId: id };
  },
  'dev.war.endNow': (ctx) => {
    needDev(ctx);
    wars.devEndNow();
    return { ok: true };
  },
  'dev.war.setHp': (ctx, p) => {
    needDev(ctx);
    wars.devSetHp(String(p.combatantId), Number(p.hp));
    return { ok: true };
  },
  'dev.setLevel': (ctx, p) => {
    needDev(ctx);
    const id = needChar(ctx);
    const lvl = Math.max(1, Math.min(40, Math.floor(Number(p.level))));
    run('UPDATE characters SET level = ?, exp = 0 WHERE id = ?', lvl, id);
    pushPlayer(id);
    return { level: lvl };
  },
  'dev.grant': (ctx, p) => {
    needDev(ctx);
    const id = needChar(ctx);
    tx(() => {
      if (p.gold) addGold(id, Math.floor(Number(p.gold)));
      for (const [tpl, q] of Object.entries(p.items ?? {})) if (ITEMS[tpl]?.stack) addStack(id, tpl, Number(q));
    });
    pushPlayer(id);
    return { ok: true };
  },
};


// ------------------------------------------------------------ connections

export function openConn(sendRaw: (text: string) => void, close: () => void): Conn {
  const conn: Conn = { id: connSeq++, data: {}, sendRaw, close };
  conns.add(conn);
  conn.sendRaw(JSON.stringify({ t: 'hello', serverNow: clock.now(), authed: false }));
  return conn;
}

export function closeConn(conn: Conn) {
  unbindConn(conn);
  conns.delete(conn);
}

export async function handleMessage(conn: Conn, text: string) {
  let m: any;
  try {
    m = JSON.parse(text);
  } catch {
    return;
  }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ping') {
    conn.sendRaw('{"t":"pong"}');
    return;
  }
  if (m.t === 'auth') {
    const acc = accountForToken(m.token);
    if (acc) {
      try {
        bindConn(conn, acc);
      } catch (e) {
        log('bind failed', (e as Error).message);
      }
    }
    conn.sendRaw(JSON.stringify({ t: 'hello', serverNow: clock.now(), authed: !!conn.data.charId }));
    return;
  }
  if (m.t !== 'rpc') return;
  const reply = (r: object) => {
    try {
      conn.sendRaw(JSON.stringify({ t: 'res', id: m.id, ...r }));
    } catch {
      /* ignore */
    }
  };
  const method = String(m.m ?? '');
  const h = handlers[method] ?? hooks.extraHandlers?.[method];
  if (!h) return reply({ ok: false, error: `Unknown method ${method}` });
  const ctx: Ctx = { conn, charId: conn.data.charId ?? null, isDev: !!conn.data.isDev };
  try {
    const data = await h(ctx, m.p ?? {});
    reply({ ok: true, data: data ?? null });
  } catch (e) {
    if (e instanceof GameError) reply({ ok: false, error: e.message });
    else {
      log(`RPC ${method} failed:`, e);
      reply({ ok: false, error: 'Server error. Please try again.' });
    }
  }
}

// ------------------------------------------------------------------ loops

let lastGameTick = 0;
let lastSlowTick = 0;

/** Call often (every 100 ms is ideal). Runs wars and dungeons at 4 Hz and slow jobs every 20 s. */
export function tick() {
  const real = Date.now();
  try {
    hooks.onTick?.(clock.now());
  } catch (e) {
    log('World tick error:', e);
  }
  if (real - lastGameTick >= 250) {
    lastGameTick = real;
    try {
      wars.loop();
      tickDungeons((charId, view) => {
        emitTo(charId, 'dungeon', view);
        if (view.finalized) pushPlayer(charId);
      });
    } catch (e) {
      log('Game loop error:', e);
    }
  }
  if (real - lastSlowTick >= 20_000) {
    lastSlowTick = real;
    try {
      worldBotsTick();
      for (const id of byChar.keys()) touchSeen(id);
      emitAll('world', worldSummary(new Set(byChar.keys())));
    } catch (e) {
      log('World loop error:', e);
    }
  }
}

/** When nobody is connected, the next moment the server must wake up (Cloudflare alarms). */
export function nextWakeAt(): number {
  const now = clock.now();
  const offset = now - Date.now();
  let at = wars.engine && wars.row ? wars.row.ends_at + 1000 : config.scheduledWars ? wars.nextStartAt(now) + 1000 : now + 3_600_000;
  if (get("SELECT 1 FROM dungeon_runs WHERE status = 'active' LIMIT 1")) at = Math.min(at, now + 60_000);
  return Math.max(Date.now() + 1000, at - offset);
}

export { pushPlayer, playerView };
