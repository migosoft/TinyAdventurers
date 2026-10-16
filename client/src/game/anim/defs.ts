// Data: how each entity kind looks and animates, using 0x72 pack frames.
// Bodies: `<prefix><0..3>` for idle/run (4-frame pack animations).
// The pack has no attack animations; attacks animate the pack weapon sprites.
// The dragon and the demon are the exceptions: their own frames for every action
// (dragonRig.ts, demonFrames.ts).
// The lich has its own idle/run frames in the pack style (scripts/lich-frames.ts).
import { ABILITIES, ANIM, CONST, KIND } from "../../generated/defs";
import { GLOOM } from "../effects";
import { DRAGON_ANIMS, DRAGON_FRAME, dragonFrameName, dragonPoints, type DragonAnim } from "./dragonRig";
import { DEMON_ANIMS, DEMON_FRAME, demonFrameName, type DemonAnim } from "./demonFrames";

// Player swings reach as far as the server hits: ability range + a typical monster radius.
const SWORD = { reach: ABILITIES.Sword.range + 5, arc: ABILITIES.Sword.arc };
const AXE = { reach: ABILITIES.Axe.range + 5, arc: ABILITIES.Axe.arc, color: 0xffe0d0 };
const MOB_SWING = { reach: 22, arc: 1.6, color: 0xffd0d0 };
// Demons fight with bare claws: a swoosh at the damage reach, no weapon sprite.
const CLAW = { reach: 20, arc: 1.6, color: 0xffb080 };

export type AttackStyle = 'melee' | 'ranged' | 'caster' | 'none';
/** How a weapon sprite is held: blades/staffs point up in the pack, bows are vertical. */
export type Mount = 'blade' | 'bow' | 'staff';
/** Facing directions. The pack only has left/right figures; up/down can be added later. */
export type Dir = 'left' | 'right';

export interface FigureDef {
  idle: string;
  run: string;
  hit?: string;
  weapon?: string;
  mount?: Mount;
  /** Second weapon used for melee (ranger dagger). */
  meleeWeapon?: string;
  weaponTint?: number;
  weaponScale?: number;
  /** Hand height above the feet (px, unscaled). */
  handY: number;
  /** Hand offset towards the facing side (px, unscaled; default 3). The ogre holds its club out at its side. */
  handX?: number;
  attack: AttackStyle;
  /** Accent color of the figure (spell particles, dash afterimages). */
  base: number;
  /** Footprint radius: ground shadow size, dagger reach checks. */
  baseR: number;
  /** Whole-figure scale and tint (bosses built from pack sprites). */
  scale?: number;
  tint?: number;
  /** Melee swoosh: drawn at the damage reach (px from the figure), over the damage arc (rad). */
  swing?: { reach: number; arc: number; color?: number };
  /** Ground slam telegraph: a ring of radius `r` (px, hero centres) filling up while `anim` runs for `t` s (ogre slam, dragon landing, lich nova); red unless `color`; `gloom` draws dark sparks into the ring. */
  slam?: { r: number; anim: number; t: number; color?: number; gloom?: boolean };
  /** Own action frames (the dragon, the demon): `<prefix><i>`, frame count, frames per second. */
  frames?: Partial<Record<FigureAnim, { prefix: string; n: number; fps: number }>>;
  /** Attack anims that start with their wind-up (s): the wind-up frame shows first, then the strike frames. */
  windups?: Partial<Record<number, number>>;
  /** Enraged, the figure's action timers run this much faster (wind-ups last `pace` times as long; the demon). */
  pace?: number;
  /** Hover height while airborne (px, unscaled). */
  lift?: number;
  /** Row of the feet in the body frames (the origin), when space is left below them (the dragon's hanging legs in flight). */
  footY?: number;
  /** Column of the hips in the body frames, when the figure is not centred in them (the demon's tail and reach). */
  hipX?: number;
  /** Bite (the dragon): sparks where the jaws snap, `reach` px straight ahead. */
  bite?: { reach: number; color: number };
  /** Tail swipe behind the figure (the dragon), shown for the Tail animation. */
  tail?: { reach: number; arc: number; color?: number };
  /** Where breath attacks come out (dragon mouth / nostrils), per body frame. */
  mouth?: FramePoints;
  nostrils?: FramePoints;
  label?: string;
  /** Asleep (lying): pixels cut off the side that ends up on the floor, when the default (`lyingPose`) does not fit the frame. */
  lieCrop?: number;
}

/** Pixel points inside a frame (x, y from the frame's top-left), e.g. the dragon's mouth. */
export type FramePoints = Record<string, [number, number]>;
/** Actions with their own frames (the dragon and the demon have them). */
export type FigureAnim = DragonAnim | DemonAnim;

