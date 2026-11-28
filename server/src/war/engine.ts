// Chip War simulation. Pure and deterministic: all state lives in a JSON-serializable
// object (including the RNG state), so the server can snapshot it every tick and resume
// after a restart. Humans and NPC pilots use exactly the same rules.
import {
  ARMORS,
  FACTION_IDS,
  FACTIONS,
  MVP_WEIGHTS,
  NPC_CALLSIGNS,
  ROLES,
  ROLE_WEAPONS,
  WAR,
  characterStats,
  mitigate,
  repeatKillCredit,
  type FactionId,
  type OrderKind,
  type RoleId,
  type WarOrder,
} from '../../../shared/content';
import type { CombatantView, WarFeedEntry, WarPlayerStats, WarView } from '../../../shared/protocol';

export interface CStats {
  killsHuman: number;
  killsNpc: number;
  deaths: number;
  assists: number;
  streak: number;
  bestStreak: number;
  healing: number;
  damage: number;
  chipDamage: number;
  defense: number;
  kStar: number;
  repeat: Record<string, number>;
}

export interface Combatant {
  id: string;
  name: string;
  faction: FactionId;
  role: RoleId;
  isBot: boolean;
  charId: number | null;
  level: number;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  alive: boolean;
  respawnAt: number;
  loc: FactionId | null;
  from: FactionId | null;
  dest: FactionId | null;
  departTick: number;
  arriveTick: number;
  order: WarOrder;
  abilityReadyTick: number;
  overcharge: boolean;
  pendingAbility: boolean;
  focus?: string | null;
  retiring: boolean;
  lastEngagedTick: number;
  joinedTick: number;
  nextThinkTick: number;
  dmgFrom: Record<string, number>;
  healFrom: Record<string, number>;
  s: CStats;
}

export interface WarOptions {
  passiveBots?: boolean;
}

export interface WarState {
  id: number;
  kind: 'scheduled' | 'test';
  rng: number;
  tick: number;
  startsAt: number;
  tickMs: number;
  durationTicks: number;
  target: number;
  chips: Record<FactionId, { hp: number; maxHp: number; destroyed: boolean; milestone: number }>;
  chipDmgTotal: Record<FactionId, number>;
  chipLastHitTick: Record<FactionId, number>;
  combatants: Combatant[];
  bulwarks: Array<{ faction: FactionId; base: FactionId; caster: string; until: number }>;
  feed: WarFeedEntry[];
  botSerial: number;
  botLevel: number;
  options: WarOptions;
  ended: boolean;
  winner: FactionId | null;
  reason: string | null;
  endTick: number | null;
}

export interface HumanEntry {
  charId: number;
  name: string;
  faction: FactionId;
  role: RoleId;
  level: number;
  stats: { hp: number; atk: number; def: number };
}

