// The shared open world: avatars walking the isometric map, monsters with simple AI, active
// mining, parties with shared EXP and round-robin loot, chat channels, NPC pilots, and the Chip
// War fighters drawn where the war engine says they are. Runs at 10 Hz; snapshots go out at 5 Hz.
//
// Positions, HP and combat are authoritative here. Rewards are written to SQLite in a single
// transaction per kill. World state itself (who is where, monster HP) is not persisted except for
// each pilot's last position.
import {
  ARMORS,
  ITEMS,
  MONSTERS,
  ROLES,
  ROLE_WEAPONS,
  WORLD,
  mitigate,
  monsterStats,
  type FactionId,
  type RoleId,
} from '../../../shared/content';
import { findPath, inSafeZone, lineClear, walkable, worldMap, type MonsterType, type SpawnPoint } from '../../../shared/map';
import type { ChatMsg, PartyView, WorldEnt, WorldFx, WorldMe, WorldSnap } from '../../../shared/protocol';
import { addGear, addGold, addStack, charStats, getChar, grantExp } from '../characters';
import { all, fail, run, tx } from '../db';
import { emitAll, emitTo, hooks, onlineCharIds, pushPlayer, send, wars, type Conn } from '../game';

const M = worldMap();

interface Avatar {
  key: string; // 'p:<charId>' players, 'b:<charId>' NPC pilots
  charId: number;
  npc: boolean;
  name: string;
  faction: FactionId;
  role: RoleId;
  level: number;
  x: number;
  y: number;
  path: Array<[number, number]>;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  target: string | null;
  lastAttack: number;
  abilityReady: number;
  overcharge: boolean;
  shieldUntil: number;
  lastHurt: number;
  dead: boolean;
  respawnAt: number;
  mining: { ore: number; until: number } | null;
  repathAt: number;
  thinkAt: number;
  home: { x: number; y: number };
  wasInWar?: boolean;
}

interface Monster {
  key: string;
  sp: SpawnPoint;
  type: MonsterType;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  target: string | null;
  tauntUntil: number;
  lastAttack: number;
  dead: boolean;
  respawnAt: number;
  returning: boolean;
  path: Array<[number, number]>;
  repathAt: number;
  wanderAt: number;
}

const avatars = new Map<string, Avatar>();
const monsters: Monster[] = M.monsters.map((sp) => spawnMonster(sp));
const oreDepleted = new Map<number, number>();
let fx: Array<WorldFx & { x: number; y: number }> = [];
let lastTick = Date.now();
let lastSnap = 0;
let lastSave = Date.now();
let lastNpcSync = 0;

// ------------------------------------------------------------------ helpers

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}
function now() {
  return Date.now();
}

function spawnMonster(sp: SpawnPoint): Monster {
  const st = monsterStats(sp.type, sp.level);
  return {
    key: `m:${sp.id}`,
    sp,
    type: sp.type,
    level: sp.level,
    x: sp.x,
    y: sp.y,
    hp: st.hp,
    maxHp: st.hp,
    atk: st.atk,
    def: st.def,
    target: null,
    tauntUntil: 0,
    lastAttack: 0,
    dead: false,
    respawnAt: 0,
    returning: false,
    path: [],
    repathAt: 0,
    wanderAt: now() + Math.random() * 5000,
  };
}

function inWar(charId: number) {
  return !!(wars.engine && !wars.engine.s.ended && wars.engine.byChar(charId));
}

function makeAvatar(charId: number, npc: boolean): Avatar {
  const c = getChar(charId);
  const st = charStats(c);
  const maxHp = st.hp * WORLD.hpMultiplier;
  const sp = M.spawnPoints[c.faction];
  let x = sp.x;
  let y = sp.y;
  if (!npc && c.world_x != null && c.world_y != null && walkable(M, c.world_x, c.world_y)) {
    const zone = inSafeZone(M, c.world_x, c.world_y);
    if (!zone || zone === c.faction) {
      x = c.world_x;
      y = c.world_y;
    }
  }
  const b = M.bases[c.faction];
  const home = { x: b.x + (M.plaza.x - b.x) * 0.38, y: b.y + (M.plaza.y - b.y) * 0.38 };
  return {
    key: `${npc ? 'b' : 'p'}:${charId}`,
    charId,
    npc,
    name: c.name,
    faction: c.faction,
    role: c.role,
    level: c.level,
    x,
    y,
    path: [],
    hp: maxHp,
    maxHp,
    atk: st.atk,
    def: st.def,
    target: null,
    lastAttack: 0,
    abilityReady: 0,
    overcharge: false,
    shieldUntil: 0,
    lastHurt: 0,
    dead: false,
    respawnAt: 0,
    mining: null,
    repathAt: 0,
    thinkAt: 0,
    home,
  };
}

function playerAvatar(charId: number) {
  return avatars.get(`p:${charId}`);
}

