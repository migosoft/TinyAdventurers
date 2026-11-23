// The painter of natural rock (#380 part 3): what one stone px of a cave floor, a rock wall's top or a rock wall's face looks like, where
// the block layout has no block (`paintLaid.ts` paints the rest). Rock is large flat facets, each leaning its own way, so a passing light
// picks them out one after another; nothing is shaded from a direction. Pure: no three. Every number is a first guess.
import { MOSS_TONES } from '../cover/moss';
import { OUTLINE_EDGE } from '../dips/shape';
import { heightAt } from '../heights';
import type { TileMap } from '../../sim/map';
import { wallBlockAt } from './blocks';
import { STONE_PX, hash, type StoneField } from './field';
import { FACE_H, FLAG } from './format';
import { CAP, CRACK, MORTAR, MOSS_CREEP, SPAN, dampAt, dipMask, groove, keyAt, planeSeed, put, relief, tones, type GroundCtx } from './paintLaid';
import { onPiece, type Marks } from './place';
import type { Face } from './plan';
import { PUDDLE_LEVEL, floorHeight, stoneHeight } from './shape';

type Rgb = readonly [number, number, number];

// ---- colours: a cool grey-brown beside the masonry's warm one, in the laid painter's five tones.
const ROCK = tones([92, 84, 80]);
/** A facet's tone, by its random number: the middle one twice as often as the two beside it. */
const FACET_TONE = [1, 2, 2, 3];
/** A pale mineral vein. */
export const VEIN: Rgb = [176, 168, 146];

// ---- facets: the cells of sites scattered on a grid of `FACET` px, of which `FACET_DROP` are left out, so facets differ much in size.
const FACET = 34, FACET_DROP = 0.4;
/** On a wall the facets are this share of the ground's in size (a wall is two tiles tall), and this much longer along the wall than tall (strata). */
const WALL_FACET = 0.65, STRATA = 1.5;
/** The slopes a facet takes along each axis, on the ground and on a wall (steeper: a wall is rougher than ground to walk on). */
const GROUND_LEAN = [-0.25, -0.1, -0.1, 0, 0, 0.1, 0.1, 0.25], WALL_LEAN = [-0.5, -0.25, -0.25, -0.1, 0.1, 0.25, 0.25, 0.5];
/** The relief bytes of every pair of leans (finding a slope's table step for each px is the painter's dearest sum). */
const LEANS = GROUND_LEAN.length, reliefs = (lean: readonly number[]): number[] => lean.flatMap((du) => lean.map((dv) => relief(du, dv, FLAG.plain)));
const GROUND_A = reliefs(GROUND_LEAN), WALL_A = reliefs(WALL_LEAN);
/** A px nearer than this to the line two facets meet on is the facet's edge: dirt in the seam, `EDGE_TONES` darker. Not a groove: embers and moss rows follow cracks only. */
const EDGE = 0.5, EDGE_TONES = 2;
/** Grain: the shares of single darker and lighter px. */
const GRAIN_DARK = 0.008, GRAIN_LIGHT = 0.004;
/** Moss in a damp patch: the share of a facet edge's px it fills (a seam holds less water than a joint), and how far from the edge it creeps (px). */
const MOSS_EDGE = 0.45, MOSS_REACH = 1.6;
/** Veins: one map cell of `VEIN_CELL` tiles in `VEIN_SHARE` has a patch of one or two veins of straight pieces (tiles long), each turned by up to half of `VEIN_TURN` (radians). */
const VEIN_CELL = 5, VEIN_SHARE = 0.3, VEIN_LEN = 0.5, VEIN_LEN_SPAN = 0.9, VEIN_TURN = 1.3;
/** A puddle's basin is two tones darker, and one tone in a damp ring of this many px round it. */
const DAMP_RING = 2;
/** Under a puddle's water the rock is this share of the darkest tone, on a facet's edge and on the water's outline px these. */
const SUNK = 0.5, SUNK_EDGE = 0.42, SHORE = 0.25;
/** The bank of a pool, lava or a chasm in rock: from this value of the dip's outline mask (it differs by up to `BANK_SPAN` from facet to facet) the rock falls toward the dip with this slope. */
const BANK_FROM = 0.12, BANK_SPAN = 0.28, BANK = 0.25;

