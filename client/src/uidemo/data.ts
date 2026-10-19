// Throwaway spike for the progression design (docs/superpowers/specs/2026-10-18-progression-design.md):
// mock data for the ?uidemo screens. Pure data, no DOM, so the spec's tables can be printed from it
// (`cd client && npx tsx src/uidemo/spec-tables.ts`). The real data will live in the server's defs/.
import type { ClassId } from '../generated/ClassId';

export type Attr = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIL' | 'CHA';
export const ATTRS: Attr[] = ['STR', 'DEX', 'CON', 'INT', 'WIL', 'CHA'];
export type Attrs = Record<Attr, number>;

export const ATTR_TEXT: Record<Attr, { name: string; per: string }> = {
  STR: { name: 'Strength', per: 'Melee, thrown and natural damage ±5 %. Push power. Range and projectile speed of ranged weapons.' },
  DEX: { name: 'Dexterity', per: 'Finesse and ranged damage ±5 %. Melee arc ±3 %. Attack and firing speed ±2 %.' },
  CON: { name: 'Constitution', per: 'HP ±5. Move speed ±1 %. Save against non-magical effects.' },
  INT: { name: 'Intelligence', per: 'Spell damage and effect power ±5 %.' },
  WIL: { name: 'Willpower', per: 'Save against hostile magical effects (shorter, never less damage).' },
  CHA: { name: 'Charisma', per: 'Innate magic: damage, heals, effect power, auras ±5 %.' },
};

/** XP price weight per Attribute (one data table in defs/, see the spec). */
export const WEIGHT: Attrs = { STR: 1, DEX: 1.25, CON: 1, INT: 1, WIL: 0.8, CHA: 1 };

/** XP price of the next point when the Attribute is at `current`. */
export function attrPrice(a: Attr, current: number): number {
  return Math.round((100 + 25 * Math.max(0, current - 10)) * WEIGHT[a]);
}

export interface ClassStart {
  attrs: Attrs;
  baseHp: number;
  weight: number;
  speed: number;
  melee: string;
  ranged: string | null;
  primary: string;
  secondary: string;
  prof: string[];
}

export const CLASS_START: Record<ClassId, ClassStart> = {
  Wizard: { attrs: { STR: 8, DEX: 14, CON: 12, INT: 15, WIL: 13, CHA: 10 }, baseHp: 60, weight: 9, speed: 72, melee: 'red_staff', ranged: null, primary: 'magic_missile', secondary: 'fireball', prof: ['Staff', 'Dagger', 'Cloth'] },
  Paladin: { attrs: { STR: 15, DEX: 8, CON: 13, INT: 10, WIL: 12, CHA: 14 }, baseHp: 105, weight: 12, speed: 66, melee: 'knight_sword', ranged: null, primary: 'strike', secondary: 'holy_light', prof: ['Sword', 'Mace', 'Hammer', 'All armor'] },
  Barbarian: { attrs: { STR: 15, DEX: 13, CON: 14, INT: 8, WIL: 12, CHA: 10 }, baseHp: 120, weight: 13, speed: 70, melee: 'great_axe', ranged: null, primary: 'strike', secondary: 'charge', prof: ['Axe', 'Hammer', 'Club', 'Sword', 'Spear', 'Throwing axe', 'Light + medium armor'] },
  // DEX 13 from the class + 2 from the Elf race = 15.
  ElvenRanger: { attrs: { STR: 10, DEX: 15, CON: 12, INT: 8, WIL: 14, CHA: 13 }, baseHp: 80, weight: 10, speed: 80, melee: 'rapier', ranged: 'elven_bow', primary: 'shoot', secondary: 'summon_wolf', prof: ['Dagger', 'Duelling sword', 'Machete', 'Bow', 'Crossbow', 'Light armor'] },
};

export function hp(cls: ClassId, con: number): number {
  return CLASS_START[cls].baseHp + 5 * (con - 10);
}

// ------------------------------------------------------------ abilities

export type Category = 'WeaponAttack' | 'Technique' | 'Spell' | 'Innate';
export type Uses = 'melee' | 'ranged' | 'none';
/** Damage colours for the placeholder ability icons (no ability art yet). */
export type Tint = 'physical' | 'heat' | 'cold' | 'magical' | 'poison' | 'holy' | 'none';

export interface Req {
  attr?: Attr;
  min?: number;
  /** Weapon kinds, any of them (in the slot the ability uses). */
  weapon?: string[];
}

export interface Ability {
  id: string;
  name: string;
  /** Two letters for the placeholder icon. */
  mono: string;
  cls: ClassId;
  slot: 'primary' | 'secondary';
  category: Category;
  uses: Uses;
  /** Blocked in melee (projectile or aimed at a distant spot): switches to a strike. */
  ranged: boolean;
  req: Req[];
  tint: Tint;
  damage: string;
  stats: string;
  light: string;
  text: string;
  /** A class start ability (not a tree unlock). */
  start?: boolean;
}

const A = (a: Ability) => a;

