# Vision and Darkvision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every creature perceives through one trait-based rule (vision in tiles, darkvision as a share of it), so darkness hides heroes from humans and partly from monsters, and a hero with darkvision sees unlit tiles near them in greyscale.

**Architecture:** `TypeDef`/`Adjust`/`Profile` gain a `Sight { vision, darkvision }`; a new `run/perception.rs` holds the rule (within vision, line of sight, lit or within vision × darkvision). The light layers are refreshed once per tick before the AI and again before snapshots. Heroes use the same rule in the snapshot filter (tile maths, shared fixture with the client). The client adds a per-tile darkvision mask to `LightView` and a Phaser `PostFXPipeline` that desaturates where the mask is set.

**Tech Stack:** Rust server (tokio, rmp-serde, ts-rs), TypeScript + Phaser 3.90.0 client (vitest), Docker test stack.

**Spec:** [docs/superpowers/specs/2026-10-15-vision-darkvision-design.md](docs/superpowers/specs/2026-10-15-vision-darkvision-design.md) (reviewed and approved by the user 2026-10-15).

## Context
TODO priority 1. Lighting (`feature/lighting`) made darkness hide things from heroes, but enemies still see heroes perfectly in the dark. The user approved the written spec and chose: **merge `feature/lighting` into `main` first, then build this on a new branch from `main`.**

## Global Constraints
- Vision is in **tiles** (fractions allowed); px = `vision × TILE` (16) only inside the rule.
- Type table (first guesses): Human 9 / 0; Monster 8 / 1/3; Undead 8 / 1.0; Demon 9 / 1.0; Dragon 25 / 1.0; Object 0 / 0.
- Several types: max vision, max darkvision; then `Adjust` overrides replace them.
- Today's enemy ranges are kept exactly: `vision × 16 == old sight px` for every enemy; bosses 25 tiles.
- Hidden heroes (rogue Hide) are never seen. A hit still sends the enemy searching (`hurt_monster` unchanged).
- Heroes: Human (vision 9, darkvision 0) = today's behaviour; `Player.darkvision: Option<f64>` overrides darkvision only.
- Hero filter: "in FOV **and** (lit, **or** within vision × darkvision tiles of the viewer's tile, tile-centre distance, `<=`)", and range 0 means no darkvision at all (not even the own tile). Events on a hero keep the FOV-only rule (`on_hero`).
- Protocol: `SelfW` gains `darkvision: u8` (0–100) as its **last** element; `ClientMsg::DebugDarkvision { ratio: f32 }`, honoured only when `debug::allowed()`.
- Client: darkvision tiles get darkness alpha `DV_DARK` 0.45 and tint 0; greyscale is a WebGL `PostFXPipeline` on the main camera, only attached while darkvision > 0.
- Perception during `step` reads only `lights.lit(x, y)`; never `Run::is_lit` (it recasts per call).
- Fingerprint tests: re-record only with the cause understood, and say so in the commit and a dated code comment.
- Credits/art: none needed. Desktop only.

## Review Focus
1. **Lights stale during AI** (a torch toggled or a fireball flying this tick): perception must use layers refreshed this tick. Test in Task 2: a fire shot passing a dark hero makes a human enemy see them in the same tick's AI.
2. **Darkvision 0 must change nothing** for heroes, including the viewer's own tile (no range-0 "own tile" leak). Test in Task 3.
3. **Spectating a teammate**: the snapshot filter and `SelfW.darkvision` use the *viewed* hero's sight, so the drawing matches what is sent. Test in Task 4.
4. **Debug toggle when debug is not allowed** (`ALLOW_DEBUG=0`): ignored, darkvision stays as it was. Test in Task 4.
5. **Greyscale texture orientation** (PostFX y-flip) and darkvision 0 → pipeline removed (no cost, no tint on normal play): checked by screenshot in Task 6.

