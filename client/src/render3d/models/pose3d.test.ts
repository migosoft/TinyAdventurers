import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, FLAG, KIND } from '../../generated/defs';
import { FIGURES, type FigureDef } from '../../game/anim/defs';
import { MELEE_T, type ViewState } from '../../game/anim/pose';
import { Matrix4 } from 'three';
import { BONES, MAX_BONES, buildFigure, type FigureModel } from './model';
import { buildJob } from './build';
import { AMBUSH_WARNING } from '../../game/shadeHaze';
import { APART, ATTACK_IN_SECS, BUTT, ELBOW, FLOAT, GAIT, HIT_SECS, LEG_FOLD, LIE_SINK, LUNGE_SECS, SLAM_DEFAULT_SECS, TURN_RATE, WALK, copyPose, newPose3dMemory, poseFigure, restPose, sideReach, type Pose3d, type Pose3dMemory } from './pose3d';
import { skinVertex } from './rig';
import { DESCS, type DescKey } from './table';
import { HERO_TABLE } from './heroTable';
import { biped, robedBiped } from './bipedFixture';
import { buildTubeFigure } from './tubeModel';
import { FOREARM } from './descs/shade';

const SLOW = 120000;
const KIND_OF: Record<DescKey, number> = { elf: KIND.ElvenRanger, knight: KIND.Paladin, wizard: KIND.Wizard, dwarf: KIND.Barbarian, skelet: KIND.SkeletonWarrior, ogre: KIND.Ogre, wolf: KIND.DireWolf };
const KEYS = Object.keys(DESCS) as DescKey[];
// Building a figure takes a while: each is built once for the whole file.
const memo = new Map<DescKey, FigureModel>();
const model = (k: DescKey): FigureModel => {
  let m = memo.get(k);
  if (!m) memo.set(k, (m = buildFigure(k, DESCS[k])));
  return m;
};
const def = (k: DescKey): FigureDef => FIGURES[KIND_OF[k]];
const view = (o: Partial<ViewState> = {}): ViewState => ({ x: 0, y: 0, anim: ANIM.Idle, animT: 0, aim: 0, flags: 0, ...o });
/** A memory of a figure that has been standing for a while, heading 0. */
const settled = (o: Partial<Pose3dMemory> = {}): Pose3dMemory => ({ ...newPose3dMemory(), faced: true, ...o });
const bone = (name: (typeof BONES)[number]): number => BONES.indexOf(name);
const pivot = (m: FigureModel, name: (typeof BONES)[number]): [number, number, number] => {
  const b = bone(name);
  return [m.pivots[b * 3], m.pivots[b * 3 + 1], m.pivots[b * 3 + 2]];
};
const apply = (p: Pose3d, b: number, v: [number, number, number]): [number, number, number] => {
  const o = b * 12;
  return [0, 1, 2].map((r) => p.bones[o + r * 4] * v[0] + p.bones[o + r * 4 + 1] * v[1] + p.bones[o + r * 4 + 2] * v[2] + p.bones[o + r * 4 + 3]) as [number, number, number];
};
/** Where a hand's centre is, in model space. */
const hand = (m: FigureModel, p: Pose3d, side: 'R' | 'L'): [number, number, number] => {
  const q = pivot(m, `hand${side}`);
  return apply(p, bone(`hand${side}`), [q[0], q[1] + m.handY, q[2]]);
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const isIdentity = (p: Pose3d, b: number): boolean => identity.every((e, k) => Math.abs(p.bones[b * 12 + k] - e) < 1e-6);

/** The wolf's pose in ten situations, taken from the code before the tube models' abilities (#357): root x, y, z, roll, sx, sy, sz, then the bends (MAX_BENDS x 4), then the bones (MAX_BONES x 12). */
const WOLF_TABLE: Record<string, number[]> = {
  idle: [0,0,0,0,1,1,1,0,0,1,0.0467354,0,0,1,0.0467354,-0.9876729,0,0.1565319,0.3455599,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1.0199894,0,-0.0799577,0,0,1,0,0.9998002,-0.0199881,0,0.1609036,0.0203876,1.0197856,0,-0.0783207,0,0,1,0,0.9998002,-0.0199881,0,0.1609036,0.0203876,1.0197856,0,-0.0783207,0,0,1,0,1,0,0,0,0,1.0199894,0,-0.0799577,0,0,1,0,1,0,0,0,0,1.0199894,0,-0.0799577,0,0,1,0,1,0,0,0,0,1.0199894,0,-0.0799577,0,0,1,0,1,0,0,0,0,1.0199894,0,-0.0799577,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1.0199894,0,-0.0799577,0,0,1,0,1,0,0,0,0,1.0199894,0,-0.0799577,0,0,1,0],
  move0: [0,0,0,0,1,1,1,-0.8650605,0,-0.5016676,0.2037273,-0.8650605,0,-0.5016676,0.2037273,-0.8650605,0,-0.5016676,0.2511418,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0.9685,0,0,0,0,1.0225,0,-0.09,0,0,1,0,0.9677253,-0.0387297,0,0.3137108,0.0408891,1.0216821,0,-0.2879024,0,0,1,0,0.9677253,-0.0387297,0,0.3137108,0.0408891,1.0216821,0,-0.2879024,0,0,1,0,0.9685,0,0,0,0,1.0225,0,-0.09,0,0,1,0,0.9685,0,0,0,0,1.0225,0,-0.09,0,0,1,0,0.9685,0,0,0,0,1.0225,0,-0.09,0,0,1,0,0.9685,0,0,0,0,1.0225,0,-0.09,0,0,1,0,0.7763136,0.4412428,0,-0.7360138,-0.6303469,0.5434195,0,4.7259178,0,0,1,0,0.7763136,0.4412428,0,-0.7360138,-0.6303469,0.5434195,0,4.7259178,0,0,1,0,0.7763136,-0.4412428,0,0.7360138,0.6303469,0.5434195,0,4.7259178,0,0,1,0,0.7763136,-0.4412428,0,0.7360138,0.6303469,0.5434195,0,4.7259178,0,0,1,0,0.9685,0,0,0,0,1.0225,0,-0.09,0,0,1,0,0.9685,0,0,0,0,1.0225,0,-0.09,0,0,1,0],
  move1: [0,1.4142136,0,0,1,1,1,-0.0097005,0,0.999953,0.3499704,-0.0097005,0,0.999953,0.3499704,-0.0097005,0,0.999953,0.4196675,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,1.0033228,-0.1670074,0,0.6680298,0.1722272,0.9729148,0,0.108341,0,0,1,0,1.0164145,-0.0380745,0,-0.4288925,0.0471184,0.986917,0,0.621867,0,0,1,0,1.0164145,-0.0380745,0,-0.4288925,0.0471184,0.986917,0,0.621867,0,0,1,0,1.0033228,-0.1670074,0,0.6680298,0.1722272,0.9729148,0,0.108341,0,0,1,0,1.0033228,-0.1670074,0,0.6680298,0.1722272,0.9729148,0,0.108341,0,0,1,0,1.0033228,-0.1670074,0,0.6680298,0.1722272,0.9729148,0,0.108341,0,0,1,0,1.0033228,-0.1670074,0,0.6680298,0.1722272,0.9729148,0,0.108341,0,0,1,0,1,0,0,0,0,1,0,0.7782388,0,0,1,0,1,0,0,0,0,1,0,0.7782388,0,0,1,0,1,0,0,0,0,1,0,-0.7782388,0,0,1,0,1,0,0,0,0,1,0,-0.7782388,0,0,1,0,1.0033228,-0.1670074,0,0.6680298,0.1722272,0.9729148,0,0.108341,0,0,1,0,1.0033228,-0.1670074,0,0.6680298,0.1722272,0.9729148,0,0.108341,0,0,1,0],
  move2: [0,2,0,0,1,1,1,0.3108452,0,0.9504606,0.4777403,0.3108452,0,0.9504606,0.4777403,0.3108452,0,0.9504606,0.5518845,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,1.0385,0,0,0,0,0.9725,0,0.11,0,0,1,0,1.0376693,0.0415289,0,-0.3280779,-0.0388896,0.9717221,0,0.3106713,0,0,1,0,1.0376693,0.0415289,0,-0.3280779,-0.0388896,0.9717221,0,0.3106713,0,0,1,0,1.0385,0,0,0,0,0.9725,0,0.11,0,0,1,0,1.0385,0,0,0,0,0.9725,0,0.11,0,0,1,0,1.0385,0,0,0,0,0.9725,0,0.11,0,0,1,0,1.0385,0,0,0,0,0.9725,0,0.11,0,0,1,0,0.7763136,-0.6303469,0,3.5503452,0.6303469,0.7763136,0,-2.0048501,0,0,1,0,0.7763136,-0.6303469,0,3.5503452,0.6303469,0.7763136,0,-2.0048501,0,0,1,0,0.7763136,0.6303469,0,-3.5503452,-0.6303469,0.7763136,0,-2.0048501,0,0,1,0,0.7763136,0.6303469,0,-3.5503452,-0.6303469,0.7763136,0,-2.0048501,0,0,1,0,1.0385,0,0,0,0,0.9725,0,0.11,0,0,1,0,1.0385,0,0,0,0,0.9725,0,0.11,0,0,1,0],
  windup: [0,0,1,0,1,1,1,0,0,1,0.0027528,0,0,1,0.0027528,0.9991496,0,0.0412319,0.0831122,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0.9928086,-0.1198988,0,0.4795951,0.1197122,0.9943559,0,0.0225766,0,0,1,0,0.9082578,-0.4184644,0,3.2899404,0.4187611,0.9097877,0,-0.7883748,0,0,1,0,0.9082578,-0.4184644,0,3.2899404,0.4187611,0.9097877,0,-0.7883748,0,0,1,0,0.9928086,-0.1198988,0,0.4795951,0.1197122,0.9943559,0,0.0225766,0,0,1,0,0.9928086,-0.1198988,0,0.4795951,0.1197122,0.9943559,0,0.0225766,0,0,1,0,0.9928086,-0.1198988,0,0.4795951,0.1197122,0.9943559,0,0.0225766,0,0,1,0,0.9928086,-0.1198988,0,0.4795951,0.1197122,0.9943559,0,0.0225766,0,0,1,0,1,0,0,0,0,1,0,0.5506762,0,0,1,0,1,0,0,0,0,1,0,0.5506762,0,0,1,0,1,0,0,0,0,1,0,-0.5506762,0,0,1,0,1,0,0,0,0,1,0,-0.5506762,0,0,1,0,0.9928086,-0.1198988,0,0.4795951,0.1197122,0.9943559,0,0.0225766,0,0,1,0,0.9928086,-0.1198988,0,0.4795951,0.1197122,0.9943559,0,0.0225766,0,0,1,0],
  bite0: [1.7633558,0,0,0,1,1,1,0,0,0,1e-06,0,0,0,1e-06,0,0,0,1e-06,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0.9990284,0.0440696,0,-0.1762785,-0.0440696,0.9990284,0,0.0038861,0,0,1,0,0.9999393,0.0110208,0,0.0835584,-0.0110208,0.9999393,0,-0.1686446,0,0,1,0,0.9999393,0.0110208,0,0.0835584,-0.0110208,0.9999393,0,-0.1686446,0,0,1,0,0.9990284,0.0440696,0,-0.1762785,-0.0440696,0.9990284,0,0.0038861,0,0,1,0,0.9990284,0.0440696,0,-0.1762785,-0.0440696,0.9990284,0,0.0038861,0,0,1,0,0.9990284,0.0440696,0,-0.1762785,-0.0440696,0.9990284,0,0.0038861,0,0,1,0,0.9990284,0.0440696,0,-0.1762785,-0.0440696,0.9990284,0,0.0038861,0,0,1,0,1,0,0,0,0,1,0,-0.2027202,0,0,1,0,1,0,0,0,0,1,0,-0.2027202,0,0,1,0,1,0,0,0,0,1,0,0.2027202,0,0,1,0,1,0,0,0,0,1,0,0.2027202,0,0,1,0,0.9990284,0.0440696,0,-0.1762785,-0.0440696,0.9990284,0,0.0038861,0,0,1,0,0.9990284,0.0440696,0,-0.1762785,-0.0440696,0.9990284,0,0.0038861,0,0,1,0],
  bite1: [4,0,0,0,1,1,1,0,0,0,1e-06,0,0,0,1e-06,0,0,0,1e-06,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0.9950042,0.0998334,0,-0.3993337,-0.0998334,0.9950042,0,0.0199833,0,0,1,0,0.9110388,0.4123208,0,-2.4794054,-0.4123208,0.9110388,0,2.2541437,0,0,1,0,0.9110388,0.4123208,0,-2.4794054,-0.4123208,0.9110388,0,2.2541437,0,0,1,0,0.9950042,0.0998334,0,-0.3993337,-0.0998334,0.9950042,0,0.0199833,0,0,1,0,0.9950042,0.0998334,0,-0.3993337,-0.0998334,0.9950042,0,0.0199833,0,0,1,0,0.9950042,0.0998334,0,-0.3993337,-0.0998334,0.9950042,0,0.0199833,0,0,1,0,0.9950042,0.0998334,0,-0.3993337,-0.0998334,0.9950042,0,0.0199833,0,0,1,0,1,0,0,0,0,1,0,-0.4592337,0,0,1,0,1,0,0,0,0,1,0,-0.4592337,0,0,1,0,1,0,0,0,0,1,0,0.4592337,0,0,1,0,1,0,0,0,0,1,0,0.4592337,0,0,1,0,0.9950042,0.0998334,0,-0.3993337,-0.0998334,0.9950042,0,0.0199833,0,0,1,0,0.9950042,0.0998334,0,-0.3993337,-0.0998334,0.9950042,0,0.0199833,0,0,1,0],
  bite2: [0,0,0,0,1,1,1,0,0,0,1e-06,0,0,0,1e-06,0,0,0,1e-06,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,0.9920017,0.1262249,0,-0.9698074,-0.1262249,0.9920017,0,0.6951112,0,0,1,0,0.9920017,0.1262249,0,-0.9698074,-0.1262249,0.9920017,0,0.6951112,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0],
  hit: [-1.5930815,0,0,0,1,1,1,0,0,-1,0.4080182,0,0,-1,0.4080182,-0.0225479,0,-0.9997458,0.4009282,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0.9839827,-0.1593584,0,0.6374334,0.1782638,0.8796284,0,0.4814865,0,0,1,0,0.9612573,-0.2638209,0,1.5924994,0.2714418,0.8554785,0,0.1771177,0,0,1,0,0.9935651,0.0802833,0,1.5924994,-0.0369996,0.8967469,0,0.1771177,0,0,1,0,0.9839827,-0.1593584,0,0.6374334,0.1782638,0.8796284,0,0.4814865,0,0,1,0,0.9839827,-0.1593584,0,0.6374334,0.1782638,0.8796284,0,0.4814865,0,0,1,0,0.9839827,-0.1593584,0,0.6374334,0.1782638,0.8796284,0,0.4814865,0,0,1,0,0.9839827,-0.1593584,0,0.6374334,0.1782638,0.8796284,0,0.4814865,0,0,1,0,1,0,0,0,0,1,0,0.8200133,0,0,1,0,1,0,0,0,0,1,0,0.8200133,0,0,1,0,1,0,0,0,0,1,0,-0.8200133,0,0,1,0,1,0,0,0,0,1,0,-0.8200133,0,0,1,0,0.9839827,-0.1593584,0,0.6374334,0.1782638,0.8796284,0,0.4814865,0,0,1,0,0.9839827,-0.1593584,0,0.6374334,0.1782638,0.8796284,0,0.4814865,0,0,1,0],
  sleep: [0,2.8973734,0,1.5707963,1,1,1,0,0,1,0.0351051,0,0,1,0.0351051,0.8971993,0,0.4416259,0.0988572,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0,1,0,0,0,0,1.0237764,0,-0.0951058,0,0,1,0],
};

/** The tube models as the kinds wear them. `orcBow` is no model key: it is the `orc` model worn by the Orc Archer (the same model, the kind's bow). */
type TubeKey = 'stag' | 'deer' | 'boar' | 'bunny' | 'goblin' | 'orc' | 'orcBow' | 'npcKnight' | 'necromancer' | 'summoner' | 'disciple' | 'imp' | 'chort' | 'ghost' | 'shade';
const TUBES: TubeKey[] = ['stag', 'deer', 'boar', 'bunny'];
/** The two-legged creatures (#356): a new one joins this list and `TUBE_KIND`. */
const BIPEDS: TubeKey[] = ['goblin', 'orc', 'orcBow', 'npcKnight', 'necromancer', 'summoner', 'disciple', 'imp', 'chort'];
/** The floating spectres (#359): their poses are Task 2's; here they only join the finiteness loop. */
const SPECTRES: TubeKey[] = ['ghost', 'shade'];
const TUBE_KIND: Record<TubeKey, number> = {
  stag: KIND.Stag, deer: KIND.Deer, boar: KIND.Boar, bunny: KIND.Bunny, goblin: KIND.GoblinArcher, orc: KIND.OrcWarrior, orcBow: KIND.OrcArcher, npcKnight: KIND.Knight,
  necromancer: KIND.Necromancer, summoner: KIND.Summoner, disciple: KIND.Disciple, imp: KIND.Imp, chort: KIND.Chort, ghost: KIND.Ghost, shade: KIND.Shade,
};
const tmemo = new Map<TubeKey, FigureModel>();
const tube = (k: TubeKey): FigureModel => {
  let m = tmemo.get(k);
  if (!m) tmemo.set(k, (m = buildJob(k === 'orcBow' ? 'orc' : k, null)));
  return m;
};
const tdef = (k: TubeKey): FigureDef => FIGURES[TUBE_KIND[k]];
const flat = (p: Pose3d): number[] => [p.root.x, p.root.y, p.root.z, p.root.roll, p.root.sx, p.root.sy, p.root.sz, ...p.bends, ...p.bones];
/** The bone's world matrix as a three.js matrix. */
const world = (p: Pose3d, b: number): Matrix4 => {
  const e = p.bones, o = b * 12;
  return new Matrix4().set(e[o], e[o + 1], e[o + 2], e[o + 3], e[o + 4], e[o + 5], e[o + 6], e[o + 7], e[o + 8], e[o + 9], e[o + 10], e[o + 11], 0, 0, 0, 1);
};
/** What a bone does by itself: its parent's world matrix undone. */
const localOf = (m: FigureModel, p: Pose3d, b: number): Matrix4 => world(p, m.parents[b]).invert().multiply(world(p, b));
/** The turn about z (rad) and the stretch along y of a bone's own matrix. */
const turnOf = (m: FigureModel, p: Pose3d, b: number): number => { const e = localOf(m, p, b).elements; return Math.atan2(e[1], e[0]); };
const stretchOf = (m: FigureModel, p: Pose3d, b: number): number => { const e = localOf(m, p, b).elements; return Math.hypot(e[4], e[5], e[6]); };
const BUTT_ANIM = (animT: number): Partial<ViewState> => ({ anim: ANIM.Melee, animT });
/** A moment in the strike of a butt: `u` is 0.35 + 0.65 * animT / secs. */
const STRIKE_T = 0.07;

describe('the wolf is unchanged', () => {
  const m = buildFigure('wolf', DESCS.wolf), d = FIGURES[KIND.DireWolf];
  const cases: Record<string, () => Pose3d> = {
    idle: () => poseFigure(m, d, view(), 1 / 60, settled({ clock: 0.6 })),
    move0: () => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 0 })),
    move1: () => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 4 })),
    move2: () => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 2 })),
    windup: () => poseFigure(m, d, view({ anim: ANIM.Windup }), 0, settled({ clock: 0.03 })),
    bite0: () => poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.03 }), 0, settled()),
    bite1: () => poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075 }), 0, settled()),
    bite2: () => poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.2 }), 0, settled()),
    hit: () => poseFigure(m, d, view({ flags: FLAG.HURT }), 0.05, settled({ clock: 1.3 })),
    sleep: () => poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), 1 / 60, settled({ clock: 0.4 })),
  };
  for (const k of Object.keys(cases)) {
    it(`gives the numbers of before for ${k}`, () => {
      const got = flat(cases[k]()), want = WOLF_TABLE[k];
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) expect(Math.abs(got[i] - want[i]), `${k}[${i}]`).toBeLessThan(1e-6);
    }, SLOW);
  }
});

