# Handoff — Tiny Adventurers

For: the next agent or developer continuing this project. Read this first, then the linked docs.

## Read in this order

1. [README.md](README.md): what the game is, how to run it, dev helpers.
2. [docs/TECHNICAL.md](docs/TECHNICAL.md): architecture, protocol, simulation, netcode, rendering, how to extend, tests, known limitations.
3. [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md): the game as players see it (classes, enemies, bosses). Keep it in sync when gameplay changes.
4. [docs/TODO.md](docs/TODO.md): open work and follow-ups (balancing pass, loadouts, art gaps).

## Last session (2026-10-09, admin area, statistics, OpenTelemetry)

**Branch:** `feature/admin` (from `main`), committed, **not merged or pushed yet**. Ask the user before merging.

**User decisions this session:**
- **Admin login:** a username and password from environment variables (`ADMIN_USER`, `ADMIN_PASSWORD`), not a game account.
- **Admin session:** ends after **10 minutes without an admin action**, configurable with `ADMIN_SESSION_MINUTES`. Every admin action restarts the clock; the dashboard auto-refresh does not. 
- **Player sessions:** also an idle timeout now: **7 days without activity** by default, configurable with `PLAYER_SESSION_MINUTES`. API requests, connecting to the game and leaving it count as activity; token and cookie have a 1-year hard limit.
- **Metrics:** all four groups (player activity, runs, characters, trend charts), on a **separate `/admin` page**.
- **Actions:** delete players, change passwords and delete characters, all recorded in an **audit log**.
- **Monitoring:** the user first asked for ClickStack in separate containers, then changed it: **keep everything in the admin area**, but make the server **ready to send OTEL metrics, logs and traces** for a later collector such as ClickStack. No monitoring containers were added.
  - Note for later: ClickStack's multi-container setup stores HyperDX's metadata in **MongoDB (SSPL)**, which the user's OSI-only rule excludes. Raise this before setting it up (alternatives: HyperDX local mode, FerretDB, or an exception).

**Done:**
- **Server, new modules:**
  - `admin.rs`: admin routes, `AdminState` with in-memory sessions, and the `AdminSession` extractor.
  - `stats.rs`: read-only statistics, player and audit queries, with their ts-rs types.
  - `telemetry.rs`: console log, OTLP export and the `Metrics` instruments.
- **Migrations:**
  - `0002_admin_stats.sql`: `activity_days`, `runs`, `run_players`, `admin_actions`, with no foreign keys so history outlives deleted accounts anonymously.
  - `0003_run_players_left.sql`: `left_run`.
- **Run recording:** `Run::record(outcome)`, then `lobby::finish_run(…, record)`, then `db::record_run`. Activity is noted at login, registration and WebSocket connect.
- **New player and member fields:** `Player.account`/`Member.account`, and `Player.left`, because leaving a dungeon sets `alive = false` in the game but must not count as a death in the statistics.
- **Auth:** `auth::AdminLogin` (constant-time digests, password at least 12 characters), the `ta_admin` cookie scoped to `/api/admin`, and `cookie_value`.
- **`main.rs`:**
  - `/admin` serves `admin.html`.
  - `TraceLayer` adds one span per request, named by route.
  - Ctrl-C or SIGTERM stops the server and flushes telemetry.
  - All Vite hashed bundles (not only `index-*`) are cached immutable.
- **New dependencies** (all Apache-2.0 or MIT):
  - `opentelemetry`, `opentelemetry_sdk` and `opentelemetry-otlp` 0.33 (HTTP/protobuf, no TLS);
  - `opentelemetry-appender-tracing` 0.33 and `tracing-opentelemetry` 0.34;
  - the `tower-http` `trace` feature and the `tracing-subscriber` `env-filter` feature.
- **Client:**
  - `admin.html` plus `src/admin/` (main, api, charts, dom, admin.css), a second Vite entry.
  - Views: dashboard (live tiles, who is online, today/7/30-day table, totals, bosses, classes, upgrades histogram, top 10, three 30-day SVG charts), players (search, sort, paging), player detail (characters with Delete, recent runs, change password, delete player with name confirmation) and the audit log.
  - Light and dark mode. Chart palette slots 1–2 were validated with the dataviz validator.
