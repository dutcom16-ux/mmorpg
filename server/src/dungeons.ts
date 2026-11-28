// Daily solo dungeons. A run belongs to the daily period in which it STARTED.
// Victory, reward and the daily clear are written in one transaction, guarded by the
// (character, dungeon, period) primary key, so nothing can pay twice.
import {
  ARMORS,
  DUNGEONS,
  DUNGEON_IDS,
  ROLES,
  ROLE_WEAPONS,
  WAR,
  goldMinePayout,
  trainingExpReward,
  type DungeonId,
  type RoleId,
} from '../../shared/content';
import { DungeonSim } from '../../shared/dungeonSim';
import type { DungeonReward, DungeonRunView, DungeonStatus } from '../../shared/protocol';
import { hashString, mulberry32 } from '../../shared/rng';
import { dailyPeriod } from '../../shared/time';
import { addGear, addGold, addStack, charStats, getChar, grantExp } from './characters';
import { clock } from './clock';
import { all, fail, get, run, tx } from './db';

const TICK_MS = WAR.tickMs;

interface RunRow {
  id: number;
  character_id: number;
  dungeon_id: DungeonId;
  period_key: string;
  started_at: number;
  seed: number;
  stats_json: string;
  level_at_start: number;
  ability_ticks: string;
  status: 'active' | 'victory' | 'defeat';
  ended_at: number | null;
  result_json: string | null;
  seen: number;
}

const sims = new Map<number, { sim: DungeonSim; role: RoleId }>();

function simFor(r: RunRow): DungeonSim {
  let s = sims.get(r.id);
  if (!s) {
    const c = getChar(r.character_id);
    const sim = new DungeonSim({
      seed: r.seed,
      dungeonId: r.dungeon_id,
      role: c.role,
      stats: JSON.parse(r.stats_json),
      abilityTicks: JSON.parse(r.ability_ticks),
    });
    s = { sim, role: c.role };
    sims.set(r.id, s);
  }
  return s.sim;
}

function currentTick(r: RunRow, now = clock.now()): number {
  return Math.max(0, Math.floor((now - r.started_at) / TICK_MS));
}

export function dungeonStatuses(charId: number): { periodKey: string; nextResetAt: number; list: DungeonStatus[]; activeRunId: number | null; unseenRunId: number | null } {
  const c = getChar(charId);
  const period = dailyPeriod(clock.now());
  const clears = new Set(
    all<{ dungeon_id: string }>('SELECT dungeon_id FROM dungeon_clears WHERE character_id = ? AND period_key = ?', charId, period.key).map(
      (r) => r.dungeon_id,
    ),
  );
  const active = get<{ id: number }>("SELECT id FROM dungeon_runs WHERE character_id = ? AND status = 'active'", charId);
  const unseen = get<{ id: number }>(
    "SELECT id FROM dungeon_runs WHERE character_id = ? AND status != 'active' AND seen = 0 ORDER BY id DESC LIMIT 1",
    charId,
  );
  return {
    periodKey: period.key,
    nextResetAt: period.next,
    activeRunId: active?.id ?? null,
    unseenRunId: unseen?.id ?? null,
    list: DUNGEON_IDS.map((id) => {
      const unlocked = c.level >= DUNGEONS[id].unlockLevel;
      const cleared = clears.has(id);
      return {
        id,
        unlocked,
        cleared,
        available: unlocked && !cleared,
        payout: id === 'goldmine' ? goldMinePayout(c.level) : null,
      };
    }),
  };
}

