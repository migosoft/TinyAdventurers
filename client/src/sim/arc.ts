// Port of server/src/run/arc.rs: the gravity arc of a weapon shot (#321).
import { CONST } from '../generated/defs';

export function flightTime(dist: number, speed: number): number {
  return dist / speed;
}

/** Height above the ground `t` s into a flight of `flight` s: SHOT_HEIGHT at 0, 0 at `flight`. */
export function shotZ(flight: number, t: number): number {
  const g = CONST.GRAVITY;
  const vz = ((g / 2) * flight * flight - CONST.SHOT_HEIGHT) / flight;
  return CONST.SHOT_HEIGHT + vz * t - (g / 2) * t * t;
}

export function arcTouches(bx: number, by: number, bodyR: number, top: number, px: number, py: number, z: number, shotR: number): boolean {
  return Math.sqrt((px - bx) * (px - bx) + (py - by) * (py - by)) <bodyR + shotR && z < top;
}