describe('the two-legged #338 figures are unchanged', () => {
  for (const key of Object.keys(HERO_TABLE)) {
    const m = model(key as DescKey), d = def(key as DescKey);
    const cases: Record<string, () => Pose3d> = {
      idle: () => poseFigure(m, d, view(), 1 / 60, settled({ clock: 0.6 })),
      move0: () => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 0 })),
      move1: () => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 4 })),
      move2: () => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 2 })),
      windup: () => poseFigure(m, d, view({ anim: ANIM.Windup }), 0, settled({ clock: 0.03 })),
      atk0: () => poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.03 }), 0, settled()),
      atk1: () => poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075 }), 0, settled()),
      atk2: () => poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.2 }), 0, settled()),
      hit: () => poseFigure(m, d, view({ flags: FLAG.HURT }), 0.05, settled({ clock: 1.3 })),
      sleep: () => poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), 1 / 60, settled({ clock: 0.4 })),
    };
    for (const k of Object.keys(cases)) {
      it(`gives the numbers of before for ${key} ${k}`, () => {
        const got = flat(cases[k]()), want = HERO_TABLE[key][k];
        expect(got.length).toBe(want.length);
        for (let i = 0; i < want.length; i++) expect(Math.abs(got[i] - want[i]), `${key} ${k}[${i}]`).toBeLessThan(1e-6);
      }, SLOW);
    }
  }
});

describe('the walk', () => {
  const m = buildTubeFigure('biped', biped), rm = buildTubeFigure('robedBiped', robedBiped), d = FIGURES[KIND.OrcWarrior];
  const at = (phi: number, extra: Partial<ViewState> = {}, mm: FigureModel = m): Pose3d => poseFigure(mm, d, view({ anim: ANIM.Move, ...extra }), 0, settled({ walk: 1, phi }));
  const lowerTurn = (p: Pose3d, i: number, mm: FigureModel = m): number => turnOf(mm, p, mm.legs![i].lower);
  const sideOf = (i: number): number => Math.sign(m.pivots[m.legs![i].upper * 3 + 2]);
  const flutterBend = m.bends.findIndex((b) => b.flutter);
  const plain: FigureModel = { ...m, bends: m.bends.map((b) => ({ ...b, flutter: undefined })) };

  it('swings the legs in turn by WALK.swing', () => {
    expect(WALK).toEqual({ swing: 0.5, knee: 0.9 });
    const p = at(Math.PI / 2);
    expect(turnOf(m, p, m.legs![0].upper)).toBeCloseTo(-turnOf(m, p, m.legs![1].upper), 6);
    expect(Math.abs(turnOf(m, p, m.legs![0].upper))).toBeCloseTo(WALK.swing, 6);
  });
  it('bends the knee back only on the leg that comes forward, never beyond WALK.knee', () => {
    const p = at(0);
    for (let i = 0; i < 2; i++) expect(lowerTurn(p, i)).toBeCloseTo(Math.cos(0) * sideOf(i) > 0 ? -WALK.knee : 0, 6);
    let bent = 0;
    for (let j = 0; j < 16; j++) {
      const phi = j / 16 * 2 * Math.PI, q = at(phi);
      for (let i = 0; i < 2; i++) {
        const t = lowerTurn(q, i);
        expect(t).toBeLessThanOrEqual(1e-9);
        expect(t).toBeGreaterThanOrEqual(-WALK.knee - 1e-9);
        if (Math.cos(phi) * sideOf(i) > 1e-6) expect(t, `phi ${phi}`).toBeCloseTo(-WALK.knee * Math.cos(phi) * sideOf(i), 6);
        else expect(t).toBeCloseTo(0, 6);
        if (t < -0.1) bent++;
      }
    }
    expect(bent).toBeGreaterThan(0);
  });
  it('bends a knee of -1 the other way', () => {
    const back: FigureModel = { ...m, legs: m.legs!.map((l) => ({ ...l, knee: -1 as const })) };
    const p = at(0, {}, back);
    for (let i = 0; i < 2; i++) expect(lowerTurn(p, i, back)).toBeCloseTo(sideOf(i) > 0 ? WALK.knee : 0, 6);
  });
  it('dips with the stride instead of hopping, and keeps the ground shadow', () => {
    const hip = m.pivots[m.legs![0].upper * 3 + 1];
    expect(at(Math.PI / 2).root.y).toBeCloseTo(-(1 - Math.cos(WALK.swing)) * hip * m.scale, 6);
    expect(at(0).root.y).toBeCloseTo(0, 9);
    for (let j = 0; j < 16; j++) expect(at(j / 16 * 2 * Math.PI).air).toBe(0);
  });
  it('swings each arm against the leg of its side', () => {
    const p = at(Math.PI / 2);
    expect(Math.sign(turnOf(m, p, bone('armR')))).toBe(-Math.sign(turnOf(m, p, m.legs![0].upper)));
    expect(Math.sign(turnOf(m, p, bone('armL')))).toBe(-Math.sign(turnOf(m, p, m.legs![1].upper)));
  });
  it('lengthens the arm in a blow by the share the model states (armStretch); the whole of it by default', () => {
    const swing = (mm: FigureModel): number => stretchOf(mm, poseFigure(mm, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, settled()), bone('armR'));
    const whole = swing(m), part = swing({ ...m, armStretch: 0.25 }), none = swing({ ...m, armStretch: 0 });
    expect(whole).toBeGreaterThan(1.3);
    expect(part - 1).toBeCloseTo(0.25 * (whole - 1), 6);
    expect(none).toBeCloseTo(1, 6);
    const hand = (mm: FigureModel): number => stretchOf(mm, poseFigure(mm, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, settled()), bone('handR'));
    expect(hand({ ...m, armStretch: 0.25 })).toBeCloseTo(1 / part, 6);   // the hand keeps its own size
  });
  it('is straight at rest', () => {
    const p = poseFigure(m, d, view(), 0, settled());
    for (const l of m.legs!) { expect(isIdentity(p, l.upper)).toBe(true); expect(isIdentity(p, l.lower)).toBe(true); }
  });
  it('glides a figure without legs and swings its hem', () => {
    const p = at(Math.PI / 2, {}, rm);
    expect(p.root.y).toBe(0);
    expect(p.robe[0]).not.toBe(0);
    for (const b of [bone('leg0'), bone('leg1'), bone('leg2'), bone('leg3')]) expect(isIdentity(p, b), `bone ${b}`).toBe(true);
  });
  it('flutters a bend that states it, also standing; not asleep; within the cap', () => {
    expect(flutterBend).toBeGreaterThanOrEqual(0);
    const angle = (mm: FigureModel, clock: number, extra: Partial<ViewState> = {}, walk = 0): number => poseFigure(mm, d, view(extra), 0, settled({ clock, walk })).bends[flutterBend * 4 + 3];
    expect(angle(m, 0.1)).not.toBeCloseTo(angle(m, 0.2), 4);
    expect(angle(m, 0.1)).not.toBeCloseTo(angle(plain, 0.1), 4);
    const sleep = { effects: 1 << EFFECT.Sleep };
    for (const c of [0.1, 0.2]) expect(angle(m, c, sleep)).toBeCloseTo(angle(plain, c, sleep), 9);
    for (const c of [1e6, 1e6 + 0.0625, 1e6 + 0.1]) expect(angle(m, c, { anim: ANIM.Move }, 1)).toBeLessThan(0.75 + 1e-9);
  });
  it('beats a bend about the axis its flutter names, also standing; without an axis about the line of sight as before; not asleep; within the cap', () => {
    const AX: [number, number, number] = [0.6, 0.8, 0];
    const beat: FigureModel = { ...m, bends: m.bends.map((b) => (b.flutter ? { ...b, flutter: { ...b.flutter, axis: AX } } : b)) };
    const rate = m.bends[flutterBend].flutter!.rate, peak = 1 / (4 * rate);
    // The turn at the tip as a vector (axis times angle).
    const turn = (mm: FigureModel, clock: number, extra: Partial<ViewState> = {}, walk = 0): number[] => {
      const p = poseFigure(mm, d, view(extra), 0, settled({ clock, walk })), o = flutterBend * 4;
      return [p.bends[o] * p.bends[o + 3], p.bends[o + 1] * p.bends[o + 3], p.bends[o + 2] * p.bends[o + 3]];
    };
    const along = (v: number[]): number => v[0] * AX[0] + v[1] * AX[1] + v[2] * AX[2];
    // At the beat's peak nearly all of the turn is about the named axis, and half a beat later it is the other way.
    const up = turn(beat, peak), down = turn(beat, 3 * peak);
    expect(along(up)).toBeGreaterThan(0.9 * Math.hypot(...up));
    expect(along(up)).toBeGreaterThan(0.25);
    expect(along(down)).toBeLessThan(-0.25);
    // The same model without the axis turns about x at that moment, as before.
    const old = turn(m, peak);
    expect(Math.abs(old[0])).toBeGreaterThan(0.9 * Math.hypot(...old));
    expect(Math.abs(along(old))).toBeLessThan(0.8 * Math.hypot(...old));
    const sleep = { effects: 1 << EFFECT.Sleep };
    for (const c of [peak, 3 * peak]) turn(beat, c, sleep).forEach((v, i) => expect(v).toBeCloseTo(turn(plain, c, sleep)[i], 9));
    for (const c of [1e6, 1e6 + 0.0625, 1e6 + 0.1]) {
      const v = turn({ ...beat, bends: beat.bends.map((b) => (b.flutter ? { ...b, flutter: { ...b.flutter, angle: 5 } } : b)) }, c, { anim: ANIM.Move }, 1);
      expect(v.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...v)).toBeLessThan(0.75 + 1e-9);
    }
  });
  it('lies asleep with straight knees, holds entangled legs, and holds a stone or frozen pose mid-stride', () => {
    const sleep = poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), 0.2, settled({ walk: 1, phi: 1 }));
    expect(sleep.asleep).toBe(true);
    for (const l of m.legs!) { expect(isIdentity(sleep, l.upper)).toBe(true); expect(isIdentity(sleep, l.lower)).toBe(true); }
    const mem = settled();
    for (let i = 0; i < 20; i++) poseFigure(m, d, view({ anim: ANIM.Move, x: i * 2, effects: 1 << EFFECT.Entangled }), 1 / 60, mem);
    const ent = poseFigure(m, d, view({ anim: ANIM.Move, x: 40, effects: 1 << EFFECT.Entangled }), 1 / 60, mem);
    for (const l of m.legs!) { expect(isIdentity(ent, l.upper)).toBe(true); expect(isIdentity(ent, l.lower)).toBe(true); }
    expect(ent.root.y).toBe(0);
    for (const fx of [EFFECT.Petrified, EFFECT.Frozen]) {
      const held = settled({ walk: 1, phi: 1 });
      const a = poseFigure(m, d, view({ anim: ANIM.Move, effects: 1 << fx }), 1 / 60, held);
      expect(Math.abs(turnOf(m, a, m.legs![0].upper))).toBeGreaterThan(0.1);
      const b = poseFigure(m, d, view({ anim: ANIM.Move, x: 30, effects: 1 << fx }), 0.5, held);
      expect(b.bones).toEqual(a.bones);
      expect(b.root).toEqual(a.root);
    }
  });
  it('is finite in every ANIM at dt 0 and 1/60 with HURT and each effect', () => {
    const anims = Object.values(ANIM) as number[];
    const effects = [0, 1 << EFFECT.Sleep, 1 << EFFECT.Petrified, 1 << EFFECT.Frozen, 1 << EFFECT.Entangled];
    for (const mm of [m, rm]) for (const dt of [0, 1 / 60]) for (const anim of anims) for (const fx of effects) for (const flags of [0, FLAG.HURT]) {
      const mem = newPose3dMemory();
      for (let step = 0; step < 2; step++) {
        const p = poseFigure(mm, d, view({ anim, effects: fx, flags, animT: 0.05, x: 3 + step, y: -4, aim: 1 }), dt, mem);
        for (const v of [p.yaw, ...Object.values(p.root), ...p.bones, ...p.bends, ...p.robe, p.air]) expect(Number.isFinite(v), `${mm.key} anim ${anim} fx ${fx}`).toBe(true);
      }
    }
  }, SLOW);
});