// ---- the facet at a point. The sites round a grid cell are kept per grid column (a page is under `KEPT` columns wide, and the painter
// goes along rows, so a cell's sites are worked out once per page, not once per row).
const KEPT = 32, SITES = 25;
interface Sites { seed: number; i: number; j: number; n: number; x: Float64Array; y: Float64Array; r: Float64Array }
const kept: Sites[] = Array.from({ length: KEPT }, () => ({ seed: NaN, i: 0, j: 0, n: 0, x: new Float64Array(SITES), y: new Float64Array(SITES), r: new Float64Array(SITES * 3) }));
/** What `facetAt` found: the facet's three random numbers and the distance (px) to the line it meets its nearest neighbour on. */
let fTone = 0, fU = 0, fV = 0, fEdge = 0;
function facetAt(seed: number, x: number, y: number): void {
  const i = Math.floor(x / FACET), j = Math.floor(y / FACET), s = kept[i & (KEPT - 1)];
  if (seed !== s.seed || i !== s.i || j !== s.j) {
    s.seed = seed; s.i = i; s.j = j; s.n = 0;
    // two cells round: with sites left out the nearest one is often not in a neighbouring cell
    for (let b = j - 2; b <= j + 2; b++) for (let a = i - 2; a <= i + 2; a++) {
      if (hash(seed, a, b, 91) < FACET_DROP) continue;
      const n = s.n++;
      s.x[n] = (a + hash(seed, a, b, 92)) * FACET; s.y[n] = (b + hash(seed, a, b, 93)) * FACET;
      s.r[n * 3] = hash(seed, a, b, 94); s.r[n * 3 + 1] = hash(seed, a, b, 95); s.r[n * 3 + 2] = hash(seed, a, b, 96);
    }
  }
  const sx = s.x, sy = s.y;
  let k1 = 0, d1 = Infinity, k2 = 0, d2 = Infinity;
  for (let k = 0; k < s.n; k++) {
    const dx = sx[k] - x, dy = sy[k] - y, d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; k2 = k1; d1 = d; k1 = k; } else if (d < d2) { d2 = d; k2 = k; }
  }
  fTone = s.r[k1 * 3]; fU = s.r[k1 * 3 + 1]; fV = s.r[k1 * 3 + 2];
  const ex = sx[k1] - sx[k2], ey = sy[k1] - sy[k2];
  fEdge = s.n > 1 ? (d2 - d1) / (2 * Math.sqrt(ex * ex + ey * ey)) : FACET; // (`Math.hypot` is many times slower)
}

// ---- the lines and basins on the rock, drawn once per level into a mask per tile: the marks' rock cracks, crevices and puddles, and
// the veins, which the painter lays itself. A px holds one line (the higher wins) and how wet it is.
const LINE = 3, VEIN_PX = 1, CRACK_PX = 2, PIT_PX = 3, WET = 4;
export interface RockLines { seed: number; map: TileMap; w: number; h: number; tiles: Map<number, Uint8Array> }
const drawn = new WeakMap<Marks, RockLines>();

