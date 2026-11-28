import { useEffect, useState } from 'react';
import { DUNGEONS, DUNGEON_IDS, FACTIONS, ITEMS, ROLES, itemStats, type DungeonId } from '../../../shared/content';
import type { DungeonRunView, PlayerView } from '../../../shared/protocol';
import { DungeonMark, ItemIcon } from '../art/Art';
import { act, clearDungeon, setDungeon, toast, useStore } from '../net';
import { Bar, Gold, ItemName, Panel, StatDelta, fmtDuration, fmtLocal, rewardLines, useNow } from '../ui';

export function Dungeons({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.player)!;
  const run = useStore((s) => s.dungeon);
  const now = useNow();
  const [busy, setBusy] = useState<DungeonId | null>(null);

  if (run) return <RunView run={run} player={p} onExit={onClose} />;

  const enter = async (id: DungeonId) => {
    setBusy(id);
    const r = await act<DungeonRunView>('dungeon.start', { dungeonId: id });
    setBusy(null);
    if (r) setDungeon(r);
  };

  return (
    <div className="screen dungeons">
      <div className="screen-head">
        <button className="icon-btn" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <h2>Daily dungeons</h2>
      </div>
      <p className="muted reset-line">
        Daily clears reset at 6:00 AM Philippine time — {fmtLocal(p.dungeons.nextResetAt)} for you, in {fmtDuration(p.dungeons.nextResetAt - now)}. Only clear eligibility resets; you keep EXP, gear and Gold.
      </p>
      {p.dungeons.activeRunId && (
        <button className="btn btn-primary" onClick={() => act<DungeonRunView>('dungeon.get', { runId: p.dungeons.activeRunId }).then((r) => r && setDungeon(r))}>
          Resume your run in progress
        </button>
      )}
      {DUNGEON_IDS.map((id) => {
        const d = DUNGEONS[id];
        const st = p.dungeons.list.find((x) => x.id === id)!;
        const status = st.cleared ? 'Cleared today' : !st.unlocked ? `Unlocks at level ${d.unlockLevel}` : 'Clear available';
        return (
          <Panel key={id} className={`dungeon ${st.cleared ? 'is-cleared' : ''} ${!st.unlocked ? 'is-locked' : ''}`}>
            <div className="dungeon-top">
              <DungeonMark id={id} />
              <div className="dungeon-info">
                <h3>{d.name}</h3>
                <p className="muted small">{d.tagline}</p>
                <span className={`status status-${st.cleared ? 'done' : st.unlocked ? 'open' : 'locked'}`}>{status}</span>
              </div>
            </div>
            <dl className="facts">
              <div>
                <dt>Recommended</dt>
                <dd>Level {d.recLevel}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>
                  {d.expectedSec[0]}–{d.expectedSec[1]}s
                </dd>
              </div>
              <div>
                <dt>Guaranteed</dt>
                <dd>{id === 'goldmine' && st.payout ? <Gold n={st.payout} /> : d.primary}</dd>
              </div>
            </dl>
            <p className="small muted">Possible drops: {d.possibleDrops.join('; ')}</p>
            <button className="btn btn-primary" disabled={!st.available || !!busy || !!p.dungeons.activeRunId} onClick={() => enter(id)}>
              {busy === id ? 'Entering…' : st.cleared ? 'Come back after the reset' : `Enter ${d.name}`}
            </button>
          </Panel>
        );
      })}
    </div>
  );
}

