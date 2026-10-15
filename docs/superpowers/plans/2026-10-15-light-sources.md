# Light-Source System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A general light-source system: darkness hides what is not lit; lights of any colour (static on tiles, moving with entities) reveal the dungeon; wall torches, lava and glowing shots are its first users.

**Architecture:**
- **Server.** The server owns the truth:
  - a light-kind table (`defs/lights.rs`);
  - a per-run registry (`run/light.rs`) with tile or entity anchors;
  - a cached static light map plus moving lights tested per query;
  - one query, `Run::is_lit`.
- **Snapshot filtering.** Each snapshot sends only what is in a viewer's FOV **and** lit.
- **Protocol.** It is generic:
  - static lights in `RunStartInfo`;
  - light events;
  - a moving-light list in each snapshot.
- **Client.** It mirrors the static map with the same shadowcast (`game/light.ts`, checked by fixtures). It draws a darkness canvas plus an additive colour tint canvas (`game/lightview.ts`). The renderer knows nothing about torches or lava.

**Tech Stack:** Rust (tokio/axum server, `cargo test` also regenerates the client files in `client/src/generated/`), TypeScript + Phaser 3.90 client, vitest, MessagePack wire format.

**Spec:** [docs/superpowers/specs/2026-10-15-light-sources-design.md](../specs/2026-10-15-light-sources-design.md). Read it before starting.

## Global Constraints

- **Branch:** `feature/lighting` (already created from `main`). Commit after each task. Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Server tests:** there is no local Rust. Run from the repo root:
  - the whole suite: `docker compose -f docker-compose.test.yml run --rm test`;
  - filtered: `docker compose -f docker-compose.test.yml run --rm test cargo test --release <filter>`;
  - this also regenerates `client/src/generated/*` (commit those files).
- **Client tests:** in `client/`, `npx vitest run <file>`, `npm test` (all), `npm run build` (atlas + tsc + vite).
- **Colours** are `u32` `0xRRGGBB` everywhere (Rust `Colour`, wire, TS).
- **Light kinds** (`LightKind` ids):

  | Kind | Id | Radius (tiles) | Colour | Intensity | Flicker |
  |---|---|---|---|---|---|
  | Torch | 0 | 5 | `0xffaa5a` | 1.0 | 0.15 |
  | Lava | 1 | 1 | `0xff461e` | 0.8 | 0.05 |
  | Fire | 2 | 3 | `0xff8c3c` | 0.9 | 0.2 |
  | Magic | 3 | 2 | `0x9678ff` | 0.7 | 0.1 |

- **Entity lights:**
  - Fire (default colour): `Fireball`, `FireBolt`, `FireOrb`, `DragonFireball`, `FireBreath`, `FirePatch`.
  - Magic: `Missile` (default colour), `FrostBolt` `0x78c8ff`, `ShadowBolt` and `GloomBolt` `0xaa3cdc`.
- **Torches:**
  - `EntityKind::Torch = 82`, non-solid, never breaks.
  - A hit with any `Heat` share lights it; any other hit that is not fully resisted puts it out.
  - E toggles it.
  - It is always sent in snapshots.
- **Generator:** `place_torches` uses rng **stream 12** and runs **after `rotate()`**.
  - `TORCH_SPACING = 6`, `DARK_SHARE = 0.2`.
  - Runs shorter than 3 tiles get no torch.
  - The start room and the boss hall are never dark.
- **Fingerprints:** `level_setup_is_unchanged` must keep its constants, and so must `simulation_is_unchanged_after_waking_the_boss`. Torches are spawned last and left out of the fingerprint, as barrels are. Light ids are separate from entity ids.
- **Visibility:** a thing is sent if it is in the viewer's FOV and lit.
  - Always sent: players, the party's own shots, and torch objects.
  - Events on a hero (`hurt_player`, `heal_player`) need FOV only.
  - Enemy perception is unchanged.
- **Client darkness:**
  - Unlit or unseen tiles get alpha 1.0.
  - A lit, visible tile gets alpha `1 - max(brightness, 0.35)`, so a lit tile is never drawn dark.
  - Heroes and party shots are drawn above the darkness at `DEPTH.heroes = 7000.5`.
- **Art:** "Simple Torch Animation 16x16" by Natural_Privateer (OpenGameArt), CC0, credit appreciated. Put it in `client/assets-src/torch/` with a licence note.
- **Desktop only:** no phone layouts (user rule).
- **Deviations from the spec** (intended; record them in HANDOFF):
  - The light demo is its own dev page, `?lights`, not a part of `?gallery`.
  - The light canvas is redrawn every frame inside the camera window, instead of only on changes. This is simpler and cheap, and flicker needs it anyway.
  - Events on a hero need sight only (the spec's "hits on you still show"); this is done with `Run.on_hero`.

## Review Focus

1. **A hero in the dark still sees their own hits.** Damage and heal numbers on a hero in an unlit corridor must be sent: FOV only, not light (Task 5 tests `hero_events_are_sent_in_the_dark_monster_events_are_not` and `hurt_and_heal_on_a_hero_are_marked_as_hero_events`).
2. **A lit tile must never be drawn dark.** The client's static lit set must equal the server's (Task 6 fixture test), and the alpha floor of 0.35 must hold (Task 7 `darknessAlpha` test).
3. **Light changes before the first step.** A light added during `Run::new` must reach the client through `RunStartInfo.lights` and **not** also as `Ev::LightAdd`, which would duplicate it (Task 3 test `lights_added_at_start_send_no_event`).
4. **Closing the boss door changes what torch light reaches.** Any tile change must mark the static map dirty (Task 4 test `a_closed_door_blocks_static_light`).
5. **A dead or removed light carrier leaves no light behind.** The per-step sweep must drop entity lights whose entity is gone, including projectiles that die on the tick they spawn (Task 4 test `a_shot_that_dies_at_once_leaves_no_light`).

---

## Stage A: server core

### Task 1: Light kinds table and export

**Files:**
- Create: `server/src/defs/lights.rs`
- Modify: `server/src/defs/mod.rs` (add `pub mod lights;`)
- Modify: `server/src/export.rs` (export `LIGHT_KIND`, `LIGHT`)
- Generated: `client/src/generated/defs.ts`

**Interfaces:**
- Produces:
  - `pub type Colour = u32`;
  - `#[repr(u8)] pub enum LightKind { Torch = 0, Lava = 1, Fire = 2, Magic = 3 }` with `LightKind::ALL: [LightKind; 4]`;
  - `pub struct LightDef { radius: i32, colour: Colour, intensity: f64, flicker: f64 }` (Serialize);
  - `pub fn def(k: LightKind) -> LightDef`;
  - `pub fn kind_light(k: EntityKind) -> Option<(LightKind, Option<Colour>)>`.
- TS: `LIGHT_KIND` (name → id) and `LIGHT: Record<number, { radius; colour; intensity; flicker }>` in `generated/defs.ts`.

- [ ] **Step 1: Write the failing tests** at the bottom of the new `server/src/defs/lights.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use EntityKind as K;

    #[test]
    fn every_kind_has_a_sane_def() {
        for k in LightKind::ALL {
            let d = def(k);
            assert!(d.radius >= 1 && d.radius <= 9, "{k:?}");
            assert!(d.colour <= 0xffffff && d.intensity > 0.0 && d.intensity <= 1.0 && d.flicker >= 0.0);
        }
    }

    #[test]
    fn fire_and_magic_shots_glow_arrows_do_not() {
        for k in [K::Fireball, K::FireBolt, K::FireOrb, K::DragonFireball, K::FireBreath, K::FirePatch] {
            assert_eq!(kind_light(k), Some((LightKind::Fire, None)), "{k:?}");
        }
        assert_eq!(kind_light(K::Missile), Some((LightKind::Magic, None)));
        assert_eq!(kind_light(K::FrostBolt), Some((LightKind::Magic, Some(0x78c8ff))));
        assert_eq!(kind_light(K::GloomBolt), Some((LightKind::Magic, Some(0xaa3cdc))));
        assert_eq!(kind_light(K::ShadowBolt), Some((LightKind::Magic, Some(0xaa3cdc))));
        for k in [K::Arrow, K::Bolt, K::Wizard, K::Barrel, K::Chest, K::Ogre] {
            assert_eq!(kind_light(k), None, "{k:?}");
        }
    }
}
```

- [ ] **Step 2: Run them to see them fail.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release defs::lights`. Expected: compile error (module missing).

- [ ] **Step 3: Implement.** Put this above the tests in `server/src/defs/lights.rs`, and add `pub mod lights;` to `server/src/defs/mod.rs` (alphabetical, after `kinds`):

```rust
//! Light kinds (data only) and which entity kinds carry a light from spawn.
//! A new light source is a new row here plus an `add_light` call
//! (`run/light.rs`), never new core code. Exported to the client as `LIGHT`.

use super::kinds::EntityKind;
use serde::Serialize;

/// 0xRRGGBB.
pub type Colour = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum LightKind {
    Torch = 0,
    Lava = 1,
    Fire = 2,
    Magic = 3,
}

impl LightKind {
    pub const ALL: [LightKind; 4] = [LightKind::Torch, LightKind::Lava, LightKind::Fire, LightKind::Magic];
}

/// First guesses for the balancing pass.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct LightDef {
    /// Reach in tiles (shadowcast radius).
    pub radius: i32,
    /// Default colour; a single light can override it.
    pub colour: Colour,
    /// Brightness at the centre (0..1, client only).
    pub intensity: f64,
    /// How strongly the client wobbles it (0..1).
    pub flicker: f64,
}

pub fn def(k: LightKind) -> LightDef {
    match k {
        LightKind::Torch => LightDef { radius: 5, colour: 0xffaa5a, intensity: 1.0, flicker: 0.15 },
        LightKind::Lava => LightDef { radius: 1, colour: 0xff461e, intensity: 0.8, flicker: 0.05 },
        LightKind::Fire => LightDef { radius: 3, colour: 0xff8c3c, intensity: 0.9, flicker: 0.2 },
        LightKind::Magic => LightDef { radius: 2, colour: 0x9678ff, intensity: 0.7, flicker: 0.1 },
    }
}

/// The light an entity of this kind carries from spawn (`None` colour = the kind's).
pub fn kind_light(k: EntityKind) -> Option<(LightKind, Option<Colour>)> {
    use EntityKind as K;
    match k {
        K::Fireball | K::FireBolt | K::FireOrb | K::DragonFireball | K::FireBreath | K::FirePatch => Some((LightKind::Fire, None)),
        K::Missile => Some((LightKind::Magic, None)),
        K::FrostBolt => Some((LightKind::Magic, Some(0x78c8ff))),
        K::ShadowBolt | K::GloomBolt => Some((LightKind::Magic, Some(0xaa3cdc))),
        _ => None,
    }
}
```

- [ ] **Step 4: Export to the client.** In `server/src/export.rs` `export_defs`, after `dmg_types`, add:

```rust
    let light_kinds: serde_json::Map<_, _> =
        crate::defs::lights::LightKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let light_defs: serde_json::Map<_, _> = crate::defs::lights::LightKind::ALL
        .iter()
        .map(|k| ((*k as u8).to_string(), serde_json::to_value(crate::defs::lights::def(*k)).unwrap()))
        .collect();
```

Then extend the `format!` string with two more lines:

```rust
         export const LIGHT_KIND = {} as const;\n\n\
         export const LIGHT: Record<number, {{ radius: number; colour: number; intensity: number; flicker: number }}> = {};\n",
```

Move the closing `\n"` of the `DMG_TYPE` line accordingly, so the `DMG_TYPE` line ends with `\n\n\` like the others. Add `p(&json!(light_kinds)), p(&json!(light_defs)),` to the arguments.

- [ ] **Step 5: Run the tests.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release defs::lights export`. Expected: PASS. `client/src/generated/defs.ts` now contains `LIGHT_KIND` and `LIGHT`.

- [ ] **Step 6: Commit.**

```bash
git add server/src/defs/lights.rs server/src/defs/mod.rs server/src/export.rs client/src/generated/defs.ts
git commit -m "Lighting: light-kind table and entity lights, exported to the client"
```

### Task 2: Protocol and wire: light info, light events, moving lights

**Files:**
- Modify: `server/src/protocol.rs` (`LightInfo`, `MovingLight`, `RunStartInfo.lights`, `Ev::Light/LightAdd/LightRemove`, `Snapshot.lights`)
- Modify: `server/src/wire.rs` (`EV_CODES`, `EvW`, `LightW`, `SnapW`, samples, tests)
- Modify: `server/src/run/mod.rs` (`start_info`: `lights: Vec::new()` for now)
- Modify: `server/src/run/visibility.rs` (`Snapshot { lights: Vec::new(), .. }` for now)
- Modify: `client/src/wire.ts`, `client/src/wire.test.ts`
- Generated: `client/src/generated/*` (new `LightInfo.ts`, `MovingLight.ts`, `LightW.ts`; changed `Ev.ts`, `EvW.ts`, `SnapW.ts`, `Snapshot.ts`, `RunStartInfo.ts`, `defs.ts` (EV), `wire-fixtures.json`)

**Interfaces:**
- Consumes: nothing from Task 1 at the type level (colour is a plain `u32`).
- Produces:
  - `pub struct LightInfo(pub u32 /*id*/, pub u8 /*kind*/, pub u32 /*colour*/, pub u16 /*x*/, pub u16 /*y*/, pub bool /*on*/)`;
  - `pub struct MovingLight(pub f32 /*x*/, pub f32 /*y*/, pub u8 /*kind*/, pub Option<u32> /*colour, None = kind default*/)`;
  - `Ev::Light { id: u32, on: bool, colour: u32 }`;
  - `Ev::LightAdd { id: u32, kind: u8, colour: u32, x: u16, y: u16, on: bool }`;
  - `Ev::LightRemove { id: u32 }`;
  - `RunStartInfo.lights: Vec<LightInfo>`; `Snapshot.lights: Vec<MovingLight>`;
  - wire event codes 10, 11 and 12; `SnapW` gets a 9th field `Vec<LightW>`.
  - TS: `Snapshot.lights` is `Array<MovingLight>`, positions in px.

- [ ] **Step 1: Write the failing tests.**

  a. In `server/src/wire.rs` `sample_snapshots()`:
  - Add to the `busy.ev` vector:

```rust
            Ev::Light { id: 3, on: false, colour: 0xffaa5a },
            Ev::LightAdd { id: 400, kind: 1, colour: 0xff461e, x: 33, y: 71, on: true },
            Ev::LightRemove { id: 12 },
