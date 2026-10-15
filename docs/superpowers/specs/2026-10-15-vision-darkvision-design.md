# Vision and darkvision (entity type traits)

User decisions (2026-10-15):
- **Two new traits.**
  - **Vision:** how far an entity can see, in **tiles**.
  - **Darkvision:** the share of that vision that also works where it is dark (a ratio, 0..1).
- **Darkvision per entity type:**

  | Entity type | Darkvision |
  |---|---|
  | Demon | 1.0 (sees in the dark as far as its vision) |
  | Undead | 1.0 |
  | Dragon | 1.0 |
  | Monster | 1/3 |
  | Human | 0 (cannot see in the dark) |
  | Object | no vision at all (vision 0) |

- **Vision lives on the entity type as a default.** A single enemy kind or boss can override it, the same way resistances work today (`Adjust`).
- **Heroes use the traits too.** They are Human: vision 9 tiles, darkvision 0, which is exactly today's behaviour. The client also draws what a hero with darkvision sees: unlit tiles in darkvision range are shown **greyscale**.
- **To try hero darkvision:** a dev toggle in the existing server-gated debug mode sets your hero's darkvision to 1.0, 0.5 or 0. Items and potions grant it later through the same trait.
- **Design choices (approved):**
  - one shared perception rule for heroes and enemies (approach A);
  - a post-effect shader with a per-tile mask for the greyscale (approach A).

**Status:** designed in chat and approved by the user. This written spec still needs the user's review, then a plan (superpowers:writing-plans).

**Relation to the effect system** ([2026-10-15-effects-design-draft.md](2026-10-15-effects-design-draft.md)): vision and darkvision are stats that effects can change (blindness sets vision to 0). Build this first; the effect system then wraps the resolved `Sight` like any other stat.

## Context
The light system (`feature/lighting`) makes darkness hide things from heroes, but enemies still see heroes perfectly in the dark. Each enemy has a `sight` radius in px (`defs/enemies.rs`, 120–200 px, i.e. 7.5–12.5 tiles; bosses 400 px = 25 tiles). An enemy notices a hero inside that radius with line of sight (`ai::find_visible_player`). Heroes see 9 tiles (`fov::PLAYER_FOV_RADIUS`, a tile shadowcast) and only what is lit (`run/visibility.rs`).

The goal: darkness becomes tactical. You can slip past humans in the dark, but not past undead or demons. Every perception check, for heroes and enemies, goes through one trait-based rule.

## Why tiles
Everything perception-related already works in tiles:
- the hero's 9-tile shadowcast;
- the light radii;
- the map grid.

Tiles are easy to reason about while balancing ("sees 10 tiles down a corridor"). Fractions are allowed (e.g. 7.5). The conversion to px (`× TILE`, 16) happens once, internally. Centimetres would add a scale the game never uses, and px is an engine detail.

## Data (`server/src/defs/entity_types.rs`)
- **`TypeDef` gains** `vision: f64` (tiles) and `darkvision: f64` (0..1). First guesses:

  | Type | Vision | Darkvision |
  |---|---|---|
  | Human | 9 | 0 |
  | Monster | 8 | 1/3 |
  | Undead | 8 | 1.0 |
  | Demon | 9 | 1.0 |
  | Dragon | 25 | 1.0 |
  | Object | 0 | 0 |

- **`Adjust` gains** `vision: Option<f64>` and `darkvision: Option<f64>` (overrides).
- **`Profile` gains** `sight: Sight { vision: f64 /*tiles*/, darkvision: f64 }`.
- **Combining types** (an entity with several): the **best** vision and the **best** darkvision win (max), then the overrides replace them.
- **Today's ranges are kept:**
  - every enemy whose current `sight` differs from its type default gets a vision override with its current value in tiles (`sight / 16`);
  - the bosses keep 25 tiles;
  - so nothing changes where it is lit; darkness is the only new factor.
- `defs/enemies.rs` `sight` (px) is replaced by these overrides. `Monster.sight` becomes `Monster.sight: Sight`, resolved at spawn.

## The perception rule (new `server/src/run/perception.rs`)
- `pub fn sees(run: &Run, sight: Sight, from: Vec2, to: Vec2) -> bool`, true when all three hold:
  1. `dist(from, to) <= vision × TILE`;
  2. there is line of sight from `from` to `to` (`collision::line_of_sight` for enemies; for heroes their FOV shadowcast, see below);
  3. `to` is lit (`lights.lit(tile_of(to))`), **or** `dist <= vision × darkvision × TILE`.
