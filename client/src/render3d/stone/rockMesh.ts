// The mesh of natural rock (#380 part 4), after `shape.ts`: a rock wall cell beside open ground as a grid over the cell that is fine
// across each slope and coarse elsewhere, a column as rings, and the rock floor: two triangles a cell, finer under a puddle, and cut
// along every crevice's piece, so a groove's edges are edges of triangles. Pure: no three.
import { WALL_H, heightAt } from '../heights';
import { FACE_H, FACE_W } from './format';
import { KIND } from './grid';
import { NONE, type Corner, type Out, type Vec3 } from './laidMesh';
import type { SheetPlan } from './plan';
import { BASIN_GRID, COLUMN, columnRadius, cornerLow, floorIn, grooveAt, heightIn, keyOf, sideReach, up, wallY, type Seg, type Shape, type Wall } from './shape';

/** What the rock is meshed with: the level's shape, the sheets' plan and the chunk's ground texel of a world point. */
export interface RockEnv { s: Shape; plan: SheetPlan; ground(x: number, z: number): Vec3 }

/** The rows of vertices across a slope, as shares of its reach: closer together where it is steep. */
export const SLOPE_ROWS = [0, 0.4, 0.65, 0.85, 1];
/** The quads between a slope and the cell's far edge or the slope of the other side, and along a side without a slope. */
const FILL = 2, PLAIN = 4;
/** A rock wall's vertex reads light and sight this far inside the nearest open cell (tiles). */
export const PUSH_IN = 0.2;
/** The normal is the height's fall over this distance (tiles). */
const NORMAL_STEP = 0.02;
/** A column's sides round. */
const COLUMN_SIDES = 16;

/** The offset from a point of a wall cell to the point `PUSH_IN` inside the nearest lower cell beside it. */
function pushOf(e: RockEnv, w: Wall, px: number, pz: number): [number, number] {
  let best = Infinity, tx = px, tz = pz;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (heightAt(e.s.map, w.x + dx, w.z + dz) >= w.h) continue;
    const qx = Math.min(w.x + dx + 1 - PUSH_IN, Math.max(w.x + dx + PUSH_IN, px)), qz = Math.min(w.z + dz + 1 - PUSH_IN, Math.max(w.z + dz + PUSH_IN, pz));
    const d = (qx - px) ** 2 + (qz - pz) ** 2;
    if (d < best) { best = d; tx = qx; tz = qz; }
  }
  return [tx - px, tz - pz];
}

/**
 * A vertex of a wall cell's rock. Its wall texels: the px of the face on its side of the cell at its height; round a corner that alone
 * touches open ground, the px of the face that ends in that corner, mirrored, so the rock runs on round the corner.
 */
function wallCorner(e: RockEnv, w: Wall, px: number, y: number, pz: number, south: boolean, east: boolean): Corner {
  const texel = (side: number, x: number, z: number, own: boolean, at: number): Vec3 => {
    const slot = e.plan.slotOf({ x, z, side: side as 0 | 1 | 2 | 3 }), u = Math.min(1, Math.max(0, own ? at : 1 - at));
    return [slot.u + u * FACE_W, slot.v + (WALL_H - y) * (FACE_H / WALL_H), slot.layer];
  };
  const sa = w.open[0] && w.open[1] ? (south ? 0 : 1) : w.open[1] ? 1 : w.open[0] ? 0 : south ? 0 : 1;
  const sb = w.open[2] && w.open[3] ? (east ? 2 : 3) : w.open[3] ? 3 : w.open[2] ? 2 : east ? 2 : 3;
  const diag = w.diag[(sb === 2 ? 1 : 0) + (sa === 0 ? 2 : 0)];
  return {
    p: [px, y, pz], sheet: e.ground(px, pz), push: pushOf(e, w, px, pz),
    a: w.open[sa] ? texel(sa, w.x, w.z, true, px - w.x) : diag ? texel(sa, w.x + (sb === 2 ? 1 : -1), w.z, false, px - w.x) : NONE,
    b: w.open[sb] ? texel(sb, w.x, w.z, true, pz - w.z) : diag ? texel(sb, w.x, w.z + (sa === 0 ? 1 : -1), false, pz - w.z) : NONE,
  };
}

