import { describe, expect, test } from 'vitest';
import type { PoolCard } from '../../generated/PoolCard';
import type { ResolvedAbility } from '../../generated/ResolvedAbility';
import { fixtureInfo } from './fixture';
import { abilityNumbers, fitsSlot, itemProblem, monogram, nodeState, pickLabel, poolFor, samePick, slotForItem, unmetRequirements, blockReason } from './model';

describe('nodeState', () => {
  test('the start node is owned, its neighbours buyable with XP', () => {
    const info = fixtureInfo('Wizard', { xp: 1000 });
    expect(nodeState(info, 'W0')).toBe('owned');
    expect(nodeState(info, 'WA1')).toBe('buyable');
    expect(nodeState(info, 'WA2')).toBe('locked');
  });
  test('a requirement or XP shortfall blocks', () => {
    const info = fixtureInfo('Wizard', { xp: 50, nodes: ['WA1', 'WA2'] });
    expect(nodeState(info, 'WA3')).toBe('blocked'); // INT 18, and XP
    expect(blockReason(info, 'WA3')).toBe('needs INT 18');
  });
});

describe('unmetRequirements', () => {
  test('reports an unmet Attribute requirement with what the hero has', () => {
    expect(unmetRequirements(fixtureInfo('Wizard'), ['INT 18'], true)).toEqual([{ text: 'INT 18', have: 15 }]);
  });
  test('withItems decides whether item points count', () => {
    const info = fixtureInfo('Wizard', { attrs: { Int: { total: 16, items: 1 } } });
    expect(unmetRequirements(info, ['INT 16'], false)).toEqual([{ text: 'INT 16', have: 15 }]);
    expect(unmetRequirements(info, ['INT 16'], true)).toEqual([]);
    expect(unmetRequirements(info, ['INT 18'], true)).toEqual([{ text: 'INT 18', have: 16 }]);
  });
  test('non-Attribute requirements are never reported', () => {
    expect(unmetRequirements(fixtureInfo('Wizard'), ['a weapon of kind Dagger or Sword'], true)).toEqual([]);
  });
});

describe('slotForItem', () => {
  test('a ring goes to the first empty ring slot, else Ring1', () => {
    expect(slotForItem(fixtureInfo('Wizard'), 'BandOfVigor')).toBe('Ring1');
    expect(slotForItem(fixtureInfo('Wizard', { slots: { Ring1: 'BandOfVigor' } }), 'BandOfVigor')).toBe('Ring2');
    expect(slotForItem(fixtureInfo('Wizard', { slots: { Ring1: 'BandOfVigor', Ring2: 'BandOfVigor' } }), 'BandOfVigor')).toBe('Ring1');
  });
  test('other items go to their own slot', () => {
    expect(slotForItem(fixtureInfo('Wizard'), 'ChainMail')).toBe('Armor');
  });
  test('fitsSlot maps Ring to both ring slots', () => {
    expect(fitsSlot('BandOfVigor', 'Ring2')).toBe(true);
    expect(fitsSlot('BandOfVigor', 'Armor')).toBe(false);
  });
});

describe('itemProblem', () => {
  test('a usable item has none', () => {
    expect(itemProblem(fixtureInfo('Wizard'), 'StaffOfRot')).toBeNull();
  });
  test('an unmet requirement', () => {
    expect(itemProblem(fixtureInfo('Wizard'), 'BoneStaff')).toBe('Needs INT 18 (you have 15).');
  });
  test('an untrained proficiency', () => {
    expect(itemProblem(fixtureInfo('Wizard'), 'PlateArmor')).toBe('Not trained in Heavy armor.');
  });
  test('a class that is not listed', () => {
    expect(itemProblem(fixtureInfo('Paladin'), 'ElvenBow')).toBe('Your class cannot use it.');
  });
});

describe('abilityNumbers', () => {
  const base = { id: 'MagicMissile', cooldown: 0, damage: 0, range: 0, arc: 0, speed: 0, radius: 0, duration: 0, pierce: 0, pierce_through: 0, ranged: false, projectile: null, split: {}, behind: 0 };
  const ab = (o: object) => ({ ...base, ...o }) as unknown as ResolvedAbility;
  test('a single-type ability', () => {
    expect(abilityNumbers(ab({ damage: 12, cooldown: 0.35, range: 220, ranged: true, radius: 3, split: { Magical: 1 } }), 'Ranged')).toBe('12 magical · cd 0.35 s · range 220 · radius 3');
  });
  test('a mixed split lists the shares', () => {
    expect(abilityNumbers(ab({ damage: 45, split: { Heat: 0.7, Magical: 0.2, Physical: 0.1 } }), 'Ranged')).toMatch(/^45: 70 % heat, 20 % magical, 10 % physical/);
  });
  test('numbers print with at most 2 decimals', () => {
    expect(abilityNumbers(ab({ damage: 10.416666666666668, cooldown: 0.3500000014, split: { Cold: 1 } }), 'Ranged')).toBe('10.42 cold · cd 0.35 s');
    expect(abilityNumbers(ab({ damage: 20.370370370370367, cooldown: 9, split: { Cold: 0.4, Heat: 0.6 }, duration: 3.999999 }), 'Ranged')).toBe('20.37: 60 % heat, 40 % cold · cd 9 s · 4 s');
  });
  test('Holy Light heals; duration and pierce show', () => {
    expect(abilityNumbers(ab({ id: 'HolyLight', damage: 35, duration: 4, pierce_through: 2 }), 'Nothing')).toBe('heal 35 · 4 s · pierces 2');
  });
});

test('monogram', () => {
  expect(monogram('Magic Missile')).toBe('MM');
  expect(monogram('Strike')).toBe('ST');
  expect(monogram('Flanking Thrust')).toBe('FT');
});

describe('picks and the pool', () => {
  test('samePick compares ability and source', () => {
    expect(samePick({ ability: 'Strike', source: 'Own' }, { ability: 'Strike', source: 'Own' })).toBe(true);
    expect(samePick({ ability: 'Strike', source: 'Own' }, { ability: 'Strike', source: { Item: 'Ring1' } })).toBe(false);
  });
  test('pickLabel names the item version', () => {
    const info = fixtureInfo('Paladin', { slots: { Ring1: 'RingOfTheMagus' } });
    expect(pickLabel({ ability: 'MagicMissile', source: { Item: 'Ring1' } }, info)).toBe('Magic Missile (Ring of the Magus)');
    expect(pickLabel({ ability: 'Strike', source: 'Own' }, info)).toBe('Strike');
  });
  test('poolFor keeps the cards of the slot in order', () => {
    const card = (ability: string): PoolCard => ({ pick: { ability, source: 'Own' }, ability: null, error: null, locked: false }) as PoolCard;
    const info = fixtureInfo('Paladin', { pool: [card('Strike'), card('Purify'), card('MagicMissile')] });
    expect(poolFor(info, 'Primary').map((c) => c.pick.ability)).toEqual(['Strike', 'MagicMissile']);
    expect(poolFor(info, 'Secondary').map((c) => c.pick.ability)).toEqual(['Purify']);
  });
});
