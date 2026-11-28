// Chipfall authoritative game server: HTTP (static client) + Socket.IO + SQLite.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Server, type Socket } from 'socket.io';
import { DUNGEON_IDS, ITEMS, expToNext, trainXpToNext, type DungeonId, type FactionId } from '../../shared/content';
import type { PlayerView, RpcResult } from '../../shared/protocol';
import { manilaString } from '../../shared/time';
import {
  accountForToken,
  addGold,
  addStack,
  charForAccount,
  charStats,
  createAccount,
  createCharacter,
  createSession,
  equip,
  getChar,
  inventory,
  touchSeen,
  upgradeItem,
  verifyLogin,
} from './characters';
import { clock } from './clock';
import { config, log } from './config';
import { GameError, closeDb, fail, get, openDb, run, tx, type Row } from './db';
import { ackRun, dungeonStatuses, retreat, runView, startRun, tickDungeons, useAbility } from './dungeons';
import { bonusAccess, claimIdle, idleSession, previewIdle, setActivity } from './idle';
import { buyListing, cancelListing, createListing, myListings, priceGuide, searchListings, tradeHistory } from './market';
import { rankings } from './rankings';
import { seedIfEmpty } from './seed';
import { cancelTrade, confirmTrade, myTrades, openTrade, tradeParties, updateOffer } from './trades';
import { WarManager } from './war/manager';
import { worldBotsTick, worldSummary } from './worldBots';

openDb(config.dbPath);
clock.load();
seedIfEmpty();

const httpServer = http.createServer(serveStatic);
const io = new Server(httpServer, { cors: { origin: true, credentials: true }, pingInterval: 10000, pingTimeout: 8000 });

const online = new Map<number, number>(); // charId -> socket count

const wars = new WarManager({
  broadcast: () => io.emit('war', wars.scheduleView()),
  resolved: (result) => io.emit('warResult', result),
  playersChanged: (ids) => ids.forEach((id) => pushPlayer(id)),
});
wars.load();

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
  try {
    io.to(`c:${charId}`).emit('player', playerView(charId));
  } catch (e) {
    log('pushPlayer failed', (e as Error).message);
  }
}

function pushTrade(tradeId: number) {
  const [a, b] = tradeParties(tradeId);
  for (const id of [a, b]) io.to(`c:${id}`).emit('trades', myTrades(id));
}

// ------------------------------------------------------------------- RPC

interface Ctx {
  socket: Socket;
  charId: number | null;
  isDev: boolean;
}

type Handler = (ctx: Ctx, p: any) => any;

function needChar(ctx: Ctx): number {
  if (!ctx.charId) fail('Please sign in.');
  return ctx.charId;
}
function needDev(ctx: Ctx) {
  if (!config.devTools) fail('Developer tools are disabled on this server.');
  if (!ctx.isDev) fail('Developer tools are only available to developer accounts.');
}

function bindSocket(socket: Socket, account: Row) {
  const ch = charForAccount(account.id);
  if (!ch) fail('Account has no pilot.');
  if (socket.data.charId === ch.id) return ch.id;
  socket.data.charId = ch.id;
  socket.data.isDev = !!account.is_dev;
  socket.join(`c:${ch.id}`);
  online.set(ch.id, (online.get(ch.id) ?? 0) + 1);

  const now = clock.now();
  const pending = previewIdle(ch.id);
  const absent = now - ch.last_seen_at;
  const hasRewards = pending.exp + pending.gold + pending.trainXp + Object.keys(pending.items).length + pending.gear.length > 0;
  const summary = absent >= 60_000 && pending.elapsedMs >= 60_000 && hasRewards ? pending : null;
  touchSeen(ch.id);
  socket.emit('player', playerView(ch.id, summary));
  socket.emit('war', wars.scheduleView());
  socket.emit('trades', myTrades(ch.id));
  const d = dungeonStatuses(ch.id);
  const runId = d.activeRunId ?? d.unseenRunId;
  if (runId) socket.emit('dungeon', runView(runId));
  return ch.id;
}

