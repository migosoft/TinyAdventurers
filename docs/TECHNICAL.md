# Tiny Adventurers — Technical Documentation

Audience: developers and coding agents working on the code. For gameplay see [PLAYER_GUIDE.md](PLAYER_GUIDE.md); for open work see [TODO.md](TODO.md).

## 1. Overview

A browser multiplayer dungeon crawler.

- **Server:** Rust. It is authoritative: it owns the lobby, dungeon generation, the simulation (movement, combat, AI, bosses) and what every player is allowed to see.
- **Client:** TypeScript + Phaser 3. It renders and sends inputs.
- **Responsiveness:** the client predicts its own movement and attacks so input never waits for the network.

```
Browser (Phaser client)  ──WebSocket /ws, MessagePack──►  Rust server (axum + tokio)  ──sqlx──►  PostgreSQL 17
  ▲  prediction, interpolation, rendering                    lobby (Mutex) + one tokio task per run   accounts, sessions,
  │                       ──HTTP JSON /api/* (login)──►      account + character API                  characters (+ JSONB progress)
  └──────────────── per-player snapshots (30 Hz) ◄──────────  60 Hz simulation, FOV-filtered
```

Two Docker containers:
- `game` serves the static client, the JSON API and the WebSocket on port 8080.
- `db` is PostgreSQL 17. It holds accounts and characters and is not published to the host.

## 2. Repository layout

```
Dockerfile, docker-compose.yml       multi-stage build: client (node) + server (rust) -> debian-slim runtime; `db` service
docker-compose.test.yml              server tests against a throwaway PostgreSQL
.env.example                         secrets for docker compose (copy to the gitignored .env)
server/                              Rust crate `tiny-adventurers-server`
  migrations/                        SQL migrations, embedded at compile time and applied at start-up
  src/main.rs                        axum router: /ws (session + origin checked), /api, /api/admin, /admin, /health, static files (STATIC_DIR)
  src/api.rs                         JSON API: register, login, logout, delete account, me, create/delete character
  src/admin.rs                       admin API: env-configured login, stats, players, password, deletions, audit log
  src/auth.rs                        signed session tokens, Argon2id passwords, name/password rules, login rate limiter, admin login
  src/db.rs                          every query of the game (sqlx, PostgreSQL), incl. recording runs and activity
  src/stats.rs                       read-only admin queries: statistics, player list and details, audit log
  src/telemetry.rs                   console log + optional OpenTelemetry export (traces, logs, metrics)
  src/progress.rs                    a character's progression document (JSONB, versioned)
  src/protocol.rs                    ClientMsg / ServerMsg + all payload types (ts-rs exported)
  src/wire.rs                        compact array forms of snapshots and inputs (SnapW, InputW, ...)
  src/lobby.rs                       connections (one per account), selected character, rooms, level + boss pick, ready, start
  src/math.rs, collision.rs, fov.rs  Vec2, tile collision + line of sight, recursive shadowcasting
  src/dungeon/{mod,generate}.rs      Tile/Map/Rect types, `Layout` (what every level fills), seeded generator, `Dungeon::split`
  src/defs/                          data: classes, abilities, enemies, bosses, kinds (ids), progression
  src/defs/damage.rs                 damage types, `Damage`, `Resistances`, `resolve`, `kind_split`
  src/defs/entity_types.rs           entity types with resistances and melee splits, `Adjust`, `profile`
  src/defs/objects.rs                world object defs and the barrel numbers
  src/defs/lights.rs                 light kinds (radius, colour, intensity, flicker) and `kind_light`
  src/run/mod.rs                     Run struct (`layout` + `level`), tick loop task, damage/heal/kill, end of run
  src/run/levels/                    level types: mod.rs (`LevelRules` hooks, `enum Level`), boss.rs (`BossEncounter`),
                                     dungeon.rs (`DungeonLevel`, the boss dungeon)
  src/run/entities.rs                Player, Monster, Ai, Projectile, Hazard
  src/run/objects.rs                 world objects (chests, barrels, torches): state, `hurt_object`, `use_object`, explosions, snapshots
  src/run/light.rs                   light registry, static light map, `is_lit`, the light API on `Run`
  src/run/abilities.rs               player ability executors, projectiles, explosions
  src/run/ai.rs                      enemy perception/state machine, A*, necromancer raising
  src/run/bosses/                    BossBehaviour trait + demon.rs, lich.rs, dragon.rs
  src/run/visibility.rs              per-player snapshots, filtered by sight and light
  src/run/debug.rs                   debug mode (immortal + path to the level's target, the boss)
  src/export.rs                      (test-only) writes client/src/generated/defs.ts, fixtures.json, wire-fixtures.json
client/                              Vite + TypeScript + Phaser 3.90
  scripts/build-atlas.ts             pack sheet + tile list -> public/assets/atlas.{png,json}
  scripts/lich-frames.ts             the lich's own pixel frames + staff (pixel grids in pack colours)
  scripts/barrel-frames.ts           plain and explosive barrel (pixel grids in pack colours, from AI art)
  scripts/torch-frames.ts            torch frames cut from the CC0 sheet, plus the burnt-out one
  scripts/build-logo.ts              title logo -> public/assets/{logo,logo-emblem,favicon}.png
  scripts/png.ts                     minimal PNG decode/encode (zlib only) for the atlas recolors
  assets-src/0x72/                   0x72 DungeonTileset II v1.7 (CC0): sheet, tile_list, README, LICENSE
  assets-src/logo/logo.png           title logo, made with Google's image generation AI
  assets-src/barrel/                 the barrel's AI-generated source image (ChatGPT)
  assets-src/torch/                  "Simple Torch Animation 16x16" (CC0) with its licence note
  src/main.ts                        boot: login -> character screen -> WebSocket, Phaser game, Lobby/Hud/GameScene; demo pages
  src/api.ts                         fetch wrapper for /api/* (the session cookie is HttpOnly; JS never sees it)
  src/net.ts                         WebSocket + msgpack, ping/RTT, network simulator (?lag=)
  src/wire.ts                        unpacks compact snapshots into Snapshot, packs inputs (+ wire.test.ts)
  src/generated/                     GENERATED by `cargo test` — do not edit by hand
  src/sim/                           TS ports of server collision + FOV (+ sim.test.ts vs fixtures)
  src/game/world.ts                  Interpolator (remote entities) + Predictor (own player)
  src/game/GameScene.ts              board rendering, light canvas, input/prediction, entity sync, events, debug path
  src/game/autotile.ts               chooses pack wall/floor tiles per cell
  src/game/anim/defs.ts              DATA: how each entity kind looks (pack frames, weapon, swing, ...)
  src/game/anim/EntityView.ts        one figure: ground shadow + body + weapon; attack animation logic
  src/game/mimic.ts, chest.ts        mimic (hop, bite, reveal) and treasure chest views
  src/game/barrel.ts, damage.ts      barrel view (fuse flash, fall, sink); damage number colours per type
  src/game/light.ts, lightview.ts    `LightField` (static light map and colour mixing, same rule as the server) and `LightView` (darkness and tint canvases)
  src/game/torch.ts                  wall torch view (flame, burnt out, side sconces)
  src/game/effects.ts                pooled particles, rings, swooshes, floating numbers
  src/game/GalleryScene.ts           dev page ?gallery
  src/game/MimicDemoScene.ts         dev page ?mimic (chaser mimic, chest, reveal; no server)
  src/game/DaemonDemoScene.ts        dev page ?daemons (imp, chort, summoner vs a knight; no server)
  src/game/TerrainDemoScene.ts       dev pages ?water, ?chasm, ?lava (scripted figures; no server)
  src/game/KnockbackDemoScene.ts     dev page ?knockback (every push in the game, on the terrain demo base)
  src/game/OgreDemoScene.ts          dev page ?ogre (club vs orc push, ground slam, on the terrain demo base)
  src/game/LichDemoScene.ts          dev page ?lich (gloom volley, summon 5 + 5, nova push, on the terrain demo base)
  src/game/LightsDemoScene.ts        dev page ?lights (coloured lights, lava, torches, moving glows, a dark corridor)
  src/game/terrain.ts                terrain layer: autotiled water/lava/chasm cells, animation, lava glow
  src/game/terrain-codes.ts          terrain frame layout and edge codes shared with the atlas build
  src/ui/                            DOM screens: auth (login/register), characters (select/create/delete, account),
                                     lobby, HUD, classes (figures + class card), texts, atlas previews
  admin.html, src/admin/             the separate admin page (/admin): main.ts (views), api.ts, charts.ts (SVG
                                     column charts), dom.ts (DOM builder, formatting), admin.css; no Phaser
tools/e2e/                           browser smoke tests and screenshot scripts (playwright-core + installed Edge/Chrome)
docs/                                this file, player guide, TODO
HANDOFF.md                           state + instructions for the next agent
```

## 3. Build, run, test

| Task | Command |
|---|---|
| Run everything | `cp .env.example .env`, fill in the secrets, `docker compose up --build`, then open http://localhost:8080 |
| Server tests (no local Rust needed) | `docker compose -f docker-compose.test.yml run --rm test`, then `... down` (see below) |
| Server tests with local Rust | `cd server && cargo test` (database tests need `DATABASE_URL`, see below) |
| Client dev server | `cd client && npm install && npm run dev` (port 5173, proxies `/ws` and `/api` to :8080) |
| Client checks | `cd client && npx tsc --noEmit && npm test` |
| Client production build | `cd client && npm run build` (runs the atlas build, tsc, vite) |
| Browser smoke test | `cd tools/e2e && npm install && node smoke.mjs http://localhost:8080/ "" shots Wizard,Paladin` |

Server tests in Docker (Git Bash on Windows). `docker-compose.test.yml` starts a throwaway PostgreSQL (in RAM) next to `rust:1-slim-bookworm`. The external volumes `ta-cargo` and `ta-target` cache crates and builds; create them once with `docker volume create`.

```sh
MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test
docker compose -f docker-compose.test.yml down
```

**Database tests:**
- The database tests (`db::tests`, `stats::tests`, and `lobby::tests::a_finished_run_banks_…`) run only when `DATABASE_URL` is set. Without it they pass without checking anything.
- Each test creates its own database `ta_test_<random>` on that server, so they run in parallel.

**Generated files.** `cargo test` (re)writes the following, which must be committed:
- `client/src/generated/*.ts`: the protocol types, from `#[derive(TS)] #[ts(export)]`
- `client/src/generated/defs.ts`: kinds, anim ids, flags, tile ids, constants, class and ability numbers
- `client/src/generated/fixtures.json`: collision/FOV test vectors

**After changing `protocol.rs` or anything in `defs/`, run `cargo test`.** Then rebuild the client.

Environment variables (server):

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Required. `postgres://user:pass@host:5432/db`. Compose builds it from `POSTGRES_PASSWORD`. |
| `SESSION_SECRET` | Required, at least 32 characters. HMAC key of the session cookies; changing it logs everyone out. |
| `COOKIE_SECURE` | `1` adds `Secure` to the cookie. Set it whenever players reach the game over HTTPS. |
| `PORT` | Default 8080. |
| `STATIC_DIR` | `../client/dist`; `/app/public` in Docker. |
| `ALLOW_DEBUG` | On unless `0`/`false`/`no`. |
| `RUST_LOG` | Console log filter (default `info`). |
| `ADMIN_USER`, `ADMIN_PASSWORD` | The admin area's login (§11b). Without both, or with a password under 12 characters, the area answers 404. |
| `ADMIN_SESSION_MINUTES` | Admin idle timeout in minutes (default 10, 1–1440). Each admin action restarts it. |
| `PLAYER_SESSION_MINUTES` | Player idle timeout in minutes (default 10080 = 7 days, at most a year). Any activity restarts it (§11a). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Turns on OpenTelemetry export (§11c), e.g. `http://otel-collector:4318`. The other standard `OTEL_*` variables work too. |

The data lives on the `ta-db` volume. `docker compose down -v` deletes all accounts.

## 4. Protocol

**Accounts API (`/api`, JSON, `api.rs`).** The request and response types are ts-rs exported (`Credentials`, `PasswordConfirm`, `NewCharacter`, `Me`, `ApiError`).

| Request | Effect |
|---|---|
| `POST /api/register {name, password}` | Creates the account and logs in (sets the cookie). Answers `Me`. |
| `POST /api/login {name, password}` | Sets the cookie. Answers `Me`. A wrong name and a wrong password get the same 401. |
| `POST /api/logout {}` | Deletes the session, clears the cookie and closes the account's WebSocket. |
| `DELETE /api/account {password}` | Needs the password again. Deletes the account with its sessions and characters (cascade) and closes its WebSocket. |
| `GET /api/me` | `Me{name, characters: CharacterInfo[], max_characters}`, or 401. |
| `POST /api/characters {name, class}` | 201 with `CharacterInfo`. 409 if the name is taken or the account already has 8 characters. |
| `DELETE /api/characters/{id}` | 204. 409 while that character is in a room or run, 404 if it is not the account's. |

- Errors are `{error: "text for the player"}`.
- Non-GET requests must send `Content-Type: application/json` (415 otherwise).
- The responses carry `Cache-Control: no-store`.

**WebSocket.**
- `/ws` uses binary frames and MessagePack.
- The upgrade needs a valid session cookie (401 otherwise).
- When the browser sends an `Origin` header, it must match `Host` (403 otherwise).
- Server → client: `rmp_serde::to_vec_named` (structs as maps). Client → server: `@msgpack/msgpack` objects.
- Enums use an internal tag `t`, e.g. `{ t: "Input", seq, mx, ... }`. Variant fields must not be named `t`.

**Client → server (`ClientMsg`)**
- `SelectCharacter{id}`: play as one of the account's characters. The server loads it (ownership checked) and answers with `Character`. It is refused while in a room. The client sends it after connecting and after "Change character".
- `CreateRun{name}`, `JoinRun{run_id}`: need a selected character ("Choose a character first").
- `LeaveRun`, `SetReady{ready}`
- `SelectBoss{boss}`: host only, before the start. `null` = random.
- `StartRun`: host only. Turns the room's level and boss choice into a `LevelChoice` (`{level: "Dungeon", boss}`, tag `level`). There is no level picker yet: every room plays `LevelId::Dungeon`.
- `BuyUpgrade{stat}`: buys the next level of an `UpgradeStat` with the selected character's XP. Refused during a run.
- `Input(InputMsg)`: one per 1/60 s step: `seq, mx, my, aim, aim_dist, primary/secondary: Option<shot_id>, view_lag, rtt, act`. `act` is true for the one input after an E press: the hero uses the nearest object in reach (see "World objects" in §5). On the wire it is a bare array `InputW` in that field order (`wire.ts` `packInput`, aim as f32); the server recognizes the MessagePack array marker in the first byte. A `t`-tagged `Input` map is still accepted.
- `Ping{time}`, `Spectate{dir}`, `Debug{on}`