function allies(a: Avatar, radius: number) {
  const out: Avatar[] = [];
  for (const o of avatars.values()) {
    if (o.dead || o.faction !== a.faction) continue;
    if (!o.npc && inWar(o.charId)) continue;
    if (dist(o.x, o.y, a.x, a.y) <= radius) out.push(o);
  }
  return out;
}

function pushFx(f: WorldFx, x: number, y: number) {
  fx.push({ ...f, x, y } as WorldFx & { x: number; y: number });
}

// ------------------------------------------------------------------ parties

interface Party {
  id: number;
  leader: number;
  members: number[];
  loot: number;
}
const parties = new Map<number, Party>();
const partyOf = new Map<number, number>();
const invites = new Map<number, { from: number; at: number }>();
let partySeq = 1;

function partyView(p: Party): PartyView {
  const online = new Set(onlineCharIds());
  return {
    id: p.id,
    leader: p.leader,
    members: p.members.map((id) => {
      const c = getChar(id);
      return { charId: id, name: c.name, role: c.role, level: c.level, online: online.has(id) };
    }),
  };
}

function pushParty(p: Party | undefined, extra: number[] = []) {
  const v = p ? partyView(p) : null;
  for (const id of [...(p?.members ?? []), ...extra]) emitTo(id, 'party', p && p.members.includes(id) ? v : null);
}

function leaveParty(charId: number) {
  const pid = partyOf.get(charId);
  if (!pid) return;
  const p = parties.get(pid)!;
  p.members = p.members.filter((m) => m !== charId);
  partyOf.delete(charId);
  if (p.members.length <= 1) {
    for (const m of p.members) partyOf.delete(m);
    parties.delete(pid);
    pushParty(undefined, [charId, ...p.members]);
    for (const m of p.members) systemMsg(m, 'Your party was disbanded.');
    return;
  }
  if (p.leader === charId) p.leader = p.members[0];
  pushParty(p, [charId]);
}

function sameParty(a: number, b: number) {
  const pa = partyOf.get(a);
  return !!pa && pa === partyOf.get(b);
}

// --------------------------------------------------------------------- chat

const chat = {
  world: [] as ChatMsg[],
  faction: { aurex: [] as ChatMsg[], vessari: [] as ChatMsg[], kreth: [] as ChatMsg[] },
  party: new Map<number, ChatMsg[]>(),
};
const lastChat = new Map<number, number>();
let chatSeq = 1;

function keep(list: ChatMsg[], m: ChatMsg) {
  list.push(m);
  if (list.length > 40) list.splice(0, list.length - 40);
}

function systemMsg(charId: number, text: string) {
  emitTo(charId, 'chat', { id: chatSeq++, ch: 'system', from: 'System', charId: null, f: null, text, at: now() } satisfies ChatMsg);
}

function sendChat(charId: number, ch: string, raw: string) {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 140);
  if (!text) fail('Type a message first.');
  if (!['world', 'faction', 'party'].includes(ch)) fail('Unknown channel.');
  const t = now();
  if (t - (lastChat.get(charId) ?? 0) < 1200) fail('You are sending messages too quickly.');
  lastChat.set(charId, t);
  const c = getChar(charId);
  const msg: ChatMsg = { id: chatSeq++, ch: ch as ChatMsg['ch'], from: c.name, charId, f: c.faction, text, at: t };
  if (ch === 'world') {
    keep(chat.world, msg);
    emitAll('chat', msg);
  } else if (ch === 'faction') {
    keep(chat.faction[c.faction], msg);
    for (const id of onlineCharIds()) if (getChar(id).faction === c.faction) emitTo(id, 'chat', msg);
  } else {
    const pid = partyOf.get(charId);
    if (!pid) fail('You are not in a party.');
    const list = chat.party.get(pid) ?? [];
    keep(list, msg);
    chat.party.set(pid, list);
    for (const id of parties.get(pid)!.members) emitTo(id, 'chat', msg);
  }
  return msg;
}

function chatHistory(charId: number): ChatMsg[] {
  const c = getChar(charId);
  const pid = partyOf.get(charId);
  return [...chat.world, ...chat.faction[c.faction], ...(pid ? (chat.party.get(pid) ?? []) : [])].sort((a, b) => a.id - b.id).slice(-60);
}

// ---------------------------------------------------------------- lifecycle

function join(conn: Conn, charId: number) {
  let a = playerAvatar(charId);
  if (!a) {
    a = makeAvatar(charId, false);
    avatars.set(a.key, a);
  }
  send(conn, 'chatHistory', chatHistory(charId));
  const pid = partyOf.get(charId);
  send(conn, 'party', pid ? partyView(parties.get(pid)!) : null);
  if (pid) pushParty(parties.get(pid));
  send(conn, 'snap', snapshotFor(a));
}