/** The rock's height for a normal: open ground counts as level, so a foot's normal leans halfway between floor and slope. */
const solid = (e: RockEnv, x: number, z: number): number => (heightAt(e.s.map, Math.floor(x), Math.floor(z)) > 0 ? heightIn(e.s, x, z) : 0);
function normalAt(e: RockEnv, x: number, z: number): Vec3 {
  const d = NORMAL_STEP, gx = (solid(e, x + d, z) - solid(e, x - d, z)) / (2 * d), gz = (solid(e, x, z + d) - solid(e, x, z - d)) / (2 * d), l = Math.hypot(gx, 1, gz);
  return [-gx / l, 1 / l, -gz / l];
}

/** An axis's stations: [0 the low side's slope, 1 between, 2 the high side's slope; the share of the slope's reach or of the stretch between]. */
function stations(low: boolean, high: boolean): [number, number][] {
  const out: [number, number][] = low ? SLOPE_ROWS.map((t) => [0, t]) : [[1, 0]];
  const n = low || high ? FILL : PLAIN;
  for (let i = 1; i < n; i++) out.push([1, i / n]);
  if (high) for (let i = SLOPE_ROWS.length - 1; i >= 0; i--) out.push([2, SLOPE_ROWS[i]]);
  else out.push([1, 1]);
  return out;
}

/**
 * A rock wall cell beside open ground: a grid of vertices whose rows crowd into the slopes. A slope's rows lie at shares of its reach
 * there, so with no reach (against masonry) they stand upright in the cell's edge.
 */
export function rockSlope(e: RockEnv, w: Wall, out: Out): void {
  const active = (side: number, corners: number[]): boolean => w.open[side] || corners.some((c) => w.diag[c]);
  const xs = stations(active(3, [0, 2]), active(2, [1, 3])), zs = stations(active(1, [0, 1]), active(0, [2, 3]));
  /** A station's place along its axis (0..1) and how far up the low and the high side's slope it lies. */
  const place = (st: [number, number], rl: number, rh: number): [number, number, number] => {
    const lo = Math.max(0, rl), hi = 1 - Math.max(0, rh);
    return st[0] === 0 ? [lo * st[1], rl < 0 ? 1 : up(st[1], rl), 1] : st[0] === 2 ? [1 - (1 - hi) * st[1], 1, rh < 0 ? 1 : up(st[1], rh)] : [lo + (hi - lo) * st[1], 1, 1];
  };
  const ids: number[] = [];
  for (const sz of zs) for (const sx of xs) {
    // a slope's reach is taken where the vertex lies along its side, and that depends on the other axis's slopes: two rounds settle it
    let px = w.x + 0.5, pz = w.z + 0.5, ax = [0, 1, 1], az = [0, 1, 1];
    for (let i = 0; i < 2; i++) {
      ax = place(sx, sideReach(w, 3, px, pz), sideReach(w, 2, px, pz));
      px = w.x + ax[0];
      az = place(sz, sideReach(w, 1, px, pz), sideReach(w, 0, px, pz));
      pz = w.z + az[0];
    }
    const y = wallY(e.s, w, [az[2], az[1], ax[2], ax[1]], px, pz);
    ids.push(out.vert(wallCorner(e, w, px, y, pz, pz >= w.z + 0.5, px >= w.x + 0.5), normalAt(e, px, pz), KIND.face));
  }
  const n = xs.length;
  for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i + 1 < n; i++) {
    const a = ids[j * n + i], b = ids[j * n + i + 1], c = ids[(j + 1) * n + i + 1], d = ids[(j + 1) * n + i];
    out.tri(a, b, c); out.tri(a, c, d);
  }
}