export function rockLines(f: StoneField, map: TileMap, marks: Marks): RockLines {
  let l = drawn.get(marks);
  if (l && l.seed === f.seed && l.map === map) return l;
  l = { seed: f.seed, map, w: map.w, h: map.h, tiles: new Map() };
  const tiles = l.tiles, W = map.w * STONE_PX, H = map.h * STONE_PX;
  const maskOf = (u: number, v: number): Uint8Array => {
    const t = (v >> 5) * map.w + (u >> 5);
    let m = tiles.get(t);
    if (!m) tiles.set(t, (m = new Uint8Array(STONE_PX * STONE_PX)));
    return m;
  };
  const set = (u: number, v: number, kind: number): void => {
    if (u < 0 || v < 0 || u >= W || v >= H) return;
    const m = maskOf(u, v), i = (v & 31) * STONE_PX + (u & 31);
    if ((m[i] & LINE) < kind) m[i] = (m[i] & ~LINE) | kind;
  };
  /** A straight piece between two points in tiles: one px wide, or every px within `half` px of it. */
  const piece = (x0: number, z0: number, x1: number, z1: number, kind: number, half = 0): void => {
    const ax = x0 * STONE_PX, az = z0 * STONE_PX, dx = (x1 - x0) * STONE_PX, dz = (z1 - z0) * STONE_PX;
    if (!half) {
      const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz))) || 1;
      for (let i = 0; i <= n; i++) set(Math.floor(ax + (dx * i) / n), Math.floor(az + (dz * i) / n), kind);
      return;
    }
    for (let v = Math.floor(Math.min(az, az + dz) - half); v <= Math.max(az, az + dz) + half; v++) for (let u = Math.floor(Math.min(ax, ax + dx) - half); u <= Math.max(ax, ax + dx) + half; u++) {
      if (onPiece(u, v, x0, z0, x1, z1, half)) set(u, v, kind);
    }
  };
  const crack = (c: { pts: [number, number][]; branch: number[][] }, kind: number, half = 0): void => {
    for (let i = 1; i < c.pts.length; i++) piece(c.pts[i - 1][0], c.pts[i - 1][1], c.pts[i][0], c.pts[i][1], kind, half);
    for (const b of c.branch) piece(b[0], b[1], b[2], b[3], kind, half);
  };
  for (const c of marks.rockCracks) crack(c, CRACK_PX);
  for (const c of marks.crevices) crack(c, PIT_PX, (c.width * STONE_PX) / 2);
  for (const p of marks.puddles) {
    const cu = p.x * STONE_PX, cv = p.z * STONE_PX, r = p.r * STONE_PX;
    const u0 = Math.floor(cu - r - DAMP_RING), v0 = Math.floor(cv - r - DAMP_RING), n = Math.ceil(2 * (r + DAMP_RING)) + 2;
    // the px the puddle's water lies over: inside the basin, the floor (as the mesh has it) below the water's level
    const sunk = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = u0 + i + 0.5, z = v0 + j + 0.5;
      if (Math.hypot(x - cu, z - cv) < r && floorHeight(f, map, marks, x / STONE_PX, z / STONE_PX) < PUDDLE_LEVEL) sunk[j * n + i] = 1;
    }
    const wet = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < n && j < n && sunk[j * n + i] === 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = u0 + i, v = v0 + j, d = Math.hypot(u + 0.5 - cu, v + 0.5 - cv);
      if (d >= r + DAMP_RING || u < 0 || v < 0 || u >= W || v >= H) continue;
      const shore = wet(i, j) && !(wet(i - 1, j) && wet(i + 1, j) && wet(i, j - 1) && wet(i, j + 1));
      const m = maskOf(u, v), k = (v & 31) * STONE_PX + (u & 31);
      m[k] = Math.max(m[k], WET * (shore ? 4 : wet(i, j) ? 3 : d < r ? 2 : 1)); // a line that crosses the puddle is dropped here: never a crack over a puddle
    }
  }
  // veins wander by straight pieces; a patch's second vein runs beside the first
  const rnd = (a: number, b: number, c: number): number => hash(f.seed, a, b, 100 + c);
  for (let j = 0; j * VEIN_CELL < map.h; j++) for (let i = 0; i * VEIN_CELL < map.w; i++) {
    if (rnd(i, j, 0) >= VEIN_SHARE) continue;
    const a0 = rnd(i, j, 1) * Math.PI * 2;
    for (let n = 0; n < (rnd(i, j, 2) < 0.5 ? 2 : 1); n++) {
      let x = (i + rnd(i, j, 3 + n)) * VEIN_CELL, z = (j + rnd(i, j, 5 + n)) * VEIN_CELL, a = a0 + (rnd(i, j, 7 + n) - 0.5) * 0.5;
      for (let k = 0; k < 3 + Math.floor(rnd(i, j, 9 + n) * 3); k++) {
        const len = VEIN_LEN + rnd(i, j, 20 + n * 8 + k) * VEIN_LEN_SPAN, nx = x + Math.cos(a) * len, nz = z + Math.sin(a) * len;
        piece(x, z, nx, nz, VEIN_PX);
        x = nx; z = nz; a += (rnd(i, j, 40 + n * 8 + k) - 0.5) * VEIN_TURN;
      }
    }
  }
  drawn.set(marks, l);
  return l;
}

