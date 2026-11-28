// Schedules Chip Wars, drives the engine on server ticks, snapshots state every tick and
// resolves results + rewards exactly once in a single transaction.
import { BONUS_ZONE_ID, FACTIONS, FACTION_IDS, WAR, warRewards, type FactionId, type WarOrder } from '../../../shared/content';
import type { AwardView, WarPlayerStats, WarResultView, WarScheduleView, WarView } from '../../../shared/protocol';
import { addGold, charStats, getChar, grantExp } from '../characters';
import { clock } from '../clock';
import { config, log } from '../config';
import { all, fail, get, run, tx } from '../db';
import { WarEngine, type HumanEntry, type WarOptions } from './engine';

interface WarRow {
  id: number;
  kind: 'scheduled' | 'test';
  starts_at: number;
  ends_at: number;
  status: 'active' | 'resolved';
  state_json: string | null;
  result_json: string | null;
}

export interface WarHooks {
  broadcast: (view: WarView | null) => void;
  resolved: (result: WarResultView) => void;
  playersChanged: (charIds: number[]) => void;
}

export class WarManager {
  engine: WarEngine | null = null;
  row: WarRow | null = null;
  constructor(private hooks: WarHooks) {}

  get intervalMs() {
    return config.warIntervalMin * 60_000;
  }
  get durationMs() {
    return config.warDurationMin * 60_000;
  }

  load() {
    const r = get<WarRow>("SELECT * FROM wars WHERE status = 'active' ORDER BY id DESC LIMIT 1");
    if (r && r.state_json) {
      this.row = r;
      this.engine = new WarEngine(JSON.parse(r.state_json));
      log(`Resumed war #${r.id} at tick ${this.engine.s.tick}.`);
    }
  }

  nextStartAt(now = clock.now()): number {
    const slot = Math.floor(now / this.intervalMs) * this.intervalMs;
    const taken = get('SELECT 1 FROM wars WHERE kind = ? AND starts_at = ?', 'scheduled', slot);
    if (!taken && !this.engine && now - slot < 60_000) return slot;
    return slot + this.intervalMs;
  }

  scheduleView(): WarScheduleView {
    const now = clock.now();
    const last = get<{ id: number }>("SELECT id FROM wars WHERE status = 'resolved' ORDER BY id DESC LIMIT 1");
    return {
      serverNow: now,
      active: this.view(),
      nextStartAt: this.nextStartAt(now),
      durationMin: config.warDurationMin,
      intervalMin: config.warIntervalMin,
      lastResultWarId: last?.id ?? null,
    };
  }

  view(): WarView | null {
    if (!this.engine || !this.row) return null;
    return this.engine.view(this.row.id, this.row.kind, this.row.ends_at);
  }

  private start(kind: 'scheduled' | 'test', startsAt: number, endsAt: number, options: WarOptions = {}) {
    if (this.engine) fail('A Chip War is already running.');
    const queued = all<{ character_id: number }>('SELECT character_id FROM war_queue');
    const humans: HumanEntry[] = queued.map((q) => this.entryFor(q.character_id));
    const durationTicks = Math.max(10, Math.floor((endsAt - startsAt) / WAR.tickMs));
    const id = tx(() => {
      const wid = run("INSERT INTO wars(kind, starts_at, ends_at, status) VALUES(?,?,?, 'active')", kind, startsAt, endsAt).id;
      run('DELETE FROM war_queue');
      return wid;
    });
    this.engine = WarEngine.create({
      id,
      kind,
      startsAt,
      durationTicks,
      chipHp: kind === 'test' ? WAR.chipHpTest : WAR.chipHpScheduled,
      target: config.warTargetPerFaction,
      seed: (id * 2654435761) >>> 0,
      humans,
      options,
    });
    this.row = get<WarRow>('SELECT * FROM wars WHERE id = ?', id)!;
    this.persist();
    log(`War #${id} (${kind}) started, ${durationTicks}s, ${humans.length} queued pilots.`);
    this.hooks.broadcast(this.view());
    this.hooks.playersChanged(humans.map((h) => h.charId));
    return id;
  }

  startTest(seconds = config.testWarSec, options: WarOptions = {}) {
    const now = clock.now();
    return this.start('test', now, now + seconds * 1000, options);
  }

  private entryFor(charId: number): HumanEntry {
    const c = getChar(charId);
    if (c.is_bot) fail('NPCs cannot queue.');
    const st = charStats(c);
    return { charId: c.id, name: c.name, faction: c.faction, role: c.role, level: c.level, stats: { hp: st.hp, atk: st.atk, def: st.def } };
  }

