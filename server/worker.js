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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const room = url.pathname.slice(4) || 'world';
      if (!/^[a-z0-9_-]{1,32}$/.test(room)) return new Response('Bad room name', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
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
