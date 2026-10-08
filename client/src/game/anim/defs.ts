// Data: how each entity kind looks and animates, using only 0x72 pack frames.
// Bodies: `<prefix><0..3>` for idle/run (4-frame pack animations).
// The pack has no attack animations; attacks animate the pack weapon sprites.
import { ABILITIES, KIND } from "../../generated/defs";

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
  /** Second weapon used for melee (assassin dagger). */
  meleeWeapon?: string;
  weaponTint?: number;
  weaponScale?: number;
  /** Hand height above the feet (px, unscaled). */
  handY: number;
  attack: AttackStyle;
  /** Accent color of the figure (spell particles, dash afterimages). */
  base: number;
  /** Footprint radius: ground shadow size, dagger reach checks. */
  baseR: number;
  /** Whole-figure scale and tint (bosses built from pack sprites). */
  scale?: number;
  tint?: number;
  /** Hue rotation in degrees (WebGL color matrix), e.g. the green lizard turned into a red dragon. */
  hue?: number;
  /** Melee swoosh: drawn at the damage reach (px from the figure), over the damage arc (rad). */
  swing?: { reach: number; arc: number; color?: number };
  /** Tail swipe behind the figure (the dragon), shown for the Tail animation. */
  tail?: { reach: number; arc: number; color?: number };
  /** Where breath attacks come out (dragon mouth / nostrils), per body frame. */
  mouth?: FramePoints;
  nostrils?: FramePoints;
  label?: string;
}

/** Pixel points inside a frame (x, y from the frame's top-left), e.g. the dragon's mouth. */
export type FramePoints = Record<string, [number, number]>;

// Pack lizard (used as the dragon): the snout tip is column 15 and the top of
// the snout row moves with the bob. Measured per frame from the sprite sheet;
// the mouth line is 6 rows below the snout top, the nostril 2 rows below.
const LIZARD_SNOUT_TOP: Record<string, number> = {
  lizard_m_idle_anim_f0: 13,
  lizard_m_idle_anim_f1: 14,
  lizard_m_idle_anim_f2: 16,
  lizard_m_idle_anim_f3: 14,
  lizard_m_run_anim_f0: 13,
  lizard_m_run_anim_f1: 11,
  lizard_m_run_anim_f2: 13,
  lizard_m_run_anim_f3: 15,
  lizard_m_hit_anim_f0: 11,
};
const lizardPoints = (dy: number): FramePoints =>
  Object.fromEntries(Object.entries(LIZARD_SNOUT_TOP).map(([f, top]) => [f, [15.5, top + dy]]));

const hero = (n: string) => ({ idle: `${n}_idle_anim_f`, run: `${n}_run_anim_f`, hit: `${n}_hit_anim_f0` });
const mob = (n: string) => ({ idle: `${n}_idle_anim_f`, run: `${n}_run_anim_f` });
const necro = { idle: 'necromancer_anim_f', run: 'necromancer_anim_f' };
// Necromancer with a red robe, recolored at atlas build time (scripts/build-atlas.ts).
const summoner = { idle: 'summoner_anim_f', run: 'summoner_anim_f' };

export const FIGURES: Record<number, FigureDef> = {
  [KIND.Wizard]: { ...hero('wizzard_m'), weapon: 'weapon_red_magic_staff', mount: 'staff', handY: 10, attack: 'caster', base: 0x4a7aff, baseR: 6, label: 'Wizard' },
  [KIND.Paladin]: { ...hero('knight_m'), swing: SWORD, weapon: 'weapon_knight_sword', mount: 'blade', handY: 10, attack: 'melee', base: 0xe8c040, baseR: 6, label: 'Paladin' },
  [KIND.Barbarian]: { ...hero('dwarf_m'), swing: AXE, weapon: 'weapon_double_axe', mount: 'blade', handY: 9, attack: 'melee', base: 0xd03030, baseR: 6, label: 'Barbarian' },
  [KIND.Assassin]: { ...hero('elf_m'), weapon: 'weapon_bow', mount: 'bow', meleeWeapon: 'weapon_knife', weaponScale: 0.8, handY: 10, attack: 'ranged', base: 0x3aa060, baseR: 6, label: 'Assassin' },
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
  [KIND.Demon]: { ...mob('big_demon'), swing: { reach: 40, arc: 2.1, color: 0xffa080 }, handY: 18, attack: 'melee', base: 0x7a1010, baseR: 13 },
  [KIND.Lich]: { ...necro, weapon: 'weapon_green_magic_staff', mount: 'staff', handY: 8, attack: 'caster', base: 0x3a2a5a, baseR: 6, scale: 1.75, tint: 0xb8c8ff },
  [KIND.Dragon]: { ...hero('lizard_m'), mouth: lizardPoints(5.5), nostrils: lizardPoints(2.5), swing: { ...CLAW, reach: 40, color: 0xffc0a0 }, tail: { reach: 46, arc: 2.4, color: 0xffc0a0 }, handY: 10, attack: 'melee', base: 0x7a1010, baseR: 8, scale: 2.25, hue: 250 },
};

/** Projectiles: a pack sprite (arrows) or a runtime glow of the given color. */
export const PROJECTILES: Record<number, { frame?: string; scale: number; glow?: number; trail?: number }> = {
  [KIND.Missile]: { glow: 0xa080ff, scale: 0.8, trail: 0x9a7aff },
  [KIND.Fireball]: { glow: 0xff7020, scale: 1.4, trail: 0xffb040 },
  [KIND.Bolt]: { frame: 'weapon_arrow', scale: 0.6 },
  [KIND.Arrow]: { frame: 'weapon_arrow', scale: 0.6 },
  [KIND.ShadowBolt]: { glow: 0x40e060, scale: 1, trail: 0x205a20 },
  [KIND.FrostBolt]: { glow: 0x9ae0ff, scale: 1, trail: 0xe0f8ff },
  [KIND.FireOrb]: { glow: 0xff8030, scale: 0.9, trail: 0xff8030 },
  [KIND.FireBolt]: { glow: 0xff7020, scale: 0.7, trail: 0xffb040 },
  [KIND.DragonFireball]: { glow: 0xff5010, scale: 2, trail: 0xffb040 },
};

export function isPlayerKind(k: number): boolean {
  return k <= KIND.Assassin;
}
export function isProjectileKind(k: number): boolean {
  return k >= KIND.Missile && k < KIND.FirePatch;
}
export function isBossKind(k: number): boolean {
  return k === KIND.Demon || k === KIND.Lich || k === KIND.Dragon;
}