  join(charId: number, order?: WarOrder) {
    if (!this.engine) fail('No Chip War is running. Queue for the next one instead.');
    if (this.engine.s.ended) fail('This war is ending.');
    const c = this.engine.addHuman(this.entryFor(charId));
    if (order) this.engine.setOrder(c.id, order);
    this.persist();
    this.hooks.broadcast(this.view());
    return c.id;
  }

  queue(charId: number, on: boolean) {
    getChar(charId);
    if (on) run('INSERT OR IGNORE INTO war_queue(character_id, queued_at) VALUES(?,?)', charId, clock.now());
    else run('DELETE FROM war_queue WHERE character_id = ?', charId);
    return { queued: on };
  }

  isQueued(charId: number) {
    return !!get('SELECT 1 FROM war_queue WHERE character_id = ?', charId);
  }

  setOrder(charId: number, order: WarOrder) {
    const c = this.mine(charId);
    try {
      this.engine!.setOrder(c.id, order);
    } catch (e: any) {
      fail(e.message);
    }
    this.persist();
    this.hooks.broadcast(this.view());
    return c.order;
  }

  focus(charId: number, targetId: string | null) {
    const c = this.mine(charId);
    try {
      this.engine!.setFocus(c.id, targetId);
    } catch (e: any) {
      fail(e.message);
    }
    return { focus: targetId };
  }

  ability(charId: number) {
    const c = this.mine(charId);
    try {
      this.engine!.queueAbility(c.id);
    } catch (e: any) {
      fail(e.message);
    }
    return { queued: true };
  }

  private mine(charId: number) {
    if (!this.engine) fail('No Chip War is running.');
    const c = this.engine.byChar(charId);
    if (!c) fail('Join the war first.');
    return c;
  }

  joinedWarId(charId: number): number | null {
    return this.engine && this.engine.byChar(charId) ? this.row!.id : null;
  }

  devSetHp(combatantId: string, hp: number) {
    if (!this.engine) fail('No war running.');
    try {
      this.engine.devSetHp(combatantId, hp);
    } catch (e: any) {
      fail(e.message);
    }
    this.persist();
  }

  devEndNow() {
    if (!this.engine) fail('No war running.');
    this.engine.s.durationTicks = this.engine.s.tick + 1;
    this.persist();
  }

  private persist() {
    if (!this.engine || !this.row) return;
    run('UPDATE wars SET state_json = ? WHERE id = ?', JSON.stringify(this.engine.s), this.row.id);
  }

  /** Called frequently by the server loop. */
  loop() {
    const now = clock.now();
    if (!this.engine) {
      if (!config.scheduledWars) return;
      const slot = Math.floor(now / this.intervalMs) * this.intervalMs;
      if (now - slot < 60_000 && !get('SELECT 1 FROM wars WHERE kind = ? AND starts_at = ?', 'scheduled', slot)) {
        try {
          this.start('scheduled', slot, slot + this.durationMs);
        } catch (e) {
          log('Could not start scheduled war:', (e as Error).message);
        }
      }
      return;
    }
    const e = this.engine;
    const target = Math.min(e.s.durationTicks, Math.floor((now - e.s.startsAt) / WAR.tickMs));
    let advanced = false;
    while (e.s.tick < target && !e.s.ended) {
      e.tick();
      advanced = true;
    }
    if (advanced) {
      this.persist();
      if (!e.s.ended) this.hooks.broadcast(this.view());
    }
    if (e.s.ended) this.resolve();
  }