function leave(charId: number) {
  const a = playerAvatar(charId);
  if (a) {
    savePosition(a);
    avatars.delete(a.key);
  }
  invites.delete(charId);
  const pid = partyOf.get(charId);
  if (pid) pushParty(parties.get(pid));
}

function savePosition(a: Avatar) {
  if (a.npc) return;
  try {
    run('UPDATE characters SET world_x = ?, world_y = ? WHERE id = ?', a.x, a.y, a.charId);
  } catch {
    /* ignore */
  }
}

function refreshStats(charId: number) {
  const a = playerAvatar(charId);
  if (!a) return;
  const c = getChar(charId);
  const st = charStats(c);
  const ratio = a.maxHp ? a.hp / a.maxHp : 1;
  a.level = c.level;
  a.atk = st.atk;
  a.def = st.def;
  a.maxHp = st.hp * WORLD.hpMultiplier;
  a.hp = Math.max(a.dead ? 0 : 1, Math.round(a.maxHp * ratio));
}

/** Keeps a couple of NPC pilots per faction walking and hunting in the world. */
function syncNpcs() {
  const wanted = all<{ id: number; faction: FactionId }>('SELECT id, faction FROM characters WHERE is_bot = 1 ORDER BY id');
  const per: Record<string, number> = {};
  for (const b of wanted) {
    per[b.faction] = (per[b.faction] ?? 0) + 1;
    if (per[b.faction] > 2) continue;
    const key = `b:${b.id}`;
    if (!avatars.has(key)) {
      const a = makeAvatar(b.id, true);
      a.x = a.home.x;
      a.y = a.home.y;
      if (!walkable(M, a.x, a.y)) {
        a.x = M.spawnPoints[a.faction].x;
        a.y = M.spawnPoints[a.faction].y;
      }
      avatars.set(key, a);
    }
  }
}

// ---------------------------------------------------------------- simulation

function tickWorld() {
  const t = now();
  const dt = Math.min(0.5, (t - lastTick) / 1000);
  lastTick = t;
  if (t - lastNpcSync > 30_000) {
    lastNpcSync = t;
    try {
      syncNpcs();
    } catch {
      /* no bots yet */
    }
  }

  for (const a of avatars.values()) {
    if (!a.npc && inWar(a.charId)) {
      a.path = [];
      a.target = null;
      a.mining = null;
      a.wasInWar = true;
      continue;
    }
    if (a.wasInWar) {
      // The war ended: the pilot walks out of the battle at their own base, fully repaired.
      a.wasInWar = false;
      const sp = M.spawnPoints[a.faction];
      a.x = sp.x;
      a.y = sp.y;
      a.hp = a.maxHp;
      a.dead = false;
    }
    if (a.dead) {
      if (t >= a.respawnAt) {
        a.dead = false;
        a.hp = a.maxHp;
        const sp = a.npc ? a.home : M.spawnPoints[a.faction];
        a.x = sp.x;
        a.y = sp.y;
        a.path = [];
      }
      continue;
    }
    if (a.npc) npcThink(a, t);
    if (t - a.lastHurt > 5000 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.03 * dt);
    handleTarget(a, t);
    moveAlong(a, WORLD.walkSpeed * dt);
  }

  for (const m of monsters) monsterTick(m, t, dt);

  for (const [id, until] of oreDepleted) if (t >= until) oreDepleted.delete(id);

  if (t - lastSnap >= 200) {
    lastSnap = t;
    broadcastSnapshots();
    fx = [];
  }
  if (t - lastSave > 30_000) {
    lastSave = t;
    for (const a of avatars.values()) savePosition(a);
  }
}

function moveAlong(a: { x: number; y: number; path: Array<[number, number]> }, step: number) {
  while (step > 0 && a.path.length) {
    const [wx, wy] = a.path[0];
    const d = dist(a.x, a.y, wx, wy);
    if (d <= step) {
      a.x = wx;
      a.y = wy;
      a.path.shift();
      step -= d;
    } else {
      a.x += ((wx - a.x) / d) * step;
      a.y += ((wy - a.y) / d) * step;
      step = 0;
    }
  }
}