```

  - Add `lights: vec![MovingLight(100.3, 200.7, 2, None), MovingLight(55.0, 66.06, 3, Some(0x78c8ff))],` to `busy`, and `lights: vec![],` to `spectator`. Import `MovingLight` in the `use` line inside the function.
  - In `snapshot_is_a_bare_array_and_smaller`, change the assertion to `assert_eq!(new[0], 0x99, "fixarray of 9 fields");`.

  b. In `client/src/wire.test.ts`:
  - Extend the position regex to `/^(ents\.\d+\.[23]|ev\.\d+\.[xy]|drain\.\d+\.[01]|lights\.\d+\.[01])$/`.
  - In the test `keeps an exactly-left aim at +pi`, add a 9th element `[]` to the `unpackSnap([...])` array.
  - Add this test:

```ts
  it('unpacks moving lights with an optional colour', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, null, null];
    const snap = unpackSnap([1, 0, [], me, null, [], 0, null, [[160, 320, 2, null], [16, 32, 3, 0x78c8ff]]]);
    expect(snap.lights).toEqual([[10, 20, 2, null], [1, 2, 3, 0x78c8ff]]);
  });
```

- [ ] **Step 2: Run them to see them fail.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release wire`. Expected: compile errors (no `Ev::Light`, no `MovingLight`).

- [ ] **Step 3: Implement the server side.**

`server/src/protocol.rs`. Add after `RunStartInfo`:

```rust
/// A static light at run start, as an array: `[id, kind, colour, x, y, on]`
/// (tile coordinates; colour 0xRRGGBB; kind = `LightKind` id).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LightInfo(pub u32, pub u8, pub u32, pub u16, pub u16, pub bool);

/// A moving light near the viewer: `[x, y, kind, colour]` (px; colour `None` = the kind's default).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MovingLight(pub f32, pub f32, pub u8, pub Option<u32>);
```

Add the field `pub lights: Vec<LightInfo>,` to `RunStartInfo`, with the doc `/// Every static light (torches, lava) and its state.`

Add these variants to `Ev`, after `Sink`:

```rust
    /// A static light switched or recoloured; carries its current state.
    Light { id: u32, on: bool, colour: u32 },
    /// A static light created mid-run (tile coordinates).
    LightAdd { id: u32, kind: u8, colour: u32, x: u16, y: u16, on: bool },
    LightRemove { id: u32 },
```

Add to `Snapshot`, after `drain`:

```rust
    /// Moving lights whose light can reach the viewer's sight.
    pub lights: Vec<MovingLight>,
```

`server/src/wire.rs`:
- `EV_CODES` becomes `[&str; 13]`, with `"Light", "LightAdd", "LightRemove"` appended.
- `EvW` gets:

```rust
    Light(u8, u32, bool, u32),
    LightAdd(u8, u32, u8, u32, u16, u16, bool),
    LightRemove(u8, u32),
```

- `ev_w` gets:

```rust
        Ev::Light { id, on, colour } => EvW::Light(10, *id, *on, *colour),
        Ev::LightAdd { id, kind, colour, x, y, on } => EvW::LightAdd(11, *id, *kind, *colour, *x, *y, *on),
        Ev::LightRemove { id } => EvW::LightRemove(12, *id),
```

- Add:

```rust
/// `[x, y, kind, colour]`, positions scaled, see `MovingLight`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LightW(pub u32, pub u32, pub u8, pub Option<u32>);
```

- `SnapW` gets a 9th field `pub Vec<LightW>`. Update its doc to `[tick, ack, ents, me, boss, ev, srv_ms, drain, lights]`.
- In `encode_snap`:

```rust
    let lights = s.lights.iter().map(|l| LightW(q_pos(l.0 as f64), q_pos(l.1 as f64), l.2, l.3)).collect();
    let w = SnapW(s.tick, s.ack, ents, me, boss, s.ev.iter().map(ev_w).collect(), s.srv_ms, drain, lights);
```

`server/src/run/mod.rs` `start_info`: add `lights: Vec::new(),` (Task 4 fills it). `server/src/run/visibility.rs`: add `lights: Vec::new(),` to the `Snapshot { .. }` literal (Task 5 fills it).

- [ ] **Step 4: Run the server tests and regenerate.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release wire export`. Expected: PASS. `client/src/generated/` has the new and changed types and `wire-fixtures.json`.

- [ ] **Step 5: Implement the client side** in `client/src/wire.ts`.
- Add the import `import type { MovingLight } from './generated/MovingLight';`. Import `LightW` only if tsc needs it: unused imports fail the build.
- Add the tuple types and switch cases:

```ts
type LightEvW = [number, number, boolean, number];
type LightAddW = [number, number, number, number, number, number, boolean];
type LightRemoveW = [number, number];
```

```ts
    case EV.Light: {
      const [, id, on, colour] = e as LightEvW;
      return { t: 'Light', id, on, colour };
    }
    case EV.LightAdd: {
      const [, id, kind, colour, x, y, on] = e as LightAddW;
      return { t: 'LightAdd', id, kind, colour, x, y, on };
    }
    case EV.LightRemove: {
      const [, id] = e as LightRemoveW;
      return { t: 'LightRemove', id };
    }
```

- In `unpackSnap`, destructure `lights` as the 9th element and add to the result:

```ts
    lights: lights.map((l): MovingLight => [pos(l[0]), pos(l[1]), l[2], l[3]]),
```

- [ ] **Step 6: Run the client tests.** Run in `client/`: `npx vitest run src/wire.test.ts` and `npx tsc --noEmit`. Expected: PASS. If tsc reports `GameScene.onEvent` or other users of `Ev` as non-exhaustive, add empty `case 'Light': case 'LightAdd': case 'LightRemove': break;` there (Task 7 fills them).

- [ ] **Step 7: Commit.**

```bash
git add server/src/protocol.rs server/src/wire.rs server/src/run/mod.rs server/src/run/visibility.rs client/src/wire.ts client/src/wire.test.ts client/src/generated client/src/game/GameScene.ts
git commit -m "Lighting: protocol for static lights, light events and moving lights"
```

### Task 3: Light registry and static light map

**Files:**
- Create: `server/src/run/light.rs`
- Modify: `server/src/run/mod.rs` (`pub mod light;`, `Run.lights`, init in `Run::new`)

**Interfaces:**
- Consumes: `defs::lights::{def, Colour, LightKind}` (Task 1); `protocol::{Ev, LightInfo}` (Task 2); `fov::Fov`; `collision::line_of_sight(map, a: Vec2, b: Vec2) -> bool`.
- Produces (later tasks use exactly these):
  - `pub enum Anchor { Tile(i32, i32), Entity(u32) }`;
  - `pub struct LightSource { pub id: u32, pub kind: LightKind, pub colour: Colour, pub anchor: Anchor, pub on: bool }`;
  - `pub struct Lit { pub pos: Vec2, pub reach: f64, pub kind: LightKind, pub colour: Colour }`;
  - `pub struct Lights` with:
    - `new(w, h)`;
    - `push(kind, anchor, colour: Option<Colour>) -> u32`;
    - `get(id) -> Option<&LightSource>`;
    - `refresh(&mut self, map: &Map)`;
    - `static_lit(&self, x, y) -> bool`;
    - `mark_dirty()`;
    - `sources: Vec<LightSource>` (pub);
  - `pub fn reaches(map: &Map, l: &Lit, p: Vec2) -> bool`;
  - `impl Run`:
    - `add_light(kind, anchor, colour: Option<Colour>) -> u32`;
    - `set_light(id, on)`;
    - `set_light_colour(id, colour)`;
    - `remove_light(id)`;
    - `entity_pos(id) -> Option<Vec2>`;
    - `moving_lights(&self) -> Vec<Lit>`;
    - `is_lit(&mut self, p: Vec2) -> bool`;
    - `sweep_lights()`;
    - `light_infos(&self) -> Vec<LightInfo>`.

- [ ] **Step 1: Write the failing tests** at the bottom of the new `server/src/run/light.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::lights::LightKind;
    use crate::dungeon::{Map, Tile, TILE};
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;

    /// An open 15x9 floor patch around the hero, no lights at all.
    fn dark_run() -> (Run, i32, i32) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 4..=ty + 4 {
            for x in tx - 7..=tx + 7 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.lights = Lights::new(run.layout.map.w, run.layout.map.h);
        (run, tx, ty)
    }

    fn at(x: i32, y: i32) -> Vec2 {
        Map::center_of(x, y)
    }

    #[test]
    fn a_static_light_lights_its_radius_and_stops_at_walls() {
        let (mut run, tx, ty) = dark_run();
        assert!(!run.is_lit(at(tx, ty)), "dark to begin with");
        for y in ty - 4..=ty + 4 {
            run.layout.map.set(tx + 3, y, Tile::Wall);
        }
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(run.is_lit(at(tx, ty)));
        assert!(run.is_lit(at(tx - 5, ty)), "the edge of radius 5");
        assert!(!run.is_lit(at(tx - 6, ty)), "beyond it");
        assert!(run.is_lit(at(tx + 3, ty)), "the wall itself is lit");
        assert!(!run.is_lit(at(tx + 4, ty)), "behind the wall is dark");
    }

    #[test]
    fn switching_recolouring_and_removing_a_static_light() {
        let (mut run, tx, ty) = dark_run();
        run.step(); // past the start: changes are sent as events now
        run.events.clear();
        let id = run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(matches!(run.events[..], [(Ev::LightAdd { kind: 0, colour: 0xffaa5a, on: true, .. }, None)]));
        run.set_light(id, false);
        assert!(!run.is_lit(at(tx, ty)));
        run.set_light(id, true);
        assert!(run.is_lit(at(tx, ty)));
        run.set_light_colour(id, 0x3060ff);
        assert_eq!(run.lights.get(id).unwrap().colour, 0x3060ff);
        assert!(matches!(run.events.last(), Some((Ev::Light { on: true, colour: 0x3060ff, .. }, None))));
        let n = run.events.len();
        run.set_light(id, true);
        assert_eq!(run.events.len(), n, "no event when nothing changes");
        run.remove_light(id);
        assert!(!run.is_lit(at(tx, ty)));
        assert!(matches!(run.events.last(), Some((Ev::LightRemove { .. }, None))));
    }

    #[test]
    fn lights_added_at_start_send_no_event() {
        let (mut run, tx, ty) = dark_run();
        run.events.clear();
        assert_eq!(run.tick, 0);
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(run.events.is_empty(), "start lights go out in RunStartInfo");
        assert_eq!(run.light_infos().len(), 1);
    }

    #[test]
    fn a_moving_light_follows_its_entity_and_is_blocked_by_walls() {
        let (mut run, tx, ty) = dark_run();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::OrcWarrior, at(tx - 4, ty), None, 1);
        run.add_light(LightKind::Fire, Anchor::Entity(id), None);
        assert!(run.is_lit(at(tx - 4, ty)) && run.is_lit(at(tx - 2, ty)));
        assert!(!run.is_lit(at(tx + 2, ty)), "out of range");
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].pos = at(tx + 1, ty);
        assert!(run.is_lit(at(tx + 2, ty)), "it moved along");
        for y in ty - 4..=ty + 4 {
            run.layout.map.set(tx + 3, y, Tile::Wall);
        }
        assert!(!run.is_lit(at(tx + 4, ty)), "not through the wall");
        assert_eq!(run.moving_lights().len(), 1);
        assert!((run.moving_lights()[0].reach - 3.5 * TILE).abs() < 1e-9);
    }

    #[test]
    fn the_sweep_drops_lights_of_gone_entities() {
        let (mut run, tx, ty) = dark_run();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::OrcWarrior, at(tx - 4, ty), None, 1);
        run.add_light(LightKind::Fire, Anchor::Entity(id), None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].alive = false;
        run.step();
        assert!(run.lights.sources.is_empty());
    }

    #[test]
    fn a_light_keeps_its_kind_colour_unless_overridden() {
        let (mut run, tx, ty) = dark_run();
        let a = run.add_light(LightKind::Lava, Anchor::Tile(tx, ty), None);
        let b = run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), Some(0x50ff70));
        assert_eq!(run.lights.get(a).unwrap().colour, 0xff461e);
        assert_eq!(run.lights.get(b).unwrap().colour, 0x50ff70);
    }
}
```

- [ ] **Step 2: Run them to see them fail.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release run::light`. Expected: compile error (module missing).

- [ ] **Step 3: Implement** in `server/src/run/light.rs`, above the tests:

```rust
//! Light sources: one registry per run. Features add, switch, recolour and
//! remove lights only through `Run::add_light` and friends; `Run::is_lit`
//! answers "is this spot lit?" for visibility and, later, gameplay (the
//! shadow, the torch-extinguishing enemy). Static lights (anchored to a tile)
//! are baked into a per-tile map, rebuilt only after a change; moving lights
//! (anchored to an entity) are tested per query. The client mirrors the
//! static map for drawing (`client/src/game/light.ts`, shared fixtures).

use super::Run;
use crate::collision::line_of_sight;
use crate::defs::lights::{self, Colour, LightKind};
use crate::dungeon::{Map, TILE};
use crate::fov::Fov;
use crate::math::Vec2;
use crate::protocol::{Ev, LightInfo};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Anchor {
    /// Static: fixed on this tile.
    Tile(i32, i32),
    /// Moving: follows the entity with this id (any list), removed with it.
    Entity(u32),
}

#[derive(Debug, Clone)]
pub struct LightSource {
    pub id: u32,
    pub kind: LightKind,
    pub colour: Colour,
    pub anchor: Anchor,
    pub on: bool,
}

/// A lit moving light at its entity's position (for one query or snapshot).
#[derive(Debug, Clone, Copy)]
pub struct Lit {
    pub pos: Vec2,
    /// Reach in px.
    pub reach: f64,
    pub kind: LightKind,
    pub colour: Colour,
}

pub struct Lights {
    pub sources: Vec<LightSource>,
    next_id: u32,
    w: i32,
    h: i32,
    /// Static layer: tiles lit by at least one static light.
    lit: Vec<bool>,
    dirty: bool,
    fov: Fov,
}

impl Lights {
    pub fn new(w: i32, h: i32) -> Self {
        Lights { sources: Vec::new(), next_id: 1, w, h, lit: vec![false; (w * h) as usize], dirty: false, fov: Fov::new(w, h) }
    }

    /// Registers a light (on); light ids are separate from entity ids.
    pub fn push(&mut self, kind: LightKind, anchor: Anchor, colour: Option<Colour>) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        let colour = colour.unwrap_or(lights::def(kind).colour);
        self.sources.push(LightSource { id, kind, colour, anchor, on: true });
        if matches!(anchor, Anchor::Tile(..)) {
            self.dirty = true;
        }
        id
    }

    pub fn get(&self, id: u32) -> Option<&LightSource> {
        self.sources.iter().find(|s| s.id == id)
    }

    /// The map or a static light changed: rebuild on the next `refresh`.
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// Rebuilds the static layer if anything changed since the last call.
    pub fn refresh(&mut self, map: &Map) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        self.lit.iter_mut().for_each(|v| *v = false);
        for s in self.sources.iter().filter(|s| s.on) {
            let Anchor::Tile(x, y) = s.anchor else { continue };
            let r = lights::def(s.kind).radius;
            self.fov.compute(map, x, y, r);
            for ty in (y - r).max(0)..=(y + r).min(self.h - 1) {
                for tx in (x - r).max(0)..=(x + r).min(self.w - 1) {
                    if self.fov.is_visible(tx, ty) {
                        self.lit[(ty * self.w + tx) as usize] = true;
                    }
                }
            }
        }
    }

    /// The static layer (call `refresh` first).
    pub fn static_lit(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h && self.lit[(y * self.w + x) as usize]
    }
}

/// Does a moving light reach `p`: in range and in line of sight?
pub fn reaches(map: &Map, l: &Lit, p: Vec2) -> bool {
    l.pos.dist(p) <= l.reach && line_of_sight(map, l.pos, p)
}

impl Run {
    /// Adds a light (switched on). Static lights added after the start are
    /// announced with `Ev::LightAdd`; those added while the run is built go
    /// out in `RunStartInfo.lights` instead.
    pub fn add_light(&mut self, kind: LightKind, anchor: Anchor, colour: Option<Colour>) -> u32 {
        let id = self.lights.push(kind, anchor, colour);
        if let (Anchor::Tile(x, y), true) = (anchor, self.tick > 0) {
            let colour = self.lights.get(id).unwrap().colour;
            self.event(Ev::LightAdd { id, kind: kind as u8, colour, x: x as u16, y: y as u16, on: true }, None);
        }
        id
    }

    pub fn set_light(&mut self, id: u32, on: bool) {
        self.change_light(id, |s| s.on = on);
    }

    pub fn set_light_colour(&mut self, id: u32, colour: Colour) {
        self.change_light(id, |s| s.colour = colour);
    }

    fn change_light(&mut self, id: u32, f: impl FnOnce(&mut LightSource)) {
        let Some(s) = self.lights.sources.iter_mut().find(|s| s.id == id) else { return };
        let before = (s.on, s.colour);
        f(s);
        let (on, colour, anchor) = (s.on, s.colour, s.anchor);
        if (on, colour) == before || !matches!(anchor, Anchor::Tile(..)) {
            return;
        }
        self.lights.mark_dirty();
        self.event(Ev::Light { id, on, colour }, None);
    }

    pub fn remove_light(&mut self, id: u32) {
        let Some(i) = self.lights.sources.iter().position(|s| s.id == id) else { return };
        let s = self.lights.sources.remove(i);
        if matches!(s.anchor, Anchor::Tile(..)) {
            self.lights.mark_dirty();
            self.event(Ev::LightRemove { id }, None);
        }
    }

    /// Where an entity is, if it still exists (any list).
    pub fn entity_pos(&self, id: u32) -> Option<Vec2> {
        self.players.iter().find(|p| p.id == id && p.alive).map(|p| p.pos())
            .or_else(|| self.monsters.iter().find(|m| m.id == id && m.alive).map(|m| m.pos))
            .or_else(|| self.projectiles.iter().find(|p| p.id == id && !p.dead).map(|p| p.pos))
            .or_else(|| self.hazards.iter().find(|h| h.id == id && h.life > 0.0).map(|h| h.pos))
            .or_else(|| self.objects.iter().find(|o| o.id == id && !o.gone).map(|o| o.pos))
    }

    /// Every lit moving light at its entity's current position.
    pub fn moving_lights(&self) -> Vec<Lit> {
        self.lights
            .sources
            .iter()
            .filter(|s| s.on)
            .filter_map(|s| {
                let Anchor::Entity(e) = s.anchor else { return None };
                let pos = self.entity_pos(e)?;
                let reach = (lights::def(s.kind).radius as f64 + 0.5) * TILE;
                Some(Lit { pos, reach, kind: s.kind, colour: s.colour })
            })
            .collect()
    }

    /// Is this spot lit by any light? (Static layer or a moving light in reach.)
    pub fn is_lit(&mut self, p: Vec2) -> bool {
        self.lights.refresh(&self.layout.map);
        let (x, y) = Map::tile_of(p);
        self.lights.static_lit(x, y) || self.moving_lights().iter().any(|l| reaches(&self.layout.map, l, p))
    }

    /// Drops moving lights whose entity is gone (after the step's clean-up).
    pub fn sweep_lights(&mut self) {
        let gone: Vec<u32> = self
            .lights
            .sources
            .iter()
            .filter_map(|s| match s.anchor {
                Anchor::Entity(e) if self.entity_pos(e).is_none() => Some(s.id),
                _ => None,
            })
            .collect();
        self.lights.sources.retain(|s| !gone.contains(&s.id));
    }

    /// The static lights for `RunStartInfo`.
    pub fn light_infos(&self) -> Vec<LightInfo> {
        self.lights
            .sources
            .iter()
            .filter_map(|s| match s.anchor {
                Anchor::Tile(x, y) => Some(LightInfo(s.id, s.kind as u8, s.colour, x as u16, y as u16, s.on)),
                Anchor::Entity(_) => None,
            })
            .collect()
    }
}
```

In `server/src/run/mod.rs`:
- add `pub mod light;` (alphabetical, after `levels`);
- add the field `pub lights: light::Lights,` to `Run` (after `objects`);
- initialise it in `Run::new` with `lights: light::Lights::new(w, h),`;
- in `step()`, right after `self.objects.retain(|o| !o.gone);`, add `self.sweep_lights();`.

- [ ] **Step 4: Run the tests.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release run::light`. Expected: PASS. Then run the whole suite: `docker compose -f docker-compose.test.yml run --rm test`. Expected: all pass. The fingerprints are unchanged, because no light exists yet.

- [ ] **Step 5: Commit.**

```bash
git add server/src/run/light.rs server/src/run/mod.rs
git commit -m "Lighting: light registry, static light map and is_lit"
```

### Task 4: First server users: shot and hazard lights, lava lights, start info, tile changes

**Files:**
- Modify: `server/src/run/light.rs` (`attach_kind_light`, `add_lava_lights`, `set_tile`, tests)
- Modify: `server/src/run/abilities.rs` (`spawn_player_projectile`, `spawn_monster_projectile`)
- Modify: `server/src/run/mod.rs` (`spawn_hazard`, `Run::new`, `start_info`)
- Modify: `server/src/run/levels/boss.rs` (door closing through `set_tile`)

**Interfaces:**
- Consumes: Task 3 (`add_light`, `remove_light`, `Anchor`, `light_infos`, `sweep_lights`); Task 1 (`kind_light`).
- Produces:
  - `Run::attach_kind_light(&mut self, id: u32, kind: EntityKind)`;
  - `Run::add_lava_lights(&mut self)`;
  - `Run::set_tile(&mut self, x: i32, y: i32, t: Tile)`, which sets the tile, emits `Ev::Tile`, keeps the lava lights and marks the light map dirty.

- [ ] **Step 1: Write the failing tests** (append to the `tests` module in `run/light.rs`):

```rust
    #[test]
    fn a_fire_bolt_carries_a_light_and_an_arrow_does_not() {
        let (mut run, tx, ty) = dark_run();
        let from = at(tx - 6, ty);
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, from, Vec2::new(1.0, 0.0), 60.0, 5.0, 3.0, 0.0, 0, 0.0);
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, from, Vec2::new(1.0, 0.0), 60.0, 5.0, 3.0, 0.0, 0, 0.0);
        assert_eq!(run.moving_lights().len(), 1);
        assert_eq!(run.moving_lights()[0].kind, LightKind::Fire);
        assert!(run.is_lit(from));
    }

    #[test]
    fn a_shot_that_dies_at_once_leaves_no_light() {
        let (mut run, tx, ty) = dark_run();
        run.layout.map.set(tx + 1, ty, Tile::Wall);
        let from = at(tx, ty);
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, from, Vec2::new(1.0, 0.0), 600.0, 5.0, 3.0, 0.0, 0, 0.0);
        run.step();
        run.step();
        assert!(run.lights.sources.iter().all(|s| !matches!(s.anchor, Anchor::Entity(_))));
    }

    #[test]
    fn fire_patches_glow() {
        let (mut run, tx, ty) = dark_run();
        run.spawn_hazard(EntityKind::FirePatch, at(tx, ty), 10.0, 3.0, 8.0);
        assert!(run.is_lit(at(tx + 2, ty)));
    }

    #[test]
    fn lava_lights_its_neighbours_and_is_in_the_start_info() {
        let (mut run, tx, ty) = dark_run();
        run.layout.map.set(tx, ty, Tile::Lava);
        run.add_lava_lights();
        assert!(run.is_lit(at(tx, ty)) && run.is_lit(at(tx + 1, ty)));
        assert!(!run.is_lit(at(tx + 2, ty)));
        let infos = run.light_infos();
        assert!(infos.iter().any(|l| (l.1, l.3, l.4) == (LightKind::Lava as u8, tx as u16, ty as u16)));
    }

    #[test]
    fn dungeon_lava_is_lit_from_the_start() {
        let run = crate::run::tests::test_run(&[ClassId::Paladin], BossId::Demon); // lava theme
        let lava = run.layout.map.tiles.iter().filter(|&&t| t == Tile::Lava as u8).count();
        assert!(lava > 0);
        let lights = run.lights.sources.iter().filter(|s| s.kind == LightKind::Lava).count();
        assert_eq!(lights, lava);
        assert!(matches!(run.start_info(&run.players[0]), crate::protocol::ServerMsg::RunStarted(i) if i.lights.len() >= lava));
    }

    #[test]
    fn set_tile_keeps_lava_lights_in_step() {
        let (mut run, tx, ty) = dark_run();
        run.step();
        run.events.clear();
        run.set_tile(tx, ty, Tile::Lava);
        assert!(run.is_lit(at(tx, ty)));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Tile { .. })));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::LightAdd { .. })));
        run.set_tile(tx, ty, Tile::Floor);
        assert!(!run.is_lit(at(tx, ty)));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::LightRemove { .. })));
    }

    #[test]
    fn a_closed_door_blocks_static_light() {
        let (mut run, tx, ty) = dark_run();
        for y in ty - 4..=ty + 4 {
            if y != ty {
                run.layout.map.set(tx + 1, y, Tile::Wall);
            }
        }
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(run.is_lit(at(tx + 3, ty)), "through the gap");
        run.set_tile(tx + 1, ty, Tile::DoorClosed);
        assert!(!run.is_lit(at(tx + 3, ty)), "the door shuts the light in");
    }
```

Add `use crate::defs::kinds::EntityKind;` to the test module's imports.

- [ ] **Step 2: Run them to see them fail.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release run::light`. Expected: compile errors (`add_lava_lights`, `set_tile` missing) or assertion failures.

- [ ] **Step 3: Implement.** Add to the `impl Run` block in `run/light.rs`:

```rust
    /// The light an entity of this kind carries (`defs::lights::kind_light`).
    pub fn attach_kind_light(&mut self, id: u32, kind: crate::defs::kinds::EntityKind) {
        if let Some((k, colour)) = lights::kind_light(kind) {
            self.add_light(k, Anchor::Entity(id), colour);
        }
    }

    /// A static `Lava` light on every lava tile (run start).
    pub fn add_lava_lights(&mut self) {
        let m = &self.layout.map;
        let lava: Vec<(i32, i32)> = (0..m.h).flat_map(|y| (0..m.w).map(move |x| (x, y))).filter(|&(x, y)| m.get(x, y) == crate::dungeon::Tile::Lava as u8).collect();
        for (x, y) in lava {
            self.add_light(LightKind::Lava, Anchor::Tile(x, y), None);
        }
    }

    /// Changes a tile during the run: sends `Ev::Tile`, keeps lava lights in step
    /// and rebuilds the light map (a door or wall changes what light reaches).
    pub fn set_tile(&mut self, x: i32, y: i32, t: crate::dungeon::Tile) {
        use crate::dungeon::Tile;
        let was_lava = self.layout.map.get(x, y) == Tile::Lava as u8;
        self.layout.map.set(x, y, t);
        self.event(Ev::Tile { x: x as u16, y: y as u16, v: t as u8 }, None);
        let lava_light = self.lights.sources.iter().find(|s| s.kind == LightKind::Lava && s.anchor == Anchor::Tile(x, y)).map(|s| s.id);
        match (was_lava, t == Tile::Lava, lava_light) {
            (true, false, Some(id)) => self.remove_light(id),
            (false, true, None) => {
                self.add_light(LightKind::Lava, Anchor::Tile(x, y), None);
            }
            _ => {}
        }
        self.lights.mark_dirty();
    }
```

Wire it in:
- `run/abilities.rs`:
  - in `spawn_player_projectile`, after `run.projectiles.push(Projectile { .. });` and **before** `advance_projectile(run, i, ff)`, add `run.attach_kind_light(id, kind);`;
  - in `spawn_monster_projectile`, after the push, add `run.attach_kind_light(id, kind);`.
- `run/mod.rs` `spawn_hazard`: after the push, add `self.attach_kind_light(id, kind);`.
- `run/mod.rs` `Run::new`: after the barrel loop (before `run`), add:

