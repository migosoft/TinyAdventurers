import { describe, expect, it } from 'vitest';
import { flameSpotAt, snowflakeAlpha } from './fxLooks';

describe('damage-type effect visuals', () => {
  it('snowflakes shimmer in, hold, and out', () => {
    expect(snowflakeAlpha(0, 1)).toBe(0);
    expect(snowflakeAlpha(0.5, 1)).toBe(1);
    expect(snowflakeAlpha(1, 1)).toBe(0);
    expect(snowflakeAlpha(0.1, 1)).toBeGreaterThan(0);
    expect(snowflakeAlpha(0.1, 1)).toBeLessThan(1);
  });

  it('flames sit on the body', () => {
    const out: [number, number] = [0, 0];
    for (let i = 0; i < 3; i++) {
      flameSpotAt(12, 20, i, 7, out);
      expect(Math.abs(out[0])).toBeLessThanOrEqual(6);
      expect(out[1]).toBeLessThanOrEqual(0);
      expect(out[1]).toBeGreaterThanOrEqual(-20);
    }
  });
});
