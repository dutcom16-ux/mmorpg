// Open-world tests: shared presence, movement, monster combat and loot, parties with shared
// rewards, chat channels, hand mining, and Chip War fighters on the map.
// Run: npm run test:world
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { worldMap, walkable } from '../../shared/map';
import { TestClient, TestServer, sleep } from './harness';

const srv = new TestServer(3900 + Math.floor(Math.random() * 500));
const M = worldMap();
let A: TestClient; // Solenne, Aurex Assault
let B: TestClient; // Tarrok, Kreth Guardian
let D: TestClient; // Dana, new Aurex Engineer
const T = { timeout: 120_000 };

function near(x: number, y: number) {
  for (let r = 1; r <= 3; r += 0.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (walkable(M, px, py)) return { x: px, y: py };
    }
  }
  throw new Error('no free tile');
}

before(async () => {
  await srv.start();
  A = new TestClient(srv.url, 'A');
  B = new TestClient(srv.url, 'B');
  D = new TestClient(srv.url, 'D');
  for (const c of [A, B, D]) await c.connect();
  await A.login('aurex_pilot');
  await B.login('kreth_pilot');
  const reg = await D.rpc('auth.register', { username: 'dana_world', password: 'test1234', name: 'Dana', faction: 'aurex', role: 'engineer' });
  D.setToken(reg.token);
  await D.waitFor(() => D.player);
});

after(async () => {
  for (const c of [A, B, D]) c?.disconnect();
  await srv.stop();
});

test('Shared world: pilots spawn at their base and see each other moving', T, async () => {
  const s = await A.waitFor(() => A.snap?.me && A.snap, 5000, 'snapshot');
  const base = M.bases.aurex;
  assert.ok(Math.hypot(s.me.x - base.x, s.me.y - base.y) < 8, 'A starts at the Aurex base');
  const dId = `p:${D.player.character.id}`;
  await A.waitFor(() => A.snap.ents.find((e: any) => e.id === dId), 5000, 'A sees D');
  const before = { x: s.me.x, y: s.me.y };
  const dest = near(M.spawnPoints.aurex.x + 3, M.spawnPoints.aurex.y + 3);
  await A.rpc('world.move', { x: dest.x, y: dest.y });
  await A.waitFor(() => !A.snap.me.moving && Math.hypot(A.snap.me.x - dest.x, A.snap.me.y - dest.y) < 0.3, 6000, 'arrive');
  assert.ok(Math.hypot(A.snap.me.x - before.x, A.snap.me.y - before.y) > 1);
  await D.waitFor(() => {
    const e = D.snap?.ents.find((x: any) => x.id === `p:${A.player.character.id}`);
    return e && Math.hypot(e.x - dest.x, e.y - dest.y) < 0.4;
  }, 4000, 'D sees A at the new spot');
  let deep: { x: number; y: number } | null = null;
  for (let y = 3; y < M.h - 3 && !deep; y++) {
    for (let x = 3; x < M.w - 3 && !deep; x++) {
      let solid = true;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (walkable(M, x + dx, y + dy)) solid = false;
      if (solid) deep = { x: x + 0.5, y: y + 0.5 };
    }
  }
  assert.ok(deep);
  assert.match(await A.rpcErr('world.move', deep), /can’t walk/, 'solid rock is not walkable');
});

test('Monster fights: tap to attack, kill, and receive EXP, Gold and loot', T, async () => {
  const mons = await A.rpc('dev.world.monsters');
  const sk = mons.filter((m: any) => m.type === 'skitter' && !m.dead).sort((a: any, b: any) => a.level - b.level)[0];
  const spot = near(sk.x, sk.y);
  await A.rpc('dev.world.teleport', spot);
  const g0 = (await A.me()).character.gold;
  A.events.loot = [];
  await A.rpc('world.target', { id: sk.id });
  const loot = await A.waitFor(() => A.events.loot?.find((l: any) => l.monster === 'Rift Skitter'), 20000, 'skitter loot');
  assert.ok(loot.exp > 0 && loot.gold > 0);
  assert.equal(loot.shared, false);
  assert.equal((await A.me()).character.gold, g0 + loot.gold, 'gold written to the database');
  const after = (await A.rpc('dev.world.monsters')).find((m: any) => m.id === sk.id);
  assert.equal(after.dead, true, 'monster is down until it respawns');
});