- **Config:**
  - `.env.example` and `docker-compose.yml` gained `ADMIN_USER`, `ADMIN_PASSWORD` and the `OTEL_*` variables.
  - **The user's `.env` was not changed:** they need to add `ADMIN_USER` and `ADMIN_PASSWORD` themselves.
- **Smoke test:** an admin pass runs when `ADMIN_USER` and `ADMIN_PASSWORD` are set (TECHNICAL.md §12).
- **Docs:** TECHNICAL.md (§2, §3, §11a banking, new §11b admin and §11c OpenTelemetry, §12, §13), README and TODO.

**Checked:**
- 130 server tests against Postgres. They cover statistics windows, anonymous history, search and paging, admin writes, admin auth, the run record and telemetry with the in-memory exporter.
- Client typecheck, 11 tests and the build (it outputs `admin.html`).
- `docker compose up --build`: migrations 0002 and 0003 applied to the existing local database.
- curl checks:
  - 401 without a cookie and with a player cookie;
  - 401 for a wrong login, 429 on the 6th;
  - 415 without JSON;
  - a password change revokes the old session, and the old password fails while the new one works;
  - deleting twice gives 404;
  - the audit rows are written;
  - logout works;
  - with no admin variables every `/api/admin/*` route gives 404.
- Smoke test with the admin pass, no browser errors. Screenshots of the dashboard (light and dark), player page and audit log were checked.
- OTLP against a throwaway `otel/opentelemetry-collector` (debug exporter): traces, logs and all metrics arrived with `service.name=tiny-adventurers-server`, and no player names or passwords appeared in the exported data.

**Found on the way:**
- **Leavers counted as deaths:** the first dashboard showed hero deaths for runs that were only left. That led to `Player.left` and migration 0003.
- **Migration fixed in a new file:** 0002 had already been applied to the local database by the test run, so the fix is a new migration (0003). Dropping the tables to edit 0002 was refused by the permission check.
- **Old test rows remain:** the local database still holds a few test runs from before the fix, whose leavers count as deaths. They are test data only.
- **Throttle test locks out the IP:** the admin throttle check locks out the test IP for 5 minutes. Restart the game container before the smoke test if you run both.

**Not yet verified:**
- The user has not tried the admin area yet.
- A won or lost run through the browser was not recorded live. Only abandoned runs were; won and lost runs are covered by tests.

## Session before (2026-10-09, accounts, characters and PostgreSQL)

**Branch:** `feature/accounts` is merged into `main` (fast-forward) and pushed. Start the next feature on a new branch from `main`.

**User decisions this session:**
- **Characters:** progress is tracked per character, not per player. An account has up to **8 characters** of any class, two Wizards included. Each character has a name, a class that never changes, and its own XP, coins and upgrades. Character names are unique across all accounts.
- **Accounts:** register, login, logout and delete only. **No e-mail and no personal data** (GDPR), so there is no password recovery. **Login is required** to play. Old `profiles.json` data was discarded (test data only).
- **Database:**
  - The user requires an **OSI open-source license**. MongoDB was rejected (SSPL).
  - The user questioned document databases, then chose **PostgreSQL 17** (PostgreSQL License, MIT-like) in its own container, with a **hybrid model**: relational accounts/sessions/characters, and all progression in **one versioned JSONB document** per character, so progression can change later without SQL migrations.
- **Tamper protection:** the server is authoritative. The client only displays progress and never sends any. Sessions are **HMAC-SHA256-signed** cookies backed by the database, so they can be revoked.
- **No Valkey/memcached cache** (asked about for heavy use): the database is only touched at login, connect, select, purchase and run end. An in-memory store only makes sense later for several game servers (presence, run list); see TECHNICAL.md §11a "Scaling later".

**Done:**
- **Server, new modules:** `auth.rs`, `db.rs`, `api.rs`, `progress.rs`, plus `migrations/0001_accounts.sql`. `profiles.rs` is deleted.
  - New dependencies: `sqlx` (runtime queries, so the build needs no database), `argon2`, `hmac`, `sha2`, `base64`.
- **Protocol:**
  - `Hello`, `SelectClass`, `Profile` and `ProfileInfo` are gone.
  - New: `SelectCharacter{id}`, `Character(CharacterInfo)`, and the JSON API `/api/*` (TECHNICAL.md §4).
