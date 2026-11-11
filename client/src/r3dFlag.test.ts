import { describe, expect, it } from 'vitest';
import { isR3dDemo, wants3d } from './r3dFlag';

describe('r3dFlag', () => {
  it('wants3d needs ?r3d and a debug account', () => {
    expect(wants3d('?r3d', true)).toBe(true);
    expect(wants3d('?r3d', false)).toBe(false);
    expect(wants3d('?r3d=demo', true)).toBe(false);
    expect(wants3d('?lag=150', true)).toBe(false);
    expect(wants3d('?r3d&lag=150', true)).toBe(true);
  });
  it('isR3dDemo is only r3d=demo', () => {
    expect(isR3dDemo('?r3d=demo')).toBe(true);
    expect(isR3dDemo('?r3d')).toBe(false);
  });
});
