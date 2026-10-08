# Handoff — Tiny Adventurers

For: the next agent or developer continuing this project. Read this first, then the linked docs.

## Read in this order

1. [README.md](README.md): what the game is, how to run it, dev helpers.
2. [docs/TECHNICAL.md](docs/TECHNICAL.md): architecture, protocol, simulation, netcode, rendering, how to extend, tests, known limitations.
3. [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md): the game as players see it (classes, enemies, bosses). Keep it in sync when gameplay changes.
4. [docs/TODO.md](docs/TODO.md): open work and follow-ups (balancing pass, loadouts, art gaps).

## Last session (2026-10-08, terrain steps 2–6: terrain in real runs)

**Branch:** `feature/terrain-rules` (from `main`), committed, **not merged or pushed yet**. Ask the user before merging into `main` or pushing.

**User decisions this session:**
- **Knockback is its own feature, later.** It is not part of terrain. So in real runs drowning only happens when a dash ends in deep water, and enemies never end up in terrain.
- All remaining terrain steps (2–6) on one branch.

**Done:**
- **Tile rules (server and client, prediction parity):**
  - New tiles `ShallowWater=5`, `DeepWater=6`, `Chasm=7`, `Lava=8`.
  - `Map::solid` is gone. It is replaced by `opaque` (sight and projectiles; terrain never blocks them), `blocks(x, y, mover)` with `Mover::{Hero, Enemy, Demon, Dash}`, `speed_factor` and `safe`.
  - The client ports are `sim/map.ts` and `sim/collision.ts`. The parity fixtures include every terrain kind (10 walks with dashes).
- **Gameplay** (`Run::terrain_player`, `kill_player`):
  - A chasm or the end of a dash over deep water starts a fall (0.7 s) or a drowning (0.9 s), sent as `Ev::Sink`, then death ("X fell into the abyss" / "X drowned").
  - Lava burns 10 every 0.5 s through `hurt_player`.
  - Debug heroes climb back out onto the centre of their last safe tile.
  - The predictor applies the same sinking rule, so a fall needs no round trip.
- **AI:** each monster has a `mover`. Demon types (imps, chorts, summoners, summoned imps, the demon boss) cross lava at full speed; other enemies avoid lava. No enemy enters a chasm or deep water. The straight-line shortcut uses `walk_line`, and the debug path avoids all terrain.
- **Generator:** `generate(seed, Theme)`, with the boss picked first in `Run::new`. `place_terrain` runs on rng stream 8:
  - It places oval pools (water: deep centre inside a shallow rim; lava: all lava) and wall-to-wall chasm strips at most 3 tiles wide, each with a floor bridge.
  - It keeps away from corridor mouths and chests, and undoes a feature that cuts off safe ground or brings a room as far as the boss hall.
  - Covered enemy spawns move to the nearest free floor tile.
  - About 4 % of the floor becomes terrain; the start room and boss hall stay clear.
- **Rendering:**
  - `TerrainLayer` runs in `GameScene`, and walls treat terrain as floor-like.
  - Figures wade, splash, ripple and get embers in lava; heroes fall or drown with the demo animations and leave no skull.
  - The shared helpers (`WadeFx`, `sinkStartFx`, `bubbleFx`) are used by the demos too. The temporary `TERRAIN` constants now come from `TILE_ID`.
- **Docs:** PLAYER_GUIDE (new terrain section and a tip), TECHNICAL (§4–§9, tests), TODO (terrain follow-ups and tuning values), README, terrain-plan status.

**Checked:**
- 61 server tests (13 new: the rule matrix, slowing, dash over terrain, chasm fall with the debug rescue, drowning, lava burn, demon movers, A* per mover, terrain-safe generation over 200 seeds for both themes).
- Client typecheck and parity tests.
- `docker compose up --build` + health, and two smoke runs (normal, and `?debug&boss=demon`) without browser errors.
- The three demos still load.
- **Real runs, screenshots** (throwaway scripts, deleted afterwards):
  - lava pools, water pools and chasm strips render with correct walls
  - a hero walked into lava: slowed, burning numbers, embers
  - a hero walked into a chasm in debug mode: predicted fall, then back on safe ground
  - correction stayed at 0.00 px under `?lag=150&jitter=40&loss=2`

