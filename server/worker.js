/* MMORPG ONLINE: multiplayer server on Cloudflare Workers.

   The Worker serves the game's files from public/ and sends WebSocket connections on /ws/<room> to a
   Durable Object, one per room name (the game uses a single room, "world"). The room is a relay: each player
   sends their own state object ("presence": map, position, look, attacks, chat lines, and, from a map's host,
   the monsters) and the room forwards it to everyone else and hands the latest one of each player to
   newcomers. Game rules run in the players' games, exactly as on the claude.ai link.

   Messages (JSON text):
     server -> client  {t:'hello', me, peers:[[id, presence], ...]}   on connect
                       {t:'p', from, p}                                 someone's new presence
                       {t:'bye', from}                                  someone left
     client -> server  {t:'p', p}                                       my presence (whole object)

   Uses the WebSocket Hibernation API, so an idle room costs nothing; the players' games re-send their
   presence every couple of seconds, which rebuilds the room's memory after it wakes up. */
import { DurableObject } from 'cloudflare:workers';

const MAX_MSG = 6000;        // a presence is at most 4 KB of JSON; anything bigger is dropped
const MAX_PLAYERS = 200;

/* answers to the game's pages on other sites (the Vercel link) may be read too: sign-in uses a token, not cookies */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Max-Age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const room = url.pathname.slice(4) || 'world';
      if (!/^[a-z0-9_-]{1,32}$/.test(room)) return new Response('Bad room name', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('main')).fetch(request);
    }
    if (url.pathname === '/health') return new Response('ok');
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pres = new Map();     // player id -> latest presence (kept in memory; rebuilt from re-sends after a wake-up)
  }

  async fetch(request) {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_PLAYERS) return new Response('Room is full', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id });
    const peers = [];
    for (const ws of sockets) {
      const a = ws.deserializeAttachment();
      if (a && this.pres.has(a.id)) peers.push([a.id, this.pres.get(a.id)]);
    }
    server.send(JSON.stringify({ t: 'hello', me: id, peers }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MSG) return;
    let d;
    try { d = JSON.parse(message); } catch (e) { return; }
    const a = ws.deserializeAttachment();
    if (!a || !d || d.t !== 'p' || !d.p || typeof d.p !== 'object' || Array.isArray(d.p)) return;
    this.pres.set(a.id, d.p);
    this.broadcast(ws, JSON.stringify({ t: 'p', from: a.id, p: d.p }));
  }

  webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) {}
  }

  webSocketError(ws) { this.leave(ws); }

  leave(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return;
    this.pres.delete(a.id);
    this.broadcast(ws, JSON.stringify({ t: 'bye', from: a.id }));
  }

  broadcast(from, text) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue;
      try { ws.send(text); } catch (e) {}
    }
  }
}


/* ------------------------------- accounts -------------------------------
   Accounts and their characters, so a player can sign in on any device.

     POST /api/register {u, v}    create an account          -> {token, name}
     POST /api/login    {u, v}    sign in                    -> {token, name}
     GET  /api/chars              the account's characters   -> {chars:[{id, t, data}], gone:{id: time}}
     POST /api/chars    {put:[{id, t, data}], del:[id]}       save changed characters, delete others
     POST /api/logout             end this sign-in

   u is the username (3-16 letters, numbers or _). v is not the password: the browser stretches the password
   (PBKDF2-SHA-256, 150,000 rounds, salted with the game name and the username) and sends only that key. The server
   keeps SHA-256(random salt + v), so neither the password nor the key is ever stored. Sign-ins are random 256-bit
   tokens, kept hashed, good for 60 days (renewed while in use). 8 wrong passwords lock an account for 10 minutes;
   one network address can make 20 accounts an hour. Each character is stored on its own; the newer copy wins, and
   a deleted character can't come back from an older copy. Everything lives in one Durable Object's storage. */
const DAY = 86400000, MAX_CHARS = 4, MAX_CHAR_SIZE = 90000;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const fail = (status, error, code) => Object.assign(new Error(error), { status, code });

