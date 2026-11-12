// The 3D canvas and the world, both ways (#311). Canvas device px are the host's `c.canvas` space; `zoom` is canvas px per art px.
// Both functions use the camera as `View.draw` places it and the plan's destination rectangle, so they match the picture.
import { SHOT_LIFT_PX } from '../run/aim';
import { ART, groundAt, project, snapGround, type Cam } from './camera';
import type { RenderPlan } from './quality';

/** The camera as `View.draw` places it: the target snapped to whole art px. */
export function drawnCam(cam: Cam): Cam {
  const g = snapGround(cam.pitch, cam.yaw, cam.x, cam.z);
  return { ...cam, x: g.x, z: g.z };
}

/** Where the camera target lands on the canvas. */
export function screenCentre(plan: RenderPlan): { px: number; py: number } {
  return { px: plan.dstX + plan.dstW / 2, py: plan.dstY + plan.dstH / 2 };
}

/** A world point (x, z in tiles, y up in tiles) on the canvas; y grows downward. */
export function toCanvas(cam: Cam, plan: RenderPlan, zoom: number, x: number, y: number, z: number): { px: number; py: number } {
  const p = project(drawnCam(cam), x, y, z);
  const c = screenCentre(plan);
  return { px: c.px + p.sx * ART * zoom, py: c.py - p.sy * ART * zoom };
}

/** The ground point (tiles) for a canvas point read at shot height: moved SHOT_LIFT_PX art px down, then onto the floor. */
export function aimGround(cam: Cam, plan: RenderPlan, zoom: number, px: number, py: number): { x: number; z: number } {
  const c = screenCentre(plan);
  const k = ART * zoom;
  return groundAt(drawnCam(cam), (px - c.px) / k, -(py + SHOT_LIFT_PX * zoom - c.py) / k);
}
