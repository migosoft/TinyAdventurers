// Port of `Monster::shot_dist` (server/src/run/entities.rs): where a hero's shot
// meets a monster. Shots are drawn SHOT_HEIGHT px above their ground point and
// figures stand up from their feet, so a tall figure is a capsule reaching north.
import { CONST, HITBOX } from '../generated/defs';

/** Distance from a shot at (px, py) to the body of a monster of `kind` standing at (x, y); null for kinds shots don't hit. */
export function shotDist(kind: number, x: number, y: number, airborne: boolean, px: number, py: number): number | null {
  const hb = HITBOX[kind];
  if (!hb) return null;
  const lift = airborne ? CONST.DRAGON_LIFT : 0;
  const reach = Math.max(0, hb.h + lift - CONST.SHOT_HEIGHT - hb.r);
  const cy = Math.min(Math.max(py, y - reach), y);
  return Math.hypot(px - x, py - cy);
}

/** Whether a shot of radius `shotR` at (px, py) touches that monster. */
export function shotHits(kind: number, x: number, y: number, airborne: boolean, px: number, py: number, shotR: number): boolean {
  const d = shotDist(kind, x, y, airborne, px, py);
  return d !== null && d < HITBOX[kind].r + shotR;
}
