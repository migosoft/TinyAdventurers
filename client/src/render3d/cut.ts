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

/** The ground point a point `(px, pz)` at height `y` covers on screen: behind it, away from the camera (`rx`, `rz` the unit vector toward it), `slope` = 1 / tan(pitch). */
export function hiddenPoint(px: number, pz: number, y: number, floor: number, rx: number, rz: number, slope: number): { x: number; z: number } {
  const k = Math.max(y - floor, 0) * slope;
  return { x: px - rx * k, z: pz - rz * k };
}

/** The `hides` value at the middle of the edge band. 0.75, not 0.5: a wall seen edge-on (the ray parallel to it) reads exactly 0.5 from the bilinear mix of wall and floor centres and must stay full. */
export const HIDE_MID = 0.75;
/** A tile counts as floor when no higher than `floor + stub`; the threshold is this soft, so the bilinear mix stays continuous. */
export const FLOOR_SOFT = 0.05;

/**
 * 1 where the ground the point (px, pz) at height `y` covers on screen is floor the hero sees: the heights bilinear over the four nearest
 * tile centres (`cellH(x, z)` a tile's height, `seen(x, z)` 0..1 at the ground point), each tile soft-thresholded at `floor + stub`. The shader mirrors it.
 */
export function hides(px: number, pz: number, y: number, floor: number, rx: number, rz: number, slope: number, stub: number, cellH: (x: number, z: number) => number, seen: (x: number, z: number) => number): number {
  const q = hiddenPoint(px, pz, y, floor, rx, rz, slope);
  const u = q.x - 0.5, v = q.z - 0.5, x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
  const limit = floor + stub;
  const open = (x: number, z: number) => 1 - smoothstep(limit, limit + FLOOR_SOFT, cellH(x, z));
  const m = (a: number, b: number, t: number) => a + (b - a) * t;
  const ground = m(m(open(x0, z0), open(x0 + 1, z0), fx), m(open(x0, z0 + 1), open(x0 + 1, z0 + 1), fx), fz);
  return ground * seen(q.x, q.z);
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
