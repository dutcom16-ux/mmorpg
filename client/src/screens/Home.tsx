import { useState } from 'react';
import {
  ACTIVITY_INFO,
  BONUS_ZONE_ID,
  FACTIONS,
  FACTION_IDS,
  ITEMS,
  MINING_ZONES,
  OFFLINE_CAP_MS,
  ROLES,
  idleRates,
  upgradeCost,
  type IdleActivity,
} from '../../../shared/content';
import { manilaTime } from '../../../shared/time';
import { FactionEmblem, PilotPortrait } from '../art/Art';
import { act, claimIdle, setActivity, toast, useStore } from '../net';
import { Bar, Gold, Panel, fmtDuration, fmtLocal, rewardLines, useNow } from '../ui';

export function Home({ openDungeons, goWar }: { openDungeons: () => void; goWar: () => void }) {
  const p = useStore((s) => s.player)!;
  const war = useStore((s) => s.war);
  const world = useStore((s) => s.world);
  const now = useNow();
  const c = p.character;
  const f = FACTIONS[c.faction];
  const left = p.dungeons.list.filter((d) => d.available).length;
  const weapon = p.inventory.find((i) => i.id === c.weaponId);
  const firstUpgradeDone = p.inventory.some((i) => i.upgrade > 0);

  return (
    <div className="screen home">
      <Panel className="pilot">
        <PilotPortrait faction={c.faction} role={c.role} size={76} />
        <div className="pilot-main">
          <div className="pilot-name">
            <FactionEmblem faction={c.faction} size={22} />
            <h2>{c.name}</h2>
          </div>
          <p className="muted">
            Level {c.level} {ROLES[c.role].name}, {f.name}
          </p>
          <Bar value={c.exp} max={c.expToNext} label={`EXP ${c.exp} / ${c.expToNext}`} />
          <div className="stats-row">
            <span>
              ATK <b>{c.stats.atk}</b>
            </span>
            <span>
              DEF <b>{c.stats.def}</b>
            </span>
            <span>
              HP <b>{c.stats.hp}</b>
            </span>
            <span>
              Power <b>{c.stats.power}</b>
            </span>
          </div>
        </div>
      </Panel>

      <button className="dungeon-cta" onClick={openDungeons}>
        <span className="dungeon-cta-title">Dungeons</span>
        <span className="dungeon-cta-sub">
          {left} of 4 daily clears left, resets in {fmtDuration(p.dungeons.nextResetAt - now)}
        </span>
      </button>

      <IdlePanel />

      {!firstUpgradeDone && weapon && (
        <Panel tone="quiet" className="hint-panel">
          <b>First upgrade</b>
          <p>
            {ITEMS[weapon.templateId].name} +1 costs {upgradeCost(0).gold} Gold and {upgradeCost(0).materials[0][1]} Alloy Scrap. Hunt for two minutes, claim, then
            open Inventory.
          </p>
        </Panel>
      )}

      <Panel className="war-card">
        {war?.active ? (
          <>
            <div>
              <b>Chip War is live</b>
              <p className="muted">Ends in {fmtDuration(war.active.endsAt - now)}</p>
            </div>
            <button className="btn btn-primary" onClick={goWar}>
              {p.war.joinedWarId ? 'Back to the war' : 'Join the war'}
            </button>
          </>
        ) : (
          <>
            <div>
              <b>Next Chip War</b>
              <p className="muted">
                {war ? `${fmtLocal(war.nextStartAt)} your time (in ${fmtDuration(war.nextStartAt - now)})` : '…'}
              </p>
            </div>
            <button className="btn" onClick={goWar}>
              Open War
            </button>
          </>
        )}
      </Panel>

      {p.bonusZone && (
        <Panel tone="accent">
          <b>Victor’s Lode is open to {f.short}</b>
          <p className="muted">Your faction won the last Chip War. Mine there for double ore and Prism Crystal for {fmtDuration(p.bonusZone.expiresAt - now)}.</p>
        </Panel>
      )}

      {world && (
        <Panel tone="quiet" className="world">
          <b>On Veyra right now</b>
          <ul>
            {FACTION_IDS.map((fid) => (
              <li key={fid}>
                <FactionEmblem faction={fid} size={18} />
                <span>{FACTIONS[fid].short}</span>
                <span className="muted">
                  {world[fid].humansOnline} pilots and {world[fid].npcs} NPC; {world[fid].hunt} hunting, {world[fid].mine} mining
                </span>
              </li>
            ))}
          </ul>
          <p className="hint">NPC pilots are temporary stand-ins that keep the world busy while the player population grows.</p>
        </Panel>
      )}

      {c.isDev && <DevPanel />}
    </div>
  );
}

