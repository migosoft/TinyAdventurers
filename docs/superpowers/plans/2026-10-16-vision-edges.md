# Straight Vision Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tile-shaped edge of the hero's sight with straight, crisp shadow lines from a visibility polygon. Out-of-sight areas stay pure black.

**Architecture:**
- A pure function in `client/src/sim/vispoly.ts` computes the visibility polygon from the hero's pixel position.
- `client/src/game/visionmask.ts` draws it (plus the walls in the tile FOV) into a small canvas over the camera window, at 8 px per tile. A Phaser `Shader` game object just above the darkness turns everything outside it black.
- `LightView` lights floor one tile past the FOV, so the light continues under the mask's edge.
- Client only: no server or protocol change.

**Tech Stack:** TypeScript, Phaser 3.90 (WebGL), Vitest, playwright-core screenshots (`tools/e2e`).

**Spec:** [docs/superpowers/specs/2026-10-16-vision-edges-design.md](../specs/2026-10-16-vision-edges-design.md). The spike branch `spike/vision-edges` holds a working prototype (`client/src/sim/vispoly.ts`, `client/src/game/shadowview.ts`) for reference only. Do not merge it.

## Global Constraints

- Client only. `server/` and the protocol do not change. The server's per-tile visibility, the snapshot filter and targeting stay as they are.
- Crisp edge: **no blur**. Only the canvas's own antialiasing, at **`RES` = 8 px per tile**.
- Hidden areas are **pure black** (no map memory, no fog).
- Mask depth **`DEPTH.fog + 0.5`**: above the darkness (7000), below the drain beams (`DEPTH.beam` 7001) and the numbers (8000).
- Sight radius in px: **`(vision + 0.5) × TILE`** (`TILE` = 16).
- The light canvases stay at `SUB` = 2 px per tile. Do not change the light colours, tint or the darkvision mask.
- Comments and docs in English, matching the surrounding style (short `/** */` doc comments, plain sentences).
- Work on branch `feature/vision-edges` (already created from `main`; the spec is committed there).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A room touching the map edge** (no wall tiles, only void off-map): the polygon must stop at the map border and must not run off to the radius. Tested in Task 1 ("map edge").
2. **A blind hero (vision 0):** the radius is 8 px, and the polygon must be a small circle without errors or empty output. Tested in Task 1 (`sightRadius(0)` and the small-radius circle).
3. **A door that closes or a wall that changes while the hero stands still:** the mask must redraw (`mapChanged`) and not keep the old shape. A closed door blocking is tested in Task 1; the `mapChanged` wiring is checked in Task 2 by code review and in Task 4 by the smoke test.
4. **The browser window grows** (the camera's view gets bigger): the mask must rebuild bigger and leave no unmasked band at the right or bottom. The grow-only rule is in Task 2's `update`; Task 3's manual check resizes the `?lights` window.
5. **A spectator after death:** the mask follows the spectated teammate (`camX`, `camY`), not the dead hero. Wired in Task 2; checked in Task 4's smoke run if practical.

---

## File Structure

| File | Responsibility |
|---|---|
| `client/src/sim/vispoly.ts` (new) | Pure geometry: wall segments, the visibility polygon, the sight radius in px. No Phaser. |
| `client/src/sim/vispoly.test.ts` (new) | Unit tests for the above. |
| `client/src/game/visionmask.ts` (new) | `VisionMask`: the canvas, the shader object and its redraw rules. |
| `client/src/game/lightview.ts` (modify) | `seenForLight` (pure, tested), `LightView.wide`, `LightView.seen`. |
| `client/src/game/lightview.test.ts` (modify) | Tests for `seenForLight`. |
| `client/src/game/GameScene.ts` (modify) | Creates, updates and invalidates the mask. |
| `client/src/game/LightsDemoScene.ts` (modify) | `?lights`: pillars, click moves the viewer, `&at=`, E toggles old/new edges. |
| `tools/e2e/lights-shot.mjs` (modify) | An extra query argument and a file-name prefix for screenshots. |
| Docs | `docs/TECHNICAL.md`, `docs/TODO.md`, `README.md`, `HANDOFF.md`. |

---

### Task 1: The visibility polygon (`sim/vispoly.ts`)

**Files:**
- Create: `client/src/sim/vispoly.ts`
- Test: `client/src/sim/vispoly.test.ts`

**Interfaces:**
- Consumes: `TileMap` (`client/src/sim/map.ts`: `opaque(x, y)` is true for walls, void, closed doors and off-map tiles; `TILE` = 16), `TILE_ID` (`client/src/generated/defs.ts`: `Floor` 1, `Wall` 2, `DoorOpen` 3, `DoorClosed` 4).
- Produces:
  - `export type Segment = [number, number, number, number]` (x0, y0, x1, y1 in px)
  - `export function wallSegments(map: TileMap, px: number, py: number, r: number): Segment[]`
  - `export function visibilityPolygon(map: TileMap, px: number, py: number, r: number, steps?: number): number[]` (flat `[x0, y0, x1, y1, ...]`, sorted by angle from -π)
  - `export function sightRadius(vision: number): number`, which returns `(vision + 0.5) * TILE`

- [ ] **Step 1: Write the failing tests**

Create `client/src/sim/vispoly.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from './map';
import { sightRadius, visibilityPolygon, wallSegments } from './vispoly';

/** A map from rows of characters: '#' wall, 'D' closed door, 'd' open door, anything else floor. */
function grid(rows: string[]): TileMap {
  const w = rows[0].length;
  const h = rows.length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      tiles[y * w + x] = c === '#' ? TILE_ID.Wall : c === 'D' ? TILE_ID.DoorClosed : c === 'd' ? TILE_ID.DoorOpen : TILE_ID.Floor;
    }),
  );
  return new TileMap(w, h, tiles);
}

/** An open room w×h tiles inside a ring of walls, with optional extra walls. */
function room(w: number, h: number, walls: [number, number][] = []): TileMap {
  const rows = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 || walls.some(([a, b]) => a === x && b === y) ? '#' : '.')).join(''),
  );
  return grid(rows);
}

/** The polygon's points as [x, y, distance from (px, py), angle]. */
function points(poly: number[], px: number, py: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < poly.length; i += 2) out.push([poly[i], poly[i + 1], Math.hypot(poly[i] - px, poly[i + 1] - py), Math.atan2(poly[i + 1] - py, poly[i] - px)]);
  return out;
}

describe('wallSegments', () => {
  it('merges each straight wall into one segment', () => {
    const map = grid(['#######', '#.....#', '#.....#', '#.....#', '#######']);
    const segs = wallSegments(map, 3.5 * TILE, 2.5 * TILE, 100);
    expect(segs).toHaveLength(4);
    expect(segs).toEqual(
      expect.arrayContaining([
        [16, 16, 96, 16], // top
        [16, 64, 96, 64], // bottom
        [16, 16, 16, 64], // left
        [96, 16, 96, 64], // right
      ]),
    );
  });
});

describe('visibilityPolygon', () => {
  it('is a circle of radius r in an open room', () => {
    const map = room(21, 21);
    for (const [px, py] of [
      [10.5 * TILE, 10.5 * TILE],
      [10 * TILE, 10 * TILE], // exactly on a tile corner
    ]) {
      const pts = points(visibilityPolygon(map, px, py, 5 * TILE), px, py);
      expect(pts.length).toBeGreaterThanOrEqual(96);
      for (const [, , d] of pts) expect(d).toBeCloseTo(5 * TILE, 6);
    }
  });

  it('is a small circle for a blind hero (vision 0)', () => {
    expect(sightRadius(0)).toBe(8);
    expect(sightRadius(9)).toBe(9.5 * TILE);
    const map = room(5, 5);
    const pts = points(visibilityPolygon(map, 2.5 * TILE, 2.5 * TILE, sightRadius(0)), 2.5 * TILE, 2.5 * TILE);
    expect(pts.length).toBeGreaterThanOrEqual(96);
    for (const [, , d] of pts) expect(d).toBeCloseTo(8, 6);
  });

  it('casts a straight shadow wedge behind a pillar', () => {
    // Viewer at (168, 168), the middle of tile (10, 10); pillar at tile (13, 10): its near face is x = 208, y 160..176.
    const map = room(21, 21, [[13, 10]]);
    const [px, py] = [168, 168];
    const r = 8 * TILE;
    const pts = points(visibilityPolygon(map, px, py, r), px, py);
    const half = Math.atan2(8, 40); // the wedge's half angle, 0.197
    const inWedge = pts.filter(([, , , a]) => Math.abs(a) < half - 0.01);
    const beside = pts.filter(([, , , a]) => Math.abs(a) > half + 0.05 && Math.abs(a) < 0.6);
    expect(inWedge.length).toBeGreaterThan(0);
    expect(beside.length).toBeGreaterThan(0);
    // In the wedge every ray stops on the pillar's near face.
    for (const [x] of inWedge) expect(x).toBeCloseTo(208, 6);
    // Just beside it the view is open to the radius (the room's walls are 9.5 tiles away).
    for (const [, , d] of beside) expect(d).toBeCloseTo(r, 6);
  });

  it('stays inside a corridor', () => {
    const map = grid(['###########', '#.........#', '###########']);
    const [px, py] = [1.5 * TILE, 1.5 * TILE];
    const pts = points(visibilityPolygon(map, px, py, 8 * TILE), px, py);
    for (const [x, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(y).toBeLessThanOrEqual(32 + 1e-6);
      expect(x).toBeGreaterThanOrEqual(16 - 1e-6);
    }
    expect(Math.max(...pts.map(([x]) => x))).toBeCloseTo(px + 8 * TILE, 6);
  });

  it('is blocked by a closed door, not by an open one', () => {
    const [px, py] = [1.5 * TILE, 1.5 * TILE];
    const far = (rows: string[]) => Math.max(...points(visibilityPolygon(grid(rows), px, py, 10 * TILE), px, py).map(([x]) => x));
    expect(far(['#########', '#...D...#', '#########'])).toBeCloseTo(4 * TILE, 6);
    expect(far(['#########', '#...d...#', '#########'])).toBeCloseTo(8 * TILE, 6);
  });

  it('stops at the map edge where a room has no walls', () => {
    const map = grid(['.....', '.....', '.....', '.....', '.....']);
    const pts = points(visibilityPolygon(map, 2.5 * TILE, 2.5 * TILE, 10 * TILE), 2.5 * TILE, 2.5 * TILE);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(5 * TILE + 1e-6);
      expect(y).toBeLessThanOrEqual(5 * TILE + 1e-6);
    }
    expect(Math.max(...pts.map(([x]) => x))).toBeCloseTo(5 * TILE, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/sim/vispoly.test.ts`
Expected: FAIL, because `./vispoly` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `client/src/sim/vispoly.ts`:

```ts
// The visibility polygon: the area seen from a pixel position, bounded by
// walls and by the sight radius. Wall edges that face an open tile are merged
// into long segments; rays go to every segment end (and just beside it, so a
// ray that grazes a corner continues behind it) plus at even angles, each
// stopping at the nearest segment or at the radius, so the outer edge is a
// circle. Drawn by game/visionmask.ts; the server's visibility stays per tile.
import { TILE, type TileMap } from './map';

/** A wall edge in px: x0, y0, x1, y1. */
export type Segment = [number, number, number, number];

/** The sight radius in px for `vision` tiles: it covers the tiles whose centres the shadowcast reaches. */
export function sightRadius(vision: number): number {
  return (vision + 0.5) * TILE;
}

/** Runs of tile edges between an opaque and an open tile, within `r` px (plus a tile) of (px, py). Off-map counts as opaque. */
export function wallSegments(map: TileMap, px: number, py: number, r: number): Segment[] {
  const x0 = Math.floor((px - r) / TILE) - 1;
  const y0 = Math.floor((py - r) / TILE) - 1;
  const x1 = Math.floor((px + r) / TILE) + 1;
  const y1 = Math.floor((py + r) / TILE) + 1;
  const segs: Segment[] = [];
  // Horizontal edges: the line between row y-1 and row y. A run continues while the opaque side stays the same.
  for (let y = y0; y <= y1 + 1; y++) {
    let start = 0;
    let side = 0;
    for (let x = x0; x <= x1 + 1; x++) {
      const above = map.opaque(x, y - 1);
      const below = map.opaque(x, y);
      const s = x <= x1 && above !== below ? (above ? 1 : 2) : 0;
      if (s !== side) {
        if (side) segs.push([start * TILE, y * TILE, x * TILE, y * TILE]);
        start = x;
        side = s;
      }
    }
  }
  // Vertical edges: the line between column x-1 and column x.
  for (let x = x0; x <= x1 + 1; x++) {
    let start = 0;
    let side = 0;
    for (let y = y0; y <= y1 + 1; y++) {
      const left = map.opaque(x - 1, y);
      const right = map.opaque(x, y);
      const s = y <= y1 && left !== right ? (left ? 1 : 2) : 0;
      if (s !== side) {
        if (side) segs.push([x * TILE, start * TILE, x * TILE, y * TILE]);
        start = y;
        side = s;
      }
    }
  }
  return segs;
}

/** Distance along the unit ray (dx, dy) from (ox, oy) to the nearest segment, at most `max`. */
function cast(ox: number, oy: number, dx: number, dy: number, segs: Segment[], max: number): number {
  let best = max;
  for (const [ax, ay, bx, by] of segs) {
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue; // parallel
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
    const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
    if (t > 0 && t < best && u >= -1e-9 && u <= 1 + 1e-9) best = t;
  }
  return best;
}

/** Ray angle offset beside a segment end. */
const EPS = 1e-4;

/** The area seen from (px, py) within `r` px, as a flat [x0, y0, x1, y1, ...] polygon sorted by angle (from -π). */
export function visibilityPolygon(map: TileMap, px: number, py: number, r: number, steps = 96): number[] {
  const segs = wallSegments(map, px, py, r);
  const angles: number[] = [];
  for (let i = 0; i < steps; i++) angles.push((i / steps) * Math.PI * 2 - Math.PI);
  for (const [ax, ay, bx, by] of segs)
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ]) {
      if ((x - px) ** 2 + (y - py) ** 2 > r * r * 1.1) continue;
      const a = Math.atan2(y - py, x - px);
      angles.push(a - EPS, a, a + EPS);
    }
  angles.sort((a, b) => a - b);
  const out: number[] = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const t = cast(px, py, dx, dy, segs, r);
    out.push(px + dx * t, py + dy * t);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/sim/vispoly.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the whole client suite and the typecheck**

Run: `cd client && npm test && npm run typecheck`
Expected: all tests pass (65 before, now 72); `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add client/src/sim/vispoly.ts client/src/sim/vispoly.test.ts
git commit -m "Vision edges: visibility polygon from the hero's pixel position

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The vision mask, `LightView` and `GameScene`

**Files:**
- Create: `client/src/game/visionmask.ts`
- Modify: `client/src/game/lightview.ts` (header comment; new `seenForLight`; `LightView.wide`, `LightView.seen`; the `visible` line in `update`, currently `const visible = this.fov.isVisible(x, y);`)
- Modify: `client/src/game/lightview.test.ts`
- Modify: `client/src/game/GameScene.ts` (imports near line 23, the field near line 96, the constructor call at line 153, the `Tile` event near line 371, the update at lines 604-606)

**Interfaces:**
- Consumes: `visibilityPolygon(map, px, py, r)` and `sightRadius(vision)` from Task 1; `DEPTH.fog` (7000) from `client/src/game/effects.ts`.
- Produces:
  - `export function seenForLight(inFov: (x: number, y: number) => boolean, opaque: (x: number, y: number) => boolean, x: number, y: number, wide: boolean): boolean` in `lightview.ts`
  - `LightView.wide: boolean` (default `true`), `LightView.seen(x: number, y: number): boolean`
  - `export class VisionMask { constructor(scene: Phaser.Scene, map: TileMap); enabled: boolean; update(view: Phaser.Geom.Rectangle, px: number, py: number, radius: number, fov: { seen(x: number, y: number): boolean }): void; mapChanged(): void }`

- [ ] **Step 1: Write the failing test for `seenForLight`**

In `client/src/game/lightview.test.ts`, add `seenForLight` to the import list from `./lightview` and append:

```ts
describe('seenForLight', () => {
  // Row 0: floor; FOV = only tile (1, 0). Tile (3, 0) is a wall.
  const fov = (x: number, y: number) => x === 1 && y === 0;
  const opaque = (x: number, _y: number) => x === 3;
  it('keeps the FOV', () => {
    expect(seenForLight(fov, opaque, 1, 0, true)).toBe(true);
    expect(seenForLight(fov, opaque, 1, 0, false)).toBe(true);
  });
  it('adds open tiles next to an open FOV tile when wide', () => {
    expect(seenForLight(fov, opaque, 2, 0, true)).toBe(true);
    expect(seenForLight(fov, opaque, 0, 1, true)).toBe(true); // diagonal
    expect(seenForLight(fov, opaque, 2, 0, false)).toBe(false);
  });
  it('never adds walls or tiles two steps away', () => {
    expect(seenForLight(fov, opaque, 3, 0, true)).toBe(false);
    expect(seenForLight(fov, opaque, 4, 0, true)).toBe(false);
  });
  it('does not grow from a wall in the FOV', () => {
    const wallFov = (x: number, y: number) => x === 3 && y === 0;
    expect(seenForLight(wallFov, opaque, 4, 0, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/game/lightview.test.ts`
Expected: FAIL, because `seenForLight` is not exported (it's `undefined`, so it is not a function).

- [ ] **Step 3: Implement `seenForLight` and the `LightView` changes**

In `client/src/game/lightview.ts`:

1. Replace the header comment's first sentence block so it reads:

```ts
// The light canvas: darkness everywhere except tiles in the viewer's sight
// that a light reaches, plus an additive colour tint per tile from every light
// (static ones from LightField, moving ones from the snapshot). The light is
// worked out per tile, then upsampled to SUB pixels per tile (`upsample`; dark
// tiles are set back to black, `blackenDarkTiles`) and drawn with LINEAR filtering, scaled up by TILE / SUB. Redrawn every frame
// inside the camera window (cheap: about 60 x 34 tiles). The edge of sight is
// drawn by the vision mask (visionmask.ts) on top; here, floor one tile past
// the FOV counts as seen (`seenForLight`), so the light reaches under it.
```

2. Above `export class LightView`, add:

```ts
/**
 * A tile counts as seen for the light canvases when it is in the FOV, or
 * (`wide`) is open and next to an open FOV tile (8 around). The light then
 * reaches under the vision mask's straight edge, so no tile step shows
 * through it. Walls outside the FOV stay black.
 */
export function seenForLight(inFov: (x: number, y: number) => boolean, opaque: (x: number, y: number) => boolean, x: number, y: number, wide: boolean): boolean {
  if (inFov(x, y)) return true;
  if (!wide || opaque(x, y)) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inFov(x + dx, y + dy) && !opaque(x + dx, y + dy)) return true;
  return false;
}
```

3. In `class LightView`, after `private tmp: Float32Array;`, add:

```ts
  /** Light floor one tile past the FOV for the vision mask (false: the old tile edges, ?lights E). */
  wide = true;
  private inFov = (x: number, y: number) => this.fov.isVisible(x, y);
  private opaque = (x: number, y: number) => this.map.opaque(x, y);
```

4. After the `mapChanged()` method, add:

```ts
  /** The tile is in the viewer's FOV (walls included). */
  seen(x: number, y: number): boolean {
    return this.fov.isVisible(x, y);
  }
```

5. In `update`, replace `const visible = this.fov.isVisible(x, y);` with:

```ts
        const visible = seenForLight(this.inFov, this.opaque, x, y, this.wide);
```

- [ ] **Step 4: Run the tests**

Run: `cd client && npx vitest run src/game/lightview.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `client/src/game/visionmask.ts`**

```ts
// The vision mask: black over everything the hero cannot see, with straight
// edges. A small canvas over the camera window (RES px per tile) holds the
// visibility polygon (sim/vispoly.ts) and the walls in the tile FOV in white
// (the polygon stops at a wall's face, so a wall in sight is added whole); a
// Shader game object just above the darkness draws black where the canvas is
// not white. A game object, not a camera post effect, so what is drawn above
// the darkness (numbers, the lich's drain beams) stays visible. The canvas is
// redrawn only when the viewer, the window or the map changes.
import Phaser from 'phaser';
import { TILE, type TileMap } from '../sim/map';
import { visibilityPolygon } from '../sim/vispoly';
import { DEPTH } from './effects';

/** Canvas pixels per tile: enough for a straight, antialiased edge. */
const RES = 8;
/** Tiles of canvas beyond the camera window on each side. */
const BORDER = 2;
const KEY = 'visionmask';

// outTexCoord goes up the quad (0 = its bottom); the canvas rows go down.
const FRAG = `
precision mediump float;
uniform sampler2D iChannel0;
varying vec2 outTexCoord;
void main() {
  float seen = texture2D(iChannel0, vec2(outTexCoord.x, 1.0 - outTexCoord.y)).r;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - seen);
}`;

export class VisionMask {
  private canvas?: Phaser.Textures.CanvasTexture;
  private shader?: Phaser.GameObjects.Shader;
  private cols = 0;
  private rows = 0;
  /** What the canvas shows now: window origin, viewer, radius. Empty: redraw. */
  private last = '';
  /** Off: no mask, the old tile edges (?lights E). */
  enabled = true;

  constructor(
    private scene: Phaser.Scene,
    private map: TileMap,
  ) {}

  /** (Re)creates the canvas and the shader for a window of cols×rows tiles. */
  private build(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.shader?.destroy();
    if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
    this.canvas = this.scene.textures.createCanvas(KEY, cols * RES, rows * RES)!;
    const base = new Phaser.Display.BaseShader(KEY, FRAG);
    this.shader = this.scene.add.shader(base, 0, 0, cols * TILE, rows * TILE).setOrigin(0, 0).setDepth(DEPTH.fog + 0.5);
    // Clamp, not the default repeat: a non-power-of-two texture that repeats is incomplete in WebGL 1 (it would sample black).
    this.shader.setChannel0(KEY, { wrapS: 'clamp_to_edge', wrapT: 'clamp_to_edge', minFilter: 'linear', magFilter: 'linear' });
    this.last = '';
  }

  /**
   * `view`: the camera's world view; (px, py): the viewer in px; `radius`: its
   * sight in px (`sightRadius`); `fov.seen`: the tile FOV, for walls in sight.
   */
  update(view: Phaser.Geom.Rectangle, px: number, py: number, radius: number, fov: { seen(x: number, y: number): boolean }): void {
    const cols = Math.ceil(view.width / TILE) + 2 * BORDER + 1;
    const rows = Math.ceil(view.height / TILE) + 2 * BORDER + 1;
    // Grow only, so a shrinking window does not rebuild every frame.
    if (cols > this.cols || rows > this.rows) this.build(Math.max(cols, this.cols), Math.max(rows, this.rows));
    const shader = this.shader!;
    shader.setVisible(this.enabled);
    if (!this.enabled) return;
    const ox = Math.floor(view.x / TILE) - BORDER;
    const oy = Math.floor(view.y / TILE) - BORDER;
    shader.setPosition(ox * TILE, oy * TILE);
    const key = `${ox},${oy},${px.toFixed(1)},${py.toFixed(1)},${radius}`;
    if (key === this.last) return;
    this.last = key;

    const canvas = this.canvas!;
    const ctx = canvas.getContext();
    const s = RES / TILE;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.cols * RES, this.rows * RES);
    ctx.fillStyle = '#fff';
    const poly = visibilityPolygon(this.map, px, py, radius);
    ctx.beginPath();
    for (let i = 0; i < poly.length; i += 2) ctx.lineTo((poly[i] - ox * TILE) * s, (poly[i + 1] - oy * TILE) * s);
    ctx.closePath();
    ctx.fill();
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) if (this.map.opaque(ox + x, oy + y) && fov.seen(ox + x, oy + y)) ctx.fillRect(x * RES, y * RES, RES, RES);
    canvas.refresh();
    // refresh() resets the filter to NEAREST (pixelArt).
    canvas.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  /** A tile changed (a door): redraw on the next update. */
  mapChanged(): void {
    this.last = '';
  }
}
```

Note: if the mask is all black in the browser (the texture is not bound), pass the texture at creation instead, as the spike did: `this.scene.add.shader(base, 0, 0, cols * TILE, rows * TILE, [KEY])`, and drop the `setChannel0` call. If `setChannel0`'s typings reject the `textureData` object, cast it: `{ ... } as unknown as object`. The Phaser typings declare it as `any` in 3.90, so no cast is expected.

- [ ] **Step 6: Wire it into `GameScene`**

In `client/src/game/GameScene.ts`:

1. Imports: next to `import { LightView, nextDarkvision } from './lightview';` add `import { VisionMask } from './visionmask';`, and add `import { sightRadius } from '../sim/vispoly';` next to the other `../sim/` imports.
2. Fields: after `private lightView!: LightView;` add `private visionMask!: VisionMask;`.
3. After `this.lightView = new LightView(this, this.map, this.light);` (line 153) add `this.visionMask = new VisionMask(this, this.map);`.
4. In the `case 'Tile':` branch, after `this.lightView.mapChanged();` add `this.visionMask.mapChanged();`.
5. Replace lines 604-606:

```ts
    const darkvision = (this.lastSnap?.me.darkvision ?? 0) / 100;
    this.lightView.update(this.cameras.main.worldView, camX, camY, this.lastSnap?.lights ?? [], now, darkvision, this.lastSnap?.me.vision ?? CONST.FOV_RADIUS);
    syncDarkvisionFX(this.cameras.main, darkvision, this.lightView.mask, [this.map.w * TILE, this.map.h * TILE]);
```

with:

```ts
    const darkvision = (this.lastSnap?.me.darkvision ?? 0) / 100;
    const vision = this.lastSnap?.me.vision ?? CONST.FOV_RADIUS;
    this.lightView.update(this.cameras.main.worldView, camX, camY, this.lastSnap?.lights ?? [], now, darkvision, vision);
    this.visionMask.update(this.cameras.main.worldView, camX, camY, sightRadius(vision), this.lightView);
    syncDarkvisionFX(this.cameras.main, darkvision, this.lightView.mask, [this.map.w * TILE, this.map.h * TILE]);
```

`camX`, `camY` are the own predicted position, or the spectated teammate's while dead (the code just above), so the mask follows the same viewer as the light canvas.

- [ ] **Step 7: Run all checks**

Run: `cd client && npm test && npm run typecheck && npm run build`
Expected: every test passes (76); `tsc` is clean; the Vite build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/visionmask.ts client/src/game/lightview.ts client/src/game/lightview.test.ts client/src/game/GameScene.ts
git commit -m "Vision edges: the vision mask over the darkness, light one tile past the FOV

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The `?lights` demo and screenshots

**Files:**
- Modify: `client/src/game/LightsDemoScene.ts`
- Modify: `tools/e2e/lights-shot.mjs`

**Interfaces:**
- Consumes: `VisionMask` (Task 2: `enabled`, `update(view, px, py, radius, fov)`), `LightView.wide` and `LightView.seen` (Task 2), `sightRadius` (Task 1).
- Produces: `?lights` query keys `&at=x,y` (viewer in tiles) and `&edges=old`; keys E (toggle edges) and click (move the viewer). `lights-shot.mjs [baseUrl] [outDir] [darkvision] [extraQuery] [prefix]`.

- [ ] **Step 1: Edit `LightsDemoScene.ts`**

1. Header comment: after the line `// \`&slow=N\` slows time. Key V cycles ...` block, add:

```ts
// Two pillars in room 1 show the straight shadow edges (the vision mask). Click
// moves the viewer (`&at=x,y` in tiles starts it there); E toggles old (tile)
// and new edges (`&edges=old` starts with the old ones).
```

2. Imports: add `import { VisionMask } from './visionmask';` and `import { sightRadius } from '../sim/vispoly';`.
3. In `buildMap()`, after `floor(15, 5, 28, 13); // room 2: the dark pocket` add:

```ts
  tiles[6 * W + 5] = TILE_ID.Wall; // two pillars in room 1, for the shadow edges
  tiles[13 * W + 9] = TILE_ID.Wall;
```

4. Fields: after `private view!: LightView;` add:

```ts
  private mask!: VisionMask;
  /** The viewer in px: `&at=x,y` (tiles) or the middle of room 1; a click moves it. */
  private viewer = (() => {
    const at = new URLSearchParams(location.search).get('at')?.split(',').map(Number);
    return at?.length === 2 && at.every(Number.isFinite) ? { x: at[0] * TILE, y: at[1] * TILE } : { x: (VIEWER[0] + 0.5) * TILE, y: (VIEWER[1] + 0.5) * TILE };
  })();
  /** Straight edges (the vision mask) or the old tile edges (E, `&edges=old`). */
  private straight = new URLSearchParams(location.search).get('edges') !== 'old';
  private dot!: Phaser.GameObjects.Arc;
```

5. After `this.view = new LightView(this, map, this.field);` add:

```ts
    this.mask = new VisionMask(this, map);
    this.dot = this.add.circle(0, 0, 2, 0xffffff).setDepth(DEPTH.numbers);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!map.opaqueAt(p.worldX, p.worldY)) this.viewer = { x: p.worldX, y: p.worldY };
    });
```

6. Next to the existing `keydown-V` handler add:

```ts
    this.input.keyboard!.on('keydown-E', () => {
      this.straight = !this.straight;
      this.showCaption();
    });
```

7. In `showCaption()`, change the second caption line to:

```ts
        `\ndarkvision ${Math.round(this.darkvision * 100)}% (V), edges ${this.straight ? 'straight' : 'old'} (E), click moves the viewer`,
```

8. In `update`, replace the line `this.view.update(this.cameras.main.worldView, (VIEWER[0] + 0.5) * TILE, (VIEWER[1] + 0.5) * TILE, moving, this.t, this.darkvision, CONST.FOV_RADIUS);` with:

```ts
    this.view.wide = this.straight;
    this.view.update(this.cameras.main.worldView, this.viewer.x, this.viewer.y, moving, this.t, this.darkvision, CONST.FOV_RADIUS);
    this.mask.enabled = this.straight;
    this.mask.update(this.cameras.main.worldView, this.viewer.x, this.viewer.y, sightRadius(CONST.FOV_RADIUS), this.view);
    this.dot.setPosition(this.viewer.x, this.viewer.y);
```

- [ ] **Step 2: Extend `tools/e2e/lights-shot.mjs`**

Change the usage comment and the arguments:

```js
// Screenshot of the lights demo page (?lights) every 0.5 s (its loop is 4 s).
// Usage: node lights-shot.mjs [baseUrl] [outDir] [darkvision] [extraQuery] [prefix]
// darkvision (0..1, e.g. 0.5) starts the viewer with it (&dv=) and names the shots lights-dv0.5-N.png.
// extraQuery is appended to the URL (e.g. "&at=13.5,9.5&edges=old"); prefix replaces "lights" in the file names.
```

```js
const dv = process.argv[4] || '';
const extra = process.argv[5] ?? '';
const prefix = process.argv[6] ?? 'lights';
```

```js
await p.goto(`${base}?lights${dv ? `&dv=${dv}` : ''}${extra}`);
```

```js
  await p.screenshot({ path: `${out}/${prefix}${dv ? `-dv${dv}-` : ''}${i}.png` });
```

(`dv` now defaults to `''`, so an empty argument `""` skips it.)

- [ ] **Step 3: Typecheck and tests**

Run: `cd client && npm run typecheck && npm test`
Expected: clean, all tests pass.

- [ ] **Step 4: Screenshots**

Start the client dev server in the background: `cd client && npm run dev` (port 5173). Then, from `tools/e2e` (run `npm install` there once if `node_modules` is missing), take the shots:

```bash
node lights-shot.mjs http://localhost:5173/ shots "" "&at=10.5,8.5" edges
node lights-shot.mjs http://localhost:5173/ shots "" "&at=10.5,8.5&edges=old" edges-old
node lights-shot.mjs http://localhost:5173/ shots "" "&at=13.5,9.5" doorway
node lights-shot.mjs http://localhost:5173/ shots 1 "&at=4.5,8.5" dv
```

Expected: each run prints `no errors`. Look at `shots/edges0.png`, `edges-old0.png`, `doorway0.png` and `dv-dv1-0.png`:
- `edges0.png`: straight, crisp shadow wedges behind both pillars, the room's walls fully drawn, no light through the pillars;
- `edges-old0.png`: the old tile-stepped edge, no pillar wedges;
- `doorway0.png`: two clean cones, into room 1 and into room 2, black around them;
- `dv-dv1-0.png`: the same straight edges with darkvision on, with no black band or grey ring along the edge.

Manual check (Review Focus 4): open `http://localhost:5173/?lights` in a browser and make the window larger after the page loads. Expected: no unmasked strip on the right or bottom.

The `shots/` folder is local output; do not commit it (check `git status`).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/LightsDemoScene.ts tools/e2e/lights-shot.mjs
git commit -m "Vision edges: ?lights with pillars, click to move the viewer, E for old/new edges

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cost check, smoke test and docs

**Files:**
- Modify: `docs/TECHNICAL.md` (§7 "The light canvas" bullets and "Draw order", §12 tests list, §13 known limitations)
- Modify: `docs/TODO.md` (priority item 2, the "Vision edges" bullet in "Vision and darkvision follow-ups", the "Pillars" section's references to "the vision edges (2)")
- Modify: `README.md` (the `?lights` line, around line 92)
- Modify: `HANDOFF.md` (the "Next session" section and a new "Last feature" section)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing in code.

- [ ] **Step 1: Measure the polygon's cost**

Write a throwaway script outside the repo (for example in the session scratchpad), `bench.ts`:

```ts
import fixtures from 'C:/Users/Goll/Desktop/TinyAdventurers/client/src/generated/fixtures.json';
import { TileMap, TILE } from 'C:/Users/Goll/Desktop/TinyAdventurers/client/src/sim/map';
import { sightRadius, visibilityPolygon } from 'C:/Users/Goll/Desktop/TinyAdventurers/client/src/sim/vispoly';

const map = new TileMap(fixtures.w, fixtures.h, Uint8Array.from(fixtures.tiles));
const spots: [number, number][] = [];
for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (!map.opaque(x, y)) spots.push([(x + 0.5) * TILE, (y + 0.5) * TILE]);
const t0 = performance.now();
for (const [px, py] of spots) visibilityPolygon(map, px, py, sightRadius(9));
console.log(`${spots.length} polygons, ${((performance.now() - t0) / spots.length).toFixed(3)} ms each`);
```

Run it with `cd client && npx tsx <path>/bench.ts`.
Expected: well under 1 ms per polygon. Note the number for HANDOFF. If it is over 1 ms, stop and report; do not optimise without the user.

- [ ] **Step 2: Smoke test with two players**

This needs the game server running: `docker compose up --build` from the repo root (port 8080). Then:

```bash
cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots Wizard,Paladin
```

Expected: no browser errors. Look at the in-game screenshots it writes to `tools/e2e/shots/`: the edge of sight is straight and walls in sight are drawn whole. If Docker is not available, say so in the report and in HANDOFF, rather than claiming the smoke test passed.

- [ ] **Step 3: Update `docs/TECHNICAL.md`**

1. In §7 "The light canvas", after the "Two canvas textures" bullet and its sub-bullets, add:

```markdown
- **The vision mask (`game/visionmask.ts`, `sim/vispoly.ts`):** the edge of sight is drawn as straight shadow lines, not along the tile grid (the user's request, 2026-10-16).
  - `visibilityPolygon` (pure, `vispoly.test.ts`) builds the area seen from the viewer's **pixel** position. Wall edges that face open tiles are merged into segments, and rays go to every segment end (± 1e-4 rad, so a ray grazing a corner continues behind it) and at 96 even angles. Each ray stops at the nearest segment or at the sight radius `sightRadius(vision)` = `(vision + 0.5) × TILE` px, so the outer edge is a circle covering the tiles the shadowcast reaches.
  - `VisionMask` draws that polygon in white into a canvas over the camera window (plus 2 tiles a side) at **8 px per tile**, plus every wall tile in the tile FOV whole (the polygon stops at a wall's face, so it would cut off brick faces and rims). A Phaser `Shader` game object at `DEPTH.fog + 0.5` draws black with alpha `1 − mask`. The edge is crisp (only the canvas's antialiasing): a blurred fade was tried and made the shadow behind a pillar look too wide. A game object and not a camera post effect, so the drain beams and the numbers above the darkness stay visible. The canvas is redrawn and uploaded only when the window origin, the viewer (to 0.1 px), the radius or the map (`mapChanged`, on `Ev::Tile`) changes; the window only grows.
  - `LightView` counts open tiles next to an open FOV tile as seen (`seenForLight`), so the light continues under the mask's edge and no tile step shows through its antialiasing. Walls outside the FOV stay black.
  - Out of sight is pure black. A dim map memory and a fog look were demoed and rejected (2026-10-16).
```

2. In the "Draw order" bullet, after "Above the darkness:", insert "the vision mask (`DEPTH.fog + 0.5`), then".
3. In §12 (tests), add `client/src/sim/vispoly.test.ts` (the polygon: circle, pillar wedge, corridor, doors, map edge, blind radius) and the `seenForLight` cases in `lightview.test.ts`, matching the list's format.
4. In §13 (known limitations), add:

```markdown
- **Drawn edge versus server visibility:** the vision mask is exact geometry from the hero's pixel position, while the server's visibility is a tile shadowcast from the hero's tile. They differ by up to a tile at the edges: a monster on a server-visible tile can stand partly in the drawn black, and a slanted look through a 1-tile gap shows a thin wedge where the server counts whole tiles. Walls in sight are shown per tile.
```

- [ ] **Step 4: Update `docs/TODO.md`**

1. Priority item 2 (`2. **Straight, softly fading vision edges** ...`): replace its text with `2. **Vision edges:** done (2026-10-16, branch \`feature/vision-edges\`): straight, crisp shadow edges from a visibility polygon (TECHNICAL §7 "The vision mask").` Keep the number, because other items refer to priorities by number.
2. In "Vision and darkvision follow-ups", replace the whole "Vision edges" bullet and its sub-bullets with:

```markdown
- **Vision edges follow-ups** (built 2026-10-16): walls in sight are shown per tile (their edge follows the bricks); the drawn polygon and the server's tile FOV differ by up to a tile (TECHNICAL §13). If monsters half in the drawn black bother anyone in play, make the polygon a little generous for entities, or cast from a few points around the hero.
```

3. In the "Pillars" section, change "With the soft vision edges (priority 2)" to "With the vision edges (built 2026-10-16)", change "**Order:** after the vision edges; independent of other work." to "**Order:** independent of other work (the vision edges are built).", and in tier 3 item 11 change "best after the vision edges (2), which give them their shadows." to "the vision edges give them their shadows."

- [ ] **Step 5: Update `README.md`**

At the end of the `?lights` line (around line 92), add: ` Two pillars show the straight vision edges; click moves the viewer (\`&at=x,y\` in tiles), E toggles the old tile edges (\`&edges=old\`).`

- [ ] **Step 6: Update `HANDOFF.md`**

1. Replace the "## Next session: soft vision edges (TODO priority 2)" heading and its numbered list with a "## Next session" section that says the vision edges are built on `feature/vision-edges` and wait for the user's look in the game and the merge decision. The next items are TODO priority 3 (art and licences) and 4 (abilities). Keep the paragraphs below the list (explosion art, healing circle, ideas the user liked) unchanged.
2. Add a new "## Last feature (2026-10-16): straight vision edges" section above the effect-system one, with:
   - the branch and its commits (`git log --oneline main..feature/vision-edges`);
   - links to the spec and this plan;
   - what was built (polygon, mask, `seenForLight`, wiring, `?lights`);
   - the user's decisions (crisp, black, pillars to the TODO list);
   - the spike branch `spike/vision-edges` as reference only (it can be deleted after the merge);
   - verification: the test counts, the bench number from Step 1, the screenshots, and the smoke result or why it was skipped;
   - open points: the user's play-test, and the merge.
3. Rename the old "## Last feature (2026-10-15): the effect system" heading to "## Feature before (2026-10-15): the effect system".

- [ ] **Step 7: Final verification**

Run: `cd client && npm test && npm run typecheck && npm run build`
Expected: all pass. Run `git status` and make sure only the intended files changed (no `shots/`).

- [ ] **Step 8: Commit**

```bash
git add docs/TECHNICAL.md docs/TODO.md README.md HANDOFF.md
git commit -m "Docs: straight vision edges

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
