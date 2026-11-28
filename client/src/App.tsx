import { useEffect, useState } from 'react';
import { ACTIVITY_INFO, DUNGEONS, FACTIONS } from '../../shared/content';
import type { ItemView } from '../../shared/protocol';
import { FactionEmblem, NavIcon } from './art/Art';
import { claimIdle, dismissWarResult, signOut, toast, useStore } from './net';
import { Dungeons } from './screens/Dungeons';
import { Home } from './screens/Home';
import { Inventory } from './screens/Inventory';
import { Login } from './screens/Login';
import { Market } from './screens/Market';
import { War, WarRecap } from './screens/War';
import { Gold, Sheet, fmtDuration, rewardLines } from './ui';

type Tab = 'home' | 'inventory' | 'market' | 'war';

export function App() {
  const authed = useStore((s) => s.authed);
  const checked = useStore((s) => s.checkedAuth);
  const conn = useStore((s) => s.conn);
  const player = useStore((s) => s.player);
  const toasts = useStore((s) => s.toasts);

  if (!player) {
    if (authed || (!checked && conn === 'connecting')) {
      return (
        <div className="splash">
          <p>{conn === 'offline' ? 'Reconnecting to the server…' : 'Connecting…'}</p>
          <Toasts toasts={toasts} />
        </div>
      );
    }
    return (
      <>
        <Login />
        <Toasts toasts={toasts} />
      </>
    );
  }
  return <Game />;
}

function Toasts({ toasts }: { toasts: Array<{ id: number; text: string; kind: string }> }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Game() {
  const p = useStore((s) => s.player)!;
  const conn = useStore((s) => s.conn);
  const toasts = useStore((s) => s.toasts);
  const dungeon = useStore((s) => s.dungeon);
  const warResult = useStore((s) => s.warResult);
  const [tab, setTab] = useState<Tab>('home');
  const [dungeonsOpen, setDungeonsOpen] = useState(false);
  const [sellPreset, setSellPreset] = useState<ItemView | null>(null);
  const [summaryKey, setSummaryKey] = useState<number | null>(null);
  const c = p.character;

  // Show the "while you were away" summary once per absence.
  const summary = p.idle.returnSummary;
  useEffect(() => {
    if (summary) setSummaryKey(p.idle.lastClaimAt);
  }, [summary, p.idle.lastClaimAt]);

  useEffect(() => {
    document.documentElement.dataset.faction = c.faction;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', FACTIONS[c.faction].dark);
  }, [c.faction]);

  const go = (t: Tab) => {
    setTab(t);
    setDungeonsOpen(false);
    window.scrollTo(0, 0);
  };

  return (
    <div className={`app tab-${dungeonsOpen ? 'dungeons' : tab}`} data-faction={c.faction}>
      <header className="topbar">
        <FactionEmblem faction={c.faction} size={28} />
        <div className="topbar-name">
          <b>{c.name}</b>
          <span>Lv {c.level}</span>
        </div>
        <Gold n={c.gold} />
        <button className={`dot dot-${conn}`} title={conn === 'online' ? 'Online' : 'Reconnecting'} aria-label={conn === 'online' ? 'Online' : 'Reconnecting'} onClick={() => confirm('Sign out?') && signOut()} />
      </header>
      {conn !== 'online' && <div className="offline-bar">Connection lost. Your pilot keeps playing on the server; reconnecting…</div>}

      {dungeon && !dungeonsOpen && (
        <button className="run-banner" onClick={() => setDungeonsOpen(true)}>
          {dungeon.finalized ? `${DUNGEONS[dungeon.dungeonId].name}: ${dungeon.state.status === 'victory' ? 'victory — see rewards' : 'defeat'}` : `${DUNGEONS[dungeon.dungeonId].name} in progress — open`}
        </button>
      )}

      <main className="main">
        {dungeonsOpen ? (
          <Dungeons onClose={() => setDungeonsOpen(false)} />
        ) : tab === 'home' ? (
          <Home openDungeons={() => setDungeonsOpen(true)} goWar={() => go('war')} />
        ) : tab === 'inventory' ? (
          <Inventory
            sell={(item) => {
              setSellPreset(item);
              go('market');
            }}
          />
        ) : tab === 'market' ? (
          <Market preset={sellPreset} clearPreset={() => setSellPreset(null)} />
        ) : (
          <War />
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {(
          [
            ['home', 'Home', 'home'],
            ['inventory', 'Inventory', 'bag'],
            ['market', 'Market', 'market'],
            ['war', 'War', 'war'],
          ] as const
        ).map(([k, label, icon]) => (
          <button key={k} className={tab === k && !dungeonsOpen ? 'on' : ''} onClick={() => go(k)} aria-current={tab === k && !dungeonsOpen ? 'page' : undefined}>
            <NavIcon name={icon} />
            <span>{label}</span>
            {k === 'war' && p.war.joinedWarId && <i className="live-dot" aria-label="War live" />}
          </button>
        ))}
      </nav>

      {summary && summaryKey === p.idle.lastClaimAt && (
        <Sheet title="While you were away" onClose={() => setSummaryKey(-1)}>
          <p>
            Your pilot spent {fmtDuration(summary.cappedMs)} {ACTIVITY_INFO[p.idle.activity].name.toLowerCase()}.
            {summary.capped && ` You were gone ${fmtDuration(summary.elapsedMs)}; rewards are capped at 8 hours.`}
          </p>
          <ul className="earned">
            {rewardLines(summary).map((l) => (
              <li key={l.key}>{l.node}</li>
            ))}
          </ul>
          <button
            className="btn btn-primary btn-big"
            onClick={async () => {
              const r = await claimIdle();
              if (r) toast('Rewards claimed.', 'good');
              setSummaryKey(-1);
            }}
          >
            Claim rewards
          </button>
        </Sheet>
      )}

      {warResult && <WarRecap r={warResult} onClose={dismissWarResult} />}
      <Toasts toasts={toasts} />
    </div>
  );
}
