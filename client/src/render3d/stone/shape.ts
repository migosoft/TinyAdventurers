// The shape of natural rock (#380 part 4): the stone's height at a point. A rock wall cell beside open ground rises from 0 on its open
// edges to the wall's height within the slope's reach, gently at the foot and steeply above; the reach swings along the wall between a
// tenth of the cell and most of it, and shrinks to 0 with the rock amount and toward a wall cell of masonry, where the face is upright. A wall cell with open ground on all four sides
// is a column. A rock floor lies a little below 0, with a basin under each puddle and a groove along each crevice. The slope lies inside
// the wall's own cell and no floor rises above 0, so open ground is exactly as wide as the server's. `rockMesh.ts` meshes all of it.
// Pure: no three. Every number is a first guess.
import type { TileMap } from '../../sim/map';
import { heightAt } from '../heights';
import { STONE_PX, hash, rockAmount, rockWall, wobble, type StoneField } from './field';
import { SIDE_STEP } from './grid';
import { floorIsRock, laid, laidHeight, type Laid } from './laidMesh';
import { piecesOf, type Marks, type Puddle, type Shard } from './place';
import { unplanned } from './plan';

/**
 * How far into its cell a rock wall's slope reaches (tiles): the middle value, a slow swing along the wall (the border wobble's noise, a
 * feature every three tiles) and a fine wobble from point to point, kept between the two ends. So a wall's line bulges in and out by most
 * of a tile, and a long reach is a long gentle foot.
 */
export const REACH = 0.45, REACH_SWING = 0.7, REACH_WOBBLE = 0.1, REACH_MIN = 0.1, REACH_MAX = 0.85;
/** The longest reach where the wall is one cell thick: slopes from its two sides must leave its top standing between them. */
const REACH_THIN = 0.38;
/**
 * The slope's profile over its reach, 0..1: this share of the height rises evenly from the cell's edge on, the rest by the power `STEEP`.
 * The even share is small, so the floor runs into the foot almost without a bend and no lit line follows the cell's edge.
 */
const FOOT_RISE = 0.05, STEEP = 2.2;
/** The rock stands back from a big crystal: no slope within `NICHE_IN` tiles of its foot, the full one from `NICHE_OUT`. */
const NICHE_IN = 0.16, NICHE_OUT = 0.5;
/** A rock floor's corners lie up to this far below 0 (tiles), a puddle's basin this deep at its middle. */
export const ROUGH = 0.06, BASIN = 0.09;
/** A basin's cell is meshed this fine (quads a side); the basin's depth is taken at those points. */
export const BASIN_GRID = 4;
/** A column's rings: the share of its height and the radius (tiles); the first is the cell's square outline. A column in less than full rock is squarer. */
export const COLUMN: readonly (readonly [number, number])[] = [[0, 0.5], [0.07, 0.44], [0.25, 0.34], [0.5, 0.27], [0.75, 0.31], [0.93, 0.39], [1, 0.43]];
/** The ring a column is narrowest at, and how far a ring's radius wobbles round it (a share). */
const WAIST = 3, COLUMN_WOBBLE = 0.08;

/** A straight piece of a crevice: its ends, half its width and its depth (tiles). */
export interface Seg { x0: number; z0: number; x1: number; z1: number; half: number; depth: number }
/** What the shape of one level is worked out with: the laid floor's pieces, and what was asked before. */
export interface Shape {
  f: StoneField; map: TileMap; marks: Marks; laid: Laid;
  lean: Map<number, number>; low: Map<number, number>; rough: Map<number, boolean>; walls: Map<number, Wall | null>; reach: Map<number, number>;
  /** The puddles, crevice pieces and big crystals that reach a cell. */
  puddles: Map<number, Puddle[]>; segs: Map<number, Seg[]>; niches: Map<number, Shard[]>;
}
/** A cell's or a corner's key; a ring of two beyond the map has keys of its own. */
export const keyOf = (s: Shape, x: number, z: number): number => (z + 2) * (s.map.w + 4) + x + 2;

