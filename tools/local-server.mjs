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

const rooms = new Map();
function room(name) {
  if (rooms.has(name)) return rooms.get(name);
  const sockets = new Set();
  const ctx = {
    acceptWebSocket(s) { sockets.add(s); },
    getWebSockets() { return [...sockets].filter(s => s.readyState <= 1); },
  };
  const obj = new GameRoom(ctx, {});
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
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') { res.end('ok'); return; }
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
    const orig = r.obj.ctx.acceptWebSocket;
    globalThis.WebSocketPair = function () { return { 0: w, 1: w }; };
    const Resp = globalThis.Response;
    globalThis.Response = function (body, init) { return { status: init && init.status, body }; };
    Promise.resolve(r.obj.fetch({ headers: new Map() })).then(resp => {
      globalThis.Response = Resp;
      if (resp.status !== 101) { raw.close(1013, String(resp.body || 'refused')); return; }
      raw.on('message', (data, isBinary) => r.obj.webSocketMessage(w, isBinary ? data : data.toString()));
      raw.on('close', code => { r.sockets.delete(w); r.obj.webSocketClose(w, code); });
      raw.on('error', () => { r.sockets.delete(w); r.obj.webSocketError(w); });
    });
  });
});
server.listen(port, () => console.log(`MMORPG ONLINE local server on http://localhost:${port}  (rooms at ws://localhost:${port}/ws/world)`));
