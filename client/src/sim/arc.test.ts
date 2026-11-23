import { describe, expect, it } from 'vitest';
import { arcTouches, flightTime, shotZ } from './arc';

describe('arc', () => {
  it('matches the server parity table', () => {
    const t = flightTime(260, 290);
    expect(shotZ(t, 0)).toBeCloseTo(8, 9);
    expect(shotZ(t, 0.25)).toBeCloseTo(31.631299734748005, 9);
    expect(shotZ(t, 0.5)).toBeCloseTo(35.26259946949601, 9);
    expect(shotZ(t, t)).toBeCloseTo(0, 9);
    expect(shotZ(flightTime(72, 290), 0.1)).toBeCloseTo(7.150191570881226, 9);
    expect(shotZ(flightTime(100, 200), 0.3)).toBeCloseTo(12.8, 9);
  });
  it('touches only below the top', () => {
    expect(arcTouches(0, 0, 5, 20, 6, 0, 19.9, 3)).toBe(true);
    expect(arcTouches(0, 0, 5, 20, 6, 0, 20, 3)).toBe(false);
    expect(arcTouches(0, 0, 5, 20, 8, 0, 10, 3)).toBe(false);
  });
});