describe('arms with an elbow', () => {
  // The fixture biped with an elbow 2.4 px below the shoulders (arms 5 long, shoulders 3 px to either side), posed by the game's own kinds.
  const m = buildTubeFigure('elbowBiped', { ...biped, arms: { ...biped.arms!, elbow: 2.4 } }), straight = buildTubeFigure('biped', biped);
  const L = m.armLength, blade = FIGURES[KIND.Knight], bow = FIGURES[KIND.OrcArcher], staff = FIGURES[KIND.Necromancer], bare = FIGURES[KIND.Imp];
  type Side = 'R' | 'L';
  /** Where the grip (the middle of the hand) is, moved by the hand bone and by the weapon bone, and the shoulder and the elbow: all in model space. */
  const grip = (p: Pose3d, s: Side): [number, number, number] => apply(p, bone(`hand${s}`), pivot(m, `weapon${s}`));
  const shoulder = (p: Pose3d, s: Side): [number, number, number] => apply(p, bone(`arm${s}`), pivot(m, `arm${s}`));
  const elbowAt = (p: Pose3d, s: Side): [number, number, number] => apply(p, bone(`hand${s}`), pivot(m, `hand${s}`));
  const sub = (a: number[], b: number[]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);
  const angle = (a: number[], b: number[]): number => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b)))));
  /** How far the arm is bent at the elbow (0: straight). */
  const bent = (p: Pose3d, s: Side): number => angle(sub(elbowAt(p, s), shoulder(p, s)), sub(grip(p, s), elbowAt(p, s)));
  /** Where a weapon's own direction `v` (y its length, x its front) points in model space. */
  const weaponDir = (p: Pose3d, s: Side, v: [number, number, number]): [number, number, number] => sub(apply(p, bone(`weapon${s}`), sub(pivot(m, `weapon${s}`), [-v[0], -v[1], -v[2]])), apply(p, bone(`weapon${s}`), pivot(m, `weapon${s}`)));
  const idle = (d: FigureDef): Pose3d => copyPose(poseFigure(m, d, view(), 0, settled()));
  /** The full draw: the shot's pose once it is blended in (the game's shot starts at the release, so the string hand is at its anchor). */
  const drawn = (mm: FigureModel = m): Pose3d => copyPose(poseFigure(mm, bow, view({ anim: ANIM.Shoot, animT: ATTACK_IN_SECS }), 0, settled()));

  it('turn the hand bones about the elbow, and keep the two parts of the arm their lengths in every pose', () => {
    expect(m.elbow).toBe(2.4); expect(straight.elbow).toBeUndefined();
    expect(pivot(m, 'handR')[1]).toBeCloseTo(12 - 2.4, 5);
    for (const p of [idle(blade), idle(bow), drawn(), copyPose(poseFigure(m, blade, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, settled())), copyPose(poseFigure(m, staff, view({ anim: ANIM.Cast, animT: 0.05 }), 0, settled()))]) {
      for (const s of ['R', 'L'] as const) {
        expect(len(sub(elbowAt(p, s), shoulder(p, s)))).toBeCloseTo(2.4, 5);   // never lengthened
        expect(len(sub(grip(p, s), elbowAt(p, s)))).toBeCloseTo(L - 2.4, 5);
        // The grip of the weapon is the middle of the hand, whatever the arm does.
        const g = grip(p, s), w = apply(p, bone(`weapon${s}`), pivot(m, `weapon${s}`));
        for (let i = 0; i < 3; i++) expect(w[i]).toBeCloseTo(g[i], 5);
      }
    }
  });

  it('hold the forearm of the hand that carries a weapon forward, by the angle of its kind; an empty hand hangs', () => {
    expect(ELBOW.carry).toEqual({ melee: 0.95, bow: 1.2, cast: 1.0 });
    const cases: [FigureDef, Side, number][] = [[blade, 'R', ELBOW.carry.melee], [bow, 'L', ELBOW.carry.bow], [staff, 'R', ELBOW.carry.cast]];
    for (const [d, s, want] of cases) {
      const p = idle(d), other = s === 'R' ? 'L' : 'R';
      expect(bent(p, s)).toBeCloseTo(want, 5);
      expect(bent(p, other)).toBeCloseTo(ELBOW.free, 5);
      expect(grip(p, s)[0]).toBeGreaterThan(shoulder(p, s)[0] + 0.3 * L);   // the hand is in front of the body ...
      expect(grip(p, s)[1]).toBeLessThan(shoulder(p, s)[1] - 0.4 * L);      // ... below the shoulder
      expect(Math.abs(grip(p, other)[0] - shoulder(p, other)[0])).toBeLessThan(0.15 * L);
    }
    const p = idle(bare);
    expect(bent(p, 'R')).toBeCloseTo(ELBOW.free, 5); expect(bent(p, 'L')).toBeCloseTo(ELBOW.free, 5);
  });

  it('hold an empty hand\'s forearm forward by the model\'s own angle when it names one (elbowFree): claws held ready; a carrying hand and an attack are as ever', () => {
    const ready: FigureModel = { ...m, elbowFree: 0.8 };
    const stand = (d: FigureDef): Pose3d => copyPose(poseFigure(ready, d, view(), 0, settled()));
    const p = stand(bare);
    for (const s of ['R', 'L'] as const) {
      expect(bent(p, s)).toBeCloseTo(0.8, 5);
      expect(grip(p, s)[0]).toBeGreaterThan(shoulder(p, s)[0] + 0.2 * L);   // the hand is in front of the shoulder
    }
    const armed = stand(blade);
    expect(bent(armed, 'R')).toBeCloseTo(ELBOW.carry.melee, 5); expect(bent(armed, 'L')).toBeCloseTo(0.8, 5);
    const swing = copyPose(poseFigure(ready, bare, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, settled()));
    expect(bent(swing, 'R')).toBeCloseTo(ELBOW.swing, 2);
  });

  it('carry a blade up and forward out of the fist, a bow upright with the string towards the body, a staff upright', () => {
    const sword = weaponDir(idle(blade), 'R', [0, 1, 0]);
    expect(sword[1]).toBeGreaterThan(0.8); expect(sword[0]).toBeGreaterThan(0.3);
    const p = idle(bow), limb = weaponDir(p, 'L', [0, 1, 0]), string = weaponDir(p, 'L', [-1, 0, 0]);   // a bow's string lies on the -x side of its grip (weapons.ts)
    expect(limb[1]).toBeGreaterThan(0.95);
    expect(string[0]).toBeLessThan(-0.7);
    expect(weaponDir(idle(staff), 'R', [0, 1, 0])[1]).toBeGreaterThan(0.95);
    // Neither blade nor bow is edge-on from the front or from the side: its face is turned between the two.
    for (const [d, s] of [[blade, 'R'], [bow, 'L']] as const) {
      const face = weaponDir(idle(d), s, [0, 0, 1]);
      expect(Math.abs(face[0])).toBeGreaterThan(0.3); expect(Math.abs(face[2])).toBeGreaterThan(0.3);
    }
  });

  it('swing a carrying arm less in the walk than a free one', () => {
    const p = copyPose(poseFigure(m, blade, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 2 })));
    const ratio = Math.abs(turnOf(m, p, bone('armR')) / turnOf(m, p, bone('armL')));
    expect(ELBOW.carrySwing).toBe(0.3);
    expect(ratio).toBeGreaterThan(0.25); expect(ratio).toBeLessThan(0.35);
  });

  it('draw the bow with a bent arm: the hand on the line of the shot behind the bow hand, ELBOW.anchor of the arm from its shoulder, the elbow behind it', () => {
    const p = drawn(), g = grip(p, 'R'), s = shoulder(p, 'R'), b = grip(p, 'L');
    expect(bent(p, 'R')).toBeGreaterThan(0.9);                    // a clear bend, not a stick
    expect(bent(p, 'L')).toBeLessThan(1e-3);                      // the bow arm is straight
    expect(len(sub(g, s))).toBeCloseTo(ELBOW.anchor * L, 3);
    // In model space the figure's heading is +x: the drawing hand is straight behind the bow hand (further than the string's place), at its height
    // (but for the stance's slight lean).
    expect(b[0] - g[0]).toBeGreaterThan(ELBOW.string * L + 0.3 * L);
    expect(Math.abs(g[2] - b[2])).toBeLessThan(0.05); expect(Math.abs(g[1] - b[1])).toBeLessThan(0.25);
    expect(g[0]).toBeGreaterThan(s[0]);                           // in front of the chest
    expect(elbowAt(p, 'R')[0]).toBeLessThan(g[0]);                // the elbow points back
    // In a wind-up (the drawn bow held) the arm is as bent.
    expect(bent(copyPose(poseFigure(m, bow, view({ anim: ANIM.Windup }), 0, settled())), 'R')).toBeCloseTo(bent(p, 'R'), 3);
  });

  it('aim the bow straight ahead from its shoulder when the model says so (bowAhead), on the body\'s middle line otherwise', () => {
    const ahead = drawn({ ...m, bowAhead: true }), cross = drawn();
    const z = (p: Pose3d): number => grip(p, 'L')[2];
    expect(Math.abs(z(ahead) - shoulder(ahead, 'L')[2])).toBeLessThan(0.05);   // but for the stance's slight lean
    expect(Math.abs(z(cross))).toBeLessThan(Math.abs(z(ahead)) - 0.5);
    // The drawing hand still reaches towards that line, in front of the chest by at least ELBOW.clear of the arm.
    const g = grip(ahead, 'R'), s = shoulder(ahead, 'R');
    expect(len(sub(g, s))).toBeLessThanOrEqual(L + 1e-6);
    expect(g[0] - s[0]).toBeGreaterThan(0.5 * ELBOW.clear * L);
    expect(g[2]).toBeLessThan(s[2] - 0.3 * L);                    // across the chest, towards the bow
  });

  it('bend the forearm up in a swing and a cast, and are never lengthened', () => {
    const swing = copyPose(poseFigure(m, blade, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, settled()));
    expect(bent(swing, 'R')).toBeCloseTo(ELBOW.swing, 2);
    expect(stretchOf(m, swing, bone('armR'))).toBeCloseTo(1, 6);
    expect(stretchOf(m, swing, bone('handR'))).toBeCloseTo(1, 6);
    const cast = copyPose(poseFigure(m, staff, view({ anim: ANIM.Windup }), 0, settled()));
    expect(bent(cast, 'R')).toBeCloseTo(ELBOW.cast, 2);
    expect(grip(cast, 'R')[1]).toBeGreaterThan(grip(idle(staff), 'R')[1] + 0.3 * L);   // the staff hand is lifted
  });

  it('are what the weapon carriers of the nine have: goblin, orc, knight and the robes; the chort has them to hold its claws ready; the imp keeps straight arms', () => {
    for (const k of ['goblin', 'orc', 'npcKnight', 'necromancer', 'summoner', 'disciple', 'chort'] as const) expect(tube(k).elbow, k).toBeGreaterThan(0.3 * tube(k).armLength);
    expect(tube('imp').elbow).toBeUndefined();
    // Only the chort names its own angle for an empty hand: standing, both hands are in front of the shoulders and below them.
    for (const k of ['goblin', 'orc', 'npcKnight', 'necromancer', 'summoner', 'disciple'] as const) expect(tube(k).elbowFree, k).toBeUndefined();
    const c = tube('chort'), p = poseFigure(c, tdef('chort'), view(), 0, settled());
    expect(c.elbowFree).toBeGreaterThan(0.5);
    for (const s of ['R', 'L'] as const) {
      const g = apply(p, bone(`hand${s}`), pivot(c, `weapon${s}`)), sh = apply(p, bone(`arm${s}`), pivot(c, `arm${s}`));
      expect(g[0], s).toBeGreaterThan(sh[0] + 0.25 * c.armLength);
      expect(g[1], s).toBeLessThan(sh[1] - 0.5 * c.armLength);
    }
    expect(tube('goblin').bowAhead).toBe(true);
    expect(tube('orc').bowAhead).toBeUndefined();
  }, SLOW);
});

