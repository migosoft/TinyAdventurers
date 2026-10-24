# Dungeon Mood Implementation Plan

Issue: #148

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the approved `?mood` spike into the game: warm (multiply) light tint, dust clouds, torch and lava smoke, lava and fire embers, haze and water drips.

**Architecture:** `LightView` switches to a multiply tint and exposes its per-tile light and seen-and-lit state. A pure helper module holds the tested math (tint, density, spawn rates, burst-once). A `Mood` class owns all air objects and is updated once per frame by `GameScene` and by the `?mood` demo. Client-only; no server, wire or generated changes.

**Tech Stack:** TypeScript, Phaser 3 (WebGL, `pixelArt`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-dungeon-mood-design.md` (read it in full; its "Tuned values" are binding). Reference implementation: the throwaway spike on branch `spike/148-mood` (`git show spike/148-mood:client/src/game/mood.ts`, also `MoodDemoScene.ts`, `lightview.ts`, `torch.ts`). Port the look from it; do not copy its spike shortcuts (the `MOOD` global, `setLook`, `window.mood`, grey dust, the old/new light button).

## Global Constraints

- Client only. No change under `server/`, to `client/src/generated/*`, or to the wire.
- Art rule: runtime effect shapes only (dots, generated soft textures, Graphics). No new sprite files.
- Everything of the air is under the darkness (`DEPTH.fog` 7000) and under `DEPTH.enemyBars` (6500), above `DEPTH.fx` (6000) — except torch smoke, which draws at `DEPTH.fog + 0.5` and only from torches whose floor tile is seen and lit.
- No setting / no on-off switch in the game.
- Canvas textures under `pixelArt`: set LINEAR after every `refresh()`.
- Code style: match the surrounding files (short doc comments on every export, no new dependencies).
- Commits end with `(#148)` or `Refs #148` and the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The terrain changes during a run (a `Tile` event: lava cools, a pool appears): lava and water lists must follow, so no smoke or drips over tiles that are no longer lava or water. Test in Task 3 (`Mood.mapChanged`).
2. A new run starts in the same browser tab (scene restart): generated textures already exist; no duplicate texture error, no leaked objects from the old scene. Test in Task 3 (constructing `Mood` twice on one scene) and checked in Task 4's smoke run (two runs).
3. The window is resized or the camera shows a much larger area: the dust cloud count follows the view area, within 4..24. Test in Task 2 (`cloudCount`).
4. A torch goes out, or the hero walks away so the torch is no longer seen: no new torch smoke; existing puffs fade within about 0.25 s. Test in Task 3.
5. A huge lava field or a fireball barrage on screen: caps hold (≤ 200 smoke puffs, ≤ 160 embers, ≤ 12 drips), no frame-rate collapse. Test in Task 2 (`spawnCount`) and Task 3 (caps).

---

### Task 1: Warm light tint in `LightView`

**Files:**
- Modify: `client/src/game/lightview.ts` (header comment, `TINT_ALPHA`, constructor's tint image, the tint loop in `update`)
- Modify: `client/src/game/effects.ts` (`DEPTH.tint` comment: "MULTIPLY blend")
- Test: `client/src/game/lightview.test.ts`

**Interfaces:**
- Produces: `export const WARM = 0.45;` and `export function warmTint(r: number, g: number, b: number, lit: boolean): [number, number, number]` (0..255 per channel; white when `!lit`).
- Produces on `LightView`: `readonly light: Float32Array` (getter over the per-tile r,g,b sums, `w*h*3`) and `readonly seenLit: Uint8Array` (`w*h`, 1 where the tile is seen and lit this frame).

- [ ] **Step 1: Write the failing tests** in `lightview.test.ts`:
  - `warmTint(0, 0, 0, false)` → `[255, 255, 255]`; `warmTint(255, 170, 90, false)` → `[255, 255, 255]`.
  - `warmTint(255, 170, 90, true)`: red `255`, green `≈ 255 * (1 - 0.45 * (1 - 170/255))` (toBeCloseTo 1 decimal), blue `≈ 255 * (1 - 0.45 * (1 - 90/255))`.
  - Dim light scales the strength: `warmTint(127.5, 85, 45, true)` green `≈ 255 * (1 - 0.225 * (1 - 85/127.5))`.
  - Over-bright sums clamp the strength at 0.45: `warmTint(510, 340, 180, true)` equals `warmTint(255, 170, 90, true)`.
  - Never paler: for random lit inputs every channel ≤ 255 and the max channel is exactly 255.
- [ ] **Step 2: Run** `cd client && bash -lic 'npx vitest run src/game/lightview.test.ts'` — expect FAIL (`warmTint` not exported).
- [ ] **Step 3: Implement** `warmTint` (formula in the spec's Tuned values) and use it in `update`: tint pixel = `warmTint(...)`, alpha 255; the tint image blend becomes MULTIPLY (`const MULTIPLY = 2`, like the existing numeric `ADD`; remove `ADD` if unused). Remove `TINT_ALPHA`. Fill `seenLit` in the same loop. `blackenDarkTiles` stays as is.
- [ ] **Step 4: Run** the lightview tests, then `npx tsc --noEmit` — expect PASS.
- [ ] **Step 5: Visual check** `?lights` (Vite on 5173, `BROWSER=/usr/bin/brave-browser node tools/e2e/lights-shot.mjs http://localhost:5173/ shots`): lit floor keeps its brown, coloured torches tint, nothing turns pale. Stop Vite afterwards.
- [ ] **Step 6: Commit** `Warm light: multiply tint by the light's hue (#148)`.

### Task 2: Pure mood helpers

**Files:**
- Create: `client/src/game/moodmath.ts`, `client/src/game/moodmath.test.ts`
- Modify: `client/src/game/torch.ts` (extract `torchOffset`, add `flameTip`), `client/src/game/torch.test.ts` (new)

**Interfaces:**
- Produces in `torch.ts`: `export function flameTip(x: number, y: number, side: number): [number, number]` (spike version; `TorchView.update` uses the same offsets).
- Produces in `moodmath.ts`:
  - `cloudCount(worldW: number, worldH: number): number` — `clamp(round(7 * (worldW/16 * worldH/16) / 240), 4, 24)`.
  - `spawnCount(acc: number, dt: number, n: number, every: number): [count: number, acc: number]` — accumulates `dt * n / every`, returns the whole spawns and the remainder; `n = 0` returns `[0, 0]`.
  - `dustTint(r: number, g: number, b: number): [brightness: number, colour: number]` — brightness `min(1, max/255)`, colour = the hue blended halfway to white as `0xRRGGBB` (spike `lightAt`).
  - `class BurstOnce { fresh(keys: string[]): string[] }` — returns the keys not present in the previous call (a blast bursts once while it shows).
  - Constants: `DUST_ALPHA = 0.55`, `MAX_CLOUDS = 24`, `MAX_SMOKE = 200`, `MAX_EMBERS = 160`, `MAX_DRIPS = 12`, `LAVA_SMOKE_EVERY = 4.2`, `LAVA_EMBER_EVERY = 1.08`, `DRIP_EVERY = 7`.

- [ ] **Step 1: Write the failing tests:**
  - `flameTip(56, 48.5, 0)` → `[56.5, 29]`; `flameTip(16.5, 152, 1)` → `[18.5, 137]`; `flameTip(191.5, 152, 2)` → `[190.5, 137]`.
  - `cloudCount(240, 256)` → 7 (15 × 16 tiles); `cloudCount(640, 360)` → 7 × 900/240 rounded = 26 → 24; `cloudCount(32, 32)` → 4.
  - `spawnCount(0, 1, 12, 4.2)` → `[2, ≈0.857]`; `spawnCount(0.9, 0.05, 1, 1)` → `[0, ≈0.95]`, then feeding that remainder back with another 0.05 → `[1, ≈0]` (compare remainders with `toBeCloseTo`); `spawnCount(0.5, 1, 0, 4.2)` → `[0, 0]`.
  - `dustTint(255, 170, 90)` → brightness 1, colour `0xffd5ad` (each channel `round(255 * (0.5 + 0.5 * c/255))`); `dustTint(0, 0, 0)` → brightness 0.
  - `BurstOnce`: `fresh(['a'])` → `['a']`, `fresh(['a'])` → `[]`, `fresh([])` → `[]`, `fresh(['a'])` → `['a']`.
- [ ] **Step 2: Run** `npx vitest run src/game/moodmath.test.ts src/game/torch.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the helpers and `flameTip` (make `TorchView.update` use `torchOffset`).
- [ ] **Step 4: Run** the tests and `tsc` — expect PASS.
- [ ] **Step 5: Commit** `Mood helpers: density, spawn rates, flame tip (#148)`.

### Task 3: The `Mood` layer and the `?mood` demo

**Files:**
- Modify: `client/src/game/effects.ts` (`DEPTH`: `airHaze: 6490, airDust: 6491, airSmoke: 6492, airDrips: 6493, airEmbers: 6494, torchSmoke: 7000.5`, with comments)
- Create: `client/src/game/mood.ts`, `client/src/game/mood.test.ts`, `client/src/game/MoodDemoScene.ts`
- Modify: `client/src/main.ts` (register `mood: 'mood-demo'`, skip `applyView` for it, header comment lists `?mood`)

**Interfaces:**
- Consumes: `LightView.light`, `LightView.seenLit` (Task 1); everything in `moodmath.ts` and `flameTip` (Task 2).
- Produces:
  - `export interface AirTorch { x: number; y: number; side: number; lit: boolean }`, `export interface AirShot { x: number; y: number; kind: number }`.
  - `export class Mood { constructor(scene: Phaser.Scene, map: TileMap, light: LightView); readonly on: { dust: boolean; smoke: boolean; embers: boolean; haze: boolean; drips: boolean }; mapChanged(): void; update(dt: number, view: Phaser.Geom.Rectangle, torches: AirTorch[], shots: AirShot[]): void; destroy(): void; }` plus read-only counts for tests: `get counts(): { clouds: number; smoke: number; embers: number; drips: number }`.
  - Lava = `TERRAIN.Lava`, water = `TERRAIN.Shallow` and `TERRAIN.Deep` (from `terrain.ts`), read from the map in the constructor and in `mapChanged()`. Fire kinds: `LIGHT_KIND.Fire` trails, `LIGHT_KIND.Blast` bursts (from `generated/defs`).

- [ ] **Step 1: Write the failing tests** in `mood.test.ts` (Vitest; fake the scene like `status.test.ts` does (`{ add: { image: mk, ... }, textures: { exists: () => true } } as never` with `mk` returning a chainable stub); add `tileSprite` and `graphics` stubs, a fake `LightView` (`{ light: Float32Array, seenLit: Uint8Array }`) and a real `TileMap`):
  - `counts.clouds` equals `cloudCount` of the view (`new Phaser.Geom.Rectangle`-like `{x,y,width,height,right,bottom}` of 640×360 → 24).
  - Caps: a map that is all lava, updated for 60 s of 1/60 frames, keeps `counts.smoke ≤ 200` and `counts.embers ≤ 160`; an all-water map keeps `counts.drips ≤ 12`.
  - `mapChanged`: a map with lava then turned to floor (`map.set`) + `mapChanged()` → after the old puffs die out (10 s), `counts.smoke === 0` and `counts.embers === 0`.
  - Torch smoke gating: with `seenLit` all 0 no torch smoke spawns; with the torch's floor tile seen-lit some does within 3 s; a torch with `lit: false` never smokes.
  - Burst once: one `AirShot` of kind Blast held at the same spot for 0.4 s adds 18 embers once, not per frame.
  - Constructing `Mood` twice on the same fake scene does not throw (textures reused).
- [ ] **Step 2: Run** `npx vitest run src/game/mood.test.ts` — expect FAIL.
- [ ] **Step 3: Implement `Mood`** by porting the spike (`git show spike/148-mood:client/src/game/mood.ts`) to the interfaces above, with these differences from the spike: depths from `DEPTH`; cloud pool of `MAX_CLOUDS`, active count `cloudCount(view.width, view.height)`; lava smoke and lava embers by `spawnCount` per lava tile in the view (+1 tile margin); drips by `spawnCount` per water tile in view with `DRIP_EVERY`; fire embers via `BurstOnce` (keys `round(x/8),round(y/8)`); torch smoke at `DEPTH.torchSmoke` gated and faded as the spec says; caps from `moodmath.ts`; `destroy()` destroys every image, graphics and tile sprite. All tuned numbers come from the spec's "Tuned values".
- [ ] **Step 4: Port `MoodDemoScene`** from the spike: same room, figures, pool, lava, fireball loop, torches; buttons only for dust, smoke, embers, haze, drips (no light or dust-colour buttons, no `window.mood`); file header comment describes the page.
- [ ] **Step 5: Run** the tests and `tsc` — expect PASS.
- [ ] **Step 6: Visual check** with a phone-sized Playwright shot of `http://localhost:5173/?mood` (412×860, deviceScaleFactor 2) and compare with the spike's look: dust specks in the light, torch smoke rising over the dark wall top, lava smoke and embers, fireball embers, ripples in the pool. Stop Vite afterwards.
- [ ] **Step 7: Commit** `Dungeon air: dust, smoke, embers, haze, drips and the ?mood demo (#148)`.

### Task 4: Air in the game, docs, full verification

**Files:**
- Modify: `client/src/game/GameScene.ts` (field `mood`, create after `lightView`, update after `lightView.update`, `mapChanged` in the `Tile` event, destroy in `cleanup`)
- Modify: `docs/TECHNICAL.md` (§7 Field of vision and light: warm tint; §9 Rendering: the air layers, depths, the torch-smoke exception, density and caps, `?mood`), `docs/PLAYER_GUIDE.md` (one sentence where the guide talks about seeing in the dark: torches smoke, dust drifts in the light, lava smokes and sparks, water drips; no gameplay effect)

**Interfaces:**
- Consumes: `Mood`, `AirTorch`, `AirShot` (Task 3).

- [ ] **Step 1: Wire it:** in `update`, right after `this.lightView.update(...)`, call `this.mood.update(dt, this.cameras.main.worldView, torches, shots)` where `torches` = every entity with `kind === KIND.Torch` → `{ x: e.x, y: e.y, side: e.extra, lit: e.anim === 1 }` and `shots` = `(this.lastSnap?.lights ?? []).map(([x, y, kind]) => ({ x, y, kind }))`. Use the frame's `dt` in seconds as the other effects do. In the `Tile` event add `this.mood.mapChanged()`. In `cleanup` call `this.mood.destroy()`.
- [ ] **Step 2: Run** client checks: `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'` — expect all green.
- [ ] **Step 3: Docs:** update TECHNICAL.md and PLAYER_GUIDE.md as listed above.
- [ ] **Step 4: Full verification** (CLAUDE.md "Verification after a change"): docker test suite (`docker compose -f docker-compose.test.yml run --rm test`, then `down`), `docker compose up --build -d`, `curl localhost:8080/health` → `OK`, smoke runs for `ElvenRanger,Paladin` and `Wizard,Barbarian` → "no browser errors". Look at the smoke screenshots: warm light, dust in lit areas only, torch smoke above seen torches, nothing over unseen areas, enemy HP bars above the air.
- [ ] **Step 5: Commit** `Dungeon air in the game; docs (#148)`.