function handleTarget(a: Avatar, t: number) {
  if (!a.target) return;
  if (a.target.startsWith('m:')) {
    const m = monsters[Number(a.target.slice(2))];
    if (!m || m.dead) {
      a.target = null;
      return;
    }
    const range = WORLD.range[a.role];
    const d = dist(a.x, a.y, m.x, m.y);
    if (d > range) {
      if (t >= a.repathAt || !a.path.length) {
        a.repathAt = t + 400;
        a.path = findPath(M, a.x, a.y, m.x, m.y, 2500) ?? [];
        if (a.path.length) trimPathToRange(a, m.x, m.y, range * 0.9);
      }
    } else {
      a.path = [];
      if (t - a.lastAttack >= WORLD.attackMs) {
        a.lastAttack = t;
        attackMonster(a, m, t);
      }
    }
  } else if (a.target.startsWith('o:')) {
    const id = Number(a.target.slice(2));
    const node = M.ores[id];
    if (!node) return void (a.target = null);
    const d = dist(a.x, a.y, node.x, node.y);
    if (d > 1.4) {
      a.mining = null;
      if (t >= a.repathAt || !a.path.length) {
        a.repathAt = t + 600;
        a.path = findPath(M, a.x, a.y, node.x, node.y, 2500) ?? [];
      }
      return;
    }
    a.path = [];
    if (oreDepleted.has(id)) {
      a.target = null;
      a.mining = null;
      if (!a.npc) systemMsg(a.charId, 'That crystal is depleted. It regrows in under a minute.');
      return;
    }
    if (!a.mining) a.mining = { ore: id, until: t + WORLD.oreMineMs };
    else if (t >= a.mining.until) {
      a.mining = null;
      a.target = null;
      oreDepleted.set(id, t + WORLD.oreRespawnMs);
      pushFx({ a: 'mined', s: a.key, ore: id }, node.x, node.y);
      if (!a.npc) grantMining(a.charId, node.template);
    }
  }
}

function trimPathToRange(a: Avatar, tx: number, ty: number, range: number) {
  // Stop at the first waypoint that is already inside attack range with a clear shot.
  for (let i = 0; i < a.path.length; i++) {
    const [px, py] = a.path[i];
    if (dist(px, py, tx, ty) <= range && lineClear(M, px, py, tx, ty)) {
      a.path = a.path.slice(0, i + 1);
      return;
    }
  }
}

function attackMonster(a: Avatar, m: Monster, t: number) {
  let dmg = mitigate(a.atk, m.def, Math.random());
  const crit = a.overcharge;
  if (a.overcharge) {
    dmg *= 3;
    a.overcharge = false;
  }
  dmg = Math.min(m.hp, dmg);
  m.hp -= dmg;
  pushFx({ a: 'hit', s: a.key, t: m.key, d: dmg, crit }, m.x, m.y);
  if (!m.target && !m.returning) m.target = a.key;
  if (a.role === 'engineer') {
    const hurt = allies(a, WORLD.abilityRadius).filter((o) => o.hp < o.maxHp);
    hurt.sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
    if (hurt[0]) heal(a, hurt[0], Math.round(a.atk * 0.35));
  }
  if (m.hp <= 0) killMonster(m, a, t);
}

function heal(src: Avatar, dst: Avatar, amount: number) {
  const eff = Math.min(dst.maxHp - dst.hp, amount);
  if (eff <= 0) return;
  dst.hp += eff;
  pushFx({ a: 'heal', s: src.key, t: dst.key, d: Math.round(eff) }, dst.x, dst.y);
}

function killMonster(m: Monster, killer: Avatar, t: number) {
  m.dead = true;
  m.hp = 0;
  m.target = null;
  m.path = [];
  m.respawnAt = t + (MONSTERS[m.type].elite ? WORLD.eliteRespawnMs : WORLD.monsterRespawnMs);
  pushFx({ a: 'die', t: m.key }, m.x, m.y);
  for (const a of avatars.values()) if (a.target === m.key) a.target = null;
  if (killer.npc) return;
  const recipients = [killer.charId];
  const pid = partyOf.get(killer.charId);
  if (pid) {
    for (const id of parties.get(pid)!.members) {
      if (id === killer.charId) continue;
      const o = playerAvatar(id);
      if (o && !o.dead && !inWar(id) && dist(o.x, o.y, m.x, m.y) <= WORLD.shareRadius) recipients.push(id);
    }
  }
  grantKill(m, recipients, pid ? parties.get(pid)! : null);
}