describe('legs of two bones', () => {
  const m = tube('stag'), d = tdef('stag');
  const at = (phi: number): Pose3d => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi }));

  it('are straight at rest', () => {
    const p = poseFigure(m, d, view(), 0, settled());
    for (const l of m.legs!) { expect(turnOf(m, p, l.upper)).toBeCloseTo(0, 6); expect(turnOf(m, p, l.lower)).toBeCloseTo(0, 6); }
  }, SLOW);

  it('fold the lower leg back (never forwards, never beyond LEG_FOLD) while the upper leg swings, and not otherwise', () => {
    expect(LEG_FOLD).toBe(0.95);
    const A = 0.62 * GAIT.stride;
    let folded = 0, straight = 0;
    for (let i = 0; i < 40; i++) {
      const phi = i / 40 * 2 * Math.PI, p = at(phi), ext = -Math.cos(2 * phi);
      for (const l of m.legs!) {
        const sgn = l.front ? 1 : -1, fold = turnOf(m, p, l.lower), want = -LEG_FOLD * Math.max(0, Math.sin(2 * phi) * sgn);
        expect(fold, `phi ${phi}`).toBeLessThanOrEqual(1e-6);
        expect(fold).toBeGreaterThanOrEqual(-LEG_FOLD - 1e-6);
        expect(fold).toBeCloseTo(want, 5);
        expect(turnOf(m, p, l.upper)).toBeCloseTo(A * 1.1 * ext * sgn, 5);
        if (fold < -1e-3) folded++; else straight++;
      }
    }
    expect(folded).toBeGreaterThan(0);
    expect(straight).toBeGreaterThan(0);
  }, SLOW);

  it('take no squash on the upper leg, while the bunny and the wolf legs still do', () => {
    const phi = 0;   // ext = -1: the legs are drawn in
    const p = at(phi);
    for (const l of m.legs!) expect(stretchOf(m, p, l.upper)).toBeCloseTo(1, 6);
    const b = tube('bunny'), bp = poseFigure(b, tdef('bunny'), view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi }));
    for (const l of b.legs!) { expect(l.lower).toBe(-1); expect(stretchOf(b, bp, l.upper)).toBeCloseTo(0.7, 5); }
    const w = buildFigure('wolf', DESCS.wolf), wp = poseFigure(w, FIGURES[KIND.DireWolf], view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi }));
    for (const n of ['leg0', 'leg1', 'leg2', 'leg3'] as const) expect(stretchOf(w, wp, bone(n))).toBeCloseTo(0.7, 5);
  }, SLOW);

  it('move the front pair and the hind pair mirrored, as the wolf legs', () => {
    const p = at(0.3);
    const [f, h] = [m.legs!.filter((l) => l.front), m.legs!.filter((l) => !l.front)];
    expect(f.length).toBe(2); expect(h.length).toBe(2);
    expect(turnOf(m, p, f[0].upper)).toBeCloseTo(turnOf(m, p, f[1].upper), 6);
    expect(turnOf(m, p, h[0].upper)).toBeCloseTo(turnOf(m, p, h[1].upper), 6);
    expect(turnOf(m, p, f[0].upper)).toBeCloseTo(-turnOf(m, p, h[0].upper), 6);
    // At phi 0.3 the front legs swing forward and fold; the hind legs do not.
    expect(turnOf(m, p, f[0].lower)).toBeCloseTo(-LEG_FOLD * Math.sin(0.6), 5);
    expect(turnOf(m, p, f[1].lower)).toBeCloseTo(turnOf(m, p, f[0].lower), 6);
    expect(turnOf(m, p, h[0].lower)).toBeCloseTo(0, 6);
    expect(turnOf(m, p, h[1].lower)).toBeCloseTo(0, 6);
  }, SLOW);
});

describe('the hop', () => {
  it('lifts the bunny by the hop factor at the top of the bound, the stag by 2.0', () => {
    for (const [k, hop] of [['bunny', 1.3], ['stag', 1]] as const) {
      const m = tube(k), p = poseFigure(m, tdef(k), view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 2 }));
      expect(p.root.y, k).toBeCloseTo(2.0 * hop * m.scale, 5);
    }
  }, SLOW);
});

describe('the neck', () => {
  /** Where the bend carries the neck's end, in the body's frame. */
  const bentEnd = (m: FigureModel, p: Pose3d): [number, number, number] => {
    const nb = m.neckBend!, o = m.bends[nb].origin, e = pivot(m, 'head'), a = p.bends[nb * 4 + 3], c = Math.cos(a), s = Math.sin(a);
    const vx = e[0] - o[0], vy = e[1] - o[1];
    return [o[0] + vx * c - vy * s, o[1] + vx * s + vy * c, e[2]];
  };
  const states: [string, Partial<ViewState>, Partial<Pose3dMemory>][] = [
    ['idle', {}, { clock: 1.2 }],
    ['move', { anim: ANIM.Move }, { walk: 1, phi: Math.PI / 4 }],
    ['the wind-up', { anim: ANIM.Windup }, {}],
    ['the strike', BUTT_ANIM(STRIKE_T), {}],
  ];

  for (const k of ['stag', 'deer'] as const) {
    it(`${k}: idle at t 0 the bend axis is z and its angle 0`, () => {
      const m = tube(k), p = poseFigure(m, tdef(k), view(), 0, settled());
      const nb = m.neckBend!;
      expect([p.bends[nb * 4], p.bends[nb * 4 + 1], p.bends[nb * 4 + 2]]).toEqual([0, 0, 1]);
      expect(p.bends[nb * 4 + 3]).toBe(0);
    }, SLOW);

    for (const [name, v, mm] of states) {
      it(`${k}: the head bone keeps the neck's end in ${name}`, () => {
        const m = tube(k), p = poseFigure(m, tdef(k), view(v), 0, settled(mm));
        const want = apply(p, bone('body'), bentEnd(m, p)), got = apply(p, bone('head'), pivot(m, 'head'));
        for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], 3);
      }, SLOW);
    }

    it(`${k}: bends by -0.8 pitch - 0.2 w and the nod in a bound`, () => {
      const m = tube(k);
      for (const phi of [0, Math.PI / 4, 1]) {
        const p = poseFigure(m, tdef(k), view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi }));
        const pitch = 0.17 * Math.sin(2 * phi);
        expect(p.bends[m.neckBend! * 4 + 3]).toBeCloseTo(-0.8 * pitch - 0.2 + 0.05 * GAIT.loose * Math.sin(2 * phi), 5);
      }
    }, SLOW);
  }

  it('the boar and the bunny have no neck bend', () => {
    expect(tube('boar').neckBend).toBe(-1);
    expect(tube('bunny').neckBend).toBe(-1);
  }, SLOW);
});

describe('the butt', () => {
  const angle = (p: Pose3d, b: number): number => Math.atan2(p.bones[b * 12 + 4], p.bones[b * 12]);

  it('holds the reared pose in a wind-up and strikes with pose.attack', () => {
    for (const k of ['boar', 'stag'] as const) {
      const m = tube(k), d = tdef(k), mem = settled();
      const w = poseFigure(m, d, view({ anim: ANIM.Windup }), 0, mem);
      expect(w.attack, k).toBeNull();
      expect(w.root.x, k).toBeLessThan(-1);
      expect(angle(w, bone('body')), k).toBeGreaterThan(0.12 + 0.05);
      const s = poseFigure(m, d, view(BUTT_ANIM(STRIKE_T)), 0, mem);
      expect(s.attack?.style, k).toBe('butt');
      expect(s.attack!.u).toBeCloseTo(BUTT.hold + (1 - BUTT.hold) * STRIKE_T / BUTT.secs, 6);
      expect(poseFigure(m, d, view(BUTT_ANIM(BUTT.secs)), 0, mem).attack, k).toBeNull();
    }
  }, SLOW);

  it('lowers the stag\'s neck at the lunge, and throws the boar\'s head up', () => {
    const st = tube('stag'), sp = poseFigure(st, tdef('stag'), view(BUTT_ANIM(STRIKE_T)), 0, settled());
    expect(sp.bends[st.neckBend! * 4 + 3]).toBeLessThan(-0.5);
    const rear = poseFigure(st, tdef('stag'), view({ anim: ANIM.Windup }), 0, settled());
    expect(rear.bends[st.neckBend! * 4 + 3]).toBeGreaterThan(0.1);
    const bo = tube('boar'), bp = poseFigure(bo, tdef('boar'), view(BUTT_ANIM(STRIKE_T)), 0, settled());
    expect(turnOf(bo, bp, bone('head'))).toBeGreaterThan(0.3);
  }, SLOW);

  it('is not done by the deer and the bunny, which bite as the wolf', () => {
    for (const k of ['deer', 'bunny'] as const) {
      const m = tube(k), p = poseFigure(m, tdef(k), view(BUTT_ANIM(STRIKE_T)), 0, settled());
      expect(p.attack?.style, k).toBe('bite');
      expect(p.root.x, k).toBeGreaterThanOrEqual(0);
    }
  }, SLOW);
});

describe('the crest', () => {
  it('scales the hat bone about its pivot and leaves the head alone', () => {
    const m = tube('stag'), mem = settled({ crest: 0.8 });
    expect(newPose3dMemory().crest).toBe(1);
    const p = poseFigure(m, tdef('stag'), view(), 0, mem), L = localOf(m, p, bone('hat')).elements;
    for (const i of [0, 5, 10]) expect(L[i]).toBeCloseTo(0.8, 6);
    const at = apply(p, bone('hat'), pivot(m, 'hat')), hp = apply(p, bone('head'), pivot(m, 'hat'));
    for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(hp[i], 5);
    const H = localOf(m, p, bone('head')).elements;
    for (const i of [0, 5, 10]) expect(H[i]).toBeCloseTo(1, 6);
  }, SLOW);

  it('leaves the wizard\'s hat as it is by default', () => {
    const m = model('wizard'), d = def('wizard');
    const a = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 1 })), b = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 1, crest: 1 }));
    expect(a.bones).toEqual(b.bones);
    const e = localOf(m, a, bone('hat')).elements;
    expect(Math.hypot(e[0], e[1], e[2])).toBeCloseTo(1, 5);
    expect(Math.hypot(e[4], e[5], e[6])).toBeCloseTo(1, 5);
  }, SLOW);
});

