// End-to-end acceptance tests (section 9 of the brief). Runs the real server as a child process
// and drives it with socket.io-client, the same transport as the Android and browser clients.
// Run: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { goldMinePayout, ROLE_WEAPONS, ARMORS } from '../../shared/content';
import { marketFee } from '../../shared/protocol';
import { manilaTime } from '../../shared/time';
import { TestClient, TestServer, claimId, qty, sleep } from './harness';

const srv = new TestServer(3300 + Math.floor(Math.random() * 600));
let A: TestClient; // aurex_pilot  — "the Android player" in the brief
let B: TestClient; // kreth_pilot  — "the browser player"
let C: TestClient; // vessari_pilot
let D: TestClient; // fresh account, used for defeat/retry and as the late war entrant

const T = { timeout: 180_000 };

async function advance(ms: number) {
  await A.rpc('dev.clock', { action: 'advance', ms });
  await sleep(600); // let the 250 ms server loop process the jump
}

async function clearFast(c: TestClient, dungeonId: string) {
  const r = await c.rpc('dungeon.start', { dungeonId });
  await advance(4 * 60_000);
  return c.waitFor(() => c.dungeon?.runId === r.runId && c.dungeon.finalized && c.dungeon, 15000, `${dungeonId} result`);
}

before(async () => {
  await srv.start();
  A = new TestClient(srv.url, 'A');
  B = new TestClient(srv.url, 'B');
  C = new TestClient(srv.url, 'C');
  D = new TestClient(srv.url, 'D');
  for (const c of [A, B, C, D]) await c.connect();
  await A.login('aurex_pilot');
  await B.login('kreth_pilot');
  await C.login('vessari_pilot');
  const reg = await D.rpc('auth.register', { username: 'dana_test', password: 'test1234', name: 'Dana', faction: 'aurex', role: 'assault' });
  D.setToken(reg.token);
  await D.waitFor(() => D.player);
});

after(async () => {
  for (const c of [A, B, C, D]) c?.disconnect();
  await srv.stop();
});

test('Trading: A mines ore and lists it; B buys it; balances and inventories settle', T, async () => {
  await A.rpc('idle.set', { activity: 'mine', zone: 'quarry', claimId: claimId() });
  await advance(10 * 60_000);
  const p0 = await A.me();
  const claim = await A.rpc('idle.claim', { claimId: claimId() });
  assert.ok(claim.items.o_lumen >= 40, `mined ${claim.items.o_lumen} lumen`);
  const p1 = await A.me();
  assert.equal(qty(p1, 'o_lumen'), qty(p0, 'o_lumen') + claim.items.o_lumen);

  const listing = await A.rpc('market.list', { templateId: 'o_lumen', qty: 10, unitPrice: 5 });
  const p2 = await A.me();
  assert.equal(qty(p2, 'o_lumen'), qty(p1, 'o_lumen') - 10, 'listed ore moves into escrow');

  const found = await B.rpc('market.search', { q: 'lumen' });
  assert.ok(found.some((l: any) => l.id === listing.id), 'B sees A’s listing (cross-faction)');
  const b0 = await B.me();
  const a0 = await A.me();
  const buy = await B.rpc('market.buy', { listingId: listing.id, qty: 4, unitPrice: 5 });
  assert.equal(buy.total, 20);
  assert.equal(buy.fee, marketFee(20));
  assert.equal(buy.sellerNet, 20 - marketFee(20));
  const b1 = await B.me();
  const a1 = await A.me();
  assert.equal(b1.character.gold, b0.character.gold - 20, 'buyer pays the total');
  assert.equal(qty(b1, 'o_lumen'), qty(b0, 'o_lumen') + 4, 'buyer receives ore');
  assert.equal(a1.character.gold, a0.character.gold + buy.sellerNet, 'seller receives total minus fee');
  const hist = await B.rpc('market.history', { scope: 'mine' });
  assert.match(hist[0].description, /Lumen Ore ×4 — Solenne → Tarrok/);
  const mine = await A.rpc('market.mine');
  assert.equal(mine.find((l: any) => l.id === listing.id).qtyLeft, 6);
});