function grantKill(m: Monster, recipients: number[], party: Party | null) {
  const st = monsterStats(m.type, m.level);
  const n = recipients.length;
  const bonus = 1 + 0.15 * (n - 1);
  const exp = Math.max(1, Math.floor((st.exp * bonus) / n));
  const gold = Math.max(1, Math.floor((st.gold * bonus) / n));
  const drops: string[] = [];
  const r = Math.random;
  if (r() < 0.32) drops.push('m_scrap');
  if (m.level >= 4 && r() < 0.08) drops.push('m_circuit');
  if (MONSTERS[m.type].elite) {
    drops.push('m_forge_core', 'm_circuit');
    if (r() < 0.4) drops.push('gear:rare');
  } else if (r() < 0.025) drops.push('gear:common');
  const loot = new Map<number, string[]>();
  for (const d of drops) {
    const who = party ? recipients[party.loot++ % n] : recipients[0];
    const c = getChar(who);
    let tpl = d;
    if (d.startsWith('gear:')) {
      const tier = d.slice(5) as 'common' | 'rare';
      tpl = r() < 0.5 ? ROLE_WEAPONS[c.role][tier] : ARMORS[tier];
    }
    (loot.get(who) ?? loot.set(who, []).get(who)!).push(tpl);
  }
  const levelUps = new Map<number, number>();
  tx(() => {
    for (const id of recipients) {
      addGold(id, gold);
      levelUps.set(id, grantExp(id, exp));
      for (const tpl of loot.get(id) ?? []) {
        if (ITEMS[tpl].stack) addStack(id, tpl, 1);
        else addGear(id, tpl);
      }
    }
  });
  for (const id of recipients) {
    const items = (loot.get(id) ?? []).map((tpl) => ITEMS[tpl].name);
    emitTo(id, 'loot', {
      monster: MONSTERS[m.type].name,
      exp,
      gold,
      items,
      shared: n > 1,
      levelUps: levelUps.get(id) ?? 0,
    });
    pushPlayer(id);
  }
}

function grantMining(charId: number, template: 'o_lumen' | 'o_cobaltine') {
  const qty = template === 'o_lumen' ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
  tx(() => addStack(charId, template, qty));
  emitTo(charId, 'loot', { monster: null, exp: 0, gold: 0, items: [`${qty}× ${ITEMS[template].name}`], shared: false, levelUps: 0 });
  pushPlayer(charId);
}