export function shapeOf(c: Laid): Shape {
  const s: Shape = { f: c.f, map: c.map, marks: c.marks, laid: c, lean: new Map(), low: new Map(), rough: new Map(), walls: new Map(), reach: new Map(), puddles: new Map(), segs: new Map(), niches: new Map() };
  const add = <T>(m: Map<number, T[]>, x: number, z: number, v: T): void => {
    const k = keyOf(s, Math.floor(x), Math.floor(z)), list = m.get(k);
    if (!list) m.set(k, [v]);
    else if (!list.includes(v)) list.push(v);
  };
  /** Every cell within `r` of the point (as a square). */
  const round = <T>(m: Map<number, T[]>, x: number, z: number, r: number, v: T): void => {
    for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) add(m, i, j, v);
  };
  for (const p of c.marks.puddles) round(s.puddles, p.x, p.z, p.r, p);
  for (const b of c.marks.shards) if (b.big) round(s.niches, b.x, b.z, NICHE_OUT, b);
  for (const cr of c.marks.crevices) {
    for (const [x0, z0, x1, z1] of piecesOf(cr)) {
      const seg: Seg = { x0, z0, x1, z1, half: cr.width / 2, depth: cr.depth }, n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.05);
      // a piece shapes the floor up to its width beyond its line and its ends
      for (let i = 0; i <= n; i++) round(s.segs, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, cr.width, seg);
    }
  }
  return s;
}

// The shape the two functions below were last asked with, per level.
// shortcut: it outlives a tile change that moves a cell's height or a dip (the mesh makes its own per chunk, so only later callers such as the cover would read stale floor levels); drop it from the view's `tileChanged` if such a caller needs it after one.
const kept = new WeakMap<Marks, Shape>(), KEPT_CELLS = 4096;
type Skip = (x: number, z: number) => boolean;
function shapeFor(f: StoneField, map: TileMap, marks: Marks, skip?: Skip): Shape {
  let s = kept.get(marks);
  if (!s || s.f !== f || s.map !== map || s.laid.skip !== skip || s.laid.cells.size > KEPT_CELLS) kept.set(marks, (s = shapeOf(laid(map, f, unplanned(), marks, 0, 0, -1, skip))));
  return s;
}

/**
 * The stone's height at a point (tiles): 0 or below on open ground (unevenness, basins, crevices), up to WALL_H inside a wall cell. Blended
 * with the upright laid face by `rockAmount`. `skip`: the cells another mesh draws, as `buildStoneChunk` is given them (the woodland's ground).
 */
export function stoneHeight(f: StoneField, map: TileMap, marks: Marks, x: number, z: number, skip?: Skip): number {
  return heightIn(shapeFor(f, map, marks, skip), x, z);
}
/** The floor's height at a point of open ground, at or below 0: laid blocks' levels or the rock floor. What the cover and the dips stand on. `skip` as for `stoneHeight`. */
export function floorHeight(f: StoneField, map: TileMap, marks: Marks, x: number, z: number, skip?: Skip): number {
  return floorIn(shapeFor(f, map, marks, skip), x, z);
}

export function heightIn(s: Shape, x: number, z: number): number {
  const cx = Math.floor(x), cz = Math.floor(z), h = heightAt(s.map, cx, cz);
  if (h === 0) return floorIn(s, x, z);
  const w = wallOf(s, cx, cz);
  if (!w) return h;
  if (isColumn(w)) return columnY(s, w, x, z);
  const d = [w.z + 1 - z, z - w.z, w.x + 1 - x, x - w.x];
  return wallY(s, w, d.map((di, side) => (w.open[side] ? along(di, sideReach(w, side, x, z)) : 1)), w.diag.map((on, k) => (on ? along(cornerGap(w, k, x, z), w.reach[cornerKnot(k)]) : 1)), x, z);
}

