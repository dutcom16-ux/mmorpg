// The open world: the isometric map with an MMO HUD on top.
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react';
import { ACTIVITY_INFO, FACTIONS, FACTION_IDS, ROLES, type FactionId } from '../../../shared/content';
import { worldMap, Tile } from '../../../shared/map';
import type { ChatMsg, WorldEnt } from '../../../shared/protocol';
import { FactionEmblem } from '../art/Art';
import { act, clearPartyInvite, markChatRead, onSnap, rpc, toast, useStore, getState } from '../net';
import { Bar, Sheet, fmtDuration, useNow } from '../ui';
import { WorldRenderer, type Hit } from '../world/render';
import { Home as PilotOverview } from './Home';

const M = worldMap();

export function WorldScreen({ openDungeons, goWar, openTrades }: { openDungeons: () => void; goWar: () => void; openTrades: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendRef = useRef<WorldRenderer | null>(null);
  const p = useStore((s) => s.player)!;
  const snap = useStore((s) => s.snap);
  const war = useStore((s) => s.war);
  const party = useStore((s) => s.party);
  const invite = useStore((s) => s.partyInvite);
  const [sheet, setSheet] = useState<null | 'pilot' | 'chat' | 'party'>(null);
  const [inspect, setInspect] = useState<WorldEnt | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const pendingOpen = useRef<null | { kind: 'portal' | 'terminal'; x: number; y: number }>(null);
  const c = p.character;
  const me = snap?.me ?? null;

  // Renderer lifecycle.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new WorldRenderer(canvas);
    rendRef.current = r;
    r.myFaction = c.faction;
    r.resize();
    const st = getState().snap;
    if (st) r.setSnap(st);
    const off = onSnap((s) => r.setSnap(s));
    r.start();
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(canvas);
    return () => {
      off();
      r.stop();
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const r = rendRef.current;
    if (!r) return;
    r.myFaction = c.faction;
    r.myRole = c.role;
    r.myName = c.name;
    r.myLevel = c.level;
    r.zoom = zoom;
  }, [c.faction, c.role, c.name, c.level, zoom]);

  // Chip health on the map during a war; target highlight; "walk there, then open" interactions.
  useEffect(() => {
    const r = rendRef.current;
    if (!r) return;
    const a = war?.active;
    r.chips = a
      ? (Object.fromEntries(FACTION_IDS.map((f) => [f, { pct: a.chips[f].hp / a.chips[f].maxHp, destroyed: a.chips[f].destroyed }])) as any)
      : null;
  }, [war]);
  useEffect(() => {
    const r = rendRef.current;
    if (r) r.selected = me?.target ?? null;
    const po = pendingOpen.current;
    if (po && me && Math.hypot(me.x - po.x, me.y - po.y) < 2.4) {
      pendingOpen.current = null;
      if (po.kind === 'portal') openDungeons();
      else openTrades();
    }
  }, [snap]);

  const onTap = async (hit: Hit) => {
    const r = rendRef.current!;
    if (me?.inWar) return warTap(hit);
    if (me?.dead) return toast('You are reactivating at your base.', 'info');
    if (hit.kind === 'ent') {
      const e = hit.ent;
      if (e.k === 'm') {
        r.selected = e.id;
        await act('world.target', { id: e.id });
      } else if (e.k === 'p' && e.charId) setInspect(e);
      else if (e.k === 'b') toast(`${e.n} is a temporary NPC pilot helping keep Veyra busy.`, 'info');
      else if (e.k === 'w') toast('That pilot is fighting in the Chip War.', 'info');
      return;
    }
    if (hit.kind === 'ore') return void act('world.target', { id: `o:${hit.id}` });
    if (hit.kind === 'portal' || hit.kind === 'terminal') {
      if (hit.f !== c.faction) return toast(`That belongs to ${FACTIONS[hit.f].name}.`, 'info');
      const pt = hit.kind === 'portal' ? M.portals[hit.f] : M.terminals[hit.f];
      if (me && Math.hypot(me.x - pt.x - 0.5, me.y - pt.y - 0.5) < 2.4) return hit.kind === 'portal' ? openDungeons() : openTrades();
      pendingOpen.current = { kind: hit.kind, x: pt.x + 0.5, y: pt.y + 0.5 };
      return void act('world.move', { x: pt.x + 0.5, y: pt.y + 0.5 });
    }
    if (hit.kind === 'base') {
      const b = M.bases[hit.f];
      const sp = M.spawnPoints[hit.f];
      if (hit.f !== c.faction) toast(`${FACTIONS[hit.f].baseName}: ${FACTIONS[hit.f].name}’s ${FACTIONS[hit.f].chipName}. Fight for it in a Chip War.`, 'info');
      return void act('world.move', { x: hit.f === c.faction ? sp.x : b.x + 0.5 + (sp.x - b.x) * 1.8, y: hit.f === c.faction ? sp.y : b.y + 0.5 + (sp.y - b.y) * 1.8 });
    }
    r.moveMarker = { x: hit.x, y: hit.y, born: performance.now() };
    pendingOpen.current = null;
    const res = await rpc('world.move', { x: hit.x, y: hit.y }).catch((e: Error) => toast(e.message, 'error'));
    void res;
  };

  const warTap = async (hit: Hit) => {
    if (hit.kind === 'base') {
      if (hit.f === c.faction) await act('war.order', { order: { kind: 'defend' } }, 'Order: defend home.');
      else await act('war.order', { order: { kind: 'attack', target: hit.f } }, `Order: attack ${FACTIONS[hit.f].baseName}.`);
      return;
    }
    if (hit.kind === 'ent' && hit.ent.k === 'w') {
      const e = hit.ent;
      if (e.f === c.faction) await act('war.order', { order: { kind: 'support', target: e.id } }, `Order: support ${e.n}.`);
      else await act('war.focus', { id: e.id }, `Focusing ${e.n}.`);
      return;
    }
    toast('In a Chip War: tap a base to march there, an ally to follow, or an enemy to focus.', 'info');
  };

  // Pointer handling: a short press without much movement is a tap.
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: RPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: RPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const hit = rendRef.current!.pick(e.clientX - rect.left, e.clientY - rect.top);
    void onTap(hit);
  };

  const target = me?.target?.startsWith('m:') ? snap?.ents.find((e) => e.id === me.target) : null;
  const left = p.dungeons.list.filter((d) => d.available).length;
  const ability = ROLES[c.role].ability;
  const a = war?.active;
  const myWar = a?.combatants.find((x) => x.charId === c.id) ?? null;

  return (
    <div className="world-wrap" data-faction={c.faction}>
      <canvas ref={canvasRef} className="world-canvas" onPointerDown={onPointerDown} onPointerUp={onPointerUp} aria-label="World map. Tap to move, tap a monster to attack." />

      <button className="unit-frame" onClick={() => setSheet('pilot')} aria-label="Pilot details">
        <div className="uf-top">
          <FactionEmblem faction={c.faction} size={22} />
          <b>Lv {c.level}</b>
          <span className="muted">{ROLES[c.role].name}</span>
        </div>
        <Bar value={me?.hp ?? 0} max={me?.mhp ?? 1} tone="hp" label={me ? `${Math.round(me.hp)} / ${me.mhp}` : '…'} />
        <div className="xp-thin" style={{ width: `${Math.min(100, (c.exp / c.expToNext) * 100)}%` }} />
        <span className="uf-idle">Away: {ACTIVITY_INFO[p.idle.activity].name}</span>
      </button>

      {party && (
        <button className="party-frames" onClick={() => setSheet('party')} aria-label="Party">
          {party.members
            .filter((m) => m.charId !== c.id)
            .map((m) => {
              const e = snap?.ents.find((x) => x.charId === m.charId);
              return (
                <div key={m.charId} className={`pf ${m.online ? '' : 'off'}`}>
                  <span>
                    {m.name}
                    {party.leader === m.charId ? ' ★' : ''}
                  </span>
                  {e ? <Bar value={e.hp} max={e.mhp} tone="hp" /> : <small className="muted">{m.online ? 'far away' : 'offline'}</small>}
                </div>
              );
            })}
        </button>
      )}

      <MiniMap />
      <div className="zoom-btns">
        <button onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.15).toFixed(2)))} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} aria-label="Zoom out">
          −
        </button>
      </div>

      <button className="hud-dungeons" onClick={openDungeons}>
        <b>Dungeons</b>
        <span>{left}/4 left</span>
      </button>

      {a ? (
        <WarStrip joined={!!me?.inWar} order={myWar?.order} goWar={goWar} />
      ) : (
        target && (
          <div className="target-frame">
            <div>
              <b>{target.n}</b> <span className="muted">Lv {target.l}</span>
            </div>
            <Bar value={target.hp} max={target.mhp} tone="enemy" label={`${target.hp} / ${target.mhp}`} />
            <button className="link" onClick={() => act('world.stop')}>
              Stop
            </button>
          </div>
        )
      )}

      <ChatPeek onOpen={() => setSheet('chat')} />

      <button className="hud-ability" disabled={!me || me.dead || me.abilityReadyIn > 0} onClick={() => act('world.ability')} aria-label={ability.name}>
        <b>{ability.name}</b>
        <span>{me && me.abilityReadyIn > 0 ? `${me.abilityReadyIn}s` : 'Ready'}</span>
      </button>

      {me?.dead && !me.inWar && <div className="dead-veil">Reactivating at your base in {me.respawnIn}s</div>}

      {sheet === 'pilot' && (
        <Sheet title={c.name} onClose={() => setSheet(null)}>
          <PilotOverview
            openDungeons={() => {
              setSheet(null);
              openDungeons();
            }}
            goWar={() => {
              setSheet(null);
              goWar();
            }}
          />
        </Sheet>
      )}
      {sheet === 'chat' && <ChatSheet onClose={() => setSheet(null)} />}
      {sheet === 'party' && party && (
        <Sheet title="Party" onClose={() => setSheet(null)}>
          <ul className="ally-list">
            {party.members.map((m) => (
              <li key={m.charId} className="party-row">
                <b>
                  {m.name}
                  {party.leader === m.charId ? ' (leader)' : ''}
                </b>
                <span className="muted small">
                  Level {m.level} {ROLES[m.role].name}, {m.online ? 'online' : 'offline'}
                </span>
                {party.leader === c.id && m.charId !== c.id && (
                  <button className="btn btn-ghost" onClick={() => act('party.kick', { charId: m.charId })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted small">Party members within 20 tiles share EXP and Gold from kills (+15% per extra member) and take turns receiving item drops.</p>
          <button className="btn" onClick={() => act('party.leave').then(() => setSheet(null))}>
            Leave party
          </button>
        </Sheet>
      )}
      {inspect && (
        <Sheet title={inspect.n ?? 'Pilot'} onClose={() => setInspect(null)}>
          <p>
            <FactionEmblem faction={inspect.f!} size={18} /> Level {inspect.l} {ROLES[inspect.r!].name}, {FACTIONS[inspect.f!].name}
          </p>
          <div className="btn-row">
            {inspect.f === c.faction && !party?.members.some((m) => m.charId === inspect.charId) && (
              <button className="btn btn-primary" onClick={() => act('party.invite', { charId: inspect.charId }, `Party invite sent to ${inspect.n}.`).then(() => setInspect(null))}>
                Invite to party
              </button>
            )}
            <button
              className="btn"
              onClick={async () => {
                const r = await act('trade.open', { name: inspect.n });
                setInspect(null);
                if (r) openTrades();
              }}
            >
              Trade
            </button>
          </div>
          {inspect.f !== c.faction && <p className="muted small">Different factions can trade and use the same market, but only fight each other in Chip Wars.</p>}
        </Sheet>
      )}
      {invite && (
        <div className="invite-pop" role="dialog" aria-label="Party invite">
          <p>
            <b>{invite.name}</b> invites you to a party.
          </p>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                clearPartyInvite();
                act('party.respond', { accept: true });
              }}
            >
              Join
            </button>
            <button
              className="btn"
              onClick={() => {
                clearPartyInvite();
                act('party.respond', { accept: false });
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WarStrip({ joined, order, goWar }: { joined: boolean; order?: { kind: string; target?: string }; goWar: () => void }) {
  const war = useStore((s) => s.war)!;
  const now = useNow();
  const a = war.active!;
  const orderText = !order
    ? ''
    : order.kind === 'defend'
      ? 'Defending home'
      : order.kind === 'attack'
        ? `Attacking ${FACTIONS[order.target as FactionId].short}`
        : `Supporting ${a.combatants.find((x) => x.id === order.target)?.name ?? 'an ally'}`;
  return (
    <div className="war-strip">
      <div className="ws-chips">
        {FACTION_IDS.map((f) => (
          <div key={f} className="ws-chip" data-faction={f}>
            <FactionEmblem faction={f} size={14} />
            <Bar value={a.chips[f].hp} max={a.chips[f].maxHp} />
          </div>
        ))}
      </div>
      <div className="ws-line">
        <b>{joined ? orderText : 'Chip War live'}</b>
        <span>{fmtDuration(a.endsAt - now)}</span>
      </div>
      {joined ? (
        <span className="ws-hint">Tap a base to march, an ally to follow, an enemy to focus.</span>
      ) : (
        <div className="btn-row tight">
          <button className="btn btn-primary" onClick={() => act('war.join', { order: { kind: 'defend' } }, 'You joined the Chip War. You rally at your base.')}>
            Join war
          </button>
          <button className="btn" onClick={goWar}>
            Details
          </button>
        </div>
      )}
    </div>
  );
}

function ChatPeek({ onOpen }: { onOpen: () => void }) {
  const chat = useStore((s) => s.chat);
  const unread = useStore((s) => s.chatUnread);
  const last = chat.slice(-3);
  return (
    <button className="chat-peek" onClick={onOpen} aria-label="Open chat">
      {last.length ? last.map((m) => <ChatLine key={m.id} m={m} />) : <span className="muted">Chat</span>}
      {unread > 0 && <i className="unread">{unread}</i>}
    </button>
  );
}

function ChatLine({ m }: { m: ChatMsg }) {
  const color = m.ch === 'system' ? '#95a2bc' : m.f ? FACTIONS[m.f].accent : '#fff';
  const tag = m.ch === 'faction' ? '[F] ' : m.ch === 'party' ? '[P] ' : '';
  return (
    <div className={`chat-line ch-${m.ch}`}>
      {m.ch !== 'system' && (
        <b style={{ color }}>
          {tag}
          {m.from}:
        </b>
      )}{' '}
      {m.text}
    </div>
  );
}

function ChatSheet({ onClose }: { onClose: () => void }) {
  const chat = useStore((s) => s.chat);
  const party = useStore((s) => s.party);
  const [ch, setCh] = useState<'world' | 'faction' | 'party'>('world');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    markChatRead();
    listRef.current?.scrollTo(0, 1e9);
  }, [chat.length]);
  const shown = chat.filter((m) => m.ch === 'system' || ch === 'world' || m.ch === ch);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await act('chat.send', { ch, text });
    if (r) setText('');
  };
  return (
    <Sheet title="Chat" onClose={onClose}>
      <div className="seg seg-3">
        {(['world', 'faction', 'party'] as const).map((k) => (
          <button key={k} className={ch === k ? 'on' : ''} onClick={() => setCh(k)} disabled={k === 'party' && !party}>
            {k === 'world' ? 'World' : k === 'faction' ? 'Faction' : 'Party'}
          </button>
        ))}
      </div>
      <div className="chat-list" ref={listRef}>
        {shown.length ? shown.map((m) => <ChatLine key={m.id} m={m} />) : <p className="muted">No messages yet. Say hello.</p>}
      </div>
      <form className="inline-form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={140} placeholder={`Message ${ch}`} aria-label="Message" />
        <button className="btn btn-primary">Send</button>
      </form>
    </Sheet>
  );
}

function MiniMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLCanvasElement | null>(null);
  const snap = useStore((s) => s.snap);
  const party = useStore((s) => s.party);
  const W = 128;
  const H = 64;
  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = W * 2;
    c.height = H * 2;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    const cols = ['#6b5832', '#4a3e6c', '#2f4c59', '#2b3a40'];
    for (let y = 0; y < M.h; y++) {
      for (let x = 0; x < M.w; x++) {
        const t = M.tiles[y * M.w + x];
        let col = cols[M.biome[y * M.w + x]];
        if (t === Tile.Rock || t === Tile.Crystal) col = '#151b2b';
        else if (t === Tile.Chasm) col = '#05070f';
        else if (t === Tile.Road) col = '#77725f';
        else if (t === Tile.Base) col = '#3a4462';
        g.fillStyle = col;
        g.fillRect(x - y + 63, (x + y) / 2, 2, 1.2);
      }
    }
    for (const f of FACTION_IDS) {
      const b = M.bases[f];
      g.fillStyle = FACTIONS[f].color;
      g.beginPath();
      g.arc(b.x - b.y + 64, (b.x + b.y) / 2, 3, 0, Math.PI * 2);
      g.fill();
    }
    bg.current = c;
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c || !bg.current) return;
    const g = c.getContext('2d')!;
    c.width = W * 2;
    c.height = H * 2;
    g.drawImage(bg.current, 0, 0);
    g.scale(2, 2);
    const pt = (x: number, y: number) => [x - y + 64, (x + y) / 2] as const;
    for (const e of snap?.ents ?? []) {
      if (e.k === 'm') continue;
      const [px, py] = pt(e.x, e.y);
      g.fillStyle = e.party ? '#7cf59a' : e.f ? FACTIONS[e.f].color : '#fff';
      g.fillRect(px - 1, py - 1, 2, 2);
    }
    if (snap?.me) {
      const [px, py] = pt(snap.me.x, snap.me.y);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(px, py, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    void party;
  }, [snap, party]);
  return <canvas ref={ref} className="minimap" aria-label="Minimap" />;
}