function npcThink(a: Avatar, t: number) {
  if (t < a.thinkAt) return;
  a.thinkAt = t + 1000 + Math.random() * 800;
  if (a.target) return;
  let best: Monster | null = null;
  let bd = 14;
  for (const m of monsters) {
    if (m.dead || m.level > a.level + 2 || MONSTERS[m.type].elite) continue;
    const d = dist(a.x, a.y, m.x, m.y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  if (best && Math.random() < 0.7) {
    a.target = best.key;
    return;
  }
  if (!a.path.length) {
    for (let i = 0; i < 6; i++) {
      const x = a.home.x + (Math.random() - 0.5) * 16;
      const y = a.home.y + (Math.random() - 0.5) * 16;
      if (walkable(M, x, y)) {
        a.path = findPath(M, a.x, a.y, x, y, 1500) ?? [];
        break;
      }
    }
  }
}

function monsterTick(m: Monster, t: number, dt: number) {
  const def = MONSTERS[m.type];
  if (m.dead) {
    if (t >= m.respawnAt) Object.assign(m, spawnMonster(m.sp), { wanderAt: t + 2000 });
    return;
  }
  // Pick or validate a target.
  let tgt = m.target ? avatars.get(m.target) : undefined;
  const invalid = (a: Avatar | undefined) => !a || a.dead || (!a.npc && inWar(a.charId)) || inSafeZone(M, a.x, a.y);
  if (m.target && invalid(tgt)) {
    m.target = null;
    tgt = undefined;
  }
  if (dist(m.x, m.y, m.sp.x, m.sp.y) > WORLD.leash && !m.returning) {
    m.returning = true;
    m.target = null;
    tgt = undefined;
    m.path = findPath(M, m.x, m.y, m.sp.x, m.sp.y, 2500) ?? [[m.sp.x, m.sp.y]];
  }
  if (m.returning) {
    moveAlong(m, def.speed * 1.5 * dt);
    if (!m.path.length) {
      m.returning = false;
      m.hp = m.maxHp;
    }
    return;
  }
  if (!tgt) {
    let best: Avatar | undefined;
    let bd = def.aggro;
    for (const a of avatars.values()) {
      if (invalid(a)) continue;
      const d = dist(a.x, a.y, m.x, m.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) {
      m.target = best.key;
      tgt = best;
    }
  }
  if (tgt) {
    const d = dist(m.x, m.y, tgt.x, tgt.y);
    if (d > def.range) {
      if (lineClear(M, m.x, m.y, tgt.x, tgt.y)) m.path = [[tgt.x, tgt.y]];
      else if (t >= m.repathAt) {
        m.repathAt = t + 500;
        m.path = findPath(M, m.x, m.y, tgt.x, tgt.y, 1500) ?? [];
      }
      const before = { x: m.x, y: m.y };
      moveAlong(m, def.speed * dt);
      if (inSafeZone(M, m.x, m.y)) {
        m.x = before.x;
        m.y = before.y;
        m.target = null;
      }
    } else {
      m.path = [];
      if (t - m.lastAttack >= WORLD.monsterAttackMs) {
        m.lastAttack = t;
        let dmg = mitigate(m.atk, tgt.def, Math.random());
        if (tgt.shieldUntil > t) dmg = Math.round(dmg * 0.5);
        dmg = Math.min(tgt.hp, dmg);
        tgt.hp -= dmg;
        tgt.lastHurt = t;
        pushFx({ a: 'hit', s: m.key, t: tgt.key, d: dmg }, tgt.x, tgt.y);
        if (!tgt.target && tgt.npc) tgt.target = m.key;
        if (tgt.hp <= 0) {
          tgt.hp = 0;
          tgt.dead = true;
          tgt.respawnAt = t + WORLD.respawnMs;
          tgt.target = null;
          tgt.path = [];
          tgt.mining = null;
          pushFx({ a: 'die', t: tgt.key }, tgt.x, tgt.y);
          m.target = null;
          if (!tgt.npc) systemMsg(tgt.charId, `${MONSTERS[m.type].name} knocked you out. You will reactivate at your base.`);
        }
      }
    }
    return;
  }
  if (t >= m.wanderAt) {
    m.wanderAt = t + 4000 + Math.random() * 5000;
    const x = m.sp.x + (Math.random() - 0.5) * 5;
    const y = m.sp.y + (Math.random() - 0.5) * 5;
    if (walkable(M, x, y) && !inSafeZone(M, x, y) && lineClear(M, m.x, m.y, x, y)) m.path = [[x, y]];
  }
  moveAlong(m, def.speed * 0.45 * dt);
}

// ---------------------------------------------------------------- war on the map

/** Where each Chip War combatant stands on the map, derived from the war engine state. */
function warPositions(): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const e = wars.engine;
  if (!e || e.s.ended) return out;
  const groups = new Map<string, string[]>();
  for (const c of e.s.combatants) {
    if (c.loc) {
      const k = `${c.loc}|${c.faction}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(c.id);
    }
  }
  const center = (f: FactionId) => ({ x: M.bases[f].x + 0.5, y: M.bases[f].y + 0.5 });
  for (const c of e.s.combatants) {
    if (c.loc) {
      const base = center(c.loc);
      const ids = groups.get(`${c.loc}|${c.faction}`)!;
      const i = ids.indexOf(c.id);
      const home = center(c.faction);
      const defending = c.loc === c.faction;
      const facing = defending ? Math.atan2(M.plaza.y - base.y, M.plaza.x - base.x) : Math.atan2(home.y - base.y, home.x - base.x);
      const ang = defending ? facing + 0.35 + (i / ids.length) * Math.PI * 2 : facing + (i - (ids.length - 1) / 2) * 0.55;
      const r = (defending ? 2.4 : 4.2) + (i % 2) * 0.9;
      out.set(c.id, { x: base.x + Math.cos(ang) * r, y: base.y + Math.sin(ang) * r });
    } else {
      const from = center(c.from ?? c.faction);
      const to = center(c.dest ?? c.faction);
      const span = Math.max(1, c.arriveTick - c.departTick);
      const p = Math.max(0, Math.min(1, (e.s.tick - c.departTick) / span));
      const h = (parseInt(c.id.replace(/\D/g, '') || '0', 10) % 5) - 2;
      const nx = -(to.y - from.y);
      const ny = to.x - from.x;
      const nl = Math.hypot(nx, ny) || 1;
      out.set(c.id, { x: from.x + (to.x - from.x) * p + (nx / nl) * h * 0.35, y: from.y + (to.y - from.y) * p + (ny / nl) * h * 0.35 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- snapshots

let warPosCache: Map<string, { x: number; y: number }> = new Map();

function broadcastSnapshots() {
  warPosCache = warPositions();
  for (const id of onlineCharIds()) {
    const a = playerAvatar(id);
    if (a) emitTo(id, 'snap', snapshotFor(a));
  }
}

function snapshotFor(a: Avatar): WorldSnap {
  const t = now();
  const warMe = inWar(a.charId) ? warPosCache.get(`h:${a.charId}`) : undefined;
  const cx = warMe?.x ?? a.x;
  const cy = warMe?.y ?? a.y;
  const R = WORLD.viewRadius;
  const ents: WorldEnt[] = [];
  const r1 = (n: number) => Math.round(n * 100) / 100;
  for (const o of avatars.values()) {
    if (o === a) continue;
    if (!o.npc && inWar(o.charId)) continue;
    if (dist(o.x, o.y, cx, cy) > R) continue;
    ents.push({
      k: o.npc ? 'b' : 'p',
      id: o.key,
      x: r1(o.x),
      y: r1(o.y),
      hp: Math.round(o.hp),
      mhp: Math.round(o.maxHp),
      n: o.name,
      f: o.faction,
      r: o.role,
      l: o.level,
      dead: o.dead || undefined,
      party: (!o.npc && sameParty(a.charId, o.charId)) || undefined,
      moving: o.path.length > 0 || undefined,
      charId: o.npc ? undefined : o.charId,
      tgt: o.target ?? undefined,
    });
  }
  for (const m of monsters) {
    if (m.dead || dist(m.x, m.y, cx, cy) > R) continue;
    ents.push({ k: 'm', id: m.key, x: r1(m.x), y: r1(m.y), hp: m.hp, mhp: m.maxHp, ty: m.type, l: m.level, n: MONSTERS[m.type].name, moving: m.path.length > 0 || undefined, tgt: m.target ?? undefined });
  }
  const e = wars.engine;
  if (e && !e.s.ended) {
    for (const c of e.s.combatants) {
      const p = warPosCache.get(c.id);
      if (!p || dist(p.x, p.y, cx, cy) > R + 8) continue;
      ents.push({
        k: 'w',
        id: c.id,
        x: r1(p.x),
        y: r1(p.y),
        hp: c.hp,
        mhp: c.maxHp,
        n: c.name,
        f: c.faction,
        r: c.role,
        l: c.level,
        dead: !c.alive || undefined,
        moving: c.loc === null || undefined,
        charId: c.charId ?? undefined,
        party: (c.charId !== null && sameParty(a.charId, c.charId)) || undefined,
      });
    }
  }
  const me: WorldMe = {
    id: warMe ? `h:${a.charId}` : a.key,
    x: r1(cx),
    y: r1(cy),
    hp: warMe ? (e!.byChar(a.charId)?.hp ?? 0) : Math.round(a.hp),
    mhp: warMe ? (e!.byChar(a.charId)?.maxHp ?? 1) : Math.round(a.maxHp),
    dead: warMe ? !e!.byChar(a.charId)?.alive : a.dead,
    respawnIn: warMe ? (e!.byChar(a.charId)?.alive ? 0 : Math.max(0, (e!.byChar(a.charId)?.respawnAt ?? 0) - e!.s.tick)) : a.dead ? Math.max(0, Math.ceil((a.respawnAt - t) / 1000)) : 0,
    target: a.target,
    mining: a.mining ? { ore: a.mining.ore, pct: Math.min(1, 1 - (a.mining.until - t) / WORLD.oreMineMs) } : null,
    abilityReadyIn: Math.max(0, Math.ceil((a.abilityReady - t) / 1000)),
    inWar: !!warMe,
    shield: a.shieldUntil > t,
    moving: a.path.length > 0,
  };
  const visibleFx = fx.filter((f) => dist(f.x, f.y, cx, cy) <= R).map(({ x: _x, y: _y, ...rest }) => rest as WorldFx);
  return { t: Date.now(), me, ents, ores: [...oreDepleted.keys()], fx: visibleFx };
}

// ---------------------------------------------------------------- commands

type Ctx = { conn: Conn; charId: number | null; isDev: boolean };
const need = (ctx: Ctx) => {
  if (!ctx.charId) fail('Please sign in.');
  const a = playerAvatar(ctx.charId);
  if (!a) fail('Your pilot is not in the world yet.');
  return a;
};
const finite = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) fail('Bad coordinates.');
  return n;
};

const handlers: Record<string, (ctx: Ctx, p: any) => any> = {
  'world.move': (ctx, p) => {
    const a = need(ctx);
    if (inWar(a.charId)) fail('You are in a Chip War. Tap a base to march, or an ally to follow.');
    if (a.dead) fail('You are reactivating at your base.');
    const x = Math.max(0.5, Math.min(M.w - 0.5, finite(p.x)));
    const y = Math.max(0.5, Math.min(M.h - 0.5, finite(p.y)));
    const path = findPath(M, a.x, a.y, x, y);
    if (!path) fail('You can’t walk there.');
    a.path = path;
    a.target = null;
    a.mining = null;
    return { ok: true, steps: path.length };
  },
  'world.target': (ctx, p) => {
    const a = need(ctx);
    if (inWar(a.charId)) fail('You are in a Chip War.');
    if (a.dead) fail('You are reactivating at your base.');
    const id = String(p.id ?? '');
    if (id.startsWith('m:')) {
      const m = monsters[Number(id.slice(2))];
      if (!m || m.dead) fail('That monster is gone.');
    } else if (id.startsWith('o:')) {
      const n = M.ores[Number(id.slice(2))];
      if (!n) fail('Unknown crystal.');
      if (oreDepleted.has(n.id)) fail('That crystal is depleted. It regrows in under a minute.');
    } else fail('You can’t target that.');
    a.target = id;
    a.mining = null;
    a.repathAt = 0;
    return { ok: true };
  },
  'world.stop': (ctx) => {
    const a = need(ctx);
    a.path = [];
    a.target = null;
    a.mining = null;
    return { ok: true };
  },
  'world.ability': (ctx) => {
    const a = need(ctx);
    if (inWar(a.charId)) return wars.ability(a.charId);
    if (a.dead) fail('You are reactivating at your base.');
    const t = now();
    if (t < a.abilityReady) fail(`${ROLES[a.role].ability.name} is on cooldown.`);
    a.abilityReady = t + ROLES[a.role].ability.warCooldownSec * 1000;
    if (a.role === 'assault') a.overcharge = true;
    else if (a.role === 'guardian') {
      for (const o of allies(a, WORLD.abilityRadius)) o.shieldUntil = t + 5000;
      for (const m of monsters) {
        if (!m.dead && dist(m.x, m.y, a.x, a.y) <= WORLD.abilityRadius) {
          m.target = a.key;
          m.tauntUntil = t + 4000;
          m.returning = false;
        }
      }
    } else {
      for (const o of allies(a, WORLD.abilityRadius)) heal(a, o, Math.round(o.maxHp * 0.3));
    }
    pushFx({ a: 'ab', s: a.key, kind: ROLES[a.role].ability.id }, a.x, a.y);
    return { ok: true };
  },
  'war.focus': (ctx, p) => {
    if (!ctx.charId) fail('Please sign in.');
    return wars.focus(ctx.charId, p.id ? String(p.id) : null);
  },
  'party.invite': (ctx, p) => {
    const me = need(ctx).charId;
    const other = Number(p.charId);
    if (other === me) fail('You cannot invite yourself.');
    const o = getChar(other);
    if (o.is_bot) fail('NPC pilots cannot join parties.');
    if (o.faction !== getChar(me).faction) fail('Parties are for pilots of the same faction.');
    if (!onlineCharIds().includes(other)) fail(`${o.name} is offline.`);
    if (partyOf.get(other)) fail(`${o.name} is already in a party.`);
    const pid = partyOf.get(me);
    if (pid && parties.get(pid)!.members.length >= WORLD.partyMax) fail('Your party is full.');
    invites.set(other, { from: me, at: now() });
    emitTo(other, 'partyInvite', { from: me, name: getChar(me).name });
    return { ok: true };
  },
  'party.respond': (ctx, p) => {
    const me = need(ctx).charId;
    const inv = invites.get(me);
    invites.delete(me);
    if (!inv || now() - inv.at > 120_000) fail('That invite expired.');
    if (!p.accept) {
      systemMsg(inv.from, `${getChar(me).name} declined your party invite.`);
      return { ok: true };
    }
    if (partyOf.get(me)) fail('Leave your current party first.');
    let pid = partyOf.get(inv.from);
    if (!pid) {
      pid = partySeq++;
      parties.set(pid, { id: pid, leader: inv.from, members: [inv.from], loot: 0 });
      partyOf.set(inv.from, pid);
    }
    const party = parties.get(pid)!;
    if (party.members.length >= WORLD.partyMax) fail('That party is full.');
    party.members.push(me);
    partyOf.set(me, pid);
    pushParty(party);
    for (const id of party.members) systemMsg(id, `${getChar(me).name} joined the party.`);
    return partyView(party);
  },
  'party.leave': (ctx) => {
    if (!ctx.charId) fail('Please sign in.');
    leaveParty(ctx.charId);
    return { ok: true };
  },
  'party.kick': (ctx, p) => {
    if (!ctx.charId) fail('Please sign in.');
    const pid = partyOf.get(ctx.charId);
    const party = pid ? parties.get(pid) : undefined;
    if (!party || party.leader !== ctx.charId) fail('Only the party leader can remove members.');
    const target = Number(p.charId);
    if (!party.members.includes(target) || target === ctx.charId) fail('That pilot is not in your party.');
    leaveParty(target);
    systemMsg(target, 'You were removed from the party.');
    return { ok: true };
  },
  'chat.send': (ctx, p) => {
    if (!ctx.charId) fail('Please sign in.');
    return sendChat(ctx.charId, String(p.ch ?? 'world'), p.text);
  },
  'dev.world.teleport': (ctx, p) => {
    if (!ctx.isDev) fail('Developer tools are only available to developer accounts.');
    const a = need(ctx);
    const x = finite(p.x);
    const y = finite(p.y);
    if (!walkable(M, x, y)) fail('Not walkable.');
    a.x = x;
    a.y = y;
    a.path = [];
    return { ok: true };
  },
  'dev.world.monsters': (ctx) => {
    if (!ctx.isDev) fail('Developer tools are only available to developer accounts.');
    return monsters.map((m) => ({ id: m.key, type: m.type, level: m.level, x: m.x, y: m.y, hp: m.hp, dead: m.dead }));
  },
};

export function installWorld() {
  hooks.onBind = (conn, charId) => join(conn, charId);
  hooks.onUnbind = (_conn, charId, last) => {
    if (last) leave(charId);
  };
  hooks.onTick = () => tickWorld();
  hooks.onPlayerChanged = (charId) => refreshStats(charId);
  hooks.extraHandlers = handlers;
}

/** Test/inspection helper. */
export function worldState() {
  return { avatars, monsters, oreDepleted, parties, partyOf };
}