test('Trading: two buyers race for the last item — exactly one gets it, the other keeps their coins', T, async () => {
  const last = await A.rpc('market.list', { templateId: 'o_lumen', qty: 1, unitPrice: 7 });
  const gB = (await B.me()).character.gold;
  const gC = (await C.me()).character.gold;
  const res = await Promise.allSettled([
    B.rpc('market.buy', { listingId: last.id, qty: 1 }),
    C.rpc('market.buy', { listingId: last.id, qty: 1 }),
  ]);
  const ok = res.filter((r) => r.status === 'fulfilled');
  const bad = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1, 'exactly one purchase succeeds');
  assert.equal(bad.length, 1);
  assert.match(bad[0].reason.message, /sold out/);
  const gB2 = (await B.me()).character.gold;
  const gC2 = (await C.me()).character.gold;
  assert.equal(gB2 + gC2, gB + gC - 7, 'only one buyer paid');
  assert.ok((gB2 === gB - 7 && gC2 === gC) || (gC2 === gC - 7 && gB2 === gB));
});

test('Trading: a direct trade edited after one player confirms clears both confirmations', T, async () => {
  const opened = await A.rpc('trade.open', { name: 'Tarrok' });
  const lumen = (await A.me()).inventory.find((i: any) => i.templateId === 'o_lumen');
  let t = await A.rpc('trade.offer', { tradeId: opened.id, offer: { gold: 0, items: [{ itemId: lumen.id, qty: 5 }] } });
  t = await B.rpc('trade.offer', { tradeId: opened.id, offer: { gold: 30, items: [] } });
  const seenByA = t.version;
  t = await A.rpc('trade.confirm', { tradeId: t.id, version: seenByA });
  assert.equal(t.a.confirmed, true);
  assert.equal(t.b.confirmed, false);

  t = await B.rpc('trade.offer', { tradeId: t.id, offer: { gold: 25, items: [] } });
  assert.equal(t.a.confirmed, false, 'A’s confirmation was cleared by B’s edit');
  assert.equal(t.b.confirmed, false);
  assert.ok(t.version > seenByA);
  assert.match(t.note, /cleared/);
  assert.match(await A.rpcErr('trade.confirm', { tradeId: t.id, version: seenByA }), /changed/, 'stale approval is rejected');

  const a0 = await A.me();
  const b0 = await B.me();
  t = await B.rpc('trade.confirm', { tradeId: t.id, version: t.version });
  assert.equal(t.status, 'open');
  t = await A.rpc('trade.confirm', { tradeId: t.id, version: t.version });
  assert.equal(t.status, 'completed');
  const a1 = await A.me();
  const b1 = await B.me();
  assert.equal(a1.character.gold, a0.character.gold + 25);
  assert.equal(b1.character.gold, b0.character.gold - 25);
  assert.equal(qty(a1, 'o_lumen'), qty(a0, 'o_lumen') - 5);
  assert.equal(qty(b1, 'o_lumen'), qty(b0, 'o_lumen') + 5);
});

test('Progression: a brand-new pilot can make the first upgrade within five minutes', T, async () => {
  const E = new TestClient(srv.url, 'E');
  await E.connect();
  const reg = await E.rpc('auth.register', { username: 'newbie_e', password: 'test1234', name: 'Rookie', faction: 'kreth', role: 'engineer' });
  E.setToken(reg.token);
  const p0 = await E.waitFor(() => E.player);
  assert.equal(p0.idle.activity, 'hunt', 'new pilots start hunting');
  await A.rpc('dev.clock', { action: 'advance', ms: 2.5 * 60_000 });
  await E.rpc('idle.claim', { claimId: claimId() });
  const r = await E.rpc('gear.upgrade', { itemId: p0.character.weaponId });
  assert.equal(r.upgrade, 1);
  E.disconnect();
});

let goldRunId = 0;
let goldAfterMine = 0;

