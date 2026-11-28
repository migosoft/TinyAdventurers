import { describe, expect, it } from 'vitest';
import { CUT_DEFAULTS, cutWeight, cutY } from './cut';

describe('cut', () => {
  it('leaves everything behind the line alone', () => {
    expect(cutY(2, -1, 0, CUT_DEFAULTS)).toBe(2);
    expect(cutWeight(-1, CUT_DEFAULTS)).toBe(0);
  });

  it('lowers a wall to the stub past the ramp, whatever its height', () => {
    expect(cutY(2, 0.5, 0, CUT_DEFAULTS)).toBe(0.25);
    expect(cutY(2, 5, 0, CUT_DEFAULTS)).toBe(0.25);
    expect(cutY(3.5, 5, 0, CUT_DEFAULTS)).toBe(0.25);
  });

  it('keeps floors, basins and chasms', () => {
    expect(cutY(0.1, 5, 0, CUT_DEFAULTS)).toBe(0.1);
    expect(cutY(-0.6, 5, 0, CUT_DEFAULTS)).toBe(-0.6);
  });

  it('lets the stub follow the floor', () => {
    expect(cutY(2, 5, 1, CUT_DEFAULTS)).toBe(1.25);
  });

  it('does nothing when off', () => {
    expect(cutY(2, 5, 0, { ...CUT_DEFAULTS, on: false })).toBe(2);
  });

  it('falls continuously across the ramp', () => {
    let prev = cutY(2, 0, 0, CUT_DEFAULTS);
    expect(prev).toBe(2);
    for (let i = 1; i <= 10; i++) {
      const y = cutY(2, i * 0.05, 0, CUT_DEFAULTS);
      expect(y).toBeLessThanOrEqual(prev);
      expect(prev - y).toBeLessThan(0.35);
      prev = y;
    }
    expect(prev).toBe(0.25);
  });
});
