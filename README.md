# Tiny Adventurers

A browser-based multiplayer dungeon crawler with tiny pixel figures on a board-game dungeon.

- Players log in with an account (just a name and a password, no e-mail) and create up to 8 characters. Each character has a fixed class (Wizard, Paladin, Barbarian or Assassin) and its own progress.
- Up to 4 players open or join a dungeon run.
- Each run is one randomly generated dungeon of corridors, rooms and halls. A field of vision hides what your hero can't see.
- The party fights through it to a random final boss: a demon, a lich or a dragon.

## Documentation

| Document | For |
|---|---|
| [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md) | Players: how to join, controls, classes, enemies, bosses, tips |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Developers: architecture, protocol, simulation, netcode, rendering, how to extend |
| [docs/TODO.md](docs/TODO.md) | Open work and follow-ups |
| [HANDOFF.md](HANDOFF.md) | Current state and instructions for whoever continues the work |

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
- Keep `.env` secret. Changing `SESSION_SECRET` logs everyone out.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Left mouse | Primary attack toward the cursor (hold to repeat) |
| Right mouse | Secondary ability |
| Q / E | Switch which teammate you watch after dying |
| Esc | Menu (leave the dungeon) |
| F3 | Network and performance stats |

## Development

| Part | Tech | Commands |
|---|---|---|
| `server/` | Rust (tokio, axum). Authoritative 60 Hz simulation and lobby. | `cargo test`, `cargo run` |
| `client/` | TypeScript, Phaser 3, Vite | `npm install`, `npm run dev` (port 5173, proxies `/ws` to :8080), `npm test` |
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

- `?gallery`: every figure cycling through all its animations (no server needed)
  - Add `&state=melee&slow=10` to loop one animation in slow motion.
- `?mimic`: the chasing mimic, a treasure chest opening and the mimic reveal, side by side (no server needed)
- `?daemons`: the demon dungeon's imps, chorts and summoner fighting a knight, plus a pack of them (no server needed)
- `?water`, `?chasm`, `?lava`: the terrain with scripted figures: wading, drowning, falling, burning, the dash jumping a gap, and being knocked in (no server needed; add `&slow=3` for slow motion)
- `?knockback`: every push in the game (orc warrior, chort, the demon's cleave and swoop, the dragon's claw and tail) next to chasms and deep water (no server needed; `&slow=3` works too)
- `?ogre`: the ogre mini-boss's club push next to the orc warrior's, and its ground slam with the telegraph ring (no server needed; `&slow=3` works too)
- `?debug`: debug mode for the whole run
  - Your hero is immortal. Hits still show damage numbers, but your health doesn't drop.
  - Dashed lines show the shortest walkable path to the boss (yellow) and to the ogre mini-boss (blue, while it lives), updated every 0.5 s.
  - It is on by default. Disable it on a server with `ALLOW_DEBUG=0` in `docker-compose.yml`.
  - Add `&boss=demon|lich|dragon` on the host's page to preselect that end boss in the lobby, e.g. `?debug&boss=dragon`.
  - Runs where debug mode was used give no XP.
- `?lag=150&jitter=40&loss=2`: simulates a bad network connection

## Art

The sprites come from **16x16 DungeonTileset II** by 0x72 (CC0): https://0x72.itch.io/dungeontileset-ii. The pack files are in `client/assets-src/0x72/`. The game uses only pack sprites; effects such as sparks, glows and swooshes are simple shapes generated at runtime.