/** A column: rings of quads from the cell's square foot over the waist to the top, and the top. Each quad has its own vertices, with the wall texels of its side. */
export function rockColumn(e: RockEnv, w: Wall, out: Out): void {
  const cx = w.x + 0.5, cz = w.z + 0.5, N = COLUMN_SIDES, last = COLUMN.length - 1;
  const at = (k: number, i: number): Vec3 => {
    const ang = (i / N) * Math.PI * 2, r = columnRadius(e.s, w, k, ang);
    return [cx + Math.cos(ang) * r, COLUMN[k][0] * w.h, cz + Math.sin(ang) * r];
  };
  for (let i = 0; i < N; i++) {
    const mid = ((i + 0.5) / N) * Math.PI * 2, south = Math.sin(mid) >= 0, east = Math.cos(mid) >= 0;
    for (let k = 0; k < last; k++) {
      const q = [at(k, i), at(k, i + 1), at(k + 1, i + 1), at(k + 1, i)];
      const ids = q.map((p, j) => {
        // the normal leans as the outline does between the rings below and above
        const ring = j < 2 ? k : k + 1, lo = at(Math.max(0, ring - 1), i + (j === 1 || j === 2 ? 1 : 0)), hi = at(Math.min(last, ring + 1), i + (j === 1 || j === 2 ? 1 : 0));
        const dr = Math.hypot(hi[0] - cx, hi[2] - cz) - Math.hypot(lo[0] - cx, lo[2] - cz), dy = hi[1] - lo[1], r = Math.hypot(p[0] - cx, p[2] - cz) || 1, l = Math.hypot(dy, dr);
        return out.vert(wallCorner(e, w, p[0], p[1], p[2], south, east), [((p[0] - cx) / r) * (dy / l), -dr / l, ((p[2] - cz) / r) * (dy / l)], KIND.face);
      });
      out.tri(ids[0], ids[1], ids[2]); out.tri(ids[0], ids[2], ids[3]);
    }
  }
  const top = (p: Vec3): number => out.vert({ p, sheet: e.ground(p[0], p[2]), a: NONE, b: NONE, push: pushOf(e, w, p[0], p[2]) }, [0, 1, 0], KIND.face);
  const hub = top([cx, w.h, cz]), rim = Array.from({ length: N }, (_, i) => top(at(last, i)));
  for (let i = 0; i < N; i++) out.tri(hub, rim[i], rim[(i + 1) % N]);
}

type P = [number, number];
/** Cuts every polygon along the line through (ax, az) across the direction (nx, nz). */
function cut(polys: P[][], ax: number, az: number, nx: number, nz: number): P[][] {
  const out: P[][] = [], E = 1e-7;
  for (const poly of polys) {
    const d = poly.map(([x, z]) => (x - ax) * nx + (z - az) * nz);
    if (d.every((v) => v >= -E) || d.every((v) => v <= E)) { out.push(poly); continue; }
    const front: P[] = [], back: P[] = [];
    poly.forEach((p, i) => {
      const j = (i + 1) % poly.length;
      if (d[i] >= -E) front.push(p);
      if (d[i] <= E) back.push(p);
      if ((d[i] > E && d[j] < -E) || (d[i] < -E && d[j] > E)) {
        const t = d[i] / (d[i] - d[j]), x: P = [p[0] + (poly[j][0] - p[0]) * t, p[1] + (poly[j][1] - p[1]) * t];
        front.push(x); back.push(x);
      }
    });
    if (front.length > 2) out.push(front);
    if (back.length > 2) out.push(back);
  }
  return out;
}
/** The lines a crevice's piece cuts the floor along: its middle and its two edges, and across it its ends and where its round ends stop. */
function cutAlong(polys: P[][], c: Seg): P[][] {
  const len = Math.hypot(c.x1 - c.x0, c.z1 - c.z0) || 1, dx = (c.x1 - c.x0) / len, dz = (c.z1 - c.z0) / len;
  for (const o of [-c.half, 0, c.half]) polys = cut(polys, c.x0 - dz * o, c.z0 + dx * o, -dz, dx);
  for (const o of [-c.half, 0, len, len + c.half]) polys = cut(polys, c.x0 + dx * o, c.z0 + dz * o, dx, dz);
  return polys;
}

