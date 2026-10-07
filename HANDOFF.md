# Handoff — Tiny Adventurers

For: the next agent or developer continuing this project. Read this first, then the linked docs.

## Read in this order

1. [README.md](README.md): what the game is, how to run it, dev helpers.
2. [docs/TECHNICAL.md](docs/TECHNICAL.md): architecture, protocol, simulation, netcode, rendering, how to extend, tests, known limitations.
3. [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md): the game as players see it (classes, enemies, bosses). Keep it in sync when gameplay changes.
4. [docs/TODO.md](docs/TODO.md): open work, with the progression system first.

## Current state

**Working end to end in Docker (`docker compose up --build`, port 8080):**
- lobby, 4 classes, host-chosen or random end boss, random dungeon, field of vision
- persistent profiles: XP banked after each run, permanent upgrades bought in the lobby (`ta-data` volume)
- 6 enemy types, 3 bosses
- permadeath with spectating, victory/defeat screens
- client prediction and interpolation, F3 stats
- debug mode, sprite gallery

**Verified:**
- 45 server tests and the client port tests pass.
- Browser check of the profile flow: buying, persistence over page reload and `docker compose down`/`up`, new token for a new browser, read-only boss picker for guests.
- Two-player browser smoke tests (`tools/e2e/smoke.mjs`) run without browser errors.
- The gallery was checked visually: animations, melee swooshes, dragon breath from the mouth and nostrils.

**Not yet verified:**
- **A full live boss fight in the browser.** Bosses are covered only by server unit tests and the gallery. Doing this is the most valuable next check: host with `?debug&boss=lich` (and `demon`, `dragon`) and follow the path line.
- Behaviour with real (non-headless) players over a real network.

**Git and session workflow (the user's standing instructions):**
- One feature per session. When a feature is done: update this file and the docs, run the verification checklist below, then commit.
- Branches: `main` holds the finished work. Start each feature on a `feature/<name>` branch from `main` and commit there. Ask before merging into `main` or pushing.
- Remote: `origin` = https://github.com/migosoft/TinyAdventurers.git. `main` tracks `origin/main`.
- The repo-local author is `Goll Michael <m.goll@schig.com>`. `.gitattributes` keeps LF line endings.

## The user's decisions and preferences (keep them)

- **Art:** use only sprites from the 0x72 "16x16 DungeonTileset II" pack.
  - The user rejected self-drawn or procedural sprite art.
  - Missing figures are pack sprites scaled, tinted or hue-shifted (lich, dragon).
  - Attacks are approximated by animating pack weapon sprites.
  - Runtime effect shapes (particles, glows, swooshes, rings) are fine.
- **Weapons** are drawn small (0.6×).
- **Melee reach is unchanged on the server:** a swoosh at the real damage reach replaces the visible full swing, and the weapon fades out and back in.
- **Walls** follow the pack's 3/4 autotiling with its corner, junction and rim pieces (`client/src/game/autotile.ts`).
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
5. Visual changes to figures or effects: `node gallery-shots.mjs http://localhost:8080/ shots melee,breath`, or open `?gallery&state=<state>&slow=10` in a browser.
6. Gameplay changes: update [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md). Architecture changes: update [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Gotchas

- **Generated client files:** never edit `client/src/generated/*` by hand. Change Rust and run `cargo test`.
- **Message tag:** MessagePack enums are tagged with the field `t`, so no variant may have a field named `t`. That is why `Ping`/`Pong` use `time`.
- **Prediction parity:** client prediction relies on `client/src/sim/collision.ts` matching `server/src/collision.rs` exactly, and on the order *move, then abilities* in `Run::apply_input`. If you change movement, change both and keep `sim.test.ts` green.
- **Cooldowns** tick per processed input on both sides. Don't switch the server to wall-clock cooldowns without updating `Predictor`.
- **Boss behaviours** are taken out of `Run.boss` during their tick (`Option::take`), so `hurt_monster`'s immunity check cannot see the boss during its own tick. That is harmless today; keep it in mind.
- **Pack frame names** are used verbatim (`knight_m_run_anim_f2`). `necromancer` only has `necromancer_anim_f0-3`, used for both idle and run.
- **Dragon breath points** (`mouth` / `nostrils` in `anim/defs.ts`) were measured per lizard frame. If the dragon sprite changes, re-measure them.
- **The boss door sprite** is shown only for horizontal doors; vertical door openings appear as a wall when closed.

## Suggested next steps

1. Play each boss live with `?debug&boss=…` and tune boss numbers in `server/src/run/bosses/*.rs` and `defs/bosses.rs`.
2. Tune upgrade costs and bonuses (`defs/progression.rs`) after a few real runs.
3. Loadouts: design new abilities, then add the lobby picker.
4. Optional polish: sound, better boss sprites if the user approves a source (they must be pack-like and not self-drawn), delta-compressed snapshots.