export class AccountStore extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname.slice(5);
    try {
      if (request.method === 'POST' && path === 'register') return await this.register(await this.body(request), request.headers.get('CF-Connecting-IP') || 'local');
      if (request.method === 'POST' && path === 'login') return await this.login(await this.body(request));
      const me = await this.who(request);
      if (!me) return json({ error: 'Please sign in again.', code: 'session' }, 401);
      if (path === 'chars' && request.method === 'GET') return await this.chars(me);
      if (path === 'chars' && request.method === 'POST') return await this.save(me, await this.body(request));
      if (path === 'logout' && request.method === 'POST') { await this.ctx.storage.delete('s:' + me.th); return json({ ok: true }); }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.status ? e.message : 'Server error', code: e.code }, e.status || 500);
    }
  }

  async body(request) {
    const t = await request.text();
    if (t.length > 600000) throw fail(413, 'Too much data.');
    try { const o = JSON.parse(t); if (o && typeof o === 'object') return o; } catch (e) {}
    throw fail(400, 'Bad request.');
  }

  check(o) {
    const u = typeof o.u === 'string' ? o.u.trim() : '', v = typeof o.v === 'string' ? o.v : '';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(u)) throw fail(400, 'Usernames are 3-16 letters, numbers or _.');
    if (!/^[0-9a-f]{64}$/.test(v)) throw fail(400, 'Bad request.');
    return { u, low: u.toLowerCase(), v };
  }

  async session(low) {
    const token = randomHex(32);
    await this.ctx.storage.put('s:' + await sha256(token), { u: low, exp: Date.now() + 60 * DAY });
    return token;
  }

  async register(o, ip) {
    const { u, low, v } = this.check(o), S = this.ctx.storage, now = Date.now();
    const lim = (await S.get('r:' + ip)) || { n: 0, t0: now };
    if (now - lim.t0 > 3600000) { lim.n = 0; lim.t0 = now; }
    if (lim.n >= 20) throw fail(429, 'Too many new accounts from here. Try again in an hour.');
    if (await S.get('a:' + low)) throw fail(409, 'That username is taken.', 'taken');
    const salt = randomHex(16);
    await S.put('a:' + low, { name: u, salt, hash: await sha256(salt + v), created: now, fails: 0, lockUntil: 0 });
    lim.n++; await S.put('r:' + ip, lim);
    return json({ token: await this.session(low), name: u });
  }

  async login(o) {
    const { low, v } = this.check(o), S = this.ctx.storage, now = Date.now();
    const a = await S.get('a:' + low);
    if (!a) throw fail(404, 'Wrong username or password.', 'nouser');
    if (a.lockUntil > now) throw fail(429, `Too many wrong tries. Try again in ${Math.ceil((a.lockUntil - now) / 60000)} minute${a.lockUntil - now > 60000 ? 's' : ''}.`);
    if (!same(await sha256(a.salt + v), a.hash)) {
      a.fails = (a.fails || 0) + 1;
      if (a.fails >= 8) { a.fails = 0; a.lockUntil = now + 600000; }
      await S.put('a:' + low, a);
      throw fail(401, 'Wrong username or password.');
    }
    a.fails = 0; a.last = now; await S.put('a:' + low, a);
    return json({ token: await this.session(low), name: a.name });
  }

  async who(request) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') || '');
    if (!m) return null;
    const th = await sha256(m[1]), s = await this.ctx.storage.get('s:' + th), now = Date.now();
    if (!s || s.exp < now) return null;
    if (s.exp - now < 30 * DAY) { s.exp = now + 60 * DAY; await this.ctx.storage.put('s:' + th, s); }
    return { u: s.u, th };
  }

  async index(u) { return (await this.ctx.storage.get('c:' + u)) || { ids: {}, gone: {} }; }

  async chars(me) {
    const ix = await this.index(me.u), keys = Object.keys(ix.ids).map(id => 'd:' + me.u + ':' + id);
    const got = keys.length ? await this.ctx.storage.get(keys) : new Map();
    const chars = [];
    for (const [, rec] of got) if (rec && rec.data) chars.push({ id: rec.data.id, t: rec.t, data: rec.data });
    return json({ chars, gone: ix.gone });
  }

  async save(me, o) {
    const S = this.ctx.storage, ix = await this.index(me.u), now = Date.now(), skipped = [];
    for (const id of Array.isArray(o.del) ? o.del.slice(0, 20) : []) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) continue;
      delete ix.ids[id]; ix.gone[id] = now; await S.delete('d:' + me.u + ':' + id);
    }
    for (const it of Array.isArray(o.put) ? o.put.slice(0, 10) : []) {
      const id = it && it.data && it.data.id, t = +it.t;
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !(t > 0) || it.id !== id) { skipped.push(id); continue; }
      if (JSON.stringify(it.data).length > MAX_CHAR_SIZE) { skipped.push(id); continue; }
      if ((ix.gone[id] || 0) >= t) { skipped.push(id); continue; }               // deleted after this copy was made
      if ((ix.ids[id] || 0) > t) { skipped.push(id); continue; }                  // a newer copy is already here
      if (!(id in ix.ids) && Object.keys(ix.ids).length >= MAX_CHARS) { skipped.push(id); continue; }
      await S.put('d:' + me.u + ':' + id, { t, data: it.data });
      ix.ids[id] = t;
    }
    await S.put('c:' + me.u, ix);
    return json({ ok: true, ids: ix.ids, skipped });
  }
}
