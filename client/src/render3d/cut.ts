// The wall cut (#347): level geometry that hides floor the followed hero sees is lowered to a stub. Pure rule; the shaders mirror it.

// The one smoothstep of the 3D view's masks (the see-through discs use it too; it lives here so that the two files do not import each other).
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * `stub` tiles above the floor that stay; `line` and `ramp` in tiles toward the camera: nothing is cut behind `line`, all of it past `line + ramp`;
 * `edge` the width (0..1) of the band in which the hide test turns from full wall to stub.
 */
export interface CutLook { on: boolean; stub: number; line: number; ramp: number; edge: number }
export const CUT_DEFAULTS: CutLook = { on: true, stub: 0.25, line: -1.5, ramp: 0.1, edge: 0.1 };

type CellH = (x: number, z: number) => number;
type Seen = (x: number, z: number) => number;

/** The ground point a point `(px, pz)` at height `y` covers on screen: behind it, away from the camera (`rx`, `rz` the unit vector toward it), `slope` = 1 / tan(pitch). */
export function hiddenPoint(px: number, pz: number, y: number, floor: number, rx: number, rz: number, slope: number): { x: number; z: number } {
  const k = Math.max(y - floor, 0) * slope;
  return { x: px - rx * k, z: pz - rz * k };
}

/** The `hides` value at the middle of the edge band: a column's centre seen edge-on covers its own wall cell (about 0), a facing wall's covers floor (about 1). */
export const HIDE_MID = 0.5;
/** A tile counts as floor when no higher than `floor + stub`; the threshold is this soft, so the bilinear mix stays continuous. */
export const FLOOR_SOFT = 0.05;
/** A point's weight comes from the cells at its xz this far off on each side (tiles): every vertex of a column, its friezes (0.05 out) included, reads the same cells. */
export const COLUMN_EPS = 0.1;

/**
 * 1 where the ground point (qx, qz) is floor the hero sees: the heights bilinear over the four nearest tile centres (`cellH(x, z)` a tile's height),
 * each tile soft-thresholded at `floor + stub`, times `seen(x, z)` (0..1). The shader mirrors it.
 */
export function hides(qx: number, qz: number, floor: number, stub: number, cellH: CellH, seen: Seen): number {
  const u = qx - 0.5, v = qz - 0.5, x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
  const limit = floor + stub;
  const open = (x: number, z: number) => 1 - smoothstep(limit, limit + FLOOR_SOFT, cellH(x, z));
  const m = (a: number, b: number, t: number) => a + (b - a) * t;
  const ground = m(m(open(x0, z0), open(x0 + 1, z0), fx), m(open(x0, z0 + 1), open(x0 + 1, z0 + 1), fx), fz);
  return ground * seen(qx, qz);
}

/**
 * How much of the cut applies at distance `d` toward the camera from the hero's line (0 = none, 1 = whole), where `hides` (0..1) is how much
 * seen floor the point covers (`floorAt(Q) * seen(Q)`).
 */
export function cutWeight(d: number, hides: number, look: CutLook): number {
  return look.on ? smoothstep(look.line, look.line + look.ramp, d) * smoothstep(HIDE_MID - look.edge / 2, HIDE_MID + look.edge / 2, hides) : 0;
}

/** The height `y` after the cut: lowered toward `floor + stub`, never raised (floors, basins and chasms stay). */
export function cutY(y: number, d: number, hides: number, floor: number, look: CutLook): number {
  const w = cutWeight(d, hides, look);
  return y + (Math.min(y, floor + look.stub) - y) * w;
}

/**
 * The cut of one cell's column (the shader's `cellWeightNode`): 0 unless the cell is wall (higher than `floor + stub`), else the rule at the cell's
 * centre, its top (the cell's height) covering the ground point `hiddenPoint`. `t` the followed hero's ground point, `r` the unit vector toward the camera.
 */
export function cellWeight(cx: number, cz: number, tx: number, tz: number, floor: number, rx: number, rz: number, slope: number, cellH: CellH, seen: Seen, look: CutLook): number {
  const h = cellH(cx, cz), mx = cx + 0.5, mz = cz + 0.5, limit = floor + look.stub;
  const q = hiddenPoint(mx, mz, h, floor, rx, rz, slope);
  return smoothstep(limit, limit + FLOOR_SOFT, h) * cutWeight((mx - tx) * rx + (mz - tz) * rz, hides(q.x, q.z, floor, look.stub, cellH, seen), look);
}

/** The weight at point (px, pz) (the shader's `cutWeightNode`): the largest `cellWeight` of the cells `COLUMN_EPS` around it. Its height plays no part, so a column is cut whole. */
export function cutWeightAt(px: number, pz: number, tx: number, tz: number, floor: number, rx: number, rz: number, slope: number, cellH: CellH, seen: Seen, look: CutLook): number {
  let w = 0;
  for (const dx of [-COLUMN_EPS, COLUMN_EPS]) for (const dz of [-COLUMN_EPS, COLUMN_EPS]) w = Math.max(w, cellWeight(Math.floor(px + dx), Math.floor(pz + dz), tx, tz, floor, rx, rz, slope, cellH, seen, look));
  return w;
}

/** Whether a wall torch hides (the torch materials' rule): its own column, the cell behind the wall point `(wx, wz)` (`n` the normal into the room), weighs over a half. */
export function torchHidden(wx: number, wz: number, nx: number, nz: number, tx: number, tz: number, floor: number, rx: number, rz: number, slope: number, cellH: CellH, seen: Seen, look: CutLook): boolean {
  return cellWeight(Math.floor(wx - nx / 2), Math.floor(wz - nz / 2), tx, tz, floor, rx, rz, slope, cellH, seen, look) > 0.5;
}