export const ABILITIES: Ability[] = [
  // Wizard
  A({ id: 'magic_missile', name: 'Magic Missile', mono: 'MM', cls: 'Wizard', slot: 'primary', category: 'Spell', uses: 'none', ranged: true, req: [], tint: 'magical', damage: '12 magical', stats: 'cd 0.35 s, range 220, speed 230, radius 3', light: 'Magic (as today)', text: 'Fast arcane bolts.', start: true }),
  A({ id: 'fireball', name: 'Fireball', mono: 'FB', cls: 'Wizard', slot: 'secondary', category: 'Spell', uses: 'none', ranged: true, req: [], tint: 'heat', damage: '45: 70 % heat, 20 % magical, 10 % physical', stats: 'cd 6 s, range 260, speed 140, blast radius 38', light: 'Fire (as today)', text: 'Explodes at the cursor, hurting everything nearby.', start: true }),
  A({ id: 'frost_shard', name: 'Frost Shard', mono: 'FS', cls: 'Wizard', slot: 'primary', category: 'Spell', uses: 'none', ranged: true, req: [{ attr: 'INT', min: 14 }], tint: 'cold', damage: '10 cold', stats: 'cd 0.5 s, range 200, speed 200, radius 3; on hit: Slowed 2 s, 35 %', light: 'Magic, tint 0x78c8ff (the FrostBolt kind)', text: 'An icy shard that can slow its target.' }),
  A({ id: 'chain_spark', name: 'Chain Spark', mono: 'CS', cls: 'Wizard', slot: 'primary', category: 'Spell', uses: 'none', ranged: true, req: [{ attr: 'INT', min: 18 }], tint: 'magical', damage: '14 magical, ×0.7 per jump', stats: 'cd 0.8 s, range 180, speed 260; jumps to 2 more enemies within 48 px', light: 'Magic (as the Missile)', text: 'A spark that leaps from enemy to enemy.' }),
  A({ id: 'frost_nova', name: 'Frost Nova', mono: 'FN', cls: 'Wizard', slot: 'secondary', category: 'Spell', uses: 'none', ranged: false, req: [{ attr: 'INT', min: 17 }], tint: 'cold', damage: '22 cold', stats: 'cd 9 s, ring around you, radius 44; Slowed 3 s on every enemy hit', light: 'Magic, tint 0x78c8ff, 0.3 s flash', text: 'A ring of frost bursts from you and slows everything it touches.' }),
  A({ id: 'haste', name: 'Haste', mono: 'HA', cls: 'Wizard', slot: 'secondary', category: 'Spell', uses: 'none', ranged: false, req: [{ attr: 'INT', min: 15 }, { attr: 'WIL', min: 14 }], tint: 'none', damage: '–', stats: 'cd 14 s; you and allies within 64 px: Accelerated 4 s', light: 'none', text: 'You and nearby allies move faster for a while.' }),
  // Paladin
  A({ id: 'strike', name: 'Strike', mono: 'ST', cls: 'Paladin', slot: 'primary', category: 'WeaponAttack', uses: 'melee', ranged: false, req: [], tint: 'physical', damage: 'the weapon', stats: 'the weapon: damage, speed, arc, push, split, effects', light: 'the weapon', text: 'A sweeping blow with your melee weapon.', start: true }),
  A({ id: 'holy_light', name: 'Holy Light', mono: 'HL', cls: 'Paladin', slot: 'secondary', category: 'Innate', uses: 'none', ranged: false, req: [], tint: 'holy', damage: 'heal 35', stats: 'cd 10 s, radius 64 around you', light: 'Holy (as today)', text: 'Heals you and nearby allies.', start: true }),
  A({ id: 'judgement', name: 'Judgement', mono: 'JU', cls: 'Paladin', slot: 'primary', category: 'Innate', uses: 'none', ranged: true, req: [{ attr: 'CHA', min: 16 }], tint: 'holy', damage: '18 magical', stats: 'cd 0.9 s, range 150, speed 220, radius 3', light: 'Holy', text: 'A bolt of holy light. In melee you strike with your weapon instead.' }),
  A({ id: 'smite', name: 'Smite', mono: 'SM', cls: 'Paladin', slot: 'primary', category: 'WeaponAttack', uses: 'melee', ranged: false, req: [{ attr: 'CHA', min: 15 }, { weapon: ['Sword', 'Mace', 'Hammer'] }], tint: 'holy', damage: 'weapon ×1.4, +30 % magical share', stats: 'the weapon, attack time ×1.6', light: 'Holy, 0.3 s flash on hit', text: 'A slow, holy blow.' }),
  A({ id: 'consecrate', name: 'Consecrate', mono: 'CO', cls: 'Paladin', slot: 'secondary', category: 'Innate', uses: 'none', ranged: false, req: [{ attr: 'CHA', min: 15 }], tint: 'holy', damage: '8 magical every 0.5 s', stats: 'cd 12 s; ground circle at your feet, radius 40, 5 s', light: 'Holy, while it lasts', text: 'Blesses the ground: enemies standing on it burn with holy light.' }),
  A({ id: 'purify', name: 'Purify', mono: 'PU', cls: 'Paladin', slot: 'secondary', category: 'Innate', uses: 'none', ranged: false, req: [{ attr: 'WIL', min: 14 }], tint: 'holy', damage: '–', stats: 'cd 15 s; you and allies within 64 px: negative effects removed, resist hostile magical effects 100 % 3 s', light: 'Holy, 0.3 s flash', text: 'Cleanses you and nearby allies and shields them from curses.' }),
  // Barbarian
  A({ id: 'charge', name: 'Charge', mono: 'CH', cls: 'Barbarian', slot: 'secondary', category: 'Technique', uses: 'melee', ranged: false, req: [], tint: 'physical', damage: 'weapon ×0.8', stats: 'cd 5 s, dash 0.18 s at 300 px/s, radius 10', light: 'the weapon', text: 'Dash toward the cursor, hitting everything in the way.', start: true }),
  A({ id: 'whirl', name: 'Whirl', mono: 'WH', cls: 'Barbarian', slot: 'primary', category: 'Technique', uses: 'melee', ranged: false, req: [{ attr: 'DEX', min: 14 }], tint: 'physical', damage: 'weapon ×0.75', stats: 'full circle (arc 2π), attack time ×1.3', light: 'the weapon', text: 'Spin with your weapon, hitting everything around you.' }),
  A({ id: 'hurl', name: 'Hurl', mono: 'HU', cls: 'Barbarian', slot: 'primary', category: 'WeaponAttack', uses: 'ranged', ranged: true, req: [{ weapon: ['Throwing axe'] }], tint: 'physical', damage: 'the throwing axe', stats: 'the throwing axe (thrown: STR)', light: 'the weapon', text: 'Throw axes. In melee you strike with your melee weapon instead.' }),
  A({ id: 'war_cry', name: 'War Cry', mono: 'WC', cls: 'Barbarian', slot: 'secondary', category: 'Technique', uses: 'none', ranged: false, req: [{ attr: 'STR', min: 16 }], tint: 'none', damage: '–', stats: 'cd 12 s, radius 56: enemies Slowed 3 s (power STR, save CON), allies Accelerated 3 s', light: 'none', text: 'A roar that slows enemies and spurs allies on.' }),
  A({ id: 'ground_slam', name: 'Ground Slam', mono: 'GS', cls: 'Barbarian', slot: 'secondary', category: 'Technique', uses: 'melee', ranged: false, req: [{ attr: 'STR', min: 17 }, { weapon: ['Hammer', 'Club'] }], tint: 'physical', damage: 'weapon ×1.2', stats: 'cd 6 s, wind-up 0.5 s, radius 34 around you, pushes (STR)', light: 'the weapon', text: 'Slam the ground with a hammer or club, hitting and pushing everything around you.' }),
  // Elven Ranger
  A({ id: 'shoot', name: 'Shoot', mono: 'SH', cls: 'ElvenRanger', slot: 'primary', category: 'WeaponAttack', uses: 'ranged', ranged: true, req: [], tint: 'physical', damage: 'the ranged weapon', stats: 'the ranged weapon; thrusts with the melee weapon in melee', light: 'the weapon', text: 'Shoot your bow. In melee you thrust with your rapier instead.', start: true }),
  A({ id: 'summon_wolf', name: 'Summon Wolf', mono: 'SW', cls: 'ElvenRanger', slot: 'secondary', category: 'Innate', uses: 'none', ranged: false, req: [], tint: 'none', damage: 'heal 20 % (wolf alive)', stats: 'cd 8 s; 60 s after the wolf dies; the wolf: 80 HP, bite 10, dash 20', light: 'none', text: 'Call your Dire Wolf to your side, or heal it if it is already with you.', start: true }),
  A({ id: 'volley', name: 'Volley', mono: 'VO', cls: 'ElvenRanger', slot: 'primary', category: 'WeaponAttack', uses: 'ranged', ranged: true, req: [{ attr: 'DEX', min: 15 }, { weapon: ['Bow', 'Longbow'] }], tint: 'physical', damage: 'weapon ×0.6 per arrow', stats: '3 arrows in a 30° spread, attack time ×1.4', light: 'the weapon', text: 'Loose three arrows at once.' }),
  A({ id: 'flanking_thrust', name: 'Flanking Thrust', mono: 'FT', cls: 'ElvenRanger', slot: 'primary', category: 'WeaponAttack', uses: 'melee', ranged: false, req: [{ attr: 'DEX', min: 16 }, { weapon: ['Dagger', 'Duelling sword', 'Katana', 'Machete'] }], tint: 'physical', damage: 'weapon; ×2 from behind', stats: 'the finesse weapon; "behind" = within 60° of the target\'s back', light: 'the weapon', text: 'Quick thrusts that hit twice as hard from behind, while the enemy faces your wolf.' }),
  A({ id: 'entangle', name: 'Entangle', mono: 'EN', cls: 'ElvenRanger', slot: 'secondary', category: 'Innate', uses: 'none', ranged: true, req: [{ attr: 'CHA', min: 14 }], tint: 'none', damage: '–', stats: 'cd 14 s; roots at a spot within 120 px, radius 36, 4 s: enemies inside Slowed (power CHA, save WIL)', light: 'none', text: 'Roots burst from the ground and hold enemies back.' }),
  A({ id: 'poison_coat', name: 'Poison Coat', mono: 'PC', cls: 'ElvenRanger', slot: 'secondary', category: 'Technique', uses: 'none', ranged: false, req: [{ attr: 'WIL', min: 15 }], tint: 'poison', damage: '+30 % poison share', stats: 'cd 16 s; 6 s: your weapon attacks add a poison share and Poisoned 3 s on hit', light: 'none', text: 'Coat your arrows and blade in poison for a while.' }),
];

