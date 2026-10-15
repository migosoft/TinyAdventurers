import { describe, expect, it } from 'vitest';
import { EFFECT } from '../generated/defs';
import { flameSpots, has, lieLayout, lyingPose, snowflakeAlpha } from './status';

describe('status', () => {
  it('reads effect bits', () => {
    const bits = (1 << EFFECT.Sleep) | (1 << EFFECT.Slowed);
    expect(has(bits, EFFECT.Sleep)).toBe(true);
    expect(has(bits, EFFECT.Blind)).toBe(false);
  });

  it('lies down towards its facing, flattened on the ground side', () => {
    expect(lyingPose(16, false).angle).toBe(90);
    expect(lyingPose(16, true).angle).toBe(-90);
    const p = lyingPose(16, false);
    expect(p.cropBottom).toBeGreaterThanOrEqual(1);
    expect(p.cropBottom).toBeLessThanOrEqual(2);
    expect(p.squash).toBeCloseTo(0.92, 2);
  });

  it('cuts the floor side from the opaque edge and rests it on the floor, centred', () => {
    // 16 x 28 frame, figure in columns 3..12 from row 8, origin in the middle.
    const b = { l: 3, r: 12, t: 8 };
    // Falling right: the right edge (column 12) loses 1 px; head 20 px long, centred.
    expect(lieLayout(b, 16, 28, 8, false, 1, 0.92)).toEqual({ cropX: 0, cropW: 12, x: -10, y: -3 });
    // Falling left (flipped): the mirrored left edge (column 3) loses 1 px.
    expect(lieLayout(b, 16, 28, 8, true, 1, 0.92)).toEqual({ cropX: 4, cropW: 12, x: 10, y: -3 });
  });
});

describe('elemental visuals', () => {
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
