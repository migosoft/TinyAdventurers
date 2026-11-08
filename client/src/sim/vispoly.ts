// The visibility polygon: the area seen from a pixel position, bounded by
// walls and by the sight radius. Wall edges that face an open tile are merged
// into long segments; rays go to every segment end (and just beside it, so a
// ray that grazes a corner continues behind it) plus at even angles, each
// stopping at the nearest segment or at the radius, so the outer edge is a
// circle. Drawn by game/visionmask.ts; the server's visibility stays per tile.
import { TILE, type Blocker, type TileMap } from './map';

/** A wall edge in px: x0, y0, x1, y1. */
export type Segment = [number, number, number, number];

/** The sight radius in px for `vision` tiles: it covers the tiles whose centres the shadowcast reaches. */
export function sightRadius(vision: number): number {
  return (vision + 0.5) * TILE;
}

/** Runs of tile edges between an opaque and an open tile, within `r` px (plus a tile) of (px, py). Off-map counts as opaque. */
export function wallSegments(map: TileMap, px: number, py: number, r: number, b: Blocker = 'all'): Segment[] {
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
      const above = map.blocksSight(x, y - 1, b);
      const below = map.blocksSight(x, y, b);
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
      const left = map.blocksSight(x - 1, y, b);
      const right = map.blocksSight(x, y, b);
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

/** Angular buckets around the viewer (#280): a ray tests only the segments in its bucket. */
const BUCKETS = 256;

/** The bucket of angle `a` (any real angle, wrapped). */
function bucketOf(a: number): number {
  const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
  return b < 0 ? b + BUCKETS : b;
}

/**
 * The segments sorted into angular buckets around (px, py): each segment goes into every bucket its angular span
 * touches, plus one on each side (rounding, and `cast`'s 1e-9 end tolerance); a segment passing within 1 px of the
 * viewer goes into all of them. So a bucket holds every segment a ray in it can hit, and `cast` over the bucket
 * returns exactly what it returns over all segments (the nearest hit does not depend on the order). In a forest the
 * full view has ~200 segments and ~1300 rays; this makes the polygon several times cheaper.
 */
export function bucketSegments(segs: Segment[], px: number, py: number): Segment[][] {
  const out: Segment[][] = Array.from({ length: BUCKETS }, () => []);
  for (const sg of segs) {
    const [ax, ay, bx, by] = sg;
    const ex = bx - ax, ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const k = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2)) : 0;
    if (Math.hypot(ax + ex * k - px, ay + ey * k - py) < 1) {
      for (const b of out) b.push(sg);
      continue;
    }
    // The segment does not pass by the viewer, so it spans less than π: the shorter arc between its ends.
    const a1 = Math.atan2(ay - py, ax - px);
    const a2 = Math.atan2(by - py, bx - px);
    let d = a2 - a1;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    const from = bucketOf(d >= 0 ? a1 : a2);
    const n = bucketOf(d >= 0 ? a2 : a1) - from;
    const count = (n < 0 ? n + BUCKETS : n) + 3;
    for (let i = 0; i < Math.min(count, BUCKETS); i++) out[(from - 1 + i + BUCKETS) % BUCKETS].push(sg);
  }
  return out;
}

/** Ray angle offset beside a segment end. */
const EPS = 1e-4;

/** A visibility polygon: flat [x0, y0, x1, y1, ...] points and their ray angles, sorted (from -π). */
export interface SightPolygon {
  points: number[];
  angles: number[];
}

/** The area seen from (px, py) within `r` px, as a flat [x0, y0, x1, y1, ...] polygon sorted by angle (from -π). */
export function visibilityPolygon(map: TileMap, px: number, py: number, r: number, steps = 96, b: Blocker = 'all'): number[] {
  return sightPolygon(map, px, py, r, steps, b).points;
}

/**
 * Whether (qx, qy) lies inside `s`, cast from (px, py). The polygon is star-shaped around the viewer
 * with its points sorted by angle: the point's angle is bracketed by binary search, and it is inside
 * when it lies on the viewer's side of the edge between the two bracketing points (the edge from the
 * last point back to the first closes the circle across ±π).
 */
export function inside(s: SightPolygon, px: number, py: number, qx: number, qy: number): boolean {
  const n = s.angles.length;
  if (n < 2) return false;
  const a = Math.atan2(qy - py, qx - px);
  let lo = 0;
  let hi = n - 1;
  let i = -1; // the last ray at or before the point's angle
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.angles[mid] <= a) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (i < 0) i = n - 1;
  const j = i === n - 1 ? 0 : i + 1;
  const ax = s.points[2 * i];
  const ay = s.points[2 * i + 1];
  const bx = s.points[2 * j];
  const by = s.points[2 * j + 1];
  const ex = bx - ax;
  const ey = by - ay;
  const sideV = ex * (py - ay) - ey * (px - ax);
  if (Math.abs(sideV) < 1e-9) return Math.hypot(qx - px, qy - py) <= Math.min(Math.hypot(ax - px, ay - py), Math.hypot(bx - px, by - py));
  return (ex * (qy - ay) - ey * (qx - ax)) * sideV >= 0;
}

/** The visibility polygon from (px, py) within `r` px, with its ray angles (for `inside`). */
export function sightPolygon(map: TileMap, px: number, py: number, r: number, steps = 96, b: Blocker = 'all'): SightPolygon {
  const segs = wallSegments(map, px, py, r, b);
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
  const buckets = bucketSegments(segs, px, py);
  const out: number[] = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const t = cast(px, py, dx, dy, buckets[bucketOf(a)], r);
    out.push(px + dx * t, py + dy * t);
  }
  return { points: out, angles };
}