export function startRun(charId: number, dungeonId: DungeonId): number {
  const def = DUNGEONS[dungeonId];
  if (!def) fail('Unknown dungeon.');
  return tx(() => {
    const c = getChar(charId);
    if (c.level < def.unlockLevel) fail(`${def.name} unlocks at level ${def.unlockLevel}.`);
    const now = clock.now();
    const period = dailyPeriod(now);
    if (get('SELECT 1 FROM dungeon_clears WHERE character_id = ? AND dungeon_id = ? AND period_key = ?', charId, dungeonId, period.key)) {
      fail(`${def.name} is already cleared today. It reopens at the 6:00 AM (Asia/Manila) reset.`);
    }
    if (get("SELECT 1 FROM dungeon_runs WHERE character_id = ? AND status = 'active'", charId)) fail('You already have a dungeon run in progress.');
    const stats = charStats(c);
    const seed = hashString(`${charId}:${dungeonId}:${now}:${Math.random()}`);
    const id = run(
      `INSERT INTO dungeon_runs(character_id, dungeon_id, period_key, started_at, seed, stats_json, level_at_start, status)
       VALUES(?,?,?,?,?,?,?, 'active')`,
      charId,
      dungeonId,
      period.key,
      now,
      seed,
      JSON.stringify({ hp: stats.hp, atk: stats.atk, def: stats.def }),
      c.level,
    ).id;
    return id;
  });
}

function getRun(runId: number): RunRow {
  const r = get<RunRow>('SELECT * FROM dungeon_runs WHERE id = ?', runId);
  if (!r) fail('Run not found.');
  return r;
}

export function useAbility(charId: number, runId: number) {
  const r = getRun(runId);
  if (r.character_id !== charId) fail('Not your run.');
  if (r.status !== 'active') fail('That run is over.');
  const sim = simFor(r);
  const now = clock.now();
  sim.advanceTo(currentTick(r, now));
  const t = sim.state.tick + 1;
  if (!sim.canUseAbilityAt(t)) fail(`${ROLES[getChar(charId).role].ability.name} is on cooldown.`);
  sim.addAbilityTick(t);
  run('UPDATE dungeon_runs SET ability_ticks = ? WHERE id = ?', JSON.stringify(sim.input.abilityTicks), runId);
  return { tick: t };
}

export function retreat(charId: number, runId: number) {
  const r = getRun(runId);
  if (r.character_id !== charId) fail('Not your run.');
  if (r.status !== 'active') fail('That run is over.');
  const sim = simFor(r);
  sim.advanceTo(currentTick(r));
  if (sim.state.status !== 'active') return finalize(r.id);
  return tx(() => {
    const ch = run(
      "UPDATE dungeon_runs SET status = 'defeat', ended_at = ?, result_json = ? WHERE id = ? AND status = 'active'",
      clock.now(),
      JSON.stringify({ retreated: true, tick: sim.state.tick, reward: null }),
      runId,
    );
    if (ch.changes !== 1) fail('That run is over.');
    sim.state.status = 'defeat';
    sim.state.endTick = sim.state.tick;
    sim.state.defeatReason = 'You retreated.';
    sim.state.log.push('You retreated. Your daily clear is still available.');
    return runView(runId);
  });
}

function rollReward(r: RunRow): Omit<DungeonReward, 'rewarded' | 'gearItemId' | 'levelUps'> {
  const c = getChar(r.character_id);
  const rng = mulberry32(hashString(`reward:${r.seed}`));
  const def = DUNGEONS[r.dungeon_id];
  const items: Array<{ templateId: string; qty: number }> = [];
  let exp = 40 * def.recLevel;
  let gold = 0;
  let gearTemplateId: string | null = null;
  switch (r.dungeon_id) {
    case 'training':
      exp += trainingExpReward(r.level_at_start);
      items.push({ templateId: 'm_scrap', qty: 2 + Math.floor(rng() * 3) });
      if (rng() < 0.5) items.push({ templateId: 'm_circuit', qty: 1 });
      break;
    case 'foundry':
      gearTemplateId = rng() < 0.3 ? ROLE_WEAPONS[c.role].epic : ROLE_WEAPONS[c.role].rare;
      items.push({ templateId: 'm_forge_core', qty: 1 }, { templateId: 'm_scrap', qty: 2 });
      break;
    case 'vault':
      gearTemplateId = rng() < 0.3 ? ARMORS.epic : ARMORS.rare;
      items.push({ templateId: 'm_circuit', qty: 1 }, { templateId: 'm_scrap', qty: 2 });
      break;
    case 'goldmine':
      gold = goldMinePayout(r.level_at_start);
      items.push({ templateId: 'o_lumen', qty: 6 }, { templateId: 'o_cobaltine', qty: 2 });
      break;
  }
  return { periodKey: r.period_key, exp, gold, items, gearTemplateId };
}