// ---- rock walls
/** A wall cell: which sides (the order of `SIDE_STEP`: south, north, east, west) border a lower cell, and which corners (east: +1, south: +2) touch one only there. */
export interface Wall {
  x: number; z: number; h: number; open: boolean[]; diag: boolean[];
  /** How far a slope reaches into the wall from a foot at each of the cell's nine points half a tile apart, row by row; between them evenly. */
  reach: number[];
  /** How much of the rock's lean the cell's middle has (`cornerLean`). */
  lean: number;
}
/** The wall cell (x, z) where it is shaped as rock (`rockWall`) and touches lower ground; null: masonry, or solid rock all round (a level top). */
export function wallOf(s: Shape, x: number, z: number): Wall | null {
  const k = keyOf(s, x, z);
  let w = s.walls.get(k);
  if (w !== undefined) return w;
  w = null;
  if (rockWall(s.f, s.map, x, z)) {
    const map = s.map, h = heightAt(map, x, z), low = (dx: number, dz: number): boolean => heightAt(map, x + dx, z + dz) < h;
    const open = SIDE_STEP.map(([dx, dz]) => low(dx, dz));
    const diag = [0, 1, 2, 3].map((i) => { const dx = i & 1 ? 1 : -1, dz = i & 2 ? 1 : -1; return low(dx, dz) && !low(dx, 0) && !low(0, dz); });
    if (open.some(Boolean) || diag.some(Boolean)) {
      const c = [cornerLean(s, x, z), cornerLean(s, x + 1, z), cornerLean(s, x, z + 1), cornerLean(s, x + 1, z + 1)];
      const reach = Array.from({ length: 9 }, (_, i) => mix2(c[0], c[1], c[2], c[3], (i % 3) / 2, Math.floor(i / 3) / 2) * reachAt(s, x * 2 + (i % 3), z * 2 + Math.floor(i / 3)));
      // with no reach anywhere (masonry at every corner) the cell is an upright block: a level top and flat faces
      if (open.every(Boolean) || reach.some((r) => r > 0)) w = { x, z, h, open, diag, reach, lean: (c[0] + c[1] + c[2] + c[3]) / 4 };
    }
  }
  s.walls.set(k, w);
  return w;
}
/** Open ground on all four sides: a natural column. */
export const isColumn = (w: Wall): boolean => w.open.every(Boolean);

/** Whether a point of the half-tile grid (X2, Z2 in half tiles) touches open ground: lies in an open cell or on its edge. */
function touchesOpen(map: TileMap, X2: number, Z2: number): boolean {
  for (let z = (Z2 - 1) >> 1; z <= Z2 >> 1; z++) for (let x = (X2 - 1) >> 1; x <= X2 >> 1; x++) if (heightAt(map, x, z) === 0) return true;
  return false;
}
/**
 * The reach in full rock at a point of the half-tile grid. The points are the map's, so cells side by side agree along their edge. Where
 * open ground lies one tile on through the wall, the wall is thin there and the reach stops short of its middle.
 */
function reachAt(s: Shape, X2: number, Z2: number): number {
  const k = (Z2 + 4) * (s.map.w * 2 + 8) + X2 + 4;
  let r = s.reach.get(k);
  if (r === undefined) {
    r = Math.min(REACH_MAX, Math.max(REACH_MIN, REACH + REACH_SWING * wobble(s.f.seed, X2 / 2, Z2 / 2, 2) + REACH_WOBBLE * (hash(s.f.seed, X2, Z2, 72) * 2 - 1)));
    for (const [dx, dz] of SIDE_STEP) if (touchesOpen(s.map, X2 + dx * 2, Z2 + dz * 2) && !touchesOpen(s.map, X2 + dx, Z2 + dz)) r = Math.min(r, REACH_THIN);
    s.reach.set(k, r);
  }
  return r;
}

/** How much of the rock's lean a cell corner has, 0..1: the rock amount, and 0 where a wall cell of masonry touches it, so the rock stands upright against masonry. */
function cornerLean(s: Shape, X: number, Z: number): number {
  const k = keyOf(s, X, Z);
  let v = s.lean.get(k);
  if (v === undefined) {
    v = rockAmount(s.f, s.map, X, Z);
    for (let j = Z - 1; j <= Z; j++) for (let i = X - 1; i <= X; i++) if (heightAt(s.map, i, j) > 0 && !rockWall(s.f, s.map, i, j)) v = 0;
    s.lean.set(k, v);
  }
  return v;
}
const mix2 = (a: number, b: number, c: number, d: number, fx: number, fz: number): number => a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
/** How far the slope reaches into the wall from the point (x, z) of its foot, in the cell or on its edge. */
function reach(w: Wall, x: number, z: number): number {
  const fx = (x - w.x) * 2, fz = (z - w.z) * 2, i = fx < 1 ? 0 : 1, j = fz < 1 ? 0 : 1, r = w.reach, k = j * 3 + i;
  return mix2(r[k], r[k + 1], r[k + 3], r[k + 4], fx - i, fz - j);
}