let atLines: RockLines | null = null, atTile = -1, atMask: Uint8Array | undefined;
/** Lets go of the level asked last (its masks and map): the paint job calls it when its last unit is done. */
export const forgetLines = (): void => { atLines = null; atMask = undefined; };
/** What is drawn on the ground px (u, v): a line kind in the low bits, the wetness above. */
function lineAt(l: RockLines, u: number, v: number): number {
  const x = u >> 5, z = v >> 5;
  if (x < 0 || z < 0 || x >= l.w || z >= l.h) return 0;
  const t = z * l.w + x;
  if (l !== atLines || t !== atTile) { atLines = l; atTile = t; atMask = l.tiles.get(t); }
  return atMask ? atMask[(v & 31) * STONE_PX + (u & 31)] : 0;
}

/** Whether the ground px (u, v) is a crevice's: black on rock and on laid stone alike. */
export const pitAt = (l: RockLines, u: number, v: number): boolean => (lineAt(l, u, v) & LINE) === PIT_PX;
/** A crevice's px: black, and flagged so that it stays black whichever way its surface faces. */
export function pitPx(out: Uint8Array, at: number): void {
  out[at] = out[at + 1] = out[at + 2] = 0; out[at + 3] = relief(0, 0, FLAG.pit);
}

/**
 * One rock px, after `facetAt`: a crevice's black, a crack, moss, a vein or the facet's own stone. `mark` is `lineAt`'s answer, `du` and
 * `dv` a slope added to the facet's own, `lean` the facet's slope table.
 */
function rockPx(out: Uint8Array, at: number, seed: number, u: number, v: number, pal: readonly number[], lean: readonly number[], mark: number, damp: number, du: number, dv: number): void {
  const line = mark & LINE;
  if (line === PIT_PX) return pitPx(out, at);
  if (line === CRACK_PX) return groove(out, at, seed, u, v, CRACK, damp);
  const iu = Math.floor(fU * LEANS), iv = Math.floor(fV * LEANS), edge = fEdge < EDGE;
  const a = du || dv ? relief(du + lean[iu], dv + lean[iv], FLAG.plain) : (lean === GROUND_LEAN ? GROUND_A : WALL_A)[iu * LEANS + iv];
  if (damp > 0 && fEdge < MOSS_REACH && hash(seed, u, v, 53) < (edge ? MOSS_EDGE : MOSS_CREEP) * damp) {
    const c = MOSS_TONES[Math.floor(hash(seed, u, v, 55) * 3)];
    out[at] = c[0]; out[at + 1] = c[1]; out[at + 2] = c[2]; out[at + 3] = a;
    return;
  }
  let tone = FACET_TONE[Math.floor(fTone * 4)] - (edge ? EDGE_TONES : 0) - (mark >> 2);
  if (mark >= WET * 3) {
    // under a puddle's water: the darkest stone darker still, the facets only faint; the water's outline px darkest
    const k = mark >= WET * 4 ? SHORE : edge ? SUNK_EDGE : SUNK;
    out[at] = pal[0] * k; out[at + 1] = pal[1] * k; out[at + 2] = pal[2] * k; out[at + 3] = a;
    return;
  }
  if (line === VEIN_PX && !edge) { out[at] = VEIN[0]; out[at + 1] = VEIN[1]; out[at + 2] = VEIN[2]; out[at + 3] = a; return; }
  const g = hash(seed, u, v, 51);
  if (g < GRAIN_DARK) tone--;
  else if (g > 1 - GRAIN_LIGHT) tone++;
  put(out, at, pal, tone, a);
}

