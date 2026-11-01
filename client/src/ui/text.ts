import type { Attr } from '../generated/Attr';
import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { LevelId } from '../generated/LevelId';

export const ATTR_SHORT: Record<Attr, string> = { Str: 'STR', Dex: 'DEX', Con: 'CON', Int: 'INT', Wil: 'WIL', Cha: 'CHA' };

/** What a slot disabled by an Attribute drain reads: "Needs DEX 14". */
export const needsText = ([attr, n]: [Attr, number]): string => `Needs ${ATTR_SHORT[attr]} ${n}`;

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
  Lich: { name: 'Vael, the Undying Lich', short: 'Lich', blurb: 'Immune while its disciples live. Gloom Bolts, skeleton hordes and a Nova.' },
  Dragon: { name: 'Ignathrax, the Red Dragon', short: 'Red Dragon', blurb: 'Fire Breath that burns the ground, bites, claws, tail whips and Fireball. Takes to the air, where blades cannot reach it, and lands with a Smash.' },
};

export const LEVEL_TEXT: Record<LevelId, { name: string; victory: string; defeat: string }> = {
  Dungeon: { name: 'Dungeon', victory: 'The dungeon is cleared.', defeat: 'The dungeon claims another party.' },
};
