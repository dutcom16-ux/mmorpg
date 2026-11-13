// Runs server/worker.js on your own computer without Cloudflare: serves public/ and the /ws/ rooms.
// Usage: node tools/local-server.mjs [port]      (needs the "ws" package: npm i ws)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let WS; try { WS = require('ws'); } catch (e) { WS = require(process.env.WS_PATH || 'ws'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +process.argv[2] || 8787;

// a tiny stand-in for 'cloudflare:workers', so the real worker file runs unchanged
const shim = path.join(root, '.wrangler', 'local');
fs.mkdirSync(shim, { recursive: true });
fs.writeFileSync(path.join(shim, 'worker.mjs'),
  fs.readFileSync(path.join(root, 'server/worker.js'), 'utf8')
    .replace(/import\s*\{\s*DurableObject\s*\}\s*from\s*'cloudflare:workers';/, 'export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}'));
const mod = await import(pathToFileURL(path.join(shim, 'worker.mjs')).href + '?' + Date.now());
const GameRoom = mod.GameRoom;

/* accounts: the real AccountStore over an in-memory copy of a Durable Object's storage (saved to .wrangler/local) */
const saveFile = path.join(shim, 'accounts.json');
const mem = new Map(Object.entries(fs.existsSync(saveFile) ? JSON.parse(fs.readFileSync(saveFile, 'utf8')) : {}));
let saveT = 0;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFileSync(saveFile, JSON.stringify(Object.fromEntries(mem))), 200); };
const storage = {
  async get(k) { if (Array.isArray(k)) { const r = new Map(); for (const x of k) if (mem.has(x)) r.set(x, structuredClone(mem.get(x))); return r; }
    return mem.has(k) ? structuredClone(mem.get(k)) : undefined; },
  async put(k, v) { mem.set(k, structuredClone(v)); persist(); },
  async delete(k) { const r = mem.delete(k); persist(); return r; },
};
// GameMasters: GM_USERS from the environment, else the "vars" in wrangler.jsonc (as on Cloudflare)
const vars = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '')).vars || {}; } catch (e) { return {}; } })();
const GM_USERS = process.env.GM_USERS ?? vars.GM_USERS ?? '';
const accounts = new mod.AccountStore({ storage }, { GM_USERS });
const env = { ACCOUNTS: { idFromName: () => 'main', get: () => accounts }, GM_USERS };

const rooms = new Map();
function room(name) {
  if (rooms.has(name)) return rooms.get(name);
  const sockets = new Set();
  const ctx = {
    acceptWebSocket(s) { sockets.add(s); },
    getWebSockets() { return [...sockets].filter(s => s.readyState <= 1); },
  };
  const obj = new GameRoom(ctx, env);
  const r = { obj, sockets }; rooms.set(name, r); return r;
}
// wraps a real socket with the hibernation-API calls the worker uses
function wrap(raw) {
  let att = null;
  return { raw, get readyState() { return raw.readyState; },
    serializeAttachment(v) { att = JSON.parse(JSON.stringify(v)); }, deserializeAttachment() { return att; },
    send(t) { raw.send(t); }, close(c, r) { try { raw.close(c, r); } catch (e) {} } };
}

const types = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') { res.end('ok'); return; }
  if (u.pathname.startsWith('/api/')) {          // the real worker routing (CORS, OPTIONS) and the real AccountStore
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('CF-Connecting-IP', req.socket.remoteAddress || 'local');
    const r = await mod.default.fetch(new Request('http://localhost' + req.url, { method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join(root, 'public', decodeURIComponent(u.pathname));
  if (!f.startsWith(path.join(root, 'public'))) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const wss = new WS.WebSocketServer({ noServer: true });
server.on('upgrade', (req, sock, head) => {
  const u = new URL(req.url, 'http://x');
  const name = u.pathname.startsWith('/ws/') ? u.pathname.slice(4) || 'world' : null;
  if (!name || !/^[a-z0-9_-]{1,32}$/.test(name)) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, raw => {
    const r = room(name), w = wrap(raw);
    // mirror GameRoom.fetch: same id, same hello, same room limit
    globalThis.WebSocketPair = function () { return { 0: w, 1: w }; };
    // GameRoom.fetch runs straight through (no awaits), so the stand-in Response is only swapped in for that call
    const Resp = globalThis.Response;
    globalThis.Response = function (body, init) { return { status: init && init.status, body }; };
    let p; try { p = r.obj.fetch({ headers: new Map() }); } finally { globalThis.Response = Resp; }
    Promise.resolve(p).then(resp => {
      if (resp.status !== 101) { raw.close(1013, String(resp.body || 'refused')); return; }
      raw.on('message', (data, isBinary) => r.obj.webSocketMessage(w, isBinary ? data : data.toString()));
      raw.on('close', code => { r.sockets.delete(w); r.obj.webSocketClose(w, code); });
      raw.on('error', () => { r.sockets.delete(w); r.obj.webSocketError(w); });
    });
  });
});
server.listen(port, () => console.log(`MMORPG ONLINE local server on http://localhost:${port}  (rooms at ws://localhost:${port}/ws/world)`));