function plural(n: number, w: string) {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

const BOT_ROLE_CYCLE: RoleId[] = ['guardian', 'assault', 'engineer', 'assault', 'guardian', 'engineer'];
const FEED_KEEP = 200;

function emptyStats(): CStats {
  return { killsHuman: 0, killsNpc: 0, deaths: 0, assists: 0, streak: 0, bestStreak: 0, healing: 0, damage: 0, chipDamage: 0, defense: 0, kStar: 0, repeat: {} };
}

function perFaction<T>(fn: (f: FactionId) => T): Record<FactionId, T> {
  return { aurex: fn('aurex'), vessari: fn('vessari'), kreth: fn('kreth') };
}

export function mvpOf(s: CStats): { mvp: number; breakdown: Record<string, number> } {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const breakdown = {
    competitiveKills: r1(MVP_WEIGHTS.competitiveKill * s.kStar),
    npcKills: r1(MVP_WEIGHTS.npcKill * s.killsNpc),
    assists: r1(MVP_WEIGHTS.assist * s.assists),
    damage: r1(s.damage / MVP_WEIGHTS.damagePer),
    chipDamage: r1(s.chipDamage / MVP_WEIGHTS.chipDamagePer),
    healing: r1(s.healing / MVP_WEIGHTS.healingPer),
    defense: r1(s.defense / MVP_WEIGHTS.defensePer),
  };
  const mvp = r1(Object.values(breakdown).reduce((a, b) => a + b, 0));
  return { mvp, breakdown };
}

export class WarEngine {
  s: WarState;

  constructor(state: WarState) {
    this.s = state;
  }

  static create(opts: {
    id: number;
    kind: 'scheduled' | 'test';
    startsAt: number;
    durationTicks: number;
    chipHp: number;
    target: number;
    seed: number;
    humans: HumanEntry[];
    options?: WarOptions;
  }): WarEngine {
    const levels = opts.humans.map((h) => h.level);
    const botLevel = Math.max(3, levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 5);
    const e = new WarEngine({
      id: opts.id,
      kind: opts.kind,
      rng: opts.seed >>> 0,
      tick: 0,
      startsAt: opts.startsAt,
      tickMs: WAR.tickMs,
      durationTicks: opts.durationTicks,
      target: opts.target,
      chips: perFaction(() => ({ hp: opts.chipHp, maxHp: opts.chipHp, destroyed: false, milestone: 100 })),
      chipDmgTotal: perFaction(() => 0),
      chipLastHitTick: perFaction(() => -100),
      combatants: [],
      bulwarks: [],
      feed: [],
      botSerial: 0,
      botLevel,
      options: opts.options ?? {},
      ended: false,
      winner: null,
      reason: null,
      endTick: null,
    });
    for (const h of opts.humans) e.addHumanRaw(h);
    for (const f of FACTION_IDS) {
      const humans = e.s.combatants.filter((c) => c.faction === f && !c.isBot).length;
      const need = Math.max(0, opts.target - humans);
      for (let i = 0; i < need; i++) e.addBot(f, BOT_ROLE_CYCLE[i % BOT_ROLE_CYCLE.length]);
    }
    for (const c of e.s.combatants) if (c.isBot) e.think(c);
    e.feed('info', `Chip War begins. ${FACTION_IDS.map((f) => `${FACTIONS[f].short}: ${plural(e.count(f, false), 'pilot')} and ${e.count(f, true)} NPC`).join('; ')}.`);
    return e;
  }

  // ------------------------------------------------------------------ helpers

  private rand(): number {
    this.s.rng = (this.s.rng + 0x6d2b79f5) >>> 0;
    let t = this.s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private feed(kind: WarFeedEntry['kind'], text: string) {
    this.s.feed.push({ tick: this.s.tick, kind, text });
    if (this.s.feed.length > FEED_KEEP) this.s.feed.splice(0, this.s.feed.length - FEED_KEEP);
  }

  count(f: FactionId, bots: boolean) {
    return this.s.combatants.filter((c) => c.faction === f && c.isBot === bots).length;
  }

  get(id: string): Combatant | undefined {
    return this.s.combatants.find((c) => c.id === id);
  }

  byChar(charId: number): Combatant | undefined {
    return this.s.combatants.find((c) => c.charId === charId);
  }

  private label(c: Combatant) {
    return `${c.name} [${FACTIONS[c.faction].short}]`;
  }

  private hostilesAt(base: FactionId, faction: FactionId) {
    return this.s.combatants.filter((c) => c.alive && c.loc === base && c.faction !== faction);
  }

  private alliesAt(base: FactionId, faction: FactionId) {
    return this.s.combatants.filter((c) => c.alive && c.loc === base && c.faction === faction);
  }

  private bulwarkFor(faction: FactionId, base: FactionId): Combatant | undefined {
    const b = this.s.bulwarks.find((x) => x.faction === faction && x.base === base && x.until >= this.s.tick);
    return b ? this.get(b.caster) : undefined;
  }

  private threatened(f: FactionId) {
    return this.hostilesAt(f, f).length > 0 || this.s.tick - this.s.chipLastHitTick[f] < 10;
  }

  private makeCombatant(p: {
    id: string;
    name: string;
    faction: FactionId;
    role: RoleId;
    isBot: boolean;
    charId: number | null;
    level: number;
    stats: { hp: number; atk: number; def: number };
  }): Combatant {
    const maxHp = p.stats.hp * WAR.hpMultiplier;
    return {
      ...p,
      maxHp,
      hp: maxHp,
      atk: p.stats.atk,
      def: p.stats.def,
      alive: true,
      respawnAt: 0,
      loc: p.faction,
      from: null,
      dest: null,
      departTick: 0,
      arriveTick: 0,
      order: { kind: 'defend' },
      abilityReadyTick: 0,
      overcharge: false,
      pendingAbility: false,
      retiring: false,
      lastEngagedTick: -100,
      joinedTick: this.s.tick,
      nextThinkTick: this.s.tick,
      dmgFrom: {},
      healFrom: {},
      s: emptyStats(),
    };
  }

  private addBot(f: FactionId, role: RoleId) {
    const n = ++this.s.botSerial;
    const call = NPC_CALLSIGNS[(n * 7 + FACTION_IDS.indexOf(f) * 5) % NPC_CALLSIGNS.length];
    const stats = characterStats(role, this.s.botLevel, 0, { templateId: ROLE_WEAPONS[role].common, upgrade: 1 }, { templateId: ARMORS.common, upgrade: 1 });
    const c = this.makeCombatant({
      id: `n:${f}:${n}`,
      name: `NPC ${call}-${String(n).padStart(2, '0')}`,
      faction: f,
      role,
      isBot: true,
      charId: null,
      level: this.s.botLevel,
      stats,
    });
    c.nextThinkTick = this.s.tick + (n % 3);
    this.s.combatants.push(c);
    return c;
  }

  private addHumanRaw(h: HumanEntry): Combatant {
    const c = this.makeCombatant({ id: `h:${h.charId}`, name: h.name, faction: h.faction, role: h.role, isBot: false, charId: h.charId, level: h.level, stats: h.stats });
    this.s.combatants.push(c);
    c.order = this.defaultOrder(c);
    return c;
  }

  private defaultOrder(c: Combatant): WarOrder {
    if (c.role === 'guardian') return { kind: 'defend' };
    if (c.role === 'assault') return { kind: 'attack', target: this.mostVulnerable(c.faction, null) };
    const buddy = this.s.combatants.find((x) => x.faction === c.faction && x.id !== c.id && x.role === 'assault');
    return buddy ? { kind: 'support', target: buddy.id } : { kind: 'defend' };
  }

  private mostVulnerable(f: FactionId, current: string | null | undefined): FactionId {
    let best: FactionId = FACTION_IDS.find((x) => x !== f)!;
    let bestScore = -1;
    for (const b of FACTION_IDS) {
      if (b === f) continue;
      const chip = this.s.chips[b];
      if (chip.destroyed) continue;
      const defenders = this.alliesAt(b, b).length;
      let score = 0.6 * (1 - chip.hp / chip.maxHp) + 1 / (1 + defenders) + this.rand() * 0.25;
      if (b === current) score += 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  // --------------------------------------------------------------- commands

  /** Admits a human immediately. If the faction is over target, one NPC is marked to retire safely. */
  addHuman(h: HumanEntry): Combatant {
    const existing = this.byChar(h.charId);
    if (existing) return existing;
    const c = this.addHumanRaw(h);
    this.feed('join', `${this.label(c)} joined the war as ${ROLES[c.role].name}.`);
    this.rebalance(h.faction, c.role);
    return c;
  }

  private rebalance(f: FactionId, preferRole: RoleId) {
    const humans = this.s.combatants.filter((c) => c.faction === f && !c.isBot).length;
    const bots = this.s.combatants.filter((c) => c.faction === f && c.isBot && !c.retiring);
    if (humans + bots.length <= this.s.target || bots.length === 0) return;
    const engaged = (c: Combatant) => this.s.tick - c.lastEngagedTick <= WAR.engagedWindowTicks;
    const pick =
      bots.find((b) => b.role === preferRole && !engaged(b)) ??
      bots.find((b) => !engaged(b)) ??
      bots.find((b) => b.role === preferRole) ??
      bots[0];
    pick.retiring = true;
    this.feed('retire', `${this.label(pick)} will stand down at its next safe moment (a pilot joined).`);
  }

  setOrder(id: string, order: WarOrder): Combatant {
    const c = this.get(id);
    if (!c) throw new Error('not in war');
    const kind: OrderKind = order.kind;
    if (kind === 'defend') c.order = { kind };
    else if (kind === 'attack') {
      const t = order.target as FactionId;
      if (!FACTION_IDS.includes(t) || t === c.faction) throw new Error('Pick an enemy base to attack.');
      if (this.s.chips[t].destroyed) throw new Error('That chip is already destroyed.');
      c.order = { kind, target: t };
    } else if (kind === 'support') {
      const ally = this.get(String(order.target));
      if (!ally || ally.faction !== c.faction || ally.id === c.id) throw new Error('Pick an ally to support.');
      c.order = { kind, target: ally.id };
    } else throw new Error('Unknown order.');
    return c;
  }

  /** Human players can pick which enemy to fight at their current base. */
  setFocus(id: string, targetId: string | null) {
    const c = this.get(id);
    if (!c) throw new Error('not in war');
    if (targetId) {
      const t = this.get(targetId);
      if (!t || t.faction === c.faction) throw new Error('Pick an enemy to focus.');
    }
    c.focus = targetId;
  }

  queueAbility(id: string) {
    const c = this.get(id);
    if (!c) throw new Error('not in war');
    if (!c.alive) throw new Error('You are respawning.');
    if (this.s.tick + 1 < c.abilityReadyTick) throw new Error(`${ROLES[c.role].ability.name} is on cooldown.`);
    if (c.role !== 'assault' && c.loc === null) throw new Error('Arrive at a base before using that ability.');
    c.pendingAbility = true;
  }

  /** Test helper (dev tools only). */
  devSetHp(id: string, hp: number) {
    const c = this.get(id);
    if (!c || !c.alive) throw new Error('No living combatant with that id.');
    c.hp = Math.max(1, Math.min(c.maxHp, Math.round(hp)));
  }

  // -------------------------------------------------------------------- tick

  tick() {
    const st = this.s;
    if (st.ended) return;
    const t = ++st.tick;

    // 1. Respawns and NPC retirement (only at respawn or after safely disengaging).
    for (const c of [...st.combatants]) {
      if (!c.alive && t >= c.respawnAt) {
        if (c.retiring) {
          this.retire(c, 'at respawn');
          continue;
        }
        c.alive = true;
        c.hp = c.maxHp;
        c.loc = c.faction;
        c.from = c.dest = null;
        c.dmgFrom = {};
        c.healFrom = {};
      }
    }
    for (const c of [...st.combatants]) {
      if (c.retiring && c.alive && t - c.lastEngagedTick > WAR.engagedWindowTicks) this.retire(c, 'after disengaging');
    }

    // 2. NPC decisions.
    for (const c of st.combatants) {
      if (c.isBot && c.alive && t >= c.nextThinkTick) {
        this.think(c);
        c.nextThinkTick = t + 3;
      }
    }

    // 3. Movement.
    for (const c of st.combatants) {
      if (!c.alive) continue;
      const desired = this.desiredLoc(c);
      if (c.loc === null) {
        if (desired !== c.dest) {
          if (desired === c.from) {
            const elapsed = t - c.departTick;
            c.from = c.dest;
            c.dest = desired;
            c.departTick = t;
            c.arriveTick = t + Math.max(1, elapsed);
          } else {
            c.dest = desired;
            c.departTick = t;
            c.arriveTick = t + WAR.travelTicks;
          }
        }
        if (t >= c.arriveTick) {
          c.loc = c.dest;
          c.from = null;
          c.dest = null;
        }
      } else if (desired !== c.loc) {
        c.from = c.loc;
        c.dest = desired;
        c.loc = null;
        c.departTick = t;
        c.arriveTick = t + WAR.travelTicks;
      }
    }

    // 4. Abilities.
    for (const c of st.combatants) {
      if (!c.alive) {
        c.pendingAbility = false;
        continue;
      }
      if (t < c.abilityReadyTick) {
        c.pendingAbility = false;
        continue;
      }
      let use = c.pendingAbility;
      if (c.isBot && !st.options.passiveBots) use = use || this.botWantsAbility(c);
      if (c.isBot && st.options.passiveBots) use = false;
      c.pendingAbility = false;
      if (!use) continue;
      this.applyAbility(c, t);
    }

    // 5. Intents (computed from the state at the start of combat).
    type Intent = { a: Combatant; kind: 'pilot'; target: Combatant; dmg: number; base: FactionId } | { a: Combatant; kind: 'chip'; chip: FactionId; dmg: number };
    const intents: Intent[] = [];
    for (const c of st.combatants) {
      if (!c.alive || c.loc === null) continue;
      if (c.isBot && st.options.passiveBots) continue;
      const base = c.loc;
      const hostiles = this.hostilesAt(base, c.faction);
      if (c.role === 'engineer') {
        const allies = this.alliesAt(base, c.faction).filter((x) => x.hp < x.maxHp);
        if (allies.length) {
          allies.sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp || (x.id < y.id ? -1 : 1));
          this.heal(c, allies[0], Math.round(c.atk * 0.35), t);
        }
      }
      const enemyBase = base !== c.faction && !st.chips[base].destroyed;
      let mult = 1;
      const useOver = () => {
        if (c.overcharge) {
          c.overcharge = false;
          mult = 3;
        }
      };
      const focused = !!(c.focus && hostiles.some((h) => h.id === c.focus));
      if (enemyBase && (hostiles.length === 0 || (!focused && c.role === 'assault' && this.rand() < 0.5))) {
        useOver();
        intents.push({ a: c, kind: 'chip', chip: base, dmg: Math.round(c.atk * (0.9 + this.rand() * 0.2) * mult) });
      } else if (hostiles.length) {
        hostiles.sort((x, y) => x.hp - y.hp || (x.id < y.id ? -1 : 1));
        const target = (c.focus && hostiles.find((h) => h.id === c.focus)) || hostiles[0];
        useOver();
        intents.push({ a: c, kind: 'pilot', target, dmg: mitigate(c.atk, target.def, this.rand()) * mult, base });
      }
    }

    // 6. Resolve hits in a seeded random order. One killing blow per victim.
    for (let i = intents.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [intents[i], intents[j]] = [intents[j], intents[i]];
    }
    const chipHits: Array<{ a: Combatant; chip: FactionId; dmg: number }> = [];
    for (const it of intents) {
      if (it.kind === 'chip') {
        let dmg = it.dmg;
        const bw = this.bulwarkFor(it.chip, it.chip);
        if (bw) {
          const prevented = dmg - Math.round(dmg * 0.5);
          dmg -= prevented;
          bw.s.defense += prevented;
        }
        chipHits.push({ a: it.a, chip: it.chip, dmg });
        continue;
      }
      const { a, target } = it;
      if (!target.alive || target.hp <= 0) continue;
      let dmg = it.dmg;
      const bw = this.bulwarkFor(target.faction, it.base);
      if (bw) {
        const prevented = dmg - Math.round(dmg * 0.5);
        dmg -= prevented;
        bw.s.defense += prevented;
      }
      const actual = Math.min(target.hp, dmg);
      target.hp -= actual;
      a.s.damage += actual;
      if (it.base === a.faction) a.s.defense += actual;
      target.dmgFrom[a.id] = t;
      a.lastEngagedTick = t;
      target.lastEngagedTick = t;
      if (target.hp <= 0) this.kill(a, target, t);
    }

    // 7. Chips take all of this tick's damage at once.
    const destroyed: Array<{ chip: FactionId; by: FactionId[] }> = [];
    for (const f of FACTION_IDS) {
      const chip = st.chips[f];
      if (chip.destroyed) continue;
      const hits = chipHits.filter((h) => h.chip === f);
      const total = hits.reduce((s, h) => s + h.dmg, 0);
      if (total <= 0) continue;
      const scale = total > chip.hp ? chip.hp / total : 1;
      for (const h of hits) {
        const credited = Math.floor(h.dmg * scale);
        h.a.s.chipDamage += credited;
        st.chipDmgTotal[h.a.faction] += credited;
      }
      chip.hp = Math.max(0, chip.hp - total);
      st.chipLastHitTick[f] = t;
      const pct = Math.ceil((chip.hp / chip.maxHp) * 100);
      for (const m of [75, 50, 25, 10]) {
        if (pct <= m && chip.milestone > m) {
          chip.milestone = m;
          this.feed('chip', `${FACTIONS[f].chipName} (${FACTIONS[f].short}) is down to ${m}%!`);
        }
      }
      if (chip.hp <= 0) {
        chip.destroyed = true;
        destroyed.push({ chip: f, by: [...new Set(hits.map((h) => h.a.faction))] });
        this.feed('chip', `${FACTIONS[f].chipName} (${FACTIONS[f].short}) was DESTROYED by ${[...new Set(hits.map((h) => FACTIONS[h.a.faction].short))].join(' & ')}!`);
      }
    }
    st.bulwarks = st.bulwarks.filter((b) => b.until > t);

    // 8. Victory conditions.
    if (destroyed.length) {
      const destroyers = [...new Set(destroyed.flatMap((d) => d.by))];
      if (destroyers.length === 1) {
        const w = destroyers[0];
        this.end(w, `${FACTIONS[w].name} destroyed the ${destroyed.map((d) => FACTIONS[d.chip].chipName).join(' and ')}.`);
      } else {
        const ranked = destroyers.map((f) => ({ f, d: st.chipDmgTotal[f] })).sort((a, b) => b.d - a.d);
        const detail = ranked.map((r) => `${FACTIONS[r.f].short} ${r.d}`).join(' vs ');
        if (ranked[0].d > ranked[1].d) this.end(ranked[0].f, `Chips fell on the same tick. Tie broken by total chip damage (${detail}).`);
        else this.end(null, `Chips fell on the same tick and total chip damage was equal (${detail}). Draw.`);
      }
      return;
    }
    if (t >= st.durationTicks) {
      const ranked = FACTION_IDS.map((f) => ({ f, d: st.chipDmgTotal[f] })).sort((a, b) => b.d - a.d);
      const detail = ranked.map((r) => `${FACTIONS[r.f].short} ${r.d}`).join(', ');
      if (ranked[0].d > ranked[1].d) this.end(ranked[0].f, `Time expired with no chip destroyed. Most objective damage wins (${detail}).`);
      else this.end(null, `Time expired and the top objective damage was tied (${detail}). Draw.`);
    }
  }

  private end(winner: FactionId | null, reason: string) {
    this.s.ended = true;
    this.s.winner = winner;
    this.s.reason = reason;
    this.s.endTick = this.s.tick;
    this.feed('end', winner ? `${FACTIONS[winner].name} wins! ${reason}` : reason);
  }

  private retire(c: Combatant, how: string) {
    this.s.combatants = this.s.combatants.filter((x) => x.id !== c.id);
    for (const x of this.s.combatants) {
      if (x.isBot && x.order.kind === 'support' && x.order.target === c.id) x.order = { kind: 'defend' };
    }
    this.feed('retire', `${this.label(c)} retired ${how}.`);
  }

  private desiredLoc(c: Combatant): FactionId {
    const o = c.order;
    if (o.kind === 'attack' && o.target && !this.s.chips[o.target as FactionId].destroyed) return o.target as FactionId;
    if (o.kind === 'support') {
      const ally = this.get(String(o.target));
      if (ally && ally.alive) return ally.loc ?? ally.dest ?? ally.faction;
    }
    return c.faction;
  }

  private heal(healer: Combatant, target: Combatant, amount: number, t: number) {
    const eff = Math.min(target.maxHp - target.hp, amount);
    if (eff <= 0) return;
    target.hp += eff;
    healer.s.healing += eff;
    target.healFrom[healer.id] = t;
  }

  private applyAbility(c: Combatant, t: number) {
    const ab = ROLES[c.role].ability;
    if (c.role === 'assault') {
      c.overcharge = true;
    } else if (c.role === 'guardian') {
      if (c.loc === null) return;
      this.s.bulwarks.push({ faction: c.faction, base: c.loc, caster: c.id, until: t + 4 });
    } else {
      if (c.loc === null) return;
      for (const ally of this.alliesAt(c.loc, c.faction)) this.heal(c, ally, Math.round(ally.maxHp * 0.3), t);
    }
    c.abilityReadyTick = t + Math.round((ab.warCooldownSec * 1000) / this.s.tickMs);
  }

  private botWantsAbility(c: Combatant): boolean {
    if (c.role === 'assault') return !c.overcharge && c.loc !== null && c.loc !== c.faction;
    if (c.loc === null) return false;
    if (c.role === 'guardian') return this.hostilesAt(c.loc, c.faction).length > 0;
    return this.alliesAt(c.loc, c.faction).some((a) => a.hp / a.maxHp < 0.6);
  }

  /** NPC behaviour: Guardians defend threatened chips, Engineers help wounded allies, Assault pushes vulnerable bases. */
  think(c: Combatant) {
    if (c.role === 'guardian') {
      c.order = { kind: 'defend' };
      return;
    }
    if (c.role === 'assault') {
      c.order = { kind: 'attack', target: this.mostVulnerable(c.faction, c.order.kind === 'attack' ? c.order.target : null) };
      return;
    }
    const allies = this.s.combatants.filter((x) => x.faction === c.faction && x.id !== c.id && x.alive);
    const wounded = allies.filter((x) => x.hp / x.maxHp < 0.7).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp);
    if (wounded.length) {
      c.order = { kind: 'support', target: wounded[0].id };
      return;
    }
    if (this.threatened(c.faction)) {
      c.order = { kind: 'defend' };
      return;
    }
    const buddy = allies.find((x) => x.role === 'assault' && !x.isBot) ?? allies.find((x) => x.role === 'assault');
    c.order = buddy ? { kind: 'support', target: buddy.id } : { kind: 'defend' };
  }

  private kill(killer: Combatant, victim: Combatant, t: number) {
    victim.alive = false;
    victim.hp = 0;
    victim.respawnAt = t + WAR.respawnTicks;
    victim.s.deaths++;
    victim.s.streak = 0;
    victim.overcharge = false;
    if (victim.isBot) killer.s.killsNpc++;
    else {
      killer.s.killsHuman++;
      const n = (killer.s.repeat[victim.id] ?? 0) + 1;
      killer.s.repeat[victim.id] = n;
      killer.s.kStar += repeatKillCredit(n);
    }
    killer.s.streak++;
    killer.s.bestStreak = Math.max(killer.s.bestStreak, killer.s.streak);
    const w = t - WAR.assistWindowTicks;
    const assisters = this.s.combatants.filter(
      (x) => x.faction === killer.faction && x.id !== killer.id && ((victim.dmgFrom[x.id] ?? -1e9) >= w || (killer.healFrom[x.id] ?? -1e9) >= w),
    );
    for (const a of assisters) a.s.assists++;
    victim.dmgFrom = {};
    const tag = victim.isBot ? 'NPC' : 'PILOT';
    this.feed(
      'kill',
      `${this.label(killer)} eliminated ${this.label(victim)} (${tag})${assisters.length ? ` · assist: ${assisters.map((a) => a.name).join(', ')}` : ''}`,
    );
  }

  // -------------------------------------------------------------------- views

  view(id: number, kind: 'scheduled' | 'test', endsAt: number): WarView {
    const st = this.s;
    const orderCounts = perFaction(() => ({ defend: 0, attack: 0, support: 0 }) as Record<OrderKind, number>);
    for (const c of st.combatants) orderCounts[c.faction][c.order.kind]++;
    return {
      id,
      kind,
      startsAt: st.startsAt,
      endsAt,
      tick: st.tick,
      status: st.ended ? 'resolved' : 'active',
      chips: perFaction((f) => ({ hp: st.chips[f].hp, maxHp: st.chips[f].maxHp, destroyed: st.chips[f].destroyed })),
      participation: perFaction((f) => ({ humans: this.count(f, false), npcs: this.count(f, true) })),
      orderCounts,
      combatants: st.combatants.map((c) => this.cview(c)),
      feed: st.feed.slice(-40),
      target: st.target,
    };
  }

  private cview(c: Combatant): CombatantView {
    const t = this.s.tick;
    return {
      id: c.id,
      name: c.name,
      faction: c.faction,
      role: c.role,
      isBot: c.isBot,
      charId: c.charId,
      hp: c.hp,
      maxHp: c.maxHp,
      alive: c.alive,
      respawnIn: c.alive ? 0 : Math.max(0, c.respawnAt - t),
      loc: c.loc,
      from: c.from,
      dest: c.dest,
      arriveIn: c.loc === null ? Math.max(0, c.arriveTick - t) : 0,
      order: c.order,
      abilityReadyIn: Math.max(0, c.abilityReadyTick - (t + 1)),
      retiring: c.retiring,
      kills: c.s.killsHuman + c.s.killsNpc,
      deaths: c.s.deaths,
    };
  }

  humanStats(): WarPlayerStats[] {
    return this.s.combatants
      .filter((c) => !c.isBot && c.charId !== null)
      .map((c) => {
        const { mvp, breakdown } = mvpOf(c.s);
        return {
          charId: c.charId!,
          name: c.name,
          faction: c.faction,
          role: c.role,
          killsHuman: c.s.killsHuman,
          killsNpc: c.s.killsNpc,
          deaths: c.s.deaths,
          assists: c.s.assists,
          bestStreak: c.s.bestStreak,
          healing: c.s.healing,
          damage: c.s.damage,
          chipDamage: c.s.chipDamage,
          defense: c.s.defense,
          mvp,
          mvpBreakdown: breakdown,
        };
      });
  }
}