**Server → client (`ServerMsg`)**
- `Welcome{id}`, `Lobby{runs}`, `Room{run_id, name, host, players, level, boss}`
- `Character(CharacterInfo)`: the selected character, sent after `SelectCharacter`, a purchase and banking. Fields: `id, name, class`, unspent `xp`, `total_xp`, `coins`, `upgrades`, resulting `mods`, and `costs[level]` (its length is the max level). The same type is used in `Me`.
- `Room.players` take name and class from each member's character.
- `Error{msg}` right before the server closes a socket explains why (logged in from another window, logged out, account deleted).
- `RunStarted(RunStartInfo)`: the `level` (`LevelId`), full tile grid as bytes, player list, own entity id, spawn, progression `mods`, and `lights: Vec<LightInfo>`: every static light at the start (torches and lava) as `LightInfo(id, kind, colour, x, y, on)` (tile coordinates, colour 0xRRGGBB, `kind` a `LightKind` id)
- `Snap(Snapshot)`: 30 Hz. Contains `tick`, `ack`, entities, `me` (`SelfState`: authoritative position/dash/cooldowns), optional boss bar, events, `srv_ms`, and `lights: Vec<MovingLight>`, the lit moving lights near the viewer (see §7). See "Compact snapshots" below for the wire form.
- `RunEnded{victory, level, boss, time, stats, banked}`: `boss` is the level's end boss, `null` for a level without one (the end screen then shows `LEVEL_TEXT[level]`, `ui/endText.ts`). `banked` is false when debug mode was used (no XP or coins are added). `stats` include each player's `xp` and `coins`.
- `Pong{time}`, `Error{msg}`, `DebugPath{on, points, ogre}`

