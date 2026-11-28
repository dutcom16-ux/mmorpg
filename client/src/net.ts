// Connection + client state. The server is authoritative; this module only mirrors what it pushes.
import { useSyncExternalStore } from 'react';
import type {
  ChatMsg,
  DungeonRunView,
  PartyView,
  PlayerView,
  TradeView,
  WarResultView,
  WarScheduleView,
  WorldSnap,
} from '../../shared/protocol';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'sale' | 'good';
}

export interface State {
  serverUrl: string;
  conn: 'connecting' | 'online' | 'offline';
  authed: boolean;
  checkedAuth: boolean;
  player: PlayerView | null;
  war: WarScheduleView | null;
  dungeon: DungeonRunView | null;
  trades: TradeView[];
  toasts: Toast[];
  skew: number;
  marketRev: number;
  world: Record<string, { humansOnline: number; npcs: number; hunt: number; mine: number; train: number }> | null;
  warResult: WarResultView | null;
  devTools: boolean;
  snap: WorldSnap | null;
  chat: ChatMsg[];
  chatUnread: number;
  party: PartyView | null;
  partyInvite: { from: number; name: string } | null;
}

const LS = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

export function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export function defaultServerUrl(): string {
  const saved = LS.get('cf.server');
  if (saved) return saved;
  const baked = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
  if (baked) return baked;
  if (isNativeApp()) return 'http://10.0.2.2:3000';
  if (location.port === '5173') return `${location.protocol}//${location.hostname}:3000`;
  return location.origin;
}

let state: State = {
  serverUrl: defaultServerUrl(),
  conn: 'connecting',
  authed: false,
  checkedAuth: false,
  player: null,
  war: null,
  dungeon: null,
  trades: [],
  toasts: [],
  skew: 0,
  marketRev: 0,
  world: null,
  warResult: null,
  devTools: false,
  snap: null,
  chat: [],
  chatUnread: 0,
  party: null,
  partyInvite: null,
};
const subs = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export function getState() {
  return state;
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => sel(state),
  );
}

export function serverNow() {
  return Date.now() + state.skew;
}

let toastSeq = 1;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: toastSeq++, text, kind };
  set({ toasts: [...state.toasts, t].slice(-3) });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 5000 : 3500);
}

// ------------------------------------------------------------ connection
// Plain WebSocket at <server>/ws carrying JSON messages (see server/src/game.ts for the protocol).

interface Wire {
  ws: WebSocket | null;
  url: string;
  manual: boolean;
  open: boolean;
  authed: boolean;
  retry: number;
  queue: string[];
}
let wire: Wire | null = null;
let rpcSeq = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: any }>();

/** Snapshot buffer for the renderer: [previous, latest] with local receive times. */
export const snaps: Array<{ at: number; s: WorldSnap }> = [];
const snapListeners = new Set<(s: WorldSnap) => void>();
export function onSnap(fn: (s: WorldSnap) => void) {
  snapListeners.add(fn);
  return () => snapListeners.delete(fn);
}

function wsUrl(url: string) {
  return url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
}

function handleEvent(e: string, d: any) {
  switch (e) {
    case 'player':
      set({ player: d, authed: true, skew: d.serverNow - Date.now() });
      break;
    case 'war':
      set({ war: d, skew: d.serverNow - Date.now() });
      break;
    case 'dungeon':
      set({ dungeon: d });
      break;
    case 'trades':
      set({ trades: d });
      break;
    case 'market':
      set({ marketRev: state.marketRev + 1 });
      break;
    case 'world':
      set({ world: d });
      break;
    case 'toast':
      toast(d.text, d.kind ?? 'info');
      break;
    case 'warResult': {
      const me = state.player?.character.id;
      if (me && d.players.some((p: any) => p.charId === me)) set({ warResult: d });
      break;
    }
    case 'clock':
      rpc('war.schedule').then((w) => set({ war: w })).catch(() => {});
      break;
    case 'snap':
      snaps.push({ at: performance.now(), s: d });
      if (snaps.length > 3) snaps.shift();
      set({ snap: d });
      snapListeners.forEach((f) => f(d));
      break;
    case 'chatHistory':
      set({ chat: d });
      break;
    case 'chat':
      set({ chat: [...state.chat, d].slice(-100), chatUnread: state.chatUnread + 1 });
      break;
    case 'party':
      set({ party: d });
      break;
    case 'partyInvite':
      set({ partyInvite: d });
      break;
    case 'loot': {
      const parts = [d.exp ? `+${d.exp} EXP` : '', d.gold ? `+${d.gold} Gold` : '', ...d.items].filter(Boolean);
      toast(`${d.monster ? `${d.monster}: ` : ''}${parts.join(', ')}${d.shared ? ' (party share)' : ''}`, 'good');
      if (d.levelUps) toast(`Level up! You are now level ${(state.player?.character.level ?? 0) + d.levelUps}.`, 'good');
      break;
    }
  }
}