describe('the woodland animals in every animation', () => {
  it('give finite bones, bends and root, also with a stopped clock', () => {
    const anims = Object.values(ANIM) as number[];
    for (const k of [...TUBES, ...BIPEDS, ...SPECTRES]) for (const dt of [0, 1 / 60]) for (const anim of anims) {
      const m = tube(k), mem = newPose3dMemory();
      const p = poseFigure(m, tdef(k), view({ anim, animT: dt, x: 3, y: -2 }), dt, mem);
      for (const v of [...flat(p), ...p.robe, p.air, p.yaw]) expect(Number.isFinite(v), `${k} anim ${anim} dt ${dt}`).toBe(true);
      const q = poseFigure(m, tdef(k), view({ anim, animT: dt + 0.07, x: 3 + dt, y: -2 }), dt, mem);
      for (const v of [...flat(q), ...q.robe]) expect(Number.isFinite(v), `${k} anim ${anim} second`).toBe(true);
    }
  }, SLOW);

  it('hold a stone or frozen two-legged creature\'s pose mid-stride and mid-attack, hit or not', () => {
    for (const stone of [1 << EFFECT.Petrified, 1 << EFFECT.Frozen]) for (const k of BIPEDS) for (const first of [{ anim: ANIM.Move }, { anim: ANIM.Melee, animT: STRIKE_T }, { anim: ANIM.Shoot, animT: STRIKE_T }]) {
      const m = tube(k), d = tdef(k), mem = settled({ walk: 1, phi: 0.7 });
      const a = copyPose(poseFigure(m, d, view({ ...first, effects: stone }), 1 / 60, mem));
      const rest = restPose(m, 0).bones, moved = a.bones.some((v, i) => Math.abs(v - rest[i]) > 1e-3);
      expect(moved, `${k}: the held pose is a pose, not the rest`).toBe(true);
      const b = poseFigure(m, d, view({ anim: ANIM.Idle, effects: stone, flags: FLAG.HURT }), 0.3, mem);
      expect(b.bones, k).toEqual(a.bones);
      expect(b.bends, k).toEqual(a.bends);
      expect(b.root, k).toEqual(a.root);
      expect(poseFigure(m, d, view({ anim: ANIM.Move, effects: stone, flags: FLAG.HURT }), 0.3, mem).bones, k).toEqual(a.bones);
    }
  }, SLOW);

  it('pose the two-legged creatures\' attacks by what they hold: the cleaver swings, the bow shoots and swings in a melee', () => {
    const style = (k: TubeKey, anim: number): string | undefined => poseFigure(tube(k), tdef(k), view({ anim, animT: STRIKE_T }), 1 / 60, settled()).attack?.style;
    expect(style('orc', ANIM.Melee)).toBe('swing');
    expect(style('orcBow', ANIM.Shoot)).toBe('shot');   // the same orc model, posed by the archer kind's bow
    expect(style('orcBow', ANIM.Melee)).toBe('swing');
    expect(style('goblin', ANIM.Shoot)).toBe('shot');
    expect(style('goblin', ANIM.Melee)).toBe('swing');
    expect(style('npcKnight', ANIM.Melee)).toBe('swing');
  }, SLOW);

  it('pose the imp: a horned model with arms claws with its arm in a melee and casts, never butts; both wings flutter standing, opposite ways', () => {
    const m = tube('imp'), d = tdef('imp');
    expect(m.butt).toBe(true);
    const melee = poseFigure(m, d, view({ anim: ANIM.Melee, animT: STRIKE_T }), 1 / 60, settled());
    expect(melee.attack?.style).toBe('swing');
    expect(melee.root.x).toBeGreaterThanOrEqual(0);   // no rearing back
    expect(poseFigure(m, d, view({ anim: ANIM.Cast, animT: STRIKE_T }), 1 / 60, settled()).attack?.style).toBe('cast');
    const wings = m.bends.map((b, i) => (b.flutter ? i : -1)).filter((i) => i >= 0);
    expect(wings).toHaveLength(2);
    // The beat's two ends are a quarter and three quarters of its period (5 Hz: 0.05 and 0.15 s). The turn at the tip (axis times angle)
    // of the two wings mirrors: x and y turned round, z the same.
    const at = (clock: number): Pose3d => copyPose(poseFigure(m, d, view(), 0, settled({ clock })));
    const up = at(0.05), down = at(0.15);
    const turn = (p: Pose3d, i: number): number[] => [0, 1, 2].map((k) => p.bends[i * 4 + k] * p.bends[i * 4 + 3]);
    for (const p of [up, down]) {
      const [r, l] = wings.map((i) => turn(p, i));
      expect(l[0]).toBeCloseTo(-r[0], 6); expect(l[1]).toBeCloseTo(-r[1], 6); expect(l[2]).toBeCloseTo(r[2], 6);
      expect(Math.hypot(...r)).toBeGreaterThan(0.4);
    }
    // Each wing's tip moves across the wing's surface (along the surface's normal: the bend's line crossed with the beat's axis), not within it.
    const n = m.position.length / 3, a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
    for (const i of wings) {
      const B = m.bends[i], ax = B.flutter!.axis!;
      const nrm = [B.dir[1] * ax[2] - B.dir[2] * ax[1], B.dir[2] * ax[0] - B.dir[0] * ax[2], B.dir[0] * ax[1] - B.dir[1] * ax[0]], nl = Math.hypot(...nrm);
      let tip = -1, far = 0;
      for (let v = 0; v < n; v++) {
        if (m.skin[v * 4 + 2] !== i) continue;
        const s = (m.position[v * 3] - B.origin[0]) * B.dir[0] + (m.position[v * 3 + 1] - B.origin[1]) * B.dir[1] + (m.position[v * 3 + 2] - B.origin[2]) * B.dir[2];
        if (s > far) { far = s; tip = v; }
      }
      expect(m.skin[tip * 4 + 3]).toBe(1);
      skinVertex(m, up, tip, a); skinVertex(m, down, tip, b);
      const move = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], across = Math.abs(move[0] * nrm[0] + move[1] * nrm[1] + move[2] * nrm[2]) / nl;
      expect(Math.hypot(...move)).toBeGreaterThan(2 * m.scale);   // more than 2 page px between the two ends of the beat
      expect(across).toBeGreaterThan(0.9 * Math.hypot(...move));
    }
  }, SLOW);

  it('pose the chort: claws with its arm and casts, never butts; the lower leg of the leg coming forward turns forwards; the feet stay near the ground', () => {
    const m = tube('chort'), d = tdef('chort');
    expect(m.butt).toBe(true);
    const melee = poseFigure(m, d, view({ anim: ANIM.Melee, animT: STRIKE_T }), 1 / 60, settled());
    expect(melee.attack?.style).toBe('swing');
    expect(melee.root.x).toBeGreaterThanOrEqual(0);   // no rearing back
    expect(poseFigure(m, d, view({ anim: ANIM.Cast, animT: STRIKE_T }), 1 / 60, settled()).attack?.style).toBe('cast');
    // The walk: at phi 0 the right leg (z > 0) comes forward and its lower leg is turned forwards by WALK.knee; the left one is at rest.
    const at = (phi: number): Pose3d => poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi }));
    const p0 = at(0);
    expect(turnOf(m, p0, m.legs![0].lower)).toBeCloseTo(WALK.knee, 6);
    expect(turnOf(m, p0, m.legs![1].lower)).toBeCloseTo(0, 6);
    // The feet over a whole stride, in game px: the lower foot stands on the ground (never sunk, never floating), the other is lifted
    // as it comes forward, and no foot ever goes under the ground by more than a hair.
    const n = m.position.length / 3, out: [number, number, number] = [0, 0, 0];
    const feet = m.legs!.map((l) => { const v: number[] = []; for (let i = 0; i < n; i++) if (m.skin[i * 4] === l.lower && m.skin[i * 4 + 1] === 0) v.push(i); return v; });
    let lifted = 0;
    for (let j = 0; j < 32; j++) {
      const p = at(j / 32 * 2 * Math.PI);
      const low = feet.map((v) => { let y = Infinity; for (const i of v) { skinVertex(m, p, i, out); y = Math.min(y, out[1]); } return y; });
      expect(Math.min(...low), `step ${j}`).toBeGreaterThan(-0.6);
      expect(Math.min(...low), `step ${j}`).toBeLessThan(0.6);
      lifted = Math.max(lifted, Math.max(...low));
    }
    expect(lifted).toBeGreaterThan(1);
  }, SLOW);

  it('pose the robes: all three cast (the Disciple with its sleeve arms, no weapon), glide without a hop and swing the hem; only a tip sways', () => {
    for (const k of ['necromancer', 'summoner', 'disciple'] as const) {
      const m = tube(k), d = tdef(k);
      expect(poseFigure(m, d, view({ anim: ANIM.Cast, animT: STRIKE_T }), 1 / 60, settled()).attack?.style, k).toBe('cast');
      const a = copyPose(poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 2 })));
      const b = copyPose(poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 3 * Math.PI / 2 })));
      expect(a.root.y, k).toBe(0);
      expect(a.air, k).toBe(0);
      expect(a.robe[2], k).toBe(0);
      expect(Math.abs(a.robe[1] - b.robe[1]), k).toBeGreaterThan(1);   // the hem swings from side to side over a stride
      expect(poseFigure(m, d, view(), 0, settled()).robe[0], k).toBeCloseTo(0, 9);   // and hangs straight at rest
      // The tip leans to one side on one step and to the other on the next (the axis of its bend turns), by a clear angle.
      if (m.bends.length) { expect(a.bends[0], k).toBeCloseTo(-b.bends[0], 6); expect(Math.abs(a.bends[0]), k).toBeGreaterThan(0.1); expect(a.bends[3], k).toBeGreaterThan(0.2); }
    }
    expect(tube('disciple').bends).toHaveLength(0);
  }, SLOW);

  it('hold a stone or frozen animal\'s pose mid-stride and mid-butt, hit or not, whatever the crest', () => {
    for (const stone of [1 << EFFECT.Petrified, 1 << EFFECT.Frozen]) for (const k of ['stag', 'boar'] as const) for (const first of [{ anim: ANIM.Move }, BUTT_ANIM(STRIKE_T)]) {
      const m = tube(k), d = tdef(k), mem = settled({ walk: 1, phi: 0.7, crest: 0.8 });
      const a = copyPose(poseFigure(m, d, view({ ...first, effects: stone }), 1 / 60, mem));
      mem.crest = 1.3;
      const b = poseFigure(m, d, view({ anim: ANIM.Idle, effects: stone, flags: FLAG.HURT }), 0.3, mem);
      expect(b.bones, k).toEqual(a.bones);
      expect(b.bends, k).toEqual(a.bends);
      expect(b.root, k).toEqual(a.root);
      mem.crest = 0.5;
      expect(poseFigure(m, d, view({ anim: ANIM.Move, effects: stone, flags: FLAG.HURT }), 0.3, mem).bones, k).toEqual(a.bones);
      if (k === 'stag') expect(localOf(m, a, bone('hat')).elements[0]).toBeCloseTo(0.8, 5);
    }
  }, SLOW);

  it('lie on their side with the legs unfolded, and stretch in a dash', () => {
    for (const k of TUBES) {
      const m = tube(k), d = tdef(k);
      const p = poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), 1 / 60, settled({ phi: 0.4 }));
      expect(p.root.roll, k).toBeCloseTo(Math.PI / 2, 6);
      for (const l of m.legs!) if (l.lower >= 0) expect(turnOf(m, p, l.lower), k).toBeCloseTo(0, 6);
      expect(poseFigure(m, d, view({ anim: ANIM.Dash }), 1 / 60, settled()).root.sx, k).toBeCloseTo(1.25, 6);
    }
  }, SLOW);
});

describe('the standing pose', () => {
  it('stays on the ground with only the breathing moving', () => {
    for (const k of ['skelet', 'wolf'] as DescKey[]) {
      const m = model(k), d = def(k), mem = settled({ clock: 0.6 });
      const p = poseFigure(m, d, view(), 1 / 60, mem);
      expect(p.air, k).toBe(0);
      expect(p.root.y, k).toBe(0);
      expect(p.root.roll, k).toBe(0);
      for (const leg of ['leg0', 'leg1', 'leg2', 'leg3'] as const) expect(isIdentity(p, bone(leg)), `${k} ${leg}`).toBe(true);
      expect(isIdentity(p, bone('hips')), k).toBe(true);
      // The body breathes: its matrix is not the identity, but its feet pivot does not move in y.
      expect(isIdentity(p, bone('body')), k).toBe(false);
      const pv = pivot(m, 'body');
      expect(apply(p, bone('body'), pv)[1]).toBeCloseTo(pv[1], 5);
    }
  }, SLOW);
});

describe('the skip', () => {
  it('hops 2.4 sprite px at the top of a step and is on the ground at the landing', () => {
    const m = model('skelet'), d = def('skelet');
    const up = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 2 }));
    expect(up.root.y).toBeCloseTo(2.4 * GAIT.bounce * m.scale, 5);
    expect(up.air).toBeCloseTo(1, 5);
    const down = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 0 }));
    expect(down.root.y).toBeCloseTo(0, 5);
    expect(down.air).toBeCloseTo(0, 5);
  }, SLOW);

  it('swings the two legs against each other', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 4 }));
    // Element 4 of a bone matrix is sin of the turn about z.
    const a = p.bones[bone('leg0') * 12 + 4], b = p.bones[bone('leg1') * 12 + 4];
    expect(Math.abs(a)).toBeGreaterThan(0.1);
    expect(a).toBeCloseTo(-b, 5);
  }, SLOW);

  it('blends in over about 0.2 s and out again', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    for (let i = 0; i < 6; i++) poseFigure(m, d, view({ anim: ANIM.Move, x: i * 2 }), 1 / 60, mem);
    expect(mem.walk).toBeGreaterThan(0.3);
    expect(mem.walk).toBeLessThan(0.9);
    for (let i = 0; i < 60; i++) poseFigure(m, d, view({ anim: ANIM.Idle, x: 12 }), 1 / 60, mem);
    expect(mem.walk).toBeLessThan(0.02);
    expect(mem.phi).toBe(0);
  }, SLOW);
});

describe('the bound', () => {
  it('moves the front pair and the hind pair each together, and pitches nose up after take-off', () => {
    const m = model('wolf'), d = def('wolf');
    expect(m.quad).toBe(true);
    const p = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 0 }));
    const r = (n: 0 | 1 | 2 | 3): number => p.bones[bone(`leg${n}` as (typeof BONES)[number]) * 12 + 4];
    expect(Math.abs(r(0))).toBeGreaterThan(0.1);
    expect(r(0)).toBeCloseTo(r(1), 5);
    expect(r(2)).toBeCloseTo(r(3), 5);
    expect(r(0)).toBeCloseTo(-r(2), 5);
    const q = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 4 }));
    expect(q.bones[bone('body') * 12 + 4]).toBeGreaterThan(0.05);   // sin(pitch) with pitch > 0
  }, SLOW);
});

describe('facing', () => {
  it('turns the short way, never faster than TURN_RATE', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled({ yaw: 0 }), dt = 1 / 60;
    let last = 0;
    for (let i = 0; i < 90; i++) {
      poseFigure(m, d, view({ anim: ANIM.Windup, aim: 3 }), dt, mem);
      const step = mem.yaw - last;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(TURN_RATE * dt + 1e-9);
      last = mem.yaw;
    }
    expect(mem.yaw).toBeCloseTo(3, 5);
  }, SLOW);

  it('goes the short way round the back', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled({ yaw: 3 });
    poseFigure(m, d, view({ anim: ANIM.Windup, aim: -3 }), 1 / 60, mem);
    // From 3 to -3 the short way is through pi (0.28 rad), not back through 0: one step on, wrapped into (-pi, pi].
    expect(mem.yaw).toBeCloseTo(3 + TURN_RATE / 60 - 2 * Math.PI, 6);
  }, SLOW);

  it('walks towards where it goes', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    for (let i = 1; i <= 40; i++) poseFigure(m, d, view({ anim: ANIM.Move, x: 0, y: i * 2, aim: 0 }), 1 / 60, mem);
    expect(mem.yaw).toBeCloseTo(Math.PI / 2, 3);
  }, SLOW);

  it('takes the aim at once on the first pose, and keeps it while standing', () => {
    const m = model('skelet'), d = def('skelet'), mem = newPose3dMemory();
    const p = poseFigure(m, d, view({ aim: 1.2 }), 1 / 60, mem);
    expect(p.yaw).toBeCloseTo(1.2, 6);
    expect(poseFigure(m, d, view({ aim: -2 }), 1 / 60, mem).yaw).toBeCloseTo(1.2, 6);
  }, SLOW);
});

