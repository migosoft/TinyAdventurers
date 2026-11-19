import { KIND } from '../../generated/defs';
import type { FigureDesc } from './desc';
import { dwarf } from './descs/dwarf';
import { elf } from './descs/elf';
import { knight } from './descs/knight';
import { ogre } from './descs/ogre';
import { skelet } from './descs/skelet';
import { wizard } from './descs/wizard';
import { barrel } from './descs/barrel';
import { boar } from './descs/boar';
import { bunny } from './descs/bunny';
import { chest } from './descs/chest';
import { chort } from './descs/chort';
import { deer, stag } from './descs/deer';
import { ghost } from './descs/ghost';
import { goblin } from './descs/goblin';
import { imp } from './descs/imp';
import { mimic } from './descs/mimic';
import { npcKnight } from './descs/npcKnight';
import { orc } from './descs/orc';
import { shade } from './descs/shade';
import { disciple, necromancer, summoner } from './descs/robed';
import { wolf } from './descs/wolf';
import type { TubeDesc } from './tubeDesc';

export type DescKey = 'elf' | 'knight' | 'wizard' | 'dwarf' | 'skelet' | 'ogre' | 'wolf';

export type TubeKey = 'stag' | 'deer' | 'boar' | 'bunny' | 'goblin' | 'orc' | 'npcKnight' | 'necromancer' | 'summoner' | 'disciple' | 'imp' | 'chort' | 'chest' | 'mimic' | 'barrel' | 'ghost' | 'shade';
export type ModelKey = DescKey | TubeKey;

/** The models built from tubes and balls: the woodland animals (#357) and the two-legged creatures (#356). */
export const TUBE_DESCS: Record<TubeKey, TubeDesc> = { stag, deer, boar, bunny, goblin, orc, npcKnight, necromancer, summoner, disciple, imp, chort, chest, mimic, barrel, ghost, shade };

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
  [KIND.GoblinArcher]: 'goblin',
  [KIND.OrcWarrior]: 'orc',
  // The archer is the same orc: its bow is the kind's own weapon (`FigureDef.weapon`).
  [KIND.OrcArcher]: 'orc',
  [KIND.Knight]: 'npcKnight',
  [KIND.Necromancer]: 'necromancer',
  [KIND.Summoner]: 'summoner',
  [KIND.Disciple]: 'disciple',
  // The summoner's imps are this kind too: one look, no tint.
  [KIND.Imp]: 'imp',
  [KIND.Chort]: 'chort',
  [KIND.Ghost]: 'ghost',
  [KIND.Shade]: 'shade',
};

/** The game objects that have a 3D model (not creatures: `MODEL_OF_KIND` lists those), and the description each one wears. */
export const OBJECT_MODEL: Partial<Record<number, TubeKey>> = {
  [KIND.Chest]: 'chest',
  [KIND.Mimic]: 'mimic',
  [KIND.Barrel]: 'barrel',
};
/** The kind's model floats (no steps, nothing in time with the speed): a tube description with `float`. */
export function floats(kind: number): boolean {
  const key = MODEL_OF_KIND[kind];
  return key !== undefined && key in TUBE_DESCS && TUBE_DESCS[key as TubeKey].float === true;
}
export const objectModelOf = (kind: number): TubeKey | null => OBJECT_MODEL[kind] ?? null;

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

/** The atlas frame of a model's side outline, the lamp's shadow caster (client/scripts/model-frames.ts bakes it). */
export const outlineFrame = (key: string): string => `model_${key}`;
