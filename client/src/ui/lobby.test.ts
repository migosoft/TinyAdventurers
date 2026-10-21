import { describe, expect, it } from 'vitest';
import { debugReject, debugWeapons, isDebugGuardError } from './lobby';

const NONE = { loadout: false, melee: false, ranged: false };
const ALL = { loadout: true, melee: true, ranged: true };

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

describe('debugReject', () => {
  it('does nothing when the user changed no debug pick', () => {
    for (const m of ['Not everyone is ready yet.', 'Debug is off.', 'Strike needs STR 20.']) {
      expect(debugReject(m, NONE, [])).toEqual({ reset: NONE, resend: NONE });
    }
  });
  it('ignores errors that are not about a pick', () => {
    expect(debugReject('Not everyone is ready yet.', ALL, ['Bob'])).toEqual({ reset: NONE, resend: NONE });
  });
  it('resets a pick the guards refused, and sends nothing', () => {
    expect(debugReject('Debug is off.', { ...NONE, ranged: true }, [])).toEqual({ reset: { ...NONE, ranged: true }, resend: NONE });
  });
  it('resets and resends only the picks the user changed when the sheet refuses them', () => {
    const touched = { ...NONE, melee: true };
    expect(debugReject('The item in the melee slot needs STR 20.', touched, [])).toEqual({ reset: touched, resend: touched });
    expect(debugReject('Ground Slam needs STR 17.', { ...NONE, loadout: true }, [])).toEqual({ reset: { ...NONE, loadout: true }, resend: { ...NONE, loadout: true } });
  });
  it('leaves my picks alone when the error is another player\'s build', () => {
    expect(debugReject('Bob: Ground Slam needs STR 17.', ALL, ['Bob'])).toEqual({ reset: NONE, resend: NONE });
  });
});