describe('attacks', () => {
  it('swings the right arm out in front at half the sweep', () => {
    const m = model('knight'), d = def('knight');
    const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, settled());
    expect(p.attack?.style).toBe('swing');
    const h = hand(m, p, 'R'), rest = pivot(m, 'handR');
    expect(h[0]).toBeGreaterThan(rest[0] + 0.5);
    expect(p.attack!.u).toBeGreaterThan(0);
  }, SLOW);

  it('bites with the wolf and darts d.lunge px forward', () => {
    const m = model('wolf'), d = def('wolf');
    expect(m.armLength).toBe(0);
    const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075 }), 0, settled());
    expect(p.attack?.style).toBe('bite');
    expect(p.root.x).toBeCloseTo(d.lunge!, 5);
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.3 }), 0, settled()).root.x).toBeCloseTo(0, 5);
  }, SLOW);

  it('shoots with the ranger holding the bow in the left arm', () => {
    const m = model('elf'), d = def('elf');
    const p = poseFigure(m, d, view({ anim: ANIM.Shoot, animT: 0.05 }), 0, settled());
    expect(p.attack?.style).toBe('shot');
    const l = hand(m, p, 'L'), restL = pivot(m, 'handL');
    expect(l[0]).toBeGreaterThan(restL[0] + 3);
    const idle = poseFigure(m, d, view(), 0, settled());
    expect(l[0]).toBeGreaterThan(hand(m, idle, 'L')[0] + 3);
  }, SLOW);

  it('casts with the wizard', () => {
    const m = model('wizard'), d = def('wizard');
    const p = poseFigure(m, d, view({ anim: ANIM.Cast, animT: 0.05 }), 0, settled());
    expect(p.attack?.style).toBe('cast');
    expect(hand(m, p, 'R')[0]).toBeGreaterThan(pivot(m, 'handR')[0] + 2);
  }, SLOW);

  it('ends the attack once its time is up', () => {
    const m = model('knight'), d = def('knight');
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 2 }), 0, settled()).attack).toBeNull();
  }, SLOW);

  it('moves the root by the game\'s scale, as the card scales its steps: a scaled creature lunges and shivers as far as its card', () => {
    const m = model('wolf'), d = { ...def('wolf'), scale: 2 };
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075 }), 0, settled()).root.x).toBeCloseTo(2 * def('wolf').lunge!, 5);
    const k = model('knight');
    const a = poseFigure(k, { ...def('knight'), scale: 1.5 }, view({ anim: ANIM.Windup }), 0, settled({ clock: 0 }));
    expect(Math.abs(a.root.z)).toBeCloseTo(1.5, 6);
    // the fall shrink the card has in its scale too
    const f = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075, fall: 0.5 }), 0, settled());
    expect(f.root.x).toBeCloseTo(2 * 0.9 * def('wolf').lunge!, 5);
  }, SLOW);

  it('holds the wound-up pose in a wind-up, shivering and leaning back, without an attack for the effects', () => {
    const m = model('knight'), d = def('knight');
    const a = poseFigure(m, d, view({ anim: ANIM.Windup }), 0, settled({ clock: 0 }));
    const b = poseFigure(m, d, view({ anim: ANIM.Windup }), 0, settled({ clock: 0.03 }));
    expect(a.attack).toBeNull();
    expect(Math.abs(a.root.z)).toBe(1);
    expect(b.root.z).toBe(-a.root.z);
    expect(a.bones[bone('body') * 12 + 4]).toBeGreaterThan(0.05);   // leaning back: turned anticlockwise about z
  }, SLOW);

  it('fits the slam to the ogre\'s own slam time: raised by 0.75 t, smashed down at t, held down after', () => {
    const m = model('ogre'), d = def('ogre'), t = d.slam!.t;
    expect(t).toBeGreaterThan(0);
    const at = (animT: number): Pose3d => poseFigure(m, d, view({ anim: ANIM.Slam, animT }), 0, settled());
    for (const side of ['R', 'L'] as const) {
      const shoulder = pivot(m, `arm${side}`)[1];
      expect(hand(m, at(0.5 * t), side)[1], `raised at 0.5 t ${side}`).toBeGreaterThan(shoulder);
      expect(hand(m, at(0.75 * t), side)[1], `up at 0.75 t ${side}`).toBeGreaterThan(shoulder + 2);
      expect(hand(m, at(t), side)[1], `down at t ${side}`).toBeLessThan(shoulder);
      expect(hand(m, at(2 * t), side)[1], `held down ${side}`).toBeCloseTo(hand(m, at(t), side)[1], 4);
    }
  }, SLOW);

  it('without a slam time in the description, takes SLAM_DEFAULT_SECS', () => {
    const m = model('ogre'), d = { ...def('ogre'), slam: undefined };
    const p = poseFigure(m, d, view({ anim: ANIM.Slam, animT: SLAM_DEFAULT_SECS }), 0, settled());
    expect(hand(m, p, 'R')[1]).toBeLessThan(pivot(m, 'armR')[1]);
  }, SLOW);

  it('runs a swing\'s sweep in MELEE_T and its return in MELEE_T', () => {
    const m = model('knight'), d = def('knight');
    const u = (animT: number): number | undefined => poseFigure(m, d, view({ anim: ANIM.Melee, animT }), 0, settled()).attack?.u;
    expect(u(0)).toBeCloseTo(0.2, 6);
    expect(u(MELEE_T)).toBeCloseTo(0.56, 6);
    expect(u(1.5 * MELEE_T)).toBeCloseTo(0.78, 6);
    expect(u(2 * MELEE_T - 1e-6)).toBeGreaterThan(0.999);
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 2 * MELEE_T }), 0, settled()).attack).toBeNull();
  }, SLOW);

  it('blends an attack in over ATTACK_IN_SECS after idling, but not after a wind-up', () => {
    const m = model('knight'), d = def('knight');
    const rest = pivot(m, 'handR');
    const idleHand = hand(m, poseFigure(m, d, view(), 0, settled()), 'R');
    const cold = (animT: number): [number, number, number] => hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT }), 0, settled()), 'R');
    // After idling: at animT 0 the arm is at rest, at ATTACK_IN_SECS it is on the full curve.
    cold(0).forEach((v, i) => expect(v).toBeCloseTo(idleHand[i], 4));
    const mem = settled({ woundUp: true });
    const full = (animT: number): [number, number, number] => hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT }), 0, mem), 'R');
    cold(ATTACK_IN_SECS).forEach((v, i) => expect(v).toBeCloseTo(full(ATTACK_IN_SECS)[i], 4));
    // Half-way it is between the two.
    const mid = cold(ATTACK_IN_SECS / 2), f = full(ATTACK_IN_SECS / 2);
    expect(Math.hypot(mid[0] - f[0], mid[1] - f[1], mid[2] - f[2])).toBeGreaterThan(0.1);
    // After a wind-up frame the first Melee frame is the full curve, and the memory keeps it so.
    const wm = settled();
    poseFigure(m, d, view({ anim: ANIM.Windup }), 0, wm);
    const first = hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), 0, wm), 'R');
    const ref = full(0);
    first.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 5));
    expect(Math.abs(first[0] - idleHand[0]) + Math.abs(first[1] - idleHand[1]) + Math.abs(first[2] - idleHand[2])).toBeGreaterThan(0.5);
    expect(rest).toBeDefined();
    // It goes back to blending once the figure has done something else.
    poseFigure(m, d, view(), 0, wm);
    hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), 0, wm), 'R').forEach((v, i) => expect(v).toBeCloseTo(idleHand[i], 4));
  }, SLOW);

  it('freezes a figure in its swing: the pose of the frame the ice began in, attack and all', () => {
    const m = model('knight'), d = def('knight'), mem = settled();
    const a = poseFigure(m, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2, effects: 1 << EFFECT.Frozen }), 1 / 60, mem);
    expect(hand(m, a, 'R')[0]).toBeGreaterThan(pivot(m, 'handR')[0] + 0.5);
    const hx = hand(m, a, 'R');
    const b = poseFigure(m, d, view({ anim: ANIM.Idle, effects: 1 << EFFECT.Frozen }), 0.5, mem);
    hand(m, b, 'R').forEach((v, i) => expect(v).toBeCloseTo(hx[i], 6));
    expect(b.attack).toEqual(a.attack);
  }, SLOW);

  it('writes the same pose object each call (owned by the memory) and copyPose keeps one', () => {
    const m = model('wizard'), d = def('wizard'), mem = settled();
    const a = poseFigure(m, d, view({ anim: ANIM.Move, x: 2 }), 1 / 60, mem);
    const kept = copyPose(a);
    const b = poseFigure(m, d, view({ anim: ANIM.Cast, animT: 0.05, x: 4 }), 1 / 60, mem);
    expect(b).toBe(a);
    expect(kept.bones).not.toEqual(b.bones);
    expect(kept.attack).toBeNull();
    const into = copyPose(b, kept);
    expect(into).toBe(kept);
    expect(kept.bones).toEqual(b.bones);
    expect(kept.attack).toEqual(b.attack);
    expect(kept.attack).not.toBe(b.attack);
  }, SLOW);

  it('stretches the dash along the heading', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ anim: ANIM.Dash }), 1 / 60, settled());
    expect(p.root.sx).toBeCloseTo(1.25, 6);
    expect(p.root.sy).toBeCloseTo(0.9, 6);
  }, SLOW);
});

describe('hit', () => {
  it('jolts back from the heading, is done after HIT_SECS and does not start again while the flag is held', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    const first = poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem);
    expect(first.root.x).toBeLessThan(0);
    let frames = 1, min = first.root.x, last = first;
    for (; frames * (1 / 60) < 0.3; frames++) { last = poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem); min = Math.min(min, last.root.x); }
    expect(min).toBeLessThan(-0.5);
    expect(last.root.x).toBe(0);
    for (let i = 0; i < 30; i++) expect(poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem).root.x).toBe(0);
    // Let go and hurt again: a second jolt.
    poseFigure(m, d, view(), 1 / 60, mem);
    expect(poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem).root.x).toBeLessThan(0);
    expect(HIT_SECS).toBeLessThan(0.3);
  }, SLOW);

  /** The world direction (rad) and size the root shifts at the top of the jolt, for a blow that travelled `dir` (undefined: not told) at a figure that faces 0.7. */
  const joltOf = (dir: number | null | undefined): { angle: number; size: number; pose: Pose3d } => {
    const m = model('skelet'), d = def('skelet'), mem = settled({ yaw: 0.7 });
    const v = (): ViewState => view({ aim: 0.7, flags: FLAG.HURT, hurtDir: dir });
    poseFigure(m, d, v(), 1 / 60, mem);
    const p = poseFigure(m, d, v(), 0.2 * HIT_SECS, mem);
    const wx = p.root.x * Math.cos(p.yaw) - p.root.z * Math.sin(p.yaw), wz = p.root.x * Math.sin(p.yaw) + p.root.z * Math.cos(p.yaw);
    return { angle: Math.atan2(wz, wx), size: Math.hypot(wx, wz), pose: p };
  };
  const apart = (a: number, b: number): number => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

  it('a hit from the left jolts the figure right', () => {
    for (const dir of [0, Math.PI / 2, -2.4, 2.9]) {
      const j = joltOf(dir);
      expect(j.size).toBeGreaterThan(0.5);
      expect(apart(j.angle, dir)).toBeLessThan((5 * Math.PI) / 180);
    }
  }, SLOW);

  it('a hit without direction does not jolt', () => {
    const j = joltOf(null);
    expect(j.pose.root.x).toBe(0);
    expect(j.pose.root.z).toBe(0);
  }, SLOW);

  it('an unset direction jolts back as before', () => {
    const unset = joltOf(undefined).pose.root, back = joltOf(0.7 + Math.PI).pose.root;
    expect(unset.x).toBeLessThan(-0.5);
    expect(unset.z).toBe(0);
    expect(back.x).toBeCloseTo(unset.x, 9);
    expect(back.z).toBeCloseTo(0, 9);
  }, SLOW);
});

describe('a facing creature', () => {
  it('walking backwards keeps facing its aim', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    let x = 0;
    for (let i = 0; i < 60; i++) { x -= 0.5; poseFigure(m, d, view({ anim: ANIM.Move, x, aim: 0, faces: true }), 1 / 60, mem); }
    expect(mem.yaw).toBeCloseTo(0, 6);
    // Without `faces` it turns to its heading.
    const other = settled();
    x = 0;
    for (let i = 0; i < 60; i++) { x -= 0.5; poseFigure(m, d, view({ anim: ANIM.Move, x, aim: 0 }), 1 / 60, other); }
    expect(Math.abs(other.yaw)).toBeGreaterThan(1);
  }, SLOW);

  it('turns to its aim while idle, but a sleeper keeps its heading', () => {
    const m = model('skelet'), d = def('skelet');
    const mem = settled();
    for (let i = 0; i < 120; i++) poseFigure(m, d, view({ aim: 1.2, faces: true }), 1 / 60, mem);
    expect(mem.yaw).toBeCloseTo(1.2, 3);
    const sleeper = settled();
    for (let i = 0; i < 120; i++) poseFigure(m, d, view({ aim: 1.2, faces: true, effects: 1 << EFFECT.Sleep }), 1 / 60, sleeper);
    expect(sleeper.yaw).toBe(0);
  }, SLOW);
});

describe('held and lying states', () => {
  it('keeps the pose of the frame the stone began in', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    const a = poseFigure(m, d, view({ effects: 1 << EFFECT.Petrified }), 1 / 60, mem);
    const b = poseFigure(m, d, view({ anim: ANIM.Move, x: 20, effects: 1 << EFFECT.Petrified }), 0.5, mem);
    expect(b.bones).toEqual(a.bones);
    expect(b.yaw).toBe(a.yaw);
    // When it wears off the figure moves again.
    const c = poseFigure(m, d, view(), 0.5, mem);
    expect(mem.held).toBeNull();
    expect(c.bones).not.toEqual(a.bones);
  }, SLOW);

  it('holds frozen figures too, hit or not', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    const a = poseFigure(m, d, view({ effects: 1 << EFFECT.Frozen }), 1 / 60, mem);
    const b = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.1, flags: FLAG.HURT, effects: 1 << EFFECT.Frozen }), 0.3, mem);
    expect(b.bones).toEqual(a.bones);
    expect(b.root).toEqual(a.root);
  }, SLOW);

  it('holds the legs of an entangled figure and lets the rest idle', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    for (let i = 0; i < 20; i++) poseFigure(m, d, view({ anim: ANIM.Move, x: i * 2, effects: 1 << EFFECT.Entangled }), 1 / 60, mem);
    const p = poseFigure(m, d, view({ anim: ANIM.Move, x: 40, effects: 1 << EFFECT.Entangled }), 1 / 60, mem);
    for (const leg of ['leg0', 'leg1'] as const) expect(isIdentity(p, bone(leg)), leg).toBe(true);
    expect(p.root.y).toBe(0);
  }, SLOW);

  it('lays a sleeping figure on its side on the ground', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), 1 / 60, settled());
    expect(p.asleep).toBe(true);
    expect(p.root.roll).toBeCloseTo(Math.PI / 2, 6);
    // The root is lifted by the side reach, less the sink into the soft ground.
    expect(LIE_SINK).toBe(0.3);
    expect(p.root.y).toBeCloseTo(sideReach(m) * m.scale * (1 - LIE_SINK) * p.root.sy, 6);
    // The lowest point of the lying figure is below the ground by that sink.
    let low = Infinity;
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < m.position.length / 3; i++) if (m.skin[i * 4 + 1] === 0) { skinVertex(m, p, i, out); low = Math.min(low, out[1]); }   // not the outline hulls
    expect(low).toBeCloseTo(-sideReach(m) * m.scale * LIE_SINK * p.root.sy, 2);
  }, SLOW);

  it('shrinks a falling figure', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ fall: 0.5 }), 1 / 60, settled());
    expect(p.root.sx).toBeCloseTo(0.9, 6);
    expect(p.root.sy).toBeCloseTo(0.9, 6);
    expect(p.root.sz).toBeCloseTo(0.9, 6);
  }, SLOW);

  it('flags a channelling figure', () => {
    const m = model('wizard'), d = def('wizard');
    const p = poseFigure(m, d, view({ anim: ANIM.Channel }), 1 / 60, settled());
    expect(p.channel).toBe(true);
    expect(p.attack).toBeNull();
  }, SLOW);
});