/** The reach of the slope that rises from an open side of the wall cell, taken where the point (px, pz) lies along that side. */
export function sideReach(w: Wall, side: number, px: number, pz: number): number {
  const [dx, dz] = SIDE_STEP[side];
  return reach(w, dx ? w.x + (dx > 0 ? 1 : 0) : px, dz ? w.z + (dz > 0 ? 1 : 0) : pz);
}
/** Where a corner (east: +1, south: +2) lies among the cell's nine reach points, and how far a point lies from it. */
export const cornerKnot = (k: number): number => (k & 1 ? 2 : 0) + (k & 2 ? 6 : 0);
export const cornerGap = (w: Wall, k: number, px: number, pz: number): number => Math.hypot(px - w.x - (k & 1), pz - w.z - (k >> 1));
/** How far up a slope a point lies, 0 at its foot .. 1 at the slope's reach `r` and beyond; with no reach the wall is upright in the edge. */
export const along = (d: number, r: number): number => (r > 0 ? Math.min(1, d / r) : d > 0 ? 1 : 0);

/**
 * The height of a rock wall at a point, from how far up each open side's slope it lies (`p`, 1 for a side that is not open) and up the
 * slope round each corner that alone touches open ground (`c`, 1 for the others): `along`, or the mesh's own where a slope has no reach.
 * Two slopes that meet round the wall's top between them; round such a corner the slope turns in a quarter circle.
 */
export function wallY(s: Shape, w: Wall, p: readonly number[], c: readonly number[], px: number, pz: number): number {
  const u = Math.min(p[3], p[2]), v = Math.min(p[1], p[0]);
  let t = Math.max(0, 1 - Math.sqrt((1 - u) ** 2 + (1 - v) ** 2 + (1 - c[0]) ** 2 + (1 - c[1]) ** 2 + (1 - c[2]) ** 2 + (1 - c[3]) ** 2));
  for (const b of s.niches.get(keyOf(s, w.x, w.z)) ?? []) {
    const k = Math.min(1, Math.max(0, (Math.hypot(px - b.x, pz - b.z) - NICHE_IN) / (NICHE_OUT - NICHE_IN)));
    t *= k * k * (3 - 2 * k);
  }
  return w.h * (FOOT_RISE * t + (1 - FOOT_RISE) * t ** STEEP);
}

/** A column's radius at ring `k` toward the angle `ang`: the cell's square at the foot; above it round, the squarer the less rock there is. */
export function columnRadius(s: Shape, w: Wall, k: number, ang: number): number {
  const square = 0.5 / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
  if (k === 0) return square;
  const round = COLUMN[k][1] * (1 + COLUMN_WOBBLE * Math.sin(ang * 3 + hash(s.f.seed, w.x, w.z, 80 + k) * 7));
  return square + (round - square) * w.lean;
}
/** A column seen from above: its top, and round that its foot down to the waist's width (the waist itself lies under the top). */
function columnY(s: Shape, w: Wall, x: number, z: number): number {
  const dx = x - w.x - 0.5, dz = z - w.z - 0.5, r = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
  if (r <= columnRadius(s, w, COLUMN.length - 1, ang)) return w.h;
  for (let k = WAIST; k > 0; k--) {
    const r0 = columnRadius(s, w, k, ang), r1 = columnRadius(s, w, k - 1, ang);
    if (r <= r1) return w.h * (r1 > r0 ? COLUMN[k][0] + ((COLUMN[k - 1][0] - COLUMN[k][0]) * (Math.max(r, r0) - r0)) / (r1 - r0) : COLUMN[k][0]);
  }
  return 0;
}