// The dragon's frames are built at atlas time from its rig; the breath points come from the same poses.
const DRAGON_POINTS = dragonPoints();
const dragonFrames = Object.fromEntries(
  (Object.keys(DRAGON_ANIMS) as DragonAnim[]).map((a) => [a, { prefix: dragonFrameName(a, 0).slice(0, -1), n: DRAGON_ANIMS[a].length, fps: a === 'idle' ? 4 : a === 'walk' ? 8 : a === 'hover' || a === 'hoverbreath' ? 12 : 10 }]),
) as Record<DragonAnim, { prefix: string; n: number; fps: number }>;

const demonFrames = Object.fromEntries(
  (Object.keys(DEMON_ANIMS) as DemonAnim[]).map((a) => [a, { prefix: demonFrameName(a, 0).slice(0, -1), n: DEMON_ANIMS[a], fps: a === 'idle' ? 4 : a === 'walk' ? 9 : 10 }]),
) as Record<DemonAnim, { prefix: string; n: number; fps: number }>;

const hero = (n: string) => ({ idle: `${n}_idle_anim_f`, run: `${n}_run_anim_f`, hit: `${n}_hit_anim_f0` });
const mob = (n: string) => ({ idle: `${n}_idle_anim_f`, run: `${n}_run_anim_f` });
const necro = { idle: 'necromancer_anim_f', run: 'necromancer_anim_f' };
// Necromancer with a red robe, recolored at atlas build time (scripts/build-atlas.ts).
const summoner = { idle: 'summoner_anim_f', run: 'summoner_anim_f' };

export const FIGURES: Record<number, FigureDef> = {
  [KIND.Wizard]: { ...hero('wizzard_m'), weapon: 'weapon_red_magic_staff', mount: 'staff', handY: 10, attack: 'caster', base: 0x4a7aff, baseR: 6, label: 'Wizard' },
  [KIND.Paladin]: { ...hero('knight_m'), swing: SWORD, weapon: 'weapon_knight_sword', mount: 'blade', handY: 10, attack: 'melee', base: 0xe8c040, baseR: 6, label: 'Paladin' },
  [KIND.Barbarian]: { ...hero('dwarf_m'), swing: AXE, weapon: 'weapon_double_axe', mount: 'blade', handY: 9, attack: 'melee', base: 0xd03030, baseR: 6, label: 'Barbarian' },
  [KIND.ElvenRanger]: { ...hero('elf_m'), weapon: 'weapon_bow', mount: 'bow', meleeWeapon: 'weapon_knife', weaponScale: 0.8, handY: 10, attack: 'ranged', base: 0x3aa060, baseR: 6, label: 'Elven Ranger' },
  [KIND.GoblinArcher]: { ...mob('goblin'), weapon: 'weapon_bow', mount: 'bow', weaponScale: 0.6, handY: 6, attack: 'ranged', base: 0x4a3a2a, baseR: 5 },
  [KIND.SkeletonWarrior]: { ...mob('skelet'), swing: MOB_SWING, weapon: 'weapon_rusty_sword', mount: 'blade', weaponScale: 0.8, handY: 6, attack: 'melee', base: 0x4a3a2a, baseR: 5 },
  [KIND.SkeletonArcher]: { ...mob('skelet'), weapon: 'weapon_bow_2', mount: 'bow', weaponScale: 0.6, handY: 6, attack: 'ranged', base: 0x4a3a2a, baseR: 5 },
  [KIND.OrcWarrior]: { ...mob('orc_warrior'), swing: { ...MOB_SWING, reach: 26 }, weapon: 'weapon_cleaver', mount: 'blade', handY: 8, attack: 'melee', base: 0x4a3a2a, baseR: 6 },
  [KIND.OrcArcher]: { ...mob('masked_orc'), weapon: 'weapon_bow', mount: 'bow', weaponScale: 0.8, handY: 8, attack: 'ranged', base: 0x4a3a2a, baseR: 6 },
  [KIND.Necromancer]: { ...necro, weapon: 'weapon_green_magic_staff', mount: 'staff', handY: 8, attack: 'caster', base: 0x2a6a3a, baseR: 5 },
  [KIND.RaisedSkeleton]: { ...mob('skelet'), swing: MOB_SWING, weapon: 'weapon_rusty_sword', mount: 'blade', weaponScale: 0.8, handY: 6, attack: 'melee', base: 0x2a6a3a, baseR: 5 },
  [KIND.Disciple]: { ...necro, handY: 8, attack: 'caster', base: 0x7a1020, baseR: 5, tint: 0xff7070 },
  [KIND.Imp]: { ...mob('imp'), swing: CLAW, handY: 7, attack: 'caster', base: 0xff7020, baseR: 5 },
  [KIND.Chort]: { ...mob('chort'), swing: { ...CLAW, reach: 22 }, handY: 10, attack: 'caster', base: 0xff7020, baseR: 5 },
  [KIND.Summoner]: { ...summoner, weapon: 'weapon_red_magic_staff', mount: 'staff', weaponTint: 0xffb080, handY: 8, attack: 'caster', base: 0x9a2020, baseR: 5 },
  [KIND.Ogre]: { ...mob('ogre'), swing: { reach: 34, arc: 2.0, color: 0xffe0b0 }, weapon: 'weapon_baton_with_spikes', mount: 'blade', weaponScale: 1.4, handX: 12, handY: 14, attack: 'melee', base: 0x3a6a3a, baseR: 12, slam: { r: CONST.OGRE_SLAM_RADIUS, anim: ANIM.Slam, t: CONST.OGRE_SLAM_WINDUP } },
  [KIND.Demon]: {
    idle: demonFrames.idle.prefix,
    run: demonFrames.walk.prefix,
    frames: demonFrames,
    windups: { [ANIM.Melee]: CONST.DEMON_CLEAVE_WINDUP, [ANIM.Dash]: CONST.DEMON_SWOOP_WINDUP, [ANIM.Cast]: CONST.DEMON_RING_WINDUP },
    pace: CONST.DEMON_ENRAGED_PACE,
    footY: DEMON_FRAME.footY,
    hipX: DEMON_FRAME.hipX,
    swing: { reach: 40, arc: 2.1, color: 0xffa080 },
    handY: 30,
    attack: 'melee',
    base: 0x7a1010,
    baseR: 13,
  },
  [KIND.Lich]: { ...mob('lich'), weapon: 'weapon_lich_staff', mount: 'staff', weaponScale: 1.3, handX: 7, handY: 11, attack: 'caster', base: GLOOM.light, baseR: 7, slam: { r: CONST.LICH_NOVA_RADIUS, anim: ANIM.Slam, t: CONST.LICH_NOVA_WINDUP, color: GLOOM.light, gloom: true } },
  [KIND.Dragon]: {
    idle: dragonFrames.idle.prefix,
    run: dragonFrames.walk.prefix,
    frames: dragonFrames,
    windups: { [ANIM.Melee]: CONST.DRAGON_CLAW_WINDUP, [ANIM.Bite]: CONST.DRAGON_BITE_WINDUP, [ANIM.Tail]: CONST.DRAGON_TAIL_WINDUP, [ANIM.Breath]: CONST.DRAGON_BREATH_WINDUP },
    slam: { r: CONST.DRAGON_SMASH_RADIUS, anim: ANIM.Land, t: CONST.DRAGON_LAND },
    lift: 14,
    footY: DRAGON_FRAME.footY,
    mouth: DRAGON_POINTS.mouth,
    nostrils: DRAGON_POINTS.nostrils,
    swing: { ...CLAW, reach: 40, color: 0xffc0a0 },
    tail: { reach: 46, arc: 2.4, color: 0xffc0a0 },
    bite: { reach: CONST.DRAGON_BITE_RANGE, color: 0xfff0d0 },
    handX: 8,
    handY: 16,
    attack: 'melee',
    base: 0x7a1010,
    baseR: 16,
    scale: 1.2,
  },
};

