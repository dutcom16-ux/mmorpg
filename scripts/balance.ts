// Prints dungeon win rates per role/level so balance changes can be checked quickly.
// Run: npx tsx scripts/balance.ts
import { DUNGEON_IDS, ROLE_IDS, ROLES, STARTER_ARMOR, STARTER_WEAPON, characterStats, type RoleId } from '../shared/content';
import { DungeonSim } from '../shared/dungeonSim';

function run(role: RoleId, level: number, upg: number, useAbility: boolean, dungeon: (typeof DUNGEON_IDS)[number]) {
  const stats = characterStats(role, level, 0, { templateId: STARTER_WEAPON[role], upgrade: upg }, { templateId: STARTER_ARMOR, upgrade: upg });
  let wins = 0;
  let ticks = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    const sim = new DungeonSim({ seed: seed * 7919, dungeonId: dungeon, role, stats, abilityTicks: [] });
    while (sim.state.status === 'active') {
      const t = sim.state.tick + 1;
      if (useAbility && sim.canUseAbilityAt(t)) {
        const wantHeal = role !== 'engineer' || sim.state.hp < sim.state.maxHp * 0.6;
        if (wantHeal) sim.addAbilityTick(t);
      }
      sim.advanceTo(t);
    }
    if (sim.state.status === 'victory') wins++;
    ticks += sim.state.endTick ?? 0;
  }
  return { win: Math.round((wins / N) * 100), avg: Math.round(ticks / N) };
}

for (const d of DUNGEON_IDS) {
  console.log(`\n== ${d}`);
  for (const role of ROLE_IDS) {
    const row: string[] = [];
    for (const level of [1, 2, 3, 4, 5, 6, 8]) {
      const upg = level >= 5 ? 2 : level >= 3 ? 1 : 0;
      const a = run(role, level, upg, false, d);
      const b = run(role, level, upg, true, d);
      row.push(`L${level}+${upg}: ${a.win}%/${b.win}% ${a.avg}s`);
    }
    console.log(ROLES[role].name.padEnd(9), row.join(' | '));
  }
}
