import { useEffect, useState } from 'react';
import { FACTIONS, FACTION_IDS, MVP_FORMULA_TEXT, ROLES, WAR, type FactionId, type WarOrder } from '../../../shared/content';
import type { CombatantView, RankBoard, RankScope, RankingView, WarResultView, WarView } from '../../../shared/protocol';
import { FactionEmblem } from '../art/Art';
import { act, rpc, showWarResult, useStore } from '../net';
import { Bar, Gold, Panel, Sheet, fmtDuration, fmtLocal, useNow } from '../ui';

type Sub = 'battle' | 'rankings' | 'results';

export function War() {
  const [sub, setSub] = useState<Sub>('battle');
  return (
    <div className="screen war">
      <div className="tabs tabs-tight" role="tablist">
        {(
          [
            ['battle', 'Battle'],
            ['rankings', 'Rankings'],
            ['results', 'Past wars'],
          ] as Array<[Sub, string]>
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>
            {l}
          </button>
        ))}
      </div>
      {sub === 'battle' && <Battle />}
      {sub === 'rankings' && <Rankings />}
      {sub === 'results' && <PastWars />}
    </div>
  );
}

function Battle() {
  const war = useStore((s) => s.war);
  const p = useStore((s) => s.player)!;
  const now = useNow();
  const active = war?.active ?? null;
  const me = active?.combatants.find((c) => c.charId === p.character.id) ?? null;

  if (!active) return <Lobby />;
  if (!me) return <JoinPanel war={active} />;
  return <Command war={active} me={me} now={now} />;
}

function Lobby() {
  const war = useStore((s) => s.war);
  const p = useStore((s) => s.player)!;
  const now = useNow();
  const [queued, setQueued] = useState<boolean | null>(null);
  useEffect(() => {
    rpc<{ queued: boolean }>('war.queued').then((r) => setQueued(r.queued)).catch(() => {});
  }, []);
  const toggle = async () => {
    const r = await act<{ queued: boolean }>('war.queue', { on: !queued });
    if (r) setQueued(r.queued);
  };
  return (
    <div className="lobby">
      <Panel>
        <h3>Next Chip War</h3>
        {war ? (
          <p className="big-time">
            {fmtLocal(war.nextStartAt)}
            <span className="muted"> your time, in {fmtDuration(war.nextStartAt - now)}</span>
          </p>
        ) : (
          <p className="muted">Loading schedule…</p>
        )}
        <p className="muted small">
          Wars run every {war?.intervalMin ?? 60} minutes and last {war?.durationMin ?? 15} minutes. Destroy an enemy Command Chip to win; if time runs out, the faction that dealt the most chip
          damage wins. Winners get two hours in Victor’s Lode.
        </p>
        <button className={`btn ${queued ? '' : 'btn-primary'} btn-big`} onClick={toggle} disabled={queued === null}>
          {queued ? 'Queued — tap to leave the queue' : 'Queue for the next war'}
        </button>
      </Panel>
      <MapPreview />
      {p.character.isDev && (
        <button className="btn" onClick={() => act('dev.testWar', { seconds: 120 }, 'Two-minute test war started.')}>
          Launch 2-minute test war (developer)
        </button>
      )}
    </div>
  );
}

function MapPreview() {
  return (
    <Panel tone="quiet" className="map-preview">
      <WarMap war={null} meId={null} />
      <p className="muted small">
        {FACTION_IDS.map((f) => FACTIONS[f].baseName).join(', ')}: three bases, {WAR.travelTicks}s apart.
      </p>
    </Panel>
  );
}