function openSocket(w: Wire) {
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(w.url));
  } catch {
    set({ conn: 'offline' });
    return scheduleReconnect(w);
  }
  w.ws = ws;
  let sentAuth = false;
  ws.onmessage = (ev) => {
    let m: any;
    try {
      m = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (m.t === 'hello') {
      const token = LS.get('cf.token');
      if (token && !sentAuth) {
        sentAuth = true;
        ws.send(JSON.stringify({ t: 'auth', token }));
        return;
      }
      w.open = true;
      w.retry = 0;
      w.authed = m.authed;
      set({ conn: 'online', skew: m.serverNow - Date.now(), authed: m.authed, checkedAuth: true });
      if (!m.authed && token) LS.set('cf.token', null);
      const q = w.queue;
      w.queue = [];
      for (const raw of q) ws.send(raw);
      rpc<{ devTools: boolean }>('server.info').then((i) => set({ devTools: i.devTools })).catch(() => {});
      if (m.authed) retryPendingClaim();
    } else if (m.t === 'res') {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.data);
        else p.reject(new Error(m.error));
      }
    } else if (m.t === 'ev') handleEvent(m.e, m.d);
  };
  ws.onclose = () => {
    w.open = false;
    if (wire !== w) return;
    set({ conn: w.manual ? state.conn : 'offline' });
    if (!w.manual) scheduleReconnect(w);
  };
  ws.onerror = () => {};
}

function scheduleReconnect(w: Wire) {
  const delay = Math.min(4000, 600 * 2 ** w.retry++);
  setTimeout(() => {
    if (wire === w && !w.manual && !w.open) openSocket(w);
  }, delay);
}

export function connect(url = state.serverUrl) {
  if (wire) {
    wire.manual = true;
    wire.ws?.close();
  }
  set({ serverUrl: url, conn: 'connecting', checkedAuth: false });
  wire = { ws: null, url, manual: false, open: false, authed: false, retry: 0, queue: [] };
  openSocket(wire);
}

let heartbeat: any = null;
function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    if (wire?.open) wire.ws?.send('{"t":"ping"}');
  }, 30_000);
}
startHeartbeat();

export function setServerUrl(url: string) {
  const clean = url.trim().replace(/\/+$/, '');
  LS.set('cf.server', clean);
  connect(clean);
}

export function rpc<T = any>(method: string, params: any = {}, timeoutMs = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!wire) return reject(new Error('Not connected.'));
    const id = rpcSeq++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The server did not answer. Check your connection.'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const raw = JSON.stringify({ t: 'rpc', id, m: method, p: params });
    if (wire.open) wire.ws!.send(raw);
    else wire.queue.push(raw);
  });
}

/** rpc() that shows errors as toasts and returns null on failure. */
export async function act<T = any>(method: string, params: any = {}, success?: string): Promise<T | null> {
  try {
    const r = await rpc<T>(method, params);
    if (success) toast(success, 'good');
    return r;
  } catch (e) {
    toast((e as Error).message, 'error');
    return null;
  }
}

export async function signIn(method: 'auth.login' | 'auth.register', params: any) {
  const r = await rpc<{ token: string }>(method, params);
  LS.set('cf.token', r.token);
  set({ authed: true });
  return r;
}

export function signOut() {
  const token = LS.get('cf.token');
  rpc('auth.logout', { token }).catch(() => {});
  LS.set('cf.token', null);
  set({ authed: false, player: null, dungeon: null, trades: [], warResult: null, snap: null, chat: [], party: null });
  connect();
}

export function dismissWarResult() {
  const r = state.warResult;
  if (r) rpc('war.seen', { warId: r.warId }).catch(() => {});
  set({ warResult: null });
}
export function showWarResult(r: WarResultView) {
  set({ warResult: r });
}
export function clearDungeon() {
  set({ dungeon: null });
}
export function setDungeon(d: DungeonRunView) {
  set({ dungeon: d });
}

// ---------------------------------------------------------------- claims

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Claims idle rewards. The claim id is saved before sending, so if the app is closed or the
 * connection drops before the answer arrives, the same id is retried on reconnect and the
 * server returns the original result instead of paying again.
 */
export async function claimIdle(): Promise<any | null> {
  const id = LS.get('cf.pendingClaim') ?? newId();
  LS.set('cf.pendingClaim', id);
  try {
    const r = await rpc('idle.claim', { claimId: id });
    LS.set('cf.pendingClaim', null);
    return r;
  } catch (e) {
    const msg = (e as Error).message;
    if (!/did not answer/.test(msg)) LS.set('cf.pendingClaim', null);
    toast(msg, 'error');
    return null;
  }
}

function retryPendingClaim() {
  const id = LS.get('cf.pendingClaim');
  if (!id) return;
  rpc('idle.claim', { claimId: id })
    .then(() => LS.set('cf.pendingClaim', null))
    .catch(() => LS.set('cf.pendingClaim', null));
}

export async function setActivity(activity: string, zone = 'quarry') {
  return act('idle.set', { activity, zone, claimId: newId() });
}

// Resync when the app comes back to the foreground (phone unlocked, tab re-opened).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !wire) return;
  if (!wire.open) {
    wire.retry = 0;
    if (!wire.ws || wire.ws.readyState > 1) openSocket(wire);
  } else if (state.authed) {
    rpc<PlayerView>('player.get').then((p) => set({ player: p, skew: p.serverNow - Date.now() })).catch(() => {});
    rpc<WarScheduleView>('war.schedule').then((w) => set({ war: w })).catch(() => {});
  }
});

export function clearPartyInvite() {
  set({ partyInvite: null });
}
export function markChatRead() {
  set({ chatUnread: 0 });
}