## Files
- Server: `defs/entity_types.rs` (Sight, table), `defs/enemies.rs` (`sight` px → `vision` tiles), `defs/bosses.rs` (vision overrides), `run/entities.rs` (Monster/Player), `run/perception.rs` (new), `run/ai.rs`, `run/bosses/mod.rs`, `run/levels/boss.rs`, `run/mod.rs` (step, spawn, msg), `run/light.rs` (`refresh_lights`, test `fill`), `run/visibility.rs` (hero filter), `run/debug.rs`, `protocol.rs`, `wire.rs`, `main.rs` (routing), `export.rs` (fixture).
- Client: `wire.ts`, `game/lightview.ts` (mask), `game/darkvisionfx.ts` (new pipeline), `game/GameScene.ts`, `ui/hud.ts` (F3 line), `game/LightsDemoScene.ts`, tests `wire.test.ts`, `game/lightview.test.ts`, `game/light.test.ts`.
- Docs: TECHNICAL, PLAYER_GUIDE, TODO, HANDOFF, plan copy in `docs/superpowers/plans/2026-10-15-vision-darkvision.md`.

Test commands: server `docker compose -f docker-compose.test.yml run --rm test` (regenerates `client/src/generated/*`); client `cd client; npm test; npm run build`.

---

### Task 0: Merge and branch
- [ ] `git checkout main; git merge --ff-only feature/lighting; git push origin main` (user approved the merge).
- [ ] `git checkout -b feature/vision`.
- [ ] Copy this plan to `docs/superpowers/plans/2026-10-15-vision-darkvision.md`; in the spec set **Status:** "approved by the user after review (2026-10-15); plan: …". Commit `Plan: vision and darkvision`.

### Task 1: Sight data (behaviour unchanged)

**Files:** `defs/entity_types.rs`, `defs/enemies.rs`, `defs/bosses.rs`, `defs/classes.rs` (no change expected), `run/entities.rs`, `run/mod.rs` (`spawn_enemy`), `run/levels/boss.rs`, `run/ai.rs`, `run/bosses/mod.rs`.

**Produces:** `pub struct Sight { pub vision: f64, pub darkvision: f64 }` (`Debug, Clone, Copy, PartialEq`) with `Sight::NONE` and `fn vision_px(&self) -> f64`; `Profile.sight`; `Adjust.vision/darkvision: Option<f64>`; `EnemyDef.vision: f64` (tiles, replaces `sight`); `Monster.sight: Sight`.

