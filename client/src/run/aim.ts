// One aim origin for both views (#311): the aim is measured from the hero's foot to the aimed point at the foot plane.
import type { OwnHero } from './view';

/** Height (art px) a shot is drawn above its ground point; the pointer is read at this height. */
export const SHOT_LIFT_PX = 8;

/** The angle and distance from `from` to `p` (simulation px). */
export function aimAt(from: { x: number; y: number }, p: { x: number; y: number }): { aim: number; dist: number } {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  return { aim: Math.atan2(dy, dx), dist: Math.hypot(dx, dy) };
}

/** Settles the drawn weapon aim after the view has placed its camera: from the aim origin to `p`, when the session
 *  says the hero aims at the pointer and there is one. Otherwise `own.aim` stays as the session set it. */
export function settleOwnAim(own: OwnHero, p: { x: number; y: number } | null): void {
  if (!own.aimsAtPointer || !p) return;
  own.aim = aimAt({ x: own.aimFromX, y: own.aimFromY }, p).aim;
}