- **Enemies:** `ai::find_visible_player` and `bosses::target` call `sees` with the monster's `Sight`. Hidden heroes (the rogue's Hide) stay unseen, as today.
- **Light per tick:**
  - `Run::step` refreshes the static light map and casts the moving lights once per tick, before the AI runs (the code that `send_snapshots` does today moves there);
  - perception then only reads `lights.lit(x, y)`, never `Run::is_lit` (which recasts per call).
- **Being hit:** unchanged. An enemy hit by a hero searches the spot the attack came from (`hurt_monster`), so a blind-in-the-dark human still reacts.
- **Heroes:**
  - a hero's `Sight` comes from the class profile (Human), plus a runtime darkvision override (`Player.darkvision: Option<f64>`, set by the dev toggle now and by items later);
  - the FOV shadowcast radius becomes the hero's vision (rounded to whole tiles for the shadowcast);
  - the snapshot filter (`visibility.rs` `seen`) becomes "in the hero's FOV **and** (lit, or within vision × darkvision tiles of the hero)";
  - events on a hero keep their FOV-only rule (`on_hero`).

## Protocol
- **`SelfW`** (own-player state in the snapshot) gains `darkvision` as a `u8` percentage (0–100). Only the own value matters for drawing.
- **The FOV radius:** it stays `CONST.FOV_RADIUS` in the client as long as heroes' vision is fixed at 9. If hero vision becomes changeable, `SelfW` gains `vision` too (not in this step).
- **Dev toggle:** `ClientMsg::DebugDarkvision { ratio: f32 }`. It is honoured only when the server allows debug, like `ClientMsg::Debug`. In the client, a key in the F3 debug view cycles 0 → 0.5 → 1.0.

## Client: greyscale darkvision
- **LightView** gets a third per-tile grid, the **darkvision mask**. A tile is 1 when it is in the hero's FOV, not lit, and within vision × darkvision tiles of the hero.
  - On such tiles the darkness alpha is a fixed `DV_DARK` (about 0.45, a first guess) instead of 1.0. The tint is 0.
  - The client's "lit" set already matches the server's, so its darkvision set matches the server's filter too. Same tile maths: distance from the hero's tile centre, `<=`.
- **Greyscale:** a small post-effect pipeline on the main camera (Phaser `PostFXPipeline`). It samples the mask (upsampled like the other canvases) and desaturates the scene where the mask is set. Heroes and monsters standing there are greyed too, which is what darkvision should look like.
  - It runs after everything world-space and before the HUD (check which camera draws the HUD; if it is the same camera, give the HUD its own camera or exclude it).
  - WebGL only (the game already needs WebGL).
- **The fade:** at the edge of the darkvision range the mask fades over about one tile with the same upsampling, so there is no hard ring.

## Tests
- **Data:** every type has a vision and a darkvision; several types take the best of each; overrides replace them; today's enemy ranges are preserved (one test per enemy: `vision × 16 == old sight`).
- **Perception:**
  - a human enemy does not see a hero standing in the dark at 3 tiles, but does once a torch lights the hero's spot;
  - a monster sees a dark hero at 2 tiles but not at 4 (8 × 1/3 ≈ 2.67);
  - undead and demons see a dark hero at full vision;
  - objects see nothing;
  - a hidden hero is never seen;
  - a hit still sends the enemy searching.
- **Hero filter:**
  - with darkvision 0, nothing changes (the existing visibility tests pass unchanged);
  - with darkvision 1.0, a monster on an unlit tile in FOV is sent;
  - with 0.5, only within half the vision.
- **Fixtures:** the client's darkvision mask matches the server's filter on a sample layout (shared `fixtures.json` case).
- **Client:** the mask maths; the greyscale pipeline compiles and runs in `?lights` (a demo toggle for darkvision).
- **Fingerprints:** `simulation_is_unchanged_after_waking_the_boss` may change, because enemies now lose heroes in the dark. Re-record only with the cause understood, and say so in the commit.

## Not in this step
- items, potions or spells that grant darkvision (they set the same `Player.darkvision`);
- changeable hero vision (only darkvision changes now);
- the effect system (blindness etc.): see the draft spec.