**Live test by the user (after the session's fixes):**
- First report: in normal mode lava showed as dark cells, hurt, and made the hero glitch. The cause was a stale cached client for `/`, not the terrain code: the server sent no `Cache-Control`. Fixed by `cache_headers` in `main.rs` (see Gotchas).
- After a hard reload, the user confirmed that it works in normal mode.

**Not verified yet:**
- A real (non-debug) death by chasm, and drowning after a Barbarian dash, in the browser. Both are covered by server tests only.
- A full normal run of the water theme (lich or dragon), and the user's verdict on the look and the amount of terrain.

## Session before (2026-10-07, terrain step 1: tiles and demos)

**Branch:** `feature/terrain` is merged into `main` (fast-forward) and pushed.

**Plan:** [docs/terrain-plan.md](docs/terrain-plan.md) has the full step plan and all of the user's terrain decisions. All of its steps are done now.

**Why:** this is the terrain sub-project the user asked for (water, chasms, lava).
- **Art:** no CC0 set fit the 0x72 style. Rejected: Puny Dungeon (grey stone), Ogrebane (plain textures, no edges), Dawngeon (other perspective), cave_ by Kevin's Mom's House (flat cartoon look), and Niji's Extended pack (no water or lava). 0x72's own Sewers set costs money, and the user doesn't like it anyway.
- So the user allowed **self-made terrain tiles**, for terrain only. They are generated by a script from pack colours, never self-drawn figures.

**Done:**
- **Tile generator** `client/scripts/terrain-tiles.ts`, run by `build-atlas.ts`, so no image is committed. It uses only 0x72 colours plus the pack's `floor_1` and the pack's 3/4 view.
  - Seamless animated base textures: shallow water, deep water, lava and the chasm void. The pieces are picked by tile position (`TERRAIN_PERIOD`).
  - 47 edge overlays per edge set (`shore`, `deep`, `lava`, `chasm`): north bank faces (masonry on the chasm cliff), rims and rounded corners. They are keyed by a 4-digit quarter code from the 8 neighbours (`terrain-codes.ts`, shared with the client).
- **`client/src/game/terrain.ts`:** `TerrainLayer` draws and animates the terrain cells and adds a red lava glow and embers. Also `speedFactor` and `sinkDepth`.
  - The terrain tile ids are temporary local constants (`TERRAIN`, 5–8). Replace them with `TILE_ID` once the server has the tiles.
- **`EntityView` hooks:** `sink` (wading: the feet are cut off), `fall` (shrinks 20 % and darkens into the dark) and `drown` (sinks below the surface, turning blue).
- **Demos** (`TerrainDemoScene.ts`, `?water`, `?chasm`, `?lava`): scripted figures only, with no game rules on the server yet.

**User decisions made in the demos (all in the plan):**
- Shallow water slows everyone. Enemies walk in too.
- Deep water blocks walking, but a figure knocked in, or ending a dash in it, **drowns** ("X drowned").
- A chasm is **instant death** ("X fell into the abyss"). The dash jumps it, and only where the dash ends counts.
- Lava is walkable for heroes, **slows a lot** and burns for **at least 15 damage/s** (the demo uses 20/s). Demon-type enemies are immune and walk straight through. Other enemies avoid lava.
- The theme follows the boss: lava mainly in the demon's dungeon, water elsewhere, chasms everywhere.

**Later answered:** knockback became its own feature (2026-10-08). Only the **Barbarian** has a dash (54 px, about 3 tiles), so chasms are at most 3 tiles wide.

**Checked:**
- Client typecheck.
- The three demos load without browser errors.
- Slow-motion screenshot series of wading, the dash over the stream, the drowning, the chasm fall (walking in and being knocked in) and the burning.
- The user reviewed and approved the demos after two rounds of changes: the fall animation, a stronger lava glow and more lava damage, drowning, and enemies wading.

Steps 2–6 followed in the next session.

## Earlier session (2026-10-07, demon dungeon: imps, chorts, summoners)

**Branch:** `feature/demon-minions` is merged into `main` (fast-forward) and pushed.

**Why:** the user wanted more variety and asked about chasms and water. The 0x72 pack has none (only `hole`, `edge_down`, wall fountains and goo), so **the user allowed other CC0 tilesets that fit well, for terrain and for enemies**. The user also pointed out the pack's small demons and asked for them in place of skeletons when the demon is the boss, with melee and fire bolts. Terrain (water, chasms) is the next sub-project; nothing has been done for it yet.

**Done:**
- **Demo first:** `?daemons` (`DaemonDemoScene.ts`). The user picked **imps (ranged) + chorts (melee)** from it.
- **Imp** (`EnemyType::Imp`): fire bolts from range and keeps its distance; claws when a hero gets close. **Chort**: closes in and claws; throws a fire bolt now and then from at least 40 px. Both use the new optional second attack (`EnemyDef.alt`, own cooldown `Ai.alt_cd`, `Windup.alt`). New projectile `FireBolt`.
- **Summoner** (the user's name for it): the necromancer's demon-dungeon counterpart. It shoots fire bolts and summons imps (`SummonedImp`, a fiery summon ring). Its sprite is the pack necromancer with a **red robe**, recolored with pack colors at atlas build time (`RECOLORS` in `client/scripts/build-atlas.ts`, codec in `scripts/png.ts`). The user asked for this asset change.
- **Swap at run start** (`enemies::for_boss`): with the demon as boss, skeleton archers → imps, skeleton warriors → chorts, necromancers → summoners. Maps and spawn spots stay the same for every seed.
- **Minions are no longer tinted** (user's request): raised skeletons lost their green tint; summoned imps look like normal imps.
- Stats start close to the skeletons they replace, with the same XP (summoner 25, summoned imp 2). Tuning waits for the balancing pass.

**Checked:** 53 server tests (5 new: demon swap with same spawns, imp and chort attack choice by distance, the alt attack's own cooldown and fire bolt, summoned imps), client typecheck and tests, `docker compose up --build` + health, smoke tests (normal and `?debug&boss=demon`, no browser errors), `?daemons` screenshots (all four lanes, red-robed summoner, untinted summoned imps).

**Live test (by the user, after the merge):** the user played a demon run; imps, chorts and summoners "work well". No problems found. Balancing still waits for the combined pass.

## Earlier session (2026-10-07, chests, mimics and coins)

**Branch:** `feature/chests` is merged into `main` (fast-forward) and pushed.

**Why:** the user found the dungeons empty apart from enemies and asked what else the pack offers. Answer given: chests (full/empty/mimic opening animations) and coins, plus spikes, buttons/levers, columns, wall fountains, goo, crates, flasks, bombs, ladder/stairs; only a single `hole` tile and `edge_down` (no real chasms, no bridges), and no water or lava floor tiles. The user chose chests + mimics + coins.

**Done:**
- **Mimic demo first, as the user asked:** `?mimic` (`MimicDemoScene.ts`). The user picked the **hopping chaser** over a stationary biter and liked the reveal. The demo now shows the chaser, a treasure chest and the reveal.
- **Figure bases removed (user's request):** every figure stands on a soft ground shadow instead of a coloured miniature base. `FigureDef.base` stays as the accent colour for particles; `baseR` sizes the shadow. The player guide no longer names heroes by ring colour.
- **Chests:** `place_chests` (generator, own rng stream so old seeds keep their maps): ~1 in 3 rooms/halls, on the top row against the wall, 25 % mimics. Touching opens a chest; 8–15 coins to every living party member (`Ev::Coins`, party-wide).
- **Mimic** (`EnemyType::Mimic`, `KIND.Mimic`): a sleeping monster drawn as a closed chest. Wakes when touched or hit, holds 0.6 s for the reveal, then chases with a hop gait (`ai::gait`: moves only in the airborne part of the hop cycle; the timings are exported in `CONST` so the client draws the same phases). Bites in melee. Rattles now and then when a hero is close. The boss waking does not wake mimics. Worth 15 XP and 25 coins.
- **Coins** are a second currency: `Player.coins`, `Profile.coins` (serde default), banked with XP at run end (`Run::awards` → `Award{token, xp, coins}`), shown in the HUD (pack coin icon), the end table and the lobby. Nothing to buy yet: meant for loadouts. Boss kill gives 50.

**Checked:** 48 server tests (3 new: chest opening pays the party once; mimic sleep/wake/hold and boss-wake exception; mimic moves only while airborne; plus chest guarantees over 200 seeds), client typecheck and tests, `docker compose up --build` + health, two-player smoke test (no browser errors; HUD coin counter and lobby coins visible), `?mimic` screenshots (hop, bite, chest coin burst, reveal).

**User feedback:** the user likes the mimics a lot. Coin amounts, chest rate, mimic share and mimic stats are left for the combined balancing pass later (listed in TODO.md); don't tune them piecemeal.

**Not yet verified:** meeting a chest and a mimic in a real run (the headless smoke test never walks to one), and seeing the coins banked after a real run. The user should play one normal run (no `?debug`).

## Earlier session (2026-10-07, wall corners and boss force field)

**Branches:** `fix/wall-corners` and `feature/force-field` are merged into `main` (fast-forward) and pushed.

**Done:**
- **Walls hug the floor, junctions are corners.** Side-wall strips moved from the outer edge to the floor side, and south walls draw their rim at the top of the cell (`TileDraw.dy`) (`client/src/game/autotile.ts`). The cells behind walls are usually `Void`, not `Wall`; neighbour checks must not require `isWall` there.
- **One-tile wall stubs filled in the generator.** Overlapping carves left wall cells with floor on three sides; they always draw as a T, whatever the tiles. `remove_stubs` in `server/src/dungeon/generate.rs` fills them (only where floor already wraps around, so no new path opens). The 200-seed test asserts none remain; it failed on seed 0 without the fix. Same seeds now give slightly different maps.
- **Boss hall entrance:** no door any more; the entrance tiles draw as floor, so the corridor leads straight in. When the party is inside, a shimmering blue force field seals it (`client/src/game/forcefield.ts`, a runtime effect: the pack has no such sprite). It works on horizontal and vertical entrances and for late joiners/spectators. Server logic is unchanged (DoorClosed tiles still block movement and sight). Both orientations are in the gallery.
- **Spark texture fixed:** `spark` was generated black (`Graphics.clear()` resets the fill), so hit sparks were black crosses; they now take their tint.

**Checked:** 45 server tests, client typecheck and tests, `docker compose up --build` + health, two-player smoke test (no browser errors), gallery screenshots of the force field, and rendered test maps of the wall rules.

**Live boss test (by the user, after the merge):** all three bosses (demon, lich, dragon) played in the browser; the force field appeared when the party entered the hall; no T-shaped wall junctions seen any more (confirms the stub fix); no problems found. Balancing was deliberately not judged: the user wants one combined balancing pass later (progression, classes, boss fights).


## Earliest session (2026-10-07, boss selection and progression)

- **Done:** lobby boss selection, and permanent progression (profiles, XP banking, upgrade shop). Details: TECHNICAL.md §4 and §11a, PLAYER_GUIDE.md "XP and upgrades".
- **Workflow set up:** the first commits are on `main` and pushed. The user wants one feature per session with a handoff, doc updates and a commit at the end (see "Git and session workflow").
- **Not done in that session:** the live boss test and loadouts (loadouts need new abilities first; the user chose to defer them).

## Current state

**Working end to end in Docker (`docker compose up --build`, port 8080):**
- lobby, 4 classes, host-chosen or random end boss, random dungeon, field of vision
- persistent profiles: XP banked after each run, permanent upgrades bought in the lobby (`ta-data` volume)
- 10 enemy types (including the mimic; imps, chorts and summoners only in the demon's dungeon), 3 bosses
- terrain in every dungeon: chasms everywhere, water pools (lich, dragon) or lava pools (demon); falling, drowning, lava burns, demons immune to lava; demos `?water`, `?chasm`, `?lava`
- treasure chests and mimics; coins banked as a second currency
- permadeath with spectating, victory/defeat screens
- client prediction and interpolation, F3 stats
- debug mode, sprite gallery

**Verified:**
- 61 server tests and the client port tests (terrain included) pass.
- Browser check of the profile flow: buying, persistence over page reload and `docker compose down`/`up`, new token for a new browser, read-only boss picker for guests.
- Two-player browser smoke tests (`tools/e2e/smoke.mjs`) run without browser errors.
- Live boss fights against all three bosses, including the force field at the hall entrance (played by the user, no problems).
- Demon dungeon enemies (imps, chorts, summoners) in a real run (played by the user, "work well").
- The gallery was checked visually: animations, melee swooshes, dragon breath from the mouth and nostrils.

**Not yet verified:**
- Behaviour with real (non-headless) players over a real network.
- **Earning XP in a real run.** Banking at run end is covered by server tests only; the shop was browser-tested with a seeded profile. To check: play a normal run (no `?debug`, which banks nothing), then look at the Upgrades panel.

**Git and session workflow (the user's standing instructions):**
- One feature per session. When a feature is done: update this file and the docs, run the verification checklist below, then commit.
- Branches: `main` holds the finished work. Start each feature on a `feature/<name>` branch from `main` and commit there. Ask before merging into `main` or pushing.
- Remote: `origin` = https://github.com/migosoft/TinyAdventurers.git. `main` tracks `origin/main`.
- The repo-local author is `Goll Michael <m.goll@schig.com>`. `.gitattributes` keeps LF line endings.

## The user's decisions and preferences (keep them)

- **Art:** sprites from the 0x72 "16x16 DungeonTileset II" pack, plus other CC0 tilesets that fit its style (allowed 2026-10-07 for terrain and enemies; keep their license file next to them).
  - **Terrain tiles only** (water, lava, chasm) may be self-made: generated by `client/scripts/terrain-tiles.ts` from pack colours, because no CC0 set fit. The user allowed this after the search; figures stay pack sprites.
  - The user rejected self-drawn or procedural sprite art.
  - Small recolors of pack frames with pack colors are fine when the user asks (the summoner's red robe).
  - Missing figures are pack sprites scaled, tinted or hue-shifted (lich, dragon).
  - Attacks are approximated by animating pack weapon sprites.
  - Runtime effect shapes (particles, glows, swooshes, rings) are fine.
- **Minions are never tinted:** raised skeletons and summoned imps look like the ordinary ones.
- **Demon dungeon:** imps (ranged, claw up close) and chorts (melee, a bolt from afar) replace skeletons, summoners (red robe, summon imps) replace necromancers. The user chose this from the `?daemons` demo and named the summoner.
- **No miniature bases under figures** (the user asked to remove them); figures stand on a soft ground shadow.
- **Mimics hop after the players** (chosen from a demo over a stationary biter), and their reveal animation stays.
- **Coins are a second currency** meant for buying loadouts later.
- **Weapons** are drawn small (0.6×).
- **Melee reach is unchanged on the server:** a swoosh at the real damage reach replaces the visible full swing, and the weapon fades out and back in.
- **Walls** follow the pack's 3/4 autotiling with its corner and rim pieces (`client/src/game/autotile.ts`). Strips and rims sit on the floor side so junctions are corners: the user rejected T-shaped junctions (four rounds of feedback). Check wall changes against corridor junctions, room corners and corridor mouths before calling them done.
- **Boss hall entrance:** no door; a shimmering, semi-transparent blue force field appears when the party is inside (the user's request).
- **Debug mode is URL-only:** `?debug`, optionally `&boss=demon|lich|dragon` on the host's page (preselects the lobby's boss picker). Debug runs bank no XP. The F4 toggle was removed at the user's request; don't add an in-game toggle back.
- **Facing is left/right only:** the pack has no up/down frames. The user originally wanted 4 directions and accepted left/right for the pack. The code keeps a `Dir` hook.
- **Stack:**
  - Rust backend in a Docker container (required by the user)
  - TypeScript + Phaser client
  - dedicated server with a lobby; joining only before a run starts; permadeath with spectating
- **Responsiveness is a priority** ("no lag"): keep prediction, interpolation and lag compensation working. Check with `?lag=150&jitter=40&loss=2` and F3.
- **Planned features** (structure exists, details in TODO.md):
  - selectable primary/secondary loadouts (needs new abilities first)
  - more classes and bosses
- **Balancing is one combined pass later** (progression, classes, boss fights, ...), not piecemeal tuning; the user decided this after the live boss test.
- **Progression is permanent** (meta-progression across runs, not per run), confirmed by the user. Identity is an anonymous browser token; profiles live in a JSON file on the `ta-data` volume.

## Environment notes (this machine)

- **Shells:** Windows 11 with Git Bash and PowerShell. Python is **not** installed; use Node scripts or perl/sed for text edits.
- **No local Rust toolchain.** Build and test the server in Docker, as in TECHNICAL.md §3:
  ```sh
  MSYS_NO_PATHCONV=1 docker run --rm -v "C:\\Users\\Goll\\Desktop\\TinyAdventurers":/work -v ta-cargo:/usr/local/cargo/registry -v ta-target:/work/server/target -w /work/server rust:1-slim-bookworm cargo test --release
  ```
  The `ta-cargo` and `ta-target` volumes cache builds.
- **Docker Desktop** must be running. Start it with `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` if `docker info` fails.
- **Browser tests** use the installed Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) through `playwright-core`; no browser download is needed. Set `BROWSER` to use another executable.
  - Headless rendering is software (SwiftShader), so FPS in tests (~28) does not reflect real performance.
- **Fast client iteration:** run `cd client && npx vite --port 5173` against the running container, then test `http://localhost:5173/...`. Stop the Vite process afterwards.
- **The sprite pack** is already in `client/assets-src/0x72/`. If it ever needs re-downloading from itch.io, the free direct-download endpoint is `POST https://0x72.itch.io/dungeontileset-ii/file/<upload_id>?source=view_game&as_props=1&after_download_lightbox=true` with the page's `csrf_token` and cookies. The zip's upload id is 9911410.

## Verification checklist after a change

1. Server changes: run `cargo test`, in Docker as above. It also regenerates `client/src/generated/`.
2. Client changes: `cd client && npx tsc --noEmit && npm test`.
3. `docker compose up --build -d`, then `curl localhost:8080/health` should print `OK`.
4. `cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots Wizard,Paladin`. It should print "no browser errors"; look at the screenshots in `shots/`.
5. Visual changes to figures or effects: `node gallery-shots.mjs http://localhost:8080/ shots melee,breath`, or open `?gallery&state=<state>&slow=10` in a browser. Chests and mimics: `?mimic&slow=3`. Demons: `?daemons&slow=3`. Terrain: `?water`, `?chasm`, `?lava` (`&slow=3`). Terrain tile changes: edit `client/scripts/terrain-tiles.ts`, then `npm run atlas`.
6. Gameplay changes: update [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md). Architecture changes: update [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Gotchas

- **Checking wall tiles without playing:** a throwaway `client/src/__dump.ts` that builds a `TileMap` from an ASCII map (`#` wall, `.` floor, space void) and prints `tileDraws` per cell, plus a PowerShell `System.Drawing` script that composes the frames from the pack PNG using `tile_list_v1.7`, gives exact renders. Use void cells behind walls like the real generator, and delete the dump script afterwards.
- **Phaser `Graphics.clear()`** resets fill and line styles; set `fillStyle` again after it (see the `spark` texture in `main.ts`).

- **Stale client after a rebuild:** before 2026-10-08 the server sent no `Cache-Control`, so browsers could keep the old `index.html` and bundle for `/` while `/?debug…` (a different URL) loaded fresh. The user saw lava only in debug mode: the old client drew terrain as dark cells and its prediction fought the server. `cache_headers` in `main.rs` fixes it. If a client ever looks older than the server, hard-reload (Ctrl+F5) first.
- **Generated client files:** never edit `client/src/generated/*` by hand. Change Rust and run `cargo test`.
- **Message tag:** MessagePack enums are tagged with the field `t`, so no variant may have a field named `t`. That is why `Ping`/`Pong` use `time`.
- **Prediction parity:** client prediction relies on `client/src/sim/collision.ts` matching `server/src/collision.rs` exactly, and on the order *move, then abilities* in `Run::apply_input`. If you change movement, change both and keep `sim.test.ts` green.
- **Cooldowns** tick per processed input on both sides. Don't switch the server to wall-clock cooldowns without updating `Predictor`.
- **Boss behaviours** are taken out of `Run.boss` during their tick (`Option::take`), so `hurt_monster`'s immunity check cannot see the boss during its own tick. That is harmless today; keep it in mind.
- **Pack frame names** are used verbatim (`knight_m_run_anim_f2`). `necromancer` only has `necromancer_anim_f0-3`, used for both idle and run.
- **Dragon breath points** (`mouth` / `nostrils` in `anim/defs.ts`) were measured per lizard frame. If the dragon sprite changes, re-measure them.
- **Profiles:** the client must send `Hello` on every connect (the lobby constructor does), or the connection has no token: no XP is banked and no upgrades are applied.
- **Seeding a test profile:** write `{"<32 hex token>":{"xp":1000,"total_xp":1000,"upgrades":{"damage":0,"attack_speed":0,"move_speed":0,"life":0,"armor":0}}}` to a file, `docker cp` it to `<container>:/data/profiles.json`, then `docker compose restart game`; put the token in the browser's `localStorage` key `ta-token`. In Git Bash use `MSYS_NO_PATHCONV=1` for `docker compose exec` with `/data/...` paths. Remove the test profile afterwards.
- **Lobby screenshots:** the lobby scrolls inside `.lobby`, so Playwright `fullPage` shots are cut off. Screenshot elements instead (`page.locator('.bosses').screenshot()`).
- **Boss previews in the lobby** (`BOSS_FIG` in `ui/lobby.ts`) use CSS filters to imitate the in-game tint/hue from `anim/defs.ts`. If a boss figure changes, update both.

## Suggested next steps

1. **Finish terrain:** ask the user to merge `feature/terrain-rules` into `main` and push, and to play one normal run per theme. Adjust the look or the amount of terrain from their feedback (`place_terrain` rates and sizes).
2. **Knockback** (its own feature, the user's decision): demo first, as usual. Decide which attacks push and how far; then enemies can fall and drown too (they need a monster version of `Sink`/`kill_player`). See TODO.md.
3. **One combined balancing pass** when the user asks for it (they want everything balanced together): progression (`defs/progression.rs`), classes (`defs/classes.rs`), bosses (`server/src/run/bosses/*.rs`, `defs/bosses.rs`) and enemies.
4. Loadouts: design new abilities, then add the lobby picker, paid with coins.
5. More from the pack for the environment (the user asked for a less empty dungeon): floor spikes, levers/buttons, breakable crates, flasks as pickups, wall fountains, columns. See TODO.md.
6. Optional polish: sound, better boss sprites if the user approves a source (they must be pack-like and not self-drawn), delta-compressed snapshots.
