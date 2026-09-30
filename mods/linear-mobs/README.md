# Linear Mobs

Open tickets from the local sync server become talkable rAthena NPCs on
`ro_isle`. This is a generated snapshot, not a live game-server connection:
rAthena cannot fetch the local HTTP API. The client overlay remains available
as optional debug UI, but talking to an NPC works without opening it.

The snapshot places up to 24 tickets in a 6 by 4 grid. Priority 1 tickets come
first, followed by other priorities and ticket ID. Unused slots have no NPC.
All tickets use the same stock sage sprite. Each NPC shows ID, full title,
Linear workflow status, priority, assignee, up to three recent comments, and
the Linear URL when available. The map is intentionally clear of ambient
monster spawns so ticket NPCs are easy to find.

## Enable the personal island

The `custom-map`, `island-ferry`, and `linear-mobs` folders are included under
`mods/`. They default to off so the island is opt-in.

1. In **Settings → Mods**, enable **Custom Map**, **Island Ferry**, and
   **Linear Mobs**. `Island Ferry` requires `Custom Map`; `Linear Mobs`
   requires `Custom Map` and `Shared`.
2. Restart the app/server so the map geometry, ferry and NPC script path are
   staged. Start the local sync server from the repository's `sync/` folder:

   ```sh
   cd sync
   LINEAR_API_KEY=your_linear_api_key npm run sync:dev
   ```

   Keep the key in the sync server environment; it is never sent to the game.
   Without a key, sync serves its in-memory fixture tickets.
3. Generate the NPC snapshot after the game server has built the enabled mods.
   For a packaged Mac install:

   ```sh
   cd sync
   npm run sync:island -- --output "$HOME/Library/Application Support/Ragnarok Offline/state/modbuild/npc/linear-mobs/tickets.txt"
   ```

   For a source checkout, run from the repository root and use its default
   state path (or the state override used by the app):

   ```sh
   npm run --prefix sync sync:island -- --output "${RAGNAROKMAC_STATE:-$PWD/.ragnarokmac}/modbuild/npc/linear-mobs/tickets.txt"
   ```

   On a packaged Mac install with a custom `RAGNAROKMAC_STATE`, substitute
   `$RAGNAROKMAC_STATE/modbuild/npc/linear-mobs/tickets.txt` for the default
   path above. The generator reads only `GET /linear/tickets?status=open`,
   writes atomically, and leaves the last working snapshot alone if sync is
   unavailable.
4. In game, run `@reloadscript` as a GM. Alternatively, restart the server
   after generation. Then take Ferryman Osric from Prontera or run
   `@warp ro_isle 40 40` as a GM.

Regenerate and run `@reloadscript` whenever you want to refresh the island.
Webhook changes update sync's memory cache; they do not despawn or replace
in-world NPCs until you regenerate and reload. Tickets beyond the 24-slot cap
are omitted, with the number reported by the generator.

## Verify

Start `sync:dev`, then check the list and status:

```sh
curl http://127.0.0.1:8787/health
curl 'http://127.0.0.1:8787/linear/tickets?status=open'
```

Run the generator and check its `Wrote N ticket NPCs` output, enter `ro_isle`,
confirm the NPCs are laid out in rows, and click one. Its native NPC dialog
should show the ticket details even if you never open the **Linear tasks**
debug overlay. The overlay still lists tickets and offers the richer details
panel.

## Limits

This v1 uses real rAthena script NPCs; it does not create client-side fake
entities. The ticket list is a snapshot capped at 24 entries and needs an
explicit generation plus `@reloadscript` to change. There is no live webhook
despawn, write action, GitHub PR badge, or multi-member island yet.