- **Lobby:**
  - Keyed by account, one connection per account (a second login closes the first).
  - Caches the selected character. Never queries the database itself: `main.rs` does the query and then applies the result.
  - `Award` and `Member` carry `character` instead of the token. `finish_run` banks in one transaction.
- **Client:**
  - `api.ts`, `ui/auth.ts` (login/register), `ui/characters.ts` (list, create with the class cards, delete, logout, delete account) and `ui/classes.ts` (shared figures and class card).
  - The lobby shows the played character with "Change character". The room has no class picker any more.
  - `localStorage` is no longer used.
- **Docker:**
  - A `db` service (`postgres:17-alpine`, `ta-db` volume, healthcheck, not published). Secrets live in `.env` (gitignored; `.env.example` committed).
  - `docker-compose.test.yml` runs `cargo test` against a throwaway Postgres.
  - The old `ta-data` volume is unused; the user may remove it (`docker volume rm tinyadventurers_ta-data`).
- **Smoke test:** registers two throwaway accounts, creates characters, plays, checks that a second login closes the first window, and deletes the accounts.

**Checked:**
- 101 server tests, run against Postgres. They cover the parallel bank/buy race, the 8-character cap, case-insensitive names, session revocation, cascades, old JSON documents, tampered and expired tokens, and lobby banking end to end.
- Client typecheck and tests.
- `docker compose up --build`, health, and migrations at start-up.
- curl checks:
  - duplicate name 409, short password 400;
  - identical 401 for a wrong password and an unknown name;
  - 415 without JSON;
  - the 9th character gets 409;
  - a tampered cookie gets 401;
  - `/ws` gives 401 without a cookie and 403 from a foreign origin;
  - the limiter gives 429 after 5 failed logins.
- The smoke test passed with no browser errors. Screenshots of login, characters and lobby were checked.

**Bug found by the user and fixed (commit `663ccbd`):**
- **Symptom:** after a run, W, A, S, D, Q and E could not be typed into DOM inputs, such as the delete-account password box and the run name.
- **Cause:** Phaser's `addKeys` captures keys by default, which calls `preventDefault` page-wide and outlives the scene.
- **Fix:** `GameScene` passes `false` for the capture.
- **Regression check:** the smoke test now leaves a run, types the password (it contains w/a/s/d/e) and deletes Bob's account through the form. It failed on the old build (`mok-tt-por`) and passes now.

**Not yet verified:**
- The user has only tried account deletion live; the rest of the flow they have not tried yet.
- A real run that ends was not banked through the browser. It is covered by `lobby::tests::a_finished_run_banks_on_the_played_character_only`.

**Open questions for the user:**
- **Asset pack:** the user asked whether "the new asset pack" was registered. Nothing new was added. The only approved but unused pack is superdark's "Enchanted Forest Characters" (TODO.md). When it is used: check its license, put it in `client/assets-src/superdark/` with the license file, and add it to the README credits and TECHNICAL.md.
- **`images/`:** an untracked `images/` folder (`logo.png`, `dragon.jpg`) is the user's. It is not committed and was not touched. Ask whether it belongs in the repo.

## Session before (2026-10-08, ogre mini-boss)

**Branch:** `feature/ogre` is merged into `main` (fast-forward) and pushed.

**User decisions this session:**
- **Look:** the user approved an enlarged sprite preview (pack `ogre_*` with `weapon_baton_with_spikes`). The club is held **out at its side and lower** (`handX: 12`, `handY: 14`) and is **1.4x** the usual weapon size, because at the demon's hand height it covered the face.
- **Attacks:** a **club** that pushes (28 px, the strongest normal-enemy push) plus a **ground slam** with a **telegraph ring on the floor** that hits and pushes every hero inside it.
- **HP display:** a **wide bar over its head**, always visible (no boss bar, no protocol change).
- **Every dungeon** gets one ogre, the demon's included.
- **Debug mode:** the user asked for a **blue path to the ogre** next to the yellow boss path.
- Numbers are placeholders for the combined balancing pass (TODO.md, New enemies).

