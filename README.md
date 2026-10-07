# Tiny Adventurers

A browser-based multiplayer dungeon crawler with tiny pixel figures on a board-game dungeon.

- Up to 4 players open or join a dungeon run and pick a class: Wizard, Paladin, Barbarian or Assassin.
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
docker compose up --build
```

Then open http://localhost:8080. Every player opens the same address; other machines use the host's IP address, e.g. `http://192.168.1.20:8080`.

Player profiles (XP and upgrades) are stored in the `ta-data` Docker volume, so they survive `docker compose down`. `docker compose down -v` deletes them.

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
- `?water`, `?chasm`, `?lava`: the planned terrain with scripted figures: wading, drowning, falling, burning, the dash jumping a gap (no server needed; add `&slow=3` for slow motion)
- `?debug`: debug mode for the whole run
  - Your hero is immortal. Hits still show damage numbers, but your health doesn't drop.
  - A dashed line shows the shortest walkable path to the boss, updated every 0.5 s.
  - It is on by default. Disable it on a server with `ALLOW_DEBUG=0` in `docker-compose.yml`.
  - Add `&boss=demon|lich|dragon` on the host's page to preselect that end boss in the lobby, e.g. `?debug&boss=dragon`.
  - Runs where debug mode was used give no XP.
- `?lag=150&jitter=40&loss=2`: simulates a bad network connection

## Art

The sprites come from **16x16 DungeonTileset II** by 0x72 (CC0): https://0x72.itch.io/dungeontileset-ii. The pack files are in `client/assets-src/0x72/`. The game uses only pack sprites; effects such as sparks, glows and swooshes are simple shapes generated at runtime.