```rust
        // Lava glows from the start (light ids are separate from entity ids).
        run.add_lava_lights();
```

- `run/mod.rs` `start_info`: replace `lights: Vec::new(),` with `lights: self.light_infos(),`.
- `run/levels/boss.rs`: replace the two lines inside the door loop (`run.layout.map.set(..)` and `run.event(Ev::Tile ..)`) with `run.set_tile(x, y, Tile::DoorClosed);`. Remove `Ev` from that file's imports if it becomes unused (it is still used for `Ev::Msg`/`Ev::Immune`, so probably not).

- [ ] **Step 4: Run all server tests.** Run: `docker compose -f docker-compose.test.yml run --rm test`. Expected: all pass, the fingerprint tests included (lights don't touch entities or ids; the fingerprint does not read `run.lights`).

- [ ] **Step 5: Commit.**

```bash
git add server/src/run/light.rs server/src/run/abilities.rs server/src/run/mod.rs server/src/run/levels/boss.rs
git commit -m "Lighting: shots, fire patches and lava carry lights; tile changes keep the light map in step"
```

### Task 5: Visibility: in sight and lit

**Files:**
- Modify: `server/src/run/visibility.rs`
- Modify: `server/src/run/mod.rs` (`Run.on_hero`, `event_on_hero`, used by `hurt_player` and `heal_player`)

**Interfaces:**
- Consumes: Task 3 (`Lights::refresh`, `static_lit`, `Lit`, `reaches`, `moving_lights`).
- Produces:
  - `fn seen(fov: &Fov, lights: &Lights, moving: &[Lit], map: &Map, p: Vec2, radius: f64) -> bool`;
  - `fn ev_seen(fov, lights, moving, map, at: Option<Vec2>, on_hero: bool) -> bool`;
  - `fn lights_for(view: Vec2, moving: &[Lit]) -> Vec<MovingLight>`;
  - `Run::event_on_hero(&mut self, ev: Ev, pos: Vec2)`;
  - `Run.on_hero: Vec<usize>` (indices into `events`).
  - Task 9 adds the torch rule to the object loop.

- [ ] **Step 1: Write the failing tests** (in `visibility.rs` tests):

```rust
    use crate::defs::lights::LightKind;
    use crate::run::light::{Anchor, Lights};

    /// Hero on open floor, no lights, FOV computed; returns the hero's tile.
    fn dark_view(run: &mut Run) -> (i32, i32) {
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 4..=ty + 4 {
            for x in tx - 7..=tx + 7 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        run.lights = Lights::new(run.layout.map.w, run.layout.map.h);
        run.players[0].fov.compute(&run.layout.map, tx, ty, PLAYER_FOV_RADIUS);
        (tx, ty)
    }

    fn sees(run: &mut Run, p: Vec2, r: f64) -> bool {
        run.lights.refresh(&run.layout.map);
        let moving = run.moving_lights();
        seen(&run.players[0].fov, &run.lights, &moving, &run.layout.map, p, r)
    }

    #[test]
    fn a_monster_in_the_dark_is_hidden_until_lit() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run);
        let p = Map::center_of(tx + 4, ty);
        assert!(!sees(&mut run, p, 6.0), "in sight but dark");
        let torch = run.add_light(LightKind::Torch, Anchor::Tile(tx + 5, ty), None);
        assert!(sees(&mut run, p, 6.0), "lit by the torch");
        run.set_light(torch, false);
        assert!(!sees(&mut run, p, 6.0), "dark again");
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, Map::center_of(tx + 3, ty), Vec2::new(0.0, 1.0), 1.0, 1.0, 3.0, 0.0, 0, 0.0);
        assert!(sees(&mut run, p, 6.0), "a fire bolt lights it");
    }

    #[test]
    fn hero_events_are_sent_in_the_dark_monster_events_are_not() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run);
        run.lights.refresh(&run.layout.map);
        let fov = &run.players[0].fov;
        let near = Some(Map::center_of(tx + 2, ty));
        assert!(ev_seen(fov, &run.lights, &[], &run.layout.map, near, true), "on a hero: sight is enough");
        assert!(!ev_seen(fov, &run.lights, &[], &run.layout.map, near, false), "elsewhere: it must be lit");
        assert!(ev_seen(fov, &run.lights, &[], &run.layout.map, None, false), "party-wide events always");
    }

    #[test]
    fn hurt_and_heal_on_a_hero_are_marked_as_hero_events() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.events.clear();
        run.on_hero.clear();
        run.hurt_player(0, crate::defs::damage::Damage::physical(5.0));
        run.heal_player(0, 3.0);
        assert_eq!(run.on_hero, vec![0, 1]);
    }

    #[test]
    fn moving_lights_near_the_viewer_are_listed_with_their_colour_only_when_custom() {
        let view = Vec2::new(100.0, 100.0);
        let fire = Lit { pos: view + Vec2::new(40.0, 0.0), reach: 56.0, kind: LightKind::Fire, colour: 0xff8c3c };
        let frost = Lit { pos: view + Vec2::new(0.0, 30.0), reach: 40.0, kind: LightKind::Magic, colour: 0x78c8ff };
        let far = Lit { pos: view + Vec2::new(2000.0, 0.0), reach: 56.0, kind: LightKind::Fire, colour: 0xff8c3c };
        let out = lights_for(view, &[fire, frost, far]);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].2, out[0].3), (LightKind::Fire as u8, None));
        assert_eq!((out[1].2, out[1].3), (LightKind::Magic as u8, Some(0x78c8ff)));
    }
```

Add `use crate::run::light::Lit;` and `use crate::defs::kinds::EntityKind;` to the test imports if they are not already in scope via `super::*`.

- [ ] **Step 2: Run them to see them fail.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release visibility`. Expected: compile errors (`seen`, `ev_seen`, `lights_for`, `on_hero` missing).

- [ ] **Step 3: Implement.**

`run/mod.rs`:
- Add the field `pub on_hero: Vec<usize>,` to `Run`, with the doc `/// Indices into \`events\` of events on a hero: sent wherever the hero is in sight, lit or not.`
- Initialise it with `on_hero: Vec::new(),`.
- Add the method:

```rust
    /// An event on a hero (their damage or healing): seen wherever the hero is
    /// in sight, even in the dark (heroes are always drawn).
    pub fn event_on_hero(&mut self, ev: Ev, pos: Vec2) {
        self.on_hero.push(self.events.len());
        self.event(ev, Some(pos));
    }
```

- In `hurt_player`, change `self.event(Ev::Dmg { .. p: true .. }, Some(pos));` to `self.event_on_hero(Ev::Dmg { .. }, pos);`.
- In `heal_player`, change `self.event(Ev::Heal { .. }, Some(pos));` to `self.event_on_hero(Ev::Heal { .. }, pos);`.

`run/visibility.rs`. Add the helpers, keeping `visible` (still used for the drain and the FOV-only rule):

```rust
use crate::defs::lights;
use crate::dungeon::TILE;
use crate::protocol::MovingLight;
use crate::run::light::{reaches, Lights, Lit};

/// Lit by the static layer or a moving light.
fn lit(lights: &Lights, moving: &[Lit], map: &Map, p: Vec2) -> bool {
    let (x, y) = Map::tile_of(p);
    lights.static_lit(x, y) || moving.iter().any(|l| reaches(map, l, p))
}

/// In the viewer's sight and lit (large figures: any part of them).
fn seen(fov: &Fov, lights: &Lights, moving: &[Lit], map: &Map, p: Vec2, radius: f64) -> bool {
    let at = |q: Vec2| {
        let (x, y) = Map::tile_of(q);
        fov.is_visible(x, y) && lit(lights, moving, map, q)
    };
    if at(p) {
        return true;
    }
    if radius > 8.0 {
        let r = radius * 0.8;
        return [(-r, -r), (r, -r), (-r, r), (r, r)].into_iter().any(|(dx, dy)| at(p + Vec2::new(dx, dy)));
    }
    false
}

/// Events: party-wide ones always; events on a hero where the hero is in
/// sight; the rest where they are seen (in sight and lit).
fn ev_seen(fov: &Fov, lights: &Lights, moving: &[Lit], map: &Map, at: Option<Vec2>, on_hero: bool) -> bool {
    match at {
        None => true,
        Some(p) if on_hero => visible(fov, p, 0.0),
        Some(p) => seen(fov, lights, moving, map, p, 0.0),
    }
}

/// Moving lights whose light can reach the viewer's sight; the colour only
/// when it is not the kind's default.
fn lights_for(view: Vec2, moving: &[Lit]) -> Vec<MovingLight> {
    let range = (PLAYER_FOV_RADIUS as f64 + 1.0) * TILE;
    moving
        .iter()
        .filter(|l| l.pos.dist(view) <= range + l.reach)
        .map(|l| MovingLight(l.pos.x as f32, l.pos.y as f32, l.kind as u8, (l.colour != lights::def(l.kind).colour).then_some(l.colour)))
        .collect()
}
```

In `send_snapshots`:
- At the top, after `let events = std::mem::take(&mut run.events);`, add:

```rust
    let on_hero = std::mem::take(&mut run.on_hero);
    run.lights.refresh(&run.layout.map);
    let moving = run.moving_lights();
```

- Inside the per-player loop, let `map = &run.layout.map; let lights = &run.lights;` and replace:
  - monsters: `!visible(&fov, m.pos, m.radius)` → `!seen(&fov, lights, &moving, map, m.pos, m.radius)`;
  - projectiles: `visible(&fov, pr.pos, 0.0)` → `seen(&fov, lights, &moving, map, pr.pos, 0.0)` (keep `pr.from_player ||`);
  - objects: `!visible(&fov, o.pos, 0.0)` → `!seen(&fov, lights, &moving, map, o.pos, 0.0)`;
  - hazards: `!visible(&fov, h.pos, h.radius)` → `!seen(&fov, lights, &moving, map, h.pos, h.radius)`;
  - events:

```rust
        let ev: Vec<Ev> = events
            .iter()
            .enumerate()
            .filter(|(i, (_, at))| ev_seen(&fov, lights, &moving, map, *at, on_hero.contains(i)))
            .map(|(_, (e, _))| e.clone())
            .collect();
```

  - drain: `drain_for` keeps its signature (FOV-only, boss-fight rule). Note in its doc that the beams are magic light and show in the dark.
  - the `Snapshot` literal: `lights: lights_for(view_pos, &moving),`.
- Update the module doc to: "Each player only receives monsters, enemy projectiles, objects, hazards and positional events that are inside their own field of vision **and lit** (`run/light.rs`). Always sent: the party, their own shots, party-wide events; events on a hero need sight only."

Borrow note: `run.players[pi].fov` is swapped out with `mem::replace`, as today, so `run` can still be borrowed immutably for `lights` and `map` inside the loop. Take `let me = &run.players[pi];` after the filters, as today.

- [ ] **Step 4: Run all server tests.** Run: `docker compose -f docker-compose.test.yml run --rm test`. Expected: all pass. `monsters_outside_fov_are_not_sent` still uses `visible` and passes unchanged.

- [ ] **Step 5: Commit.**

```bash
git add server/src/run/visibility.rs server/src/run/mod.rs
git commit -m "Lighting: snapshots send only what is in sight and lit; hero events need sight only"
```

---

## Stage B: client core

### Task 6: Client light field (static map, colour mixing) with shared fixtures

**Files:**
- Create: `client/src/game/light.ts`, `client/src/game/light.test.ts`
- Modify: `server/src/export.rs` (`export_fixtures`: a `lights` case)
- Generated: `client/src/generated/fixtures.json`

**Interfaces:**
- Consumes:
  - `LIGHT` from `generated/defs` (Task 1);
  - `LightInfo` tuple `[id, kind, colour, x, y, on]` (Task 2);
  - `Fov` from `sim/fov.ts` (`compute(map, cx, cy, radius)`, `isVisible(x, y)`);
  - `TileMap` from `sim/map.ts` (`w`, `h`, `get`, `opaque`).
- Produces:
  - `export interface StaticLight { id: number; kind: number; colour: number; x: number; y: number; on: boolean }`;
  - `export function falloff(d: number, r: number): number`;
  - `export function addColour(rgb: Float32Array, i: number, colour: number, k: number): void`;
  - `export class LightField`:
    - `constructor(map: TileMap)`;
    - `load(infos: LightInfo[])`;
    - `add(l: StaticLight)`; `set(id, on, colour)`; `remove(id)`;
    - `mapChanged()`;
    - `isLit(x, y): boolean`;
    - `accumulate(rgb: Float32Array, x0: number, y0: number, x1: number, y1: number, scale: (l: StaticLight) => number): void`;
    - `addMoving(rgb: Float32Array, lit: Uint8Array, px: number, py: number, kind: number, colour: number, k: number, tile: number): void` (`tile` = the tile size in px, so the module needs no Phaser).

- [ ] **Step 1: Export the fixture.** In `server/src/export.rs` `export_fixtures`, after the FOV loop, add a light case on `fixture_map()`: three torches, plus a lava light on every lava tile. Put `"lights": light_case` into `doc`.

```rust
    use crate::defs::lights::LightKind;
    use crate::run::light::{Anchor, Lights};
    let mut lights = Lights::new(map.w, map.h);
    for (x, y) in [(3, 3), (8, 8), (15, 12)] {
        lights.push(LightKind::Torch, Anchor::Tile(x, y), None);
    }
    for y in 0..map.h {
        for x in 0..map.w {
            if map.get(x, y) == Tile::Lava as u8 {
                lights.push(LightKind::Lava, Anchor::Tile(x, y), None);
            }
        }
    }
    lights.refresh(&map);
    let lit: Vec<i32> = (0..map.w * map.h).filter(|i| lights.static_lit(i % map.w, i / map.w)).collect();
    let srcs: Vec<serde_json::Value> = lights.sources.iter().map(|s| match s.anchor {
        Anchor::Tile(x, y) => json!([s.id, s.kind as u8, s.colour, x, y, true]),
        Anchor::Entity(_) => unreachable!(),
    }).collect();
    let light_case = json!({ "sources": srcs, "lit": lit });
```

Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release export`. Expected: PASS. `fixtures.json` has `lights`.

- [ ] **Step 2: Write the failing tests** in `client/src/game/light.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fixtures from '../generated/fixtures.json';
import { LIGHT, LIGHT_KIND, TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { addColour, falloff, LightField } from './light';
import type { LightInfo } from '../generated/LightInfo';

const fmap = () => new TileMap(fixtures.w, fixtures.h, Uint8Array.from(fixtures.tiles));

describe('light field', () => {
  it('lights exactly the tiles the server lights', () => {
    const f = new LightField(fmap());
    f.load(fixtures.lights.sources as LightInfo[]);
    const lit: number[] = [];
    for (let y = 0; y < fixtures.h; y++) for (let x = 0; x < fixtures.w; x++) if (f.isLit(x, y)) lit.push(y * fixtures.w + x);
    expect(lit).toEqual(fixtures.lights.lit);
  });

  it('switches, recolours, removes and follows map changes', () => {
    const m = new TileMap(9, 3, new Uint8Array(27).fill(TILE_ID.Floor));
    const f = new LightField(m);
    f.add({ id: 1, kind: LIGHT_KIND.Torch, colour: 0xffaa5a, x: 1, y: 1, on: true });
    expect(f.isLit(5, 1)).toBe(true);
    f.set(1, false, 0xffaa5a);
    expect(f.isLit(5, 1)).toBe(false);
    f.set(1, true, 0x3060ff);
    expect(f.lights.get(1)!.colour).toBe(0x3060ff);
    m.set(3, 1, TILE_ID.Wall);
    m.set(3, 0, TILE_ID.Wall);
    m.set(3, 2, TILE_ID.Wall);
    f.mapChanged();
    expect(f.isLit(5, 1)).toBe(false);
    f.remove(1);
    expect(f.isLit(1, 1)).toBe(false);
  });

  it('adds overlapping colours per channel', () => {
    const rgb = new Float32Array(3);
    addColour(rgb, 0, 0xff0000, 1);
    addColour(rgb, 0, 0x0000ff, 1);
    expect(Array.from(rgb)).toEqual([255, 0, 255]); // red + blue = purple
    addColour(rgb, 0, 0xff8000, 1);
    expect(Math.min(255, rgb[0])).toBe(255); // capped by the drawer
    expect(rgb[1]).toBe(128);
  });

  it('accumulates a torch and lava on one tile into an orange', () => {
    const m = new TileMap(5, 1, new Uint8Array(5).fill(TILE_ID.Floor));
    m.set(4, 0, TILE_ID.Lava);
    const f = new LightField(m);
    f.add({ id: 1, kind: LIGHT_KIND.Torch, colour: LIGHT[LIGHT_KIND.Torch].colour, x: 0, y: 0, on: true });
    f.add({ id: 2, kind: LIGHT_KIND.Lava, colour: LIGHT[LIGHT_KIND.Lava].colour, x: 4, y: 0, on: true });
    const rgb = new Float32Array(5 * 3);
    f.accumulate(rgb, 0, 0, 5, 1, () => 1);
    const i = 3; // reached by both
    expect(rgb[i * 3]).toBeGreaterThan(rgb[i * 3 + 1]);
    expect(rgb[i * 3 + 1]).toBeGreaterThan(rgb[i * 3 + 2]);
    expect(rgb[i * 3]).toBeGreaterThan(rgb[1 * 3]); // more red than the torch alone near it
  });

  it('falls off from 1 at the centre to 0.45 at the edge', () => {
    expect(falloff(0, 5)).toBe(1);
    expect(falloff(5, 5)).toBeCloseTo(0.45);
    expect(falloff(9, 5)).toBeCloseTo(0.45);
  });
});
```

- [ ] **Step 3: Run them to see them fail.** Run in `client/`: `npx vitest run src/game/light.test.ts`. Expected: FAIL (module `./light` missing).

- [ ] **Step 4: Implement** `client/src/game/light.ts`:

```ts
// Light sources for drawing. The static light map uses the same shadowcast as
// server/src/run/light.rs (checked by fixtures), so a tile the server counts
// as lit is never drawn dark. Colours mix additively. Knows nothing about
// torches or lava: only light kinds, colours and tiles.
import { LIGHT } from '../generated/defs';
import type { LightInfo } from '../generated/LightInfo';
import { Fov } from '../sim/fov';
import type { TileMap } from '../sim/map';

export interface StaticLight {
  id: number;
  kind: number;
  colour: number;
  /** Tile coordinates. */
  x: number;
  y: number;
  on: boolean;
}

interface Cells {
  idx: Int32Array;
  fall: Float32Array;
}

/** Brightness at distance `d` (tiles) from a light of radius `r`: 1 at the centre, 0.45 at the edge. */
export function falloff(d: number, r: number): number {
  const k = Math.min(1, d / r);
  return 1 - 0.55 * k * k;
}

/** Adds `colour` (0xRRGGBB) times `k` to tile `i` of an rgb buffer (no cap: the drawer caps at 255). */
export function addColour(rgb: Float32Array, i: number, colour: number, k: number): void {
  rgb[i * 3] += ((colour >> 16) & 255) * k;
  rgb[i * 3 + 1] += ((colour >> 8) & 255) * k;
  rgb[i * 3 + 2] += (colour & 255) * k;
}

export class LightField {
  readonly lights = new Map<number, StaticLight>();
  private cells = new Map<number, Cells>();
  private fov: Fov;
  private lit: Uint8Array;
  private litDirty = true;

  constructor(private map: TileMap) {
    this.fov = new Fov(map.w, map.h);
    this.lit = new Uint8Array(map.w * map.h);
  }

  load(infos: LightInfo[]): void {
    for (const [id, kind, colour, x, y, on] of infos) this.add({ id, kind, colour, x, y, on });
  }

  add(l: StaticLight): void {
    this.lights.set(l.id, { ...l });
    this.cells.delete(l.id);
    this.litDirty = true;
  }

  set(id: number, on: boolean, colour: number): void {
    const l = this.lights.get(id);
    if (!l) return;
    l.on = on;
    l.colour = colour;
    this.litDirty = true;
  }

  remove(id: number): void {
    this.lights.delete(id);
    this.cells.delete(id);
    this.litDirty = true;
  }

  /** A tile changed (door, lava): every shadowcast is redone lazily. */
  mapChanged(): void {
    this.cells.clear();
    this.litDirty = true;
  }

  private cellsOf(l: StaticLight): Cells {
    let c = this.cells.get(l.id);
    if (c) return c;
    const r = LIGHT[l.kind].radius;
    this.fov.compute(this.map, l.x, l.y, r);
    const idx: number[] = [];
    const fall: number[] = [];
    for (let y = Math.max(0, l.y - r); y <= Math.min(this.map.h - 1, l.y + r); y++)
      for (let x = Math.max(0, l.x - r); x <= Math.min(this.map.w - 1, l.x + r); x++)
        if (this.fov.isVisible(x, y)) {
          idx.push(y * this.map.w + x);
          fall.push(falloff(Math.hypot(x - l.x, y - l.y), r));
        }
    c = { idx: Int32Array.from(idx), fall: Float32Array.from(fall) };
    this.cells.set(l.id, c);
    return c;
  }

  /** Lit by a static light (same set as the server's static layer). */
  isLit(x: number, y: number): boolean {
    if (this.litDirty) {
      this.lit.fill(0);
      for (const l of this.lights.values()) if (l.on) for (const i of this.cellsOf(l).idx) this.lit[i] = 1;
      this.litDirty = false;
    }
    return x >= 0 && y >= 0 && x < this.map.w && y < this.map.h && this.lit[y * this.map.w + x] === 1;
  }

  /** Adds every lit static light's colour into `rgb` (w*h*3) inside the tile window [x0,x1)×[y0,y1). */
  accumulate(rgb: Float32Array, x0: number, y0: number, x1: number, y1: number, scale: (l: StaticLight) => number): void {
    const w = this.map.w;
    for (const l of this.lights.values()) {
      if (!l.on) continue;
      const r = LIGHT[l.kind].radius;
      if (l.x + r < x0 || l.x - r >= x1 || l.y + r < y0 || l.y - r >= y1) continue;
      const k = LIGHT[l.kind].intensity * scale(l);
      const c = this.cellsOf(l);
      for (let j = 0; j < c.idx.length; j++) {
        const i = c.idx[j];
        const x = i % w;
        const y = (i - x) / w;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) addColour(rgb, i, l.colour, k * c.fall[j]);
      }
    }
  }

  /** A moving light at pixel position (px, py): shadowcast from its tile, colour into `rgb`, lit tiles marked in `lit`. */
  addMoving(rgb: Float32Array, lit: Uint8Array, px: number, py: number, kind: number, colour: number, k: number, tile: number): void {
    const r = LIGHT[kind].radius;
    const cx = Math.floor(px / tile);
    const cy = Math.floor(py / tile);
    this.fov.compute(this.map, cx, cy, r);
    for (let y = Math.max(0, cy - r); y <= Math.min(this.map.h - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(this.map.w - 1, cx + r); x++) {
        if (!this.fov.isVisible(x, y)) continue;
        const i = y * this.map.w + x;
        lit[i] = 1;
        const d = Math.hypot(x + 0.5 - px / tile, y + 0.5 - py / tile);
        addColour(rgb, i, colour, LIGHT[kind].intensity * k * falloff(d, r));
      }
  }
}
```

- [ ] **Step 5: Run the tests.** Run in `client/`: `npx vitest run src/game/light.test.ts` and `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add client/src/game/light.ts client/src/game/light.test.ts server/src/export.rs client/src/generated/fixtures.json
git commit -m "Lighting: client light field with the server's static map and additive colour"
```

### Task 7: Light canvas in the game (replaces the fog)

**Files:**
- Create: `client/src/game/lightview.ts`, `client/src/game/lightview.test.ts`
- Modify: `client/src/game/GameScene.ts` (remove the fog, add the light field and view, handle events, depths)
- Modify: `client/src/game/effects.ts` (`DEPTH.heroes`, `DEPTH.tint`)
- Modify: `client/src/game/anim/EntityView.ts` (`aboveDark` flag)

**Interfaces:**
- Consumes: Task 6 `LightField` (`load`, `add`, `set`, `remove`, `mapChanged`, `isLit`, `accumulate`, `addMoving`), `LIGHT`, and `MovingLight` (`[x, y, kind, colour | null]`).
- Produces:
  - `export function darknessAlpha(visible: boolean, lit: boolean, r: number, g: number, b: number): number`;
  - `export function flicker(kind: number, id: number, t: number): number`;
  - `export class LightView`:
    - `constructor(scene, map, field)`;
    - `mapChanged()`;
    - `update(view: Phaser.Geom.Rectangle, vx: number, vy: number, moving: MovingLight[], t: number)`;
  - `DEPTH.heroes = 7000.5`, `DEPTH.tint = 6999`;
  - `EntityView.aboveDark: boolean`.

- [ ] **Step 1: Write the failing tests** in `client/src/game/lightview.test.ts`. Import only the pure functions, so the test needs no Phaser:

```ts
import { describe, expect, it } from 'vitest';
import { LIGHT_KIND } from '../generated/defs';
import { darknessAlpha, flicker } from './lightview';

describe('darkness', () => {
  it('is black where not seen or not lit', () => {
    expect(darknessAlpha(false, true, 255, 255, 255)).toBe(1);
    expect(darknessAlpha(true, false, 0, 0, 0)).toBe(1);
  });
  it('never draws a lit tile dark', () => {
    expect(darknessAlpha(true, true, 10, 5, 0)).toBeCloseTo(0.65);
    expect(darknessAlpha(true, true, 255, 120, 60)).toBe(0);
    expect(darknessAlpha(true, true, 600, 0, 0)).toBe(0); // over-bright sums are capped
  });
  it('flickers around 1 by the kind', () => {
    for (let t = 0; t < 5; t += 0.37) {
      const f = flicker(LIGHT_KIND.Torch, 7, t);
      expect(f).toBeGreaterThan(0.84);
      expect(f).toBeLessThan(1.16);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Run in `client/`: `npx vitest run src/game/lightview.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `client/src/game/lightview.ts`:

```ts
// The light canvas: darkness everywhere except tiles in the viewer's sight
// that a light reaches, plus an additive colour tint per tile from every light
// (static ones from LightField, moving ones from the snapshot). Both canvases
// have one pixel per tile with LINEAR filtering, scaled up by TILE. Redrawn
// every frame inside the camera window (cheap: about 60 x 34 tiles).
import Phaser from 'phaser';
import { CONST, LIGHT } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { Fov } from '../sim/fov';
import { TILE, type TileMap } from '../sim/map';
import { DEPTH } from './effects';
import type { LightField } from './light';

/** How strongly the light colour tints what it lights (ADD blend). */
const TINT_ALPHA = 0.35;
/** A lit tile is at least this bright, so it is never drawn dark. */
const MIN_LIT = 0.35;

/** Darkness over one tile: 1 = black. `r, g, b`: its summed light colour. */
export function darknessAlpha(visible: boolean, lit: boolean, r: number, g: number, b: number): number {
  if (!visible || !lit) return 1;
  const bright = Math.min(1, Math.max(r, g, b) / 255);
  return 1 - Math.max(bright, MIN_LIT);
}

/** A light's brightness factor at time `t` (s): a slight, per-light wobble by its kind. */
export function flicker(kind: number, id: number, t: number): number {
  const f = LIGHT[kind].flicker;
  return 1 + f * (0.6 * Math.sin(t * 7.3 + id * 1.7) + 0.4 * Math.sin(t * 13.1 + id * 0.9));
}

export class LightView {
  private fov: Fov;
  private origin = [-1, -1];
  private dark: Phaser.Textures.CanvasTexture;
  private tint: Phaser.Textures.CanvasTexture;
  private darkImg: ImageData;
  private tintImg: ImageData;
  private rgb: Float32Array;
  private movingLit: Uint8Array;

  constructor(scene: Phaser.Scene, private map: TileMap, private field: LightField) {
    this.fov = new Fov(map.w, map.h);
    for (const k of ['dark', 'tint']) if (scene.textures.exists(k)) scene.textures.remove(k);
    this.dark = scene.textures.createCanvas('dark', map.w, map.h)!;
    this.tint = scene.textures.createCanvas('tint', map.w, map.h)!;
    this.dark.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.tint.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.darkImg = this.dark.getContext().createImageData(map.w, map.h);
    this.tintImg = this.tint.getContext().createImageData(map.w, map.h);
    // Black, fully opaque until drawn.
    for (let i = 0; i < map.w * map.h; i++) this.darkImg.data.set([0, 0, 0, 255], i * 4);
    this.dark.getContext().putImageData(this.darkImg, 0, 0);
    this.dark.refresh();
    this.rgb = new Float32Array(map.w * map.h * 3);
    this.movingLit = new Uint8Array(map.w * map.h);
    scene.add.image(0, 0, 'tint').setOrigin(0, 0).setScale(TILE).setDepth(DEPTH.tint).setBlendMode(Phaser.BlendModes.ADD);
    scene.add.image(0, 0, 'dark').setOrigin(0, 0).setScale(TILE).setDepth(DEPTH.fog);
  }

  /** A tile changed: the viewer's sight is recomputed on the next update. */
  mapChanged(): void {
    this.origin = [-1, -1];
  }

  update(view: Phaser.Geom.Rectangle, vx: number, vy: number, moving: MovingLight[], t: number): void {
    const { w, h } = this.map;
    const tx = Math.floor(vx / TILE);
    const ty = Math.floor(vy / TILE);
    if (tx !== this.origin[0] || ty !== this.origin[1]) {
      this.origin = [tx, ty];
      this.fov.compute(this.map, tx, ty, CONST.FOV_RADIUS);
    }
    const x0 = Math.max(0, Math.floor(view.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(view.y / TILE) - 1);
    const x1 = Math.min(w, Math.ceil(view.right / TILE) + 1);
    const y1 = Math.min(h, Math.ceil(view.bottom / TILE) + 1);
    for (let y = y0; y < y1; y++) {
      this.rgb.fill(0, (y * w + x0) * 3, (y * w + x1) * 3);
      this.movingLit.fill(0, y * w + x0, y * w + x1);
    }
    this.field.accumulate(this.rgb, x0, y0, x1, y1, (l) => flicker(l.kind, l.id, t));
    moving.forEach(([mx, my, kind, colour], n) =>
      this.field.addMoving(this.rgb, this.movingLit, mx, my, kind, colour ?? LIGHT[kind].colour, flicker(kind, 1000 + n, t), TILE));
    const dd = this.darkImg.data;
    const td = this.tintImg.data;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const [r, g, b] = [this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]];
        const visible = this.fov.isVisible(x, y);
        const lit = this.field.isLit(x, y) || this.movingLit[i] === 1;
        dd[i * 4 + 3] = Math.round(darknessAlpha(visible, lit, r, g, b) * 255);
        td[i * 4] = Math.min(255, r);
        td[i * 4 + 1] = Math.min(255, g);
        td[i * 4 + 2] = Math.min(255, b);
        td[i * 4 + 3] = visible && lit ? Math.round(TINT_ALPHA * 255) : 0;
      }
    this.dark.getContext().putImageData(this.darkImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
    this.tint.getContext().putImageData(this.tintImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
    this.dark.refresh();
    this.tint.refresh();
  }
}
```

`client/src/game/effects.ts` `DEPTH`: add `tint: 6999,` and the following, then update the `fog` comment to "darkness (light canvas)":

```ts
  /** Heroes and the party's own shots: drawn above the darkness. */
  heroes: 7000.5,
```

`client/src/game/anim/EntityView.ts`: add `/** Heroes: drawn above the darkness. */ aboveDark = false;` and change line 124 to `this.root.setDepth(this.aboveDark ? DEPTH.heroes + s.y / 1e5 : DEPTH.entityBase + s.y);`.

`client/src/game/GameScene.ts`:
- Remove the `fov`, `fogTex` and `fogOrigin` fields, `setupFog`, `updateFog`, and the `Fov` import.
- Add the fields `private light!: LightField;` and `private lightView!: LightView;`.
- `init`: drop `this.fogOrigin = [-1, -1];`; after the map is built, add `this.light = new LightField(this.map); this.light.load(this.info.lights);`.
- `create`: replace `this.setupFog();` with `this.lightView = new LightView(this, this.map, this.light);`.
- `update`: replace `this.updateFog(camX, camY);` with `this.lightView.update(this.cameras.main.worldView, camX, camY, this.lastSnap?.lights ?? [], now);`.
- `onEvent`:
  - `Tile` case: replace `this.fogOrigin = [-1, -1];` with `this.light.mapChanged(); this.lightView.mapChanged();`;
  - add:

```ts
      case 'Light':
        this.light.set(ev.id, ev.on, ev.colour);
        break;
      case 'LightAdd':
        this.light.add({ id: ev.id, kind: ev.kind, colour: ev.colour, x: ev.x, y: ev.y, on: ev.on });
        break;
      case 'LightRemove':
        this.light.remove(ev.id);
        break;
```

- `drawFigure`: when creating a view for a player kind, set `view.aboveDark = true` (`if (isPlayerKind(e.kind)) view.aboveDark = true;`).
- `drawProjectile`: after positioning, if the owner is a party member (`this.info.players.some((p) => p.ent === owner)`), call `img.setDepth(DEPTH.heroes)`.
- The cosmetic (own) shots: find where their image is created (`projectileImage(pd)` in the cosmetic spawn path) and set `.setDepth(DEPTH.heroes)` there.
- `debugGfx` stays at `DEPTH.fog + 1`.

- [ ] **Step 4: Run tests and build.** Run in `client/`: `npx vitest run` and `npm run build`. Expected: all pass, the build succeeds.

- [ ] **Step 5: Check it live.**
  - Start the stack: `docker compose up --build -d` (repo root).
  - Then, in `tools/e2e`: `node smoke.mjs http://localhost:8080/ "" shots`.
  - Expected: no browser errors. The screenshots show a dark dungeon with lava glow (torches don't exist yet), and the heroes visible.

- [ ] **Step 6: Commit.**

```bash
git add client/src/game/lightview.ts client/src/game/lightview.test.ts client/src/game/GameScene.ts client/src/game/effects.ts client/src/game/anim/EntityView.ts
git commit -m "Lighting: light canvas with coloured, additive light replaces the fog"
```

### Task 8: `?lights` demo page

**Files:**
- Create: `client/src/game/LightsDemoScene.ts`
- Modify: `client/src/main.ts` (`DEMOS`, scene list, comment)

**Interfaces:**
- Consumes: `LightField`, `LightView` (Tasks 6 and 7), `tileDraws` (`autotile.ts`), `TerrainLayer` (`terrain.ts`), `Effects`.
- Produces: the dev page `?lights` (`&slow=N`).

- [ ] **Step 1: Implement** `LightsDemoScene` (scene key `lights-demo`).
  - **Map:** a 34 × 20 `TileMap` with walls around a room, a 1-wide corridor leading east into a second room (the dark pocket), and a 4 × 3 lava pool in the first room.
  - **Board:** draw it with `tileDraws` into a `RenderTexture`, as `GameScene.drawBoard` does (floor tint optional). Add `new TerrainLayer(this, map, fx)`.
  - **Static lights** (`LightField.add`):
    - four torches on the north wall of room 1, coloured `0xffaa5a` (warm), `0x3060ff` (blue), `0x50ff70` (green) and `0xc040ff` (purple);
    - one warm torch next to the lava pool (to show the mixing);
    - lava lights on every lava tile (`LIGHT_KIND.Lava`).
  - **Moving lights:** two, at a phase that loops every 4 s:
    - a fireball (`LIGHT_KIND.Fire`) flying through the corridor into the dark room and back;
    - a frost bolt (`LIGHT_KIND.Magic`, `0x78c8ff`) circling in room 1.
  - Draw each as an `add.image(…, 'glow')` tinted like `PROJECTILES` in `anim/defs.ts`.
  - **Camera:** a viewer point in the middle of room 1. `LightView.update(this.cameras.main.worldView, viewerX, viewerY, moving, t)` each frame. The camera shows the whole map (zoom to fit).
  - **Every 3 s, toggle the blue torch** (`field.set(id, !on, colour)`) to show switching.
  - **A label** at the top: `lights demo: torches in four colours, lava, torch+lava mix, fireball into a dark room, frost bolt; blue torch toggles every 3 s`.
  - **`?slow=N`** slows time, as the other demos do.
- [ ] **Step 2: Register it** in `client/src/main.ts`. Add `lights: 'lights-demo'` to `DEMOS`, `LightsDemoScene` to the gallery scene list and its import, and `?lights` to the dev-pages comment.
- [ ] **Step 3: Build and screenshot.** Run in `client/`: `npm run build`. Then, with the stack up (`docker compose up --build -d`), run `node gallery-shots.mjs http://localhost:8080/ shots` from `tools/e2e`. Read that script's usage line first; if it only takes gallery states, open `http://localhost:8080/?lights` with the same Playwright launch as `smoke.mjs` and save a screenshot to `tools/e2e/shots/lights.png`. Expected: no browser errors; the colours and the mixing are visible; the dark room is black except along the fireball's path.
- [ ] **Step 4: Show the user.** Send the screenshot and ask them to open `?lights` themselves. Ask about the falloff, the tint strength, the flicker and the canvas resolution. If the gradients look blocky, change both canvases to 2 px per tile (scale `TILE / 2`, sample `rgb` at 2 × 2 per tile with bilinear weights from the four neighbouring tiles), and re-check. Record the user's answer in HANDOFF.md.
- [ ] **Step 5: Commit.**

```bash
git add client/src/game/LightsDemoScene.ts client/src/main.ts
git commit -m "Lighting: ?lights demo page (colours, mixing, moving lights, switching)"
```

---

## Stage C: first users

### Task 9: Torches as world objects (server)

**Files:**
- Modify: `server/src/defs/kinds.rs` (`Torch = 82`, `ALL` grows to 35)
- Modify: `server/src/defs/objects.rs` (`def` for Torch, `TORCH_RADIUS`)
- Modify: `server/src/dungeon/mod.rs` (`TorchSide`, `TorchSpawn` with `front()` / `pos()`)
- Modify: `server/src/run/objects.rs` (`ObjState::Torch`, `spawn_torch`, `set_torch`, `hurt_object`, `use_object`, `snap`, `owns_light`, tests)
- Modify: `server/src/run/abilities.rs` (`advance_projectile`: a shot into a torch's wall tile)
- Modify: `server/src/run/visibility.rs` (torches always sent)
- Modify: `server/src/run/mod.rs` (fingerprint leaves torches out)

**Interfaces:**
- Consumes: Task 3 (`add_light`, `set_light`, `Anchor`); `defs::damage::{Damage, DamageType}` (`dmg.split.share(DamageType::Heat) -> f64`); `resolve`.
- Produces:
  - `#[repr(u8)] pub enum TorchSide { Face = 0, West = 1, East = 2 }`, where `West` means the torch hangs on a wall west of the floor (floor at x+1) and `East` the opposite;
  - `pub struct TorchSpawn { pub wall: (i32, i32), pub side: TorchSide }` with `fn front(&self) -> (i32, i32)` and `fn pos(&self) -> Vec2`;
  - `ObjState::Torch { wall: (i32, i32), side: TorchSide, light: u32, lit: bool }`;
  - `Run::spawn_torch(&mut self, t: &TorchSpawn) -> u32`;
  - `pub fn set_torch(run: &mut Run, oi: usize, on: bool)`;
  - `WorldObject::owns_light(&self) -> bool`;
  - snapshot: `anim` = 1 lit / 0 out, `extra` = side id.

- [ ] **Step 1: Write the failing tests** (in `run/objects.rs` tests):

```rust
    use crate::dungeon::{TorchSide, TorchSpawn, Tile, Map};

    /// A torch on the brick face just north of the hero, on open floor.
    fn torch_run() -> (Run, usize) {
        let mut run = clear_run(BossId::Lich);
        run.lights = crate::run::light::Lights::new(run.layout.map.w, run.layout.map.h);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for x in tx - 6..=tx + 6 {
            run.layout.map.set(x, ty - 2, Tile::Wall);
        }
        run.spawn_torch(&TorchSpawn { wall: (tx, ty - 2), side: TorchSide::Face });
        (run, run.objects.len() - 1)
    }

    fn torch_lit(run: &Run, oi: usize) -> bool {
        matches!(run.objects[oi].state, ObjState::Torch { lit: true, .. })
    }

    #[test]
    fn a_torch_lights_the_floor_in_front_of_it() {
        let (mut run, oi) = torch_run();
        assert!(torch_lit(&run, oi));
        let p = run.players[0].pos();
        assert!(run.is_lit(p));
        assert_eq!(snap(&run.objects[oi], run.time).5, 1);
        assert_eq!(snap(&run.objects[oi], run.time).9, TorchSide::Face as u32);
        assert!(run.objects[oi].owns_light() && !run.objects[oi].solid);
    }

    #[test]
    fn e_toggles_a_torch_in_reach() {
        let (mut run, oi) = torch_run();
        let wall_y = (Map::tile_of(run.players[0].pos()).1 - 1) as f64 * crate::dungeon::TILE;
        run.players[0].mv.y = wall_y + crate::defs::classes::PLAYER_RADIUS + 0.5; // against the wall
        run.players[0].mv.x = run.objects[oi].pos.x; // right under the torch
        push(&mut run);
        assert!(!torch_lit(&run, oi), "out");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Light { on: false, .. })));
        push(&mut run);
        assert!(torch_lit(&run, oi), "and lit again");
    }

    #[test]
    fn heat_lights_a_torch_other_damage_puts_it_out() {
        let (mut run, oi) = torch_run();
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::pure(DamageType::Cold)), None);
        assert!(!torch_lit(&run, oi), "cold puts it out");
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::split(&[(DamageType::Heat, 0.3)])), None);
        assert!(torch_lit(&run, oi), "any heat lights it");
        hurt_object(&mut run, oi, Damage::physical(5.0), None);
        assert!(!torch_lit(&run, oi), "a sword puts it out");
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::pure(DamageType::Poison)), None);
        assert!(!torch_lit(&run, oi), "poison does nothing (objects resist it)");
        assert!(!run.objects[oi].gone, "torches never break");
    }

    #[test]
    fn a_barrel_blast_lights_a_torch() {
        let (mut run, oi) = torch_run();
        set_torch(&mut run, oi, false);
        let (_, bi) = barrel_at(&mut run, Vec2::new(0.0, -6.0));
        explode_barrel(&mut run, bi);
        assert!(torch_lit(&run, oi));
    }

    #[test]
    fn a_shot_into_the_torch_wall_hits_the_torch() {
        let (mut run, oi) = torch_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        let from = Map::center_of(tx, ty - 1); // between the hero and the wall, flying away from the hero
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, from, Vec2::new(0.0, -1.0), 200.0, 5.0, 2.0, 0.0, 0, 0.0);
        step_for(&mut run, 0.3);
        assert!(!torch_lit(&run, oi), "an arrow puts it out");
    }
```

Also add to `visibility.rs` tests:

```rust
    #[test]
    fn torches_own_a_light_so_they_are_always_sent() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.spawn_torch(&crate::dungeon::TorchSpawn { wall: (1, 1), side: crate::dungeon::TorchSide::Face });
        let o = run.objects.last().unwrap();
        assert!(o.owns_light());
    }
```

- [ ] **Step 2: Run them to see them fail.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release objects`. Expected: compile errors.

- [ ] **Step 3: Implement.**

`defs/kinds.rs`:
- add `Torch = 82,` under `// Props`;
- add `EntityKind::Torch` to `ALL`, whose length becomes 35;
- if `body_height()` matches every kind exhaustively, give `Torch` the same value as `Barrel`/`Chest`.

`defs/objects.rs`: add `EntityKind::Torch => ObjDef { radius: TORCH_RADIUS, solid: false },` and:

```rust
/// Torch footprint (hits and hand reach); it hangs on the wall, nothing collides with it.
pub const TORCH_RADIUS: f64 = 4.0;
```

`dungeon/mod.rs`. Add after `ChestSpawn`:

```rust
/// Where a torch hangs, seen from the floor it lights.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TorchSide {
    /// On a brick face: the floor is below the wall cell.
    Face = 0,
    /// On a wall west of the floor (the floor is at x + 1).
    West = 1,
    /// On a wall east of the floor (the floor is at x - 1).
    East = 2,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TorchSpawn {
    /// The wall cell it hangs on.
    pub wall: (i32, i32),
    pub side: TorchSide,
}

impl TorchSpawn {
    /// The floor tile in front of it: its light starts there.
    pub fn front(&self) -> (i32, i32) {
        let (x, y) = self.wall;
        match self.side {
            TorchSide::Face => (x, y + 1),
            TorchSide::West => (x + 1, y),
            TorchSide::East => (x - 1, y),
        }
    }
    /// Its position (px): on the wall's edge, just inside the floor tile.
    pub fn pos(&self) -> Vec2 {
        let (x, y) = (self.wall.0 as f64, self.wall.1 as f64);
        match self.side {
            TorchSide::Face => Vec2::new((x + 0.5) * TILE, (y + 1.0) * TILE + 0.5),
            TorchSide::West => Vec2::new((x + 1.0) * TILE + 0.5, (y + 0.5) * TILE),
            TorchSide::East => Vec2::new(x * TILE - 0.5, (y + 0.5) * TILE),
        }
    }
}
```

`run/objects.rs`:
- Add the variant `Torch { wall: (i32, i32), side: crate::dungeon::TorchSide, light: u32, lit: bool },` to `ObjState`.
- Add:

```rust
impl WorldObject {
    /// Owns a static light: always sent, so its light can be drawn from afar.
    pub fn owns_light(&self) -> bool {
        matches!(self.state, ObjState::Torch { .. })
    }
}

impl Run {
    /// A wall torch with its static light (lit).
    pub fn spawn_torch(&mut self, t: &crate::dungeon::TorchSpawn) -> u32 {
        let (fx, fy) = t.front();
        let light = self.add_light(crate::defs::lights::LightKind::Torch, crate::run::light::Anchor::Tile(fx, fy), None);
        self.spawn_object(EntityKind::Torch, t.pos(), ObjState::Torch { wall: t.wall, side: t.side, light, lit: true })
    }
}

/// Lights or puts out a torch (and its light).
pub fn set_torch(run: &mut Run, oi: usize, on: bool) {
    let ObjState::Torch { light, lit, .. } = &mut run.objects[oi].state else { return };
    *lit = on;
    let id = *light;
    run.set_light(id, on);
}
```

- `hurt_object`: replace the `ObjState::Chest { .. } => {}` arm with the two arms below. The early `resolve(..) <= 0.0` return stays, so a fully resisted hit (poison) does nothing.

```rust
        ObjState::Chest { .. } => {}
        ObjState::Torch { .. } => {
            let heat = dmg.split.share(crate::defs::damage::DamageType::Heat) > 0.0;
            set_torch(run, oi, heat);
        }
```

  Check the name of the share accessor in `defs/damage.rs` (the tests there use `.share(Magical)`).
- `use_object`:
  - widen the filter to `matches!(&o.state, ObjState::Barrel(b) if b.sinking.is_none()) || matches!(o.state, ObjState::Torch { .. })`;
  - add the dispatch arm `ObjState::Torch { lit, .. } => set_torch(run, oi, !lit),` (copy `lit` out first: `let ObjState::Torch { lit, .. } = run.objects[oi].state`);
  - keep `ObjState::Chest { .. } => {}`.
- `snap`: add `ObjState::Torch { lit, .. } => (*lit as u8, 0),`. Change the final line so `extra` carries the side for torches:

```rust
    let extra = match &o.state { ObjState::Torch { side, .. } => *side as u32, _ => 0 };
    EntSnap(o.id, o.kind as u8, o.pos.x as f32, o.pos.y as f32, 255, anim, 0.0, since, 0, extra)
```

`run/abilities.rs` `advance_projectile`: in the `if run.layout.map.opaque_at(pos)` branch, before `impact(run, i, prev, None);`, add:

```rust
            // A plain shot into a torch's wall hits the torch (an explosion reaches it anyway).
            let tile = crate::dungeon::Map::tile_of(pos);
            if run.projectiles[i].explode_r == 0.0 {
                if let Some(oi) = run.objects.iter().position(|o| matches!(o.state, crate::run::objects::ObjState::Torch { wall, .. } if wall == tile)) {
                    let (dmg, by) = (run.projectiles[i].damage, run.projectiles[i].from_player.then_some(run.projectiles[i].owner));
                    crate::run::objects::hurt_object(run, oi, dmg, by);
                }
            }
```

`run/visibility.rs`: in the object loop, change the condition to `if o.gone || !(o.owns_light() || seen(&fov, lights, &moving, map, o.pos, 0.0))`.

`run/mod.rs` `fingerprint` (test module): leave torches out like barrels. Change the two `o.kind != EntityKind::Barrel` / `== EntityKind::Barrel` filters to also cover `EntityKind::Torch` (`!matches!(o.kind, EntityKind::Barrel | EntityKind::Torch)`). Update the comment.

- [ ] **Step 4: Run all server tests.** Run: `docker compose -f docker-compose.test.yml run --rm test`. Expected: all pass, the fingerprints unchanged (no torches are placed yet).

- [ ] **Step 5: Commit.**

```bash
git add server/src/defs/kinds.rs server/src/defs/objects.rs server/src/dungeon/mod.rs server/src/run/objects.rs server/src/run/abilities.rs server/src/run/visibility.rs server/src/run/mod.rs client/src/generated
git commit -m "Lighting: torches as world objects (E toggles, heat lights, other hits put out)"
```

### Task 10: Torch placement in the generator

**Files:**
- Modify: `server/src/dungeon/generate.rs` (`place_torches`, called after `rotate`; tests)
- Modify: `server/src/dungeon/mod.rs` (`Dungeon.torches`, `Layout.torches`, `split`)
- Modify: `server/src/run/mod.rs` (`Run::new` spawns torches last)

**Interfaces:**
- Consumes: Task 9 (`TorchSpawn`, `TorchSide`, `Run::spawn_torch`); `bfs`, `Room`, `RoomKind`, `Map::opaque`, `Map::get`.
- Produces:
  - `fn place_torches(rng: &mut ChaCha8Rng, map: &Map, rooms: &[Room]) -> Vec<TorchSpawn>`;
  - `pub const TORCH_SPACING: i32 = 6; pub const DARK_SHARE: f64 = 0.2;`;
  - `Layout.torches: Vec<TorchSpawn>`.

- [ ] **Step 1: Write the failing tests** (in `generate.rs` tests):

```rust
    #[test]
    fn torches_hang_on_walls_with_floor_in_front_spaced_and_never_adjacent() {
        let mut dark_regions = 0;
        for seed in 0..200u64 {
            let d = generate(seed, if seed % 2 == 0 { Theme::Water } else { Theme::Lava });
            assert!(!d.torches.is_empty(), "seed {seed}");
            for t in &d.torches {
                let (x, y) = t.wall;
                assert_eq!(d.map.get(x, y), Tile::Wall as u8, "seed {seed}: torch not on a wall at {x},{y}");
                let (fx, fy) = t.front();
                assert_eq!(d.map.get(fx, fy), Tile::Floor as u8, "seed {seed}: no floor in front of {x},{y}");
            }
            for (i, a) in d.torches.iter().enumerate() {
                for b in &d.torches[i + 1..] {
                    assert!((a.wall.0 - b.wall.0).abs() > 1 || (a.wall.1 - b.wall.1).abs() > 1, "seed {seed}: adjacent torches");
                }
            }
            // The start room and the boss hall have torches.
            for r in [&d.rooms[d.start].rect, d.boss_hall()] {
                assert!(d.torches.iter().any(|t| { let (fx, fy) = t.front(); r.contains_tile(fx, fy) }), "seed {seed}: unlit start or boss hall");
            }
            // Some ordinary room has none (dark pockets exist over the seeds).
            dark_regions += d.rooms.iter().filter(|r| matches!(r.kind, RoomKind::Room | RoomKind::Hall))
                .filter(|r| !d.torches.iter().any(|t| { let (fx, fy) = t.front(); r.rect.contains_tile(fx, fy) })).count();
        }
        assert!(dark_regions > 50, "dark pockets over 200 seeds: {dark_regions}");
    }

    #[test]
    fn torches_keep_their_spacing_along_the_start_room_wall() {
        for seed in 0..50u64 {
            let d = generate(seed, Theme::Water);
            let r = d.rooms[d.start].rect;
            // Face torches on the start room's top wall: one region, so one spacing rule.
            let mut xs: Vec<i32> = d.torches.iter().filter(|t| t.side == TorchSide::Face && t.wall.1 == r.y - 1 && r.contains_tile(t.wall.0, r.y)).map(|t| t.wall.0).collect();
            xs.sort();
            for w in xs.windows(2) {
                // Closer only where the run broke (a doorway or corner between them).
                let gap = (w[0]..=w[1]).any(|x| d.map.get(x, r.y - 1) != Tile::Wall as u8 || d.map.get(x, r.y) != Tile::Floor as u8);
                assert!(w[1] - w[0] >= TORCH_SPACING || gap, "seed {seed}: torches at x {} and {}", w[0], w[1]);
            }
        }
    }
```

Extend `split_keeps_every_part` with `let n_t = d.torches.len();` before the split and `assert_eq!(layout.torches.len(), n_t);` after it.

- [ ] **Step 2: Run them to see them fail.** Run: `docker compose -f docker-compose.test.yml run --rm test cargo test --release dungeon::generate`. Expected: compile errors (`torches` missing).

- [ ] **Step 3: Implement.**

`dungeon/mod.rs`:
- add `/// Wall torches (placed after rotation).` and `pub torches: Vec<TorchSpawn>,` to `Dungeon` and `Layout`;
- pass `torches` through `split` (destructure and construct).

`dungeon/generate.rs`:
- In `try_generate`, construct `Dungeon { .., torches: Vec::new(), player_spawns: Vec::new() }`.
- After the `rotate` loop, add:

```rust
    // Torches (stream 12) after the rotation, so a "face" is a brick face on screen.
    let mut torch_rng = rng.clone();
    torch_rng.set_stream(12);
    dungeon.torches = place_torches(&mut torch_rng, &dungeon.map, &dungeon.rooms);
```

  `rng.clone()` comes **after** `rng.gen_range(0..4)` for the turns. That is fine, because the clone does not advance `rng`, and nothing after it uses `rng`'s stream position for the layout. Confirm by running the fingerprint tests.
- Add (rooms are indexed: `rooms[0]` is the start room, and the boss hall has `RoomKind::Boss`):

```rust
pub const TORCH_SPACING: i32 = 6;
/// Share of rooms and corridor stretches left without torches (dark pockets).
pub const DARK_SHARE: f64 = 0.2;

/// Wall torches: on wall cells with plain floor in front (brick faces, and
/// side walls as sconces), one about every `TORCH_SPACING` tiles along each
/// straight run of wall, from a random offset; runs under 3 tiles get none.
/// Each room and each corridor stretch (connected corridor floor between
/// rooms) is dark with `DARK_SHARE`, except the start room and the boss hall.
/// No two torches touch.
fn place_torches(rng: &mut ChaCha8Rng, map: &Map, rooms: &[Room]) -> Vec<TorchSpawn> {
    // Region of a floor tile: its room, or its corridor stretch (flood fill).
    let n = (map.w * map.h) as usize;
    let mut region = vec![usize::MAX; n];
    for (ri, r) in rooms.iter().enumerate() {
        for y in r.rect.y..r.rect.y + r.rect.h {
            for x in r.rect.x..r.rect.x + r.rect.w {
                if map.in_bounds(x, y) {
                    region[(y * map.w + x) as usize] = ri;
                }
            }
        }
    }
    let mut next = rooms.len();
    for start in 0..n {
        let (sx, sy) = (start as i32 % map.w, start as i32 / map.w);
        if region[start] != usize::MAX || map.opaque(sx, sy) {
            continue;
        }
        let mut stack = vec![(sx, sy)];
        region[start] = next;
        while let Some((x, y)) = stack.pop() {
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nx, ny) = (x + dx, y + dy);
                if map.in_bounds(nx, ny) && !map.opaque(nx, ny) && region[(ny * map.w + nx) as usize] == usize::MAX {
                    region[(ny * map.w + nx) as usize] = next;
                    stack.push((nx, ny));
                }
            }
        }
        next += 1;
    }
    let dark: Vec<bool> = (0..next)
        .map(|ri| {
            let keep_lit = ri < rooms.len() && (ri == 0 || rooms[ri].kind == RoomKind::Boss);
            !keep_lit && rng.gen_bool(DARK_SHARE)
        })
        .collect();
    // Candidate cells, grouped by (region, side, line) and sorted along the line.
    let floor = |x: i32, y: i32| map.get(x, y) == Tile::Floor as u8;
    let wall = |x: i32, y: i32| map.get(x, y) == Tile::Wall as u8;
    let mut groups: std::collections::BTreeMap<(usize, u8, i32), Vec<i32>> = std::collections::BTreeMap::new();
    for y in 0..map.h {
        for x in 0..map.w {
            if !wall(x, y) {
                continue;
            }
            let t = if floor(x, y + 1) {
                TorchSpawn { wall: (x, y), side: TorchSide::Face }
            } else if wall(x, y - 1) && wall(x, y + 1) && floor(x + 1, y) && !floor(x - 1, y) {
                TorchSpawn { wall: (x, y), side: TorchSide::West }
            } else if wall(x, y - 1) && wall(x, y + 1) && floor(x - 1, y) && !floor(x + 1, y) {
                TorchSpawn { wall: (x, y), side: TorchSide::East }
            } else {
                continue;
            };
            let (fx, fy) = t.front();
            let ri = region[(fy * map.w + fx) as usize];
            if ri == usize::MAX || dark[ri] {
                continue;
            }
            let (line, along) = if t.side == TorchSide::Face { (y, x) } else { (x, y) };
            groups.entry((ri, t.side as u8, line)).or_default().push(along);
        }
    }
    let mut out: Vec<TorchSpawn> = Vec::new();
    for ((_, side, line), mut cells) in groups {
        cells.sort();
        let side = match side { 0 => TorchSide::Face, 1 => TorchSide::West, _ => TorchSide::East };
        // Split into runs of consecutive cells.
        let mut runs: Vec<Vec<i32>> = Vec::new();
        for c in cells {
            match runs.last_mut() {
                Some(r) if *r.last().unwrap() + 1 == c => r.push(c),
                _ => runs.push(vec![c]),
            }
        }
        for run in runs.into_iter().filter(|r| r.len() >= 3) {
            let offset = rng.gen_range(0..TORCH_SPACING).min(run.len() as i32 - 1) as usize;
            for &a in run.iter().skip(offset).step_by(TORCH_SPACING as usize) {
                let wall = if side == TorchSide::Face { (a, line) } else { (line, a) };
                if out.iter().all(|o| (o.wall.0 - wall.0).abs() > 1 || (o.wall.1 - wall.1).abs() > 1) {
                    out.push(TorchSpawn { wall, side });
                }
            }
        }
    }
    out
}
```

Import `TorchSide, TorchSpawn` from `super` at the top of `generate.rs`.

`run/mod.rs` `Run::new`: after the barrel loop, and **before** `run.add_lava_lights()`, add:

```rust
        // Torches after the barrels, so every other entity keeps its id.
        for t in run.layout.torches.clone() {
            run.spawn_torch(&t);
        }
```

- [ ] **Step 4: Run all server tests.** Run: `docker compose -f docker-compose.test.yml run --rm test`. Expected: all pass, including `level_setup_is_unchanged` and `simulation_is_unchanged_after_waking_the_boss` **with their old constants**.
  - If the second one changes, a torch altered the fight. The likely causes are a torch being hit, which changes nothing in the simulation, or the id order. Check that the torches are spawned after everything else and are filtered out of the fingerprint.
  - Only re-record the constants if the cause is understood and unavoidable, and write the reason in the commit message.

- [ ] **Step 5: Commit.**

```bash
git add server/src/dungeon/generate.rs server/src/dungeon/mod.rs server/src/run/mod.rs
git commit -m "Lighting: torches along all walls with dark pockets (stream 12, after rotation)"
```

### Task 11: Torch art and client view

**Files:**
- Create: `client/assets-src/torch/torch_anim.png`, `client/assets-src/torch/LICENSE.txt`
- Create: `client/scripts/torch-frames.ts`
- Modify: `client/scripts/build-atlas.ts` (torch strip)
- Create: `client/src/game/torch.ts` (`TorchView`)
- Modify: `client/src/game/GameScene.ts` (`drawTorch`, view cleanup, E hint for torches)
- Modify: `client/src/game/LightsDemoScene.ts` (torch sprites on the demo torches, both sides)

**Interfaces:**
- Consumes: the snapshot torch entry (`kind === KIND.Torch`, `anim` 1 lit / 0 out, `extra` = side 0 Face / 1 West / 2 East); `CONST.USE_REACH`, `CONST.PLAYER_RADIUS`.
- Produces:
  - atlas frames `torch_f0..torch_f{N-1}` and `torch_out`;
  - `export class TorchView { constructor(scene); update(x, y, lit: boolean, side: number, t: number); destroy() }`.

- [ ] **Step 1: Get the art.**
  - Download `torch_anim.png` from https://opengameart.org/content/simple-torch-animation-16x16. The file link is on that page, usually `https://opengameart.org/sites/default/files/torch_anim.png`.
  - Put it in a fresh scratch directory first, then copy it to `client/assets-src/torch/torch_anim.png`.
  - Open it (the Read tool shows images) and note the frame count and layout: 16x16 frames in a row or a grid.
  - Write `client/assets-src/torch/LICENSE.txt`:

```
"Simple Torch Animation 16x16" by Natural_Privateer
https://opengameart.org/content/simple-torch-animation-16x16
License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
"CC0 - Don't restrict other's use of this product :) Credit is appreciated!"
```

- [ ] **Step 2: Build the frames** in `client/scripts/torch-frames.ts`. Follow the pattern of `barrel-frames.ts` and `buildDemon(dir, width)`:
  - `export function buildTorches(dir: string, width: number): { img: Image; frames: Record<string, Frame> }` decodes `torch_anim.png` (`decodePng` from `./png`) and copies each 16x16 frame into a strip `width` px wide, as `torch_f0..`.
  - Add `torch_out`: frame 0 with the flame removed. Clear pixels that are flame-coloured, meaning the red channel is at least 180 and green is above blue; keep the stick and bracket. Check the result by eye in Step 5.
  - Register the strip in `build-atlas.ts` below the barrels, the same way as the barrel strip (`const torches = buildTorches(path.join(root, 'assets-src', 'torch'), src.w); const torchY = barrelY + barrels.img.h;`, extend `outH`, the copy loop, the frames loop and the log line). Update the header comment.
  - Run in `client/`: `npm run atlas`. Expected: the log line lists the torch frames.

- [ ] **Step 3: Write `client/src/game/torch.ts`:**

```ts
// A wall torch (atlas frames torch_f*, torch_out; CC0 art by Natural_Privateer,
// see assets-src/torch). The server sends anim 1 lit / 0 out and the side in
// `extra`: 0 on a brick face, 1 on a wall west of the floor, 2 east of it.
// The light itself is drawn by the light canvas, not here.
import Phaser from 'phaser';
import { DEPTH } from './effects';

const FPS = 8;

export class TorchView {
  private img: Phaser.GameObjects.Image;
  private frames: string[];

  constructor(scene: Phaser.Scene) {
    this.frames = scene.textures.get('atlas').getFrameNames().filter((n) => /^torch_f\d+$/.test(n)).sort((a, b) => +a.slice(7) - +b.slice(7));
    this.img = scene.add.image(0, 0, 'atlas', this.frames[0]).setOrigin(0.5, 1);
  }

  update(x: number, y: number, lit: boolean, side: number, t: number): void {
    const frame = lit ? this.frames[Math.floor(t * FPS) % this.frames.length] : 'torch_out';
    // Face: on the bricks above the floor edge; sides: at the side wall's inner edge, facing into the room.
    const [dx, dy, flip] = side === 0 ? [0, -6, false] : side === 1 ? [-3, 2, false] : [3, 2, true];
    this.img.setFrame(frame).setFlipX(flip).setPosition(Math.round(x + dx), Math.round(y + dy)).setDepth(DEPTH.entityBase + y - 16);
  }

  destroy(): void {
    this.img.destroy();
  }
}
```

  The offsets `dx`/`dy` and the flip are first guesses. Tune them by eye in Step 5 so a face torch sits on the brick face and a side torch sits at the wall edge. Show the side variant to the user before the task ends.

- [ ] **Step 4: Use it in `GameScene.ts`:**
  - add the field `private torchViews = new Map<number, TorchView>();` and reset it in `init`;
  - in the entity loop: `else if (e.kind === KIND.Torch) this.drawTorch(e, now);`;
  - add the cleanup line `for (const [id, v] of this.torchViews) if (!seen.has(id)) (v.destroy(), this.torchViews.delete(id));`;
  - add:

```ts
  private drawTorch(e: EntState, now: number): void {
    let view = this.torchViews.get(e.id);
    if (!view) {
      view = new TorchView(this);
      this.torchViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim === 1, e.extra, now);
  }
```

  - E hint: include torches in the hint search, with `CONST.TORCH_RADIUS`. Export it from `export.rs` in the `objs` json, next to `BARREL_RADIUS`, and run `cargo test` to regenerate. Change the hint filter to `(e.kind === KIND.Barrel && e.anim < 2) || e.kind === KIND.Torch`, with the radius picked by kind.
  - In `LightsDemoScene`, put a `TorchView` on each demo torch: the four face torches, plus one West and one East torch on the room's side walls. Each one is lit; the blue one goes out when it toggles.

- [ ] **Step 5: Build and look.**
  - Run in `client/`: `npm test` and `npm run build`.
  - Screenshot `?lights` (as in Task 8 Step 3).
  - Check that the flame animates, that the out frame is a bare stick, and that the face and side torches sit on the walls.
  - **Show the user the screenshot and ask about the side-sconce look** (the spec requires their OK). Adjust the offsets, or add a mirrored or bracket variant derived from the same frames, until they approve.

- [ ] **Step 6: Live run.**
  - Run: `docker compose up --build -d`, then in `tools/e2e`: `node smoke.mjs http://localhost:8080/ "" shots Wizard,Barbarian`.
  - Expected: no browser errors; torches along the walls, dark pockets, lit start room.
  - Ask the user for a live check. Things to try: E on a torch, a fireball lighting a dark corridor, the lava glow, the boss hall, and a sword swing next to a torch, which puts it out by the agreed rule. Watch whether that last one feels annoying.

- [ ] **Step 7: Commit.**

```bash
git add client/assets-src/torch client/scripts/torch-frames.ts client/scripts/build-atlas.ts client/src/game/torch.ts client/src/game/GameScene.ts client/src/game/LightsDemoScene.ts server/src/export.rs client/src/generated
git commit -m "Lighting: CC0 torch art, torch view, E hint for torches"
```

### Task 12: Docs, measurements and wrap-up

**Files:**
- Modify: `docs/TECHNICAL.md`, `docs/PLAYER_GUIDE.md`, `README.md`, `docs/TODO.md`, `HANDOFF.md`

- [ ] **Step 1: Measure.**
  - With the stack up, run the smoke test on `main` (`git stash`/worktree, or note the numbers from the HUD) and on this branch.
  - Compare the HUD's `srvMs` and the snapshot bytes (the HUD shows both; `smoke.mjs` screenshots include the HUD).
  - Expected: the server tick time does not rise noticeably, and snapshots grow only by the moving-light list.
  - Write the numbers into HANDOFF.md.
- [ ] **Step 2: TECHNICAL.md:**
  - §4 protocol: `RunStartInfo.lights`, `Ev::Light`/`LightAdd`/`LightRemove` (wire codes 10–12), `Snapshot.lights` (`SnapW` field 9).
  - §5:
    - "Light sources": the registry, anchors, `is_lit`, the API, the sweep;
    - torches under "World objects".
  - §6: `place_torches`, stream 12, after the rotation, `TORCH_SPACING`, `DARK_SHARE`.
  - §7: lighting replaces the fog.
    - The visibility rule.
    - Hero events.
    - The light canvas (darkness and tint, `MIN_LIT`, flicker, the per-frame window redraw).
    - Heroes above the darkness.
  - §9: torch frames and credit.
  - §11: a new "How to add a light source": a new row in `defs/lights.rs`, plus `add_light` with a tile or entity anchor. Moving: `kind_light` or an explicit call. Colour override. `set_light`, `set_light_colour`. No client change needed.
  - §12: the new tests and fixtures.
  - §13: known limitations:
    - moving-light glows can be sent from behind walls within range;
    - hero melee next to a torch puts it out;
    - weapon effects are drawn under the darkness.
- [ ] **Step 3: PLAYER_GUIDE.md:** rewrite "Seeing in the dark": it is dark without light; torches, E, heat lights them, other hits put them out; dark corridors; glowing shots light the way; lava glows.
- [ ] **Step 4: README.md:** in the Art credits, add "Simple Torch Animation 16x16" by Natural_Privateer (CC0, OpenGameArt) and the `?lights` dev page.
- [ ] **Step 5: TODO.md:**
  - Remove priority 1 and the "Lighting" section, and renumber the list.
  - Add a "Lighting follow-ups" section:
    - an own hero light through abilities or equipment (`add_light` with `Anchor::Entity(hero)`);
    - more sources (braziers, mushrooms, goo, fountains, the carriage lantern);
    - remembered (explored) tiles;
    - enemies affected by darkness;
    - the extinguishing enemy and the shadow, which use `is_lit` and `set_light`;
    - **Tune**: the radius and intensity per kind, `TORCH_SPACING`, `DARK_SHARE`, the falloff, `MIN_LIT`, `TINT_ALPHA` and the flicker.
- [ ] **Step 6: HANDOFF.md:** a "Last feature" section for lighting, with what was built, the deviations (if any), the verified test counts, the user's confirmations, and what is open.
- [ ] **Step 7: Final checks and commit.**
  - Run the full suite: `docker compose -f docker-compose.test.yml run --rm test`. In `client/`: `npm test` and `npm run build`.
  - Expected: everything passes. Note the counts in HANDOFF.

```bash
git add docs README.md HANDOFF.md
git commit -m "Lighting: docs, TODO and handoff"
```
