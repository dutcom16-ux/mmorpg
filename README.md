# MMORPG ONLINE: game + multiplayer server

This repository runs the whole game on **Cloudflare Workers**:

- `public/` holds the game itself (index.html plus the art in `public/a/`).
- `server/worker.js` is the multiplayer server. One Durable Object called `GameRoom` relays every player's position, attacks, chat and the shared monsters.
- `wrangler.jsonc` tells Cloudflare how to put the two together.

Players open your `https://mmorpg.<your-name>.workers.dev` link, sign in, and see each other. Nobody needs an account anywhere except you.

## Put it online (first time)

1. These files live in your GitHub repository **dutcom16-ux/mmorpg**, at the top level.
2. Go to <https://dash.cloudflare.com> and open **Workers & Pages**.
3. Click **Create application**, then **Import a repository** (it may say "Continue with GitHub").
4. Pick **dutcom16-ux / mmorpg**. If it asks for access, allow Cloudflare to see that repository.
5. Keep the project name **mmorpg**. It has to match `"name"` in `wrangler.jsonc`.
6. Leave the build command empty. The deploy command should be `npx wrangler deploy`, which is the default.
7. Click **Deploy**. After about a minute you get a link ending in `.workers.dev`. Send that link to your testers.

Every later push to the `main` branch redeploys automatically.

## The Vercel link

The same repository also deploys to Vercel. `vercel.json` tells Vercel to serve `public/` with no build step.

In the Vercel project, open **Settings → Git** and connect **dutcom16-ux/mmorpg**.

Vercel can't run the server itself. The game finds the server through this line in `public/index.html`:

```html
<meta name="mmo-server" content="wss://mmorpg.iamjohnwoo12.workers.dev/ws/world">
```

Because of that line, players on the Vercel link and the Cloudflare link share one world.

## Updating the game

1. Rebuild the game in the main project: `python3 -I tools/inline_assets.py` writes `dist/web/`.
2. Copy it in: `./tools/update-game.sh /path/to/game-project/dist/web`.
3. Commit and push. Cloudflare redeploys by itself.

## Cost

Everything here fits the **free Workers plan**:

- 100,000 requests a day.
- 13,000 GB-seconds of Durable Object time a day.
- Every 20 game messages count as 1 request.

The game sends about 10 messages a second per player. That works out to roughly **50 player-hours a day** for free, for example 5 testers playing 10 hours each. The $5/month Workers Paid plan raises this a lot if you ever need more.

## How multiplayer works

- Each player's game sends a small status packet to the room about 10 times a second: name, map, position, HP, recent attacks and chat. The server passes it on to everyone else.
- On each map, one player's game runs the monsters and shares their positions; that player is the "host". If the host leaves, the next player takes over within about 2 seconds.
- Everyone who damages a monster gets the full EXP and drops.
- Characters, items and passwords stay in each player's own browser. The server never sees passwords and stores nothing permanently.
- If the server restarts, games reconnect by themselves. The status pill shows "Reconnecting…" meanwhile.

The game picks its server like this:

1. `?server=wss://...` in the address, if present.
2. Otherwise `<meta name="mmo-server" content="wss://...">` in index.html, if present.
3. Otherwise `/ws/world` on the same site it was loaded from.

If it finds no server (for example on Vercel or a plain file host), it plays single-player.

## Try it on your own computer

- `npm install`, then `npx wrangler dev`: runs the real Cloudflare setup locally at <http://localhost:8787>.
- Or `npm i ws`, then `node tools/local-server.mjs`: a small stand-in that runs the same server code without Cloudflare.

Because of the `mmo-server` line, a local copy joins the **live** world by default. To test against your local server instead, open <http://localhost:8787/?server=ws://localhost:8787/ws/world> in two browser windows, using a private window for the second player.

## Limits

- 200 players per room (`MAX_PLAYERS` in `server/worker.js`).
- Each status packet can be up to 6,000 characters.