function IdlePanel() {
  const p = useStore((s) => s.player)!;
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const idle = p.idle;
  const elapsed = Math.max(0, now - idle.lastClaimAt);
  const capped = Math.min(elapsed, OFFLINE_CAP_MS);
  const min = capped / 60000;
  const rates = idleRates(idle.activity, p.character.level, idle.zone === BONUS_ZONE_ID && p.bonusZone ? BONUS_ZONE_ID : 'quarry');
  const est = {
    exp: Math.floor(rates.exp * min),
    gold: Math.floor(rates.gold * min),
    trainXp: Math.floor(rates.trainXp * min),
    items: Object.fromEntries(Object.entries(rates.items).map(([k, v]) => [k, Math.floor(v * min)]).filter(([, v]) => (v as number) > 0)),
  };
  const lines = rewardLines(est);

  const choose = async (a: IdleActivity, zone = 'quarry') => {
    setBusy(true);
    const r = await setActivity(a, zone);
    setBusy(false);
    if (r) toast(`Now ${ACTIVITY_INFO[a].name.toLowerCase()}${zone === BONUS_ZONE_ID ? ' in Victor’s Lode' : ''}.`, 'good');
  };
  const claim = async () => {
    setBusy(true);
    const r = await claimIdle();
    setBusy(false);
    if (r) {
      const parts = rewardLines(r).length;
      toast(parts ? `Claimed ${fmtDuration(r.cappedMs)} of ${ACTIVITY_INFO[idle.activity].name.toLowerCase()}.` : 'Nothing to claim yet.', 'good');
      if (r.levelUps) toast(`Level up! You are now level ${p.character.level + r.levelUps}.`, 'good');
    }
  };

  return (
    <Panel className="idle">
      <div className="idle-head">
        <b>While you’re away</b>
        <span className="muted">Up to 8 hours per absence</span>
      </div>
      <div className="seg seg-3">
        {(['hunt', 'mine', 'train'] as IdleActivity[]).map((a) => (
          <button key={a} className={idle.activity === a ? 'on' : ''} disabled={busy} onClick={() => idle.activity !== a && choose(a)} aria-pressed={idle.activity === a}>
            {ACTIVITY_INFO[a].name}
          </button>
        ))}
      </div>
      <p className="muted small">{ACTIVITY_INFO[idle.activity].desc}</p>
      {idle.activity === 'mine' && (
        <div className="chip-row">
          {Object.values(MINING_ZONES).map((z) => {
            const locked = z.bonus && !p.bonusZone;
            return (
              <button key={z.id} className={`chip ${idle.zone === z.id ? 'on' : ''}`} disabled={busy || locked} onClick={() => idle.zone !== z.id && choose('mine', z.id)}>
                {z.name}
                {locked ? ' (locked)' : ''}
              </button>
            );
          })}
        </div>
      )}
      <div className="accrued">
        <span className="muted">
          {fmtDuration(capped)} accrued{elapsed > OFFLINE_CAP_MS ? ' (capped at 8h)' : ''}
        </span>
        <div className="reward-list">{lines.length ? lines.map((l) => <span key={l.key}>{l.node}</span>) : <span className="muted">Rewards arrive every minute.</span>}</div>
      </div>
      <button className="btn btn-primary" disabled={busy || capped < 1000} onClick={claim}>
        Claim rewards
      </button>
    </Panel>
  );
}

function DevPanel() {
  const war = useStore((s) => s.war);
  const p = useStore((s) => s.player)!;
  const clock = async (params: any) => {
    const r = await act('dev.clock', params);
    if (r) toast(`Server clock: ${r.manilaNow}`, 'info');
  };
  const nextSix = () => {
    const d = new Date(p.dungeons.nextResetAt + 8 * 3600_000);
    return manilaTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 5, 59, 0);
  };
  return (
    <Panel tone="quiet" className="dev">
      <b>Developer tools</b>
      <p className="muted small">
        Test clock offset: {Math.round(p.clockOffsetMs / 60000)} min. Next dungeon reset {fmtLocal(p.dungeons.nextResetAt)} (6:00 AM Asia/Manila).
      </p>
      <div className="chip-row">
        <button className="chip" onClick={() => clock({ action: 'advance', ms: 3600_000 })}>
          +1 hour
        </button>
        <button className="chip" onClick={() => clock({ action: 'advance', ms: 8 * 3600_000 })}>
          +8 hours
        </button>
        <button className="chip" onClick={() => clock({ action: 'set', at: nextSix() })}>
          Jump to 5:59 AM Manila
        </button>
        <button className="chip" onClick={() => clock({ action: 'reset' })}>
          Real time
        </button>
      </div>
      <div className="chip-row">
        <button className="chip" disabled={!!war?.active} onClick={() => act('dev.testWar', { seconds: 120 }, 'Two-minute test war started.')}>
          Launch 2-minute test war
        </button>
        {war?.active && (
          <button className="chip" onClick={() => act('dev.war.endNow', {}, 'Ending the war on the next tick.')}>
            End current war
          </button>
        )}
      </div>
      <p className="hint">Only developer accounts see these controls. The test clock moves every timer on the server: idle rewards, dungeon resets and wars.</p>
    </Panel>
  );
}
