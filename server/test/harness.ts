// Test harness: runs the real server (Node host) as a child process, or targets an external
// server via TEST_URL (e.g. `wrangler dev`), and talks to it over WebSockets exactly like the
// Android and browser clients do.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EXTERNAL = process.env.TEST_URL || '';

export class TestServer {
  proc: ChildProcess | null = null;
  readonly port: number;
  readonly db: string;
  constructor(port: number) {
    this.port = port;
    this.db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chipfall-test-')), 'test.db');
  }
  get url() {
    return EXTERNAL || `http://127.0.0.1:${this.port}`;
  }
  get canRestart() {
    return !EXTERNAL;
  }
  async start() {
    if (EXTERNAL) return;
    this.proc = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/src/node.ts'), `--port=${this.port}`, `--db=${this.db}`, '--host=127.0.0.1'], {
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

export class RpcError extends Error {}

export class TestClient {
  ws: WebSocket | null = null;
  token: string | null = null;
  connected = false;
  manual = false;
  events: Record<string, any[]> = {};
  player: any = null;
  war: any = null;
  dungeon: any = null;
  trades: any[] = [];
  snap: any = null;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private helloWaiters: Array<() => void> = [];

  constructor(public url: string, public label: string) {}

  setToken(token: string) {
    this.token = token;
  }

  connect(): Promise<void> {
    this.manual = false;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.label}: connect timeout`)), 8000);
      this.helloWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
      this.open();
    });
  }

  private open() {
    const ws = new WebSocket(this.url.replace(/^http/, 'ws') + '/ws');
    this.ws = ws;
    let sentAuth = false;
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.t === 'hello') {
        if (this.token && !sentAuth) {
          sentAuth = true;
          ws.send(JSON.stringify({ t: 'auth', token: this.token }));
          return;
        }
        this.connected = true;
        const w = this.helloWaiters;
        this.helloWaiters = [];
        w.forEach((f) => f());
      } else if (m.t === 'res') {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          if (m.ok) p.resolve(m.data);
          else p.reject(new RpcError(m.error));
        }
      } else if (m.t === 'ev') {
        (this.events[m.e] ??= []).push(m.d);
        if (this.events[m.e].length > 200) this.events[m.e].shift();
        if (m.e === 'player') this.player = m.d;
        if (m.e === 'war') this.war = m.d;
        if (m.e === 'dungeon') this.dungeon = m.d;
        if (m.e === 'trades') this.trades = m.d;
        if (m.e === 'snap') this.snap = m.d;
      }
    };
    ws.onclose = () => {
      this.connected = false;
      if (!this.manual) setTimeout(() => !this.manual && this.open(), 300);
    };
    ws.onerror = () => {};
  }

  disconnect() {
    this.manual = true;
    this.connected = false;
    this.ws?.close();
  }

  /** Sends an RPC without waiting for the answer (used to simulate a crash mid-request). */
  fire(method: string, params: any = {}) {
    this.ws?.send(JSON.stringify({ t: 'rpc', id: this.seq++, m: method, p: params }));
  }

  async rpc<T = any>(method: string, params: any = {}): Promise<T> {
    await this.waitFor(() => this.connected, 15000, `${method}: connection`);
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label}: ${method} timed out`));
      }, 15000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.ws!.send(JSON.stringify({ t: 'rpc', id, m: method, p: params }));
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
      await sleep(50);
    }
    throw new Error(`${this.label}: timed out waiting for ${what}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function qty(player: any, templateId: string): number {
  return player.inventory.filter((i: any) => i.templateId === templateId).reduce((s: number, i: any) => s + i.qty, 0);
}

let claimSeq = 0;
export function claimId(prefix = 'c') {
  return `${prefix}-${Date.now()}-${++claimSeq}-${Math.random().toString(36).slice(2, 8)}`;
}