**Done:**
- **Server:**
  - `EnemyType::Ogre` (`KIND.Ogre` 22): 260 HP, speed 40, radius 10, club `Melee{knock: 28}`.
  - New `AttackStyle::Slam` as its alt: radius `OGRE_SLAM_RADIUS` 34 px (hero centres), 0.9 s wind-up, 24 px push, 5 s cooldown. It is used when two heroes are near, or one while the club recovers.
  - New `Anim::Slam` (10) for the slam wind-up. `Ev::Boom{k: 5}` marks the impact.
  - 60 XP and 30 coins.
  - A wide enemy (radius > 8) chases with `path_toward` (A* with clearance) instead of a straight line.
- **Spawn:** `place_ogre` runs on **rng stream 10**, after the terrain. It picks a deeper room or hall and a tile with safe ground all around and no chest. Existing seeds keep their maps, spawns and chests.
- **Client:**
  - `FIGURES[KIND.Ogre]` with the new `FigureDef.handX` (default 3; the swoosh uses it too) and `slam` (radius).
  - `EntityView.slamFx` draws the floor ring: it fills from the centre over the wind-up and blinks at the end. The club rises over the head.
  - `Effects.shockwave` is the dust ring, debris and screen shake for `Boom k=5`.
  - The wide HP bar is in `GameScene.drawBarsAndBeams`.
- **Demo `?ogre`** (`OgreDemoScene.ts`): the orc's 20 px push next to the club's 28 px (only the club knocks the hero into the chasm), and the slam with four heroes (three pushed, one into a chasm, one spared outside the ring). The terrain demo base got a `slam` step and an optional `windup` on `hit`. The user approved it.
- **Debug path to the ogre:** `DebugPath` has a new field `ogre` (the path to the living ogre, empty once it is dead), drawn in blue. The badge and the message name both colours.

**Checked:**
- 80 server tests. 2 are new: the ogre's attack choice, and the slam hitting and pushing everyone in its radius while sparing those outside. Extended: club and slam push; exactly one ogre per seed on safe ground, outside the boss hall, in the 200-seed test; the debug path leads to the ogre and disappears when it dies.
- Client typecheck and tests.
- `docker compose up --build` + health, smoke test under `?lag=150&jitter=40&loss=2` (no browser errors, correction 0.00 px), and `?debug` smoke.
- `?ogre` screenshot series.
- A throwaway bot (deleted) walked the blue path to the ogre in a real run. Screenshots show the ogre, its wide bar and the blue marker on it, with no browser errors.

**Found on the way:** the user first couldn't find the ogre because the container on 8080 was still the old build. Rebuild the container (`docker compose up --build -d`) before the user tests a server change.

**Confirmed live by the user:** the ogre works, and so does the blue debug path.

**Not added:** a test that the other spawns and chests stay the same with the ogre. That holds by construction: stream 10 is a clone and never advances the main rng.

## Session before (2026-10-08, knockback and boss-hall chasms)

**Branch:** `feature/knockback` is merged into `main` (fast-forward) and pushed. Start the next feature on a new branch from `main`.

