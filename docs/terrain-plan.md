# Plan: Terrain sub-project (water, chasms, lava)

**Status (2026-10-07):** Step 1 is done and the user approved it. No CC0 set fit, so the tiles are self-made by `client/scripts/terrain-tiles.ts`. The demos are `?water`, `?chasm` and `?lava`. Next is Step 2. Where this plan and the "Changes after the demos" list disagree, the list wins.

## Context
HANDOFF.md names terrain as the next feature. The user wants more variety in the dungeons, and the 0x72 pack has no water, lava or chasm tiles, so other CC0 tilesets are allowed. The user's decisions from this session:
- **All three terrains:** water, chasms and lava.
- **Water:** a shallow rim slows movement; the deep centre blocks walking.
- **Chasm:** walking in means **instant death** (permadeath, then spectating).
- **Lava:** walkable, burns over time and **slows a lot**. Demon-type enemies are immune and walk through it without caring; other enemies avoid it.
- **Dash** crosses chasms, deep water and lava; only where the dash ends counts.
- **Themed placement:** lava mainly in the demon's dungeon, water in the others, chasms in all of them.
- Workflow as always: demo first, branch `feature/terrain`, docs + HANDOFF + commit at the end, ask before merging or pushing.

## Step 1: Tileset and `?terrain` demo (pause for the user's choice)
- Candidates to check: their license must really be CC0, and they must fit the 0x72 style and palette.
  - [Puny Dungeon](https://opengameart.org/content/16x16-puny-dungeon-tileset): animated water, pits.
  - [Ogrebane 16x16](https://opengameart.org/node/4562): water and lava.
  - [3x Dungeons](https://the-7th-crimson.itch.io/3x-dungeons-tileset-16x16): animated water and lava.
  - [Dawngeon](https://opengameart.org/content/dawngeon).
- Put the chosen sheet in `client/assets-src/<pack>/` with its LICENSE file and a frame list. Extend `client/scripts/build-atlas.ts` to append the second sheet below the 0x72 sheet, the same way as the RECOLORS strips (`decodePng` from `scripts/png.ts`), with frames prefixed `terrain_`.
- Chasm edges can use the pack's own `hole`/`edge_down` if they fit better.
- **One demo per terrain, before any implementation (the user's request).** Each is client-only and uses scripted figures, modelled on `MimicDemoScene.ts`, and is wired in `client/src/main.ts` (import, start-scene switch, scene list, server bypass). Each builds a hand-made `TileMap`, so the edges are autotiled exactly as they would be in the game:
  - `?water` (`WaterDemoScene.ts`): a pool with a shallow rim and an animated deep centre. A hero wades slowly through the rim and stops at the deep water. A second hero dashes across the pool. A skeleton walks around it.
  - `?chasm` (`ChasmDemoScene.ts`): a chasm strip with a floor bridge, using the pack's `edge_down` lip. A hero dashes across. A hero walks in and falls (shrink and fade into the dark), and the death message appears. A skeleton takes the bridge.
  - `?lava` (`LavaDemoScene.ts`): an animated lava pool. A hero walks in slowly and burns (tint, particles, damage numbers). An imp and a chort walk straight through it unharmed. A skeleton walks around it.
  - If the user wants a tileset comparison, a variant switch per demo (`&set=<pack>`) shows the same scene in each candidate tileset.
- **Show the user the three demos and adjust until they approve the look and the behaviour.** Then commit the demos and the atlas change on `feature/terrain`, and only then start Step 2.

## Step 2: Tile rules (server and client, kept in parity)
- `server/src/dungeon/mod.rs`: new `Tile` values `ShallowWater=5`, `DeepWater=6`, `Chasm=7`, `Lava=8`. Add their IDs to `export.rs` so `TILE_ID` is regenerated.
- Split today's single `solid()` into separate rules, mirrored in `client/src/sim/map.ts`:
  - `blocks_sight`: Void, Wall and DoorClosed only. Used by FOV (`fov.rs`/`fov.ts`), `line_of_sight` and projectiles (`abilities.rs:263`). Shots and sight pass over all the new tiles.
  - `blocks_walk(mover)`, where the mover is a hero, an enemy, a demon-type enemy or a dash:
    - Walls block everyone.
    - Deep water blocks everyone except a dash.
    - Chasms block enemies only; heroes can step in and fall.
    - Lava blocks enemies except demon types (imp, chort, summoner, summoned imp, demon boss).
  - `speed_factor(tile)`: shallow water about 0.7, lava about 0.4 for heroes and other non-demons, 1 for demons. These are starting values; final tuning waits for the balancing pass.
- `collision.rs` `move_box`/`step_move` and the client port `client/src/sim/collision.ts` use these rules. The tile under the centre at the start of a step sets the speed.
  - Dash: deep water and chasms do not block it. Ending a dash over deep water drowns, ending it over a chasm is a fall (same as being pushed in).
- **Changes after the demos (user, 2026-10-07):**
  - Deep water blocks walking, but a figure knocked into it (or ending a dash in it) **drowns**: it sinks below the surface, turning blue, with bubbles, then dies ("X drowned"). This applies to enemies too.
  - Falling keeps the figure nearly full size (−20 %) and fades it into the darkness.
  - Enemies walk into shallow water (no damage) and are slowed like heroes.
  - Lava does more damage: at least 15/s (user); the demo uses 10 per 0.5 s (20/s). The lava glow is stronger and redder on the surrounding tiles.
  - Nothing in the game pushes figures yet. Knockback needs its own decision: which attacks push, and how far.
- Add the new cases to the shared fixtures in `export.rs` (`fixtures.json`) so `sim.test.ts` checks parity.

## Step 3: Gameplay (server, `server/src/run/`)
- **Chasm fall:** when a living hero is not dashing and their centre is over a chasm, start a short fall (about 0.4 s, sent as an event so the client plays the animation), then kill them.
  - A new `kill_player(pi, reason)` next to `hurt_player` (`run/mod.rs:504`): armour does not apply, it emits `Ev::Died` and the message "{name} fell into the abyss".
  - In `?debug` (where damage is skipped), the hero reappears on their last safe tile instead.
- **Lava:** a hero standing in lava takes damage over time through `hurt_player` (so armour and debug rules apply), with a burn effect on the client.
- **AI** (`server/src/run/ai.rs`):
  - `astar` and `move_toward` use the mover's walk rule.
  - The "line of sight, so walk straight" shortcut in `path_toward` also needs a clear walking line, so enemies don't walk into a chasm or deep water.
  - `separate_monsters` uses the same rule.
  - Minion and disciple spawns fall back when the spot is blocked for them.

## Step 4: Generator (`server/src/dungeon/generate.rs`)
- New `place_terrain` runs on its own rng stream (8), like `place_chests`, so room layouts, spawns and chests of old seeds stay the same.
- The generator needs to know the boss to pick the theme: lava for the demon, water for the others, chasms in all. Pass it in, or derive it from the seed the same way `enemies::for_boss` does.
- Features only go into larger rooms and halls, never into the start room or boss hall:
  - pools (deep centre with a shallow rim)
  - lava pools
  - chasm strips that leave a bridge of floor
- Keep a 1-tile margin to walls and room entrances. Skip enemy spawns and chests.
- After each feature, run a BFS over hero-walkable tiles (no chasm or deep water). If any room becomes unreachable, undo the feature.
- Extend the 200-seed test: all rooms are still reachable, no spawn or chest sits on terrain, the start and boss rooms stay clear, and the share of terrain per dungeon is reasonable.

## Step 5: Client rendering (`client/src/game/`)
- `autotile.ts`:
  - Wall faces and rims must treat the new tiles as floor-like, so walls next to water still draw correctly.
  - Terrain edges are autotiled from the new sheet; chasms draw the pack's `edge_down` lip.
- `GameScene.ts`:
  - Static parts go into `mapRt`.
  - Animated water and lava go on a separate layer of animated sprites, drawn only near the visible area if needed.
  - Decide how the grid overlay (`GameScene.ts:197`) handles the new tiles.
- Effects: the fall animation, a burn tint/particles in lava, and a ripple or slower walk cycle in shallow water.
- Update the gallery and screenshot tools to match.

## Step 6: Docs and wrap-up
- `docs/PLAYER_GUIDE.md`: the terrain rules.
- `docs/TECHNICAL.md`: tile rules, the split of the solidity rule, the generator stream, the second sheet in the atlas.
- `docs/TODO.md`: move terrain out; list the speed and burn values for the balancing pass.
- HANDOFF.md, then commit on `feature/terrain`. Ask before merging or pushing.

## Verification
1. `cargo test` in Docker (command in HANDOFF.md). New tests:
   - the rule matrix
   - slowing and dash-over-chasm in `step_move`
   - the chasm fall kills, and in debug resets to the last safe tile
   - lava damage, and that demons are immune
   - enemies don't path into chasms, deep water or (non-demons) lava
   - the generator guarantees
2. `cd client && npx tsc --noEmit && npm test`. The parity fixtures include terrain.
3. `docker compose up --build -d` and check health; then `tools/e2e/smoke.mjs` should report no browser errors.
4. Screenshots of `?water`, `?chasm` and `?lava` (with `&slow=3`), and a `?debug&boss=demon` run for lava and a lich or dragon run for water.
5. Check client prediction under `?lag=150&jitter=40&loss=2` while crossing shallow water and lava (no rubber-banding).
6. The user plays one normal run of each theme.