test('Dungeons: clear all four, verify each primary reward, equip drops, spend dungeon gold', T, async () => {
  const p = await A.me();
  assert.deepEqual(p.dungeons.list.map((d: any) => d.available), [true, true, true, true]);
  assert.equal(p.dungeons.list.find((d: any) => d.id === 'goldmine').payout, goldMinePayout(6), 'payout shown before entry');

  // Training Grounds in real time, using the role ability once.
  const exp0 = p.character.exp + p.character.level * 1e6;
  const run = await A.rpc('dungeon.start', { dungeonId: 'training' });
  assert.equal(run.periodKey, p.dungeons.periodKey);
  assert.match(await A.rpcErr('dungeon.start', { dungeonId: 'foundry' }), /already have a dungeon run/, 'one active run per character');
  await sleep(1300);
  await A.rpc('dungeon.ability', { runId: run.runId });
  const tg = await A.waitFor(() => A.dungeon?.runId === run.runId && A.dungeon.finalized && A.dungeon, 90000, 'training result');
  assert.equal(tg.state.status, 'victory');
  assert.equal(tg.reward.rewarded, true);
  assert.ok(tg.reward.exp > 300, 'bonus character EXP');
  assert.ok(tg.state.abilityUses >= 1);
  const p1 = await A.me();
  assert.ok(p1.character.exp + p1.character.level * 1e6 > exp0, 'EXP applied');
  assert.match(await A.rpcErr('dungeon.start', { dungeonId: 'training' }), /already cleared/);

  // Weapon Foundry -> role weapon. Equip it.
  const fd = await clearFast(A, 'foundry');
  assert.equal(fd.state.status, 'victory');
  assert.ok([ROLE_WEAPONS.assault.rare, ROLE_WEAPONS.assault.epic].includes(fd.reward.gearTemplateId), 'assault weapon drop');
  const atkBefore = (await A.me()).character.stats.atk;
  const oldWeapon = (await A.me()).character.weaponId;
  await A.rpc('gear.equip', { itemId: fd.reward.gearItemId });
  const p2 = await A.me();
  assert.equal(p2.character.weaponId, fd.reward.gearItemId);
  assert.ok(p2.character.stats.atk > atkBefore);

  // Armored Vault -> armor. Equip it.
  const av = await clearFast(A, 'vault');
  assert.ok([ARMORS.rare, ARMORS.epic].includes(av.reward.gearTemplateId), 'armor drop');
  await A.rpc('gear.equip', { itemId: av.reward.gearItemId });
  assert.equal((await A.me()).character.armorId, av.reward.gearItemId);

  // Escrow: the unequipped starter weapon can be listed, and then cannot be equipped or listed again.
  const gl = await A.rpc('market.list', { itemId: oldWeapon, unitPrice: 30 });
  assert.match(await A.rpcErr('gear.equip', { itemId: oldWeapon }), /listed/);
  assert.match(await A.rpcErr('market.list', { itemId: oldWeapon, unitPrice: 30 }), /already listed/);
  assert.match(await A.rpcErr('market.list', { itemId: fd.reward.gearItemId, unitPrice: 30 }), /Unequip/);
  await A.rpc('market.cancel', { listingId: gl.id });

  // Gold Mine -> exactly the payout shown before entry.
  const g0 = (await A.me()).character.gold;
  const gm = await clearFast(A, 'goldmine');
  goldRunId = gm.runId;
  assert.equal(gm.reward.gold, goldMinePayout(6));
  goldAfterMine = (await A.me()).character.gold;
  assert.equal(goldAfterMine, g0 + goldMinePayout(6));
  const statuses = (await A.me()).dungeons.list;
  assert.deepEqual(statuses.map((d: any) => d.cleared), [true, true, true, true]);

  // Spend dungeon gold in the marketplace.
  const cl = await C.rpc('market.list', { templateId: 'o_lumen', qty: 5, unitPrice: 10 });
  await A.rpc('market.buy', { listingId: cl.id, qty: 5 });
  assert.equal((await A.me()).character.gold, goldAfterMine - 50);
  goldAfterMine -= 50;
});

test('Dungeons: reconnecting after victory shows the same result and never pays twice', T, async () => {
  A.disconnect();
  await sleep(500);
  A.dungeon = null;
  await A.connect();
  const shown = await A.waitFor(() => A.dungeon, 5000, 'unseen result pushed on reconnect');
  assert.equal(shown.runId, goldRunId);
  assert.equal(shown.reward.gold, goldMinePayout(6));
  const again = await A.rpc('dungeon.get', { runId: goldRunId });
  assert.deepEqual(again.reward, shown.reward);
  await A.rpc('dungeon.ack', { runId: goldRunId });
  await sleep(1200);
  assert.equal((await A.me()).character.gold, goldAfterMine, 'no second payout');
  assert.match(await A.rpcErr('dungeon.start', { dungeonId: 'goldmine' }), /already cleared/);
});