export const ABILITY: Record<string, Ability> = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));
/** Strike is shared: the Barbarian starts with it too. */
export const START_POOL: Record<ClassId, string[]> = {
  Wizard: ['magic_missile', 'fireball'],
  Paladin: ['strike', 'holy_light'],
  Barbarian: ['strike', 'charge'],
  ElvenRanger: ['shoot', 'summon_wolf'],
};

// ------------------------------------------------------------ skill trees

export type NodeKind = 'start' | 'attr' | 'unlock' | 'improve' | 'prof' | 'resist' | 'keystone';

export interface TreeNode {
  id: string;
  kind: NodeKind;
  /** Grid position; the start is at 0,0. */
  x: number;
  y: number;
  name: string;
  effect: string;
  cost: number;
  req: Req[];
  links: string[];
  /** Ability unlocked or improved. */
  ability?: string;
  attr?: Attr;
  /** Weapon frame for proficiency icons. */
  icon?: string;
}

const N = (id: string, kind: NodeKind, x: number, y: number, name: string, effect: string, cost: number, links: string[], extra: Partial<TreeNode> = {}): TreeNode => ({ id, kind, x, y, name, effect, cost, links, req: [], ...extra });
const plus = (id: string, attr: Attr, x: number, y: number, cost: number, links: string[]) => N(id, 'attr', x, y, `+1 ${attr}`, `+1 ${attr}`, cost, links, { attr });
const r = (attr: Attr, min: number): Req[] => [{ attr, min }];