function RunView({ run, player, onExit }: { run: DungeonRunView; player: PlayerView; onExit: () => void }) {
  const def = DUNGEONS[run.dungeonId];
  const s = run.state;
  const role = ROLES[run.role];
  const [pending, setPending] = useState(false);
  const cd = Math.max(0, s.abilityReadyTick - (s.tick + 1));

  useEffect(() => {
    if (run.finalized) act('dungeon.ack', { runId: run.runId });
  }, [run.finalized, run.runId]);

  const ability = async () => {
    setPending(true);
    await act('dungeon.ability', { runId: run.runId });
    setPending(false);
  };
  const leave = () => {
    clearDungeon();
    onExit();
  };

  if (run.finalized) return <ResultView run={run} player={player} onDone={leave} onBack={() => clearDungeon()} />;

  return (
    <div className="screen run" data-faction={player.character.faction}>
      <div className="screen-head">
        <h2>{def.name}</h2>
        <span className="muted">
          Wave {s.wave + 1} of {s.waveCount}
        </span>
      </div>
      <Panel className="enemies">
        {s.enemies.map((e, i) => (
          <div key={i} className={`enemy ${e.hp <= 0 ? 'down' : ''} ${e.boss ? 'boss' : ''}`}>
            <span>{e.name}</span>
            <Bar value={e.hp} max={e.maxHp} tone="enemy" label={`${e.hp} / ${e.maxHp}`} />
          </div>
        ))}
      </Panel>
      <Panel className="me">
        <span>{player.character.name}</span>
        <Bar value={s.hp} max={s.maxHp} tone="hp" label={`${s.hp} / ${s.maxHp} HP`} />
        <p className="muted small">Auto-attacking. Your run keeps going if you lock your phone or switch devices.</p>
      </Panel>
      <button className="btn btn-ability" disabled={cd > 0 || pending} onClick={ability}>
        <b>{role.ability.name}</b>
        <span>{cd > 0 ? `Ready in ${cd}s` : 'Ready'}</span>
      </button>
      <Panel tone="quiet" className="combat-log" >
        <ol aria-live="polite">
          {s.log.slice(-6).map((l, i) => (
            <li key={`${s.tick}-${i}`}>{l}</li>
          ))}
        </ol>
      </Panel>
      <button
        className="btn btn-ghost"
        onClick={async () => {
          const r = await act<DungeonRunView>('dungeon.retreat', { runId: run.runId });
          if (r) setDungeon(r);
        }}
      >
        Retreat (counts as a defeat; you can retry)
      </button>
    </div>
  );
}

function ResultView({ run, player, onDone, onBack }: { run: DungeonRunView; player: PlayerView; onDone: () => void; onBack: () => void }) {
  const def = DUNGEONS[run.dungeonId];
  const won = run.state.status === 'victory';
  const r = run.reward;
  const gear = r?.gearItemId ? player.inventory.find((i) => i.id === r.gearItemId) : null;
  const kind = gear ? ITEMS[gear.templateId].kind : null;
  const equippedId = kind === 'weapon' ? player.character.weaponId : player.character.armorId;
  const equipped = player.inventory.find((i) => i.id === equippedId);
  const cur = equipped ? itemStats(equipped.templateId, equipped.upgrade) : { atk: 0, def: 0, hp: 0 };
  const isEquipped = gear && equippedId === gear.id;

  return (
    <div className="screen result">
      <div className={`result-banner ${won ? 'win' : 'lose'}`}>
        <h2>{won ? 'Victory' : 'Defeat'}</h2>
        <p>{won ? `${def.bossName} is down.` : run.state.defeatReason}</p>
      </div>
      {won && r && (
        <Panel>
          <h3>{r.rewarded ? 'You earned' : 'No reward'}</h3>
          {!r.rewarded && <p className="muted">This dungeon’s clear for that day was already used.</p>}
          <ul className="earned">
            {rewardLines({ exp: r.exp, gold: r.gold, items: r.items }).map((l) => (
              <li key={l.key}>{l.node}</li>
            ))}
            {r.gearTemplateId && (
              <li>
                <ItemName templateId={r.gearTemplateId} />
              </li>
            )}
            {r.levelUps > 0 && <li>Level up ×{r.levelUps}</li>}
          </ul>
          <p className="muted small">Counted as the {r.periodKey} daily clear.</p>
        </Panel>
      )}
      {gear && (
        <Panel tone="accent" className="compare">
          <div className="compare-head">
            <ItemIcon templateId={gear.templateId} size={48} />
            <div>
              <ItemName templateId={gear.templateId} />
              <p className="muted small">{ITEMS[gear.templateId].desc}</p>
            </div>
          </div>
          <p className="small muted">Compared with {equipped ? <ItemName templateId={equipped.templateId} upgrade={equipped.upgrade} /> : 'nothing equipped'}:</p>
          <div className="deltas">
            <StatDelta label="ATK" now={cur.atk} next={gear.stats.atk} />
            <StatDelta label="DEF" now={cur.def} next={gear.stats.def} />
            <StatDelta label="HP" now={cur.hp} next={gear.stats.hp} />
          </div>
          {isEquipped ? (
            <p className="good">Equipped.</p>
          ) : (
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => act('gear.equip', { itemId: gear.id }, `Equipped ${ITEMS[gear.templateId].name}.`)}>
                Equip
              </button>
              <button className="btn" onClick={() => toast('Kept in your bag. You can sell or trade it from the Market.', 'info')}>
                Keep for trading
              </button>
            </div>
          )}
        </Panel>
      )}
      <div className="btn-row">
        {!won && (
          <button className="btn btn-primary" onClick={onBack}>
            Try again
          </button>
        )}
        <button className="btn" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="muted small center">
        {FACTIONS[player.character.faction].motto}
      </p>
    </div>
  );
}