test('Dungeons: a defeat permits a retry', T, async () => {
  const tg = await clearFast(D, 'training');
  assert.equal(tg.state.status, 'victory');
  assert.ok((await D.me()).character.level >= 3, 'Training Grounds EXP unlocks the Gold Mine');
  const g0 = (await D.me()).character.gold;
  const lost = await clearFast(D, 'goldmine');
  assert.equal(lost.state.status, 'defeat', 'under-levelled pilot loses to the mining mech');
  assert.equal(lost.reward, null);
  const st = (await D.me()).dungeons.list.find((d: any) => d.id === 'goldmine');
  assert.equal(st.available, true, 'clear still available after defeat');
  const retry = await D.rpc('dungeon.start', { dungeonId: 'goldmine' });
  assert.ok(retry.runId > lost.runId, 'retry started');
  const r = await D.rpc('dungeon.retreat', { runId: retry.runId });
  assert.equal(r.state.status, 'defeat');
  assert.equal((await D.me()).character.gold, g0, 'no payout for defeats');
});

test('Morning reset: crossing 6:00 AM Asia/Manila reopens dungeons; a run started before reset uses the old day', T, async () => {
  const before = await A.me();
  assert.equal(before.dungeons.periodKey, '2026-11-28');
  await A.rpc('dev.clock', { action: 'set', at: manilaTime(2026, 11, 29, 5, 59, 45) });
  await sleep(400);
  let a = await A.me();
  assert.equal(a.dungeons.periodKey, '2026-11-28', 'still the old day at 05:59:45');
  assert.deepEqual(a.dungeons.list.map((d: any) => d.cleared), [true, true, true, true]);
  assert.equal(a.dungeons.nextResetAt, manilaTime(2026, 11, 29, 6, 0, 0));

  // C starts Training Grounds at 05:59:45 and finishes after 06:00.
  const run = await C.rpc('dungeon.start', { dungeonId: 'training' });
  assert.equal(run.periodKey, '2026-11-28');
  await advance(3 * 60_000);
  const res = await C.waitFor(() => C.dungeon?.runId === run.runId && C.dungeon.finalized && C.dungeon, 10000);
  assert.equal(res.state.status, 'victory');
  assert.ok(run.startedAt + res.state.endTick * 1000 > manilaTime(2026, 11, 29, 6, 0, 0), 'run completed after the reset');
  assert.equal(res.reward.periodKey, '2026-11-28', 'clear charged to the day the run started');
  const c = await C.me();
  assert.equal(c.dungeons.periodKey, '2026-11-29');
  assert.equal(c.dungeons.list.find((d: any) => d.id === 'training').available, true, 'new day’s clear still available');
  const again = await clearFast(C, 'training');
  assert.equal(again.reward.rewarded, true);
  assert.equal(again.reward.periodKey, '2026-11-29');

  // A: all four dungeons reopened, earned items kept.
  a = await A.me();
  assert.deepEqual(a.dungeons.list.map((d: any) => d.available), [true, true, true, true]);
  assert.equal(a.character.weaponId, before.character.weaponId);
  assert.equal(a.character.armorId, before.character.armorId);
  assert.equal(a.character.gold, before.character.gold);
  assert.equal(a.dungeons.nextResetAt, manilaTime(2026, 11, 30, 6, 0, 0));
});

let warId = 0;

