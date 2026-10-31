# Daylight Rays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Issue: #156. Branch: `feature/156-daylight-rays`.

**Goal:** Sunlight falling through ceiling cracks into 0–2 rooms per level: a real server light (`Daylight`), with a slanted beam, a bright floor patch, dust in the beam and slow cloud dimming drawn on the client. The look is tuned first on a `?sunlight` phone demo.

**Architecture:** The server gets a new `LightKind::Daylight` and places sun spots during level generation (own RNG stream). It turns them into static lights through one reusable `Run::add_sun(x, y)`. Torches in sunlit rooms start unlit. The client draws a beam, patch and dust (`sunbeams.ts`) for every static light of kind Daylight, under the darkness. Cloud dimming goes through `LightField.accumulate` as a centre-only dim (`EDGE + (fall − EDGE)·k`), so the lit tile set never changes.

**Tech Stack:** Rust server (bin crate, tests in Docker for exports), TypeScript + Phaser 3 client, vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-daylight-rays-design.md` (approved 2026-10-31). Read it before any task.

## Global Constraints

- The client must never draw a tile lit that the server counts as dark. The beam, patch and beam dust draw under `DEPTH.fog` (the darkness and vision mask hide them like figures), and nothing on the client adds lit tiles.
- Cloud dimming is look only: the lit area never changes size, and a dimmed lit tile stays at or above `EDGE` (0.1) brightness before `MIN_LIT`.
- One daylight colour everywhere: `0xdce8ff`, intensity `0.9`, flicker `0`, radius `7`.
- Sun placement: 0/1/2 suns per level with weights 25 % / 50 % / 25 %; never the boss room (`RoomKind::Boss`); the start room is allowed; at most one per room; on `Tile::Floor`, at least 1 tile inside the room's walls.
- Torches whose floor tile (`TorchSpawn::front()`) lies in a sunlit room start unlit; torch positions are unchanged.
- Art rule: runtime effect shapes only (gradients, glows, dots); no new sprite files.
- A new enum variant must be impossible to half-add (CLAUDE.md naming rule).
- Every commit ends its message with `(#156)` or `Refs #156`, plus the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never edit `client/src/generated/*` by hand; regenerate with `docker compose -f docker-compose.test.yml run --rm test`, then `docker compose -f docker-compose.test.yml down`.
- Server tests locally: `cd server && cargo test -- --skip export_bindings`. Client: `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`.

## Review Focus

1. **A sun tile whose beam rises into dark or unseen tiles** (a sun near the room's top wall, or a hero outside the room looking in): nothing of the beam may show over tiles the darkness covers. Owner: Task 3 (depth test) and Task 6 (smoke check).
2. **A torch lit by a player inside a sunlit room:** it lights normally and the beam still draws. Torch toggling must not touch the sun light. Owner: Task 5 test `torches_in_sunlit_rooms_start_unlit_and_can_be_lit`.
3. **A level whose only non-boss rooms have no floor tile 1 tile inside the walls** (all water, say): placement skips that room, never panics and never picks the boss room instead. Owner: Task 5 test `sun_spots_skip_rooms_without_inner_floor`.
4. **Clouds at full strength on a light's rim tiles:** brightness stays ≥ `EDGE`, so the darkness alpha never jumps at the rim during a cloud. Owner: Task 2 test `cloudy_keeps_the_rim_at_edge`.
5. **`mapChanged` (terrain changes, e.g. water freezing) or a run restart:** the beams rebuild from the field's lights and leak no Phaser objects. Owner: Task 3 test `rebuilds_on_light_changes_and_destroys_everything`.

---

### Task 1: Server light kind `Daylight`

**Files:**
- Modify: `server/src/defs/lights.rs` (enum, `ALL`, `def`)
- Modify: `server/src/export.rs:477-490` (add one Daylight source to the light parity fixture)
- Regenerated: `client/src/generated/defs.ts`, `client/src/generated/fixtures.json`

**Interfaces:**
- Produces: `LightKind::Daylight = 7`; `def(Daylight) == LightDef { radius: 7, colour: 0xdce8ff, intensity: 0.9, flicker: 0.0 }`; on the client `LIGHT_KIND.Daylight === 7` and `LIGHT[7]`.

- [ ] **Step 1: Write the failing test** in `lights.rs` tests:

```rust
#[test]
fn daylight_is_cool_white_and_steady() {
    let d = def(LightKind::Daylight);
    assert_eq!((d.radius, d.colour, d.flicker), (7, 0xdce8ff, 0.0));
    assert!((d.intensity - 0.9).abs() < 1e-9);
    assert!(LightKind::ALL.contains(&LightKind::Daylight));
}
```

- [ ] **Step 2: Run it.** `cd server && cargo test --bin '*' daylight -- --skip export_bindings`. Expected: compile error (no `Daylight`).
- [ ] **Step 3: Add the variant** with a doc comment ("Sunlight through a crack in the ceiling (`Run::add_sun`)"), its `def` row, and make `ALL` impossible to forget: either move `LightKind` to `listed_enum!` (look at how other enums use it, e.g. `grep -rn "listed_enum!" server/src`), or keep `ALL` and add a test that matches exhaustively over a `match` on every variant, so that a variant missing from `ALL` fails. Prefer `listed_enum!` if it fits the `#[repr(u8)]` + explicit discriminants.
- [ ] **Step 4: Add a Daylight source to the light fixture** in `export.rs`: `lights.push(LightKind::Daylight, Anchor::Tile(x, y), None)` on an open floor tile of `fixture_map()` that no other light covers fully (read the map; pick one and say which in the commit). The client's `light.test.ts` parity test then covers it with no client change.
- [ ] **Step 5: Run server tests and the docker suite** (regenerates `client/src/generated`). Expected: all pass, `git diff --stat client/src/generated` shows `defs.ts` and `fixtures.json` changed.
- [ ] **Step 6: Run client tests.** Expected: pass (`light.test.ts` parity includes the new source).
- [ ] **Step 7: Commit** `Add the Daylight light kind (#156)`.

### Task 2: Sun look settings and cloud dimming (client, pure)

**Files:**
- Create: `client/src/game/sunmath.ts`, `client/src/game/sunmath.test.ts`
- Modify: `client/src/game/light.ts` (`cloudy`, `accumulate` takes a dim callback)
- Modify: `client/src/game/lightview.ts:252` (pass the cloud dim for Daylight lights)
- Test: `client/src/game/light.test.ts`

**Interfaces:**
- Consumes: `LIGHT_KIND.Daylight` (Task 1).
- Produces:
  - `export interface SunLook { widen: boolean; patch: number /* tiles across */; slant: number /* tiles sideways at the floor, ceiling to floor */; dir: -1 | 1 /* -1: light comes from the upper left */; clouds: number /* deepest dip, 0..1 */; gap: [number, number] /* s of full sun between clouds */ }`
  - `export const sunLook: SunLook`: mutable, the demo switches it; defaults `{ widen: true, patch: 2, slant: 1.5, dir: -1, clouds: 0.45, gap: [8, 25] }`.
  - `export function cloudAt(id: number, t: number, look: SunLook): number`: in `[1 - look.clouds, 1]`. Each cloud takes 3–6 s to pass, with a smooth dip down and back (e.g. a raised-cosine). Its depth is `look.clouds · rnd(0.67, 1)`, so the centre lows are 55–70 % at default. Gaps follow `look.gap`. The schedule comes from a hash of `(id, cloud index)`, so it depends only on `id` and `t`. A per-id cache of the schedule is fine.
  - `export function cloudy(fall: number, k: number): number` in `light.ts`: `EDGE + (fall - EDGE) * k`.
  - `accumulate(rgb, x0, y0, x1, y1, scale: (l: StaticLight) => number, dim: (l: StaticLight) => number = () => 1)`: for each cell, adds `colour · intensity · scale(l) · cloudy(fall, dim(l))`. With `dim = 1` that is identical to today.

- [ ] **Step 1: Write the failing tests.**

```ts
// sunmath.test.ts
const look = { ...sunLook };
it('cloudAt stays between the deepest dip and full sun', () => {
  for (let t = 0; t < 600; t += 0.25) { const k = cloudAt(3, t, look); expect(k).toBeGreaterThanOrEqual(1 - look.clouds - 1e-9); expect(k).toBeLessThanOrEqual(1); }
});
it('cloudAt is full sun most of the time and changes smoothly', () => {
  let full = 0;
  for (let t = 0; t < 600; t += 0.05) { if (cloudAt(3, t, look) === 1) full++; expect(Math.abs(cloudAt(3, t + 0.05, look) - cloudAt(3, t, look))).toBeLessThan(0.03); }
  expect(full / (600 / 0.05)).toBeGreaterThan(0.6);
});
it('cloudAt dips at least once in two minutes and differs per light', () => {
  const dips = (id: number) => Array.from({ length: 2400 }, (_, i) => cloudAt(id, i * 0.05, look));
  expect(Math.min(...dips(3))).toBeLessThan(0.75);
  expect(dips(3)).not.toEqual(dips(4));
});
it('cloudAt with clouds 0 is always 1', () => { expect(cloudAt(3, 17.3, { ...look, clouds: 0 })).toBe(1); });
// light.test.ts
it('cloudy_keeps_the_rim_at_edge', () => {
  expect(cloudy(EDGE, 0.4)).toBeCloseTo(EDGE);
  expect(cloudy(1, 0.55)).toBeCloseTo(EDGE + (1 - EDGE) * 0.55);
  expect(cloudy(0.5, 1)).toBeCloseTo(0.5);
});
it('accumulate with a dim keeps the lit tiles and the rim, and darkens the centre', () => { /* load fixtures.lights.sources, accumulate with dim 1 and dim 0.5 into two buffers; every tile non-zero in one is non-zero in the other; the Daylight source's own tile is darker with 0.5; a tile at the rim of its radius differs by less than 2 % */ });
```

- [ ] **Step 2: Run** `cd client && bash -lic 'npx vitest run src/game/sunmath.test.ts src/game/light.test.ts'`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** `sunmath.ts`, `cloudy`, the `dim` parameter; in `LightView.update` pass `(l) => (l.kind === LIGHT_KIND.Daylight ? cloudAt(l.id, t, sunLook) : 1)`.
- [ ] **Step 4: Run the full client check.** Expected: all pass (`lightview.test.ts` unchanged).
- [ ] **Step 5: Commit** `Cloud dimming for daylight: centre-only dim through accumulate (#156)`.

### Task 3: The beam, patch and beam dust (client)

**Files:**
- Create: `client/src/game/sunbeams.ts`, `client/src/game/sunbeams.test.ts`
- Modify: `client/src/game/effects.ts` (`DEPTH.sunPatch = 1.5`, `DEPTH.sunBeam = 6489`, with doc comments; beam dust uses `DEPTH.airDust`)
- Modify: `client/src/game/sunmath.ts` (`beamShape`)

**Interfaces:**
- Consumes: `sunLook`, `cloudAt` (Task 2); `LightField.lights` (`Map<number, StaticLight>`), `LightView.seenLit` and `LightView.light` (the per-tile rgb that `Mood` already reads).
- Produces:
  - `export function beamShape(tx: number, ty: number, look: SunLook): { top: [number, number][]; bottom: [number, number][]; patch: { x: number; y: number; w: number; h: number } }` (px). The patch is centred on the tile centre, `w = look.patch · TILE`, `h = 0.6 · w` (seen from above). The beam's bottom edge spans the patch width. Its top edge sits `BEAM_HEIGHT = 3 · TILE` above the patch centre and is shifted `look.dir · look.slant · TILE` sideways (the light comes *from* that side, so the top is on the `dir` side). The top width is `0.5 ×` the bottom width when `widen`, else equal.
  - `export class Sunbeams { constructor(scene: Phaser.Scene, field: LightField, light: LightView); update(dt: number, view: Phaser.Geom.Rectangle, t: number): void; destroy(): void; readonly on: { beam: boolean; dust: boolean } }`

**Drawing (my calls, keep them):**
- Draw for every light in `field.lights` with `kind === LIGHT_KIND.Daylight && on`, whose tile is inside the view (plus a 4-tile margin) and has `seenLit === 1`. Others are hidden (pooled, not destroyed every frame).
- **Beam:** ADD blend, colour `LIGHT[Daylight].colour`, at `DEPTH.sunBeam`. Alpha runs from 0 at the top edge to `0.22` at about two thirds of the way down, then eases to `0.16` at the floor: it "fades in from above". Build it as runtime geometry (a `Graphics` with `fillGradientStyle` triangles, or a generated vertical-gradient canvas texture on a quad mesh; pick one and say which).
- **Patch:** a soft elliptical glow (generated radial-gradient canvas texture, LINEAR), ADD, alpha `0.35`, at `DEPTH.sunPatch` (on the floor, under figures).
- **Clouds:** beam and patch alpha are multiplied by `cloudAt(id, t, sunLook)` (the same factor as the light).
- **Beam dust:** per visible beam, 24 one-pixel motes (`'dot'` at scale 0.5, ADD, `DEPTH.airDust`) drifting slowly downward-sideways along the beam (≤ 3 px/s), twinkling `0.6 + 0.4 sin`, peak alpha `0.8 × cloud`. They respawn at a random point inside the beam polygon when they leave it. Hide a mote when the tile under it is not `seenLit`.
- Rebuild the list of sun lights when the field's lights change (a `LightAdd`/`LightRemove`, `mapChanged`); simplest is to re-scan `field.lights` every frame (it is small).

- [ ] **Step 1: Write the failing tests** in `sunmath.test.ts` and `sunbeams.test.ts`:

```ts
it('beamShape: the patch is centred on the tile and 0.6 as tall as wide', () => {
  const s = beamShape(5, 8, { ...sunLook, patch: 2 });
  expect(s.patch).toEqual({ x: 5.5 * TILE, y: 8.5 * TILE, w: 2 * TILE, h: 1.2 * TILE });
});
it('beamShape: the top is 3 tiles up, shifted to the light side, narrower when widening', () => {
  const s = beamShape(5, 8, { ...sunLook, slant: 1.5, dir: -1, widen: true });
  const cx = (s.top[0][0] + s.top[1][0]) / 2;
  expect(cx).toBeCloseTo(5.5 * TILE - 1.5 * TILE);
  expect(s.top[0][1]).toBeCloseTo(8.5 * TILE - 3 * TILE);
  expect(Math.abs(s.top[1][0] - s.top[0][0])).toBeCloseTo(0.5 * Math.abs(s.bottom[1][0] - s.bottom[0][0]));
  const straight = beamShape(5, 8, { ...sunLook, widen: false });
  expect(Math.abs(straight.top[1][0] - straight.top[0][0])).toBeCloseTo(Math.abs(straight.bottom[1][0] - straight.bottom[0][0]));
});
// sunbeams.test.ts: follow how mood.test.ts fakes the scene; if Mood has no scene-level test, test through a minimal fake scene object.
it('draws only daylight lights whose tile is seen and lit, under the darkness', () => { /* one Daylight + one Torch light in the field; seenLit 1 on the Daylight tile → one beam visible; seenLit 0 → none; every made object's depth < DEPTH.fog */ });
it('rebuilds_on_light_changes_and_destroys_everything', () => { /* add a second Daylight light → two beams; remove it → one; destroy() → every made object destroyed */ });
```

- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement** `beamShape` and `Sunbeams` and the `DEPTH` entries.
- [ ] **Step 4: Run the full client check.** Expected: pass.
- [ ] **Step 5: Commit** `Sunbeams: beam, floor patch and beam dust for daylight (#156)`.

### Task 4: The `?sunlight` demo page and the phone check

**Files:**
- Create: `client/src/game/SunlightDemoScene.ts`
- Modify: `client/src/main.ts` (`DEMOS` gets `sunlight: 'sunlight-demo'`, scene list, the doc comment)
- Modify: `CLAUDE.md` verification step 6 (add `?sunlight` to the demo list)

**Interfaces:**
- Consumes: `Sunbeams`, `sunLook` (Tasks 2–3), `Mood`, `LightField`, `LightView`, `TorchView`, as `MoodDemoScene` uses them.

**The page (follow `MoodDemoScene.ts`: no server, zoomed to fit a phone, big buttons along the bottom, URL parameters):**
- One room, about 15 × 17 tiles, with a pillar. One **Daylight** light in the room's middle. Two wall torches in the same room: one **unlit** (the sunlit room's torches are out) and one lit, in a second smaller room joined by a doorway, so warm and daylight can be compared. A still knight standing in the patch and one beside it. A dark corner the light doesn't reach.
- Mood on (dust, haze), so the beam dust can be judged against normal dust.
- Buttons, each cycling through its values and showing the current one, writing into `sunLook`:
  - **Shape:** widening / straight (`widen`)
  - **Patch:** 1.5 / 2 / 3 tiles (`patch`)
  - **Slant:** 0 / 1 / 1.5 / 2 tiles (`slant`)
  - **From:** left / right (`dir`)
  - **Clouds:** off / soft / medium / strong (`clouds` 0 / 0.3 / 0.45 / 0.6)
  - **Often:** normal / often (`gap` `[8, 25]` / `[2, 4]`), so a cloud can be seen without waiting
  - **Beam** and **Dust** on/off (`Sunbeams.on`)
- URL parameters mirror the buttons (`?shape=straight&patch=3&slant=2&from=right&clouds=0.3&often=1`).
- Header comment like `MoodDemoScene`'s, listing the buttons and parameters.

- [ ] **Step 1: Build the scene** and its routing.
- [ ] **Step 2: Client check** passes; `cd client && npx vite --port 5173`, open `http://localhost:5173/?sunlight` with Playwright (`BROWSER=/usr/bin/brave-browser`), screenshot default and `?shape=straight&slant=2&from=right&clouds=0.6&often=1`, no console errors. Stop Vite.
- [ ] **Step 3: Commit** `?sunlight demo page (#156)`.
- [ ] **Step 4 (main session, not a subagent): deploy the branch to the VPS** for the phone check: backup first, then `git bundle`, copy, `git fetch`, `git checkout -B feature/156-daylight-rays`, `docker compose up -d --build`. The live game is unchanged (no suns are placed yet). Send the user the demo link.
- [ ] **Step 5 — CHECKPOINT, wait for the user:** they pick shape, patch, slant, direction and cloud strength (and may ask for tweaks; iterate on the demo). Then write the picked values into the `sunLook` defaults, into the spec ("Picked by the user" section), and as a comment on #156. Commit `Daylight look as picked on the phone (#156)`.

### Task 5: Sun placement on the server, torches out in sunlit rooms

**Files:**
- Modify: `server/src/dungeon/mod.rs` (`TorchSpawn.lit`, `Dungeon.suns`, `Layout.suns`, `split`)
- Modify: `server/src/dungeon/generate.rs` (`place_suns`, stream 13, unlit torches, tests; update every `TorchSpawn { .. }` literal with `lit: true`)
- Modify: `server/src/run/objects.rs:84-88` (`spawn_torch` honours `lit`)
- Modify: `server/src/run/light.rs` (`Run::add_sun`)
- Modify: `server/src/run/mod.rs:268-273` (suns become lights after the lava lights; fingerprints)

**Interfaces:**
- Produces:
  - `TorchSpawn { wall, side, lit: bool }`
  - `Dungeon.suns` / `Layout.suns: Vec<(i32, i32)>` (tiles)
  - `fn place_suns(rng: &mut ChaCha8Rng, map: &Map, rooms: &[Room]) -> Vec<(i32, i32)>`, called right after `place_torches` with its own clone of the rng on stream 13 (so nothing else that is generated moves).
  - `pub fn add_sun(&mut self, x: i32, y: i32) -> u32` on `Run`: `add_light(LightKind::Daylight, Anchor::Tile(x, y), None)`. This is the reusable piece designed rooms will call.
  - `spawn_torch` with `lit == false` creates the light already off. At build time set `on = false` on the source directly, with no `Ev::Light` event; `RunStartInfo.lights` carries `on: false`.

**Placement (`place_suns`):** count = 0, 1 or 2 with weights 25/50/25. Candidates: rooms with `kind != RoomKind::Boss`, shuffled. For each candidate, until `count` suns are placed: collect the tiles inside the rect inset by 1 on every side where `map.get(x, y) == Tile::Floor as u8`, and pick one at random. A room with none is skipped. Then, in `generate`, set `lit = false` on every torch whose `front()` lies in the rect of a room holding a sun.

- [ ] **Step 1: Write the failing tests** in `generate.rs` tests (seeds `0..200`, both themes):

```rust
#[test]
fn sun_spots_are_on_inner_floor_never_in_the_boss_room_and_at_most_one_per_room() { /* for each seed and Theme::{Water, Lava}: d.suns.len() <= 2; each sun on Tile::Floor; inside some non-boss room's rect inset by 1; no two suns in the same room */ }
#[test]
fn sun_counts_follow_the_weights() { /* over seeds 0..400: share with 0 suns in 0.15..0.35, 1 sun in 0.4..0.6, 2 suns in 0.15..0.35 */ }
#[test]
fn sun_spots_skip_rooms_without_inner_floor() { /* a hand-built map + rooms: one Room whose inner tiles are all ShallowWater, one Boss room with floor → place_suns returns no tile in either */ }
#[test]
fn torches_in_sunlit_rooms_start_unlit_and_the_rest_are_lit() { /* for seeds: every torch whose front() is in a sun room's rect has lit == false, every other has lit == true */ }
#[test]
fn suns_do_not_move_anything_else() { /* for seeds: map, rooms, spawns, chests, barrels and torch positions equal a generation with place_suns returning nothing (compare against walls/sides only, not lit) — e.g. by checking that torch walls/sides match the list place_torches gives for the same rng stream */ }
```

and in `run/objects.rs` or `run/light.rs` tests:

```rust
#[test]
fn torches_in_sunlit_rooms_start_unlit_and_can_be_lit() { /* run with a TorchSpawn { lit: false } and an add_sun nearby: light_infos shows the torch light off and the Daylight on; hitting the torch with heat lights it; the Daylight light stays on */ }
#[test]
fn add_sun_lights_the_floor_around_it() { /* add_sun on an open floor tile; after refresh, the tile and tiles within radius in line of sight are lit; a tile behind a wall is not */ }
```

- [ ] **Step 2: Run** `cargo test --bin '*' sun -- --skip export_bindings`. Expected: compile errors / FAIL.
- [ ] **Step 3: Implement** the fields, `place_suns`, unlit torches, `spawn_torch`, `add_sun`, and the loop in `Run::new` (after `add_lava_lights`): `for (x, y) in run.layout.suns.clone() { run.add_sun(x, y); }`.
- [ ] **Step 4: Run all server tests.** The fingerprint tests (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss`, `plan_3a_fight_is_pinned`, and their `_with_the_log_on` twins) are expected to fail, because light ids and lit tiles change. Re-record them once, check that nothing else failed, and say so in the commit message.
- [ ] **Step 5: Docker suite** (regenerates nothing new, but runs everything). Expected: pass.
- [ ] **Step 6: Commit** `Sunlit rooms: 0–2 suns per level, their torches start out (#156)`, noting in the body: "Fingerprints re-recorded: new Daylight lights and unlit torches change light ids and lit tiles."

### Task 6: Into the game, docs, verification

**Files:**
- Modify: `client/src/game/GameScene.ts:196-197, 266, 448-449, 757-761` (create `Sunbeams` after `Mood`, update after `mood.update` with `now`, destroy on shutdown; nothing needed on `mapChanged` if Task 3 re-scans every frame)
- Modify: `docs/TECHNICAL.md` (the Daylight kind and its numbers, `place_suns` and stream 13, unlit torches in sunlit rooms, `Run::add_sun` as the piece for designed rooms, centre-only cloud dimming in `accumulate`, the beam/patch layers and depths, `?sunlight`)
- Modify: `docs/PLAYER_GUIDE.md` (one line: some rooms are lit by sunlight through cracks in the ceiling; their torches are out but can be lit), or say "no change" in the closing comment if the guide doesn't describe dungeon looks

- [ ] **Step 1: Wire it into `GameScene`.**
- [ ] **Step 2: Full verification:** server tests, client check, docker suite, `docker compose up --build -d` + `curl localhost:8080/health` → `OK`, smoke for `ElvenRanger,Paladin` and `Wizard,Barbarian` → "no browser errors".
- [ ] **Step 3: Look at a real sunlit room:** a debug run on a seed with a sun (find one with a throwaway test printing `d.suns` per seed, or walk rooms). Screenshot it and check: the beam doesn't show over dark tiles (Review Focus 1); an enemy in the patch is visible; the torches there are out; the lit area doesn't change during a cloud (compare the lit tile set of two frames, during and outside a cloud).
- [ ] **Step 4: Docs** as listed above.
- [ ] **Step 5: Commit** `Sunlight in the game; docs (#156)`.
- [ ] **Step 6 (main session):** final whole-branch review (Opus), then ask the user about merging, pushing and deploying; a `play-test` on the VPS.