export const TREES: Record<ClassId, TreeNode[]> = {
  Wizard: [
    N('w0', 'start', 0, 0, 'Wizard', 'Where the tree starts. Always owned.', 0, ['w_a1', 'w_f1', 'w_r1', 'w_b1']),
    // Arcane (up)
    plus('w_a1', 'INT', 0, -1, 200, ['w_a2']),
    N('w_a2', 'improve', 0, -2, 'Piercing Missiles', 'Magic Missile: pierces 1 enemy (overkill rule, like arrows).', 300, ['w_a3', 'w_a4'], { ability: 'magic_missile', req: r('INT', 15) }),
    N('w_a3', 'unlock', -1, -3, 'Chain Spark', 'Unlocks Chain Spark (primary).', 600, ['w_a5'], { ability: 'chain_spark', req: r('INT', 18) }),
    plus('w_a4', 'INT', 1, -3, 300, ['w_a5']),
    N('w_a5', 'keystone', 0, -4, 'Arcane Overflow', 'Spell damage +15 %; spell cooldowns +10 %.', 1200, [], { req: r('INT', 18) }),
    // Frost (left)
    N('w_f1', 'unlock', -1, 0, 'Frost Shard', 'Unlocks Frost Shard (primary).', 400, ['w_f2', 'w_f3'], { ability: 'frost_shard', req: r('INT', 14) }),
    N('w_f2', 'improve', -2, -1, 'Biting Cold', 'Frost Shard: Slowed chance 35 % → 100 %.', 350, ['w_f4'], { ability: 'frost_shard' }),
    N('w_f3', 'resist', -2, 1, 'Cold Blood', '+20 % cold resistance.', 250, ['w_f4']),
    N('w_f4', 'unlock', -3, 0, 'Frost Nova', 'Unlocks Frost Nova (secondary).', 700, ['w_f5'], { ability: 'frost_nova', req: r('INT', 17) }),
    N('w_f5', 'improve', -4, 0, 'Wide Nova', 'Frost Nova: radius +25 %.', 400, ['w_f6'], { ability: 'frost_nova' }),
    N('w_f6', 'keystone', -5, 0, 'Deep Winter', 'Slowed enemies take +20 % cold damage from you.', 1200, [], { req: r('INT', 17) }),
    // Fire (right)
    N('w_r1', 'improve', 1, 0, 'Bigger Bang', 'Fireball: blast radius +20 %.', 350, ['w_r2', 'w_r3'], { ability: 'fireball' }),
    N('w_r2', 'resist', 2, -1, 'Ember Skin', '+20 % heat resistance.', 250, ['w_r4']),
    N('w_r3', 'improve', 2, 1, 'Scorched Earth', 'Fireball: the blast sets Burning (3 s) on everything it hits.', 500, ['w_r4'], { ability: 'fireball', req: r('INT', 16) }),
    plus('w_r4', 'INT', 3, 0, 300, ['w_r5']),
    N('w_r5', 'keystone', 4, 0, 'Pyromancer', '+20 % heat damage, −20 % cold damage.', 1200, [], { req: r('INT', 17) }),
    // Body (down)
    plus('w_b1', 'CON', 0, 1, 200, ['w_b2', 'w_b3']),
    plus('w_b2', 'WIL', -1, 2, 160, ['w_b4']),
    N('w_b3', 'prof', 1, 2, 'Light Armor', 'Proficiency: light armor.', 300, ['w_b4'], { icon: 'L' }),
    N('w_b4', 'unlock', 0, 3, 'Haste', 'Unlocks Haste (secondary).', 600, ['w_b5', 'w_b6'], { ability: 'haste', req: [{ attr: 'INT', min: 15 }, { attr: 'WIL', min: 14 }] }),
    N('w_b5', 'improve', -1, 4, 'Lasting Haste', 'Haste: +2 s.', 350, [], { ability: 'haste' }),
    plus('w_b6', 'DEX', 1, 4, 250, []),
  ],
  Paladin: [
    N('p0', 'start', 0, 0, 'Paladin', 'Where the tree starts. Always owned.', 0, ['p_u1', 'p_l1', 'p_r1', 'p_d1']),
    // Faith (up)
    plus('p_u1', 'CHA', 0, -1, 200, ['p_u2']),
    N('p_u2', 'improve', 0, -2, 'Greater Light', 'Holy Light: heal +25 %.', 350, ['p_u3', 'p_u4'], { ability: 'holy_light' }),
    N('p_u3', 'unlock', -1, -3, 'Judgement', 'Unlocks Judgement (primary).', 600, ['p_u5'], { ability: 'judgement', req: r('CHA', 16) }),
    plus('p_u4', 'CHA', 1, -3, 300, ['p_u5']),
    N('p_u5', 'keystone', 0, -4, 'Radiant', 'Your innate abilities deal +20 % damage to Undead and Demons; you shed light 2 tiles.', 1200, [], { req: r('CHA', 17) }),
    // Oath (left)
    N('p_l1', 'unlock', -1, 0, 'Purify', 'Unlocks Purify (secondary).', 500, ['p_l2', 'p_l3'], { ability: 'purify', req: r('WIL', 14) }),
    plus('p_l2', 'WIL', -2, -1, 160, ['p_l4']),
    N('p_l3', 'resist', -2, 1, 'Warded', '+20 % magical resistance.', 300, ['p_l4']),
    N('p_l4', 'improve', -3, 0, 'Lasting Ward', 'Purify: ward 3 s → 5 s.', 400, ['p_l5'], { ability: 'purify' }),
    N('p_l5', 'keystone', -4, 0, 'Unshaken', 'Sleep resistance 100 %.', 1000, [], { req: r('WIL', 16) }),
    // Steel (right)
    N('p_r1', 'improve', 1, 0, 'Honed Edge', 'Strike: +10 % damage.', 300, ['p_r2', 'p_r3'], { ability: 'strike' }),
    plus('p_r2', 'STR', 2, -1, 250, ['p_r4']),
    N('p_r3', 'unlock', 2, 1, 'Smite', 'Unlocks Smite (primary).', 500, ['p_r4'], { ability: 'smite', req: r('CHA', 15) }),
    N('p_r4', 'unlock', 3, 0, 'Consecrate', 'Unlocks Consecrate (secondary).', 700, ['p_r5'], { ability: 'consecrate', req: r('CHA', 15) }),
    N('p_r5', 'keystone', 4, 0, 'Bulwark', 'Armor weighs half for you; +10 % physical resistance.', 1200, [], { req: r('STR', 16) }),
    // Body (down)
    plus('p_d1', 'CON', 0, 1, 200, ['p_d2', 'p_d3']),
    N('p_d2', 'resist', -1, 2, 'Steadfast', '+10 % physical resistance.', 350, ['p_d4']),
    N('p_d3', 'prof', 1, 2, 'Spear', 'Proficiency: spear.', 250, ['p_d4'], { icon: 'weapon_spear' }),
    plus('p_d4', 'CON', 0, 3, 300, []),
  ],
  Barbarian: [
    N('b0', 'start', 0, 0, 'Barbarian', 'Where the tree starts. Always owned.', 0, ['b_u1', 'b_l1', 'b_r1', 'b_d1']),
    // Fury (up)
    plus('b_u1', 'STR', 0, -1, 250, ['b_u2']),
    N('b_u2', 'improve', 0, -2, 'Wide Swings', 'Strike: arc +15 %.', 300, ['b_u3', 'b_u4'], { ability: 'strike' }),
    N('b_u3', 'unlock', -1, -3, 'Whirl', 'Unlocks Whirl (primary).', 600, ['b_u5'], { ability: 'whirl', req: r('DEX', 14) }),
    plus('b_u4', 'STR', 1, -3, 300, ['b_u5']),
    N('b_u5', 'keystone', 0, -4, 'Berserker', 'Below 50 % HP: +25 % damage and attack speed; −10 % to every resistance.', 1200, [], { req: r('STR', 17) }),
    // Warlord (left)
    N('b_l1', 'unlock', -1, 0, 'War Cry', 'Unlocks War Cry (secondary).', 500, ['b_l2', 'b_l3'], { ability: 'war_cry', req: r('STR', 16) }),
    N('b_l2', 'improve', -2, -1, 'Thunderous', 'War Cry: radius +30 %.', 350, ['b_l4'], { ability: 'war_cry' }),
    plus('b_l3', 'CHA', -2, 1, 200, ['b_l4']),
    N('b_l4', 'improve', -3, 0, 'Bowling Charge', 'Charge: carries +4 STR for pushes.', 400, ['b_l5'], { ability: 'charge' }),
    N('b_l5', 'keystone', -4, 0, 'Juggernaut', '+4 weight; Slowed resistance 100 %.', 1000, [], { req: r('CON', 16) }),
    // Weapons (right)
    N('b_r1', 'prof', 1, 0, 'Heavy Armor', 'Proficiency: heavy armor.', 300, ['b_r2', 'b_r3'], { icon: 'H' }),
    N('b_r2', 'unlock', 2, -1, 'Hurl', 'Unlocks Hurl (primary).', 500, ['b_r4'], { ability: 'hurl', req: r('DEX', 13) }),
    N('b_r3', 'prof', 2, 1, 'Mace', 'Proficiency: mace.', 200, ['b_r4'], { icon: 'weapon_mace' }),
    N('b_r4', 'unlock', 3, 0, 'Ground Slam', 'Unlocks Ground Slam (secondary).', 700, ['b_r5'], { ability: 'ground_slam', req: r('STR', 17) }),
    N('b_r5', 'improve', 4, 0, 'Aftershock', 'Ground Slam: radius +20 %.', 400, [], { ability: 'ground_slam' }),
    // Body (down)
    plus('b_d1', 'CON', 0, 1, 200, ['b_d2', 'b_d3']),
    N('b_d2', 'resist', -1, 2, 'Thick Hide', '+10 % physical resistance.', 300, ['b_d4']),
    N('b_d3', 'resist', 1, 2, 'Iron Gut', '+20 % poison resistance.', 200, ['b_d4']),
    plus('b_d4', 'CON', 0, 3, 300, ['b_d5']),
    N('b_d5', 'keystone', 0, 4, 'Unbreakable', 'Your CON counts +4 for every save.', 1000, [], { req: r('CON', 16) }),
  ],
  ElvenRanger: [
    N('e0', 'start', 0, 0, 'Elven Ranger', 'Where the tree starts. Always owned.', 0, ['e_u1', 'e_l1', 'e_r1', 'e_d1']),
    // Wild (up): the wolf and nature magic
    N('e_u1', 'improve', 0, -1, 'Thick Fur', 'Summon Wolf: the wolf has +25 % HP.', 300, ['e_u2'], { ability: 'summon_wolf' }),
    plus('e_u2', 'CHA', 0, -2, 200, ['e_u3', 'e_u4']),
    N('e_u3', 'unlock', -1, -3, 'Entangle', 'Unlocks Entangle (secondary).', 600, ['e_u5'], { ability: 'entangle', req: r('CHA', 14) }),
    N('e_u4', 'improve', 1, -3, 'Swift Pounce', "Summon Wolf: the wolf's dash cooldown −2 s.", 400, ['e_u5'], { ability: 'summon_wolf' }),
    N('e_u5', 'keystone', 0, -4, 'Pack Hunter', 'Enemies your wolf bit in the last 2 s take +20 % damage from you.', 1000, [], { req: r('WIL', 16) }),
    // Marksman (left)
    plus('e_l1', 'DEX', -1, 0, 250, ['e_l2', 'e_l3']),
    N('e_l2', 'improve', -2, -1, 'Long Shot', 'Shoot: range +15 %.', 350, ['e_l4'], { ability: 'shoot' }),
    N('e_l3', 'prof', -2, 1, 'Longbow', 'Proficiency: longbow.', 250, ['e_l4'], { icon: 'weapon_bow_2' }),
    N('e_l4', 'unlock', -3, 0, 'Volley', 'Unlocks Volley (primary).', 600, ['e_l5'], { ability: 'volley', req: r('DEX', 15) }),
    N('e_l5', 'keystone', -4, 0, 'Deadeye', 'Ranged hits on Slowed or sleeping enemies deal ×2.', 1200, [], { req: r('DEX', 18) }),
    // Blade (right)
    N('e_r1', 'unlock', 1, 0, 'Flanking Thrust', 'Unlocks Flanking Thrust (primary).', 500, ['e_r2', 'e_r3'], { ability: 'flanking_thrust', req: r('DEX', 16) }),
    N('e_r2', 'improve', 2, -1, 'Find the Gap', 'Flanking Thrust: "behind" widens to 90°.', 350, ['e_r4'], { ability: 'flanking_thrust' }),
    N('e_r3', 'prof', 2, 1, 'Katana', 'Proficiency: katana.', 250, ['e_r4'], { icon: 'weapon_katana' }),
    plus('e_r4', 'DEX', 3, 0, 350, []),
    // Venom (down)
    N('e_d1', 'unlock', 0, 1, 'Poison Coat', 'Unlocks Poison Coat (secondary).', 500, ['e_d2', 'e_d3'], { ability: 'poison_coat', req: r('WIL', 15) }),
    N('e_d2', 'improve', -1, 2, 'Lingering Venom', 'Poison Coat: +3 s.', 300, ['e_d4'], { ability: 'poison_coat' }),
    N('e_d3', 'resist', 1, 2, 'Forest Blood', '+20 % poison resistance.', 200, ['e_d4']),
    N('e_d4', 'keystone', 0, 3, 'Venomancer', 'Poisoned enemies take +15 % damage from you.', 1000, [], { req: r('WIL', 16) }),
  ],
};

