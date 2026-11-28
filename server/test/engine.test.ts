// Rule-level tests for the Chip War engine: tie-breaks, kill credit, assists,
// diminishing MVP credit and safe NPC retirement.
// Run: npm run test:engine
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repeatKillCredit } from '../../shared/content';
import { WarEngine, mvpOf, type HumanEntry } from '../src/war/engine';

const stats = { hp: 300, atk: 40, def: 10 };
const human = (charId: number, faction: any, role: any, name = `P${charId}`): HumanEntry => ({ charId, name, faction, role, level: 6, stats });

function engine(humans: HumanEntry[], target = 0, chipHp = 5000, durationTicks = 200) {
  return WarEngine.create({ id: 1, kind: 'test', startsAt: 0, durationTicks, chipHp, target, seed: 42, humans });
}
const kill = (e: WarEngine, killer: string, victim: string) => (e as any).kill(e.get(killer), e.get(victim), e.s.tick);

test('same-tick chip destruction: tie broken by total chip damage', () => {
  const e = engine([human(1, 'aurex', 'assault'), human(2, 'vessari', 'assault'), human(3, 'kreth', 'assault')]);
  e.setOrder('h:1', { kind: 'attack', target: 'kreth' });
  e.setOrder('h:2', { kind: 'attack', target: 'aurex' });
  e.setOrder('h:3', { kind: 'attack', target: 'vessari' });
  for (let i = 0; i < 5; i++) e.tick();
  e.s.chips.kreth.hp = 1;
  e.s.chips.aurex.hp = 1;
  e.s.chipDmgTotal.aurex = 900;
  e.s.chipDmgTotal.vessari = 400;
  while (!e.s.ended) e.tick();
  assert.equal(e.s.winner, 'aurex');
  assert.match(e.s.reason!, /same tick/);
});

test('same-tick chip destruction with equal chip damage is a draw', () => {
  const e = engine([human(1, 'aurex', 'assault'), human(2, 'vessari', 'assault')]);
  e.setOrder('h:1', { kind: 'attack', target: 'kreth' });
  e.setOrder('h:2', { kind: 'attack', target: 'aurex' });
  for (let i = 0; i < 5; i++) e.tick();
  e.s.chips.kreth.hp = 1;
  e.s.chips.aurex.hp = 1;
  // Each side will add exactly 1 credited damage this tick (capped by the chip's remaining HP).
  e.s.chipDmgTotal.aurex = 500;
  e.s.chipDmgTotal.vessari = 500;
  while (!e.s.ended) e.tick();
  assert.equal(e.s.winner, null);
  assert.match(e.s.reason!, /Draw/);
});

test('time expiry: most objective damage wins; equal totals draw', () => {
  const e = engine([], 0, 5000, 5);
  e.s.chipDmgTotal.vessari = 10;
  while (!e.s.ended) e.tick();
  assert.equal(e.s.winner, 'vessari');
  const d = engine([], 0, 5000, 5);
  while (!d.s.ended) d.tick();
  assert.equal(d.s.winner, null);
});

test('one killer per elimination; NPC and human kills tracked separately; assists for teammates', () => {
  const e = engine([human(1, 'aurex', 'assault', 'Ace'), human(2, 'aurex', 'engineer', 'Medic'), human(3, 'kreth', 'guardian', 'Wall')], 2);
  const npc = e.s.combatants.find((c) => c.isBot && c.faction === 'kreth')!;
  e.get('h:3')!.dmgFrom['h:2'] = e.s.tick; // Medic damaged the victim
  kill(e, 'h:1', 'h:3');
  kill(e, 'h:1', npc.id);
  const ace = e.get('h:1')!.s;
  assert.equal(ace.killsHuman, 1);
  assert.equal(ace.killsNpc, 1);
  assert.equal(e.get('h:2')!.s.assists, 1, 'teammate who damaged the victim gets an assist');
  assert.equal(e.get('h:2')!.s.killsHuman, 0, 'only one killer');
  assert.equal(e.get('h:3')!.s.deaths, 1);
});

test('diminishing MVP credit for repeatedly eliminating the same opponent', () => {
  const e = engine([human(1, 'aurex', 'assault'), human(3, 'kreth', 'guardian'), human(4, 'kreth', 'assault')]);
  for (let i = 0; i < 4; i++) kill(e, 'h:1', 'h:3');
  kill(e, 'h:1', 'h:4');
  const s = e.get('h:1')!.s;
  assert.equal(s.killsHuman, 5, 'Most Kills counts every kill');
  const expected = repeatKillCredit(1) + repeatKillCredit(2) + repeatKillCredit(3) + repeatKillCredit(4) + 1;
  assert.equal(s.kStar, expected);
  assert.equal(mvpOf(s).breakdown.competitiveKills, Math.round(10 * expected * 10) / 10);
});

test('engineer healing counts only HP actually restored', () => {
  const e = engine([human(1, 'aurex', 'engineer'), human(2, 'aurex', 'guardian')]);
  e.setOrder('h:1', { kind: 'defend' });
  const g = e.get('h:2')!;
  g.hp = g.maxHp - 5;
  e.tick();
  assert.equal(e.get('h:1')!.s.healing, 5);
});

test('late human entrant: an NPC retires only once it is not engaged', () => {
  const e = engine([human(1, 'aurex', 'assault')], 6);
  assert.equal(e.count('aurex', true), 5);
  for (const b of e.s.combatants.filter((c) => c.isBot && c.faction === 'aurex')) b.lastEngagedTick = 1e9; // all mid-duel
  e.addHuman(human(2, 'aurex', 'guardian'));
  const retiring = e.s.combatants.find((c) => c.retiring)!;
  assert.ok(retiring);
  e.tick();
  assert.ok(e.get(retiring.id), 'not removed halfway through a duel');
  retiring.lastEngagedTick = e.s.tick - 10;
  e.tick();
  assert.equal(e.get(retiring.id), undefined, 'removed after disengaging');
  assert.equal(e.count('aurex', true), 4);
  for (let i = 3; i < 12; i++) e.addHuman(human(i, 'aurex', 'assault'));
  for (const b of e.s.combatants) b.lastEngagedTick = -100;
  e.tick();
  assert.equal(e.count('aurex', false), 11, 'more than six humans can all participate');
  assert.equal(e.count('aurex', true), 0);
});

test('state is JSON-serializable and resumes identically', () => {
  const a = engine([human(1, 'aurex', 'assault'), human(2, 'kreth', 'guardian')], 6);
  for (let i = 0; i < 30; i++) a.tick();
  const b = new WarEngine(JSON.parse(JSON.stringify(a.s)));
  for (let i = 0; i < 30; i++) {
    a.tick();
    b.tick();
  }
  assert.deepEqual(a.s, b.s);
});
