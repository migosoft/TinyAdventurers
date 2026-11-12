// Which things open the walls in front of them in the 3D view, and which of those the viewer may see (#303).
import { FLAG, KIND, SIDE } from '../generated/defs';
import { isHazardKind, isProjectileKind } from '../game/anim/defs';
import type { Opener } from './figures';

/**
 * Whether an entity opens walls: heroes (own, teammates, the spectated), Hostile creatures, Friendly creatures, chests and
 * hiding mimics; not Neutral creatures, barrels, torches, hazards or shots; nothing dead or falling (`fading`). A revealed
 * mimic is an ordinary Hostile creature, a hiding one counts like a chest.
 */
export function opensWalls(e: { kind: number; side: number; flags: number }, fading: boolean): boolean {
  if (fading || e.flags & FLAG.DEAD) return false;
  if (e.kind === KIND.Chest) return true;
  if (e.kind === KIND.Mimic) return !!(e.flags & FLAG.HIDING) || e.side === SIDE.Hostile;
  if (e.kind === KIND.Barrel || e.kind === KIND.Torch || isHazardKind(e.kind) || isProjectileKind(e.kind)) return false;
  // Heroes and creatures go by side.
  return e.side === SIDE.Hostile || e.side === SIDE.Friendly;
}

/** Of `openers`, those the viewer may see: standing on a tile `sight.isVisible`. */
export function seenOpeners(openers: readonly Opener[], sight: { isVisible(x: number, y: number): boolean }): Opener[] {
  return openers.filter((o) => sight.isVisible(Math.floor(o.x), Math.floor(o.z)));
}