// ------------------------------------------------------------ items

export type ItemSlot = 'melee' | 'ranged' | 'armor' | 'ring' | 'shoes' | 'belt' | 'offhand';

export interface ItemProp {
  text: string;
  magical: boolean;
}

export interface Item {
  id: string;
  name: string;
  slot: ItemSlot;
  /** Atlas frame, or letters for slots without art. */
  icon: string;
  kind: string;
  base: string;
  props: ItemProp[];
  req: Req[];
  /** Mock state for the screens: not proficient. */
  noProf?: boolean;
}

export const ITEMS: Record<string, Item> = {
  red_staff: { id: 'red_staff', name: 'Red Staff', slot: 'melee', icon: 'weapon_red_magic_staff', kind: 'Staff (melee, STR)', base: 'damage 6 · speed 1.0/s · arc 1.6 · push 0', props: [], req: [] },
  ember_staff: { id: 'ember_staff', name: 'Ember Staff', slot: 'melee', icon: 'weapon_red_magic_staff', kind: 'Staff (melee, STR)', base: 'damage 6 · speed 1.0/s · arc 1.6 · push 0', props: [{ text: '+25 % heat share (flaming)', magical: true }, { text: 'Light: orange, 2 tiles', magical: true }], req: [] },
  knight_sword: { id: 'knight_sword', name: 'Knight Sword', slot: 'melee', icon: 'weapon_knight_sword', kind: 'Sword (melee, STR)', base: 'damage 20 · as today', props: [], req: [] },
  great_axe: { id: 'great_axe', name: 'Great Axe', slot: 'melee', icon: 'weapon_double_axe', kind: 'Axe (melee, STR)', base: 'damage 32 · as today', props: [], req: [] },
  rapier: { id: 'rapier', name: 'Rapier', slot: 'melee', icon: 'weapon_duel_sword', kind: 'Duelling sword (finesse, DEX)', base: 'damage 18 · as today', props: [], req: [] },
  elven_bow: { id: 'elven_bow', name: 'Elven Bow', slot: 'ranged', icon: 'weapon_bow', kind: 'Bow (ranged, DEX)', base: 'damage 16 · as today', props: [], req: [] },
  silk_robe: { id: 'silk_robe', name: 'Silk Robe', slot: 'armor', icon: 'Ar', kind: 'Cloth armor', base: '+5 % physical resistance · weight +1', props: [{ text: '+10 % magical resistance', magical: true }], req: [] },
  ring_embers: { id: 'ring_embers', name: 'Ring of Embers', slot: 'ring', icon: 'o', kind: 'Ring', base: '–', props: [{ text: '+15 % heat resistance', magical: true }], req: [] },
  band_vigor: { id: 'band_vigor', name: 'Band of Vigor', slot: 'ring', icon: 'o', kind: 'Ring', base: '–', props: [{ text: '+1 CON', magical: true }], req: [] },
  soft_boots: { id: 'soft_boots', name: 'Boots of Haste', slot: 'shoes', icon: 'Sh', kind: 'Shoes', base: '–', props: [{ text: '+5 % move speed', magical: true }], req: [] },
  ring_insight: { id: 'ring_insight', name: 'Ring of Insight', slot: 'ring', icon: 'o', kind: 'Ring', base: '–', props: [{ text: '+1 INT', magical: true }], req: [] },
  rot_staff: { id: 'rot_staff', name: 'Staff of Rot', slot: 'melee', icon: 'weapon_green_magic_staff', kind: 'Staff (melee, STR)', base: 'damage 6 · speed 1.0/s · arc 1.6', props: [{ text: '+30 % poison share', magical: false }, { text: 'On hit: Poisoned 3 s, 15 %', magical: false }], req: [{ attr: 'INT', min: 14 }] },
  dagger: { id: 'dagger', name: 'Knife', slot: 'melee', icon: 'weapon_knife', kind: 'Dagger (finesse, DEX)', base: 'damage 14 · speed 2.2/s · arc 1.2', props: [], req: [] },
  lich_staff: { id: 'lich_staff', name: 'Bone Staff', slot: 'melee', icon: 'weapon_lich_staff', kind: 'Staff (melee, STR)', base: 'damage 7 · speed 1.0/s · arc 1.6', props: [{ text: 'Your spells: +10 % damage', magical: true }, { text: 'Light: green, 1 tile', magical: true }], req: [{ attr: 'INT', min: 18 }] },
  golden_sword: { id: 'golden_sword', name: 'Golden Sword', slot: 'melee', icon: 'weapon_golden_sword', kind: 'Sword (melee, STR)', base: 'damage 22 · speed 2.0/s · arc 1.8', props: [{ text: 'Light: gold, 1 tile', magical: true }], req: [], noProf: true },
  bow: { id: 'bow', name: 'Short Bow', slot: 'ranged', icon: 'weapon_bow', kind: 'Bow (ranged, DEX)', base: 'damage 12 · 1.3/s · range 220', props: [], req: [], noProf: true },
  leather_belt: { id: 'leather_belt', name: 'Girdle of Warding', slot: 'belt', icon: 'Be', kind: 'Belt', base: '–', props: [{ text: 'Blind resistance 100 %', magical: true }, { text: 'Aura 48 px: allies +10 max HP', magical: true }], req: [] },
};

