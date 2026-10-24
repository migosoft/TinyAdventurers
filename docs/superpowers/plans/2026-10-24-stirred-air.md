# Stirred Air Implementation Plan (#158)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dust, smoke and embers drift with one shared, world-anchored wind field that moving figures, projectiles and blasts push, plus a gentle background draft; stirred dust clouds break up and respawn.

**Architecture:** a pure `Wind` class (`client/src/game/wind.ts`, no Phaser) holds a coarse velocity grid over the view: pushes in, self-advection, blur and decay, walls hold no air, plus an analytic draft added on sampling. `Mood` owns one `Wind`, filters movers to seen tiles in the view, feeds them in, and every speck, puff and ember samples it. The `?mood` demo shows it first (phase 1, then a checkpoint with the user); phase 2 wires `GameScene` through a small `MoverTracker`.

**Tech Stack:** TypeScript, Phaser 3, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-stirred-air-design.md` (read it first).

**Branch:** `feature/158-stirred-air` (off `feature/148-dungeon-mood`, which is not merged). Every commit ends with `(#158)`.

## Global Constraints

- Client-only and cosmetic: no server, protocol or `client/src/generated` change; simulation fingerprint tests untouched.
- Reveals nothing: only movers on a seen tile (`light.seenLit`) push air; blasts as #148 already filters them.
- Cheap: only movers inside the view plus `MARGIN` tiles; no allocation per frame in `Wind.step` / `Wind.sample` (preallocated `Float32Array`s, reused out-arrays).
- The haze does not react. No new art or textures.
- With `on.stir = false` and `on.draft = false`, `Mood` behaves like #148 (clouds keep their own random drift).
- Starting tuning values below are first guesses, named constants at the top of `wind.ts` / `mood.ts`; the user judges them in the demo.
- Client verification: `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`.

## Review Focus

1. **Camera jumps** (spectate switch, respawn, a teleport): the grid re-anchors without dust snapping and the jump itself pushes nothing (Task 1 re-anchor test, Task 4 teleport test).
2. **Unseen movers** next to a torch over the darkness: smoke must not move (Task 2 unseen-mover test).
3. **A long frame** (tab back in focus, `dt` 0.5 s) or `dt = 0`: no NaN, no explosion of speeds (Task 1 dt test).
4. **A busy fight with every cloud stirred:** clouds come back after the respawn delay; the room is never left empty for good (Task 2 respawn test).
5. **Own shots counted twice** (cosmetic copy plus hidden server copy) or the own hero twice (prediction plus `ents`) (Task 4 wiring, checked in review).

---

## Phase 1: wind, reactions, demo

### Task 1: The wind field

**Files:**
- Create: `client/src/game/wind.ts`
- Test: `client/src/game/wind.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const WIND_CELL = 8; // px
  export class Wind {
    constructor(solid: (px: number, py: number) => boolean);
    draftOn: boolean;           // default true
    /** Re-anchors the grid to cover `view` plus WIND_MARGIN px, world-aligned; advects, blurs, decays; zeroes solid cells. dt is clamped to [0, 0.1]. */
    step(dt: number, view: { x: number; y: number; width: number; height: number }): void;
    /** A figure's pocket of air. v in px/s, r = body radius in px. */
    push(x: number, y: number, vx: number, vy: number, r: number): void;
    /** A projectile's narrow wake. */
    wake(x: number, y: number, vx: number, vy: number): void;
    /** An outward ring, once per blast. */
    blast(x: number, y: number): void;
    /** Air velocity at (x, y) in px/s: grid (bilinear) plus draft; 0 in solid cells and outside the grid. Writes into `out`, returns it. */
    sample(x: number, y: number, out: [number, number]): [number, number];
  }
  ```

Starting values (constants at the top of the file): `WIND_MARGIN = 48` px; decay time constant `0.45` s; blur so a gust spreads about one cell per 0.1 s (keep the explicit step stable: weight ≤ 0.25 per frame); air speeds clamped to 160 px/s.
- **Pocket** (`push`): Gaussian falloff with radius `2r` (min 12 px), centred `0.6r` ahead along the motion, so air ahead moves before a touch. Within it add velocity along the motion (peak 0.8 × mover speed, scaled by frame time so the result does not depend on frame rate) plus an outward component (0.35 ×) away from the motion line; behind the centre, two counter-rotating swirls at ±`r` sideways, `1.2r` back, tangential strength 0.3 × speed, so the wake curls.
- **Wake** (`wake`): radius 6 px, along the flight direction 0.5 × speed plus outward 0.3 ×.
- **Blast**: outward, peak 120 px/s at radius 24 px, falling off to 0 by 56 px.
- **Draft**: smooth noise (sum of 2–3 sines in x, y and t is enough) with magnitude ≤ `DRAFT_MAX = 3` px/s, spatial scale about 160 px, changing over about 20 s.
- **Re-anchor**: the grid origin is `floor((view.x - WIND_MARGIN) / WIND_CELL) * WIND_CELL` (same for y). When the origin moves, shift the stored cells by whole cells; new cells start still. Grow the arrays only when the view grows.
- **Self-advection**: semi-Lagrangian (each cell takes the velocity found at `pos - v*dt`, bilinear), so swirls travel with the air.

- [ ] **Step 1: Write the failing tests** in `wind.test.ts` (a `Wind` with `solid = () => false` unless stated; `view = { x: 0, y: 0, width: 320, height: 240 }`; `draftOn = false` unless stated; helper `at(w, x, y)` returns a fresh sample):
  - `still air stays still`: 60 steps of 1/60 → `at(160,120)` is `[0, 0]`.
  - `the pocket moves air ahead before a touch`: `push(100,120, 60,0, 6)` then `step(1/60)` → `at(100 + 12, 120)[0] > 0` (12 px is past the body, r = 6).
  - `the pocket pushes sideways outward`: same push → `at(100, 120 + 9)[1] > 0` and `at(100, 120 - 9)[1] < 0`.
  - `a still figure pushes nothing`: `push(100,120, 0,0, 6)`, step → `at(100,120)` is `[0, 0]`.
  - `gusts calm down`: push 10 frames, record peak `|v|` near the mover, then 120 steps → every sample within 40 px below 5 % of the peak.
  - `walls hold no air and block it`: `solid = (px) => px >= 160 && px < 176`; push at `(140,120)` moving +x at 200 px/s for 30 frames → `at(168,120)` is `[0,0]` and `|at(190,120)|` < 1 px/s.
  - `a blast pushes outward`: `blast(160,120)`, step → `at(190,120)[0] > 0`, `at(130,120)[0] < 0`, `at(160,150)[1] > 0`.
  - `a wake is narrow`: `wake(160,120, 200,0)`, step → `|at(160,124)| > 0`, `|at(160,160)| < 0.01`.
  - `the air stays put in the world when the view moves`: push at `(200,120)`, step; record `at(212,120)`; step with view moved by `(37, 11)` and `dt = 0` → same value within 1e-6.
  - `long or empty frames stay finite`: push, then `step(0)` and `step(0.5)` → samples finite and ≤ 160 px/s.
  - `the draft is gentle, slow and uneven`: `draftOn = true`, no pushes; over a 320×240 grid of points `|v| ≤ 3` and some `|v| > 0.5`; the same point at times t and t + 0.1 s differs by < 0.2 px/s; points 200 px apart differ.
- [ ] **Step 2:** `cd client && bash -lic 'npx vitest run src/game/wind.test.ts'` → fails (module missing).
- [ ] **Step 3:** implement `Wind` as above.
- [ ] **Step 4:** the same command → all pass; then the full client verification.
- [ ] **Step 5:** commit `Wind field: pockets, wakes, blasts, draft (#158)`.

### Task 2: Mood rides the wind

**Files:**
- Modify: `client/src/game/mood.ts`, `client/src/game/moodmath.ts` (only if a new pure helper is worth a test)
- Test: `client/src/game/mood.test.ts`

**Interfaces:**
- Consumes: `Wind` from Task 1.
- Produces (in `mood.ts`):
  ```ts
  /** A moving figure (r = body radius) or projectile (shot = true); v in px/s. */
  export interface AirMover { x: number; y: number; vx: number; vy: number; r: number; shot: boolean }
  // Mood:
  readonly on: { dust; smoke; embers; haze; drips; stir: boolean; draft: boolean }; // stir, draft default true
  /** Seconds a stirred cloud waits before it respawns (0 = at once). */
  stirDelay: number;                       // default 3 (STIR_DELAY)
  update(dt, view, torches, shots, movers: AirMover[] = []): void;
  get counts(): { clouds; smoke; embers; drips; stirred: number };
  /** The air velocity at (x, y), for tests and the demo's wind overlay. */
  airAt(x: number, y: number): [number, number];
  ```

Behaviour:
- `Wind` is built with `(px, py) => map.opaqueAt(px, py)`; `wind.draftOn = on.draft` each frame; `wind.step(dt, view)` once per `update`, after the pushes.
- With `on.stir`: each mover inside the view plus `MARGIN` tiles **and** on a seen tile (`seenAt`) calls `push` (figures) or `wake` (`shot: true`). Each fresh blast (the existing `BurstOnce` path in `updateFire`) also calls `wind.blast`. With `on.stir` off, nothing is pushed.
- **Clouds:** when `on.stir || on.draft`, a cloud's own random drift (`c.vx/c.vy` random walk) is replaced: the cloud moves with the wind sampled at its centre (keep the slight upward float, `-0.3` px/s²-ish as now). Otherwise #148's drift as today. Each speck keeps its small wander inside the cloud.
- **Stirring:** if any speck of a cloud samples a wind faster than `STIR_SPEED = 12` px/s (draft excluded by construction, `DRAFT_MAX` is 3), the cloud becomes stirred: every speck gets a world position and a velocity (start: the cloud's velocity), then follows the air (`v += (wind − v) · min(1, 6·dt)`), with drag, no pull to the cloud, and fades out over `rnd(1, 2)` s from its current alpha. When all its specks are gone the cloud waits `stirDelay` s (hidden), then respawns through `spawnCloud`. `counts.stirred` = clouds stirred or waiting.
- **Smoke and embers:** each frame add `0.6 ×` (smoke) / `0.4 ×` (embers) of the sampled wind to their position change, on top of their own motion.

- [ ] **Step 1: Write the failing tests** (reuse `setup`, `run`, `view` in `mood.test.ts`; extend `run` with an optional `movers` argument):
  - `a moving figure on a seen tile pushes air`: floor 60×40, lit; `mood.on.draft = false`; one frame with mover `{x:200,y:150,vx:80,vy:0,r:6,shot:false}` → `airAt(214,150)[0] > 0`.
  - `a mover on an unseen tile pushes nothing`: same, but `light.seenLit` 0 on the mover's tile → `airAt(214,150)` is `[0,0]`.
  - `stir off pushes nothing`: `on.stir = false` → `[0,0]`.
  - `movers outside the view push nothing`: mover at `x = 640 + 3*TILE` with view 640 wide → `airAt` near it `[0,0]`.
  - `a dash through the room stirs clouds, which come back`: `stirDelay = 3`; run 2 s to settle; then a mover sweeps the whole view in rows at 300 px/s for 4 s → `counts.stirred > 0`; then 2 s without movers → the stirred clouds are hidden or fading; after another 4 s → `counts.stirred === 0` and `counts.clouds === cloudCount(640,360)`.
  - `instant respawn`: `stirDelay = 0`, same sweep, then 2.5 s quiet → `counts.stirred === 0`.
  - `a blast pushes the air once`: `run` with a `LIGHT_KIND.Blast` shot at (300,150) for 1 frame → `airAt(330,150)[0] > 0`.
  - `stir and draft off keep #148's air`: both off, run 5 s → `airAt(100,100)` is `[0,0]` and the existing `Mood` tests still pass unchanged.
- [ ] **Step 2:** `bash -lic 'npx vitest run src/game/mood.test.ts'` → new tests fail.
- [ ] **Step 3:** implement as above.
- [ ] **Step 4:** the same command → pass; full client verification.
- [ ] **Step 5:** commit `Dungeon air rides the wind: stirred clouds, swaying smoke (#158)`.

### Task 3: The `?mood` demo moves things

**Files:**
- Modify: `client/src/game/MoodDemoScene.ts`

**Interfaces:**
- Consumes: `Mood.update(..., movers)`, `AirMover`, `mood.on.stir/draft`, `mood.stirDelay`, `mood.airAt` (Tasks 2).

Add, keeping the existing room, torches, lava, pool and fireball:
- **A walker:** the knight (`knight_m_run_anim_f0..3`, cycling at 10 fps, flipped by direction) walks a closed loop through the lit middle of the room at 60 px/s (a rounded rectangle around the pillar, inside x 3..12, y 6..11 tiles). Every 6 s it **dashes** for 0.25 s at 300 px/s along its path. Its old idle image goes; the other figures stay still (they push nothing, by design).
- **An arrow** (`weapon_arrow`, scale 0.6, rotated to its flight) crosses the room from west to east at y = 8.5 tiles at 260 px/s every 3 s, offset 1.5 s from the fireball.
- The fireball becomes a mover too (`shot: true`), as well as staying a light; its explosion already reaches `Mood` as a Blast light.
- Movers' velocity = the change of position since the last frame / `dt`; r = 6 for the knight (pack `baseR`), shots `r = 3`.
- **Buttons** added to the bar: `Stir: on/off`, `Draft: on/off`, `Respawn: instant/3 s` (toggles `stirDelay` 0 ↔ 3). URL: `?stir=0`, `?draft=0`, `?respawn=<seconds>` set the start values (like the existing `?dust=0`).
- **Wind overlay** with `?wind=1` only: a `Graphics` at a depth above the air drawing a short line per 16 px over the room from each point along `airAt` (length = speed × 0.2 px, capped 12), cleared and redrawn each frame (`Graphics.clear()` resets the line style; set it again).
- Update the file's header comment.

- [ ] **Step 1:** implement.
- [ ] **Step 2:** full client verification; then `cd client && npx vite --port 5173` against the running container (start it with `docker compose up --build -d` from the repo root if needed) and screenshot `http://localhost:5173/?mood` and `?mood&wind=1` with Playwright (`BROWSER=/usr/bin/brave-browser`, playwright-core from `tools/e2e`): no console errors, the walker visible, overlay lines around it. Stop Vite afterwards.
- [ ] **Step 3:** commit `?mood demo: a walker, a dash, an arrow, wind buttons (#158)`.

### Checkpoint (main session, not a subagent)

- Opus review of the branch so far.
- Deploy to the VPS as for #148 (backup first, `git bundle` of `feature/158-stirred-air`, `git fetch`, `git checkout -B`, `docker compose up -d --build`) and send the user the `?mood` link.
- Comment on #158: commits, how to judge (`Stir`, `Draft`, `Respawn` buttons, `&wind=1`). **Stop** for the user's verdict: respawn mode, strength of pushes, draft, smoke and ember share.

## Phase 2: in the game (after the user's verdict)

### Task 4: Apply the verdict and wire the game

**Files:**
- Create: `client/src/game/airmovers.ts`, `client/src/game/airmovers.test.ts`
- Modify: `client/src/game/GameScene.ts` (the `mood.update` call around line 756), the constants in `mood.ts` / `wind.ts` the user asked to change, `docs/TECHNICAL.md` (the dungeon air section), `docs/PLAYER_GUIDE.md` (where #148 describes the air)

**Interfaces:**
- Consumes: `AirMover` (Task 2).
- Produces:
  ```ts
  /** Turns positions per id into AirMovers with velocities from the change since the last frame. */
  export class MoverTracker {
    /** Starts a frame: ids not given again before the next `begin` are forgotten. */
    begin(dt: number): void;
    /** The mover for this id at (x, y), or null on its first frame, when it stood still, or when it jumped more than JUMP = 48 px. */
    track(id: number, x: number, y: number, r: number, shot: boolean): AirMover | null;
  }
  ```
  Speeds are clamped to 400 px/s. Ids are numbers; the own hero uses `-1`, own cosmetic shots `-(100000 + shot)` so they never collide with entity ids.

- [ ] **Step 1: Write the failing tests** in `airmovers.test.ts`: `first sight pushes nothing` (null), `a walk gives its velocity` (x +1 px at dt 1/60 → vx 60), `a jump of 60 px pushes nothing` (null), `standing still pushes nothing` (null), `a forgotten id starts again` (skip one frame → next `track` null).
- [ ] **Step 2:** run them → fail. **Step 3:** implement. **Step 4:** run → pass.
- [ ] **Step 5: Wire `GameScene`** before `this.mood.update(...)`: `tracker.begin(dt)`; figures = `this.ents` entries that are not torches, hazards, chests, barrels or projectiles (mimics count: a hopping mimic stirs air, a waiting one stands still), not `FLAG.DEAD`, and not `this.info.you`; `r = FIGURES[e.kind]?.baseR ?? 6`. The own hero from `pred.renderPos` (id −1) while `this.alive`. Projectiles: server projectile entities **not** owned by the player (`(e.extra >>> 16) !== this.info.you`), plus `this.cosmetics` (own shots), `r = 3`, `shot: true`. Pass the non-null results as `movers`.
- [ ] **Step 6:** apply the user's verdict (respawn delay, strengths) to the constants; update TECHNICAL.md (the `Wind` grid, pockets, draft, stirring, what pushes, the seen rule, the tracker) and PLAYER_GUIDE.md (one or two sentences: dust and smoke swirl around things moving through them).
- [ ] **Step 7: Verify:** full client verification; `docker compose up --build -d`; smoke runs `ElvenRanger,Paladin` and `Wizard,Barbarian` (CLAUDE.md step 5) print "no browser errors"; check a run with F3 that the frame rate does not drop (`?lag=150&jitter=40&loss=2` too).
- [ ] **Step 8:** commit `Stirred air in the game; docs (#158)`.

Then the main session: final Opus whole-branch review, ask the user about merging (#148 first) and deploying.
