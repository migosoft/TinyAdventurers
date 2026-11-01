import { describe, expect, it } from 'vitest';
import { EFFECT, FLAG } from '../../generated/defs';
import { appearFactor, entityAlpha, INCORPOREAL_ALPHA, INVISIBLE_PARTY_ALPHA } from './entityAlpha';

describe('entityAlpha', () => {
  it('is opaque for an ordinary figure', () => {
    expect(entityAlpha(0, 0, false)).toBe(1);
    expect(entityAlpha(FLAG.HURT, 1 << EFFECT.Burning, true)).toBe(1);
  });
  it('draws an incorporeal figure semi-transparent', () => {
    expect(entityAlpha(FLAG.INCORPOREAL, 0, false)).toBe(INCORPOREAL_ALPHA);
    expect(INCORPOREAL_ALPHA).toBe(0.6);
  });
  it('draws an invisible party hero fainter still', () => {
    expect(entityAlpha(0, 1 << EFFECT.Invisible, true)).toBe(INVISIBLE_PARTY_ALPHA);
    expect(INVISIBLE_PARTY_ALPHA).toBe(0.35);
    expect(entityAlpha(FLAG.INCORPOREAL, 1 << EFFECT.Invisible, true)).toBe(INVISIBLE_PARTY_ALPHA);
  });
  it('ignores Invisible on a non-party figure (it is not sent anyway)', () => {
    expect(entityAlpha(0, 1 << EFFECT.Invisible, false)).toBe(1);
  });
});

describe('appearFactor', () => {
  it('rises from 0 to 1 over the fade', () => {
    expect(appearFactor(0.3, 0.3)).toBe(0);
    expect(appearFactor(0.15, 0.3)).toBeCloseTo(0.5);
    expect(appearFactor(0, 0.3)).toBe(1);
    expect(appearFactor(-1, 0.3)).toBe(1);
    expect(appearFactor(0, 0)).toBe(1);
  });
});
