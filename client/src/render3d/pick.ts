// The mouse pick of the 3D view: which hostile creature's hit cylinder (the one shots use, #323) lies under the pointer. Pure; the caller supplies the cylinders.
import { CONST, FLAG, HITBOX, KIND } from '../generated/defs';
import { shotPassesThrough } from '../game/shotTargets';
import { hitRadius } from '../sim/hitbox';
import { project, type Cam } from './camera';
import type { RenderPlan } from './quality';
import { drawnCam, toCanvas } from './screen';

/** Foot (x, z, drawn foot height y) in tiles; radius and height in art px. */
export interface PickCyl { id: number; x: number; z: number; y: number; r: number; h: number }

/** A creature a shot can hit: alive, with a hit cylinder, not an object, not hiding, not one shots fly through. */
export function pickable(e: { kind: number; side: number; flags: number }): boolean {
  return hitRadius(e.kind) !== null && e.kind !== KIND.Chest && e.kind !== KIND.Barrel
    && !(e.flags & (FLAG.HIDING | FLAG.DEAD)) && !shotPassesThrough(e);
}

export function cylinderOf(e: { id: number; kind: number; side: number; flags: number }, a: { x: number; z: number; y: number; alpha: number }): PickCyl | null {
  const r = hitRadius(e.kind);
  if (r === null || a.alpha <= 0 || !pickable(e)) return null;
  return { id: e.id, x: a.x, z: a.z, y: a.y, r, h: HITBOX[e.kind].h + (e.flags & FLAG.AIRBORNE ? CONST.DRAGON_LIFT : 0) };
}

/** The cylinder under canvas point (px, py); of several, the nearest the camera. Figures are stretched by 1/cos(pitch), so the test is on the canvas: `e` is the half-height of the foot and top ellipses. */
export function pickCylinder(cam: Cam, plan: RenderPlan, zoom: number, px: number, py: number, cyls: Iterable<PickCyl>): PickCyl | null {
  const dc = drawnCam(cam), sp = Math.sin(cam.pitch);
  let best: PickCyl | null = null, bestDepth = Infinity;
  for (const c of cyls) {
    const f = toCanvas(cam, plan, zoom, c.x, c.y, c.z);
    const dx = (px - f.px) / zoom, up = (f.py - py) / zoom;
    if (Math.abs(dx) >= c.r) continue;
    const e = c.r * sp * Math.sqrt(1 - (dx / c.r) ** 2);
    if (up < -e || up > c.h + e) continue;
    const depth = project(dc, c.x, c.y, c.z).depth; // smaller = nearer the camera
    if (depth < bestDepth) { best = c; bestDepth = depth; }
  }
  return best;
}