// ------------------------------------------------------------ the mock character (a Wizard)

export interface MockChar {
  name: string;
  cls: ClassId;
  xp: number;
  totalXp: number;
  coins: number;
  /** Bought in the Attribute shop. */
  bought: Partial<Attrs>;
  nodes: string[];
  equip: Partial<Record<'melee' | 'ranged' | 'armor' | 'ring1' | 'ring2' | 'shoes' | 'belt' | 'offhand', string>>;
  bag: string[];
  primary: string;
  secondary: string;
}

/** Frost Nova was unlocked at INT 17 while the Ring of Insight was worn; the ring is in the
 * bag now, so the Loadout tab shows Frost Nova red (INT 16 of 17). */
export const MERLIN: MockChar = {
  name: 'Merlin',
  cls: 'Wizard',
  xp: 840,
  totalXp: 3490,
  coins: 137,
  bought: { CON: 1 },
  nodes: ['w0', 'w_a1', 'w_a2', 'w_f1', 'w_f2', 'w_f4', 'w_b1', 'w_r1'],
  equip: { melee: 'ember_staff', armor: 'silk_robe', ring1: 'ring_embers', ring2: 'band_vigor', shoes: 'soft_boots' },
  bag: ['ring_insight', 'rot_staff', 'dagger', 'lich_staff', 'golden_sword', 'bow', 'leather_belt'],
  primary: 'frost_shard',
  secondary: 'frost_nova',
};