describe('finite', () => {
  it('has only finite numbers for every figure, step, animation and effect, from the first frame', () => {
    const anims = [ANIM.Idle, ANIM.Move, ANIM.Melee, ANIM.Shoot, ANIM.Cast, ANIM.Windup, ANIM.Slam, ANIM.Dash, ANIM.Channel, ANIM.Bite];
    const effects = [0, 1 << EFFECT.Sleep, 1 << EFFECT.Petrified, 1 << EFFECT.Frozen];
    for (const k of KEYS) {
      const m = model(k), d = def(k);
      for (const dt of [0, 1 / 60, 1]) for (const anim of anims) for (const fx of effects) for (const flags of [0, FLAG.HURT]) {
        const mem = newPose3dMemory();
        const p = poseFigure(m, d, view({ anim, effects: fx, flags, animT: dt, x: 3, y: -4, aim: 0, fall: 0.3 }), dt, mem);
        const all = [p.yaw, ...Object.values(p.root), ...p.bones, ...p.bends, ...p.robe, p.air, ...Object.values(mem).filter((v) => typeof v === 'number') as number[]];
        for (const v of all) expect(Number.isFinite(v), `${k} dt ${dt} anim ${anim} fx ${fx}`).toBe(true);
        expect(p.bones.length).toBe(MAX_BONES * 12);
        // A second frame from the same memory, moving.
        const q = poseFigure(m, d, view({ anim, effects: fx, flags, animT: dt, x: 3 + dt, y: -4, aim: 2 }), dt, mem);
        for (const v of [q.yaw, ...q.bones, ...q.bends]) expect(Number.isFinite(v), `${k} second`).toBe(true);
      }
    }
  }, SLOW);

  it('faces somewhere defined when a figure never moved (atan2(0, 0))', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled({ yaw: 0.4 });
    const p = poseFigure(m, d, view({ anim: ANIM.Move }), 1 / 60, mem);
    expect(p.yaw).toBeCloseTo(0.4, 6);
  }, SLOW);
});

describe('purity', () => {
  it('gives the same output for the same memory copy and input', () => {
    const m = model('wizard'), d = def('wizard');
    const base = settled({ clock: 3.3, phi: 1.1, walk: 0.7, hitT: 0.05, wasHurt: true });
    const run = (): { p: Pose3d; mem: Pose3dMemory } => {
      const mem = structuredClone(base);
      return { p: poseFigure(m, d, view({ anim: ANIM.Cast, animT: 0.1, x: 5, flags: FLAG.HURT }), 1 / 60, mem), mem };
    };
    const a = run(), b = run();
    expect(b.p).toEqual(a.p);
    expect(b.mem).toEqual(a.mem);
  }, SLOW);
});

describe('restPose and skinVertex', () => {
  it('rests on the ground with identity bones, and moves no vertex but by the figure scale', () => {
    for (const k of ['wizard', 'wolf', 'elf'] as DescKey[]) {
      const m = model(k), p = restPose(m, 0.5);
      expect(p.yaw).toBe(0.5);
      expect(p.root).toEqual({ x: 0, y: 0, z: 0, roll: 0, sx: 1, sy: 1, sz: 1 });
      expect(p.attack).toBeNull();
      for (let b = 0; b < MAX_BONES; b++) expect(isIdentity(p, b), `${k} ${b}`).toBe(true);
      const out: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < m.position.length / 3; i += 7) {
        skinVertex(m, p, i, out);
        for (let a = 0; a < 3; a++) expect(out[a]).toBeCloseTo(m.position[i * 3 + a] * m.scale, 4);
      }
    }
  }, SLOW);

  it('bends a loose piece about its origin and swings a robe hem', () => {
    const m = model('wizard'), p = restPose(m, 0), out: [number, number, number] = [0, 0, 0];
    // The beard (a bend): find its tip vertex (along 1).
    let tip = -1, hem = -1;
    for (let i = 0; i < m.position.length / 3; i++) {
      if (m.skin[i * 4 + 2] >= 0 && m.skin[i * 4 + 3] > 0.99) tip = i;
      if (m.skin[i * 4 + 2] === -2 && m.skin[i * 4 + 3] > 0.99) hem = i;
    }
    expect(tip).toBeGreaterThanOrEqual(0);
    expect(hem).toBeGreaterThanOrEqual(0);
    const bi = m.skin[tip * 4 + 2];
    p.bends.set([0, 0, 1, 0.5], bi * 4);
    p.robe[0] = 2; p.robe[1] = -1;
    skinVertex(m, p, tip, out);
    const o = m.bends[bi].origin, v = [m.position[tip * 3] - o[0], m.position[tip * 3 + 1] - o[1]];
    // Turned 0.5 rad about z at the tip (along 1).
    expect(out[0] / m.scale).toBeCloseTo(o[0] + v[0] * Math.cos(0.5) - v[1] * Math.sin(0.5), 4);
    expect(out[1] / m.scale).toBeCloseTo(o[1] + v[0] * Math.sin(0.5) + v[1] * Math.cos(0.5), 4);
    skinVertex(m, p, hem, out);
    const w = m.skin[hem * 4 + 3];
    expect(out[0] / m.scale).toBeCloseTo(m.position[hem * 3] + 2 * w, 4);
    expect(out[2] / m.scale).toBeCloseTo(m.position[hem * 3 + 2] - 1 * w, 4);
  }, SLOW);
});