**Compact snapshots** (`wire.rs`, `wire.ts`, spec in [compact-snapshots.md](compact-snapshots.md)):
- A snapshot is sent as a bare array `SnapW = [tick, ack, ents, me, boss, ev, srv_ms, drain, lights]` (`lights`, field 9, is a list of `LightW = [x, y, kind, colour?]`: positions scaled like entity positions, the colour left out when it is the kind's default), not as a `t`-tagged map. The client sees an array, unpacks it with `unpackSnap` into the readable `Snapshot` and dispatches it as `{t: 'Snap', ...}`, so the game code only knows `Snapshot`.
- Entity and event positions are whole numbers in 1/16 px (`CONST.POS_SCALE`). MessagePack stores them in 3 bytes up to 4096 px and in 5 bytes beyond, so bigger maps need no change.
- Entity `aim` is one byte, 1/256 of a full turn; the client turns 129–255 back into negative angles and 128 into +π, so it gets (−π, π] like `atan2` on the server (the staff swing in `EntityView` uses the raw angle).
- Events are arrays starting with a number code (`EV` in `defs.ts`, order of the `Ev` variants). `Tile` keeps tile coordinates.
- `me` (position, dash, cooldowns, hide time) and all hp/damage numbers keep their exact values; prediction needs them.
- Adding a field to `Snapshot`, `SelfState`, `EntSnap`, `BossBar`, `Ev` or `InputMsg` means adding it to the wire type, `encode_snap`/`ev_w`, `unpackSnap`/`packInput` and `sample_snapshots`.

**`EntSnap`** (the readable form) is a compact array: `[id, kind, x, y, hp 0-255, anim, aim, anim_ms, flags, extra]`.
- `kind`, `anim` and `flags` come from `defs/kinds.rs`. They are exported to `defs.ts` as `KIND`, `ANIM` and `FLAG`. `FLAG.AIRBORNE` marks the flying dragon; `ANIM.TakeOff`, `Land` and `Bite` are the dragon's.
- `extra` for projectiles is `(owner_id << 16) | shot_id`, for monsters the owner id, for fire patches the remaining life in ms.
- Barrels (`KIND.Barrel` 81) send `anim` 0 at rest, 1 while the fuse burns, 2 while falling into a chasm and 3 while sinking in deep water, with `anim_ms` since it started. They are filtered by line of sight like chests.
- Torches (`KIND.Torch` 82) send `anim` 1 lit or 0 out and `extra` = the `TorchSide` (0 `Face`, 1 `West`, 2 `East`). They are sent when in the viewer's sight, lit or not (§7); their light reaches the client through the start info and the light events.
- Chests (`KIND.Chest`) send `anim` 1 once opened, with `anim_ms` since the opening. A sleeping mimic is a normal monster with the `ASLEEP` flag; the client draws it as a closed chest.

**Events (`Ev`)** are collected during the ticks between snapshots. Positional events are FOV-filtered per player (except hits and explosions by heroes, see §7):
- `Dmg{x, y, v, crit, p, ty, imm}`: `ty` is the `DamageType` with the largest share of the hit (the client picks the number's colour from it, `game/damage.ts`); `imm` is set when the resistances reduced a non-zero hit to 0 (the client shows "immune"). On the wire: `[code, x, y, v, crit, p, ty, imm]`.
- `Heal`, `Boom{k}`: `k` 7 is a barrel explosion (6 is the lich's nova, 5 a dust shockwave).
- `Died`, `Raise`, `Immune`
- `Light{id, on, colour}` (wire code 10), `LightAdd{id, kind, colour, x, y, on}` (11), `LightRemove{id}` (12): a static light was switched or recoloured, created or removed. Sent to everyone without a position (not filtered), so every client's light map stays in step; `Light` carries the current state. A light added while the run is built goes out in `RunStartInfo.lights` instead.
- `Tile`: boss hall entrance sealed (force field)
- `Msg`
- `Coins{x, y, v}`: coins found (chest or kill). Sent to every player, not FOV-filtered, because the whole party gets them; the client adds `v` to the HUD counter while alive.
- `Sink{id, x, y, how}`: a hero or a monster is lost to the terrain: `how` 0 falls into a chasm, 1 drowns, 2 climbs back out (debug mode). A hero's `Sink` is not FOV-filtered. The client plays the fall or drown animation and leaves no skull when the following `Died` arrives. Monsters sink the same way (`how` 0 or 1 only); a monster's `Sink` is FOV-filtered (sent with its position) and, like a hero's, is followed by `Died` when the sinking ends (`kill_monster`).

## 5. Server simulation (`run/`)

**Task model.**
- The lobby is an `Arc<Mutex<Lobby>>`.
- `Lobby::start` creates a `Run` and spawns `run_task`.
- `run_task` runs a fixed 60 Hz loop:
  1. drain `RunCmd`s (inputs, spectate, debug, leave) from the mpsc channel
  2. `step()`
  3. send debug paths every 30 ticks
  4. send snapshots every 2 ticks
  5. end on victory/defeat (after a 3 s delay) or when everyone has left, then call `lobby.run_finished`.

**Levels (`run/levels/`).** A run plays one level type. `Run { layout, level, … }`:
- `layout: Layout` (`dungeon/mod.rs`) is what every level fills: `map`, enemy `spawns`, `chests` and `player_spawns`. `Run::new(id, members, seed, LevelChoice)` calls `Level::build`, which returns the layout and the level's own state; then it places the heroes, the shared enemies (each through `Level::enemy_type`, the demon dungeon's swap) and the chests, and last calls the level's `populate`.
- `level: Level` is an enum, one variant per level type: `Dungeon(DungeonLevel)` today (plus `Test`, only in tests, with nothing but default hooks). It answers `id()` (`LevelId`), `boss()`/`boss_mut()` (its `BossEncounter`, if any) and `boss_id()`, and forwards the hooks through the `dispatch!` macro.
- **`LevelRules`** (`levels/mod.rs`) is the trait each level type implements. Its hooks are associated functions taking the whole `&mut Run` (so the level's state stays in `run.level` while they run), and each has a default body, so a level overrides only what it needs:

| Hook | Called | Default |
|---|---|---|
| `populate(run, party)` | at the end of `Run::new` | nothing |
| `tick(run, dt)` | in `step`, after the monsters, before separation | nothing |
| `post_tick(run)` | in `step`, after the clean-up, before the end check | nothing |
| `on_killed(run, id)` | in `kill_monster`; may end the run (`run.ended`) | nothing |
| `on_boss_hurt(run, mi)` | in `hurt_monster` for a boss monster; false = immune | true |
| `failed(run)` | in `check_end` | every hero dead |
| `debug_target(run)` | for the debug path | none (no path) |
| `boss_bar(run)` | for the snapshots | none |

- **`BossEncounter`** (`levels/boss.rs`) is the boss fight any level can include: the boss id and entity, its `BossBehaviour`, `awake`, the `arena` (hall) and its `door`. Its functions are the hook bodies: `spawn` (the boss and its extras, in the arena), `tick` (runs the behaviour once awake), `check_arena` (wake on entry, seal the door once every living hero is inside), `on_hurt` (immunity and wake-on-hit), `on_killed` (the boss's death wins the run), `debug_target` (the boss, else the arena centre) and `bar`.
- **`DungeonLevel`** (`levels/dungeon.rs`) is the room-and-corridor dungeon with an end boss. `build` picks the boss (random from the run's rng when the host chose none), generates the map with the boss's theme, and splits the `Dungeon` (`Dungeon::split`) into the shared `Layout` and its own parts (rooms, start, boss hall, door). Its hooks are the `BossEncounter` functions.
- **Pure refactor (2026-10-14):** the split changed no behaviour. The fingerprint tests `level_setup_is_unchanged` and `simulation_is_unchanged_after_waking_the_boss` pin the map, spawns, entity ids and boss per seed and 300 steps of a boss fight, recorded on the code before the split.

**Tick (`Run::step`), in order:**
1. **Players:** one queued input per tick, two if the queue holds more than 3. No input means no movement, so the server stays deterministic with respect to the client.
   - `apply_input` moves first (`collision::step_move`), then applies dash contact damage, then abilities.
   - **Knockback:** `MoveState` carries `knock_vx/knock_vy` (px/s). While they are non-zero (and the hero is not dashing), `step_move` ignores the input, moves along the knock with `Mover::Dash` (only walls stop it), then multiplies it by `KNOCK_DECAY` (e^-0.25 per 1/60 s step) and zeroes it below `KNOCK_MIN_SPEED` (8 px/s). `apply_input` skips abilities for an input that started knocked, so a pushed hero has no control at all, dash included. `Run::knock_player(pi, from, fallback_angle, dist)` sets the start speed `collision::knock_speed(dist)` so the geometric slide covers `dist` px, straight away from `from`. It does nothing for dead, sinking or dashing heroes; a new push replaces an old one. Sinking and death clear it.
   - Cooldowns tick per processed input. The client does the same.
   - `terrain_player` then checks the tile under the hero's centre (not while dashing; a pushed hero slides on the ground, so a push over a chasm or deep water sinks them). A chasm or deep water starts `Player.sinking` (`FALL_TIME` 0.7 s / `DROWN_TIME` 0.9 s, `Ev::Sink`); then `kill_player` kills the hero (armour does not help) with "X fell into the abyss" / "X drowned". A sinking hero's inputs are acked but neither move nor attack. Lava calls `hurt_player(LAVA_DAMAGE)` every `LAVA_TICK` (10 per 0.5 s, the first at once), so armour and debug apply. In debug mode `kill_player` puts the hero back on `Player.last_safe` (centre of the last safe tile) instead.
2. **Monsters:** only those within 420 px of a living player run `ai::tick_monster`.
3. **Level tick** (`LevelRules::tick`): in the dungeon the boss behaviour, once the boss is awake.
4. **Separation:** overlapping monsters are pushed apart.
5. **Projectiles and hazards.**
6. **Position history:** each monster's position goes into a 32-entry ring buffer, used for lag compensation.
7. **Cleanup:** dead objects are removed, then `sweep_lights` drops the moving lights whose entity is gone.
8. **Level post-tick and end of run** (`LevelRules::post_tick`, `check_end`): in the dungeon the boss wakes when any player enters the hall, and the entrance is sealed (DoorClosed tiles) when all living players are inside. Then the run is lost if the level's `failed` says so (default: every hero dead). Victory is set earlier, by `on_killed`.

**Combat.**
- `hurt_monster`:
  - asks the level (`on_boss_hurt`) for boss monsters: the `BossEncounter` honours `BossBehaviour::can_be_damaged` (the lich is immune while disciples live) and wakes the boss
  - makes an unaware monster search toward its attacker
  - credits damage and kills
- `kill_monster` recursively kills the monster's minions (`owner`): necromancer skeletons, summoner imps, the lich's disciples and summons. It also awards XP and coins to living players (`Player.xp`, `Player.coins`) and calls the level's `on_killed`, which sets victory if the boss died.
- **Chests and mimics.** `Run::new` turns `Layout.chests` into world objects (`ObjState::Chest`, real ones; see "World objects") and sleeping `EnemyType::Mimic` monsters. `touch_chests` (every step) opens a chest when a living player is within `CHEST_TOUCH` (12 px): `CHEST_COINS` (8–15) to every living player through `give_coins`. The same distance wakes a mimic (`wake_mimic`), as does any player hit (`hurt_monster`). A woken mimic holds still for `MIMIC_WAKE_T` (`Ai.hold`, the lid flying open), then uses the normal AI. `boss::check_arena` wakes every sleeping monster except mimics. Sleeping monsters are not pushed by `separate_monsters`.
- **Mimic gait.** `ai::gait` makes the mimic hop: it moves only while its Move animation clock is in `MIMIC_HOP_AIR` (0.2–0.7 of a 0.6 s `MIMIC_HOP_CYCLE`), at its average speed divided by that fraction. The constants go to the client through `CONST`, so `mimic.ts` draws crouch, flight and landing from the same clock (`anim_ms`). An awake mimic does not wander.
- `hurt_player` takes a `Damage`, calls `resolve`, then applies the XP armour upgrade (`mods.armor`) to what is left, and skips HP loss in debug mode. Death switches the player to spectating. A negative `resolve` result heals instead (see "Damage model").
- **Who pushes:** `AttackStyle::Melee` has a `knock` (px): ogre club 28, orc warrior 20, chort claw 14, everything else 0. `AttackStyle::Slam` (the ogre's ground slam) pushes every hero within its radius 24 px straight away. `ai::perform_attack` calls `knock_player` after a melee hit. `Ranged` has no knock field, so enemy ranged attacks never push. Bosses push in their behaviours: the demon's cleave (56) and swoop (64, the user asked for "significant knockback"); the dragon's front claw (32), bite (24), tail whip (44), landing smash (36, everyone in `DRAGON_SMASH_RADIUS`) and fireball explosions (20: `Projectile.knock`, applied by `abilities::explode` to the heroes it hits). The demon's and the dragon's numbers are in `defs/bosses.rs` (`DEMON_*_KNOCK`, `DRAGON_*`). Heroes never push enemies with their own attacks; barrel blasts push them (see "Monster knockback and terrain deaths").

**Damage model (`defs/damage.rs`, `defs/entity_types.rs`).** Every hit is a `Damage { amount, split }`; there is one formula.
- **Types:** `DamageType` is `Physical 0, Cold 1, Heat 2, Magical 3, Poison 4`. The server exports the ids as `DMG_TYPE` (`generated/defs.ts`); the colours live in the client (`game/damage.ts`).
- **`DamageSplit`** gives each type a share, always summing to 1. Constructors: `physical()`, `pure(t)` and `split(&[(t, share)])`; the rest of a partial list is filled up with physical (debug builds assert that the shares stay within 1). `main_type()` is the largest share and goes into `Dmg.ty`.
- **`Resistances`** is one fraction per type (`NONE`, `of(&[...])`, `plus`). 0.5 takes half off, 1.0 is immune, above 1.0 the hit heals, below 0 is a weakness.
- **`resolve(&Damage, &Resistances) -> f64`** is the sum over the types of amount × share × (1 − resistance), with each resistance floored at −100 % (`MIN_RESISTANCE`), so a weakness at most doubles a part. A negative result means healing. Nothing else computes damage.
- **Attack splits:** melee uses the attacker's `Profile.melee`. Projectiles and effects use `kind_split(EntityKind)`: arrows and bolts physical; magic missile, shadow and gloom bolts magical; fireball 70 % heat, 20 % magical, 10 % physical; fire bolt and fire orb 70 % heat, 30 % magical; frost bolt cold; dragon fireball, breath and fire patches heat. The `Projectile` carries its `Damage`, and `abilities::explode` takes one. Lava is heat, per tick. The barrel blast is 50 % heat, 50 % physical. Falling and drowning are not damage.
- **Entity types** (`EntityType`, table in `type_def`; first guesses for the balancing pass):

| Type | Resistances | Melee split |
|---|---|---|
| Human | none | physical |
| Undead | physical 10 %, heat −10 %, poison 100 % | physical |
| Monster | none | physical |
| Demon | magical 20 %, heat 100 %, cold −50 % | 80 % physical, 20 % heat |
| Dragon | magical 50 %, physical 10 % | physical |
| Object | physical 50 %, poison 100 % | physical |

- **Profiles:** `entity_types::profile(&[EntityType], Adjust)` adds the resistances of all listed types and the adjustment, and takes the adjustment's melee split, else the first type's. The result (`Profile { res, melee }`) is computed once at spawn and stored on every `Player`, `Monster` and `WorldObject`. Each def has a `profile()`: `classes::profile`, `enemies::profile`, `bosses::profile`, `objects::profile`. Adjustments: lich physical +40 % and magical +40 %; dragon heat +100 % and melee 20 % heat; demon boss magical +20 %.
- **Who is what:** the four classes plus necromancer, summoner and disciple are human; skeletons, raised skeletons and archers and the lich are undead; goblin and orc archers, orc warrior, mimic and ogre are monsters; imp, chort, summoned imp and the demon boss are demons; the dragon boss is a dragon; chests and barrels are objects.
- **Healing above 100 %:** `hurt_player` calls `heal_player` for a negative result (capped at max HP, a `Heal` event only when something was healed); `hurt_monster` heals the monster directly (a `Heal` event only when something was healed). The XP armour upgrade stays and is applied after `resolve`; removing it waits for items (TODO, "Damage-type system").

**World objects (`run/objects.rs`, `defs/objects.rs`).** `Run.objects: Vec<WorldObject>` holds everything on the map that is neither hero nor monster. A `WorldObject` has `id`, `kind` (an `EntityKind`; there is no separate object kind enum), `pos`, `radius`, `solid`, `res`, `gone` (removed at the end of the step) and a per-kind `ObjState`.
- **`ObjState::Chest { opened }`:** as before the move (coins on touch, mimics wake nearby). Chests are not solid and take no damage, and `touch_chests` loops over the chest objects.
- **`ObjState::Barrel(Barrel)`:** `fuse: Option<f64>`, `lit_at`, `igniter` (entity id of the hero who lit the chain), `vel` (slide after a push) and `sinking: Option<(time left, Sink, start)>`.
- **`hurt_object(run, oi, Damage, by)`:** calls `resolve`; chests ignore damage. A barrel whose result is above 0 and that is neither lit nor sinking gets a fuse of `BARREL_FUSE` (0.3 s) and remembers `by`. Every hero attack but the dagger reaches objects: shots (`advance_projectile`), `melee_arc`, `dash_contact` and `explode`; `dagger_target` stays monsters-only by design. Enemy and boss area attacks hit objects too, with no igniter (`objects::hurt_objects_in`, built on `objects_in(run, at, r, cone)`, which mirrors `bosses::players_in`: an object counts when its centre is within `r` plus its radius, and inside the cone if one is given): the ogre slam, the dragon's landing smash, tail, claw, bite and breath pulses (the breath with the same line-of-sight check as for heroes), the demon's cleave and swoop, the lich nova and fire-patch pulses (`tick_hazards`). Single-target monster melee only hits heroes. Objects resist poison fully through the `Object` type.
- **`tick_objects`** (every step): sinking barrels count down and disappear without a blast; the others slide, check the ground (`barrel_terrain`) and burn their fuse. A barrel lit during this step by an earlier blast starts burning its fuse on the next step, so a chain advances one link per 0.3 s. No barrel explodes twice: `gone` is set first, and a lit or sinking barrel is not lit again.
- **`explode_barrel`:** sends `Boom k 7` (`BOOM_BARREL`), then hurts every hero, monster (bosses included) and barrel within `BARREL_BLAST_R` (40 px, plus the target's radius) that has line of sight to the blast, with `barrel_blast()` (30 damage, 50 % heat, 50 % physical). Heroes are pushed with `knock_player`, non-boss monsters with `knock_monster` (`BARREL_BLAST_KNOCK`, 40 px). Damage and kill credit go to the igniter. A chain lit by an enemy shot, or by a hero who has left, still explodes and gives no credit.
- **`use_object(run, pi)`** is the one use entry point: a living, not sinking hero uses the nearest barrel whose gap to the hero is at most `USE_REACH` (6 px). `apply_input` calls it for `act`, but not for an input that started knocked. For a barrel it is `push_barrel`: slide `BARREL_PUSH` (48 px) straight away from the hero. Chests do nothing. Levers, torches and the like will use the same entry.
- **Sliding barrels** move with `Mover::Dash` and the knockback decay (`KNOCK_DECAY`, `KNOCK_MIN_SPEED`). Walls, other solid objects, heroes and monsters stop them (heroes and monsters are not shoved; the body test is a square, |dx| and |dy| below the body radius plus the barrel's half size, so a barrel never ends inside a body's box). Every step the new position is rounded to the wire grid (multiples of 1/`POS_SCALE` px), so a moved barrel is always exactly representable in a snapshot and the client's predicted solids equal the server's (a 1/32 px rounding gap would exceed `move_box`'s `EPS` and let heroes snag on or walk into a pushed barrel). Dungeon barrels are placed on tile centres, which are already on the grid. `barrel_terrain`: over a chasm it falls (`Sink::Fall`, `FALL_TIME`), in deep water it sinks (`DROWN_TIME`) with no blast, in lava the fuse is set to 0 and it explodes.
- **`ObjState::Torch { wall, side, light, lit }`:** a wall torch (`EntityKind::Torch` 82), non-solid, `Object` entity type, never breaks. `wall` is the wall tile it hangs on, `side` a `TorchSide` (`Face`: on a brick face with floor below; `West`/`East`: on a side wall with floor to its east/west), `light` the id of its static light (kind `Torch`), which sits on the floor tile in front of the wall (`TorchSpawn::front`), so the shadowcast starts inside the room. `spawn_torch` is called from `Run::new` for each `Layout.torches` entry, after the barrels (every other entity keeps its id) and before `add_lava_lights`. `set_torch(run, oi, on)` is the one switch: it sets `lit` and calls `set_light`.
  - **E** (`use_object`) toggles the nearest torch or barrel in reach.
  - **`hurt_object`:** a hit whose split has any `Heat` share lights the torch, any other damage that gets through its resistances puts it out. So fire shots, fire patches and barrel blasts (50 % heat) light torches; sword swings, dashes and arrows put them out.
  - **What reaches a torch:** area attacks and blasts by distance (`objects_in`, like barrels) and, in `advance_projectile`, a plain (non-exploding) shot that stops in the torch's wall tile (an exploding one reaches it by its blast).
- **Snapshots:** `objects::snap` encodes one `EntSnap` per object (anims in §4). `visibility.rs` filters objects by sight and light, like chests before; a torch (`owns_light`) is sent when in sight, lit or not.

**Light sources (`defs/lights.rs`, `run/light.rs`).** A general system: torches, lava and glowing shots are only its first users, and a new source never touches the core (see "How to add a light source", §11).
- **Kinds (`defs/lights.rs`, data only):** `LightKind` `Torch`, `Lava`, `Fire`, `Magic`, each with `radius` (tiles), default `colour` (0xRRGGBB), `intensity` (0..1, client only) and `flicker` (0..1, client only). Today: torch 5 / orange / 1.0 / 0.15, lava 1 / red / 0.8 / 0.05, fire 3 / orange / 0.9 / 0.2, magic 2 / violet / 0.7 / 0.1. All first guesses for the balancing pass. `kind_light(EntityKind) -> Option<(LightKind, Option<Colour>)>` is the one place that says which entity kinds carry a light from spawn: fire shots and fire patches glow orange, `Missile` violet, `FrostBolt` ice blue (0x78c8ff), `ShadowBolt` and `GloomBolt` purple (0xaa3cdc); arrows and bolts carry none. `export.rs` writes the table to `defs.ts` as `LIGHT` and `LIGHT_KIND`.
- **Registry (`Run.lights: Lights`):** `LightSource { id, kind, colour, anchor, on }`. Light ids are separate from entity ids. `Anchor::Tile(x, y)` is a **static** light, `Anchor::Entity(id)` a **moving** one that follows a monster, projectile, hazard, hero or object (found by `entity_pos` in any list). Static or moving depends on the anchor alone, never on the kind.
- **API on `Run`** (the only way features touch light): `add_light(kind, anchor, colour: Option<Colour>) -> id` (`None` = the kind's colour), `set_light(id, on)`, `set_light_colour(id, colour)`, `remove_light(id)`, `is_lit(pos) -> bool`; `Lights::get(id)` reads one source back. Changes to **static** lights send `Ev::Light`, `LightAdd` and `LightRemove` (§4); a static light added while the run is built (`tick == 0`) sends nothing and goes out in `RunStartInfo.lights`. A moving light never sends an event: its position travels in `Snapshot.lights`.
- **Static layer:** `Lights` keeps one `bool` per tile. Each lit static source runs `fov.rs` shadowcasting from its tile with its kind's radius and ORs the result in; opaque tiles stop the light but are lit themselves, as with sight. Any add, remove, switch or map change sets a `dirty` flag (`mark_dirty`), and `refresh` rebuilds the layer lazily on the next query (visibility calls it once per snapshot round). Cost: one shadowcast per static source, only after a change.
- **Moving layer:** no map. `moving_lights()` lists every lit `Entity` source at its entity's current position (`Lit { pos, reach, kind, colour }`), and `reaches(map, lit, p)` is the test: distance within reach and `line_of_sight`. Only a few exist at a time, so this stays cheap.
- **`is_lit(pos)`:** the static layer at the tile of `pos`, or any moving light that reaches `pos`.
- **Attaching and the sweep:** `attach_kind_light(id, kind)` adds the light `kind_light` names; the spawn paths of projectiles and hazards call it (a shot that dies in its first step gets none). `sweep_lights` (after the step's cleanup) drops moving lights whose entity no longer exists, so no despawn path can leak one.
- **Lava:** `add_lava_lights` (in `Run::new`, after the torches) puts a static `Lava` light on every lava tile. `Run::set_tile` is the way to change a tile mid-run: it sends `Ev::Tile`, keeps the lava lights in step (add or remove, with events) and marks the light map dirty (a door or wall changes what light reaches).
- **Numbers** (`defs/objects.rs`, all first guesses): radius 6 (a 12 px square), fuse 0.3 s, blast radius 40 px, blast damage 30, blast push 40 px, push 48 px, use reach 6 px.

**Solid objects in movement (`collision.rs`).** `move_box` and `step_move` take `solids: &[Solid]` (`Solid { x, y, half }`, squares). Solids are checked axis by axis like tiles; a figure that already overlaps one may still move away from it in any direction, so nobody gets trapped. `Run::solids(except)` lists the objects for which `WorldObject::blocks()` holds (solid, not gone, not a sinking barrel). The same predicate decides whether a shot stops at an object (`advance_projectile`), which tiles A* avoids (`Run::object_tiles`) and whether a straight walk is clear (`ai::object_free_line`), so a sinking barrel stops nothing. They apply to heroes (`apply_input`), monsters (`ai::move_toward`, `separate_monsters`, `slide_monster`) and sliding barrels. The TypeScript port (`sim/collision.ts`) has the same parameter, and the predictor (`world.ts`, `Predictor.solids`) takes the barrel positions from the latest snapshot (`GameScene` keeps those with `anim < 2`). The shared fixtures include runs with barrels, so `sim.test.ts` pins Rust and TypeScript to the same result. Barrels do not block sight.

**Monster knockback and terrain deaths (`run/mod.rs`).**
- `Monster` has `knock` (px/s), `sinking`, `burn_t` and `last_hit_by`. `knock_monster(mi, from, dist)` pushes a monster straight away; bosses, airborne and sinking monsters are never pushed. A pushed monster slides (`slide_monster`: `Mover::Dash`, so only walls and solids stop it) and its own movement is skipped meanwhile.
- `terrain_monster` runs after the AI step, like `terrain_player`. A monster over a chasm or deep water starts sinking (`FALL_TIME` / `DROWN_TIME`, `Ev::Sink` with the monster's id, wind-up cleared); when the time is up, `kill_monster` runs once, with the kill credited to `last_hit_by`. Bosses are skipped. Lava burns monsters that are not lava walkers (`Mover::Demon`) with heat damage `LAVA_DAMAGE` every `LAVA_TICK`; a lava death gives no kill credit. A monster standing on ground it cannot walk (lava) walks out first (`ai::escape_terrain`, ignoring heroes). The client reuses the hero fall and drown animations for monster figures.
- Known gaps (deferred): `escape_terrain` has no fallback when no walkable tile lies within 3 tiles, so such a monster stays put; a wind-up is not cleared by `knock_monster` (only by sinking), so an attack may resume after the slide.

**Lag compensation.**
- Melee arcs, the dagger and dash contact test monster positions rewound by the client's `view_lag` (RTT/2 + its interpolation delay), up to 31 ticks.
- Player projectiles spawn fast-forwarded by RTT/2, at most 150 ms, through the same 4 px hit-checked steps as every tick (`advance_projectile`), so the fast-forward cannot skip an enemy. Every shot ends at the first wall or figure it meets: hero shots never pass through enemies (an explosion still hits everyone in its radius).
- **Shot hitboxes:** player projectiles hit a monster when `Monster::shot_dist` is below its radius plus the shot's. Shots are drawn `SHOT_HEIGHT` (8) px above their ground point and figures stand up from their feet, so the hitbox is a capsule from the feet north to `EntityKind::body_height` (sprite height above the feet, measured from the atlas) minus `SHOT_HEIGHT` and the radius, plus the dragon's lift while airborne. Small figures stay (nearly) round; the demon is hit up to its horns. Movement, melee and explosions still use the round footprint.

**AI (`ai.rs`).**
- **Wide figures:** `path_toward` (also used by the bosses' chase since boss halls have chasms) treats figures wider than a tile (the demon, the dragon) specially: the straight-line shortcut also checks lines offset by their radius against terrain (`collision::terrain_line`; walls are fine, figures slide along them), A* (`astar_clear`) charges extra for tiles next to anything they cannot enter, a waypoint they make no progress toward is skipped, and a boss with no path walks straight at the hero. The swoop still charges in a straight line and stops at a chasm edge.
- **Movers:** each monster has a `mover`: `Mover::Demon` for imps, chorts, summoners, summoned imps and the demon boss, `Mover::Enemy` otherwise. `move_toward`, `separate_monsters`, `astar` and summon spots use the walking rule for it, and `path_toward` only walks straight when `walk_line` (not just line of sight) is clear. So enemies never enter chasms or deep water, and only demons cross lava. The debug path to the boss is planned as `Mover::Enemy`, around all terrain.
- **Targets:** `Ai.target` is `Option<Target>`, `Target::Player(id) | Object(id) | Place(Vec2)`. Perception sets `Player` every tick. The barrel an enemy aims at lives in its `Windup` (`Windup.at: Option<Target>`), because perception would overwrite `ai.target`. `Place` has no user yet.
- **Enemies shoot barrels:** before a ranged attack of a non-boss enemy (`ai::barrel_near`), it looks for an unlit, resting barrel that it can see, within its range, within the blast radius of its target hero, and far enough from itself that the blast spares it (blast radius + its own radius + 8 px). It picks the one closest to the hero and winds up toward it. When the wind-up ends, it shoots the barrel if it is still there and unlit, else the hero. Bosses and melee enemies never do. Enemy shots stop at a barrel and hurt it.
- **Pathing around barrels (beyond the plan, added because big bosses got stuck):** `path_toward` walks straight only when `object_free_line` is clear, i.e. no solid object within the body's radius plus 6 px of the line. Otherwise it runs A* (`astar_clear`) with the tiles under resting barrels blocked (`Run::object_tiles`) and an extra cost of 8 for tiles next to a barrel (the "squeeze" cost; it applies to all monsters). So a chaser switches to A*, refreshed every 0.6 s, whenever a hero stands next to a barrel; that costs a little CPU and can make chasers slightly late there. Sinking barrels do not count (`WorldObject::blocks`).
- Perception: the nearest living, non-hidden player within `sight` and with line of sight. Enemies never target players they cannot currently see.
- States: `Idle` (wander near home) → `Chase` (melee approach, ranged keep a preferred distance) → wind-up → attack. Losing sight leads to `Search` (A* to last known position) and then `Return` (A* home).
- Wind-ups telegraph attacks: the client flashes the body red and shakes it. The hit lands only if the target is still seen.
- Necromancers raise up to 3 skeletons (cooldown 7 s); summoners summon imps (`SummonedImp`, drawn as a normal imp) the same way. `Ev::Raise.k` tells the client which effect to draw (0 green, 1 fire, 2 the lich's dark purple).
- **Ogre (mini-boss):** `EnemyType::Ogre` (`KIND.Ogre` 22), radius 10 (wide, so its chase uses `path_toward` with clearance like the bosses instead of `move_toward`), 260 HP, slow. Main attack: club (`Melee`, knock 28). Alt: `AttackStyle::Slam{radius, damage, cooldown, windup, knock}`, chosen when two living heroes' centres are within `OGRE_SLAM_RADIUS` (34 px), or one while the club is on cooldown. Its wind-up uses `Anim::Slam` (10); the client draws the telegraph ring from `animT` and `CONST.OGRE_SLAM_RADIUS`/`OGRE_SLAM_WINDUP`. At impact the server sends `Ev::Boom{k: 5}` (dust shockwave) and hits and knocks every living hero in the radius. It is not a boss (`is_boss` false): no boss bar, no force field; the client draws a wide HP bar over it, always visible.
- **Second attack:** `EnemyDef.alt` is an optional second `AttackStyle` with its own cooldown (`Ai.alt_cd`). A melee alt is used when the target is in claw reach (imp), a ranged alt only from at least `ALT_BOLT_MIN_DIST` (40 px) and beyond the main attack's reach (chort). `Windup.alt` remembers which attack the wind-up leads to; each attack keeps the other back for `ATTACK_GAP` (0.4 s). Movement follows the main attack.
- **Demon dungeon:** `enemies::for_boss` (through `Level::enemy_type`) swaps types when `Run::new` spawns the dungeon's enemies: with the demon as boss, skeleton archers become imps, skeleton warriors chorts and necromancers summoners. The swap itself leaves the map alone; only the terrain theme differs per boss (lava or water, see §6), which can move a few spawns off the liquid.
- Minions are never tinted: raised skeletons and summoned imps look like the ordinary ones (the user's request). Hiding drops the aggro of all monsters targeting the hider.

**Bosses (`bosses/`).**
- Interface: `trait BossBehaviour { spawn_extras, can_be_damaged, enraged, tick }`, created by `bosses::create(BossId)` and held by the level's `BossEncounter`. During its tick the behaviour is taken out of the encounter (`behaviour: Option<…>`), so it can borrow `Run` mutably.
- Boss HP is `base × (0.5 + 0.5 × players)`.

| Boss | Base HP | Behaviour |
|---|---|---|
| Demon | 1300 | Cleave 120°/34 px (wind-up 0.45 s), swoop (a charge on foot) 260 px/s after a 0.6 s wind-up, ring of 16 fire orbs after a 0.5 s wind-up. Each attack's animation (`Melee`, `Dash`, `Cast`) starts with its wind-up and runs on through a short recovery (0.3 / 0.25 / 0.35 s: the strike frames play out); the timings are `DEMON_*` in `defs/bosses.rs`, shared with the client. Enraged below 40 % HP: faster and quicker cooldowns; every timer runs 1 / `DEMON_ENRAGED_PACE` (0.6) as fast, wind-ups and recoveries included, and the client shortens the wind-up frames to match. |
| Lich | 900 | Spawns `LICH_DISCIPLES` (6) disciples in a ring. Immune and healing 6 HP/s per living disciple. Volley of 5 gloom bolts (`KIND.GloomBolt` 60). Summon every 12 s tops its raised minions up to `LICH_SKELETONS` (5) `RaisedSkeleton` and `LICH_ARCHERS` (5) `RaisedArcher` (drawn as a skeleton archer, 20 HP, 2 XP) in a ring (`Ev::Raise{k: 2}`). Nova every 10–12 s (`LICH_NOVA_EVERY`, regardless of distance): `Anim::Slam` for `LICH_NOVA_WINDUP` (1.2 s) standing still (purple telegraph ring), then `Ev::Boom{k: 6}`, 24 damage and a 64 px push (`LICH_NOVA_KNOCK`, the strongest normal-enemy push is the ogre club's 28) for every hero within `LICH_NOVA_RADIUS` (56 px). Order of choice: summon, nova, volley. |
| Dragon | 2000 | Breath: 0.8 s wind-up, then 1.4 s damage pulses in a 115 px, ±0.38 rad cone, leaving burning patches. Bite (narrow arc straight ahead, 46 px, own cooldown; chosen before the claw when ready), front claw (wide arc, 40 px), tail whip vs players behind it, volley of 3 exploding fireballs (push 20). After each strike a short recovery (the strike frames play out). Flight every 10–12 s (`DRAGON_FLIGHT_EVERY`): `Anim::TakeOff` 0.5 s standing still, then 3.5 s airborne (`Monster.airborne`, `FLAG.AIRBORNE`; `melee_arc`, `dash_contact` and `dagger_target` skip it; only the breath; chases with `path_toward`), then `Anim::Land` 0.6 s and the smash (`Ev::Boom{k: 5}`, damage and push within 40 px). Attack anims (`Melee`, `Bite`, `Tail`, `Breath`) start with the wind-up; the client shows the wind-up frame for `DRAGON_*_WINDUP` s. |

## 6. Dungeon generation (`dungeon/generate.rs`)

The map is 140×140 tiles of 16 px. Tile ids: Void 0, Floor 1, Wall 2, DoorOpen 3, DoorClosed 4, ShallowWater 5, DeepWater 6, Chasm 7, Lava 8.

**Tile rules (`dungeon/mod.rs`, mirrored in `client/src/sim/map.ts`).** There is no single "solid" rule any more:
- `opaque`: Void, Wall and DoorClosed. Blocks sight (FOV, `line_of_sight`) and projectiles. Terrain is never opaque.
- `blocks(x, y, mover)`: opaque tiles block everyone. Deep water blocks every mover but `Dash`; chasms block `Enemy` and `Demon` (heroes may step in, and fall); lava blocks only `Enemy`.
- `speed_factor(pos, mover)`: `SHALLOW_SPEED` 0.7, `LAVA_SPEED` 0.4 (1 for demons), 1 for a dash. `step_move` takes it from the tile under the hero's centre at the start of the step.
- `safe`: Floor, DoorOpen and ShallowWater, the ground a hero can stand on unharmed. Generator reachability (`bfs`) and `last_safe` use it.

The generator is seeded (ChaCha8) and deterministic:
1. **Placement:** built in a canonical orientation. The start room (8×8) is at the bottom center and the boss hall (26×20) at the top center. Rooms (6–10) and halls (12–18 × 11–15) are rejection-sampled below a band that keeps them away from the hall.
2. **Connections:**
   - a minimum spanning tree plus up to 6 extra loop edges, carved as 3-wide L corridors
   - the boss hall gets a single corridor with a 3-tile entrance (DoorOpen tiles, sealed later)
   - one-tile wall stubs left by overlapping carves (a cell with floor on three sides and around both corners between them) are filled with floor; they would draw as T junctions, and filling them opens no new path
   - walls are placed on every void cell next to floor
3. **Validation, retried on failure:** every room is reachable (BFS), and the boss hall is the farthest area by path distance, with a margin of 4 tiles.
4. **Population:** enemies scale with path depth. Necromancers appear only in halls.
   **Chests:** `place_chests` gives about one in three rooms and halls a chest on its top row (enemies never spawn there), against the wall, with floor on both sides and below so it never blocks a corridor mouth. A quarter are mimics. Chests use their own random stream (a clone of the generator rng on stream 7), so adding them did not change the maps of existing seeds.
5. **Terrain:** `place_terrain` runs on its own stream (8), like the chests. The theme (`Theme::for_boss`: lava for the demon, water otherwise) is passed into `generate(seed, theme)`; `DungeonLevel::build` picks the boss before generating. In ordinary rooms (40 %) and halls (two tries at 60 %) it places:
   - **pools:** ovals a tile away from the walls. Water pools are deep wherever all 8 neighbours are pool, so a shallow rim always surrounds the deep centre; lava pools are all lava
   - **chasm strips:** wall to wall across the room, 1 to `MAX_CHASM` (3) tiles wide so the Barbarian's dash clears them, with a 2–3 tile floor bridge

   A feature only covers floor, keeps two tiles from corridor mouths (open ground outside the room) and never covers a chest. It is undone if it cuts any safe ground off from the start or makes a room as far as the boss hall. Enemy spawns it covers move to the nearest free floor tile in the room. The start room stays clear. About 4 % of the floor becomes terrain.

   **Boss hall chasms** (`place_boss_chasms`, stream 9, every theme), so knockback matters in boss fights: one or two **wall strips** (4–7 tiles long, 1–2 deep, along any wall) and one or two **pits** (2x2 to 3x2, three tiles from the walls). Nothing goes within 3 tiles of the boss's start or near the entrance (the bottom centre, 4 tiles to each side, 5 deep). Pits keep 3 tiles from other chasms (the dragon is over two tiles wide), strips 2. A feature that cuts any hall floor off from the entrance is undone.
   **Lava pool in the demon's hall** (`place_boss_lava`, after the chasms on the same stream, lava theme only, asked for by the user): one oval lava pool (as in the rooms, 4×4 to 7×6), kept off the boss's start and the entrance like the chasms, with a tile of floor between it and any chasm, and undone if it cuts hall floor off from the entrance (up to 100 tries). The demon crosses it unharmed and at full speed (`Mover::Demon`); heroes knocked in are slowed and burn.
   **The ogre** (`place_ogre`, stream 10, after the terrain): one per dungeon, in a random ordinary room or hall at depth ≥ 0.35 (any ordinary room if none fits), on a tile with safe ground in all 8 neighbours and no chest. It is pushed to `spawns`, so it rotates with them. Stream 10 is a clone, so maps, spawns and chests of existing seeds are unchanged.
   **Barrels** (`place_barrels`, stream 11, last, a clone of the generator rng, so the maps, spawns, chests, terrain and ogre of existing seeds are unchanged): about one in four ordinary rooms and halls (at least 6×6) gets a group of 2–4 barrels in a 2×2 block, away from the walls, on tiles with plain floor all around (no wall, door, water, chasm or lava next to them), and not within a tile of an enemy spawn, a chest or another group. The boss hall gets 3–5 single barrels, each with a 7×7 area of plain floor around it (so a wide boss can always pass), outside `hall_keep_clear` (the boss's start and the entrance) and at least 4 tiles from the next barrel. A barrel or group is only placed if, with its tiles counted as walls, no safe tile is cut off from the start that was reachable before. With few valid spots a hall can get fewer than three barrels (best effort). They end up in `Layout.barrels`, and `Run::new` spawns them as objects.
6. **Rotation:** a random quarter turn, so the start can be on any side and the boss hall is on the opposite side.
7. **Torches** (`place_torches`, stream 12, **after** the rotation, so a "face" is a brick face on screen; a clone of the generator rng, so the maps, spawns, chests, terrain, ogre and barrels of existing seeds are unchanged; `level_setup_is_unchanged` leaves torches and their ids out):
   - **Candidates:** a wall cell with floor directly below and no floor left or right (`Face`), or with wall above and below and floor to one side (`West`/`East`, side sconces). Doorway jambs and corners never qualify (the "no floor left or right" test on `Face` is what rules out jambs).
   - **Spacing:** each straight run of candidate cells (per room or corridor stretch, side and line) gets a torch about every `TORCH_SPACING` (6) tiles from an unbiased random offset (`gen_range(0..TORCH_SPACING.min(len))`); runs under 3 cells get none; no two torches touch.
   - **Dark pockets:** each room and each corridor stretch (a connected piece of corridor floor between rooms, found by flood fill) is left without torches with probability `DARK_SHARE` (0.2).
   - **Never dark:** the start room and the boss hall are never dark, and always get at least one torch: if the normal rules give them none, a fallback puts one in the middle of their longest candidate run, whatever its length.
   - The result is `Dungeon.torches` → `Layout.torches` as `TorchSpawn { wall, side }`, and `Run::new` turns them into torch objects.

The test `guarantees_hold_over_many_seeds` checks 200 seeds (both themes), including chest placement (on floor against a wall, outside the start room and boss hall, not on an enemy), that chests and mimics actually appear, and the terrain guarantees: no safe tile cut off, spawns and chests on floor, no terrain in the start room, only chasms (and some) in the boss hall plus a lava pool in every lava-theme hall (none elsewhere), with its centre and entrance clear, only the theme's liquid, every terrain kind present, and a terrain share of 2–15 %.

## 7. Field of vision and light

`fov.rs` is recursive shadowcasting with radius 9 tiles; walls (`Map::opaque`) block sight but are themselves visible. Terrain does not block sight. Sight alone shows nothing any more: **lighting replaced the fog**. Heroes have no light of their own, so a tile is only seen when it is in sight **and lit** (see "Light sources", §5). Unlit tiles are fully black. Sight and light are used in three places:
- **Server snapshots (`visibility.rs`):** `seen(pos)` means on a tile of the viewer's FOV **and** `is_lit`; large figures count as seen if any of their corners is. Monsters, enemy projectiles, hazards, world objects and positional events are only sent when seen. Teammates are always sent, and so are the party's own projectiles, the `Dmg` of their hits and the `Boom` of their explosions (sent without a position), so a shot into the dark flies on and shows its hit instead of vanishing at the edge of the view. The lich drain beams keep their "boss fight on" rule.
  - **Torches** (world objects that own a light, `owns_light`) need sight only (`object_sent`): a torch in the viewer's FOV is sent even if it is out or its tile is dark, one outside the FOV is not. The client's light state does not depend on the torch entities (it comes from `RunStartInfo.lights` and the light events), and a torch sprite outside the FOV sits under full black anyway.
  - **Hero events (`on_hero`):** `Run::event_on_hero` marks an event (hurt and heal numbers on a hero) by its index in the tick's event list. Those are sent where the hero is in sight, lit or not, so a hero hit in a dark corridor still shows the number; every other positional event needs sight and light.
  - **The moving-light list (`Snapshot.lights`):** every lit moving light within the viewer's FOV radius plus one tile plus its own reach (`lights_for`: a distance test with no line-of-sight check), as `MovingLight(x, y, kind, colour?)`. It can include glows from behind walls (§13). The monster that carries a glow is only sent when it stands in seen space.
- **Client light canvas (`LightField`, `LightView`):** replaces the fog canvas, see below.
- **Enemy perception:** this uses `collision::line_of_sight` (4 px sampling) plus each enemy's own `sight` radius. Enemies see in the dark; darkness does not affect them.

**The light canvas (`game/light.ts`, `game/lightview.ts`).**
- **`LightField`** holds the static lights (from `RunStartInfo.lights` and the light events; `GameScene.onEvent` calls `set`, `add`, `remove` and, on `Ev::Tile`, `mapChanged`) and builds the same static light map as the server with the `sim/fov.ts` port. The shared fixture (`export.rs` → `fixtures.json`, checked by `light.test.ts`) pins the TypeScript map to the Rust one, so a tile the server counts as lit is never drawn dark. Colours mix additively: each source adds `colour × intensity × falloff(distance / radius)` per tile and channel, capped at 255 (the falloff is 1 at the centre and 0.45 at the radius edge; torch plus lava gives orange, blue plus red purple). Moving lights from the snapshot are added each frame with the same falloff and a line-of-sight check (`addMoving`).
- **Two canvas textures** (`LightView`), 140×140, 1 px per tile, scaled ×16 and drawn with LINEAR filtering:
  - the **darkness** (`DEPTH.fog` 7000): alpha 1 on every tile not in the viewer's FOV or not lit; on lit tiles in the FOV the alpha is `1 − max(brightness, MIN_LIT)`. `MIN_LIT` (0.35) keeps a lit tile from ever being drawn dark;
  - the **tint** (`DEPTH.tint`, ADD blend, just below the darkness): each tile's summed light colour at `TINT_ALPHA` (0.35), so lit areas take the colour of their lights.
- **Filtering:** Phaser resets a canvas texture to NEAREST filtering on every `refresh()` under `pixelArt`, so `LightView` sets LINEAR again after every upload.
- **Flicker:** each light's brightness wobbles by its kind's `flicker` and a per-light phase (`flicker(kind, id, t)`, two sine waves).
- **Redraws:** `LightView.update` runs every frame, but redraws only the camera's tile window (about 60×34 tiles), so flicker and moving lights cost little. The viewer's FOV is recomputed when the viewer's tile changes or the map does.
- **Draw order:** heroes, teammates and the party's own shots are drawn **above** the darkness (`DEPTH.heroes` 7000.5), so a hero stands visible in a black corridor. Everything else, monsters, objects, torches and weapon effects, stays below it (§13).
- The renderer knows nothing about torches, lava or projectiles: it draws whatever the registry sends. Lava keeps its pulsing glow sprites (`terrain.ts`), which sit under the darkness and only show where lit.

## 8. Netcode and responsiveness

**Input (`GameScene.fixedStep`).**
- Inputs are sent at a fixed 60 Hz. Each step carries movement, the aim, and a shot id when an ability fires; the client fires when the button is held or was clicked and its local cooldown is ready.
- WebSocket `TCP_NODELAY` is enabled on the server listener.
- **Cache headers** (`cache_headers` in `main.rs`): hashed Vite bundles (`/assets/index-*`) are `immutable`; everything else (`index.html`, the atlas) is `no-cache`. Without this, a browser could keep running an old client against a new server, and the tile rules and prediction would disagree.

**Prediction (`world.ts` `Predictor`).**
- Local movement uses the TS collision port. It is bit-identical to Rust, which `sim.test.ts` checks against the Rust-written fixtures.
- On each snapshot the client replays unacknowledged inputs from the server state.
- Errors under 24 px are blended out over about 100 ms; larger errors snap.
- Terrain is part of the port: the speed factor and the walking rules.
- **Solid objects are part of the port** (`Predictor.solids`): the squares of resting barrels from the latest snapshot go to `stepMove`, like the server's `Run::solids`. A barrel moves only after a push or sinks, so prediction next to barrels should need no correction; that is part of the open live check.
- **Knockback is part of the port** (`stepMove`, `knocked()`). `me` carries `knock_vx/knock_vy`, and the replay starts from them, so after the snapshot that reports a push the prediction slides exactly like the server. The push itself is the enemy's action, so the client learns of it about RTT/2 late (a correction, blended or snapped as usual). While predicted knocked, `fixedStep` fires nothing, and the replay drops dashes sent during a push the client learned of late, like the server. The predictor also applies the server's sinking rule (`sinking()` in `sim/collision.ts`): a hero not dashing whose centre is over a chasm or deep water stops moving and attacking, in prediction and in the replay, so a fall needs no round trip and causes no correction. The pending list keeps each input as it was sent, not as predicted: if the server sees no fall (or a debug climb-out already happened there), it applies the move, and the replay must too.
- Local cooldowns and hide time are corrected when they differ from the server by more than 0.15 s / 0.3 s. For both, the server value is first carried through the inputs it has not acknowledged yet, including the abilities they use (`Pending.used` for cooldowns, `Pending.hide` for Hide and the attacks that end it, set through `Predictor.useHide`; like the movement replay). Without that, a snapshot from before the server saw a shot showed cooldown 0, the client reset its own, and a held button fired a second, client-only shot (seen as two arrows when dragging the mouse while clicking). Likewise a fresh Hide flickered off for about RTT until the server had seen it.

**Own attacks.**
- `predictAbility` starts the animation, cooldown, hide or dash locally and spawns cosmetic projectiles.
- The matching server projectile (same `shot_id`) is hidden, also for 2 s after the cosmetic one has ended (`endedShots`). The cosmetic one ends when the server one disappears, at a wall, or at the first enemy it touches (`sim/hitbox.ts`, the port of `Monster::shot_dist` with the exported `HITBOX` table; sampled every 4 px). Without the enemy check a shot that hit within the first ticks never appeared in a snapshot, and its cosmetic copy flew on through every enemy behind.

**Remote entities (`Interpolator`).**
- Snapshots are placed on a server-tick timeline using an estimated clock offset (a low envelope of arrival offsets).
- Remote entities are rendered behind that timeline by an adaptive delay of 1.5 snapshot intervals + 2.5× jitter, clamped to 50–300 ms.
- Brief extrapolation of at most 100 ms covers a missing snapshot.

**Measuring.**
- F3 overlay: FPS, frame time, ping, jitter, interpolation delay, snapshot bytes, prediction correction, server ms per tick.
- `?lag=&jitter=&loss=` simulates conditions in both directions, keeping TCP ordering (`DelayLine`: one FIFO queue and one timer, because browsers round timer delays down to whole milliseconds; a timer per message delivered inputs out of order, which the server then applied out of order, and that caused most of the corrections once seen in busy runs under lag).
- In a busy debug run under `?lag=150&jitter=40&loss=2` (bot walking to the demon and fighting it for 90 s), about 36 of 2,760 snapshots still correct the prediction: almost all are pushes, which the client learns of about RTT/2 late, plus the force field closing during a dash.

**Typical numbers (local):**
- server tick about 0.12–0.14 ms
- snapshot about 127 B with 2 players (the knock is `[vx, vy]` only while pushed, nil otherwise) (248 B before the compact form); a fight with 14 entities in view about 350 B (about 570 B before). Each extra entity costs about 19 B.
- correction 0.00 px

## 9. Rendering (client)

**Art source.**
- Art comes from the 0x72 pack; other CC0 tilesets that fit its style may be added (the user allowed this for terrain and enemies). Terrain tiles (water, lava, chasm) are generated at atlas build time by `client/scripts/terrain-tiles.ts` from pack colours and the pack's `floor_1`, because no CC0 set fit (the user allowed self-made art for terrain tiles only): seamless animated base textures (`terrain_<set>_f<frame>_q<piece>`) plus edge overlays (`terrain_<edge>_e<code>`, a 4-digit quarter code from the 8 neighbours, see `terrain-codes.ts`). `build-atlas.ts` turns `tile_list_v1.7` into a Phaser JSON-hash atlas, so frame names are the pack's own (`knight_m_run_anim_f2`, `weapon_axe`, `floor_1`, …).
- **Dragon frames** (`scripts/dragon-frames.ts`, poses and layout in `src/game/anim/dragonRig.ts`, shared with the client): AI-generated art made for this game at the user's request (2026-10-09 to 10-12), in `client/assets-src/dragon/`.
  - Sources: `dragon_base.png` (the standing dragon, 49×43, 9 colours) and one aligned strip per action (`dragon_walk`, `dragon_claw`, `dragon_bite`, `dragon_tail`, `dragon_hover`.png). `DRAGON_SHEETS` gives each strip's cell size, `shift` into base coordinates and the per-frame head offset.
  - Walk, claw, bite, tail whip and hover frames are copied from the strips. Idle, breath, take-off and landing are generated from the base: it is cut into parts (head, jaw, wings, tail, body; polygon masks), the parts are moved per pose, the outline is redrawn and joint cracks filled. On the hover frames only the jaw opens (fire from the air); that works because their head sits where the base head is.
  - The mouth and nostril points for the breath come from the same poses (`dragonPoints()`), so they follow the art.
  - All frames are 86×54 with the base at (19, 7); the feet are on row 50 (`footY`, the figure origin); legs hanging in flight reach below.
  - How the strips were imported (one-off scripts, not in the repo): the user's JPGs on a magenta background were converted with PowerShell `System.Drawing`; a rectangular pixel grid was fitted per strip (they were stretched unevenly), cell centres sampled (median) and snapped to the base palette; frames separated as connected shapes (specks dropped) and stray light-red pixels on the silhouette removed; then each frame placed in base coordinates, on the base head (walk, claw, hover) or on the planted hind claws (bite, tail), with the head offset found by matching the base head. The walk strip was drawn ~15% smaller and was resampled to base size. Redo the same for new strips.
- **Barrel frames** (`scripts/barrel-frames.ts`): AI-generated art made for this game with ChatGPT at the user's request (2026-10-15), source in `client/assets-src/barrel/barrel_source.png` (a 20×27 pixel grid at about 25 screen px per pixel). That grid was read once (cell medians, colours snapped to pack colours), then redrawn by hand at 16×22, about the crate's size, because 20×27 stands taller than a hero. The script holds the grid: `barrel` (plain wood, for blocking barrels that do not explode; not used yet) and `barrel_explosive` (the same with a red wood lid and a red band, the user's choice from three variants). `game/barrel.ts` draws `barrel_explosive`; `?gallery` shows both plus the fuse, fall and sink animations.
- **Torch frames** (`scripts/torch-frames.ts`): "Simple Torch Animation 16x16" by Natural_Privateer (OpenGameArt, CC0, "credit is appreciated"), the sheet and a licence note in `client/assets-src/torch/`. The sheet is a 3×2 grid of 16×16 frames, the last one empty; `buildTorches` copies the filled cells into the atlas as `torch_f0`… (the flame animation, 8 fps in `game/torch.ts`) and makes `torch_out`, frame 0 without its flame pixels (red ≥ 180 and green > blue), a bare stick, for an unlit torch. The side sconces reuse the same frames: `TorchView` mirrors them and moves them to the side wall's inner edge facing into the room. `?lights` shows lit and burnt-out torches. Credit: README Art.
- **Demon frames** (`scripts/demon-frames.ts`, layout in `src/game/anim/demonFrames.ts`, shared with the client): AI-generated art made for this game at the user's request (2026-10-13), in `client/assets-src/demon/`.
  - The user supplied a front-view pixel demon (`images/demon.jpg`); an image generation AI first turned it to a side view facing right, then drew one sheet per action from that (prompts: one strip per action, flat magenta background, same size as the reference). The source images were deleted from the untracked `images/` inbox after the import (the user's request, 2026-10-13); redoing a strip needs a new sheet.
  - Strips: `demon_idle` (4), `demon_walk` (6: the sheet's images 1, 2, 3, 8 and back through 3, 2, the order the user chose, played at 9 fps; the legs cross in the middle of each stride, seen from the side; the strip holds them in play order; from the user's third walk sheet, `images/demon_walk_improved_cross_walk.png`: the first one, 4 frames, was no clean cycle and looked like a limp, and the second, 8 frames, kept the legs apart), `demon_cleave` (5: wind-up, swing, impact, follow-through, recovery; the user's sheet had 7, the two upright resting poses were dropped), `demon_charge` (4: bull crouch, two charging frames, the stop) and `demon_cast` (4: gathering power, rising, the burst, recovery). Every cell is 82×63 with the hips at x 33 (`hipX`, the body's horizontal origin, mirrored when facing left) and the feet on row 62 (`footY`). Drawn at ×1 (about 62 px tall with the horns).
  - How the sheets were imported (one-off scripts, not in the repo; redo the same for new sheets): the JPGs converted to PNG with PowerShell `System.Drawing`; figures found as connected shapes on the magenta; a pixel grid fitted per figure (pitch and phase from the colour edges; 8.6 px for idle, walk and cast, 5.7 px for the charge); the cleave sheet had been resampled by the AI and has no clean grid, so it was sampled at a fixed 5.45 px that matches the others' size; cell centres sampled (median of the middle half, empty where mostly magenta); colours snapped to one 16-colour palette (k-means over all frames, magenta fringe excluded and dropped on the silhouette); only the figure and pieces touching it kept; each frame placed with the loincloth's centre on `hipX` and its lowest pixel on `footY`. The 8-frame walk sheets (resampled by the AI too) was sampled at a fixed 6.25 px (its figures then match the idle height), snapped to the existing 16 colours, and placed on the average of the loincloth's centre and the eyes (minus their mean distance, 10.1 px for the cross walk), so the head stays within 2 px across the cycle; its tail needed 4 more pixels on the left, so every strip's cells were widened from 78 to 82 px (4 empty columns on the left).
  - `build-atlas.ts` checks each strip's size and copies the frames below the lich's.
- **Lich frames** (`scripts/lich-frames.ts`): pixel art drawn for this game with Claude Code at the user's request (2026-10-13), after two reference images the user supplied (a high-resolution crowned lich, a pixel-art lich). The user approved the look in `?gallery`.
  - Pixel grids (one character per pixel) in pack colours: a gold spiked crown, a skull with glowing eyes in a crimson hood, gold crescent pauldrons, a crimson mantle with a jewel clasp, a lean robe with a gold trim strip, and a ragged hem it floats on (no feet).
  - `lich_idle_anim_f0-3` (float bob, hem sway, one eye flicker) and `lich_run_anim_f0-3` (the hem trails behind), 16×28 like the heroes, so it draws at ×1; plus `weapon_lich_staff` (8×30, a bone staff with a purple orb), held 7 px out (`handX`) so it does not cover the right pauldron.
  - The build checks every grid's size and colours; to change the art, edit the grids and run `npm run atlas`.
- **Title logo** (`scripts/build-logo.ts`, run by `npm run atlas`): made for this game with Google's image generation AI (2026-10-12), in `client/assets-src/logo/logo.png` (1408×768; the generator's watermark in the bottom-right corner was painted over once with wall from its left). The script writes three files into `public/assets/`:
  - `logo.png`: the whole image. The login screen shows it large (`.lobby.title`, `h1.logo.splash` from `ui/logo.ts`); every other `.lobby` screen uses it as a darkened background, darkest in the middle so the emblem behind the panels disappears and only the walls show (on portrait screens the left wall).
  - `logo-emblem.png`: the shield with the title (crop x 370, y 78, 680×626), the small header of the character select, lobby and error page.
  - `favicon.png`: the treasure chest on top, area-averaged to 64×64. The admin page has no favicon.
  - The `<h1>` around the images keeps the name for screen readers (`alt`); the edges fade out with `mask-image` (header from 70% to 85% of the radius, so the full width of ADVENTURERS stays opaque).
- **Recolors:** `RECOLORS` in `build-atlas.ts` swaps whole pack colors for other pack colors and writes the result as new frames in a strip below the sheet (32 px per entry). Today: `summoner_anim_f0-3`, the necromancer with its purple robe (`5f2d56`, trim `9f294e`) turned maroon and red (`62232f`, `da4e38`, the imp's and chort's reds). `scripts/png.ts` is a small PNG codec (8-bit RGB/RGBA, no interlace), so no image library is needed.
- No other self-drawn sprites: only the terrain tiles and the lich, both at the user's request. See HANDOFF.md.
- Runtime-generated textures are limited to simple effect shapes (`dot`, `spark`, `glow`) and the ground shadow ellipses under figures.

**Board (`GameScene.drawBoard` + `autotile.ts`).**
- The tiles are baked once into a RenderTexture, with a slight per-tile brightness variation and faint grid lines (board-game look). A wooden table frame surrounds the map.
- Autotiling follows the pack's 3/4 style:
  - walls with floor to the south show bricks (`wall_mid`, occasional holes and banners), with a rim (`wall_top_mid`) on the cell above
  - side walls show a light strip on the edge facing the floor (`wall_edge_mid_left/right`); south walls show the rim (`wall_top_mid`) at the top of their cell, next to the floor. Both hug the floor, so every junction reads as a corner, never a T
  - corners: a side wall meeting a brick face's rim uses `wall_edge_bottom_*`; a room's top corners use a stub (`wall_outer_top_*`) above the strip; bottom corners use the stub lifted to the top of the cell
  - `TileDraw.dy` lifts rim and stub sprites (their art sits in the bottom 4 rows) to the top of a cell; it only moves transparent rows outside the cell, so redrawing single cells stays correct
  - the cells behind a wall are usually `Void`, not `Wall` (the server only walls cells next to floor), so neighbour checks must not require `isWall` there
- The boss hall entrance has no door: open and sealed entrance tiles both draw as floor. When it is sealed, `forcefield.ts` draws a shimmering blue force field over it (a runtime effect; the pack has no such sprite): a pulsing translucent wall with drifting light bands and glitter sparks, a curtain on horizontal entrances and an edge-on band on vertical ones. `GameScene.syncForceField` builds it from the map, so players who join or spectate later see it too. Both orientations are in the gallery (`?gallery`).

**Terrain (`terrain.ts`).**
- `TerrainLayer` draws every terrain cell of the map once (the floor under it comes from the board): animated base textures plus edge overlays, a red glow over lava and rising embers. `autotile.ts` treats terrain as floor-like, so walls next to it get their faces and rims; the grid lines skip terrain.
- `GameScene.terrainState` handles each figure: `sink` (wading: feet cut off in shallow water and lava, not while dashing), `WadeFx` (splashes on entering, ripples while wading, embers on a hero in lava), and the fall / drown animation (`fall`, `drown`, `bubbleFx`) from `Ev::Sink`, or at once for the own hero when the predictor sees it sinking. The demos use the same helpers.

**Figures (`anim/defs.ts` → `EntityView`).**
- `FigureDef` describes:
  - idle/run/hit frame prefixes (4-frame pack animations)
  - the weapon frame and how it is held (`blade` / `bow` / `staff`)
  - the hand height, an accent colour (`base`, used by spell particles and dash afterimages) and a footprint radius (`baseR`, the ground shadow size)
  - an optional scale or tint
  - an optional `swing` (reach and arc of the melee swoosh, matching the server's damage reach)
  - optional `mouth` / `nostrils` frame points
  - for figures with their own action frames (the dragon, the demon): `frames` (prefix, count, fps per action), `windups` (attack anim → wind-up seconds), `pace` (enraged, the wind-ups last this factor as long; the demon), `lift` (hover height), `footY` (the feet row when the frames leave room below), `hipX` (the hips' column when the figure is not centred in its frames), `bite`; `pickFrame.ts` chooses their frame
- Pack stand-ins:
  - the demon is not a pack figure: it has its own AI-generated frames (see Demon frames above), drawn at ×1
  - the lich is not a pack figure: it has its own frames (see Lich frames above), drawn at ×1
  - the summoner is the pack necromancer with a red robe (an atlas recolor, see above)
  - the dragon is not a pack figure: it has its own AI-generated frames (see Dragon frames above), drawn at ×1.2
- Weapons are drawn at 0.6× (`WEAPON_SCALE`).
- The pack has no attack frames, so attacks are approximated:

| Attack | How it looks |
|---|---|
| Melee (blade) | Weapon fades out at the swing start angle; a crescent swoosh sweeps the damage arc at the damage reach; the weapon fades in at the end angle. Small lunge and tilt of the body. |
| Bow / crossbow | Recoil and spark. The assassin's dagger is a short thrust. |
| Staff / cast | Staff thrust and sparkles. |
| Wind-up | Body flashes red, shakes, weapon drawn back. |
| Dash | Stretched body and afterimages. |
| Dragon breath | Particles from the mouth (per-frame point from `dragonPoints()`, follows bob, flip, lift and scale) into the ground cone. During the wind-up, smoke comes from the nostrils. |
| Dragon flight | The body rises by `lift` over its ground shadow (which shrinks); the landing draws the slam ring at `DRAGON_SMASH_RADIUS` over `DRAGON_LAND`. |

- Facing is left/right only. The `Dir` type and a `TODO(4-dir)` mark where 4-direction sheets would plug in.

**Figures stand on a soft ground shadow** (`ensureShadowTexture`), not on a miniature base; the bases were removed at the user's request.

**Chests and mimics (`chest.ts`, `mimic.ts`).** The pack has three 3-frame chest animations (`chest_full_open`, `chest_empty_open`, `chest_mimic_open`); frame 0 is the same closed chest in all three, so a mimic cannot be told apart by its look.
- `ChestView`: closed, then the lid opens over the gold (0.3 s), then the empty chest.
- `MimicView`: there are no walk or idle frames, so everything is the three opening frames plus squash and stretch. Asleep: closed chest that rattles now and then when the local hero is within 40 px. Reveal (the `ASLEEP` flag drops while in view): jump with the lid flying open, gold burst and a red "!". Hop (Move): crouch (lid ajar, squashed), flight (jaws open, stretched, a parabolic arc 7 px high with the shadow left on the floor), landing (squash, dust). Bite (Melee): lunge with the jaws snapping. Wind-up: crouched.
- Coins: `Effects.coins` throws pack `coin_anim` frames out with gravity; a gold "+N coins" floats up.

**Other visuals.**
- Projectiles: `weapon_arrow` for arrows and bolts, additive glows for magic.
- Deaths: a `skull` decal.
- Lich drain: animated red beams from channelling disciples to the lich. Drawn from `Snapshot.drain` (the lich first, then each channelling disciple; on the wire a flat scaled array, the 8th `SnapW` field), which the server sends during the boss fight, or while the lich or a disciple is in view, regardless of the field of view; the beams are drawn above the darkness (`DEPTH.beam`), so they show even when an end is out of sight.
- The lich's magic is dark purple gloom (`GLOOM` in `effects.ts`): gloom bolts flicker and trail dark smoke and pale sparks (`PROJECTILES[...].gloom`, `Effects.gloomWisp`); the nova telegraph is a purple ring with wisps drawn in (`FigureDef.slam.gloom`), the lich flashes pale purple and holds its staff high during the wind-up, and the burst is `Effects.nova`; its raised skeletons appear in a dark purple puff.
- Debug paths: marching dashed lines above the darkness, yellow to the boss, blue to the ogre.

**UI.** DOM overlay (`ui/`):
- Lobby with run list and class cards (animated pack previews).
- HUD: HP, two ability slots with cooldown sweep, party list, boss bar with IMMUNE/ENRAGED tags, messages, spectate banner, Esc menu, run coin counter (pack coin icon via CSS from the atlas), end screen with stats, XP and coins, F3 debug panel, debug badge.
- The font is "Press Start 2P" from Google Fonts, with a monospace fallback.

## 10. Debug and dev features

| URL | Effect |
|---|---|
| `?debug` | `Debug{on:true}` is sent when the run scene starts. Server: the player takes no HP loss. Every 0.5 s it sends `DebugPath` (A* to the boss, string-pulled with line of sight, plus `ogre`: the same to the living ogre, empty once it is dead). Client: yellow (boss) and blue (ogre) dashed lines plus badge. There is no in-game toggle (removed on request). |
| `?debug&boss=demon\|lich\|dragon` | Host only. Preselects that boss in the lobby's boss picker (`SelectBoss`); used by `smoke.mjs`. Works even with `ALLOW_DEBUG=0` (the boss choice is a normal feature). The server logs `run N started: … boss X (chosen)`. Runs where debug was turned on bank no XP. |
| `?gallery[&state=melee&slow=10]` | Every figure cycling its animation states, no server needed. |
| `?mimic[&slow=3]` | The chasing mimic after a walking knight, a treasure chest opening with its coin burst, and the mimic reveal. No server needed. |
| `?water`, `?chasm`, `?lava` `[&slow=3]` | Terrain demos with scripted figures: wading and drowning, falling into a chasm, burning in lava, demons walking through lava, the dash jumping a gap, and being knocked in. Speeds and times come from `CONST`, like the server. No server needed. |
| `?knockback` `[&slow=3]` | Every push in the game, side by side next to chasms and deep water, with the game's distances and decay: orc warrior, chort, imp (no push), a barbarian who cannot dash out, the demon's cleave and swoop, the dragon's tail and front claw. The user approved the distances here. |
| `?dragon` `[&slow=3]` | The dragon looping through every action: idle, walk, claw, bite, tail whip, breath, fireball volley, and a flight (take-off, hover, breath from the air, landing smash). Dummy heroes are pushed with the game's distances. Keys: Space pause, S slow motion, 1–8 jump to an action. The user approved the frames here. |
| `?demon` `[&slow=3]` | The demon looping through every action: idle, walk (both directions), cleave (and facing left), the swoop charge, the ring of fire with its 16 orbs, and an enraged cleave with the shorter wind-up. Dummy heroes are pushed with the game's distances. Keys: Space pause, S slow motion, 1–7 jump to an action. |
| `?lich` `[&slow=3]` | The lich's magic: the gloom bolt volley and the summon of 5 skeletons + 5 archers (left), and the nova: the purple telegraph ring at the real radius, the burst, three heroes pushed 64 px (one into the chasm) and one spared just outside. |
| `?ogre` `[&slow=3]` | The ogre's club next to the orc warrior's push (only the club's knocks a hero into the chasm), and the ground slam: the telegraph ring at the real radius, the shockwave, three heroes pushed away (one into a chasm) and one spared just outside. The user approved it. |
| `?daemons[&slow=3]` | Imp, chort and a pack of both fighting a walking knight, and a summoner summoning imps. Uses the real figure definitions; the attack logic is a local imitation of the server AI. No server needed. |
| `?lights` | The light system on a scripted room, no server needed: four torches in four colours, a lava pool with a warm torch beside it (mixing), a fireball flying down a corridor into a dark room and back, a frost bolt circling in the first room, and a blue torch that switches every 3 s (so a burnt-out torch shows). It loops every 4 s, `&slow=N` slows time; `tools/e2e/lights-shot.mjs` takes a screenshot every 0.5 s. The look (falloff, tint strength, flicker) is not approved by the user yet (HANDOFF). |
| `?lag=150&jitter=40&loss=2` | Network simulator. |

## 11. Extending

- **New class:**
  - server: add a `ClassId` variant (`protocol.rs`), a `classes.rs` entry and an `EntityKind`; reuse or add `AbilityId`s with an executor in `run/abilities.rs`
  - client: add to the `FIGURES` entry, `ui/text.ts`, and `FIG`/`CLASSES` in `ui/classes.ts`
  - database: add a migration that widens the `characters.class` CHECK constraint
  - then run `cargo test`
- **New ability:** add an `AbilityId` and its `def()` numbers, an executor arm in `try_use`, and client prediction in `GameScene.predictAbility`. Loadout selection only needs a picker and per-member `primary`/`secondary` overrides.
- **New enemy:** add an `EnemyType` + `def()`, its `EntityKind`, population in `generate.rs::populate`, and a `FIGURES` entry. (The mimic is the exception: it is placed by `place_chests` and drawn by its own `MimicView`, not a `FIGURES` entry.)
- **New boss:**
  - server: add a `BossId` variant, a `defs/bosses.rs` entry and a new `run/bosses/<name>.rs` implementing `BossBehaviour`, plus a `create()` arm
  - client: add the `EntityKind` and a `FIGURES` entry, `BOSS_TEXT` in `ui/text.ts`, and `BOSSES`/`BOSS_FIG` in `ui/lobby.ts`

**How to add a light source** (see "Light sources" in §5). No client change is needed: the client draws whatever the registry sends.
1. **A new kind:** a row in `LightKind` and `def()` in `defs/lights.rs` (radius in tiles, default colour, intensity, flicker). Add it to `LightKind::ALL`. `cargo test` regenerates `LIGHT` in `defs.ts`.
2. **A static source** (fixed on the map: a brazier, mushrooms, goo, a fountain): `run.add_light(kind, Anchor::Tile(x, y), colour)` while the run is built (it goes out in `RunStartInfo.lights`) or later (it sends `Ev::LightAdd`). If it can be switched, keep its id and call `set_light(id, on)`; `remove_light(id)` deletes it. Torches are the example: a world object that owns the id (`ObjState::Torch.light`) and calls `set_light` from `set_torch`. A source on a tile that changes through `Run::set_tile` should be added and removed there, as lava is.
3. **A moving source** (a glowing enemy, a hero spell or item, the carriage lantern): either list the entity kind in `kind_light`, which attaches the light at spawn for every projectile and hazard, or call `add_light(kind, Anchor::Entity(id), colour)` explicitly (e.g. `Anchor::Entity(hero_id)` for an own hero light). The sweep removes it when the entity is gone.
4. **Colour override:** the `colour` argument of `add_light` (`None` = the kind's colour), or `set_light_colour(id, colour)` at any time (a cursed torch turning blue); a static light sends `Ev::Light` with the new colour, a moving one changes its `MovingLight` entry.
5. **Asking:** `run.is_lit(pos)` for game rules (the shadow, the torch-extinguishing enemy; those also use `set_light`).

**How to add a level type** (see "Levels" in §5; the dungeon is the example):
1. **Protocol** (`protocol.rs`): a `LevelId` variant and a `LevelChoice` variant with the level's options (e.g. `Escort {}`; the tag is `level`). Run `cargo test` to regenerate the TS types.
2. **The level** (`run/levels/<name>.rs`): a struct with the level's state, a `build(seed, …options, rng) -> (Layout, Self)` that makes its map (its own generator) and fills the shared `Layout` (map, enemy spawns, chests, player spawns; empty lists are fine), and `impl LevelRules` overriding only the hooks it needs: e.g. `populate` for its own monsters or objects, `tick` for a moving goal, `on_killed` or `post_tick` to set `run.ended = Some((true, run.time + END_DELAY))` on a win, `failed` for its own way to lose, `debug_target` for the debug path.
3. **`Level`** (`run/levels/mod.rs`): a variant holding the struct, and one arm in `build` (from its `LevelChoice`), `id`, `boss`, `boss_mut` and the `dispatch!` macro. `pub mod <name>;` next to the others.
4. **A boss, if it has one:** a `BossEncounter` field (`BossEncounter::new(boss_id, arena, door)`), returned by `boss`/`boss_mut`, and the `boss::` functions as the hook bodies, as `DungeonLevel` does. Without one, `boss()` is `None`: no boss bar, `RunEnded.boss` is `null` and the statistics show the level alone. Note: `BossEncounter::check_arena` currently wakes every sleeping non-mimic monster on the whole map. That is dungeon behaviour, so a second level that includes a `BossEncounter` should move the map-wide wake into `DungeonLevel::post_tick` or make it a parameter.
4a. **State of its own, if it has any:** hooks are associated fns over `&mut Run` with no `&self`, so a stateful level reads its state through a small accessor that matches `run.level`, plus a `_mut` variant, e.g. `fn state(run: &Run) -> &EscortLevel { match &run.level { Level::Escort(e) => e, _ => unreachable!() } }`.
5. **Client:** a `LEVEL_TEXT` entry in `ui/text.ts` (name, victory and defeat line of the end screen). The map arrives as tiles like the dungeon's; new tile kinds need their own art and rules.
6. **Lobby** (`lobby.rs`): map the room's choice to the new `LevelChoice` in `start`. Today every room is `LevelId::Dungeon`; offering a second level needs a level picker and a `SelectLevel` message (not built yet).

The database, statistics, telemetry and the admin page take the level as text (`format!("{:?}")`), so they need no change.

## 11a. Accounts, characters and progression

**Accounts (`auth.rs`, `api.rs`).**
- An account is a name and an Argon2id hash (19 MiB, 2 passes, 1 lane, run in `spawn_blocking`). No e-mail and no other personal data are stored, so a lost password cannot be recovered.
- Names are 3–16 of `A-Z a-z 0-9 _ -` and unique ignoring case, for accounts and characters alike. Passwords are 8–128 characters.
- A login for an unknown name still checks a dummy hash, so the timing does not reveal which names exist.
- **Throttling** (in-memory `Limiter`):
  - 5 failed logins per account name in 30 s, and 20 per IP in 5 min, give a 429.
  - At most 10 registrations per IP per hour.
  - Deleting an account rechecks the password through the same limiter.

**Sessions.**
- Login creates a random 32-byte session id. The browser gets the cookie `ta_session` (HttpOnly, SameSite=Strict, Path=/, plus `Secure` if `COOKIE_SECURE`) holding `base64url(id ‖ expiry) . base64url(HMAC-SHA256(SESSION_SECRET, id ‖ expiry))`.
- The table `sessions` stores only `sha256(id)`.
- **Idle timeout:** a session ends after `PLAYER_SESSION_MINUTES` without activity (default 10080 = 7 days). `sessions.expires_at` is the end unless the player is active again, and activity moves it forward:
  - every API request with the session, the WebSocket connect included (`db::touch_session`, one `UPDATE … RETURNING`);
  - the end of a game connection (`db::extend_session`), because a player who was connected was active all along, even through a run longer than the idle time. A session deleted meanwhile (logout, new password) stays deleted.
- **Hard limit:** the token's own expiry and the cookie's Max-Age are 1 year (`SESSION_MAX_SECS`). Even an always-active player logs in again after a year.
- **Checks on every request** (the `Session` extractor):
  1. signature (constant-time) and expiry, without the database, so forged tokens cost nothing;
  2. the session row (alive, and then extended), so logout, account deletion and idling end it.
- JavaScript never sees the token.
- CSRF is covered by SameSite=Strict, JSON-only state changes and the WebSocket origin check.

**One connection per account.**
- `Lobby::connect` closes an older connection of the same account (Error "You logged in from another window." + close).
- A character therefore plays in one place only, and XP cannot be banked twice.
- A closed connection's late messages are ignored (`handle` checks that the connection still exists).

**Characters.**
- Rows in `characters` have a name, a class that never changes, and `progress`. There are at most `db::MAX_CHARACTERS` (8) per account; the account row is locked while counting.
- The lobby keeps a cached copy (`Conn.character`) of the selected one.
- **Progress document (`progress.rs`):** `characters.progress` is JSONB: `Progress{version, rev, xp, total_xp, coins, upgrades}`.
  - Every field is `serde(default)` and unknown fields are ignored.
  - Reading goes through `Progress::from_json`, which runs `upgrade()` (version steps) and starts fresh if a document is unreadable (logged).
  - *To change progression:* add fields to the struct; no SQL migration is needed. Only if old data must be converted, bump `CURRENT_VERSION` and add a step to `upgrade()`. Old rows are converted on read and written back on their next save.
- **Writes** all go through `db::modify`: `SELECT … FOR UPDATE`, change the struct in Rust (`Progress::bank`, `Progress::buy`), `UPDATE`.
  - The row lock serialises concurrent changes, so a purchase cannot race with banking.
  - Every save bumps `rev`; `Lobby::apply_progress` ignores results older than its cached copy.
- **Earning:** `kill_monster` adds `xp_for_kill` and `coins_for_kill` (mimic 25, boss 50) to each living player; chests add `CHEST_COINS`.
- **Banking:** when the run task ends (victory, defeat or everyone left) it calls `lobby::finish_run(rid, run.awards(), run.record(outcome))`.
  1. The room closes and the players return to the lobby.
  2. Then `db::bank_awards` banks every `Award{character, xp, coins}` in one transaction, in id order.
  3. Then `apply_progress` sends `Character` to the players.
  4. Last, `db::record_run` stores the run for the statistics (§11b). A failure there is only logged.

  `Run.debug_used` (set by `set_debug`) makes `awards` empty.
- **Spending:** `BuyUpgrade` is handled in `main.rs` before the lobby: `can_shop`, then `db::update_progress(…, |p| p.buy(stat))`, then `apply_progress`. The lobby lock is never held during a query.
- **Coins** are a second currency with nothing to buy yet; they are meant for loadouts.
- **Applying:** `Lobby::start` copies the character's `StatUpgrades` into `Member.upgrades`. `Run::new` turns them into `Player.mods`, which the simulation uses and `RunStartInfo.mods` sends to the predictor.
- **Tuning:** costs and per-level bonuses are in `defs/progression.rs`.

**Tamper safety.** The server is authoritative.
- Everything the client gets (`Me`, `Character`) is for display only.
- No message carries progress values from the client to the server.
- The client can only ask for actions (select, buy), and the server checks them against the database.

**Scaling later** (nothing built for it yet):
- The database is only touched at login, WebSocket connect, character select, purchases and run end; everything per tick stays in RAM. 10,000 players in 10-minute runs would bank about 17 times a second, so no cache is needed in front of PostgreSQL.
- The real limits of one server are CPU (the 60 Hz simulations), the single lobby mutex and bandwidth. The answer to those is several game servers.
- Only then is an in-memory store such as Valkey (BSD-3) worth adding. It would hold presence (one connection per account across servers), the shared run list and pub/sub between servers. It should not be a write-behind cache for progress, which would risk losing data and create two sources of truth.
- All queries are in `db.rs`, so such a change stays local.

## 11b. Admin area and statistics

**Page.** `/admin` serves `client/admin.html`, a second Vite entry with its own code in `client/src/admin/` (plain DOM, no Phaser). Views are picked by the URL hash: `#/` dashboard, `#/players`, `#/players/<id>`, `#/audit`. Every player-chosen string is inserted as a text node (`dom.ts` `h()`), never as HTML.

**Login (`admin.rs`, `auth::AdminLogin`).**
- The admin is not a game account. The name and password come from `ADMIN_USER` and `ADMIN_PASSWORD`; only their SHA-256 digests are kept, and both are compared in constant time.
- Without both variables, or with a password under 12 characters (`ADMIN_PASSWORD_MIN`), every `/api/admin/*` route answers 404 and the server logs why at start-up.
- Throttling: 5 failed admin logins per IP and 20 in total per 5 minutes give a 429. A failed login is logged without the IP.
- **Sessions:**
  - The token format is the same signed one as the players' (`Auth::new_admin_session`), with a 12-hour hard limit (`ADMIN_TOKEN_MAX_SECS`).
  - **Idle timeout:** a session ends after `ADMIN_SESSION_MINUTES` (default 10, 1–1440) without an admin action. Every admin request restarts the clock (`AdminState::touch`) except the dashboard's automatic refresh, which sends `X-Admin-Background: 1` and only checks the session, so an open tab still times out. The page then asks for the login again.
  - Player sessions work the same way, with a 7-day default (`PLAYER_SESSION_MINUTES`, §11a).
  - The cookie is `ta_admin` (HttpOnly, SameSite=Strict, `Path=/api/admin`, `Secure` with `COOKIE_SECURE`). It has no Max-Age, so it is gone when the browser closes.
  - Admin sessions live in memory (`AdminState.sessions`), so a restart logs the admin out.
  - A player's `ta_session` cookie never grants admin access.
- State changes must be JSON (`api::require_json`), like the player API.

**Admin API (`/api/admin`, ts-rs types in `stats.rs` and `admin.rs`).**

| Request | Effect |
|---|---|
| `POST /login {name, password}` | Sets `ta_admin`. Answers `AdminMe{name}`. The same 401 for a wrong name and a wrong password. |
| `POST /logout {}` | Ends the admin session and clears the cookie. |
| `GET /me` | `AdminMe`, or 401 (404 when the area is disabled). |
| `GET /stats` | `AdminStats` (below). |
| `GET /players?q=&sort=name\|created\|active&page=` | `PlayerPage`: 50 per page, `q` matches anywhere in the name (`_` and `%` literally). |
| `GET /players/{id}` | `PlayerDetail`: account, characters (with "playing now"), activity, the last 10 runs. |
| `POST /players/{id}/password {password}` | Player password rules. Sets the hash, deletes all sessions of the account in the same transaction, closes its WebSocket. |
| `DELETE /players/{id}` | Closes its WebSocket, deletes the account (cascade: sessions, characters). |
| `DELETE /characters/{id}` | Any account's character. Whoever plays it is logged out first, then it is deleted and forgotten by the lobby. |
| `GET /actions` | The last 100 audit rows. |

Every change writes a row to `admin_actions` (admin, action, target name at that time, detail) and counts `ta.admin.actions`.

**Tracking (migrations `0002_admin_stats.sql`, `0003_run_players_left.sql`, `0004_runs_level.sql`).**
- `activity_days(account_id, day)`: one row per account and UTC day, written at login, registration and WebSocket connect (`db::touch_activity`, `ON CONFLICT DO NOTHING`). "Active players" means accounts that logged in or connected.
- `runs` + `run_players`: every ended run (`victory`, `defeat` or `abandoned` = everyone left) with level, boss (`NULL` for a level without one; 0004 made it nullable and added `level`, default `'Dungeon'` for older rows), length, party size and per player the class, kills, damage, healing, XP, coins, `survived` and `left_run`.
  - Leaving a dungeon counts as dying inside the game (`Player.alive = false`). `Player.left` keeps it apart, so the statistics count deaths as `NOT survived AND NOT left_run`.
  - Debug runs are stored with `debug = true` and left out of every statistic.
- These tables have **no foreign keys** to accounts or characters. When an account is deleted its name goes with it and only an anonymous id stays, so past counts do not change.
- History starts empty when this is first deployed; the dashboard says so.

**Statistics (`stats::overview`).**
- Calendar days in UTC: "today" starts at 00:00 UTC, "7 days" is today and the six days before.
- **Live:** from `Lobby::live()` (online, in a dungeon, in the lobby, rooms waiting, dungeons running, and who is online with which character), plus account names from the database.
- **Totals:** accounts, characters, XP ever earned, unspent coins, runs.
- **Today / 7 / 30 days:** active players, new accounts, runs (won, lost, left), win rate over finished runs, average length and party size, kills, deaths.
- **Per level and per class** (30 days; "Levels" lists each level with its boss, e.g. "Dungeon – Demon", from `AdminStats.level_runs`; `AdminStats.levels` is the upgrades histogram), characters by number of upgrades bought, the top 10 characters by XP earned, and 30 daily points of active players, new accounts and runs (won vs. the rest).
- Charts are hand-written SVG (`charts.ts`), drawn at the container's pixel width. Each has a hover and keyboard tooltip and a "Show as table" view.

## 11c. OpenTelemetry

`telemetry::init()` (first thing in `main`) always sets up the console log (`RUST_LOG`, default `info`). It also exports over **OTLP/HTTP (protobuf)**, but only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or a per-signal endpoint) is set.

- **Endpoint:** the exporter appends `/v1/traces`, `/v1/logs` and `/v1/metrics` and honours the standard `OTEL_*` variables (`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, …). `OTEL_SERVICE_NAME` defaults to `tiny-adventurers-server`.
- **No TLS:** no TLS client is compiled in, so the endpoint must be plain `http://`, typically a collector on the same Docker network. For HTTPS, enable the `reqwest-rustls` feature of `opentelemetry-otlp`.
- **ClickStack:** point the endpoint at its OTel collector, e.g. `http://otel-collector:4318`. Add the game to that network or publish the collector's 4318 port, and pass `OTEL_EXPORTER_OTLP_HEADERS=authorization=<ingestion key>` if the collector requires one.
- **Shutdown:** on Ctrl-C or SIGTERM the server stops and flushes what is still buffered (`Guard::shutdown`).

**Traces** (`tracing` spans bridged by `tracing-opentelemetry`):
- `http`: one span per request, named by the matched route and recording the status. Cookies and bodies are not recorded.
- `ws`: one span per WebSocket session, with the account id.
- `run`: one span per run, with the run id, level, boss, player count and outcome.
- One span per `db.rs` function (`#[tracing::instrument(skip_all)]`) and per admin query in `stats.rs`.

**Logs:** every `tracing` event at `info` and above becomes an OTLP log record, correlated with its span. The exporter's own HTTP client crates are filtered out (`OTEL_FILTER`) to avoid a feedback loop.

**Metrics** (every 15 s; attributes carry ids, classes, levels, bosses and outcomes, never player names):

| Instrument | Type | Attributes |
|---|---|---|
| `ta.players.online` | gauge, read from the lobby | `state` = lobby / in_run |
| `ta.runs.active` | gauge | `state` = running / waiting |
| `ta.logins` | counter | `result` = ok / fail / throttled |
| `ta.registrations` | counter | – |
| `ta.runs.finished` | counter | `level`, `boss` (only when the level has one), `outcome`, `debug` |
| `ta.run.duration` (s), `ta.run.players` | histograms | `level`, `boss`, `outcome` / – |
| `ta.player.deaths`, `ta.enemies.killed`, `ta.xp.banked`, `ta.coins.banked` | counters | `class` |
| `ta.tick.duration` (ms) | histogram, every server tick | – |
| `ta.ws.connections` | up-down counter | – |
| `ta.admin.actions` | counter | `action` |

Debug runs only count in `ta.runs.finished{debug=true}`.

**Trying it locally:**
1. Run a throwaway collector that prints what it receives (`otel/opentelemetry-collector` with an `otlp` HTTP receiver on 4318 and the `debug` exporter) on the compose network (`--network tinyadventurers_default --name otel-check`).
2. Start the game with `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-check:4318`.
3. Play, then read `docker logs otel-check`.

## 12. Tests

**Server (`cargo test`, 245 tests):**
- damage model: `resolve` for single and several types, a missing entry, immunity, healing above 100 %, a weakness and its −100 % floor, partial splits filled with physical; attacks by kind have their types; entity type resistances add up with adjustments (lich physical 50 %, dragon heat 100 %), every enemy and class has its entity type; typed paths (a demon takes no heat from the fireball, a skeleton takes more, the demon's claw burns, lava, the lich nova and the dragon's breath are typed)
- world objects: chests open once and pay the party, mimics still wake, objects resist poison fully
- solids: a square blocks axis by axis, a figure inside one can walk out in every direction; 36 fixture steps touch a solid
- barrels: lit by any hit but poison, explode after 0.3 s, one explosion per barrel in a chain (ten in a row give ten `Boom k 7`); the blast hurts and pushes a hero and a non-boss monster, hurts a boss without pushing it, does not reach a monster behind a wall, and gives the kill and damage to the igniter; a chain without an igniter or whose igniter left still explodes; the E push, its reach, stops at a wall and at another barrel (which stays put); a pushed barrel rests on the 1/16 px wire grid (`q_pos` round-trips it exactly); falls into a chasm, sinks in water, explodes in lava; every hero attack kind hits objects, shots stop at barrels; area attacks light barrels: ogre slam (in reach, not outside), dragon breath (in the cone, not outside), dragon smash and claw, demon cleave (in front, not behind), lich nova (in range, not outside), fire patches; `objects_in` reach and cone
- monsters: blown into a chasm (one death, XP once), into water, into lava (burns, walks out); bosses are never pushed
- ranged AI: shoots a barrel next to the hero, does not shoot one that would catch it, ignores a far one; A* goes around barrels; a wide boss reaches every spot of its hall with barrels in it
- barrel generation over many seeds: no tile cut off, hall barrels keep their plain-floor area and gap
- light kinds: every kind has a sane def; fire and magic shots glow, arrows and monsters do not
- light registry: a static light lights its radius and stops at walls (lighting the wall itself); switching, recolouring (`Ev::Light` with the colour) and removing a static light; lights added at the start send no event; a moving light follows its entity, is blocked by walls and is swept when its entity is gone; kind colour unless overridden; fire bolts carry a light, arrows do not, a shot that dies at once leaves none; fire patches glow; lava lights its neighbours, is in the start info (also in a dungeon) and `set_tile` keeps the lava lights in step; a closed door blocks light
- visibility: a monster in the dark is hidden until lit; hero events (hurt, heal) are sent in the dark, monster events are not; the moving-light list holds lights near the viewer, with the colour only when custom; a torch in sight is sent lit or dark and one out of sight is not
- torches: a torch lights the floor in front of it; E toggles one in reach; heat lights and other damage puts out; a barrel blast lights a torch; a shot into the torch's wall tile hits it
- torch generation over 200 seeds: on walls with floor in front, spaced, never adjacent, never on doorway jambs, start room and boss hall always lit, dark pockets exist; spacing along the start room wall; the fingerprints are unchanged
- protocol round trip
- wire: positions round to 1/16 px (also beyond 4096 px), aim wraps into a byte, event codes follow `EV_CODES` (the light events and `Snapshot.lights` are in the sample snapshots), a compact input decodes to `InputMsg`, sample snapshots are bare arrays and at least 30 % smaller than the old form
- dungeon determinism and guarantees over 200 seeds
- level split: the fingerprints `level_setup_is_unchanged` (map, spawns, entity ids and boss per seed) and `simulation_is_unchanged_after_waking_the_boss` (300 steps of a boss fight), recorded before the split (`level_setup_is_unchanged` leaves barrels and their ids out and so keeps its values from before barrels; the simulation one was re-recorded with barrels, which change the fight); `Dungeon::split` keeps every part; `Level::build` matches the generator and draws a random boss from the run's rng as before; a level with only default hooks has no boss bar or debug path and is lost when everyone dies; start and end messages name the level and boss
- collision cannot tunnel through walls; line of sight
- knockback: a push slides its distance, ignores the input, crosses deep water and stops at walls; a push into a chasm is a fall, with no attacks meanwhile, and dashing heroes are not pushed; a short push stops and control returns; only orc warriors' and chorts' melee pushes (not imps, skeletons, archers or bolts)
- ogre: slams a crowd (or one hero while the club recovers) and clubs a lone hero; the slam hits and pushes every hero in its radius straight away and spares those outside; club and slam both push; exactly one ogre per seed on safe ground with room around it, outside the boss hall; the debug path also leads to the ogre and disappears when it dies
- wide bosses (demon, dragon) reach every spot of their hall around the chasms (24 seeds)
- terrain: the rule matrix per mover; slowing in shallow water; a dash over a chasm and deep water; a chasm kills after the fall (not mid-dash) and debug heroes climb back out; a dash ending in deep water drowns; lava burns over time; only demons are lava walkers; A* keeps enemies out of lava and chasms and lets demons through lava
- terrain keeps the layout and chests of a seed for both themes
- FOV blocked by walls
- assassin dagger vs crossbow; hidden ×4 crit
- cooldown enforcement
- enemy ignores players without line of sight or while hidden; never attacks unseen players
- necromancer death kills its minions
- demon dungeon swap (same spawns, imps/chorts/summoners instead of skeletons/necromancers, none elsewhere); imp and chort attack choice by distance; the alt attack's own cooldown and fire bolt; summoned imps look like imps and die with the summoner
- A* routes around a wall
- lich immunity and draining; the nova (wind-up, damage, 64 px push, nothing outside the radius); the summon (5 skeletons + 5 archers, topped up, no stacking); the gloom bolt volley; drain beams sent to a player who sees neither end
- the demon: each attack's animation starts with its wind-up (cleave `Melee`, swoop `Dash`, ring `Cast`) and runs through the recovery; the swoop keeps one `Dash` animation from the wind-up to the stop; the ring bursts at the end of its wind-up; enraged wind-ups are shorter
- FOV-filtered snapshots; heroes' hits and explosions are sent without a position (shown out of view)
- shot hitboxes: a missile hits the ogre's chest but not over its head, the demon up to its horns, and passes over an orc's head
- 600-tick simulation of each boss without panics
- debug immortality and the boss path
- progression modifiers
- progress document: buying limits, saturating banking, `{}`, partial, unknown-field and broken documents, JSON round trip
- auth: token round trip, tampered, expired and wrong-secret tokens rejected; cookie parsing; Argon2id hash and verify; name and password rules; the limiter window
- admin login: disabled without both variables or with a short password; name and password both checked; the `ta_admin` cookie is scoped to `/api/admin`, has no Max-Age and is separate from `ta_session` (a player cookie is no admin cookie); the idle timeout restarts with each action but not with background refreshes; `ADMIN_SESSION_MINUTES` parsing
- WebSocket origin check; only Vite's hashed bundles are cached for good
- telemetry: without an endpoint nothing is exported; a finished run is counted with level, boss, outcome and debug, and debug runs stay out of the gameplay counters (in-memory exporter)
- run record: outcome (won, lost, everyone left), every player, debug flag; leaving is not dying
- statistics (needs `DATABASE_URL`):
  - activity counts once per day and outlives the deleted account
  - today/7/30-day windows count backdated rows correctly and skip debug runs; levels with their bosses (also a run without a boss, and rows from before 0004), classes, upgrades histogram, top characters and the 30-day trend
  - online players get their account names
  - player search (`_` literal), sorting, paging and details
  - admin password change revokes sessions; any character can be deleted; the audit log is newest first
- database (needs `DATABASE_URL`):
  - names unique ignoring case
  - the 8-character cap and ownership
  - 20 bankings and 10 purchases in parallel lose nothing
  - old progress documents are read and saved as the current version
  - sessions end with logout and account deletion, which also removes the characters
  - sessions end when idle; activity restarts the clock; the end of a game connection extends a session but never revives a deleted one
- lobby:
  - only the host picks the boss, fixed after the start
  - rooms need a character, and characters switch only outside rooms
  - no shopping during a run, and the newest progress wins
  - a second login closes the first connection
  - `live()` counts online players, rooms and runs; who plays which character
  - a finished run banks on the played character only and is recorded (needs `DATABASE_URL`)
- XP and coin awards skip debug runs
- chests: touching opens once and pays the whole party
- mimics: asleep until touched, then hold before hunting; the boss waking leaves them asleep; they move only while airborne
- ts-rs export tests

**Client (`npm test`, 43 tests):**
- `game/damage.test.ts`: the number colour per damage type (physical white on enemies, red on heroes).
- `pickFrame.test.ts`: the dragon's and the demon's frame choice (wind-up frame with the telegraph, strike frames after it, the demon's charge loop and ring burst, enraged wind-ups shortened by `pace`).
- The collision and FOV ports must equal the Rust fixtures exactly. The fixture map holds every kind of terrain, and 10 random walks with dashes and pushes (14–44 px, any direction) cross it.
- `wire.test.ts` (it also covers the `act` input field and `Dmg` with `ty` and `imm`) unpacks the sample snapshots from `wire-fixtures.json` (every event type, a spectator, with and without boss bar) and compares them with their readable form: positions within 1/32 px, aim within half a step, everything else exact. It also checks the aim range and `packInput`.
- `game/light.test.ts`: the static light map equals the server's on the shared fixture (`fixtures.json`, every lit tile identical); switching, recolouring, removing and map changes; colours add per channel and cap at 255; a torch and lava mix to orange; the falloff (1 at the centre, 0.45 at the edge).
- `game/lightview.test.ts`: black where not seen or not lit, a lit tile is never drawn dark (`MIN_LIT`), flicker stays around 1 by kind.
- `net.test.ts`: the `?lag` simulator delivers 2,000 messages in order under a timer that rounds delays down like a browser (the old one-timer-per-message line failed it).
- `ui/endText.test.ts`: the end screen's first line (the slain boss on a dungeon win, the level's defeat line, the level's victory line when there is no boss).
- `game/world.test.ts`: the predictor replays the moves it sent while it predicted a fall, so a debug climb-out the server already did is followed exactly.

**Browser smoke test (`tools/e2e/smoke.mjs`):**
- two headless browser contexts register throwaway accounts (`e2e_<hex>`) and create a character each of the given classes, then create and join a run, start, move and attack
- a third context logs into the first account, which must close the first window ("another window")
- both accounts are deleted at the end
- with `ADMIN_USER` and `ADMIN_PASSWORD` set (the same as the server's), an admin pass follows:
  1. log in at `/admin` and find the online account on the dashboard;
  2. delete its character, which logs the player out;
  3. change its password, after which the old one fails and the new one works;
  4. delete the player through the confirmation form;
  5. check the audit log.

  It takes screenshots of the dashboard (light and dark), the player page and the audit log.
- screenshots (login, characters, lobby, room, game) go to the output folder; prints the F3 stats and any browser errors (the expected 401 of the first `/api/me` is ignored)

**Client admin tests (`src/admin/charts.test.ts`):** nice axis maximum and ticks, the rounded-top column path, number, duration and share formatting.

## 13. Known limitations

- Pack art gaps: no attack frames, no up/down facing. (The dragon, the demon and the lich have their own frames.)
- No sound.
- Damage types, resistances and the barrel numbers are first guesses for the balancing pass, and the user has not played the barrels yet (see HANDOFF, open points).
- Lighting: all numbers (radius, intensity, flicker per kind, `TORCH_SPACING`, `DARK_SHARE`, `MIN_LIT`, `TINT_ALPHA`) are first guesses, and the look is not approved by the user yet (HANDOFF).
- The light canvas has 1 px per tile, so light bleeds about half a tile past walls (the same texel is shared by a wall and the floor next to it).
- The moving-light list uses a distance test without line of sight, so the glow of a shot or enemy behind a wall within range is sent and drawn (its carrier is not).
- Hero melee, dashes and arrows next to a torch put it out (any non-heat hit does); this is the agreed rule, but it may prove annoying in play.
- Torches are sent only when in the viewer's FOV, so a torch sprite can pop in at the edge of the FOV (under the darkness, so it is rarely noticeable). The lights themselves come from the start info and events and never pop.
- Weapon effects (swooshes, rings, particles) are drawn under the darkness, so they are black where it is dark. Only heroes, teammates and the party's own shots are above it.
- Snapshots are compact but not delta-compressed (every snapshot is complete). They are small anyway.
- Boss fights are covered by unit tests and were played live once against all three bosses; their numbers are not balanced yet.
- No password recovery, by design: there is no e-mail address to send anything to.
- Passwords travel in the login request. In production the game must run behind a TLS reverse proxy (with `COOKIE_SECURE=1`).
- Behind a reverse proxy every request comes from the proxy's IP, so the per-IP limits apply to everyone together. `X-Forwarded-For` is not read yet.
- The login limiter and the one-connection-per-account rule live in the memory of one server process.
- Admin sessions also live in memory: a restart logs the admin out. They end after `ADMIN_SESSION_MINUTES` without an admin action. There is one admin login, shared by whoever knows it; the audit log names it, not a person.
- Statistics count UTC days. Their history starts with the first deployment of the admin area.
- OpenTelemetry export is plain HTTP only (no TLS client built in).
