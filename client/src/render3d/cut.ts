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

/**
 * How much of the cut applies at distance `d` toward the camera from the hero's line (0 = none, 1 = whole), where `hides` (0..1) is how much
 * seen floor the point covers (`floorAt(Q) * seen(Q)`).
 */
export function cutWeight(d: number, hides: number, look: CutLook): number {
  return look.on ? smoothstep(look.line, look.line + look.ramp, d) * smoothstep(0.5 - look.edge / 2, 0.5 + look.edge / 2, hides) : 0;
}

/** The height `y` after the cut: lowered toward `floor + stub`, never raised (floors, basins and chasms stay). */
export function cutY(y: number, d: number, hides: number, floor: number, look: CutLook): number {
  const w = cutWeight(d, hides, look);
  return y + (Math.min(y, floor + look.stub) - y) * w;
}