  private resolve() {
    const e = this.engine!;
    const row = this.row!;
    const players = e.humanStats();
    const award = (pick: (p: WarPlayerStats) => number): AwardView | null => {
      const ranked = players
        .filter((p) => pick(p) > 0)
        .sort((a, b) => pick(b) - pick(a) || b.mvp - a.mvp || a.charId - b.charId);
      const p = ranked[0];
      return p ? { charId: p.charId, name: p.name, faction: p.faction, value: pick(p) } : null;
    };
    const now = clock.now();
    const endedAt = e.s.startsAt + (e.s.endTick ?? e.s.tick) * WAR.tickMs;
    const rewards: Record<number, { gold: number; exp: number }> = {};
    for (const p of players) rewards[p.charId] = warRewards(p.mvp, p.faction === e.s.winner);
    const result: WarResultView = {
      warId: row.id,
      kind: row.kind,
      startedAt: e.s.startsAt,
      endedAt,
      winner: e.s.winner,
      reason: e.s.reason ?? '',
      chips: Object.fromEntries(FACTION_IDS.map((f) => [f, { hp: e.s.chips[f].hp, maxHp: e.s.chips[f].maxHp, destroyed: e.s.chips[f].destroyed }])) as any,
      chipDamageByFaction: { ...e.s.chipDmgTotal },
      participation: Object.fromEntries(FACTION_IDS.map((f) => [f, { humans: e.count(f, false), npcs: e.count(f, true) }])) as any,
      awards: {
        topKiller: award((p) => p.killsHuman),
        bestDefender: award((p) => p.defense),
        mvp: award((p) => p.mvp),
      },
      players,
      rewards,
      feed: e.s.feed,
    };
    let resolvedNow = false;
    tx(() => {
      const ch = run(
        "UPDATE wars SET status = 'resolved', winner = ?, reason = ?, result_json = ?, state_json = ?, resolved_at = ? WHERE id = ? AND status = 'active'",
        e.s.winner,
        e.s.reason,
        JSON.stringify(result),
        JSON.stringify(e.s),
        now,
        row.id,
      );
      if (ch.changes !== 1) return;
      resolvedNow = true;
      for (const p of players) {
        run(
          `INSERT OR IGNORE INTO war_stats(war_id, character_id, faction, role, kills_human, kills_npc, deaths, assists, best_streak,
             healing, damage, chip_damage, defense, mvp, mvp_json, ended_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          row.id,
          p.charId,
          p.faction,
          p.role,
          p.killsHuman,
          p.killsNpc,
          p.deaths,
          p.assists,
          p.bestStreak,
          p.healing,
          p.damage,
          p.chipDamage,
          p.defense,
          p.mvp,
          JSON.stringify(p.mvpBreakdown),
          endedAt,
        );
        const r = rewards[p.charId];
        const ins = run('INSERT OR IGNORE INTO war_rewards(war_id, character_id, gold, exp, created_at) VALUES(?,?,?,?,?)', row.id, p.charId, r.gold, r.exp, now);
        if (ins.changes === 1) {
          addGold(p.charId, r.gold);
          grantExp(p.charId, r.exp);
        }
      }
      if (e.s.winner) {
        const cur = get<{ expires_at: number; granted_at: number }>('SELECT * FROM zone_access WHERE faction = ? AND zone = ?', e.s.winner, BONUS_ZONE_ID);
        const expires = now + WAR.bonusZoneHours * 3_600_000;
        if (cur && cur.expires_at > now) {
          run('UPDATE zone_access SET expires_at = ?, war_id = ? WHERE faction = ? AND zone = ?', expires, row.id, e.s.winner, BONUS_ZONE_ID);
        } else {
          run(
            `INSERT INTO zone_access(faction, zone, granted_at, expires_at, war_id) VALUES(?,?,?,?,?)
             ON CONFLICT(faction, zone) DO UPDATE SET granted_at = excluded.granted_at, expires_at = excluded.expires_at, war_id = excluded.war_id`,
            e.s.winner,
            BONUS_ZONE_ID,
            now,
            expires,
            row.id,
          );
        }
      }
    });
    log(`War #${row.id} resolved: ${e.s.winner ? FACTIONS[e.s.winner].short : 'draw'} — ${e.s.reason}`);
    this.engine = null;
    this.row = null;
    if (resolvedNow) {
      this.hooks.resolved(result);
      this.hooks.playersChanged(players.map((p) => p.charId));
    }
    this.hooks.broadcast(null);
  }

  result(warId: number): WarResultView | null {
    const r = get<{ result_json: string | null }>('SELECT result_json FROM wars WHERE id = ?', warId);
    return r?.result_json ? JSON.parse(r.result_json) : null;
  }

  recentResults(limit = 10) {
    return all<{ id: number; kind: string; winner: FactionId | null; reason: string; resolved_at: number }>(
      "SELECT id, kind, winner, reason, resolved_at FROM wars WHERE status = 'resolved' ORDER BY id DESC LIMIT ?",
      limit,
    );
  }

  lastResultFor(charId: number): number | null {
    return get<{ war_id: number }>('SELECT war_id FROM war_stats WHERE character_id = ? ORDER BY war_id DESC LIMIT 1', charId)?.war_id ?? null;
  }
}
