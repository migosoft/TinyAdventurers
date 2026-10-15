# Light-source system (TODO priority 1)

User decisions (2026-10-15):
- **The system:**
  - It is general, not a torch feature: many more light sources follow later.
  - Light can have any colour, and overlapping lights mix.
- **Darkness:**
  - Heroes have no light of their own; abilities and equipment will provide one later.
  - Unlit tiles are fully black, with no room shape.
- **Torches:**
  - They hang at regular spacing along all walls, including corridors, with side-wall sconces too. Some rooms and corridor stretches get none (dark pockets).
  - The spawn room and the boss hall always have torches.
  - E toggles a torch. A hit with a heat share lights it; any other damage puts it out.
- **First users:** wall torches, lava and glowing projectiles.
- **Torch art:** "Simple Torch Animation 16x16" by Natural_Privateer (OpenGameArt, CC0).

## Context
TODO.md priority 1. Darkness limits what the heroes see. Light sources reveal the dungeon, and some of them can be switched off and on.

Many features will add light sources later:
- braziers, glowing mushrooms or goo, fountains;
- hero spells and equipment;
- light-emitting enemies;
- the carriage lantern of the escort level;
- the shadow and the torch-extinguishing enemy, which act on lights.

So this feature builds the **foundation**: a light-kind table, a light registry, a lit-or-not query, a generic protocol and a generic renderer. Wall torches, lava and glowing projectiles are only its first users. Adding a later light source must not touch the core.

**Branch:** `feature/lighting`, from `main`. `feature/barrels` was merged into `main` and pushed before this branch was made (2026-10-15).

Every number below is a first guess for the balancing pass (TODO "Tune").

## Delivery steps
1. This spec (committed on the branch), reviewed by the user.
2. The implementation plan, written with **superpowers:writing-plans**. The user picks how it is carried out.
3. Build in stages, each one tested and committed:
   - **A.** The core on the server: light kinds, the registry, the light map, `is_lit`, visibility filtering, the protocol.
   - **B.** The core on the client: the light canvas with colour mixing, Rust and TypeScript fixtures, a `?gallery` light demo.
   - **C.** The first users: torches (objects, placement, switching, art), lava lights, projectile lights.

## A. Server core

### Light kinds (new `server/src/defs/lights.rs`)
- `LightKind` is an open enum, and its defs table holds only data:
  - `radius` in tiles;
  - a default `colour` (RGB, `u8` × 3);
  - `intensity` (0..1: how bright the centre is on the client);
  - `flicker` (0..1: how strongly the client wobbles it).
- First kinds:

  | Kind | Radius | Default colour | Intensity | Flicker | Used by |
  |---|---|---|---|---|---|
  | `Torch` | 5 | warm orange (255, 170, 90) | 1.0 | 0.15 | wall torches |
  | `Lava` | 1 | red (255, 70, 30) | 0.8 | 0.05 | each lava tile |
  | `Fire` | 3 | orange (255, 140, 60) | 0.9 | 0.2 | fire projectiles, fire patches |
  | `Magic` | 2 | per source (see C) | 0.7 | 0.1 | magic projectiles |

- **`kind_light(EntityKind) -> Option<(LightKind, Colour)>`** says which entity kinds carry a light from spawn. It is the one place that decides which projectiles glow and in which colour.
- `export.rs` exports the table (`LIGHT`, with radius, colour, intensity and flicker per id) to `client/src/generated/defs.ts`.

### Registry (new `server/src/run/light.rs`)
- **Data:**
  - `LightSource { id: u32, kind: LightKind, colour: Colour, anchor: Anchor, on: bool }`.
  - `Anchor::Tile(x, y)` is static. `Anchor::Entity(id)` is moving: it follows a monster, projectile, hazard, hero or object.
  - Static or moving depends on the anchor alone, never on the kind. The same kind can be both, e.g. a torch on the wall and a torch carried later by a hero.
- **API**, the only way features touch light:
  - `add_light(kind, anchor, colour: Option<Colour>) -> id`: `None` uses the kind's colour;
  - `set_light(id, on)`;
  - `remove_light(id)`;
  - `light(id)` to read one source back;
  - `is_lit(pos) -> bool`.
- **Events:** changes to static lights emit protocol events (see "Protocol").
- **Entity lights:**
  - They are added where the entity is spawned (`kind_light`), and features can add more.
  - They are removed when the entity is gone. A per-tick sweep drops lights whose entity no longer exists, so no despawn path can leak them.
