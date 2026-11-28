// Cloudflare Workers host. The Worker serves the built client from static assets and forwards
// /ws (and /health) to one Durable Object, "veyra", which owns the whole game: it keeps the
// SQLite database in its built-in storage, holds every player's WebSocket, and runs the 10 Hz
// game loop while anyone is connected. When nobody is online, a storage alarm wakes it for
// scheduled Chip Wars and to finish wars and dungeon runs, whose progress is computed from time.
import { configure, log } from './config';
import { useBackend } from './db';
import { durableObjectBackend, type DoStorage } from './db-do';
import { closeConn, connCount, handleMessage, initGame, nextWakeAt, openConn, tick } from './game';
import { clock } from './clock';
import { installWorld } from './world/world';
import { manilaString } from '../../shared/time';

interface Env {
  GAME: { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } };
  ASSETS: { fetch(req: Request): Promise<Response> };
  [key: string]: unknown;
}

interface DOState {
  storage: DoStorage & { setAlarm(at: number): Promise<void> };
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

declare const WebSocketPair: { new (): { 0: CfWebSocket; 1: CfWebSocket } };
interface CfWebSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message' | 'close' | 'error', fn: (ev: any) => void): void;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws' || url.pathname === '/health') {
      const stub = env.GAME.get(env.GAME.idFromName('veyra'));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

export class GameDO {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private ctx: DOState,
    env: Env,
  ) {
    configure(env);
    void ctx.blockConcurrencyWhile(async () => {
      useBackend(durableObjectBackend(ctx.storage));
      installWorld();
      await initGame();
      await this.scheduleAlarm();
      log('Chipfall Durable Object ready');
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, serverNow: clock.now(), manilaNow: manilaString(clock.now()), online: connCount() }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const conn = openConn(
      (text) => server.send(text),
      () => server.close(1000, 'closed'),
    );
    server.addEventListener('message', (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
      void handleMessage(conn, text);
    });
    let closed = false;
    const onClose = () => {
      if (closed) return;
      closed = true;
      closeConn(conn);
      if (connCount() === 0) this.idle();
    };
    server.addEventListener('close', onClose);
    server.addEventListener('error', onClose);
    if (!this.timer) this.timer = setInterval(() => tick(), 100);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: CfWebSocket });
  }

  async alarm() {
    tick();
    if (connCount() === 0) await this.scheduleAlarm();
  }

  private idle() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    void this.scheduleAlarm();
  }

  private async scheduleAlarm() {
    await this.ctx.storage.setAlarm(nextWakeAt());
  }
}
