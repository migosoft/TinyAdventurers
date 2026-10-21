import { describe, expect, it } from 'vitest';
import { debugWeapons, isDebugGuardError } from './lobby';

describe('debugWeapons', () => {
  it('lists the weapons a class is trained in, per slot', () => {
    const barbMelee = debugWeapons('Barbarian', 'Melee');
    expect(barbMelee).toContain('WarHammer');
    expect(barbMelee).toContain('GreatAxe');
    expect(barbMelee).not.toContain('RedStaff');
    expect(debugWeapons('Barbarian', 'Ranged')).toEqual(['ThrowingAxes']);
  });
  it('leaves out weapons of a kind the class is not proficient with', () => {
    expect(debugWeapons('Wizard', 'Melee')).not.toContain('WarHammer');
    expect(debugWeapons('Wizard', 'Ranged')).toEqual([]);
    expect(debugWeapons('ElvenRanger', 'Ranged')).not.toContain('ThrowingAxes');
  });
});

describe('isDebugGuardError', () => {
  it('knows the messages that mean the debug pick was never stored', () => {
    for (const m of ['Debug is off.', 'Join a dungeon first.', 'Not during a run.', 'Not while ready.', 'Choose a character first.', 'Only weapons.']) {
      expect(isDebugGuardError(m), m).toBe(true);
    }
    expect(isDebugGuardError('You are not trained in Hammer.')).toBe(false);
  });
});
