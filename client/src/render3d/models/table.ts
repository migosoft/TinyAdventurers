import { KIND } from '../../generated/defs';
import type { FigureDesc } from './desc';
import { dwarf } from './descs/dwarf';
import { elf } from './descs/elf';
import { knight } from './descs/knight';
import { ogre } from './descs/ogre';
import { skelet } from './descs/skelet';
import { wizard } from './descs/wizard';
import { boar } from './descs/boar';
import { bunny } from './descs/bunny';
import { deer, stag } from './descs/deer';
import { wolf } from './descs/wolf';
import type { TubeDesc } from './tubeDesc';

export type DescKey = 'elf' | 'knight' | 'wizard' | 'dwarf' | 'skelet' | 'ogre' | 'wolf';

export type TubeKey = 'stag' | 'deer' | 'boar' | 'bunny';
export type ModelKey = DescKey | TubeKey;

/** The animals built from tubes and balls (#357). */
export const TUBE_DESCS: Record<TubeKey, TubeDesc> = { stag, deer, boar, bunny };

export const DESCS: Record<DescKey, FigureDesc> = { elf, knight, wizard, dwarf, skelet, ogre, wolf };

/** The game kinds that have a 3D model, and the description each one wears. */
export const MODEL_OF_KIND: Partial<Record<number, ModelKey>> = {
  [KIND.Wizard]: 'wizard',
  [KIND.Paladin]: 'knight',
  [KIND.Barbarian]: 'dwarf',
  [KIND.ElvenRanger]: 'elf',
  [KIND.SkeletonWarrior]: 'skelet',
  [KIND.SkeletonArcher]: 'skelet',
  [KIND.RaisedSkeleton]: 'skelet',
  [KIND.Ogre]: 'ogre',
  [KIND.DireWolf]: 'wolf',
  [KIND.Stag]: 'stag',
  [KIND.Deer]: 'deer',
  [KIND.Boar]: 'boar',
  [KIND.Bunny]: 'bunny',
};

/**
 * The kind whose card a description is fitted to (its model is exactly as tall as that kind's standing idle card). A description worn by
 * several kinds (the skeleton) is fitted to the first one; a record, so a new description cannot be added without one.
 */
export const FIT_KIND: Record<DescKey, number> = {
  wizard: KIND.Wizard,
  knight: KIND.Paladin,
  dwarf: KIND.Barbarian,
  elf: KIND.ElvenRanger,
  skelet: KIND.SkeletonWarrior,
  ogre: KIND.Ogre,
  wolf: KIND.DireWolf,
};

export function modelKeyOf(kind: number): ModelKey | null {
  return MODEL_OF_KIND[kind] ?? null;
}
