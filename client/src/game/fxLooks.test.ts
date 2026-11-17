import { describe, expect, it } from 'vitest';
import { flameSpots, snowflakeAlpha } from './fxLooks';

describe('damage-type effect visuals', () => {
  it('snowflakes shimmer in, hold, and out', () => {
    expect(snowflakeAlpha(0, 1)).toBe(0);
    expect(snowflakeAlpha(0.5, 1)).toBe(1);
    expect(snowflakeAlpha(1, 1)).toBe(0);
    expect(snowflakeAlpha(0.1, 1)).toBeGreaterThan(0);
    expect(snowflakeAlpha(0.1, 1)).toBeLessThan(1);
  });

  it('flames sit on the body', () => {
    for (const [x, y] of flameSpots(12, 20, 3, 7)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(6);
      expect(y).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(-20);
    }
    expect(flameSpots(12, 20, 3, 7)).toHaveLength(3);
  });
});
