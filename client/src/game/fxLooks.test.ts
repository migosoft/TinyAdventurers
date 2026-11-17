import { describe, expect, it } from 'vitest';
import { snowflakeAlpha } from './fxLooks';

describe('damage-type effect visuals', () => {
  it('snowflakes shimmer in, hold, and out', () => {
    expect(snowflakeAlpha(0, 1)).toBe(0);
    expect(snowflakeAlpha(0.5, 1)).toBe(1);
    expect(snowflakeAlpha(1, 1)).toBe(0);
    expect(snowflakeAlpha(0.1, 1)).toBeGreaterThan(0);
    expect(snowflakeAlpha(0.1, 1)).toBeLessThan(1);
  });
});
