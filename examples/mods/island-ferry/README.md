# island-ferry

A way into the island from a map people are already standing on. Trivial once
[custom-map](../custom-map) works and impossible before it, which is why it is
its own folder.

**Install `custom-map` first.** Without it there is no `ro_isle` to go to, and
the failure is loud in a useful way: `warp` reports the map is unknown, and the
NPC's `warp` command fails at runtime with the map name in the map server log.

Outbound is **Ferryman Osric** only (`prontera 155 178` in `npc/ferry.txt`) —
talk to take the boat. There is no walk-over jetty warp; that duplicated the
same trip next to Osric.

Together with `custom-map`, the round trip is: Osric → island landing at
`ro_isle 40 40` → visible Isle Ferryman / return square just south of the
landing → Prontera `154,178`. The outbound ferry does not change the
savepoint. Both island return routes set it to Prontera before warping, so
normal logins and new characters continue to start from Prontera. If a
character is already on the island, talk to Isle Ferryman or walk over the
nearby return square.

## What to look at first

`close2` before `warp`, in the NPC. `close` waits for the player to dismiss the
dialogue and *then* ends the script; `close2` closes the box and keeps running,
which is what you want when the next thing you do is move the player. Using
`close` here leaves the script sitting on a box that is already gone.

## Applying it

`npc/` is read when the **server** starts.
