# Linear Mobs

Client plugins can only import files inside their own `client/` folder, so this mod vendors `sync-fetch.js` next to `index.js` (same helper as `mods/shared`).

Linear Mobs shows your open Linear tickets in-game and lets you inspect each
ticket. In v0, this is an interim HTML overlay with a ticket list and details
dialog. It does **not** spawn dynamic world Mob entities: the roBrowser client
API does not expose an entity-spawn API, and static rAthena NPCs cannot track
the live ticket list. The overlay is the testable step toward later island
spawns.

## Enable

1. Start the local sync server with your Linear API key:

   ```sh
   cd sync
   LINEAR_API_KEY=your_linear_api_key npm run sync:dev
   ```

   Or export `LINEAR_API_KEY` in the shell before starting the server. Keep the
   key in the sync server environment; it is not used by the client mod.
2. Install or copy `mods/shared/` and `mods/linear-mobs/` into
   `~/Library/Application Support/Ragnarok Offline/state/mods/`.
3. In the app, open **Settings → Mods** and enable **Shared** and **Linear Mobs**.

The sync server uses the authenticated user's assigned, non-completed tickets
by default. Without `LINEAR_API_KEY`, it serves fixture tickets instead.

## Verify

With the server running, these requests should return HTTP 200 and JSON:

```sh
curl http://127.0.0.1:8787/health
curl 'http://127.0.0.1:8787/linear/tickets?status=open'
```

Look for **Linear tasks** (bottom-left; Display is bottom-right). Open the ticket list and select a ticket to inspect its ID, title,
status, priority, assignee, recent comments, and Linear URL when available.
The list refreshes every 60 seconds and when the app regains focus or the map
changes. If the sync server is unavailable, the mod logs a warning, shows an
empty list, and remains usable without crashing; start the server and refresh
or wait for the next refresh to load tickets.