- **Ids:** light ids are separate from entity ids.

### Light map (in `run/light.rs`)
- **Static layer:** one `bool` per tile, rebuilt by shadowcasting.
  - Each lit `Tile` source runs `fov.rs` `compute` from its tile with its radius and ORs the result in.
  - Opaque tiles stop the light but are lit themselves, as with sight.
  - A `dirty` flag is set by any add, remove or switch of a static source, and the layer is rebuilt lazily on the next query.
  - Cost: one shadowcast per static source, only when something changed. There are a few hundred torch and lava sources per map at most.
- **Moving layer:** no map. The query checks each lit `Entity` source.
  - The test: distance to the source ≤ radius × TILE, **and** `collision::line_of_sight` from the source to `pos`.
  - There are only a few moving lights at a time (projectiles), so this stays cheap.
- **`is_lit(pos)`:** the static layer at `pos`'s tile, or any moving light that reaches `pos`.

### Visibility (`run/visibility.rs`)
- **The rule:** a position is visible to a viewer if it is in the viewer's FOV (as today) **and** `is_lit`. This applies to monsters, enemy projectiles, world objects, hazards, positioned events and the lich drain beams.
  - Large figures count as visible when any of the checked points is.
  - The lich drain beams keep their "boss fight on" rule.
- **Always sent, as today:** players and the party's own projectiles.
- **Also always sent:** world objects that own a static light (torches), so the client can draw lights outside the viewer's FOV and keep torch state in step.
- **The moving-lights list (new snapshot field):** every lit moving light whose radius reaches a tile in the viewer's FOV.
  - A glow from a hidden monster can show at the edge of the viewer's sight, but the monster itself is only sent when it stands in lit, visible space.
- **Players' FOV** is computed as today (radius 9). Light never extends sight beyond it.
- **Enemies:** their perception (`sight` plus line of sight) is unchanged; they see in the dark.

### Protocol (`protocol.rs`, `wire.rs`, `client/src/wire.ts`)
- **`RunStartInfo.lights: Vec<LightInfo>`**, with `LightInfo { id, kind, colour, x, y, on }`. It covers every static light at run start (torches and lava).
- **New events**, all sent with `at = None` (to everyone):
  - `Ev::Light { id, on }`: a static light switched;
  - `Ev::LightAdd { id, kind, colour, x, y, on }` and `Ev::LightRemove { id }`: a static light created or removed mid-run (e.g. lava appearing through `Ev::Tile`, a brazier placed later).
- **`Snapshot.lights: Vec<MovingLight>`**, with `MovingLight(x, y, kind, colour?)`.
  - The colour is left out when it equals the kind's default, which keeps the list small.
  - Encoded in the same compact style as `EntSnap`. Check the custom snapshot and `Ev` encoders in `wire.rs` and `client/src/wire.ts`, and add wire fixtures.

## B. Client core

### Light map (new `client/src/game/light.ts`)
- **State:** it holds the static sources (from `RunStartInfo.lights` and the light events) and builds the static light map with the `sim/fov.ts` port, the same way the server does.
  - Shared fixtures (`export.rs` → `fixtures.json`) check that the Rust and TypeScript maps are identical for a few sample layouts.
  - A tile the server counts as lit must never be drawn dark.
- **Per-tile colour:** each tile gets the sum of every source that reaches it, per channel, capped at 255 (additive mixing). Each source adds `colour × intensity × falloff(distance / radius)`.
  - The falloff is about 1 near the centre and about 0.45 at the radius edge. Its exact shape is tuned in `?gallery`.
  - So torch plus lava gives orange, and blue plus red gives purple.
  - Static sources' contributions are cached and recomputed only when a static source changes.
  - Moving lights from the snapshot are added each frame, with the same falloff and a line-of-sight check against the map.

### Light canvas (`GameScene`, replacing `setupFog`/`updateFog`)
- **Two `CanvasTexture`s**, one pixel per tile, LINEAR filtering, scaled ×TILE. If the gradients look blocky in `?gallery`, use 2 or 4 pixels per tile instead.
  - **Darkness layer:** black, at alpha 1.0 on every tile that is outside the viewer's FOV or not lit. On lit tiles in the FOV, the alpha drops with the tile's total brightness, reaching 0 at full light.
  - **Tint layer:** the per-tile light colour, drawn with ADD blending under the darkness layer, so lit areas take the colour of their lights.
