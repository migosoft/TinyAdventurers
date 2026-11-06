// Which entities a hero's shot flies through (server: a Friendly shot only hits `Side::Hostile` monsters).
import { FLAG, SIDE } from '../generated/defs';
import { FIGURES, isAnimalKind, isPlayerKind } from './anim/defs';

/** True for a creature that is not Hostile (a neutral or recruited knight, the wolf, a teammate), except wildlife. Objects are sent with side 0 too but have no figure, so they still stop shots. */
export function shotPassesThrough(e: { kind: number; side: number; flags: number }): boolean {
  // A wildlife animal is a target even while it is Neutral (calm, or a grudge only against enemies).
  if (isAnimalKind(e.kind) || e.flags & FLAG.WILD) return false;
  return (isPlayerKind(e.kind) || !!FIGURES[e.kind]) && e.side !== SIDE.Hostile;
}
