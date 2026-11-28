// Local Node.js host: serves the built web client and the game over WebSockets at /ws,
// with node:sqlite storage. Used for local play, LAN/phone testing and the automated tests.
//   npm run server -- --port=3000 --db=data/chipfall.db
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { manilaString } from '../../shared/time';
import { clock } from './clock';
import { config, configure, log } from './config';
import { closeDb, useBackend } from './db';
import { nodeSqliteBackend } from './db-node';
import { closeConn, handleMessage, initGame, openConn, tick } from './game';
import { installWorld } from './world/world';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const port = Number(arg('port') ?? process.env.PORT ?? 3000);
const host = arg('host') ?? process.env.HOST ?? '0.0.0.0';
const dbPath = path.resolve(ROOT, arg('db') ?? process.env.DB_PATH ?? 'data/chipfall.db');
const clientDist = path.resolve(ROOT, process.env.CLIENT_DIST ?? 'client/dist');

configure({ ...process.env, DEV_TOOLS: arg('dev') ?? process.env.DEV_TOOLS, QUIET: process.argv.includes('--quiet') ? '1' : process.env.QUIET });
useBackend(nodeSqliteBackend(dbPath));
installWorld();
await initGame();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, serverNow: clock.now(), manilaNow: manilaString(clock.now()) }));
    return;
  }
  let file = path.join(clientDist, decodeURIComponent(url.pathname));
  if (!file.startsWith(clientDist)) return void res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(clientDist, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h1>Chipfall server is running</h1><p>Build the web client with <code>npm run build:web</code>, or use <code>npm run dev:web</code>.</p>');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  const conn = openConn(
    (text) => ws.readyState === ws.OPEN && ws.send(text),
    () => ws.close(),
  );
  ws.on('message', (data) => void handleMessage(conn, String(data)));
  ws.on('close', () => closeConn(conn));
  ws.on('error', () => {});
});

const timer = setInterval(tick, 100);

server.listen(port, host, () => {
  log(`Chipfall server listening on http://localhost:${port}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets ?? []) if (n.family === 'IPv4' && !n.internal) log(`  Phone on same Wi-Fi: http://${n.address}:${port}`);
  }
  log(`  Android emulator:   http://10.0.2.2:${port}`);
  log(`Database: ${dbPath}`);
  log(`Server time: ${manilaString(clock.now())}${clock.offset() ? ` (test clock offset ${Math.round(clock.offset() / 1000)}s)` : ''}`);
  log(`Wars every ${config.warIntervalMin} min, ${config.warDurationMin} min long. Dev tools: ${config.devTools ? 'ON' : 'off'}`);
  if (process.send) process.send('ready');
});

function shutdown() {
  log('Shutting down…');
  clearInterval(timer);
  wss.close();
  server.close();
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
