import { describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { FIGURES, heroWeapons } from './defs';

describe('heroWeapons', () => {
  it('gives a melee class the melee item sprite', () => {
    expect(heroWeapons(FIGURES[KIND.Paladin], 'WarHammer', null)).toEqual({ weapon: 'weapon_hammer', meleeWeapon: undefined });
    expect(heroWeapons(FIGURES[KIND.Wizard], 'RedStaff', null).weapon).toBe('weapon_red_magic_staff');
  });
  it('gives the ranger the ranged sprite and thrusts with the melee one', () => {
    expect(heroWeapons(FIGURES[KIND.ElvenRanger], 'Knife', 'HuntersBow')).toEqual({ weapon: 'weapon_bow', meleeWeapon: 'weapon_knife' });
  });
  it('gives a ranger without a ranged weapon the melee sprite for both', () => {
    expect(heroWeapons(FIGURES[KIND.ElvenRanger], 'Rapier', null)).toEqual({ weapon: 'weapon_duel_sword', meleeWeapon: 'weapon_duel_sword' });
  });
  it('never mutates the shared figure defs', () => {
    heroWeapons(FIGURES[KIND.Paladin], 'WarHammer', null);
    heroWeapons(FIGURES[KIND.ElvenRanger], 'Knife', 'HuntersBow');
    expect(FIGURES[KIND.Paladin].weapon).toBe('weapon_knight_sword');
    expect(FIGURES[KIND.ElvenRanger].weapon).toBe('weapon_bow');
    expect(FIGURES[KIND.ElvenRanger].meleeWeapon).toBe('weapon_duel_sword');
  });
});