/** Projectiles: a pack sprite (arrows) or a runtime glow of the given color. */
/** `gloom`: the lich's dark purple shimmer (a flickering glow trailing dark smoke and sparks, see `Effects.gloomWisp`). */
export const PROJECTILES: Record<number, { frame?: string; scale: number; glow?: number; trail?: number; gloom?: boolean }> = {
  [KIND.Missile]: { glow: 0xa080ff, scale: 0.8, trail: 0x9a7aff },
  [KIND.Fireball]: { glow: 0xff7020, scale: 1.4, trail: 0xffb040 },
  [KIND.Bolt]: { frame: 'weapon_arrow', scale: 0.6 },
  [KIND.Arrow]: { frame: 'weapon_arrow', scale: 0.6 },
  [KIND.ShadowBolt]: { glow: 0x40e060, scale: 1, trail: 0x205a20 },
  [KIND.FrostBolt]: { glow: 0x9ae0ff, scale: 1, trail: 0xe0f8ff },
  [KIND.GloomBolt]: { glow: 0x9a50f0, scale: 1.1, trail: 0x5a1a8a, gloom: true },
  [KIND.FireOrb]: { glow: 0xff8030, scale: 0.9, trail: 0xff8030 },
  [KIND.FireBolt]: { glow: 0xff7020, scale: 0.7, trail: 0xffb040 },
  [KIND.DragonFireball]: { glow: 0xff5010, scale: 2, trail: 0xffb040 },
  [KIND.BlindOrb]: { glow: 0x3a1a5a, scale: 1.4, trail: 0x1a0a2a, gloom: true },
  [KIND.SleepOrb]: { glow: 0xc080ff, scale: 1.3, trail: 0x8040c0, gloom: true },
};

export function isPlayerKind(k: number): boolean {
  return k <= KIND.ElvenRanger;
}
export function isProjectileKind(k: number): boolean {
  return k >= KIND.Missile && k < KIND.FirePatch;
}
export function isBossKind(k: number): boolean {
  return k === KIND.Demon || k === KIND.Lich || k === KIND.Dragon;
}