test('Chip Wars: opposing players + NPC backfill, late entrant retires a bot safely, one NPC kill and one human kill', T, async () => {
  await A.rpc('war.queue', { on: true });
  await B.rpc('war.queue', { on: true });
  const started = await A.rpc('dev.testWar', { seconds: 120, passiveBots: true });
  warId = started.warId;
  const w0 = await A.waitFor(() => A.war?.active?.id === warId && A.war.active, 5000, 'war view');
  assert.deepEqual(w0.participation.aurex, { humans: 1, npcs: 5 }, 'NPCs fill to 6 counting only humans in the battle');
  assert.deepEqual(w0.participation.kreth, { humans: 1, npcs: 5 });
  assert.deepEqual(w0.participation.vessari, { humans: 0, npcs: 6 });
  assert.ok(w0.combatants.filter((c: any) => c.isBot).every((c: any) => c.name.startsWith('NPC ')), 'bots are labelled');

  // Late human entrant on Aurex: admitted immediately, one Aurex NPC stands down safely.
  await D.rpc('war.join', { order: { kind: 'defend' } });
  const w1 = await D.waitFor(() => D.war?.active?.participation.aurex.humans === 2 && D.war.active, 5000);
  assert.ok(w1.combatants.some((c: any) => c.charId === D.player.character.id), 'late entrant admitted immediately');
  const w2 = await D.waitFor(() => D.war?.active?.participation.aurex.npcs === 4 && D.war.active, 15000, 'bot retirement');
  const retireLines = w2.feed.filter((f: any) => f.kind === 'retire').map((f: any) => f.text);
  assert.ok(retireLines.some((t: string) => /retired (after disengaging|at respawn)/.test(t)), retireLines.join(' | '));

  // A attacks Kreth; B defends Kreth.
  await A.rpc('war.order', { order: { kind: 'attack', target: 'kreth' } });
  await B.rpc('war.order', { order: { kind: 'defend' } });
  await advance(11_000);
  const aId = `h:${A.player.character.id}`;
  const bId = `h:${B.player.character.id}`;
  await A.waitFor(() => A.war?.active?.combatants.find((c: any) => c.id === aId)?.loc === 'kreth', 8000, 'A arrives at Kreth');
  const npc = A.war.active.combatants.find((c: any) => c.faction === 'kreth' && c.isBot && c.alive && c.loc === 'kreth');
  assert.ok(npc, 'a Kreth NPC defender is present');
  await A.rpc('dev.war.setHp', { combatantId: npc.id, hp: 1 });
  await A.waitFor(() => A.war?.active?.combatants.find((c: any) => c.id === aId)?.kills >= 1, 20000, 'A kills the NPC');
  await A.rpc('dev.war.setHp', { combatantId: bId, hp: 1 });
  await A.waitFor(() => A.war?.active?.combatants.find((c: any) => c.id === aId)?.kills >= 2, 20000, 'A kills B');

  const feed = A.war.active.feed.map((f: any) => f.text);
  assert.ok(feed.some((t: string) => /^Solenne \[Aurex\] eliminated NPC .*\(NPC\)/.test(t)), 'kill feed shows NPC kill');
  assert.ok(feed.some((t: string) => /^Solenne \[Aurex\] eliminated Tarrok \[Kreth\] \(PILOT\)/.test(t)), 'kill feed shows human kill');
  const liveKills = await A.rpc('rank.get', { board: 'kills', scope: 'current', faction: 'all' });
  assert.equal(liveKills.me.value, 1, 'exactly one competitive kill');
  const liveNpc = await A.rpc('rank.get', { board: 'npcKills', scope: 'current', faction: 'all' });
  assert.equal(liveNpc.me.value, 1, 'one NPC kill tracked separately');
});

test('Android lifecycle: a disconnected player’s order keeps running; reconnect restores authoritative state', T, async () => {
  await C.rpc('war.join', { order: { kind: 'attack', target: 'aurex' } });
  const cId = `h:${C.player.character.id}`;
  C.disconnect(); // phone locked
  await advance(12_000);
  await sleep(1500);
  C.war = null;
  await C.connect(); // phone unlocked
  const w = await C.waitFor(() => C.war?.active, 5000, 'war state after reconnect');
  const me = w.combatants.find((c: any) => c.id === cId);
  assert.deepEqual(me.order, { kind: 'attack', target: 'aurex' }, 'order unchanged');
  assert.ok(me.loc === 'aurex' || !me.alive, 'travelled to the target while disconnected');
});

test('Chip Wars: results, awards, rewards and Most Kills leaderboard agree on every client', T, async () => {
  const a0 = (await A.me()).character.gold;
  await A.rpc('dev.war.endNow');
  const resA = await A.waitFor(() => A.events.warResult?.find((r: any) => r.warId === warId), 10000, 'result A');
  const resB = await B.waitFor(() => B.events.warResult?.find((r: any) => r.warId === warId), 10000, 'result B');
  assert.equal(resA.winner, resB.winner, 'both clients show the same winner');
  assert.equal(resA.winner, 'aurex', resA.reason);
  const sol = resA.players.find((p: any) => p.name === 'Solenne');
  assert.equal(sol.killsHuman, 1);
  assert.equal(sol.killsNpc, 1);
  assert.equal(resA.awards.topKiller.name, 'Solenne');
  assert.ok(resA.awards.mvp, 'War MVP announced');
  assert.ok('competitiveKills' in sol.mvpBreakdown);
  assert.ok(resA.players.every((p: any) => !p.name.startsWith('NPC')), 'bots excluded from human results');

  await sleep(500);
  const a1 = (await A.me()).character.gold;
  assert.equal(a1, a0 + resA.rewards[A.player.character.id].gold, 'war reward paid exactly once');

  for (const scope of ['current', 'weekly', 'alltime']) {
    const ra = await A.rpc('rank.get', { board: 'kills', scope, faction: 'all' });
    const rb = await B.rpc('rank.get', { board: 'kills', scope, faction: 'all' });
    assert.deepEqual(ra.rows, rb.rows, `${scope}: same standings on both clients`);
    assert.equal(ra.rows[0].name, 'Solenne');
    assert.equal(ra.rows[0].value, 1);
    assert.equal(ra.me.rank, 1);
    assert.ok(ra.rows.every((r: any) => !r.name.startsWith('NPC')));
  }
  const kreth = await A.rpc('rank.get', { board: 'kills', scope: 'weekly', faction: 'kreth' });
  assert.ok(!kreth.rows.some((r: any) => r.name === 'Solenne'), 'faction filter');

  // Winners get temporary access to the bonus mining zone.
  await A.rpc('idle.set', { activity: 'mine', zone: 'victors_lode', claimId: claimId() });
  assert.match(await B.rpcErr('idle.set', { activity: 'mine', zone: 'victors_lode', claimId: claimId() }), /no access/);
});