export const BRUNHILD: MockChar = {
  name: 'Brunhild',
  cls: 'Barbarian',
  xp: 410,
  totalXp: 2210,
  coins: 64,
  bought: {},
  nodes: ['b0', 'b_u1', 'b_u2', 'b_d1', 'b_r1'],
  equip: { melee: 'great_axe' },
  bag: [],
  primary: 'strike',
  secondary: 'charge',
};

export const SHADE: MockChar = {
  name: 'Shade',
  cls: 'ElvenRanger',
  xp: 95,
  totalXp: 610,
  coins: 12,
  bought: {},
  nodes: ['e0', 'e_u1', 'e_l1'],
  equip: { melee: 'rapier', ranged: 'elven_bow' },
  bag: [],
  primary: 'shoot',
  secondary: 'summon_wolf',
};

/** Attribute total and its sources: class, shop, tree, items. */
export function attrSources(c: MockChar, a: Attr): { cls: number; shop: number; tree: number; items: number; total: number } {
  const cls = CLASS_START[c.cls].attrs[a];
  const shop = c.bought[a] ?? 0;
  const tree = TREES[c.cls].filter((n) => c.nodes.includes(n.id) && n.attr === a).length;
  const items = Object.values(c.equip).filter((id) => ITEMS[id!]?.props.some((p) => p.text === `+1 ${a}`)).length;
  return { cls, shop, tree, items, total: cls + shop + tree + items };
}

export function reqMet(c: MockChar, q: Req): boolean {
  if (q.attr) return attrSources(c, q.attr).total >= q.min!;
  return true;
}

export function reqText(q: Req): string {
  return q.attr ? `${q.attr} ${q.min}` : `${q.weapon!.join(' or ')}`;
}

/** XP spent: shop points plus tree nodes. */
export function xpSpent(c: MockChar): number {
  let sum = 0;
  for (const a of ATTRS) {
    const start = CLASS_START[c.cls].attrs[a];
    for (let i = 0; i < (c.bought[a] ?? 0); i++) sum += attrPrice(a, start + i);
  }
  for (const n of TREES[c.cls]) if (c.nodes.includes(n.id)) sum += n.cost;
  return sum;
}

/** Respec price in coins (my call): 20 + 1 per 50 XP spent. */
export function respecPrice(c: MockChar): number {
  return 20 + Math.floor(xpSpent(c) / 50);
}