describe('the floating gait', () => {
  const STEP = 1 / 60;
  const HIPS = bone('hips'), BODY = bone('body'), HEAD = bone('head'), ARM_R = bone('armR'), ARM_L = bone('armL');
  /** The hips have no parent: their turn about z is read from their world matrix. */
  const hipsTurn = (p: Pose3d): number => Math.atan2(p.bones[HIPS * 12 + 4], p.bones[HIPS * 12]);
  /** The way a bone's own matrix points a hanging limb: its (0, -1, 0) in the parent's frame. */
  const hang = (m: FigureModel, p: Pose3d, b: number): [number, number, number] => { const e = localOf(m, p, b).elements; return [-e[4], -e[5], -e[6]]; };
  const angle = (a: [number, number, number], b: [number, number, number]): number => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  /** The upper legs of the model: the right one has its pivot at z > 0. */
  const legsOf = (m: FigureModel): { r: { upper: number; lower: number }; l: { upper: number; lower: number } } => {
    const [a, b] = m.legs!;
    return m.pivots[a.upper * 3 + 2] > 0 ? { r: a, l: b } : { r: b, l: a };
  };
  /** Stands still for `secs` of 1/60 s steps. */
  const stand = (k: TubeKey, secs: number, mem: Pose3dMemory = settled()): Pose3d => {
    let p!: Pose3d;
    for (let i = 0; i < Math.round(secs / STEP); i++) p = poseFigure(tube(k), tdef(k), view(), STEP, mem);
    return p;
  };
  /** Moves along +x at `speed` px/s for `secs`. `from`: the x it starts at (a run of the same memory goes on from there). */
  const glide = (k: TubeKey, secs: number, mem: Pose3dMemory, speed = 50, from = 0): { p: Pose3d; x: number } => {
    let p!: Pose3d, x = from;
    for (let i = 0; i < Math.round(secs / STEP); i++) { x += speed * STEP; p = poseFigure(tube(k), tdef(k), view({ anim: ANIM.Move, x, y: 0 }), STEP, mem); }
    return { p, x };
  };

  for (const k of SPECTRES) {
    describe(k, () => {
      const m = tube(k), d = tdef(k);
      // The cases of a body with legs and limp arms (the Ghost); the Shade's parts float apart (see 'floating parts').
      const oldBody = (name: string, fn: () => void, timeout?: number): void => { if (k === 'ghost') it(name, fn, timeout); };
      const hover = m.apart ? APART.hover : FLOAT.hover;

      oldBody('is a floating model with legs and arms', () => {
        expect(m.gait).toBe('float');
        expect(m.legs!.length).toBe(2);
        expect(m.armLength).toBeGreaterThan(0);
      }, SLOW);

      it('hovers and bobs while standing, without a period under ten seconds', () => {
        const mem = settled(), ys: number[] = [];
        for (let i = 0; i < 20 * 60; i++) ys.push(poseFigure(m, d, view(), STEP, mem).root.y);
        for (let i = 0; i < 120; i++) {
          expect(ys[i]).toBeGreaterThanOrEqual(hover - 1.0);
          expect(ys[i]).toBeLessThanOrEqual(hover + 1.0);
          expect(ys[i + 1], `frame ${i}`).not.toBe(ys[i]);
        }
        // Frame i is the clock (i + 1) / 60: the first bob term repeats after 6.98 s, the others do not.
        let most = 0;
        for (let i = 0; i < 13 * 60; i += 30) {
          const diff = Math.abs(ys[i] - ys[i + Math.round(6.98 * 60)]);
          expect(diff, `at ${i / 60} s`).toBeGreaterThan(1e-4);
          most = Math.max(most, diff);
        }
        expect(most).toBeGreaterThan(0.05);
      }, SLOW);

      it('bobs differently with another phase', () => {
        const a = settled({ phase: 0 }), b = settled({ phase: 2 });
        for (let i = 0; i < 30; i++) { poseFigure(m, d, view(), STEP, a); poseFigure(m, d, view(), STEP, b); }
        expect(Math.abs(poseFigure(m, d, view(), STEP, a).root.y - poseFigure(m, d, view(), STEP, b).root.y)).toBeGreaterThan(0.01);
      }, SLOW);

      oldBody('trails its limbs behind it when it moves, and leans', () => {
        const { p } = glide(k, 2, settled());
        const { r, l } = legsOf(m);
        for (const leg of [r, l]) {
          const up = turnOf(m, p, leg.upper), low = turnOf(m, p, leg.lower);
          expect(up).toBeLessThan(-0.6);
          expect(up).toBeGreaterThan(-0.95);
          expect(low).toBeLessThan(-0.3);
          expect(low).toBeGreaterThan(-0.6);
          for (const arm of [ARM_R, ARM_L]) {
            expect(turnOf(m, p, arm)).toBeLessThan(0);
            expect(Math.abs(turnOf(m, p, arm))).toBeLessThan(Math.abs(up));
          }
        }
        expect(turnOf(m, p, HEAD)).toBeCloseTo(-FLOAT.head, 6);
        expect(Math.abs(hipsTurn(p) + FLOAT.lean.max)).toBeLessThan(0.01);
      }, SLOW);

      oldBody('does not step', () => {
        const mem = settled(), { r, l } = legsOf(m);
        let { x } = glide(k, 2, mem);
        const rs: number[] = [], diffs: number[] = [];
        for (let i = 0; i < 60; i++) {
          const g = glide(k, STEP, mem, 50, x); x = g.x;
          const a = turnOf(m, g.p, r.upper), b = turnOf(m, g.p, l.upper);
          rs.push(a, b); diffs.push(a - b);
        }
        expect(Math.max(...rs) - Math.min(...rs)).toBeLessThan(0.12);
        // A stride would swing the two legs through each other (about +-0.5 rad apart); here they stay near one another, the right one a little further back.
        expect(Math.max(...diffs)).toBeLessThan(0.1);
        expect(Math.min(...diffs)).toBeGreaterThan(-0.2);
      }, SLOW);

      oldBody('follows the speed late', () => {
        const mem = settled(), { r } = legsOf(m);
        const early = glide(k, 0.1, mem).p;
        const late = glide(k, 2, settled()).p;
        const full = Math.abs(turnOf(m, late, r.upper));
        expect(full).toBeGreaterThan(0.6);
        expect(Math.abs(turnOf(m, early, r.upper))).toBeLessThan(full / 3);
      }, SLOW);

      oldBody('lunges in a melee with the legs limp, and shows the strike', () => {
        const mem = settled(), standing = copyPose(poseFigure(m, d, view(), 0, mem));
        const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: LUNGE_SECS / 2 }), 0, mem);
        expect(p.root.x).toBeCloseTo(3 * (d.scale ?? 1), 5);
        expect(p.attack?.style).toBe('swing');
        for (const leg of m.legs!) {
          expect(turnOf(m, p, leg.upper)).toBeCloseTo(turnOf(m, standing, leg.upper), 6);
          expect(turnOf(m, p, leg.lower)).toBeCloseTo(turnOf(m, standing, leg.lower), 6);
        }
        expect(hipsTurn(p)).toBeCloseTo(hipsTurn(standing), 6);
        expect(p.root.y).toBeCloseTo(standing.root.y, 6);
      }, SLOW);

      it('has no airborne hop, moving or not', () => {
        expect(stand(k, 0.5).air).toBe(0);
        expect(glide(k, 1, settled()).p.air).toBe(0);
      }, SLOW);

      it('holds the pose when petrified or frozen, and lies when asleep', () => {
        for (const fx of [1 << EFFECT.Petrified, 1 << EFFECT.Frozen]) {
          const mem = settled(), a = copyPose(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.1, effects: fx }), STEP, mem));
          const b = poseFigure(m, d, view({ anim: ANIM.Idle, effects: fx, flags: FLAG.HURT, x: 5 }), 0.3, mem);
          expect(b.bones).toEqual(a.bones);
          expect(b.root).toEqual(a.root);
        }
        const s = poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), STEP, settled());
        if (!m.apart) expect(s.root.roll).toBeCloseTo(Math.PI / 2, 6);   // a body that floats apart does not lie down (see 'floating parts')
        expect(s.asleep).toBe(true);
      }, SLOW);
    });
  }

  describe('the Ghost, swiping', () => {
    const m = tube('ghost'), d = tdef('ghost');
    const sideOfHand = (p: Pose3d): number => hand(m, p, 'R')[2];

    it('swings the right arm across the front through a melee, and keeps the left one limp', () => {
      const mem = settled(), standing = copyPose(poseFigure(m, d, view(), 0, mem));
      const limpR = hang(m, standing, ARM_R), limpL = hang(m, standing, ARM_L);
      let most = 0, lowSide = Infinity, highSide = -Infinity, bodyTurn = 0, headYaw = 0;
      const yawOf = (p: Pose3d, b: number): number => Math.atan2(p.bones[b * 12 + 2], p.bones[b * 12]);
      for (let i = 0; i <= Math.round(MELEE_T / STEP); i++) {
        const animT = Math.min(MELEE_T, i * STEP);
        const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT }), 0, mem);
        most = Math.max(most, angle(hang(m, p, ARM_R), limpR));
        lowSide = Math.min(lowSide, sideOfHand(p)); highSide = Math.max(highSide, sideOfHand(p));
        expect(angle(hang(m, p, ARM_L), limpL), `left arm at ${animT}`).toBeLessThan(0.05);
        if (Math.abs(animT - MELEE_T / 2) < STEP / 2) { bodyTurn = yawOf(p, BODY); headYaw = yawOf(p, HEAD); }
        expect(p.attack?.style).toBe('swing');
      }
      expect(most).toBeGreaterThan(0.8);
      expect(lowSide).toBeLessThan(0);
      expect(highSide).toBeGreaterThan(0);
      expect(Math.abs(bodyTurn)).toBeGreaterThan(0.05);
      expect(Math.abs(headYaw)).toBeLessThan(Math.abs(bodyTurn));
    }, SLOW);

    it('blends the strike in, and is limp again a second after it', () => {
      const mem = settled(), standing = copyPose(poseFigure(m, d, view(), 0, mem));
      const limpR = hang(m, standing, ARM_R);
      expect(angle(hang(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), 0, mem), ARM_R), limpR)).toBeLessThan(0.1);
      poseFigure(m, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, mem);
      // A second of idle frames after the swing (the blend runs on the frames' own dt): nothing else moves the arm, so it hangs limp again.
      let p = poseFigure(m, d, view({ anim: ANIM.Idle, animT: 0 }), 0, mem);
      for (let i = 0; i < 60; i++) p = poseFigure(m, d, view({ anim: ANIM.Idle, animT: (i + 1) / 60 }), 1 / 60, mem);
      expect(angle(hang(m, p, ARM_R), limpR)).toBeLessThan(0.05);
    }, SLOW);

    it('holds the arm raised in a wind-up, and strikes from there', () => {
      const mem = settled(), standing = copyPose(poseFigure(m, d, view(), 0, mem));
      const limpR = hang(m, standing, ARM_R);
      expect(angle(hang(m, poseFigure(m, d, view({ anim: ANIM.Windup }), 0, mem), ARM_R), limpR)).toBeGreaterThan(0.5);
      expect(angle(hang(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), 0, mem), ARM_R), limpR)).toBeGreaterThan(0.5);
    }, SLOW);

    it('keeps the legs and the hover still in a blow', () => {
      const mem = settled(), standing = copyPose(poseFigure(m, d, view(), 0, mem));
      const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, mem);
      for (const leg of m.legs!) expect(turnOf(m, p, leg.upper)).toBeCloseTo(turnOf(m, standing, leg.upper), 6);
      expect(hipsTurn(p)).toBeCloseTo(hipsTurn(standing), 6);
      expect(p.root.y).toBeCloseTo(standing.root.y, 6);
    }, SLOW);
  });

  describe('floating parts (the Shade)', () => {
    const m = tube('shade'), d = tdef('shade'), gs = d.scale ?? 1;
    type Part = 'head' | 'armR' | 'armL';
    const PARTS: Part[] = ['head', 'armR', 'armL'];
    /** Where a bone's pivot is in the model's frame, before the root (the pivot of the bone itself). */
    const at = (p: Pose3d, name: (typeof BONES)[number]): [number, number, number] => apply(p, bone(name), pivot(m, name));
    const off = (p: Pose3d, name: Part): [number, number, number] => { const a = at(p, name), q = pivot(m, name); return [a[0] - q[0], a[1] - q[1], a[2] - q[2]]; };
    const len = (v: number[]): number => Math.hypot(v[0], v[1], v[2]);
    const dist = (a: number[], b: number[]): number => len([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    const hipsYaw = (p: Pose3d): number => Math.asin(p.bones[HIPS * 12 + 2]);
    /** The right wrist: the elbow (the hand bone's pivot) plus the description's forearm. */
    const wrist = (p: Pose3d): [number, number, number] => { const q = pivot(m, 'handR'); return apply(p, bone('handR'), [q[0] + FOREARM[0], q[1] + FOREARM[1], q[2] + FOREARM[2]]); };
    const standFor = (secs: number, mem = settled()): Pose3d => { let p!: Pose3d; for (let i = 0; i < Math.round(secs / STEP); i++) p = poseFigure(m, d, view(), STEP, mem); return p; };
    /** A wind-up held for 0.5 s, then the melee's animT from 0 to `to`; the poses of the melee. */
    const strike = (mem: Pose3dMemory, to = MELEE_T): Pose3d[] => {
      for (let i = 0; i < 30; i++) poseFigure(m, d, view({ anim: ANIM.Windup, animT: i * STEP }), STEP, mem);
      const out: Pose3d[] = [];
      for (let i = 0; i <= Math.round(to * 120); i++) out.push(copyPose(poseFigure(m, d, view({ anim: ANIM.Melee, animT: Math.min(to, i / 120) }), 1 / 120, mem)));
      return out;
    };

    it('drifts each part on its own by a fraction of a pixel, out of step', () => {
      const mem = settled(), peak = { head: 0, armR: 0, armL: 0 };
      for (let i = 0; i < 20 * 60; i++) {
        const p = poseFigure(m, d, view(), STEP, mem);
        for (const n of PARTS) peak[n] = Math.max(peak[n], len(off(p, n)));
        expect(dist(off(p, 'head'), off(p, 'armR'))).toBeGreaterThan(1e-6);
        expect(dist(off(p, 'armR'), off(p, 'armL'))).toBeGreaterThan(1e-6);
        expect(dist(off(p, 'head'), off(p, 'armL'))).toBeGreaterThan(1e-6);
      }
      // The brief's 0.6 px peak is not met by its own numbers: the arm's three amplitudes (0.35, 0.45, 0.35) can add up to 0.667 px, measured 0.668 in 20 s.
      for (const n of PARTS) { expect(peak[n], n).toBeGreaterThan(0.2); expect(peak[n], n).toBeLessThan(0.7); }
      const a = settled({ phase: 0 }), b = settled({ phase: 2 });
      expect(dist(off(standFor(3, a), 'armR'), off(standFor(3, b), 'armR'))).toBeGreaterThan(0.05);
    }, SLOW);

    it('hovers at APART.hover and bobs by the Ghost\'s bob', () => {
      const mem = settled();
      for (let i = 0; i < 20 * 60; i++) {
        const y = poseFigure(m, d, view(), STEP, mem).root.y;
        expect(y).toBeGreaterThanOrEqual(APART.hover - 1.0);
        expect(y).toBeLessThanOrEqual(APART.hover + 1.0);
      }
    }, SLOW);

    it('leans as the Ghost does when it moves, and nothing turns in time with its speed', () => {
      const mem = settled(), arm: Record<'armR' | 'armL', number[]> = { armR: [], armL: [] };
      let x = 0, p!: Pose3d;
      for (let i = 0; i < 3 * 60; i++) { x += 50 * STEP; p = poseFigure(m, d, view({ anim: ANIM.Move, x, y: 0 }), STEP, mem); if (i >= 120) for (const n of ['armR', 'armL'] as const) arm[n].push(turnOf(m, p, bone(n))); }
      expect(Math.abs(hipsTurn(p) + FLOAT.lean.max)).toBeLessThan(0.01);
      for (const n of ['armR', 'armL'] as const) expect(Math.max(...arm[n]) - Math.min(...arm[n]), n).toBeLessThan(0.12);
    }, SLOW);

    it('winds up: the right hand rises and goes back, the hips turn, and nothing shivers', () => {
      const mem = settled(), standing = standFor(0.5);
      let p!: Pose3d;
      for (let i = 0; i < 30; i++) {
        p = poseFigure(m, d, view({ anim: ANIM.Windup, animT: i * STEP }), STEP, mem);
        expect(p.root.z, `frame ${i}`).toBe(0);
      }
      const hr = at(p, 'handR'), hs = at(standing, 'handR');
      expect(hr[1] - hs[1]).toBeGreaterThan(2);
      expect(hr[0]).toBeLessThan(hs[0]);
      expect(Math.abs(hipsYaw(p) - APART.body.yaw[0])).toBeLessThan(0.02);
      expect(Math.abs(p.root.x + APART.body.back * gs)).toBeLessThan(0.05);
    }, SLOW);

    it('strikes: the claw crosses the front, the arm reaches, the head leans in, the other arm goes back, the lunge is the game\'s', () => {
      const mem = settled(), standing = standFor(0.5), frames = strike(mem);
      let lo = Infinity, hi = -Infinity;
      for (const p of frames) { const z = wrist(p)[2]; lo = Math.min(lo, z); hi = Math.max(hi, z); expect(p.attack?.style).toBe('swing'); }
      expect(lo).toBeLessThan(0);
      expect(hi).toBeGreaterThan(0);
      const last = frames[frames.length - 1];
      expect(at(last, 'armR')[0] - at(standing, 'armR')[0]).toBeGreaterThan(5);
      expect(at(last, 'head')[0] - at(standing, 'head')[0]).toBeGreaterThan(1);
      expect(at(last, 'armL')[0]).toBeLessThan(at(standing, 'armL')[0]);
      const mid = frames[Math.round(LUNGE_SECS / 2 * 120)];
      expect(Math.abs(mid.root.x - d.lunge! * gs)).toBeLessThan(0.2);
    }, SLOW);

    it('drifts back after the blow: still off 0.3 s later, home after 5 MELEE_T and a little', () => {
      const mem = settled(), ref = settled();
      strike(mem);
      let p!: Pose3d, q!: Pose3d, t = 0;
      for (let i = 0; i < 30; i++) poseFigure(m, d, view(), STEP, ref);   // the standing figure's clock matches: the wind-up's 30 frames
      for (let i = 0; i <= Math.round(MELEE_T * 120); i++) poseFigure(m, d, view(), 1 / 120, ref);
      const secs = (s: number): void => { for (const stop = t + s; t < stop - 1e-9; t += STEP) { p = poseFigure(m, d, view({ anim: ANIM.Idle }), STEP, mem); q = poseFigure(m, d, view(), STEP, ref); } };
      secs(0.3);
      expect(dist(off(p, 'armR'), off(q, 'armR'))).toBeGreaterThan(1);
      secs(5 * MELEE_T);
      for (const n of PARTS) expect(dist(off(p, n), off(q, n)), n).toBeLessThan(0.6);
    }, SLOW);

    it('a second blow 0.4 s after the first began moves no bone by more than 1 px between the frames around its start', () => {
      const mem = settled();
      for (let i = 0; i < 60; i++) poseFigure(m, d, view(), STEP, mem);
      // The first melee begins; its animation runs 0.4 s (animT keeps counting), then the next melee begins with animT 0 again.
      let prev!: Pose3d;
      for (let i = 0; i < 24; i++) prev = poseFigure(m, d, view({ anim: ANIM.Melee, animT: i * STEP }), STEP, mem);
      prev = copyPose(prev);
      const q = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), STEP, mem);
      for (const n of ['head', 'armR', 'armL', 'handR', 'handL'] as const) expect(dist(at(prev, n), at(q, n)), n).toBeLessThan(1);
    }, SLOW);

    it('goes on smoothly through a melee, a wind-up straight after it, and a melee after that', () => {
      const mem = settled();
      for (let i = 0; i < 60; i++) poseFigure(m, d, view(), STEP, mem);
      let prev!: Pose3d;
      for (let i = 0; i < 24; i++) prev = poseFigure(m, d, view({ anim: ANIM.Melee, animT: i * STEP }), STEP, mem);
      const names = ['head', 'armR', 'armL', 'handR', 'handL'] as const;
      const jump = (a: Pose3d, b: Pose3d): number => Math.max(...names.map((n) => dist(at(a, n), at(b, n))));
      prev = copyPose(prev);
      let p = poseFigure(m, d, view({ anim: ANIM.Windup, animT: 0 }), STEP, mem);
      // The wind-up's own first frame is not free: the wind follows 1 at APART.time.windIn (0.18 of it in one frame), which moves the arm by 1.77 px (measured); a jump of the swing (about 1) would be 4 px and more.
      expect(jump(prev, p), 'into the wind-up').toBeLessThan(2);
      for (let i = 1; i < 18; i++) { prev = copyPose(p); p = poseFigure(m, d, view({ anim: ANIM.Windup, animT: i * STEP }), STEP, mem); }
      prev = copyPose(p);
      p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), STEP, mem);
      expect(jump(prev, p), 'into the second melee').toBeLessThan(1);
    }, SLOW);

    it('sweeps from the hang when no wind-up came before it', () => {
      const mem = settled(), standing = standFor(2, mem);
      const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), STEP, mem);
      expect(dist(at(p, 'armR'), at(standing, 'armR'))).toBeLessThan(0.5);
    }, SLOW);

    it('forms from the smoke in the ambush', () => {
      const mem = settled();
      const early = poseFigure(m, d, view({ anim: ANIM.Ambush, animT: 0.3 * AMBUSH_WARNING }), STEP, mem);
      for (const n of PARTS) expect(dist(at(early, n), [...APART.inside]), n).toBeLessThan(0.5);
      const late = poseFigure(m, d, view({ anim: ANIM.Ambush, animT: 1.0 * AMBUSH_WARNING }), STEP, mem);
      for (const n of PARTS) expect(len(off(late, n)), n).toBeLessThan(0.7);
    }, SLOW);

    it('does not lie down asleep: it hangs lower with the head drooped', () => {
      const p = poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), STEP, settled());
      expect(p.root.roll).toBe(0);
      expect(p.root.y).toBeCloseTo(APART.asleep.hover, 2);
      expect(turnOf(m, p, bone('head'))).toBeCloseTo(APART.asleep.droop, 6);
    }, SLOW);
  });
});

describe('the summoning wind-up (#358)', () => {
  it('poses the necromancer in ANIM.Summon as in ANIM.Windup', () => {
    const m = tube('necromancer'), d = tdef('necromancer');
    const at = (anim: number) => flat(poseFigure(m, d, view({ anim, animT: 0.2, aim: 1 }), 0, settled({ clock: 0.2 })));
    expect(at(ANIM.Summon)).toEqual(at(ANIM.Windup));
  });
});