test('Persistence: restart (hard kill) keeps everything; an interrupted claim never pays twice', { ...T, skip: !srv.canRestart && 'needs a local server process to kill' }, async () => {
  const snapA = await A.me();
  const snapB = await B.me();
  const snapC = await C.me();
  const hist = await A.rpc('market.history', { scope: 'all' });
  const ranks = await A.rpc('rank.get', { board: 'kills', scope: 'alltime', faction: 'all' });
  const result = await A.rpc('war.result', { warId });
  await advance(5 * 60_000); // accrue idle rewards
  // A war and a dungeon run in flight across the restart.
  const run = await D.rpc('dungeon.start', { dungeonId: 'training' });
  const war2 = (await A.rpc('dev.testWar', { seconds: 120 })).warId;
  await A.rpc('war.join', {});
  await sleep(2500);
  const tickBefore = A.war.active.tick;

  const g0 = (await A.me()).character.gold;
  const pending = (await A.me()).idle.pending;
  const X = claimId('interrupted');
  A.fire('idle.claim', { claimId: X });
  await srv.stop('SIGKILL'); // crash mid-claim
  await srv.start();
  for (const c of [A, B, C, D]) c.player = null;
  await Promise.all([A, B, C, D].map((c) => c.waitFor(() => c.player, 15000, 'reconnect')));

  const b = await B.me();
  assert.equal(b.character.gold, snapB.character.gold);
  assert.deepEqual(b.inventory, snapB.inventory);
  const c = await C.me();
  assert.deepEqual(c.inventory, snapC.inventory);
  assert.deepEqual((await A.rpc('market.history', { scope: 'all' })).slice(0, hist.length), hist, 'trade history kept');
  assert.deepEqual((await A.rpc('rank.get', { board: 'kills', scope: 'alltime', faction: 'all' })).rows, ranks.rows, 'rankings kept');
  assert.deepEqual(await A.rpc('war.result', { warId }), result, 'war result kept');
  const a = await A.me();
  assert.deepEqual(a.dungeons.list, snapA.dungeons.list, 'dungeon clears kept');
  assert.equal(a.character.weaponId, snapA.character.weaponId);
  assert.ok(a.character.gold === g0 || a.character.gold === g0 + pending.gold, 'claim either committed fully or not at all');

  const r1 = await A.rpc('idle.claim', { claimId: X });
  const gAfter = (await A.me()).character.gold;
  assert.equal(gAfter, g0 + r1.gold, 'paid exactly once');
  const r2 = await A.rpc('idle.claim', { claimId: X });
  assert.equal(r2.duplicate, true);
  assert.equal((await A.me()).character.gold, gAfter, 'retry does not pay again');

  // In-flight war resumed; in-flight dungeon run resumed and paid once.
  const w = await A.waitFor(() => A.war?.active?.id === war2 && A.war.active, 8000, 'war resumed');
  assert.ok(w.tick >= tickBefore);
  await advance(3 * 60_000);
  const dr = await D.waitFor(() => D.dungeon?.runId === run.runId && D.dungeon.finalized && D.dungeon, 15000, 'dungeon after restart');
  assert.equal(dr.state.status, 'victory');

  // Nobody defeated a human in this war: Top Killer stays unawarded.
  const res2 = await A.waitFor(() => A.events.warResult?.find((r: any) => r.warId === war2), 10000, 'war 2 result');
  assert.equal(res2.awards.topKiller, null);
});