- **Flicker:** each source's brightness wobbles slightly over time, by its kind's `flicker` and a per-source phase. A flickering source is redrawn every frame only inside the camera view.
- **Redraws:** when the viewer's tile changes, on `Ev::Light`, `Ev::LightAdd`, `Ev::LightRemove` or `Ev::Tile`, and every frame while moving lights or flickering sources are in view. The redraw is limited to the camera's tile window, about 60 × 34 tiles.
- **Draw order:** heroes, teammates and the party's own shots are drawn above the darkness layer, so a hero is seen standing in a black corridor. Everything else stays below it.
- **No source-specific code:** the renderer knows nothing about torches, lava or projectiles. Lava keeps its existing pulsing glow sprites (`terrain.ts`), which sit under the darkness and only show where lit.

### Gallery demo
- `?gallery` gets a light demo:
  - a small room with torches in several colours side by side;
  - a lava pool;
  - a torch next to lava, to show the mixing;
  - a moving fireball and a magic bolt;
  - a dark corridor.
- It is used to tune the falloff, the flicker and the canvas resolution with the user.

## C. First users

### Torches
- **The object:**
  - `EntityKind::Torch = 82` with `ObjState::Torch { side: TorchSide, light: u32 }`, where `TorchSide` is `Face` (a brick face, floor below) or `Left`/`Right` (on a side wall, floor to that side).
  - It is non-solid, uses the `Object` entity type and never breaks (`hurt_object` changes nothing but the light).
- **Spawning:** `Run::new` spawns each torch from `Layout.torches`. Its static light (`Torch` kind) sits on the floor tile in front of the wall (below a face, beside a side sconce), so the shadowcast starts inside the room.
- **Switching:**
  - `use_object` (E, hand reach as for barrels) toggles the light.
  - `hurt_object`: a hit whose `Damage` split has any `Heat` share lights the torch; any other hit puts it out.
  - Torches can be hit by:
    - shots that stop at their wall tile (the tile check in `advance_projectile`);
    - area attacks and blasts, by distance from the torch.
  - A barrel blast (50 % heat) therefore lights the torches around it.
- **Snapshot:** torches are always sent (see visibility), with `anim` 0 = out and 1 = lit, and `TorchSide` packed in a spare field.
- **Placement, new `place_torches` in `dungeon/generate.rs`:**
  - It uses its own rng stream **12**, so old seeds keep their maps. It runs **after `rotate()`**, so "face" really means a brick face on screen.
  - **Candidates:**
    - wall cells with floor directly below (`Face`);
    - wall cells with floor directly left or right and wall above and below (`Left`/`Right`);
    - never on a door, a corner or a cell next to another torch.
  - **Spacing:** walking each straight wall run, a torch about every 6 tiles, starting at a random offset.
  - **Dark pockets:** about 20 % of rooms and corridor stretches get no torches at all.
    - A "stretch" is a connected piece of corridor between two rooms.
    - The spawn room and the boss hall are never dark, and get at least one torch per 6 tiles of wall.
  - The result is stored in `Dungeon.torches` → `Layout.torches` as `(x, y, side)`.
  - **Fingerprint:** the `level_setup_is_unchanged` fingerprint leaves torches and their ids out, as it does for barrels.