/**
 * A floor cell of uneven rock (`roughCell`). Plain: its four corners, smooth. Under a puddle or along a crevice: the triangles of
 * `BASIN_GRID` (or of the cell), cut along each crevice piece, every piece of the cut flat with a normal of its own, so a groove has hard edges.
 */
export function rockFloor(e: RockEnv, x: number, z: number, out: Out): void {
  const s = e.s, k = keyOf(s, x, z), segs = s.segs.get(k), G = s.puddles.has(k) ? BASIN_GRID : 1;
  if (G === 1 && !segs) {
    const ids = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => {
      const X = x + i, Z = z + j, gx = (cornerLow(s, X + 1, Z) - cornerLow(s, X - 1, Z)) / 2, gz = (cornerLow(s, X, Z + 1) - cornerLow(s, X, Z - 1)) / 2, l = Math.hypot(gx, 1, gz);
      return out.vert({ p: [X, cornerLow(s, X, Z), Z], sheet: e.ground(X, Z), a: NONE, b: NONE }, [-gx / l, 1 / l, -gz / l], KIND.floor);
    });
    out.tri(ids[0], ids[1], ids[2]); out.tri(ids[1], ids[3], ids[2]);
    return;
  }
  let polys: P[][] = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x0 = x + i / G, x1 = x + (i + 1) / G, z0 = z + j / G, z1 = z + (j + 1) / G;
    polys.push([[x0, z0], [x1, z0], [x0, z1]], [[x1, z0], [x1, z1], [x0, z1]]);
  }
  for (const c of segs ?? []) polys = cutAlong(polys, c);
  /** The nearest point of the crevices' lines. */
  const onLine = (x: number, z: number): P => {
    let best = Infinity, at: P = [x, z];
    for (const c of segs ?? []) {
      const dx = c.x1 - c.x0, dz = c.z1 - c.z0, t = Math.min(1, Math.max(0, ((x - c.x0) * dx + (z - c.z0) * dz) / (dx * dx + dz * dz || 1)));
      const qx = c.x0 + dx * t, qz = c.z0 + dz * t, d = (x - qx) ** 2 + (z - qz) ** 2;
      if (d < best) { best = d; at = [qx, qz]; }
    }
    return at;
  };
  for (const poly of polys) {
    const p = poly.map(([px, pz]): Vec3 => [px, floorIn(s, px, pz), pz]);
    // a piece of a groove reads the px on the crevice's line, which the painter made black: the groove is black whichever way its sides face
    const groove = !!segs && grooveAt(segs, poly.reduce((a, q) => a + q[0], 0) / poly.length, poly.reduce((a, q) => a + q[1], 0) / poly.length) > 0;
    // the piece's normal: the sum over its corners (Newell), which no three corners in a line can spoil
    let nx = 0, ny = 0, nz = 0;
    p.forEach((a, i) => { const b = p[(i + 1) % p.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); });
    const l = Math.hypot(nx, ny, nz) * Math.sign(ny);
    if (!l) continue; // no area
    const ids = p.map((v) => out.vert({ p: v, sheet: groove ? e.ground(...onLine(v[0], v[2])) : e.ground(v[0], v[2]), a: NONE, b: NONE }, [nx / l, ny / l, nz / l], KIND.floor));
    for (let i = 1; i + 1 < ids.length; i++) out.tri(ids[0], ids[i], ids[i + 1]);
  }
}
