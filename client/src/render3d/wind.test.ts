import { describe, expect, it } from 'vitest';
import { MIST } from './mist';
import { SWAY_WAVE_MAX, WIND, WIND_DIR, gust, sway } from './wind';

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

  it('never swings further than SWAY_WAVE_MAX times the amplitude, and gets there when the waves and the gust line up', () => {
    expect(SWAY_WAVE_MAX).toBeCloseTo(0.5 + 0.25 + 1.4, 12);
    let top = 0;
    for (let i = 0; i < 20000; i++) top = Math.max(top, Math.abs(sway(i * 0.37, i * 0.11, 1, 1, 1, i * 0.053)));
    expect(top).toBeLessThanOrEqual(SWAY_WAVE_MAX + 1e-12);
    expect(top).toBeGreaterThan(0.6 * SWAY_WAVE_MAX);
  });

  it('sways the same as before the gust term was split out', () => {
    // [x, z, y, h, amp, t, value] recorded from the original formula
    const pins: [number, number, number, number, number, number, number][] = [
      [1, 2, 2, 2, 0.11, 3, -0.0361048971443072],
      [5, -3, 1.5, 3, 0.07, 0.7, -0.01126038752681109],
      [-4, 8, 2, 2, 0.11, 12.5, -0.0005115673374301521],
      [10, 10, 0.5, 1, 0.05, 20, 0.0032176971621215135],
      [0, 0, 1, 1, 0.11, -1.2, 0.08549390312447848],
    ];
    for (const [x, z, y, h, a, t, want] of pins) expect(sway(x, z, y, h, a, t)).toBeCloseTo(want, 12);
  });

  it('has a travelling gust between 0 and 1', () => {
    expect(gust(0, 0, -1)).toBeCloseTo(0.9850637322122987, 12);
    expect(gust(0, 0, -5)).toBeCloseTo(0.6811095438559406, 12);
    expect(gust(6, -2, 10)).toBe(0);
    for (let i = 0; i < 200; i++) {
      const g = gust(i * 0.7, i * 0.3, i * 0.2);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});
