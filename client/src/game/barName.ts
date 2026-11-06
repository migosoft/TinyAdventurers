import { FLAG, KIND, SIDE } from '../generated/defs';
import { FIGURES, isAnimalKind, isPlayerKind } from './anim/defs';

/** What a Friendly creature is called after its owner: "wolf", "knight". Shared with the rules log's tags. */
export const companionNoun = (kind: number): string => (kind === KIND.DireWolf ? 'wolf' : (FIGURES[kind]?.label ?? 'companion').toLowerCase());

/**
 * The name over the always-visible bar of a creature that is not hostile: the wolf reads "{leader}'s wolf"
 * (its `extra` is the leader's entity id), anything else its figure's label ("Knight"). A hero has none.
 */
export function barName(e: { kind: number; extra: number }, names: Map<number, string>): string | undefined {
  if (isPlayerKind(e.kind) || isAnimalKind(e.kind)) return undefined;
  const owner = e.kind === KIND.DireWolf ? names.get(e.extra) : undefined;
  return owner ? `${owner}'s ${companionNoun(e.kind)}` : FIGURES[e.kind]?.label;
}

/** Whether a creature's bar is drawn: the ogre's always, Neutral and Friendly creatures' (the knight, the wolf) always, a calm animal's and an enemy's only once hurt. */
export function showsBar(e: { kind: number; side: number; flags: number; hp: number }): boolean {
  const named = e.side !== SIDE.Hostile && !isPlayerKind(e.kind) && !isAnimalKind(e.kind) && !(e.flags & FLAG.WILD);
  return e.hp < 1 || e.kind === KIND.Ogre || named;
}
