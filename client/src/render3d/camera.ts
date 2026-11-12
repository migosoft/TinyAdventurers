// Camera maths of the 3D view. World units are tiles: x east, z south, y up.
// Pitch is the angle between the view direction and the ground; yaw turns the
// view about the vertical axis. All angles are radians.
import { SHOT_LIFT_PX } from '../run/aim';

export const ART = 16; // art px per tile

/** Height (tiles) of a shot above the ground: the one shot height of the cards and the aim (#311). */
export const SHOT_LIFT = SHOT_LIFT_PX / ART;

export interface Cam { x: number; z: number; pitch: number; yaw: number }

/** Screen offset of a world point from the camera target, in tiles (sx right, sy up). */
export function project(cam: Cam, x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
  const c = Math.cos(cam.yaw);
  const s = Math.sin(cam.yaw);
  const dx = x - cam.x;
  const dz = z - cam.z;
  const xr = dx * c + dz * s;
  const zr = dz * c - dx * s;
  const sp = Math.sin(cam.pitch);
  const cp = Math.cos(cam.pitch);
  return { sx: xr, sy: -zr * sp + y * cp, depth: -zr * cp - y * sp };
}

/** Inverse of `project` on the ground plane y = 0. */
export function groundAt(cam: Cam, sx: number, sy: number): { x: number; z: number } {
  const zr = -sy / Math.sin(cam.pitch);
  return unrotate(cam.yaw, sx, zr, cam.x, cam.z);
}

function unrotate(yaw: number, xr: number, zr: number, ox: number, oz: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: ox + xr * c - zr * s, z: oz + xr * s + zr * c };
}

/** Rounds the point's screen position (measured from the world origin) to whole art px. */
export function snapGround(pitch: number, yaw: number, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const sp = Math.sin(pitch);
  const sx = Math.round((x * c + z * s) * ART);
  const sy = Math.round((z * c - x * s) * sp * ART);
  return unrotate(yaw, sx / ART, sy / (ART * sp), 0, 0);
}

/** Turns the movement keys (ix right, iz down) into a world direction. */
export function keysToWorld(yaw: number, ix: number, iz: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: ix * c - iz * s, z: ix * s + iz * c };
}

/** Whether a figure facing (fx, fz) looks left on screen; keeps `was` inside the dead zone. */
export function facesLeft(yaw: number, fx: number, fz: number, was: boolean): boolean {
  const sv = fx * Math.cos(yaw) + fz * Math.sin(yaw);
  if (Math.abs(sv) <= 0.08 * Math.hypot(fx, fz)) return was;
  return sv < 0;
}

/** The follow target kept so far inside the map that the screen's footprint on the ground stays inside it; centred on an axis the view exceeds. halfW, halfH in tiles. */
export function followClamp(map: { w: number; h: number }, cam: Cam, halfW: number, halfH: number): { x: number; z: number } {
  const hd = halfH / Math.sin(cam.pitch);
  const c = Math.abs(Math.cos(cam.yaw));
  const s = Math.abs(Math.sin(cam.yaw));
  const axis = (v: number, size: number, margin: number) =>
    2 * margin >= size ? size / 2 : Math.min(Math.max(v, margin), size - margin);
  return {
    x: axis(cam.x, map.w, c * halfW + s * hd),
    z: axis(cam.z, map.h, s * halfW + c * hd),
  };
}

/** The free camera's target, kept inside the map's rectangle. */
export function freeClamp(map: { w: number; h: number }, x: number, z: number): { x: number; z: number } {
  return { x: Math.min(Math.max(x, 0), map.w), z: Math.min(Math.max(z, 0), map.h) };
}

/** Unit vector from the target toward the camera. */
export function viewRay(pitch: number, yaw: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}
