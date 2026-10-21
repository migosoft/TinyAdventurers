import { EFFECT } from '../generated/defs';
import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { LevelId } from '../generated/LevelId';
import type { Modifiers } from '../generated/Modifiers';
import type { UpgradeStat } from '../generated/UpgradeStat';

export const CLASS_TEXT: Record<ClassId, { title: string; blurb: string; abilities: { name: string; text: string }[] }> = {
  Wizard: {
    title: 'Wizard',
    blurb: 'Fragile master of the arcane.',
    abilities: [
      { name: 'Magic Missile', text: 'Fast arcane bolts.' },
      { name: 'Fireball', text: 'Explodes at the cursor, hurting everything nearby.' },
    ],
  },
  Paladin: {
    title: 'Paladin',
    blurb: 'Armored holy warrior.',
    abilities: [
      { name: 'Sword', text: 'Sweeping melee strike.' },
      { name: 'Holy Light', text: 'Heals you and nearby allies.' },
    ],
  },
  Barbarian: {
    title: 'Barbarian',
    blurb: 'Toughest of them all.',
    abilities: [
      { name: 'Great Axe', text: 'Wide, heavy cleave.' },
      { name: 'Charge', text: 'Dash toward the cursor, hitting everything in the way.' },
    ],
  },
  ElvenRanger: {
    title: 'Elven Ranger',
    blurb: 'Keen-eyed elf of the deep woods, never alone.',
    abilities: [
      { name: 'Bow / Rapier', text: 'Shoots arrows; thrusts with the rapier automatically when an enemy is close.' },
      { name: 'Dire Wolf', text: 'Summons your dire wolf companion. While it lives, heals it for 20 %. If it falls, it can be summoned again after 60 s.' },
    ],
  },
};

/** The class as players read it ("Elven Ranger"); the wire value stays for CSS classes and keys. */
export const className = (c: ClassId): string => CLASS_TEXT[c].title;

export const BOSS_TEXT: Record<BossId, { name: string; short: string; blurb: string }> = {
  Demon: { name: 'Azgaroth, the Red Demon', short: 'Red Demon', blurb: 'Cleaves, charges across the hall and throws rings of fire.' },
  Lich: { name: 'Vael, the Undying Lich', short: 'Lich', blurb: 'Immune while its disciples live. Gloom bolts, skeleton hordes and a nova that hurls heroes away.' },
  Dragon: { name: 'Ignathrax, the Red Dragon', short: 'Red Dragon', blurb: 'Fire breath that burns the ground, bites, claws, tail whips and fireballs. Takes to the air, where blades cannot reach it, and lands with a ground smash.' },
};

export const LEVEL_TEXT: Record<LevelId, { name: string; victory: string; defeat: string }> = {
  Dungeon: { name: 'Dungeon', victory: 'The dungeon is cleared.', defeat: 'The dungeon claims another party.' },
};

/** Upgrade shop rows: label and the current bonus from the profile's modifiers. */
export const STAT_TEXT: Record<UpgradeStat, { name: string; bonus: (m: Modifiers) => string }> = {
  Damage: { name: 'Damage', bonus: (m) => `+${pct(m.damage - 1)} damage` },
  AttackSpeed: { name: 'Attack speed', bonus: (m) => `+${pct(m.attack_speed - 1)} attack speed` },
  MoveSpeed: { name: 'Move speed', bonus: (m) => `+${pct(m.move_speed - 1)} move speed` },
  Life: { name: 'Life', bonus: (m) => `+${pct(m.life - 1)} max life` },
  Armor: { name: 'Armor', bonus: (m) => `${pct(m.armor)} damage blocked` },
};

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** One ASCII letter per status effect (the HUD's pixel font has no symbol glyphs). */
/** One letter per effect; a new effect needs its glyph here (effectGlyph.test.ts checks). */
export const EFFECT_GLYPH: Record<number, string> = {
  [EFFECT.Blind]: 'B',
  [EFFECT.Sleep]: 'Z',
  [EFFECT.Petrified]: 'P',
  [EFFECT.Slowed]: 'S',
  [EFFECT.Accelerated]: 'A',
  [EFFECT.Burning]: 'F',
  [EFFECT.Frozen]: 'I',
  [EFFECT.Poisoned]: 'X',
  [EFFECT.Chilled]: 'C',
  [EFFECT.Singed]: 'G',
  [EFFECT.Tainted]: 'T',
};

export function effectGlyph(id: number): string {
  return EFFECT_GLYPH[id] ?? '?';
}