- **Client view:** a new `game/torch.ts`.
  - A lit torch shows the animated flame; an unlit one shows a burnt-out frame.
  - The sprite hangs on the wall (`Face`: on the brick face; `Left`/`Right`: at the side wall's inner edge, facing into the room).
- **Art:** "Simple Torch Animation 16x16" by Natural_Privateer, OpenGameArt, CC0 ("Credit is appreciated").
  - Copy `torch_anim.png` to `client/assets-src/torch/` with a licence note and build it into the atlas (`build-atlas.ts`).
  - The unlit frame is made from it, e.g. the stick without the flame.
  - A side-sconce version, if needed, is derived from the same frames.
  - Show both to the user in `?gallery` before using them.
  - Credit it in the README Art section and TECHNICAL §9.

### Lava
- At run start, every lava tile gets a static `Lava` light on its own tile (radius 1, so it lights its neighbours).
- When `Ev::Tile` turns a tile into lava, or lava into something else, add or remove that tile's light. The light events then go out.
- A future source of the same shape (goo, glowing mushrooms) works the same way.

### Projectile lights
- `kind_light` gives, at spawn, through the same spawn path for every projectile and hazard:

  | Entity kinds | Light kind | Colour |
  |---|---|---|
  | `Fireball`, `FireBolt`, `FireOrb`, `DragonFireball`, `FireBreath` | `Fire` | default (orange) |
  | `FirePatch` (hazard) | `Fire` | default (orange) |
  | `Missile` | `Magic` | violet blue (150, 120, 255) |
  | `FrostBolt` | `Magic` | ice blue (120, 200, 255) |
  | `ShadowBolt`, `GloomBolt` | `Magic` | purple (170, 60, 220) |

- Arrows and crossbow bolts carry no light.
- The magic bolts are included to show coloured light from the start. Leaving them out means removing their rows.

## Not in this feature
- **Own light for heroes:** it comes later with abilities and equipment, through `add_light(…, Anchor::Entity(hero), …)`.
- **The torch-extinguishing enemy and the shadow** (tier 3): they will use `is_lit`, `set_light` and the light registry.
- **Other light sources:** braziers, mushrooms, goo, fountains, the carriage lantern. They will be new kinds plus `add_light` calls, with no core change.
- **Remembered (explored) tiles:** not built. Darkness is fully black.
- **Enemies affected by darkness:** not built.

## Tests (TDD; inline test modules, `test_run` helpers in `run/mod.rs`)
- **Registry and light map:**
  - add, switch and remove a static light, and the dirty rebuild;
  - light stops at walls but lights the wall;
  - a moving light follows its entity, is blocked by walls, and disappears when the entity is gone (the sweep);
  - the colour override and the default colour.
- **Visibility:**
  - a monster in a dark room inside the hero's FOV is not sent;
  - a lit torch makes it visible, and putting the torch out hides it again;
  - a fire bolt flying past lights it;
  - a positioned event in the dark is not sent;
  - torches are always sent;
  - the moving-light list contains the fire bolt and leaves out a light far outside FOV.
- **Torches:**
  - E toggles a torch, and emits `Ev::Light`;
  - a heat hit lights it, a physical or cold hit puts it out;
  - a barrel blast lights nearby torches;
  - a shot into a torch's wall tile switches it.
- **Generator** (200 seeds):
  - torches only on valid wall cells, with no two adjacent;
  - spacing in range;
  - the spawn room and the boss hall have torches;
  - some rooms or stretches are dark;
  - the old-seed fingerprint is unchanged.
- **Lava:** lava tiles have lights; `Ev::Tile` lava changes add and remove them.
- **Fixtures:**
  - the Rust and TypeScript static light maps match on sample layouts;
  - wire fixtures round-trip the new events and the snapshot lights.
- **Client:**
  - a unit test for colour mixing (two sources on one tile add up per channel, capped at 255);
  - the light map built from start info and events.
- **Live:**
  - `cargo test`, client `npm run build` and tests;
  - `?gallery` screenshots with no browser errors;
  - a two-player run: dark pockets, switching a torch with E, fire bolts lighting a corridor, lava glow, the boss hall.

## Verification
- All of the above tests pass.
- Measured in a bot run: the server tick time does not rise noticeably compared with `main`, and snapshot size grows only by the moving-light list.
- The user approves the look in `?gallery` (falloff, colours, flicker, torch art, side sconces) and in a real run.

## Tune later (balancing pass)
Radius and intensity per kind, torch spacing, the dark-pocket share, the falloff curve, and the flicker.

## Docs and wrap-up
- **TECHNICAL:**
  - §4 (protocol: lights in `RunStartInfo`, the events, `Snapshot.lights`);
  - §5 (torches as world objects, the light registry);
  - §6 (stream 12, `place_torches`);
  - §7 (lighting replaces the fog: `is_lit`, the visibility rule, the light canvas);
  - §9 (torch frames);
  - §11, new "How to add a light source";
  - §12 (tests).
- **PLAYER_GUIDE:** "Seeing in the dark", covering torches, E, heat and other hits, dark corridors and glowing shots.
- **README:** Art credits.
- **TODO.md:** remove the Lighting section and priority 1, and renumber. Add the follow-ups (own hero light, more sources, explored tiles).
- **HANDOFF.md:** update; commit after each stage.
