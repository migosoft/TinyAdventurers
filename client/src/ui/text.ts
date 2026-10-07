import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
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
  Assassin: {
    title: 'Assassin',
    blurb: 'Strikes from the shadows.',
    abilities: [
      { name: 'Crossbow / Dagger', text: 'Shoots bolts; stabs automatically when an enemy is close.' },
      { name: 'Hide', text: 'Vanish from enemy sight. Attacking from hiding deals x4 critical damage.' },
    ],
  },
};

export const BOSS_TEXT: Record<BossId, { name: string; short: string; blurb: string }> = {
  Demon: { name: 'Azgaroth, the Red Demon', short: 'Red Demon', blurb: 'Cleaves, swoops across the hall and throws rings of fire.' },
  Lich: { name: 'Vael, the Undying Lich', short: 'Lich', blurb: 'Immune while its disciples live. Frost bolts and skeletons.' },
  Dragon: { name: 'Ignathrax, the Red Dragon', short: 'Red Dragon', blurb: 'Fire breath that burns the ground, tail swipes, fireballs.' },
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
