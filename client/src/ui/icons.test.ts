// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import type { Atlas } from './atlas';
import { fixtureInfo } from './hub/fixture';
import { figureWeapon } from './classes';
import { abilityIcon, itemIcon } from './icons';

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
const atlas = { img: new Image(), frames: { weapon_knight_sword: { frame: { x: 0, y: 0, w: 10, h: 21 } } } } as unknown as Atlas;

test('an item with a sprite is its frame at the largest integer scale', () => {
  const c = itemIcon(atlas, 'KnightSword', 40) as HTMLCanvasElement;
  expect(c.width).toBe(10);
  expect(c.height).toBe(21);
  expect(c.className).toBe('ui-frame');
});
test('an item without a sprite is two letters', () => {
  expect(itemIcon(atlas, 'ChainMail', 40).textContent).toBe('CH');
  expect(itemIcon(atlas, 'ChainMail', 40).style.getPropertyValue('--box')).toBe('40px');
});
test('an ability icon carries its tint', () => {
  expect(abilityIcon('Fireball')).toContain('t-heat');
});
test('the figure holds the ranged weapon for a Ranger, else the melee one', () => {
  expect(figureWeapon(fixtureInfo('ElvenRanger', { slots: { Ranged: 'ElvenBow' } }))).toBe('weapon_bow');
  expect(figureWeapon(fixtureInfo('ElvenRanger'))).toBe('weapon_duel_sword'); // no ranged weapon: the melee sprite
  expect(figureWeapon(fixtureInfo('Paladin', { slots: { Melee: 'WarHammer' } }))).toBe('weapon_hammer');
});
