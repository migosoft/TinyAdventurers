import { EFFECT } from '../generated/defs';
import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { LevelId } from '../generated/LevelId';

export const CLASS_TEXT: Record<ClassId, { title: string; blurb: string }> = {
  Wizard: {
    title: 'Wizard',
    blurb: 'Fragile master of the arcane.',
  },
  Paladin: {
    title: 'Paladin',
    blurb: 'Armored holy warrior.',
  },
  Barbarian: {
    title: 'Barbarian',
    blurb: 'Toughest of them all.',
  },
  ElvenRanger: {
    title: 'Elven Ranger',
    blurb: 'Keen-eyed elf of the deep woods, never alone.',
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
  [EFFECT.Entangled]: 'E',
  [EFFECT.Fear]: 'R',
  [EFFECT.Warded]: 'W',
  [EFFECT.Coated]: 'V',
};

export function effectGlyph(id: number): string {
  return EFFECT_GLYPH[id] ?? '?';
}