/** Finalizes a finished run exactly once. Safe to call repeatedly. */
function finalize(runId: number): DungeonRunView {
  return tx(() => {
    const r = getRun(runId);
    if (r.status !== 'active') return runView(runId);
    const sim = simFor(r);
    if (sim.state.status === 'active') return runView(runId);
    const endedAt = r.started_at + (sim.state.endTick ?? sim.state.tick) * TICK_MS;
    let reward: DungeonReward | null = null;
    if (sim.state.status === 'victory') {
      const base = rollReward(r);
      const clear = run(
        'INSERT OR IGNORE INTO dungeon_clears(character_id, dungeon_id, period_key, run_id, created_at) VALUES(?,?,?,?,?)',
        r.character_id,
        r.dungeon_id,
        r.period_key,
        r.id,
        clock.now(),
      );
      if (clear.changes === 1) {
        addGold(r.character_id, base.gold);
        for (const it of base.items) addStack(r.character_id, it.templateId, it.qty);
        const gearItemId = base.gearTemplateId ? addGear(r.character_id, base.gearTemplateId) : null;
        const levelUps = grantExp(r.character_id, base.exp);
        reward = { ...base, rewarded: true, gearItemId, levelUps };
      } else {
        reward = { ...base, rewarded: false, exp: 0, gold: 0, items: [], gearItemId: null, gearTemplateId: null, levelUps: 0 };
      }
    }
    const ch = run(
      "UPDATE dungeon_runs SET status = ?, ended_at = ?, result_json = ? WHERE id = ? AND status = 'active'",
      sim.state.status,
      endedAt,
      JSON.stringify({ reward, tick: sim.state.endTick }),
      r.id,
    );
    if (ch.changes !== 1) throw new Error('run finalize race');
    return runView(runId);
  });
}

export function runView(runId: number): DungeonRunView {
  const r = getRun(runId);
  const sim = simFor(r);
  if (r.status === 'active') sim.advanceTo(currentTick(r));
  else {
    const res = r.result_json ? JSON.parse(r.result_json) : {};
    if (sim.state.status === 'active') {
      // Replay to the recorded end (e.g. after a server restart or a retreat).
      sim.advanceTo(res.tick ?? Number.MAX_SAFE_INTEGER);
      if (sim.state.status === 'active' && res.retreated) {
        sim.state.status = 'defeat';
        sim.state.endTick = sim.state.tick;
        sim.state.defeatReason = 'You retreated.';
      }
    }
  }
  const res = r.result_json ? JSON.parse(r.result_json) : null;
  return {
    runId: r.id,
    dungeonId: r.dungeon_id,
    periodKey: r.period_key,
    startedAt: r.started_at,
    tickMs: TICK_MS,
    state: sim.state,
    finalized: r.status !== 'active',
    reward: res?.reward ?? null,
    role: getChar(r.character_id).role,
  };
}

export function ackRun(charId: number, runId: number) {
  run('UPDATE dungeon_runs SET seen = 1 WHERE id = ? AND character_id = ? AND status != ?', runId, charId, 'active');
}

/** Called every server tick. Advances active runs and finalizes finished ones. */
export function tickDungeons(onUpdate: (charId: number, view: DungeonRunView) => void) {
  const active = all<RunRow>("SELECT * FROM dungeon_runs WHERE status = 'active'");
  for (const r of active) {
    const sim = simFor(r);
    const before = sim.state.tick;
    sim.advanceTo(currentTick(r));
    if (sim.state.status !== 'active') {
      onUpdate(r.character_id, finalize(r.id));
    } else if (sim.state.tick !== before) {
      onUpdate(r.character_id, runView(r.id));
    }
  }
  // Drop cached sims of finished runs that are no longer needed.
  if (sims.size > 500) sims.clear();
}

export function lastRuns(charId: number, limit = 10) {
  return all('SELECT id, dungeon_id, period_key, status, started_at, ended_at FROM dungeon_runs WHERE character_id = ? ORDER BY id DESC LIMIT ?', charId, limit);
}