- [ ] **Step 1: failing tests** in `entity_types.rs` tests:
```rust
#[test]
fn every_type_has_a_sight_and_several_take_the_best() {
    let s = |t| profile(&[t], Adjust::NONE).sight;
    assert_eq!(s(EntityType::Human), Sight { vision: 9.0, darkvision: 0.0 });
    assert_eq!(s(EntityType::Monster), Sight { vision: 8.0, darkvision: 1.0 / 3.0 });
    assert_eq!(s(EntityType::Undead).darkvision, 1.0);
    assert_eq!(s(EntityType::Dragon).vision, 25.0);
    assert_eq!(s(EntityType::Object), Sight { vision: 0.0, darkvision: 0.0 });
    let both = profile(&[EntityType::Human, EntityType::Undead], Adjust::NONE).sight;
    assert_eq!(both, Sight { vision: 9.0, darkvision: 1.0 });
    let adj = Adjust { vision: Some(12.5), darkvision: Some(0.5), ..Adjust::NONE };
    assert_eq!(profile(&[EntityType::Undead], adj).sight, Sight { vision: 12.5, darkvision: 0.5 });
}

#[test]
fn enemy_and_boss_ranges_are_unchanged() {
    // Sight radii in px before vision existed (defs/enemies.rs, 2026-10-15).
    let old = [(EnemyType::GoblinArcher, 130.0), (EnemyType::SkeletonWarrior, 120.0), (EnemyType::RaisedSkeleton, 120.0),
        (EnemyType::SkeletonArcher, 140.0), (EnemyType::RaisedArcher, 140.0), (EnemyType::OrcWarrior, 125.0),
        (EnemyType::OrcArcher, 140.0), (EnemyType::Necromancer, 150.0), (EnemyType::Summoner, 150.0),
        (EnemyType::Disciple, 200.0), (EnemyType::Mimic, 140.0), (EnemyType::Imp, 140.0),
        (EnemyType::SummonedImp, 140.0), (EnemyType::Chort, 120.0), (EnemyType::Ogre, 150.0)];
    assert_eq!(old.len(), EnemyType::ALL.len());
    for (t, px) in old { assert_eq!(enemies::profile(t).sight.vision * 16.0, px, "{t:?}"); }
    for b in BossId::ALL { assert_eq!(bosses::profile(b).sight.vision, 25.0, "{b:?}"); }
}
```
(Check `EnemyType` variant names against `enemies.rs:34` before running.) Also extend `every_enemy_has_its_entity_type`: compare `res`/`melee` only, since `sight` now carries per-enemy overrides.
- [ ] **Step 2:** run server tests → compile errors / FAIL.
- [ ] **Step 3: implement.**
  - `TypeDef` gains `vision`, `darkvision` per the table; `Adjust` gains `vision: None, darkvision: None` in `NONE`.
  - `profile`: `vision = types.max(type_def.vision)` (0.0 for none), `darkvision` likewise, then `adj.vision.unwrap_or(v)`, `adj.darkvision.unwrap_or(d)`.
  - `EnemyDef.sight` (px) → `vision: f64` (tiles, doc "Vision (tiles); overrides the entity type's"), values = old/16 written as literals (8.125, 7.5, 8.75, 7.8125, 8.75, 9.375, 12.5, 8.75, 8.75, 7.5, 9.375). `enemies::profile` passes `Adjust { vision: Some(def(t).vision), ..Adjust::NONE }`.
  - `bosses::profile`: every boss adjust gets `vision: Some(25.0)` (Dragon's type is already 25; set it anyway so the boss rule is one line each).
  - `Monster.sight: Sight` set from `prof.sight` in `spawn_enemy` and `levels/boss.rs` (delete `sight: 400.0`).
  - `find_visible_player(run, from, sight: Sight)` keeps today's logic with `sight.vision_px()`; `bosses::target` passes `m.sight`. Update the direct test call in `ai.rs` (`enemy_ignores_player_without_line_of_sight_or_hidden`) to pass a `Sight { vision: 7.5, darkvision: 1.0 }`.
- [ ] **Step 4:** run server tests → all pass, **fingerprints unchanged**.
- [ ] **Step 5:** commit `Vision: sight traits on entity types, enemy ranges as tiles`.

### Task 2: Perception rule and per-tick lights

**Files:** create `run/perception.rs` (add `mod perception;` in `run/mod.rs`), modify `run/light.rs`, `run/mod.rs` (`step`), `run/visibility.rs` (`send_snapshots`), `run/ai.rs`, tests in `ai.rs` and new `perception.rs` tests.

**Consumes:** `Sight`, `Monster.sight`. **Produces:** `pub fn sees(run: &Run, sight: Sight, from: Vec2, to: Vec2) -> bool`; `Run::refresh_lights(&mut self)`; `#[cfg(test)] Lights::fill(&mut self)`.

- [ ] **Step 1:** `Run::refresh_lights` in `light.rs` (refresh static + `cast_moving(moving_lights())`); `is_lit` and `send_snapshots` call it (keep the snapshot call: shots move after the AI, and the snapshot must match what the client casts, see the lighting branch's F1 ruling). Add the test-only helper:
```rust
/// Tests: every tile counts as lit until a static light changes (enemy tests that are not about darkness).
#[cfg(test)]
pub fn fill(&mut self) { self.lit.iter_mut().for_each(|l| *l = true); self.dirty = false; }
```
- [ ] **Step 2: failing tests** in `perception.rs` (`mod tests`, reuse the `dark_run()` pattern from `light.rs:342`: copy it as a local helper `dark_run()` that carves a 15×9 floor patch, keeps only the boss, and sets `run.lights = Lights::new(w, h)`):
  - `a_human_does_not_see_a_dark_hero_until_a_torch_lights_them`: `Sight{9,0}` from 3 tiles → false; `run.add_light(Torch, Anchor::Tile(hero tile), None); run.refresh_lights();` → true.
  - `a_monster_sees_a_dark_hero_at_two_tiles_not_four`: `Sight{8, 1/3}`.
  - `undead_see_a_dark_hero_at_full_vision`: `Sight{8,1}` at 7 tiles true, 9 false.
  - `objects_see_nothing`: `Sight::NONE` at 0.5 tile → false.
  - `walls_still_block`: a wall tile between → false even when lit.
  - in `ai.rs`: `a_hidden_hero_is_never_seen_even_by_darkvision` (Undead, Hide set) and `a_hit_sends_a_human_enemy_searching_in_the_dark` (Necromancer, `hurt_monster(.., Some(0))` → `AiState::Search`, `last_known` = hero pos).
  - Review Focus 1, in `ai.rs`: `a_fire_shot_lights_a_dark_hero_for_the_ai_this_tick`: dark run, OrcWarrior 5 tiles away, spawn a hero `Fireball`/fire projectile next to the hero, `run.step()` once → the orc's `ai.target == Some(Target::Player(_))`. (Use the projectile spawn helper used by existing fire-glow tests in `visibility.rs`.)
- [ ] **Step 3:** run → FAIL.
- [ ] **Step 4: implement** `perception.rs`:
```rust
//! One perception rule for every creature: within vision, in line of sight, and lit or within darkvision.
use crate::collision::line_of_sight;
use crate::defs::entity_types::Sight;
use crate::dungeon::{Map, TILE};
use crate::geom::Vec2; // match the crate's Vec2 path
use super::Run;

/// Needs `Run::refresh_lights` this tick (`Run::step` does it before the AI).
pub fn sees(run: &Run, sight: Sight, from: Vec2, to: Vec2) -> bool {
    let d = from.dist(to);
    if d > sight.vision_px() || !line_of_sight(&run.layout.map, from, to) { return false; }
    let (x, y) = Map::tile_of(to);
    run.lights.lit(x, y) || d <= sight.vision_px() * sight.darkvision
}
```
  `find_visible_player` filters with `perception::sees(run, sight, from, p.pos())` (keep `alive && hidden <= 0.0`). In `Run::step`, call `self.refresh_lights()` after the player loop and `touch_chests()`, before the monster AI loop.
- [ ] **Step 5:** run all server tests. Existing AI/boss tests that now fail **only because their floor is dark**: add `run.lights.fill();` to their setup helpers (`open_floor`, `first_windup`, `ogre_among`, `archer_and_barrel`, and any single test), never to `light.rs`/`visibility.rs` tests. List each changed test in the commit body.
- [ ] **Step 6: fingerprints.** If `simulation_is_unchanged_after_waking_the_boss` changes, find which monster's behaviour changed (expected: Human disciples or Monster minions losing a hero in an unlit part of the hall). Re-record with a dated comment ("2026-10-15, vision: <cause>"). `level_setup_is_unchanged` must not change.
- [ ] **Step 7:** commit `Vision: one perception rule; enemies lose heroes in the dark by type`.

### Task 3: Heroes on the same rule (snapshot filter) + shared fixture

**Files:** `run/entities.rs` (Player), `run/mod.rs` (`Run::new`), `run/perception.rs`, `run/visibility.rs`, `export.rs`.

**Produces:** `Player.sight: Sight`, `Player.darkvision: Option<f64>`, `Player::sight_now(&self) -> Sight` (override applied); `pub fn dark_reach(viewer: (i32,i32), tile: (i32,i32), range: f64) -> bool` in `perception.rs` (`range > 0.0 && dx²+dy² <= range²`); `pub(crate) fn hero_tile_seen(fov, lights, viewer, range, x, y) -> bool` in `visibility.rs`; fixture key `darkvision`.

- [ ] **Step 1: failing tests** in `visibility.rs` (use `dark_view`, extend it to take the darkvision):
  - `with_no_darkvision_nothing_changes`: monster on an unlit tile 1 tile away and on the viewer's own tile → not sent.
  - `full_darkvision_sends_a_monster_on_an_unlit_tile_in_fov`; and not through a wall (out of FOV).
  - `half_darkvision_reaches_half_the_vision`: 4 tiles sent, 5 tiles not (range 4.5).
  - a test that `classes::profile(c).sight.vision.round() as i32 == PLAYER_FOV_RADIUS` for every class (client draws with `CONST.FOV_RADIUS`).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** `Run::new` sets `sight: prof.sight, darkvision: None`. In `send_snapshots`, take the **viewed** player's `sight_now()` (own, or the spectated hero when dead), compute the FOV with `sight.vision.round() as i32`, and pass `Dark { tile, range: sight.vision * sight.darkvision }` into `seen`, whose per-sample test becomes `hero_tile_seen`: `fov.is_visible(x,y) && (lights.lit(x,y) || dark_reach(viewer, (x,y), range))`. `object_sent`, hazards, projectiles use the same `seen`; `visible`/`ev_seen(on_hero)` unchanged. `lights_for` range uses the same rounded vision.
- [ ] **Step 4: fixture.** In `export_fixtures`, after the static lights are refreshed, add `"darkvision": [...]` cases: viewers (3,3) range 9, (8,8) range 4.5, (15,12) range 3, (20,17) range 0; each `{ x, y, range, seen: [tile indices where hero_tile_seen with the static layer only] }`.
- [ ] **Step 5:** run server tests → pass; `git diff` on `client/src/generated/fixtures.json` shows only the new key.
- [ ] **Step 6:** commit `Vision: heroes on the perception rule; darkvision in the snapshot filter`.

### Task 4: Protocol — darkvision in `SelfW`, debug toggle

**Files:** `wire.rs`, `protocol.rs` (`SelfState`, `ClientMsg`), `run/visibility.rs` (`SelfState` build), `run/debug.rs`, `run/mod.rs` (msg match), `main.rs:177` (routing), `export.rs` (wire fixtures regenerate).

**Produces:** `SelfState.darkvision: u8`; `SelfW` 14th element `u8`; `ClientMsg::DebugDarkvision { ratio: f32 }`; `Run::set_darkvision(pi, ratio)`.

- [ ] **Step 1: failing tests** in `debug.rs`/`visibility.rs`:
  - `the_debug_toggle_sets_darkvision_and_the_snapshot_carries_it`: `set_darkvision(0, 0.5)` → `players[0].darkvision == Some(0.5)`, decoded `snap[3][13] == 50`.
  - `the_debug_toggle_is_ignored_when_debug_is_not_allowed` (Review Focus 4): set `ALLOW_DEBUG=0` in the test via the same mechanism other gate tests use (if none exists, factor `set_darkvision_if(allowed: bool, ...)` and test that), → unchanged.
  - `a_spectator_gets_the_viewed_heros_darkvision` (Review Focus 3): player 0 dead spectating player 1 with darkvision 1.0 → `snap[3][13] == 100` and a monster on an unlit tile near player 1 is sent.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** `set_darkvision`: `if !allowed() { return }`, clamp 0..=1, store `Some(r)` (`None` for 0 is fine too, but store the value so the HUD shows it), set `self.debug_used = true` (a debug cheat: no XP banked, like `set_debug`), and post `Ev::Msg` "<name> darkvision <n>%". `SelfW` appends `u8` = `(viewed.sight_now().darkvision * 100).round()`; update the doc comment, both `sample_snapshots` cases, `SelfState`. Route `ClientMsg::DebugDarkvision { .. }` in `main.rs` with `Debug`.
- [ ] **Step 4:** run server tests → pass (regenerates `SelfW.ts`, `SelfState.ts`, `ClientMsg.ts`, `wire-fixtures.json`).
- [ ] **Step 5:** commit `Vision: darkvision on the wire and a debug toggle`.

### Task 5: Client mask and darkness

**Files:** `client/src/wire.ts`, `client/src/wire.test.ts` (the two 13-element literals → 14, add `0`), `client/src/game/lightview.ts`, `client/src/game/lightview.test.ts`, `client/src/game/light.test.ts` (fixture), `client/src/game/GameScene.ts` (pass darkvision).

**Produces:** `export const DV_DARK = 0.45`; `export function darkReach(dx: number, dy: number, range: number): boolean` (mirror of `dark_reach`); `LightView.update(view, vx, vy, moving, t, darkvision: number)`; `LightView.maskTexture` (`'dvmask'` CanvasTexture, R = mask, A = 255, upsampled like the others).

- [ ] **Step 1: failing tests.**
  - `wire.ts`: `me.darkvision = me[13] ?? 0` (fixture test then passes with the regenerated JSON).
  - `lightview.test.ts`: `darkReach` (range 0 → false even at 0,0; 4.5 → (4,0) true, (4,2) false... compute: 16+4=20 ≤ 20.25 true; (5,0) false); `darknessAlpha` unchanged for lit tiles; new `tileDark(visible, lit, inReach, r,g,b)` returns `DV_DARK` for visible && !lit && inReach.
  - `light.test.ts` "darkvision tiles match the server": for each `fixtures.darkvision` case, build `Fov` on the fixture map (as `sim.test.ts` does) with `CONST.FOV_RADIUS`, then `seen = visible && (field.isLit || darkReach(dx, dy, range))`, compare to `c.seen`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: implement** in `LightView.update` step 4: `const reach = visible && !lit && darkReach(x - tx, y - ty, range)` with `range = CONST.FOV_RADIUS * darkvision`; `dt[i] = tileDark(...) * 255`; tint alpha 0 when `!lit`; `mask[i] = reach ? 255 : 0`. Upsample `mask` into a third `ImageData` channel 0 (set alpha 255 once at creation); dark tiles stay `>= 255` so `blackenDarkTiles` leaves reach tiles alone. Upload the mask with the other two (LINEAR re-applied). Keep `lightview.ts` free of Phaser value imports. `GameScene` passes `this.lastSnap?.me.darkvision / 100 ?? 0`.
- [ ] **Step 4:** `npm test`, `npm run build` → pass.
- [ ] **Step 5:** commit `Vision: client darkvision mask and dimmed darkness`.

### Task 6: Greyscale post effect, debug key, `?lights` toggle

**Files:** create `client/src/game/darkvisionfx.ts`; modify `GameScene.ts`, `ui/hud.ts`, `LightsDemoScene.ts`, `client/src/main.ts` (pipeline registration in both game configs, `pipeline: { DarkvisionFX }` or `renderer.pipelines.addPostPipeline`).

- [ ] **Step 1: pipeline.**
```ts
import Phaser from 'phaser';

const FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform sampler2D uMask;
uniform vec4 uView;   // camera worldView: x, y, width, height (px)
uniform vec2 uMapPx;  // map size (px)
varying vec2 outTexCoord;
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec2 world = uView.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uView.zw;
  float m = texture2D(uMask, world / uMapPx).r;
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(c.rgb, vec3(g), m), c.a);
}`;

/** Greys the world where the hero sees only by darkvision (mask from LightView). */
export class DarkvisionFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  mask?: Phaser.Textures.CanvasTexture;
  mapPx: [number, number] = [1, 1];
  constructor(game: Phaser.Game) { super({ game, name: 'DarkvisionFX', fragShader: FRAG }); }
  onDraw(target: Phaser.Renderer.WebGL.RenderTarget): void {
    const v = this.camera?.worldView; // set by Phaser for camera post pipelines; verify in 3.90
    if (this.mask && v) {
      this.set4f('uView', v.x, v.y, v.width, v.height);
      this.set2f('uMapPx', this.mapPx[0], this.mapPx[1]);
      this.bindTexture(this.mask.glTexture!, 1);
      this.set1i('uMask', 1);
    }
    this.bindAndDraw(target);
  }
}
```
  Verify against Phaser 3.90 typings (`camera` property, `CanvasTexture.glTexture`, `bindTexture(texture, unit)`) with `tsc`; adjust names, not the approach.
- [ ] **Step 2: wiring.** `GameScene.update`: when `darkvision > 0` and the camera has no `DarkvisionFX`, `setPostPipeline(DarkvisionFX)` and set its `mask`/`mapPx`; when it drops to 0, `removePostPipeline('DarkvisionFX')` (Review Focus 5). Debug key: `kb.on('keydown-F4', ...)` cycles 0 → 0.5 → 1.0 and sends `{ t: 'DebugDarkvision', ratio }`; the F3 panel shows `darkvision NN%` from the snapshot.
- [ ] **Step 3: `?lights`.** Key `V` cycles the demo viewer's darkvision 0 / 0.5 / 1; caption shows it; the demo attaches the same pipeline.
- [ ] **Step 4: verify in the browser.** `npm run build`; `tools/e2e/lights-shot.mjs` screenshots of `?lights` at darkvision 0, 0.5, 1.0: grey exactly over the dark room near the viewer (if it appears mirrored vertically, drop the `1.0 -` in the shader), colour elsewhere, no browser errors. Then `docker compose up --build -d` and `tools/e2e/smoke.mjs` (two players): F4 cycles, F3 shows the value, no errors.
- [ ] **Step 5:** commit `Vision: greyscale darkvision post effect, F4 debug toggle, ?lights demo`.

### Task 7: Docs and wrap-up
- [ ] TECHNICAL: §5 (Sight on entity types, `perception.rs`, per-tick light refresh), §4 protocol (`SelfW` field 13, `DebugDarkvision`), §7 (the hero filter with darkvision), §10 (`?lights` V key, F4), §11 (how to give a creature darkvision), §12 tests, §13 limitations (the greyscale also greys world-space damage numbers, HP bars and the E hint inside darkvision range; camera-wide effect).
- [ ] PLAYER_GUIDE "Seeing in the dark": which enemies see you in the dark (humans don't, monsters only close, undead/demons/dragon fully); hiding in the dark as a tactic.
- [ ] TODO: item 1 → only the effect system remains; remove "Enemies affected by darkness" from "Lighting follow-ups"; add "Tune vision/darkvision values" to the balancing pass.
- [ ] HANDOFF: new "Last feature" section (what was built, deviations: lights refreshed both per tick and per snapshot; debug darkvision marks the run as debug; greyscale greys world-space labels), verification numbers; next: effect system draft's open questions.
- [ ] Full verification: server tests (count), `npm test`, `npm run build`, screenshots; commit `Docs: vision and darkvision`. Ask the user before pushing or merging.

## Execution method
Recommended: **subagent-driven** (superpowers:subagent-driven-development), as for lighting and barrels. The tasks hand interfaces to each other (Sight → perception → hero filter → wire → client), and a perception mistake would quietly change every fight, so a reviewer per task is worth the cost. The alternative is **native**: I build every task myself and one reviewer checks the whole branch at the end.

## Verification (end to end)
1. `docker compose -f docker-compose.test.yml run --rm test` → all pass; `git diff --exit-code client/src/generated` after a second run (generated files stable).
2. `cd client; npm test; npm run build` → pass.
3. `?lights`: screenshots with darkvision 0/0.5/1.0.
4. Live: `docker compose up --build -d`, play with `?debug`: sneak past a necromancer/disciple in an unlit corridor (not noticed), a skeleton notices you in the dark, an orc only up close; F4 shows greyscale around the hero.