**User decisions this session:**
- **Only strong melee pushes:** orc warriors (20 px) and chorts (14 px; imps do not). The demon's **cleave (36 px) and swoop (44 px)**. The dragon's **tail swipe (44 px)** and a **new front claw (32 px)**, both asked for by the user. **No ranged attack pushes.**
- Distances approved in the `?knockback` demo. **A pushed hero has no control for the whole slide**, and **a dash cannot escape a push**.
- **Every boss hall gets chasms** (all three bosses), mixed: wall-side drop-offs plus pits. The user's reasoning: knockback only matters in boss fights if there is something to be knocked into.
- **The ogre waits for the next session.** It will be one per run, roaming like other enemies, with a spiked club (`weapon_baton_with_spikes`). The user wants to **see the sprite first** (pack `ogre_*`, 32x36).
- **New art source:** the user approved "Enchanted Forest Characters" by superdark (https://superdark.itch.io/enchanted-forest-characters) for future monsters.

**Done (commits on the branch):**
- **Demo `?knockback`** (`KnockbackDemoScene.ts` on the terrain demo base, which now has decaying pushes, tail swipes and a swoop step).
- **Knockback in the game:**
  - `MoveState` gets `knock_vx/vy`. `step_move` (Rust and TS) slides along it with `Mover::Dash`: only walls stop it. It decays by `KNOCK_DECAY` per step, and input is ignored.
  - `apply_input` skips abilities while knocked. `Run::knock_player` starts a push, but not for dead, sinking or dashing heroes.
  - `me` carries the knock (nil on the wire when not pushed; snapshot 127 B). The predictor replays it, and the parity fixtures inject pushes.
  - Pushes into a chasm or deep water use the existing fall/drown deaths.
- **Attacks:** `AttackStyle::Melee { knock }`, the demon's cleave and swoop, and the dragon's tail swipe. The dragon's new front claw (0.4 s wind-up, 20 damage) uses `Anim::Melee`; the tail swipe now has its own `Anim::Tail`, and `FigureDef.tail` draws its swoosh behind the dragon.
- **Boss halls:** `place_boss_chasms` (rng stream 9, so the rest of each seed's map is unchanged) places 1–2 wall strips and 1–2 pits. It keeps the entrance and the boss's start clear, leaves wide gaps, and never cuts off floor.
- **Boss pathing:** bosses chase via `path_toward` (A*). Wide figures (demon, dragon) prefer paths clear of edges, skip waypoints they cannot get closer to, and walk straight when no path exists.

**Checked:**
- 78 server tests (5 new: push movement, push into a chasm with no control, short push, only strong melee pushes, wide bosses reach every spot of their hall over 24 seeds, plus boss-hall checks in the 200-seed test).
- Client typecheck and tests.
- `docker compose up --build` + health, smoke test normal and under `?lag=150&jitter=40&loss=2` (no browser errors, correction 0.00 px).
- `?knockback` screenshots.
- A throwaway bot (deleted) walked the debug path to the dragon. Screenshots show the hall with a wall strip and a pit, the force field and the fight with pushes, and there were no browser errors.

**Found on the way:** the reachability test first failed because a wide boss was sent to tile centres it cannot reach (next to walls). That is fixed by skipping such waypoints and making clearance a cost.

**Confirmed live by the user:** "Everything works as intended": pushes in real runs and boss fights, and the boss-hall chasms. No push immunity for now. Chained pushes by orc mobs stay a TODO item in case they become a problem.

## Session before (2026-10-08, bugfix: coin icon)

**Bug:** the coin icon before the coin count (lobby and HUD) showed as a blank blue box. The CSS sprite in `client/src/style.css` (`.coin-icon`) scaled the atlas to 1536x1536 px, but the atlas is 512x736, so the icon sampled the wrong region. **Fix:** `background-size: 1536px auto` keeps the aspect ratio. Committed directly on `main` (small bugfix).

**Confirmed by the user:** the coin icon looks right, and a run after the compact snapshots change plays as before.

## Session before (2026-10-08, compact snapshots and inputs)

**Branch:** `feature/compact-snapshots` is merged into `main` (fast-forward) and pushed. Start the next feature on a new branch from `main`.

**Live confirmations by the user (start of this session):**
- **Terrain:** a normal water run, falling into a chasm and drowning work.
- **Chests and mimics** work in a real run.
- **Rewards:** XP and coins are banked after a real run and visible in the lobby.

**Why:** the user wanted smaller network messages as a tidy-up and asked whether binary compressed messages are a good way. Answer given: the messages were already binary (MessagePack). General compression (deflate) gains little on 250-byte messages and costs CPU per player. The user chose the simple option: compact encoding, no delta snapshots.

**Plan and spec:** [docs/compact-snapshots.md](docs/compact-snapshots.md) (spec) and [docs/compact-snapshots-plan.md](docs/compact-snapshots-plan.md) (the executed plan).

**Done:**
- **Snapshots are a bare MessagePack array** (`SnapW`, `server/src/wire.rs`):
  - no field names
  - entity and event positions in 1/16 px as whole numbers (`POS_SCALE`; fine for maps far beyond today's 2,240 px)
  - entity aim as one byte
  - events with number codes (`EV`)
  - `me` and all hp/damage values stay exact, so prediction is unchanged
- **The client unpacks** it into the old `Snapshot` (`client/src/wire.ts`, called in `net.ts`). Nothing after `net.ts` changed.
- **Inputs are a bare array** (`InputW`). The server recognizes the array marker.
- **Fixture test:** `cargo test` writes `wire-fixtures.json`, and `wire.test.ts` checks that the client unpacks what Rust packed.

**Measured** (F3 and a throwaway bot script that walks the debug path to the demon):

| Scene | Before | After |
|---|---|---|
| 2 players | 248 B | 126 B |
| fight, 14 entities in view | about 570 B | about 350 B |
| average in the busy run | 255–298 B | 174–183 B |

Each entity costs about 19 B instead of about 27 B.

**Checked:**
- 73 server tests (12 new: 5 wire tests, the wire fixture export and 6 ts-rs export tests for the new types), and the client typecheck and tests (4 new). The client test catches a broken aim range and a wrong position scale; both were tried on purpose.
- `docker compose up --build` + health, and the smoke test with no browser errors, also under `?lag=150&jitter=40&loss=2` (correction 0.00 px).
- The busy bot run under lag with no browser errors. Screenshots look as before: enemies face correctly, projectiles point the right way, events show up where they happen.

**Finding, not caused by this change:**
- In the busy bot run under lag, F3 showed prediction corrections of up to about 10–23 px in about a third of the samples.
- The **old** format showed the same (18 of 83 samples, max 9.6 px).
- The predictor reads only `me`, `ack` and its own inputs, which are identical in both formats.
- Listed in TODO.md (Network) for a later look.

## Session before (2026-10-08, terrain steps 2–6: terrain in real runs)

**Branch:** `feature/terrain-rules` is merged into `main` (fast-forward) and pushed.

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

**Later confirmed by the user (2026-10-08):** a normal water run, a chasm fall and drowning work in the browser.

## Earlier session (2026-10-07, terrain step 1: tiles and demos)

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

**Later confirmed by the user (2026-10-08):** chests, mimics and banked coins work in a real run.

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
- accounts (name + password, no e-mail) with up to 8 characters each, in PostgreSQL (`db` service, `ta-db` volume); signed HttpOnly session cookies
- lobby, 4 classes (fixed per character), host-chosen or random end boss, random dungeon, field of vision
- per-character progression: XP and coins banked after each run, permanent upgrades bought in the lobby
- 11 enemy types (including the mimic and the ogre mini-boss, one per run; imps, chorts and summoners only in the demon's dungeon), 3 bosses
- terrain in every dungeon: chasms everywhere, water pools (lich, dragon) or lava pools (demon); falling, drowning, lava burns, demons immune to lava; demos `?water`, `?chasm`, `?lava`
- treasure chests and mimics; coins banked as a second currency
- permadeath with spectating, victory/defeat screens
- client prediction and interpolation, F3 stats
- compact snapshots and inputs (MessagePack arrays, `wire.rs`/`wire.ts`): about 125 B per snapshot with 2 players
- debug mode (paths to the boss and the ogre), sprite gallery

**Verified:**
- 101 server tests (against PostgreSQL) and the client tests (collision/FOV ports with terrain, wire unpacking) pass.
- Accounts and characters: API checks with curl and the browser smoke test (2026-10-09); not yet tried live by the user.
- Two-player browser smoke tests (`tools/e2e/smoke.mjs`) run without browser errors.
- Live boss fights against all three bosses, including the force field at the hall entrance (played by the user, no problems).
- Demon dungeon enemies (imps, chorts, summoners) in a real run (played by the user, "work well").
- The ogre and the blue debug path to it (confirmed by the user, 2026-10-08).
- Compact snapshots: a real run plays as before; the coin icon in lobby and HUD (confirmed by the user, 2026-10-08).
- Terrain in a normal water run (chasm fall, drowning), chests and mimics, and XP and coins banked after a real run (confirmed by the user, 2026-10-08).
- The gallery was checked visually: animations, melee swooshes, dragon breath from the mouth and nostrils.

**Not yet verified:**
- Behaviour with real (non-headless) players over a real network.

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
- **Knockback** (2026-10-08, from the `?knockback` demo):
  - only strong melee pushes: orc warrior 20 px, chort claw 14 px, demon cleave 36 / swoop 44, dragon front claw 32 / tail 44
  - imps, skeletons, mimics and all ranged attacks never push
  - no control during the slide, and a dash can't escape it
- **Boss halls have chasms** (all three bosses; wall strips plus pits).
- **Ogre mini-boss** (2026-10-08): one per run in every dungeon, roaming a deeper room; club held out at its side (1.4x size), club push 28 px, ground slam with a floor ring at the real radius; a wide HP bar instead of a boss bar; a blue debug path to it.
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
- **Progression is permanent** (meta-progression across runs, not per run), confirmed by the user, and **per character** (2026-10-09).
- **Accounts** (2026-10-09):
  - No e-mail or other personal data, so there is no password recovery. Login is required.
  - Up to 8 characters of any class per account; character names are globally unique.
  - Delete account and delete character exist and are final.
- **Licenses:** the user wants OSI open-source licenses for infrastructure (MongoDB's SSPL was rejected).
- **Database:**
  - PostgreSQL in its own container.
  - Relational identity, progression as one versioned JSONB document per character: change the `Progress` struct, not the schema.
  - No cache layer (Valkey etc.) until there are several game servers.
- **Security:**
  - The server is authoritative; never accept progress values from the client.
  - Sessions are HMAC-signed cookies backed by the database.

## Environment notes (this machine)

- **Shells:** Windows 11 with Git Bash and PowerShell. Python is **not** installed; use Node scripts or perl/sed for text edits.
- **No local Rust toolchain.** Build and test the server in Docker, as in TECHNICAL.md §3. This includes a throwaway Postgres for the database tests:
  ```sh
  MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test
  docker compose -f docker-compose.test.yml down
  ```
  The `ta-cargo` and `ta-target` volumes (external) cache builds.
- **`.env`** (gitignored) holds `POSTGRES_PASSWORD` and `SESSION_SECRET` for the local stack. It was generated with `openssl rand -hex`. Without it, `docker compose up` refuses to start.
- **Database shell:** `docker compose exec db psql -U tiny -d tiny`.
- **Docker Desktop** must be running. Start it with `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` if `docker info` fails.
- **Browser tests** use the installed Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) through `playwright-core`; no browser download is needed. Set `BROWSER` to use another executable.
  - Headless rendering is software (SwiftShader), so FPS in tests (~28) does not reflect real performance.
- **Fast client iteration:** run `cd client && npx vite --port 5173` against the running container, then test `http://localhost:5173/...`. Stop the Vite process afterwards.
- **The sprite pack** is already in `client/assets-src/0x72/`. If it ever needs re-downloading from itch.io, the free direct-download endpoint is `POST https://0x72.itch.io/dungeontileset-ii/file/<upload_id>?source=view_game&as_props=1&after_download_lightbox=true` with the page's `csrf_token` and cookies. The zip's upload id is 9911410.

## Verification checklist after a change

1. Server changes: run `cargo test`, in Docker as above (with the test Postgres). It also regenerates `client/src/generated/`.
2. Client changes: `cd client && npx tsc --noEmit && npm test`.
3. `docker compose up --build -d`, then `curl localhost:8080/health` should print `OK`.
4. `cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots Wizard,Paladin`. It should print "no browser errors"; look at the screenshots in `shots/`.
5. Visual changes to figures or effects: `node gallery-shots.mjs http://localhost:8080/ shots melee,breath`, or open `?gallery&state=<state>&slow=10` in a browser. Chests and mimics: `?mimic&slow=3`. Ogre: `?ogre&slow=3`. Demons: `?daemons&slow=3`. Terrain: `?water`, `?chasm`, `?lava` (`&slow=3`). Terrain tile changes: edit `client/scripts/terrain-tiles.ts`, then `npm run atlas`.
6. Gameplay changes: update [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md). Architecture changes: update [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Gotchas

- **Checking wall tiles without playing:** a throwaway `client/src/__dump.ts` that builds a `TileMap` from an ASCII map (`#` wall, `.` floor, space void) and prints `tileDraws` per cell, plus a PowerShell `System.Drawing` script that composes the frames from the pack PNG using `tile_list_v1.7`, gives exact renders. Use void cells behind walls like the real generator, and delete the dump script afterwards.
- **Phaser key capture:** `addKeys`/`addKey` capture by default, which calls `preventDefault` page-wide and outlives the scene, so DOM inputs lose those letters after a run (the user found it in the delete-account password box). Always pass `false` (`GameScene` does); the smoke test types a password with w/a/s/d/e after a run.
- **Phaser `Graphics.clear()`** resets fill and line styles; set `fillStyle` again after it (see the `spark` texture in `main.ts`).

- **Stale client after a rebuild:** before 2026-10-08 the server sent no `Cache-Control`, so browsers could keep the old `index.html` and bundle for `/` while `/?debug…` (a different URL) loaded fresh. The user saw lava only in debug mode: the old client drew terrain as dark cells and its prediction fought the server. `cache_headers` in `main.rs` fixes it. If a client ever looks older than the server, hard-reload (Ctrl+F5) first.
- **Generated client files:** never edit `client/src/generated/*` by hand. Change Rust and run `cargo test`.
- **Snapshots and inputs are arrays on the wire** (`wire.rs`, `wire.ts`). When you add a field to `Snapshot`, `SelfState`, `EntSnap`, `BossBar`, `Ev` or `InputMsg`, add it to the wire type, both converters and `sample_snapshots`; the fixture test fails otherwise. Raw snapshot bytes are no longer `{t: 'Snap'}` maps, so test scripts that read the WebSocket must decode arrays (`m[3][3]` is the own x).
- **Message tag:** MessagePack enums are tagged with the field `t`, so no variant may have a field named `t`. That is why `Ping`/`Pong` use `time`.
- **Prediction parity:** client prediction relies on `client/src/sim/collision.ts` matching `server/src/collision.rs` exactly, and on the order *move, then abilities* in `Run::apply_input`. If you change movement, change both and keep `sim.test.ts` green.
- **Cooldowns** tick per processed input on both sides. Don't switch the server to wall-clock cooldowns without updating `Predictor`.
- **Boss behaviours** are taken out of `Run.boss` during their tick (`Option::take`), so `hurt_monster`'s immunity check cannot see the boss during its own tick. That is harmless today; keep it in mind.
- **Pack frame names** are used verbatim (`knight_m_run_anim_f2`). `necromancer` only has `necromancer_anim_f0-3`, used for both idle and run.
- **Dragon breath points** (`mouth` / `nostrils` in `anim/defs.ts`) were measured per lizard frame. If the dragon sprite changes, re-measure them.
- **Characters:** the client must send `SelectCharacter` after connecting (the character screen's Play does). Without it, rooms are refused, nothing is banked and no upgrades apply.
- **Seeding test XP:** `docker compose exec db psql -U tiny -d tiny -c "update characters set progress = jsonb_set(progress, '{xp}', '1000') where name = 'Hero'"`. The lobby caches the character, so press "Change character" and Play again to reload it.
- **The lobby lock is a std `Mutex`:** never hold it across an `.await`. Do database work first (`main.rs` `select_character`, `BuyUpgrade`, `lobby::finish_run`), then lock and apply.
- **Test accounts:** the smoke test deletes its `e2e_*` accounts. If it crashes midway, remove leftovers with `delete from accounts where name like 'e2e\_%'`.
- **Lobby screenshots:** the lobby scrolls inside `.lobby`, so Playwright `fullPage` shots are cut off. Screenshot elements instead (`page.locator('.bosses').screenshot()`).
- **Boss previews in the lobby** (`BOSS_FIG` in `ui/lobby.ts`) use CSS filters to imitate the in-game tint/hue from `anim/defs.ts`. If a boss figure changes, update both.

## Suggested next steps

1. **One combined balancing pass** when the user asks for it (they want everything balanced together): progression (`defs/progression.rs`), classes (`defs/classes.rs`), bosses (`server/src/run/bosses/*.rs`, `defs/bosses.rs`) and enemies.
2. Loadouts: design new abilities, then add the lobby picker, paid with coins.
3. More from the pack for the environment (the user asked for a less empty dungeon): floor spikes, levers/buttons, breakable crates, flasks as pickups, wall fountains, columns. See TODO.md.
4. Optional polish: sound, better boss sprites if the user approves a source (they must be pack-like and not self-drawn), the prediction corrections in busy runs under lag (TODO.md, Network).
