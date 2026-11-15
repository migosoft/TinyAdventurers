import { KIND } from '../../generated/defs';
import type { FigureDesc } from './desc';
import { dwarf } from './descs/dwarf';
import { elf } from './descs/elf';
import { knight } from './descs/knight';
import { ogre } from './descs/ogre';
import { skelet } from './descs/skelet';
import { wizard } from './descs/wizard';
import { wolf } from './descs/wolf';

export type DescKey = 'elf' | 'knight' | 'wizard' | 'dwarf' | 'skelet' | 'ogre' | 'wolf';

export const DESCS: Record<DescKey, FigureDesc> = { elf, knight, wizard, dwarf, skelet, ogre, wolf };

/** The game kinds that have a 3D model, and the description each one wears. */
export const MODEL_OF_KIND: Partial<Record<number, DescKey>> = {
  [KIND.Wizard]: 'wizard',
  [KIND.Paladin]: 'knight',
  [KIND.Barbarian]: 'dwarf',
  [KIND.ElvenRanger]: 'elf',
  [KIND.SkeletonWarrior]: 'skelet',
  [KIND.SkeletonArcher]: 'skelet',
  [KIND.RaisedSkeleton]: 'skelet',
  [KIND.Ogre]: 'ogre',
  [KIND.DireWolf]: 'wolf',
};

export function modelKeyOf(kind: number): DescKey | null {
  return MODEL_OF_KIND[kind] ?? null;
}
