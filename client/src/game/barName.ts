import { FLAG, KIND, SIDE } from '../generated/defs';
import { FIGURES, isAnimalKind, isBossKind, isHazardKind, isPlayerKind, isProjectileKind } from './anim/defs';

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

/** How a creature's HP bar is drawn: the width in art px, the fill (a hero, a neutral or an enemy), and the name over it. */
export interface BarLook {
  w: number;
  fill: 'hero' | 'neutral' | 'enemy';
  /** The name over the bar and its colour, or null. */
  label: { text: string; color: string } | null;
}

export const BAR_LABEL_HERO = '#7fe08a';
export const BAR_LABEL_OTHER = '#b8c4d8';

/**
 * The one rule for who gets a bar and how it looks, shared by the 2D and the 3D view: none for shots, hazards, chests, barrels,
 * bosses (they have the boss bar) and the dead; the ogre's is 28 wide, others 12; a hero or a Friendly creature is green unless it
 * is on the enemy side (a charmed hero is red), Neutral grey-blue, the rest red; Neutral and Friendly creatures carry a name.
 */
export function barOf(e: { kind: number; side: number; flags: number; hp: number; extra: number }, heroNames: Map<number, string>): BarLook | null {
  if (isProjectileKind(e.kind) || isHazardKind(e.kind) || e.kind === KIND.Chest || e.kind === KIND.Barrel || isBossKind(e.kind) || e.flags & FLAG.DEAD) return null;
  if (!showsBar(e)) return null;
  const hero = (isPlayerKind(e.kind) && e.side !== SIDE.Hostile) || e.side === SIDE.Friendly;
  const named = e.side !== SIDE.Hostile && !isPlayerKind(e.kind) && !isAnimalKind(e.kind);
  const name = named ? barName(e, heroNames) : undefined;
  return {
    w: e.kind === KIND.Ogre ? 28 : 12,
    fill: hero ? 'hero' : e.side === SIDE.Neutral ? 'neutral' : 'enemy',
    label: name ? { text: name, color: hero ? BAR_LABEL_HERO : BAR_LABEL_OTHER } : null,
  };
}
