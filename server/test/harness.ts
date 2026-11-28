// Test harness: runs the real server as a child process and talks to it through socket.io-client,
// exactly like the Android and browser clients do.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class TestServer {
  proc: ChildProcess | null = null;
  readonly port: number;
  readonly db: string;
  constructor(port: number) {
    this.port = port;
    this.db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chipfall-test-')), 'test.db');
  }
  get url() {
    return `http://127.0.0.1:${this.port}`;
  }
  async start() {
    // Run the server in-process with the tsx loader (no wrapper process), so a SIGKILL
    // really kills the server — that is how the crash/restart test simulates a hard crash.
    this.proc = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/src/index.ts'), `--port=${this.port}`, `--db=${this.db}`, '--host=127.0.0.1'], {
      cwd: ROOT,
      env: { ...process.env, QUIET: '1', SCHEDULED_WARS: '0', WAR_TARGET_PER_FACTION: '6', NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let err = '';
    this.proc.stderr!.on('data', (d) => (err += d));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server did not start: ${err}`)), 20000);
      this.proc!.on('message', (m) => {
        if (m === 'ready') {
          clearTimeout(t);
          resolve();
        }
      });
      this.proc!.on('exit', (code) => reject(new Error(`server exited ${code}: ${err}`)));
    });
  }
  async stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    if (p.exitCode !== null || p.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => p.kill('SIGKILL'), 4000);
      p.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      p.kill(signal);
    });
  }
}

export class TestClient {
  socket: Socket;
  token: string | null = null;
  events: Record<string, any[]> = {};
  player: any = null;
  war: any = null;
  dungeon: any = null;
  trades: any[] = [];
  constructor(public url: string, public label: string) {
    this.socket = io(url, { transports: ['websocket'], autoConnect: false, reconnectionDelay: 300 });
    for (const ev of ['player', 'war', 'dungeon', 'trades', 'warResult', 'toast', 'market', 'hello']) {
      this.socket.on(ev, (data: any) => {
        (this.events[ev] ??= []).push(data);
        if (ev === 'player') this.player = data;
        if (ev === 'war') this.war = data;
        if (ev === 'dungeon') this.dungeon = data;
        if (ev === 'trades') this.trades = data;
      });
    }
  }
  /** Like the real client: keep the session token in the handshake so automatic reconnects re-authenticate. */
  setToken(token: string) {
    this.token = token;
    this.socket.auth = { token };
  }
  connect(): Promise<void> {
    this.socket.auth = this.token ? { token: this.token } : {};
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.label}: connect timeout`)), 8000);
      const onC = () => {
        clearTimeout(t);
        this.socket.off('connect', onC);
        resolve();
      };
      this.socket.on('connect', onC);
      this.socket.connect();
    });
  }
  disconnect() {
    this.socket.disconnect();
  }
  rpc<T = any>(method: string, params: any = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.label}: ${method} timed out`)), 15000);
      this.socket.emit('rpc', method, params, (r: any) => {
        clearTimeout(t);
        if (r.ok) resolve(r.data);
        else reject(new RpcError(r.error));
      });
    });
  }
  async rpcErr(method: string, params: any = {}): Promise<string> {
    try {
      await this.rpc(method, params);
    } catch (e) {
      if (e instanceof RpcError) return e.message;
      throw e;
    }
    throw new Error(`${this.label}: expected ${method} to fail`);
  }
  async login(username: string, password = 'chipfall') {
    const r = await this.rpc('auth.login', { username, password });
    this.setToken(r.token);
    await this.waitFor(() => this.player);
    return r;
  }
  async me() {
    this.player = await this.rpc('player.get');
    return this.player;
  }
  async waitFor<T>(fn: () => T | undefined | null | false, ms = 15000, what = 'condition'): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const v = fn();
      if (v) return v as T;
      await sleep(100);
    }
    throw new Error(`${this.label}: timed out waiting for ${what}`);
  }
}

export class RpcError extends Error {}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function qty(player: any, templateId: string): number {
  return player.inventory.filter((i: any) => i.templateId === templateId).reduce((s: number, i: any) => s + i.qty, 0);
}

let claimSeq = 0;
export function claimId(prefix = 'c') {
  return `${prefix}-${Date.now()}-${++claimSeq}-${Math.random().toString(36).slice(2, 8)}`;
}
