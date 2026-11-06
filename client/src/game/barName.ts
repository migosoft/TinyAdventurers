import { KIND } from '../generated/defs';
import { FIGURES, isPlayerKind } from './anim/defs';

/** What a Friendly creature is called after its owner: "wolf", "knight". Shared with the rules log's tags. */
export const companionNoun = (kind: number): string => (kind === KIND.DireWolf ? 'wolf' : (FIGURES[kind]?.label ?? 'companion').toLowerCase());

/**
 * The name over the always-visible bar of a creature that is not hostile: the wolf reads "{leader}'s wolf"
 * (its `extra` is the leader's entity id), anything else its figure's label ("Knight"). A hero has none.
 */
export function barName(e: { kind: number; extra: number }, names: Map<number, string>): string | undefined {
  if (isPlayerKind(e.kind)) return undefined;
  const owner = e.kind === KIND.DireWolf ? names.get(e.extra) : undefined;
  return owner ? `${owner}'s ${companionNoun(e.kind)}` : FIGURES[e.kind]?.label;
}