function JoinPanel({ war }: { war: WarView }) {
  const p = useStore((s) => s.player)!;
  const now = useNow();
  const f = p.character.faction;
  const enemies = FACTION_IDS.filter((x) => x !== f);
  const join = (order?: WarOrder) => act('war.join', { order }, 'You joined the Chip War.');
  return (
    <div className="join">
      <ChipsStrip war={war} now={now} />
      <WarMap war={war} meId={null} />
      <Panel>
        <h3>Your faction needs you</h3>
        <p className="muted small">
          You join instantly. If you lock your phone, your pilot keeps following its last order until the war ends.
        </p>
        <div className="order-grid">
          <button className="btn btn-primary" onClick={() => join({ kind: 'defend' })}>
            Join and defend home
          </button>
          {enemies.map((e) => (
            <button key={e} className="btn" onClick={() => join({ kind: 'attack', target: e })}>
              Join and attack {FACTIONS[e].short}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ChipsStrip({ war, now }: { war: WarView; now: number }) {
  return (
    <div className="chips-strip">
      <div className="war-timer">
        <b>{war.kind === 'test' ? 'Test war' : 'Chip War'}</b>
        <span>{fmtDuration(war.endsAt - now)} left</span>
      </div>
      {FACTION_IDS.map((f) => {
        const c = war.chips[f];
        const part = war.participation[f];
        return (
          <div key={f} className="chip-stat" data-faction={f}>
            <FactionEmblem faction={f} size={18} />
            <div className="chip-stat-main">
              <Bar value={c.hp} max={c.maxHp} tone="accent" label={c.destroyed ? 'Destroyed' : `${Math.ceil((c.hp / c.maxHp) * 100)}%`} />
              <span className="small muted">
                {part.humans} pilot{part.humans === 1 ? '' : 's'}, {part.npcs} NPC
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ORDER_LABEL = (o: CombatantView['order'], war: WarView) => {
  if (o.kind === 'defend') return 'Defend home';
  if (o.kind === 'attack') return `Attack ${FACTIONS[o.target as FactionId].short}`;
  const ally = war.combatants.find((c) => c.id === o.target);
  return ally ? `Support ${ally.name}` : 'Support (ally left)';
};

function Command({ war, me, now }: { war: WarView; me: CombatantView; now: number }) {
  const [feedOpen, setFeedOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const f = me.faction;
  const enemies = FACTION_IDS.filter((x) => x !== f);
  const role = ROLES[me.role];
  const order = (o: WarOrder) => act('war.order', { order: o });
  const counts = war.orderCounts[f];
  const where = !me.alive
    ? `Respawning in ${me.respawnIn}s`
    : me.loc
      ? `At ${FACTIONS[me.loc].baseName}`
      : `Travelling to ${FACTIONS[me.dest!].baseName}, ${me.arriveIn}s`;
  const last = war.feed[war.feed.length - 1];

  return (
    <div className="command" data-faction={f}>
      <ChipsStrip war={war} now={now} />
      <div className="map-wrap">
        <WarMap war={war} meId={me.id} />
      </div>
      <div className="me-strip">
        <div className="me-line">
          <b>{ORDER_LABEL(me.order, war)}</b>
          <span className="muted small">{where}</span>
        </div>
        <Bar value={me.hp} max={me.maxHp} tone="hp" label={`${me.hp} / ${me.maxHp}`} />
        <span className="small muted">
          Your side: {counts.defend} defending, {counts.attack} attacking, {counts.support} supporting. You: {me.kills} kills, {me.deaths} deaths.
        </span>
      </div>
      <div className="order-grid">
        <button className={`btn ${me.order.kind === 'defend' ? 'btn-on' : ''}`} onClick={() => order({ kind: 'defend' })} aria-pressed={me.order.kind === 'defend'}>
          Defend home
        </button>
        {enemies.map((e) => (
          <button
            key={e}
            className={`btn ${me.order.kind === 'attack' && me.order.target === e ? 'btn-on' : ''}`}
            disabled={war.chips[e].destroyed}
            onClick={() => order({ kind: 'attack', target: e })}
            aria-pressed={me.order.kind === 'attack' && me.order.target === e}
          >
            Attack {FACTIONS[e].short}
          </button>
        ))}
        <button className={`btn ${me.order.kind === 'support' ? 'btn-on' : ''}`} onClick={() => setPicking(true)} aria-pressed={me.order.kind === 'support'}>
          Support a squad
        </button>
      </div>
      <button className="btn btn-ability" disabled={!me.alive || me.abilityReadyIn > 0} onClick={() => act('war.ability')}>
        <b>{role.ability.name}</b>
        <span>{!me.alive ? 'Respawning' : me.abilityReadyIn > 0 ? `Ready in ${me.abilityReadyIn}s` : 'Ready'}</span>
      </button>
      <div className={`feed ${feedOpen ? 'open' : ''}`}>
        <button className="feed-toggle" onClick={() => setFeedOpen(!feedOpen)} aria-expanded={feedOpen}>
          <span className="feed-last">{last ? last.text : 'Kill feed'}</span>
          <span className="small">{feedOpen ? 'Hide' : 'Feed'}</span>
        </button>
        {feedOpen && (
          <ol className="feed-list" aria-live="polite">
            {war.feed
              .slice(-14)
              .reverse()
              .map((e, i) => (
                <li key={`${e.tick}-${i}`} className={`feed-${e.kind}`}>
                  <span className="muted small">{e.tick}s</span> {e.text}
                </li>
              ))}
          </ol>
        )}
      </div>
      {picking && (
        <Sheet title="Support a squad" onClose={() => setPicking(false)}>
          <p className="muted small">Follow an ally wherever they go and fight beside them. Engineers heal the most wounded ally nearby.</p>
          <ul className="ally-list">
            {war.combatants
              .filter((c) => c.faction === f && c.id !== me.id)
              .map((c) => (
                <li key={c.id}>
                  <button
                    className="listing"
                    onClick={() => {
                      order({ kind: 'support', target: c.id });
                      setPicking(false);
                    }}
                  >
                    <div className="listing-main">
                      <b>
                        {c.name} {c.isBot && <span className="badge npc">NPC</span>}
                      </b>
                      <span className="muted small">
                        {ROLES[c.role].name}, {ORDER_LABEL(c.order, war).toLowerCase()}, {c.alive ? `${Math.round((c.hp / c.maxHp) * 100)}% HP` : 'respawning'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

// Base positions on the shared map (viewBox 340 × 170).
const BASE_POS: Record<FactionId, [number, number]> = { kreth: [170, 34], aurex: [62, 134], vessari: [278, 134] };

function Hex({ x, y, r, f, pct, destroyed }: { x: number; y: number; r: number; f: FactionId; pct: number; destroyed: boolean }) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
  }).join(' ');
  const col = FACTIONS[f].color;
  const id = `hexclip-${f}`;
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <rect x={x - r} y={y + r - 2 * r * pct} width={2 * r} height={2 * r * pct} />
        </clipPath>
      </defs>
      <polygon points={pts} fill="#0E1424" stroke={col} strokeWidth="3" />
      <polygon points={pts} fill={col} opacity={destroyed ? 0.15 : 0.85} clipPath={`url(#${id})`} />
      {destroyed && <path d={`M${x - r * 0.6} ${y - r * 0.6} L${x + r * 0.6} ${y + r * 0.6} M${x + r * 0.6} ${y - r * 0.6} L${x - r * 0.6} ${y + r * 0.6}`} stroke="#FF6B6B" strokeWidth="4" />}
    </g>
  );
}

function WarMap({ war, meId }: { war: WarView | null; meId: string | null }) {
  const dots: Array<{ x: number; y: number; f: FactionId; me: boolean; bot: boolean; dead: boolean; key: string }> = [];
  if (war) {
    const atBase: Record<string, number> = {};
    for (const c of war.combatants) {
      let x: number;
      let y: number;
      if (c.loc) {
        const n = (atBase[c.loc + c.faction] = (atBase[c.loc + c.faction] ?? 0) + 1);
        const [bx, by] = BASE_POS[c.loc];
        const ring = FACTION_IDS.indexOf(c.faction);
        const ang = ring * 2.1 + n * 0.55;
        const rad = 34 + (n % 3) * 5;
        x = bx + Math.cos(ang) * rad;
        y = by + Math.sin(ang) * rad * 0.7;
      } else {
        const from = BASE_POS[c.from ?? c.faction];
        const to = BASE_POS[c.dest ?? c.faction];
        const prog = 1 - Math.min(1, c.arriveIn / WAR.travelTicks);
        x = from[0] + (to[0] - from[0]) * prog;
        y = from[1] + (to[1] - from[1]) * prog;
      }
      dots.push({ x, y, f: c.faction, me: c.id === meId, bot: c.isBot, dead: !c.alive, key: c.id });
    }
  }
  return (
    <svg className="war-map" viewBox="0 0 340 170" role="img" aria-label="Map of the three faction bases">
      <polygon points={FACTION_IDS.map((f) => BASE_POS[f].join(',')).join(' ')} fill="none" stroke="#34415F" strokeWidth="2" strokeDasharray="4 6" />
      {FACTION_IDS.map((f) => {
        const [x, y] = BASE_POS[f];
        const chip = war?.chips[f];
        return (
          <g key={f}>
            <Hex x={x} y={y} r={22} f={f} pct={chip ? chip.hp / chip.maxHp : 1} destroyed={!!chip?.destroyed} />
            <text x={x} y={y + 4} textAnchor="middle" className="map-pct">
              {chip ? `${Math.ceil((chip.hp / chip.maxHp) * 100)}%` : FACTIONS[f].short}
            </text>
          </g>
        );
      })}
      {dots.map((d) => (
        <g key={d.key} opacity={d.dead ? 0.25 : 1}>
          {d.me && <circle cx={d.x} cy={d.y} r="7" fill="none" stroke="#fff" strokeWidth="2" />}
          {d.bot ? (
            <rect x={d.x - 2.5} y={d.y - 2.5} width="5" height="5" fill={FACTIONS[d.f].color} opacity="0.75" />
          ) : (
            <circle cx={d.x} cy={d.y} r="3.6" fill={FACTIONS[d.f].color} />
          )}
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- rankings

const BOARDS: Array<[RankBoard, string]> = [
  ['kills', 'Most Kills'],
  ['mvp', 'War MVP'],
  ['defense', 'Defense'],
  ['healing', 'Healing'],
  ['assists', 'Assists'],
  ['chipDamage', 'Chip damage'],
  ['npcKills', 'NPC kills'],
  ['bestStreak', 'Best streak'],
  ['deaths', 'Deaths'],
];

function Rankings() {
  const p = useStore((s) => s.player)!;
  const war = useStore((s) => s.war);
  const [board, setBoard] = useState<RankBoard>('kills');
  const [scope, setScope] = useState<RankScope>('weekly');
  const [faction, setFaction] = useState<FactionId | 'all'>('all');
  const [data, setData] = useState<RankingView | null>(null);
  const [showFormula, setShowFormula] = useState(false);
  const tick = war?.active?.tick ?? 0;
  useEffect(() => {
    rpc<RankingView>('rank.get', { board, scope, faction }).then(setData).catch(() => {});
  }, [board, scope, faction, scope === 'current' ? Math.floor(tick / 3) : 0]);
  const label = BOARDS.find((b) => b[0] === board)![1];
  return (
    <div className="rankings">
      <div className="chip-row scroll-x">
        {BOARDS.map(([k, l]) => (
          <button key={k} className={`chip ${board === k ? 'on' : ''}`} onClick={() => setBoard(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="seg seg-3">
        {(
          [
            ['current', 'This war'],
            ['weekly', 'This week'],
            ['alltime', 'All time'],
          ] as Array<[RankScope, string]>
        ).map(([k, l]) => (
          <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="chip-row">
        <button className={`chip ${faction === 'all' ? 'on' : ''}`} onClick={() => setFaction('all')}>
          All factions
        </button>
        {FACTION_IDS.map((f) => (
          <button key={f} className={`chip ${faction === f ? 'on' : ''}`} onClick={() => setFaction(f)}>
            <FactionEmblem faction={f} size={14} /> {FACTIONS[f].short}
          </button>
        ))}
      </div>
      <Panel className="board">
        <div className="board-head">
          <b>{label}</b>
          <span className="muted small">{data?.periodLabel}</span>
        </div>
        {board === 'kills' && <p className="muted small">Enemy human pilots defeated in Chip Wars. NPC kills are tracked separately.</p>}
        {board === 'mvp' && (
          <button className="link" onClick={() => setShowFormula(true)}>
            How War MVP is scored
          </button>
        )}
        {!data || data.rows.length === 0 ? (
          <p className="muted">No standings yet for this view.</p>
        ) : (
          <ol className="rank-list">
            {data.rows.map((r) => (
              <li key={r.charId} className={r.charId === p.character.id ? 'me' : ''}>
                <span className="rank">{r.rank}</span>
                <FactionEmblem faction={r.faction} size={18} />
                <span className="rank-name">{r.name}</span>
                <span className="muted small">{ROLES[r.role].name}</span>
                <b className="rank-val">{r.value}</b>
              </li>
            ))}
          </ol>
        )}
        <p className="my-rank">
          {data?.me ? (
            <>
              Your rank: <b>{data.me.rank}</b> with {data.me.value}
            </>
          ) : (
            <span className="muted">You are not ranked in this view yet.</span>
          )}
        </p>
      </Panel>
      {showFormula && (
        <Sheet title="War MVP formula" onClose={() => setShowFormula(false)}>
          <pre className="formula">{MVP_FORMULA_TEXT.join('\n')}</pre>
          <p className="muted small">Every player’s breakdown appears in the war recap.</p>
        </Sheet>
      )}
    </div>
  );
}

function PastWars() {
  const [rows, setRows] = useState<Array<{ id: number; kind: string; winner: FactionId | null; reason: string; resolved_at: number }>>([]);
  useEffect(() => {
    rpc('war.results').then(setRows).catch(() => {});
  }, []);
  const open = async (id: number) => {
    const r = await rpc<WarResultView>('war.result', { warId: id });
    if (r) showWarResult(r);
  };
  if (!rows.length) return <p className="muted pad">No wars have finished yet.</p>;
  return (
    <ul className="listings">
      {rows.map((w) => (
        <li key={w.id}>
          <button className="listing" onClick={() => open(w.id)}>
            {w.winner ? <FactionEmblem faction={w.winner} size={32} /> : <span className="draw-mark">=</span>}
            <div className="listing-main">
              <b>
                War #{w.id}: {w.winner ? `${FACTIONS[w.winner].name} won` : 'Draw'}
              </b>
              <span className="muted small">{w.reason}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ recap

export function WarRecap({ r, onClose }: { r: WarResultView; onClose: () => void }) {
  const p = useStore((s) => s.player);
  const mine = r.players.find((x) => x.charId === p?.character.id);
  const reward = p ? r.rewards[p.character.id] : undefined;
  const award = (label: string, a: WarResultView['awards']['topKiller'], unit: string) => (
    <li>
      <span className="muted small">{label}</span>
      {a ? (
        <b>
          <FactionEmblem faction={a.faction} size={16} /> {a.name} <span className="muted">({a.value} {unit})</span>
        </b>
      ) : (
        <span className="muted">Not awarded</span>
      )}
    </li>
  );
  return (
    <Sheet title={`War #${r.warId} recap`} onClose={onClose}>
      <div className={`result-banner ${r.winner && mine && r.winner === mine.faction ? 'win' : r.winner ? 'lose' : ''}`}>
        <h2>{r.winner ? `${FACTIONS[r.winner].name} wins` : 'Draw'}</h2>
        <p>{r.reason}</p>
      </div>
      <ul className="awards">
        {award('Top Killer', r.awards.topKiller, 'kills')}
        {award('Best Defender', r.awards.bestDefender, 'defense')}
        {award('War MVP', r.awards.mvp, 'points')}
      </ul>
      <div className="recap-chips">
        {FACTION_IDS.map((f) => (
          <div key={f}>
            <FactionEmblem faction={f} size={20} />
            <span>{r.chips[f].destroyed ? 'Chip destroyed' : `${Math.ceil((r.chips[f].hp / r.chips[f].maxHp) * 100)}% chip`}</span>
            <span className="muted small">
              {r.participation[f].humans} pilot{r.participation[f].humans === 1 ? '' : 's'}, {r.participation[f].npcs} NPC, {r.chipDamageByFaction[f]} chip damage dealt
            </span>
          </div>
        ))}
      </div>
      {mine && (
        <Panel>
          <h3>Your war</h3>
          <dl className="facts facts-4">
            <div>
              <dt>Kills</dt>
              <dd>{mine.killsHuman}</dd>
            </div>
            <div>
              <dt>NPC kills</dt>
              <dd>{mine.killsNpc}</dd>
            </div>
            <div>
              <dt>Assists</dt>
              <dd>{mine.assists}</dd>
            </div>
            <div>
              <dt>Deaths</dt>
              <dd>{mine.deaths}</dd>
            </div>
            <div>
              <dt>Best streak</dt>
              <dd>{mine.bestStreak}</dd>
            </div>
            <div>
              <dt>Healing</dt>
              <dd>{mine.healing}</dd>
            </div>
            <div>
              <dt>Defense</dt>
              <dd>{mine.defense}</dd>
            </div>
            <div>
              <dt>Chip dmg</dt>
              <dd>{mine.chipDamage}</dd>
            </div>
          </dl>
          <h4>MVP {mine.mvp}</h4>
          <ul className="breakdown">
            {Object.entries(mine.mvpBreakdown).map(([k, v]) => (
              <li key={k}>
                <span>{BREAKDOWN_LABEL[k] ?? k}</span>
                <b>{v}</b>
              </li>
            ))}
          </ul>
          {reward && (
            <p>
              Rewards: <Gold n={reward.gold} /> and {reward.exp} EXP{r.winner === mine.faction ? ' (winner bonus included)' : ''}.
            </p>
          )}
        </Panel>
      )}
      <h4>All pilots</h4>
      <ol className="rank-list">
        {[...r.players]
          .sort((a, b) => b.mvp - a.mvp)
          .map((x, i) => (
            <li key={x.charId} className={x.charId === p?.character.id ? 'me' : ''}>
              <span className="rank">{i + 1}</span>
              <FactionEmblem faction={x.faction} size={16} />
              <span className="rank-name">{x.name}</span>
              <span className="muted small">
                {x.killsHuman}K {x.assists}A {x.deaths}D
              </span>
              <b className="rank-val">{x.mvp}</b>
            </li>
          ))}
      </ol>
    </Sheet>
  );
}

const BREAKDOWN_LABEL: Record<string, string> = {
  competitiveKills: 'Human kills (with repeat-victim falloff)',
  npcKills: 'NPC kills',
  assists: 'Assists',
  damage: 'Damage dealt',
  chipDamage: 'Chip damage',
  healing: 'Healing restored',
  defense: 'Defense',
};