// ---- floors
/** A floor cell of uneven rock: rock all over, and so is every floor cell beside it, so laid stone always lies beside a level piece. */
export function roughCell(s: Shape, x: number, z: number): boolean {
  const k = keyOf(s, x, z);
  let r = s.rough.get(k);
  if (r === undefined) s.rough.set(k, (r = floorIsRock(s.laid, x, z) === true && SIDE_STEP.every(([dx, dz]) => floorIsRock(s.laid, x + dx, z + dz) !== false)));
  return r;
}
/** Whether the four cells round a corner all pass. */
const roundCorner = (X: number, Z: number, ok: (x: number, z: number) => boolean): boolean => ok(X - 1, Z - 1) && ok(X, Z - 1) && ok(X - 1, Z) && ok(X, Z);
/**
 * A corner of the rock floor, at or below 0: 0 where anything but uneven rock touches it, so the floor lies at 0 along a wall's foot,
 * along laid stone and along the dip mesh's cells.
 */
export function cornerLow(s: Shape, X: number, Z: number): number {
  const k = keyOf(s, X, Z);
  let v = s.low.get(k);
  if (v === undefined) s.low.set(k, (v = roundCorner(X, Z, (x, z) => roughCell(s, x, z)) ? -ROUGH * hash(s.f.seed, X, Z, 71) : 0));
  return v;
}
/** 1 at a corner where basins and grooves may lie (uneven rock and walls round it), 0 where a level floor or a dip touches it. */
const cornerDeep = (s: Shape, X: number, Z: number): number => (roundCorner(X, Z, (x, z) => roughCell(s, x, z) || heightAt(s.map, x, z) > 0) ? 1 : 0);
const deepAt = (s: Shape, x: number, z: number): number => {
  const X = Math.floor(x), Z = Math.floor(z);
  return mix2(cornerDeep(s, X, Z), cornerDeep(s, X + 1, Z), cornerDeep(s, X, Z + 1), cornerDeep(s, X + 1, Z + 1), x - X, z - Z);
};
/** Between the four corners of a square cut in two triangles along the line from (1, 0) to (0, 1), as the mesh cuts it. */
const tri = (a: number, b: number, c: number, d: number, fx: number, fz: number): number => (fx + fz < 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz));
/** The depth of the puddles' basins at a point: a bowl under each. */
function basinAt(s: Shape, ps: readonly Puddle[], x: number, z: number): number {
  let b = 0;
  for (const p of ps) b = Math.max(b, 1 - ((x - p.x) ** 2 + (z - p.z) ** 2) / (p.r * p.r));
  return b > 0 ? b * BASIN * deepAt(s, x, z) : 0;
}
/** The depth of the crevices at a point: full on a piece's line, none from half its width. */
export function grooveAt(segs: readonly Seg[], x: number, z: number): number {
  let g = 0;
  for (const c of segs) {
    const dx = c.x1 - c.x0, dz = c.z1 - c.z0, t = Math.min(1, Math.max(0, ((x - c.x0) * dx + (z - c.z0) * dz) / (dx * dx + dz * dz || 1)));
    g = Math.max(g, c.depth * (1 - Math.hypot(x - c.x0 - dx * t, z - c.z0 - dz * t) / c.half));
  }
  return g;
}

/**
 * The floor at a point of open ground. Laid stone and level rock: the piece's own height. Uneven rock: between the cell's corners, less
 * the basins (taken at the points of `BASIN_GRID`, between them as the mesh lies) and the crevices' grooves.
 */
export function floorIn(s: Shape, x: number, z: number): number {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (!roughCell(s, cx, cz)) return laidHeight(s.laid, x * STONE_PX, z * STONE_PX) ?? 0;
  const fx = x - cx, fz = z - cz, k = keyOf(s, cx, cz);
  let h = tri(cornerLow(s, cx, cz), cornerLow(s, cx + 1, cz), cornerLow(s, cx, cz + 1), cornerLow(s, cx + 1, cz + 1), fx, fz);
  const ps = s.puddles.get(k), segs = s.segs.get(k);
  if (ps) {
    const G = BASIN_GRID, i = Math.min(G - 1, Math.floor(fx * G)), j = Math.min(G - 1, Math.floor(fz * G));
    const b = (a: number, c: number): number => basinAt(s, ps, cx + (i + a) / G, cz + (j + c) / G);
    h -= tri(b(0, 0), b(1, 0), b(0, 1), b(1, 1), fx * G - i, fz * G - j);
  }
  if (segs) h -= grooveAt(segs, x, z) * deepAt(s, x, z);
  return h;
}
