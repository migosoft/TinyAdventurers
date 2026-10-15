import { describe, expect, it } from 'vitest';
import { LIGHT_KIND } from '../generated/defs';
import { darknessAlpha, flicker } from './lightview';

describe('darkness', () => {
  it('is black where not seen or not lit', () => {
    expect(darknessAlpha(false, true, 255, 255, 255)).toBe(1);
    expect(darknessAlpha(true, false, 0, 0, 0)).toBe(1);
  });
  it('never draws a lit tile dark', () => {
    expect(darknessAlpha(true, true, 10, 5, 0)).toBeCloseTo(0.65);
    expect(darknessAlpha(true, true, 255, 120, 60)).toBe(0);
    expect(darknessAlpha(true, true, 600, 0, 0)).toBe(0); // over-bright sums are capped
  });
  it('flickers around 1 by the kind', () => {
    for (let t = 0; t < 5; t += 0.37) {
      const f = flicker(LIGHT_KIND.Torch, 7, t);
      expect(f).toBeGreaterThan(0.84);
      expect(f).toBeLessThan(1.16);
    }
  });
});