test('Parties: same-faction invite, shared EXP and Gold, round-robin loot', T, async () => {
  assert.match(await A.rpcErr('party.invite', { charId: B.player.character.id }), /same faction/);
  await A.rpc('party.invite', { charId: D.player.character.id });
  const inv = await D.waitFor(() => D.events.partyInvite?.[0], 3000, 'invite');
  assert.equal(inv.name, 'Solenne');
  await D.rpc('party.respond', { accept: true });
  const pv = await A.waitFor(() => A.events.party?.slice(-1)[0], 3000, 'party view');
  assert.deepEqual(pv.members.map((m: any) => m.name).sort(), ['Dana', 'Solenne']);

  const mons = await A.rpc('dev.world.monsters');
  const sk = mons.filter((m: any) => (m.type === 'skitter' || m.type === 'stalker') && !m.dead).sort((a: any, b: any) => a.level - b.level)[0];
  const spot = near(sk.x, sk.y);
  await A.rpc('dev.world.teleport', spot);
  await D.rpc('dev.world.teleport', spot).catch(() => {}); // D is not a developer account
  // D walks over instead.
  await D.rpc('world.move', spot).catch(() => {});
  await D.waitFor(() => D.snap?.me && Math.hypot(D.snap.me.x - spot.x, D.snap.me.y - spot.y) < 1.5, 30000, 'D arrives');
  A.events.loot = [];
  D.events.loot = [];
  // Pick whichever monster is closest now (NPC pilots hunt here too).
  const live = (await A.rpc('dev.world.monsters')).filter((m: any) => !m.dead && m.type !== 'colossus' && m.type !== 'wraith');
  live.sort((a: any, b: any) => Math.hypot(a.x - spot.x, a.y - spot.y) - Math.hypot(b.x - spot.x, b.y - spot.y));
  await A.rpc('world.target', { id: live[0].id });
  const la = await A.waitFor(() => A.events.loot?.find((l: any) => l.monster), 25000, 'A loot');
  const ld = await D.waitFor(() => D.events.loot?.find((l: any) => l.monster), 5000, 'D loot');
  assert.equal(la.shared, true);
  assert.equal(ld.shared, true);
  assert.equal(la.exp, ld.exp, 'EXP split evenly');
  assert.equal(la.gold, ld.gold, 'Gold split evenly');
});

test('Chat: world reaches everyone, faction and party stay private', T, async () => {
  for (const c of [A, B, D]) c.events.chat = [];
  await A.rpc('chat.send', { ch: 'world', text: 'Hello Veyra' });
  await B.waitFor(() => B.events.chat?.find((m: any) => m.text === 'Hello Veyra'), 3000, 'B gets world chat');
  await sleep(1300);
  await A.rpc('chat.send', { ch: 'faction', text: 'Aurex only' });
  await D.waitFor(() => D.events.chat?.find((m: any) => m.text === 'Aurex only'), 3000, 'D gets faction chat');
  await sleep(1300);
  await A.rpc('chat.send', { ch: 'party', text: 'Party only' });
  await D.waitFor(() => D.events.chat?.find((m: any) => m.text === 'Party only'), 3000, 'D gets party chat');
  await sleep(500);
  assert.ok(!B.events.chat.some((m: any) => m.text === 'Aurex only' || m.text === 'Party only'), 'Kreth sees neither');
  assert.match(await A.rpcErr('chat.send', { ch: 'world', text: 'spam' }), /too quickly/);
});

test('Hand mining: walk to an ore crystal, mine it, it depletes', T, async () => {
  const node = M.ores.find((o) => o.template === 'o_lumen')!;
  await A.rpc('dev.world.teleport', near(node.x, node.y));
  A.events.loot = [];
  await A.rpc('world.target', { id: `o:${node.id}` });
  const l = await A.waitFor(() => A.events.loot?.find((x: any) => /Lumen Ore/.test(x.items.join())), 12000, 'mined ore');
  assert.ok(l);
  await A.waitFor(() => A.snap?.ores.includes(node.id), 2000, 'depleted');
});

test('Chip Wars on the map: fighters stand at the bases and the war controls take over', T, async () => {
  await A.rpc('party.leave');
  await A.rpc('war.queue', { on: true });
  await B.rpc('war.queue', { on: true });
  await A.rpc('dev.testWar', { seconds: 60, passiveBots: true });
  const s = await A.waitFor(() => A.snap?.me?.inWar && A.snap, 5000, 'in war');
  assert.ok(Math.hypot(s.me.x - M.bases.aurex.x, s.me.y - M.bases.aurex.y) < 6, 'rallied at home base');
  assert.ok(s.ents.some((e: any) => e.k === 'w' && e.f === 'aurex'), 'war fighters on the map');
  assert.match(await A.rpcErr('world.move', { x: 20, y: 40 }), /Chip War/);
  await A.rpc('war.order', { order: { kind: 'attack', target: 'kreth' } });
  await sleep(2500);
  const mid = A.snap.me;
  assert.ok(Math.hypot(mid.x - M.bases.aurex.x, mid.y - M.bases.aurex.y) > 3, 'marching toward Kreth along the road');
  await A.rpc('dev.war.endNow');
  await A.waitFor(() => A.snap?.me && !A.snap.me.inWar, 6000, 'war over');
  const sp = M.spawnPoints.aurex;
  await A.waitFor(() => Math.hypot(A.snap.me.x - sp.x, A.snap.me.y - sp.y) < 1, 3000, 'back at base');
});
