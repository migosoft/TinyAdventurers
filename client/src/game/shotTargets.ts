// Which entities a hero's shot flies through (server: a Friendly shot only hits `Side::Hostile` monsters).
import { SIDE } from '../generated/defs';
import { FIGURES, isPlayerKind } from './anim/defs';

/** True for a creature that is not Hostile (a neutral or recruited knight, the wolf, a teammate). Objects are sent with side 0 too but have no figure, so they still stop shots. */
export function shotPassesThrough(e: { kind: number; side: number }): boolean {
  return (isPlayerKind(e.kind) || !!FIGURES[e.kind]) && e.side !== SIDE.Hostile;
}
