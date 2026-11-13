import { describe, expect, it } from 'vitest';
import { MIST } from './mist';
import { SWAY, WIND, WIND_DIR, sway, swayAmp } from './wind';

describe('the wind', () => {
  it('is the mist speed turned 20 degrees, and WIND_DIR is its direction', () => {
    expect(Math.hypot(...WIND)).toBeCloseTo(MIST.speed, 9);
    expect(Math.atan2(WIND[1], WIND[0])).toBeCloseTo((20 * Math.PI) / 180, 9);
    expect(Math.hypot(...WIND_DIR)).toBeCloseTo(1, 9);
  });

  it('sways nothing without amplitude or at the foot', () => {
    expect(sway(1, 2, 2, 2, 0, 3)).toBe(0);
    expect(sway(1, 2, 0, 2, 0.11, 3)).toBeCloseTo(0, 12); // may be -0
  });

  it('grows with the square of the height', () => {
    expect(sway(1, 2, 2, 2, 0.11, 3)).toBeCloseTo(4 * sway(1, 2, 1, 2, 0.11, 3), 12);
  });

  it('clamps above the top', () => {
    expect(sway(1, 2, 5, 2, 0.11, 3)).toBe(sway(1, 2, 2, 2, 0.11, 3));
  });

  it('matches the pinned formula', () => {
    const [x, z, t] = [1, 2, 3];
    const gust = Math.max(0, Math.sin(0.33 * (x + 0.3 * z) - 1.5 * t)) ** 6;
    const want = 0.11 * (0.5 * Math.sin(1.3 * t + 0.9 * x + 0.4 * z) + 0.25 * Math.sin(2.9 * t + z) + 1.4 * gust);
    expect(sway(x, z, 2, 2, 0.11, t)).toBeCloseTo(want, 12);
    expect(want).not.toBe(0);
  });

  it('has an amplitude per plant kind', () => {
    expect(swayAmp('conifer')).toBe(0.07);
    expect(swayAmp('bare')).toBe(0);
    expect(swayAmp('bush')).toBe(SWAY.small);
    for (const k of ['round', 'wide', 'tall'] as const) expect(swayAmp(k)).toBe(SWAY.leafy);
  });
});
