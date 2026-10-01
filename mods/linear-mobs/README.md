# Linear Mobs

Open tickets from the local sync server become talkable rAthena NPCs on
`ro_isle`. This is a generated snapshot, not a live game-server connection:
rAthena cannot fetch the local HTTP API. The client overlay remains available
as optional debug UI, but talking to an NPC works without opening it.

The snapshot places up to 100 tickets in a 10 by 10 grid. It leaves the center
of the north-south entrance route open, reserves the landing, return NPC, and
walk-over square, and uses walkable `ro_isle` tiles only. Priority 1 tickets
come first, followed by other priorities and ticket ID. Unused slots have no
NPC. Each NPC shows ID, full title, Linear workflow status, priority, assignee,
up to three recent comments, and the Linear URL when available. The map is
clear of ambient monster spawns so ticket NPCs are easier to find.

## NPC appearance

Status is matched case-insensitively against Linear's workflow name. Unknown
open status names use the Todo look. An asterisk in the name prefix means the
ticket has a linked open PR.

| Status | No open PR | Open PR |
|---|---|---|
| Todo / Backlog / Triage | `[T]` · `4_M_SAGE_A` | `[T*]` · `4_M_SAGE_C` |
| In Progress | `[P]` · `4_M_ALCHE_A` | `[P*]` · `4_M_ALCHE_C` |
| In Review / Code Review / QA / Testing | `[R]` · `4_M_KNIGHT_BLACK` | `[R*]` · `4_M_KNIGHT_GOLD` |
| Other open (for example Blocked) | `[?]` · `4_F_KAFRA1` | `[?*]` · `4_M_CRU` |

The generator keeps display names ASCII-only and within rAthena's 23-byte
`NAME_LENGTH`, stripping emoji and header delimiters (including apostrophes).
Short prefixes and varied stock sprites help identify tickets at the client's
fixed draw distance; this mod does not change that distance.

Talking to a ticket first shows a readable summary, then offers **Show Linear
link**, **Show PR link**, **Recent comments**, or **Leave**. This is a native
rAthena dialog and does not require the debug overlay.

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
   unavailable. When `--output` points at `state/modbuild/npc/linear-mobs/tickets.txt`,
   it also mirrors the snapshot to `state/mods/linear-mobs/npc/tickets.txt` so
   the next stack assemble does not replace live tickets with the bundled empty
   stub (assemble rebuilds `modbuild` from `state/mods` every start).
4. In game, run `@reloadscript` as a GM. Alternatively, restart the server
   after generation. Then take Ferryman Osric from Prontera or run
   `@warp ro_isle 40 40` as a GM.

The outbound ferry does not change the character savepoint. Near the island
landing, talk to **Isle Ferryman** and choose **Back to Prontera?**, or walk
over the small return square beside him. Both routes set the savepoint to
Prontera `154,178` before warping. A character already on `ro_isle` can use
either route; a GM can also use `@warp prontera 154 178`.

Regenerate and run `@reloadscript` whenever you want to refresh the island.
Webhook changes update sync's memory cache; they do not despawn or replace
in-world NPCs until you regenerate and reload. Tickets beyond the 100-slot cap
are omitted, with the exact omitted count reported by the generator.

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
entities. The ticket list is a snapshot capped at 100 entries and needs an
explicit generation plus `@reloadscript` to change. There is no live webhook
despawn, write action, GitHub PR badge, or multi-member island yet.
