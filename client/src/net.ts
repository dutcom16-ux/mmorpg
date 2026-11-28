// Connection + client state. The server is authoritative; this module only mirrors what it pushes.
import { io, type Socket } from 'socket.io-client';
import { useSyncExternalStore } from 'react';
import type {
  DungeonRunView,
  PlayerView,
  RpcResult,
  TradeView,
  WarResultView,
  WarScheduleView,
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

let socket: Socket | null = null;

export function connect(url = state.serverUrl) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  set({ serverUrl: url, conn: 'connecting', checkedAuth: false });
  const token = LS.get('cf.token');
  const s = io(url, { transports: ['websocket'], auth: token ? { token } : {}, reconnectionDelay: 800, reconnectionDelayMax: 4000 });
  socket = s;
  s.on('connect', () => set({ conn: 'online' }));
  s.on('disconnect', () => set({ conn: 'offline' }));
  s.on('connect_error', () => set({ conn: 'offline' }));
  s.on('hello', (h: { serverNow: number; authed: boolean }) => {
    set({ skew: h.serverNow - Date.now(), authed: h.authed, checkedAuth: true });
    if (!h.authed && LS.get('cf.token')) {
      // Token no longer valid on this server.
      LS.set('cf.token', null);
      s.auth = {};
    }
    rpc<{ devTools: boolean }>('server.info').then((i) => set({ devTools: i.devTools })).catch(() => {});
    if (h.authed) retryPendingClaim();
  });
  s.on('player', (p: PlayerView) => set({ player: p, authed: true, skew: p.serverNow - Date.now() }));
  s.on('war', (w: WarScheduleView) => set({ war: w, skew: w.serverNow - Date.now() }));
  s.on('dungeon', (d: DungeonRunView) => set({ dungeon: d }));
  s.on('trades', (t: TradeView[]) => set({ trades: t }));
  s.on('market', () => set({ marketRev: state.marketRev + 1 }));
  s.on('world', (w: State['world']) => set({ world: w }));
  s.on('toast', (t: { text: string; kind?: Toast['kind'] }) => toast(t.text, t.kind ?? 'info'));
  s.on('warResult', (r: WarResultView) => {
    const me = state.player?.character.id;
    if (me && r.players.some((p) => p.charId === me)) set({ warResult: r });
  });
  s.on('clock', () => {
    rpc('war.schedule').then((w) => set({ war: w })).catch(() => {});
  });
}

export function setServerUrl(url: string) {
  const clean = url.trim().replace(/\/+$/, '');
  LS.set('cf.server', clean);
  connect(clean);
}

export function rpc<T = any>(method: string, params: any = {}, timeoutMs = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Not connected.'));
    const t = setTimeout(() => reject(new Error('The server did not answer. Check your connection.')), timeoutMs);
    socket.emit('rpc', method, params, (r: RpcResult<T>) => {
      clearTimeout(t);
      if (r.ok) resolve(r.data);
      else reject(new Error(r.error));
    });
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
  if (socket) socket.auth = { token: r.token };
  set({ authed: true });
  return r;
}

export function signOut() {
  const token = LS.get('cf.token');
  rpc('auth.logout', { token }).catch(() => {});
  LS.set('cf.token', null);
  set({ authed: false, player: null, dungeon: null, trades: [], warResult: null });
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
  if (document.visibilityState !== 'visible' || !socket) return;
  if (!socket.connected) socket.connect();
  else if (state.authed) {
    rpc<PlayerView>('player.get').then((p) => set({ player: p, skew: p.serverNow - Date.now() })).catch(() => {});
    rpc<WarScheduleView>('war.schedule').then((w) => set({ war: w })).catch(() => {});
  }
});
