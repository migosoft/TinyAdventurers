// The wall cut (#347): level geometry on the camera's side of the followed hero is lowered to a stub. Pure rule; the shaders mirror it.

// The one smoothstep of the 3D view's masks (the see-through discs use it too; it lives here so that the two files do not import each other).
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** `stub` tiles above the floor that stay; `line` and `ramp` in tiles toward the camera: nothing is cut behind `line`, all of it past `line + ramp`. */
export interface CutLook { on: boolean; stub: number; line: number; ramp: number }
export const CUT_DEFAULTS: CutLook = { on: true, stub: 0.25, line: 0, ramp: 0.5 };

/** How much of the cut applies at distance `d` toward the camera from the hero's line (0 = none, 1 = whole). */
export function cutWeight(d: number, look: CutLook): number {
  return look.on ? smoothstep(look.line, look.line + look.ramp, d) : 0;
}

/** The height `y` after the cut: lowered toward `floor + stub`, never raised (floors, basins and chasms stay). */
export function cutY(y: number, d: number, floor: number, look: CutLook): number {
  const w = cutWeight(d, look);
  return y + (Math.min(y, floor + look.stub) - y) * w;
}
