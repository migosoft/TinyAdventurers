# Tiny Adventurers

A browser-based multiplayer dungeon crawler with tiny pixel figures on a board-game dungeon.

- Players log in with an account (just a name and a password, no e-mail) and create up to 8 characters. Each character has a fixed class (Wizard, Paladin, Barbarian or Elven Ranger) and its own progress.
- Up to 4 players open or join a dungeon run.
- Each run is one randomly generated dungeon of corridors, rooms and halls. Darkness hides what your hero can't see: wall torches, lava and glowing shots light the dungeon, and a torch can be put out or lit again.
- The party fights through it to a random final boss: a demon, a lich or a dragon.
- It is a desktop game, played with keyboard and mouse. Phones and tablets are not supported.

## Documentation

| Document | For |
|---|---|
| [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md) | Players: how to join, controls, classes, enemies, bosses, tips |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Developers: architecture, protocol, simulation, netcode, rendering, how to extend |
| [GitHub issues](https://github.com/migosoft/TinyAdventurers/issues) and the project board | Open work and follow-ups (see [CLAUDE.md](CLAUDE.md) "Work tracking") |
| [CLAUDE.md](CLAUDE.md) | For whoever continues the work: which issue to pick, workflow, standing decisions, environment |

## Running it

Requires Docker.

```sh
cp .env.example .env    # then put long random values in it, e.g. from: openssl rand -hex 32
docker compose up --build
```

Two containers start:
- `game` serves the game on port 8080.
- `db` is PostgreSQL. It is not reachable from outside.

Then open http://localhost:8080. Every player opens the same address; other machines use the host's IP address, e.g. `http://192.168.1.20:8080`.

Accounts and characters are stored in PostgreSQL on the `ta-db` Docker volume, so they survive `docker compose down`. `docker compose down -v` deletes them.

**Admin area:** set `ADMIN_USER` and `ADMIN_PASSWORD` (at least 12 characters) in `.env`, then open http://localhost:8080/admin.
- It shows who is online and active players today, this week and this month, plus statistics on runs, bosses, classes and characters, with 30-day charts.
- It lets you change a player's password, delete characters and delete players. Every change goes into an audit log.
- Without both variables the admin area is switched off.

**Monitoring:** the server can send OpenTelemetry traces, logs and metrics to a collector such as ClickStack. Set `OTEL_EXPORTER_OTLP_ENDPOINT` in `.env` (see `.env.example` and [docs/TECHNICAL.md](docs/TECHNICAL.md) §11c). Without it nothing is sent.

**Public servers:**
- Run the game behind an HTTPS reverse proxy and set `COOKIE_SECURE=1` in `.env`, because passwords are sent at login.
- Set `TRUSTED_PROXIES` in `.env` to the proxy's address or network (e.g. `172.16.0.0/12` for a proxy in the same Docker Compose project), so the login limits count each player's address rather than the proxy's.
- Keep `.env` secret. Changing `SESSION_SECRET` logs everyone out.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Left mouse | Primary attack toward the cursor (hold to repeat) |
| Right mouse | Secondary ability |
| Q / E | Switch which teammate you watch after dying |
| Z / C | Turn the camera 45° left / right |
| X | Turn the camera back to north |
| Middle mouse button, drag | Turn the camera freely (it snaps to the nearest 45° on release) |
| Esc | Menu: Settings (Quality: High, Balanced or Fast; the choice is kept in this browser) and leave the dungeon |
| F3 | Network and performance stats |
| F4 | Debug accounts only: cycle your own hero's darkvision 0 / 50% / 100% |
| F8 | Debug accounts only: put the next effect (blind, sleep, petrified, …) on your own hero |
| F9 | Debug accounts only: turn your hero's immortality off and on |

## Development

| Part | Tech | Commands |
|---|---|---|
| `server/` | Rust (tokio, axum). Authoritative 60 Hz simulation and lobby. | `cargo test`, `cargo run` |
| `client/` | TypeScript, three.js, Vite | `npm install`, `npm run dev` (port 5173, proxies `/ws` to :8080), `npm test` |
| `tools/e2e/` | playwright-core + installed Edge/Chrome | `npm install`, `node smoke.mjs http://localhost:8080/` |

To run the server tests without a local Rust toolchain:

```sh
docker run --rm -v "$PWD":/work -w /work/server rust:1-slim-bookworm cargo test
```

`cargo test` also regenerates these client files (commit them):
- `client/src/generated/*.ts`: protocol types (via ts-rs), plus kinds, abilities and constants
- `client/src/generated/fixtures.json`: collision and FOV test vectors. The client's TypeScript ports of collision and FOV must match them exactly, so client prediction agrees with the server.

Details are in [docs/TECHNICAL.md](docs/TECHNICAL.md).

### Dev helpers

- `?r3d=<page>`: the 3D view's dev pages, with no server and no login. Pages: `demo` (the dev scene), `gallery` (every figure cycling through its states, the objects and a corridor behind a wall; add `&state=melee&slow=10` to loop one state in slow motion, `&focus=models` for the figure models, with the chest, Mimic and barrel on the object row: `&at=object:<i>`), `lights` (torches in several colours, lava, a fireball and a frost bolt, an explosion flash; V cycles the viewer's darkvision 0 / 50% / 100%), `woodland` (the forest road under the sun and sky of the time of day), `cove` (the nymph's cove), `mood` (the dungeon's air), `sunlight` (a ceiling crack's light shaft and patch), `fx` (the effects; `&fx=spells|booms|shots|figures|bosses|hazards|status|objects`) and `liquids` (water, lava and a chasm with wading and pushed figures; keys 1, 2 and 3 push an imp or a barrel in; `&models=barrel` draws the barrel as a 3D model). The panel at the bottom changes the camera, the quality and the switches of each page. See [docs/TECHNICAL.md](docs/TECHNICAL.md) §10.
- Debug accounts (no URL parameter): the admin marks a game account in `/admin` (player page, "Debug"). A marked account always plays in debug mode and only with other marked accounts; normal players never see its rooms.
  - Your hero is immortal. Hits still show damage numbers, but your health doesn't drop. F9 makes you mortal (and immortal again).
  - The yellow badge at the right edge, above the help line, lists the debug keys (F4, F7, F8, F9 and the Shift forms).
  - In the character screen the Attribute **+1**, skill-tree nodes and the respec are free (no XP or coins), and items can be granted. They are saved on the character, so use a test account.
  - The server sends the shortest walkable path to the boss, the ogre mini-boss and the cove every 0.5 s, and the badge lists their colours, but the 3D view does not draw them yet.
  - A `?r3d` in the address of a debug account's run shows the dev panel (camera, quality, light and sight switches, the free camera on F) over the run; without it the run looks like a player's.
  - Debug runs bank XP and coins like normal runs. Unmarking the account in `/admin` wipes the progress of all its characters.
  - The host picks the end boss in the waiting room (there is no URL preselect). `tools/e2e/smoke.mjs` plays a two-player run with ordinary throwaway accounts; `tools/e2e/r3d-run.mjs` marks a throwaway account as a debug account through the admin API (`ADMIN_USER`/`ADMIN_PASSWORD` in the environment) or psql and plays a run with it.
- `?lag=150&jitter=40&loss=2`: simulates a bad network connection

## Art

The sprites come from **16x16 DungeonTileset II** by 0x72 (CC0): https://0x72.itch.io/dungeontileset-ii. The pack files are in `client/assets-src/0x72/`. All figures are pack sprites except three bosses, the Ghost and the Shade. The red dragon's sprite and animation strips are AI-generated art made for this game (`client/assets-src/dragon/`), and some of its frames are built from them at atlas build time. The red demon's animation strips are AI-generated art made for this game as well (`client/assets-src/demon/`), from a reference image the user supplied. The lich is pixel art drawn for this game with Claude Code in the pack's style and colours (`client/scripts/lich-frames.ts`). The barrel is AI-generated art made for this game with ChatGPT, redrawn at game size in pack colours (`client/assets-src/barrel/`, `client/scripts/barrel-frames.ts`). The Fireball's explosion is AI-generated art made for this game with ChatGPT and supplied by the user, cut into frames at atlas build time (`client/assets-src/explosion/`, `client/scripts/explosion-frames.ts`). The wall torch (its iron holder and its flame) is built in code, drawn for this game with Claude Code (`client/src/render3d/torch/`, #391). The Ghost and the Shade are not pack sprites either: their design comes from an AI-generated ghost (made with ChatGPT and supplied by the user, not the user's own drawing), redrawn by hand at 16x16 for this game with Claude Code; the Shade is derived from the same ghost (`client/scripts/spectre-frames.ts`). Their 3D models on the dev pages (the Ghost's see-through body, the Shade's lean figure and its fog) are built in code and drawn for this game with Claude Code (`client/src/render3d/models/descs/ghost.ts`, `shade.ts`, #359). The title logo was made for this game with Google's image generation AI (`client/assets-src/logo/`). The cove's bushes and plants are drawn for this game with Claude Code in pack colours (`client/scripts/cove-frames.ts`). Every tree, conifer, dead tree and bush of the woodland, and the cove's tree, is drawn for this game with Claude Code at run time, in pack colours plus a darker dead-wood brown (`client/src/game/vegetation.ts`, `client/src/game/vegetation/`). The 3D view's trees, conifers and bushes, and the cove's willow, are grown at run time from branches in the same palette and sizes as that generator and drawn for this game with Claude Code (`client/src/render3d/trees/`); no picture is used for them. The 3D figure models (the heroes, the skeleton, the ogre, the wolf and the weapons) are built at run time from descriptions of the pack's sprites, drawn for this game with Claude Code; the big hammer among them is redrawn (`client/src/render3d/models/`). The stag, deer, boar and bunny models are not built from sprites but from tubes, balls and drops, also drawn for this game with Claude Code (`client/src/render3d/models/tubes.ts`, `descs/deer.ts`, `boar.ts`, `bunny.ts`). So are the models of the goblin archer, the orcs, the necromancer, the summoner, the disciple, the imp, the chort and the knight (`descs/goblin.ts`, `orc.ts`, `robed.ts`, `imp.ts`, `chort.ts`, `npcKnight.ts`). The lich's 3D model is built in code, drawn for this game with Claude Code after the user's description (`client/src/render3d/lich/`, #358). The models of the treasure chest, the Mimic and the explosive barrel are built from hard-edged prisms and a painted tube, also drawn for this game with Claude Code (`client/src/render3d/models/descs/chest.ts`, `mimic.ts`, `barrel.ts`). The dungeon's stonework (the laid stone and natural rock of floors, walls and wall tops, the carved friezes, the summoning circles, mosaics and drain grates, the caves' puddles, cracks and crevices, and the glowing crystals) is built and painted in code, drawn for this game with Claude Code (`client/src/render3d/stone/`, #380); no picture is used for it. Terrain tiles are generated from pack colours; effects such as sparks, glows and swooshes are simple shapes generated at runtime.

### Credits

Thanks to the artists whose work this game uses. None of them asks for credit; they get it anyway.

- **0x72**: "16x16 DungeonTileset II" (CC0), https://0x72.itch.io/dungeontileset-ii. The tiles, heroes and most enemies.
- **Superdark**: "16x16 Enchanted Forest Characters" (CC0), https://superdark.itch.io/enchanted-forest-characters. Stored in `client/assets-src/enchanted-forest/`; its wolf frames (Wolf_Idle, Wolf_Walk) are built into the atlas as the Elven Ranger's Dire Wolf (trimmed only). The other figures (gnolls, bandit, elves) are not built in yet.
- **Superdark**: "16x16 Fantasy RPG Characters" (free for any use), https://superdark.itch.io/16x16-free-npc-pack. Stored in `client/assets-src/fantasy-npcs/` with its licence note; its "Knight - Standard" frames (Knight_Idle, Knight_Walk) are built into the atlas as the recruitable Knight (trimmed only). The other figures are not built in yet.
- **LYASeeK**: "Forest creatures" (free use, no resale), https://lyaseek.itch.io/miniffanimals. Stored in `client/assets-src/forest-animals/` with its licence note; the Outline variant of its bunny, two deer and boar (idle and move rows, trimmed only) are built into the atlas as the cove's animals. The other animals and rows are not built in yet.

Fonts: Inter by Rasmus Andersson and IM Fell English SC by Igino Marini, both SIL Open Font License 1.1 (files and licences in `client/public/fonts/`).

Each pack folder in `client/assets-src/` has its licence note. The AI-generated and self-made art is listed above.