/** Paints the ground px (u, v) (world stone px) as rock: a cave floor, a rock wall's top, a dip's bank. */
export function rockGroundPx(c: GroundCtx, l: RockLines, u: number, v: number, out: Uint8Array, at: number): void {
  const { f, map, marks } = c, x = u >> 5, z = v >> 5, top = heightAt(map, x, z) > 0, mark = lineAt(l, u, v);
  const damp = !top && mark < WET * 2 && dampAt(map, marks, u >> 1, v >> 1) ? 1 : 0;
  // a laid block to the left or above has its joint on this px (not in a puddle's basin, which holds no groove): the rock comes up
  // to the block's own edge everywhere else
  if (mark < WET * 2 && (keyAt(c, u - 1, v) >= 0 || keyAt(c, u, v - 1) >= 0)) return groove(out, at, f.seed, u, v, MORTAR, damp);
  facetAt(f.seed, u, v);
  let du = 0, dv = 0;
  if (c.dip[(z - c.z0) * SPAN + x - c.x0]) {
    const here = dipMask(map, u, v);
    if (here >= BANK_FROM + fTone * BANK_SPAN && here < OUTLINE_EDGE) {
      du = -BANK * Math.sign(dipMask(map, u + 1, v) - dipMask(map, u - 1, v)); dv = -BANK * Math.sign(dipMask(map, u, v + 1) - dipMask(map, u, v - 1));
    }
  }
  // a rock wall's slope is rock like the floor, which so runs on up its foot; the capping tones begin where the slope ends, along its wobbling line
  const cap = top && stoneHeight(f, map, marks, (u + 0.5) / STONE_PX, (v + 0.5) / STONE_PX) >= heightAt(map, x, z);
  rockPx(out, at, f.seed, u, v, cap ? CAP : ROCK, GROUND_LEAN, mark, damp, du, dv);
}

/**
 * Paints the px (u, v) of a rock wall's face (v down from the wall's top); `dampCol` from `faceDamp`. The lines of the ground run on up
 * the face's lower tile as if it were the ground of the wall's cell folded up along the wall's foot, so a crevice that meets a wall is black on both.
 */
export function rockFacePx(f: StoneField, map: TileMap, l: RockLines, face: Face, dampCol: readonly boolean[], u: number, v: number, out: Uint8Array, at: number): void {
  const pu = (face.side < 2 ? face.x : face.z) * STONE_PX + u, seed = planeSeed(f.seed, face), damp = dampCol[u] ? (v / FACE_H) ** 2 : 0;
  if (wallBlockAt(f, map, face, pu - 1, v) || (v > 0 && wallBlockAt(f, map, face, pu, v - 1))) return groove(out, at, seed, pu, v, MORTAR, damp);
  const up = FACE_H - 1 - v, s = face.side;
  // (only within the wall's own cell: beyond it lies whatever is behind the wall, another room's floor perhaps)
  const mark = up >= STONE_PX ? 0 : s === 0 ? lineAt(l, pu, (face.z + 1) * STONE_PX - 1 - up) : s === 1 ? lineAt(l, pu, face.z * STONE_PX + up) : s === 2 ? lineAt(l, (face.x + 1) * STONE_PX - 1 - up, pu) : lineAt(l, face.x * STONE_PX + up, pu);
  facetAt(seed, pu / (WALL_FACET * STRATA), v / WALL_FACET);
  fEdge *= WALL_FACET;
  rockPx(out, at, seed, pu, v, ROCK, WALL_LEAN, mark & LINE, damp, 0, 0);
}