const handlers: Record<string, Handler> = {
  'server.info': () => ({
    serverNow: clock.now(),
    manilaNow: manilaString(clock.now()),
    clockOffsetMs: clock.offset(),
    devTools: config.devTools,
    warTarget: config.warTargetPerFaction,
  }),

  'auth.register': (ctx, p) => {
    const token = tx(() => {
      const accId = createAccount(String(p.username ?? ''), String(p.password ?? ''));
      createCharacter({ accountId: accId, name: String(p.name ?? ''), faction: p.faction, role: p.role });
      return createSession(accId);
    });
    bindSocket(ctx.socket, accountForToken(token)!);
    return { token };
  },
  'auth.login': (ctx, p) => {
    const acc = verifyLogin(p.username, p.password);
    const token = createSession(acc.id);
    bindSocket(ctx.socket, acc);
    return { token };
  },
  'auth.resume': (ctx, p) => {
    const acc = accountForToken(p.token);
    if (!acc) fail('Session expired. Please sign in again.');
    bindSocket(ctx.socket, acc);
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
    io.to(`c:${id}`).emit('dungeon', v);
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
    io.to(`c:${id}`).emit('dungeon', v);
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
    io.emit('market', { changed: true });
    return l;
  },
  'market.cancel': (ctx, p) => {
    const id = needChar(ctx);
    const r = cancelListing(id, Number(p.listingId));
    pushPlayer(id);
    io.emit('market', { changed: true });
    return r;
  },
  'market.buy': (ctx, p) => {
    const id = needChar(ctx);
    const r = buyListing(id, Number(p.listingId), Number(p.qty ?? 1), p.unitPrice === undefined ? undefined : Number(p.unitPrice));
    pushPlayer(id);
    pushPlayer(r.sellerId);
    io.to(`c:${r.sellerId}`).emit('toast', {
      kind: 'sale',
      text: `${getChar(id).name} bought ${r.qty} ${ITEMS[r.templateId].name} — you received ${r.sellerNet} Gold (fee ${r.fee}).`,
    });
    io.emit('market', { changed: true });
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
  'world.summary': () => worldSummary(new Set(online.keys())),

  // ------------------------------------------------------------- dev tools
  'dev.clock': (ctx, p) => {
    needDev(ctx);
    if (p.action === 'advance') clock.advance(Number(p.ms));
    else if (p.action === 'set') clock.setNow(Number(p.at));
    else if (p.action === 'reset') clock.setOffset(0);
    else fail('Unknown clock action.');
    io.emit('clock', { offsetMs: clock.offset(), serverNow: clock.now() });
    for (const id of online.keys()) pushPlayer(id);
    io.emit('war', wars.scheduleView());
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

io.on('connection', (socket) => {
  const token = socket.handshake.auth?.token;
  const acc = accountForToken(token);
  if (acc) {
    try {
      bindSocket(socket, acc);
    } catch (e) {
      log('bind failed', (e as Error).message);
    }
  }
  socket.emit('hello', { serverNow: clock.now(), authed: !!socket.data.charId });

  socket.on('rpc', (method: string, params: any, ack?: (r: RpcResult) => void) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const h = handlers[method];
    if (!h) return reply({ ok: false, error: `Unknown method ${method}` });
    const ctx: Ctx = { socket, charId: socket.data.charId ?? null, isDev: !!socket.data.isDev };
    try {
      const data = h(ctx, params ?? {});
      reply({ ok: true, data });
    } catch (e) {
      if (e instanceof GameError) reply({ ok: false, error: e.message });
      else {
        log(`RPC ${method} failed:`, e);
        reply({ ok: false, error: 'Server error. Please try again.' });
      }
    }
  });

  socket.on('disconnect', () => {
    const id = socket.data.charId as number | undefined;
    if (!id) return;
    const n = (online.get(id) ?? 1) - 1;
    if (n <= 0) online.delete(id);
    else online.set(id, n);
    try {
      touchSeen(id);
    } catch {
      /* ignore */
    }
  });
});

// ------------------------------------------------------------------ loops

setInterval(() => {
  try {
    wars.loop();
    tickDungeons((charId, view) => {
      io.to(`c:${charId}`).emit('dungeon', view);
      if (view.finalized) pushPlayer(charId);
    });
  } catch (e) {
    log('Game loop error:', e);
  }
}, 250);

setInterval(() => {
  try {
    worldBotsTick();
    for (const id of online.keys()) touchSeen(id);
    io.emit('world', worldSummary(new Set(online.keys())));
  } catch (e) {
    log('World loop error:', e);
  }
}, 20_000);

// ------------------------------------------------------------ static files

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, serverNow: clock.now(), manilaNow: manilaString(clock.now()) }));
    return;
  }
  const root = config.clientDist;
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h1>Chipfall server is running</h1><p>The web client is not built yet. Run <code>npm run build:web</code>, or use <code>npm run dev:web</code>.</p>');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

httpServer.listen(config.port, config.host, () => {
  log(`Chipfall server listening on http://localhost:${config.port}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets ?? []) {
      if (n.family === 'IPv4' && !n.internal) log(`  Phone on same Wi-Fi: http://${n.address}:${config.port}`);
    }
  }
  log(`  Android emulator:   http://10.0.2.2:${config.port}`);
  log(`Database: ${config.dbPath}`);
  log(`Server time: ${manilaString(clock.now())}${clock.offset() ? ` (test clock offset ${Math.round(clock.offset() / 1000)}s)` : ''}`);
  log(`Wars every ${config.warIntervalMin} min, ${config.warDurationMin} min long. Dev tools: ${config.devTools ? 'ON' : 'off'}`);
  if (process.send) process.send('ready');
});

function shutdown() {
  log('Shutting down…');
  io.close();
  httpServer.close();
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

