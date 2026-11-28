// Deterministic dungeon combat. The server replays this from (seed, stats, ability ticks),
// so a run survives reconnects, device switches and server restarts with identical results.
import { DUNGEONS, ROLES, mitigate, type DungeonId, type RoleId } from './content';
import { mulberry32 } from './rng';

export interface DungeonSimInput {
  seed: number;
  dungeonId: DungeonId;
  role: RoleId;
  stats: { hp: number; atk: number; def: number };
  abilityTicks: number[];
}

export interface SimEnemy {
  name: string;
  hp: number;
  maxHp: number;
  boss: boolean;
}

export interface DungeonSimState {
  tick: number;
  status: 'active' | 'victory' | 'defeat';
  endTick: number | null;
  defeatReason: string | null;
  hp: number;
  maxHp: number;
  wave: number; // 0-based index of current wave
  waveCount: number;
  enemies: SimEnemy[];
  abilityReadyTick: number;
  guardUntil: number;
  log: string[];
  kills: number;
  damageDealt: number;
  damageTaken: number;
  abilityUses: number;
}

const LOG_KEEP = 8;

export class DungeonSim {
  readonly input: DungeonSimInput;
  readonly state: DungeonSimState;
  private rng: () => number;
  private abilitySet: Set<number>;

  constructor(input: DungeonSimInput) {
    this.input = input;
    this.rng = mulberry32(input.seed);
    this.abilitySet = new Set(input.abilityTicks);
    const def = DUNGEONS[input.dungeonId];
    this.state = {
      tick: 0,
      status: 'active',
      endTick: null,
      defeatReason: null,
      hp: input.stats.hp,
      maxHp: input.stats.hp,
      wave: 0,
      waveCount: def.waves.length,
      enemies: def.waves[0].map((e) => ({ name: e.name, hp: e.hp, maxHp: e.hp, boss: !!e.boss })),
      abilityReadyTick: 1,
      guardUntil: 0,
      log: [`Entered ${def.name}.`],
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
      abilityUses: 0,
    };
  }

  addAbilityTick(t: number) {
    this.abilitySet.add(t);
    this.input.abilityTicks.push(t);
  }

  canUseAbilityAt(t: number): boolean {
    return this.state.status === 'active' && t >= this.state.abilityReadyTick && !this.abilitySet.has(t);
  }

  private push(msg: string) {
    const log = this.state.log;
    log.push(msg);
    if (log.length > LOG_KEEP) log.splice(0, log.length - LOG_KEEP);
  }

  /** Advance until `tick` (inclusive) or the run ends. */
  advanceTo(tick: number) {
    while (this.state.status === 'active' && this.state.tick < tick) this.step();
  }

  private step() {
    const s = this.state;
    const def = DUNGEONS[this.input.dungeonId];
    const role = ROLES[this.input.role];
    const { atk, def: pdef } = this.input.stats;
    const t = ++s.tick;

    let mult = 1;
    if (this.abilitySet.has(t) && t >= s.abilityReadyTick) {
      s.abilityReadyTick = t + role.ability.dungeonCooldownTicks;
      s.abilityUses++;
      if (this.input.role === 'assault') {
        mult = 3;
        this.push(`${role.ability.name}!`);
      } else if (this.input.role === 'guardian') {
        s.guardUntil = t + 4;
        this.push(`${role.ability.name} raised.`);
      } else {
        const heal = Math.min(s.maxHp - s.hp, Math.round(s.maxHp * 0.35));
        s.hp += heal;
        this.push(`${role.ability.name} restored ${heal} HP.`);
      }
    }

    // Player auto-attack on the first living enemy.
    const target = s.enemies.find((e) => e.hp > 0);
    if (target) {
      const dmg = Math.min(target.hp, mitigate(atk, enemyDef(def.waves[s.wave], target.name), this.rng()) * mult);
      target.hp -= dmg;
      s.damageDealt += dmg;
      if (this.input.role === 'assault') s.hp = Math.min(s.maxHp, s.hp + Math.round(dmg * 0.15));
      if (target.hp <= 0) {
        s.kills++;
        this.push(`${target.name} destroyed.`);
      }
    }
    if (this.input.role === 'engineer' && s.hp < s.maxHp) {
      s.hp = Math.min(s.maxHp, s.hp + Math.round(s.maxHp * 0.015));
    }

    // Enemies strike back.
    const guarded = t <= s.guardUntil;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const src = def.waves[s.wave].find((x) => x.name === e.name)!;
      let dmg = mitigate(src.atk, pdef, this.rng());
      if (this.input.role === 'guardian') dmg = Math.max(1, Math.round(dmg * 0.85));
      if (guarded) {
        const reflect = Math.round(dmg * 0.3);
        dmg = Math.round(dmg * 0.5);
        const r = Math.min(e.hp, reflect);
        e.hp -= r;
        s.damageDealt += r;
        if (e.hp <= 0) {
          s.kills++;
          this.push(`${e.name} destroyed by reflected fire.`);
        }
      }
      s.hp -= dmg;
      s.damageTaken += dmg;
    }

    if (s.hp <= 0) {
      s.hp = 0;
      s.status = 'defeat';
      s.endTick = t;
      s.defeatReason = 'Your frame was disabled.';
      this.push('Defeated. You can retry — your daily clear is still available.');
      return;
    }

    if (s.enemies.every((e) => e.hp <= 0)) {
      if (s.wave + 1 >= def.waves.length) {
        s.status = 'victory';
        s.endTick = t;
        this.push(`${def.bossName} is down. Victory!`);
        return;
      }
      s.wave++;
      const regen = Math.round(s.maxHp * 0.25);
      s.hp = Math.min(s.maxHp, s.hp + regen);
      s.enemies = def.waves[s.wave].map((e) => ({ name: e.name, hp: e.hp, maxHp: e.hp, boss: !!e.boss }));
      const boss = s.enemies.find((e) => e.boss);
      this.push(boss ? `Boss incoming: ${boss.name}! (+${regen} HP)` : `Wave ${s.wave + 1} incoming. (+${regen} HP)`);
    }

    if (t >= def.maxTicks && s.status === 'active') {
      s.status = 'defeat';
      s.endTick = t;
      s.defeatReason = 'Time ran out.';
      this.push('Time ran out. You can retry.');
    }
  }
}

function enemyDef(wave: { name: string; def: number }[], name: string): number {
  return wave.find((w) => w.name === name)?.def ?? 0;
}
