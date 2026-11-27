// Port of the server's hit cylinder (server/src/run/entities.rs `hit_radius`, server/src/run/arc.rs
// `shot_touches`): every creature is hit through one upright cylinder of radius
// max(body radius, SHOT_MIN_RADIUS) and the height it is drawn at.
import { CONST, HITBOX } from '../generated/defs';
import { arcTouches } from './arc';

/** Radius of the hit cylinder of `kind`; null for kinds shots don't hit. */
export function hitRadius(kind: number): number | null {
  const hb = HITBOX[kind];
  return hb ? Math.max(hb.r, CONST.SHOT_MIN_RADIUS) : null;
}

/** Whether an arcing shot at (px, py) at height `z` meets that monster (server `shot_touches`, arcing). */
export function arcHits(kind: number, x: number, y: number, airborne: boolean, px: number, py: number, z: number, shotR: number): boolean {
  const r = hitRadius(kind);
  return r !== null && arcTouches(x, y, r, HITBOX[kind].h + (airborne ? CONST.DRAGON_LIFT : 0), px, py, z, shotR);
}

/** Whether a flat shot of radius `shotR` at (px, py) touches that monster; its height does not matter. */
export function shotHits(kind: number, x: number, y: number, px: number, py: number, shotR: number): boolean {
  const r = hitRadius(kind);
  return r !== null && Math.hypot(px - x, py - y) < r + shotR;
}
