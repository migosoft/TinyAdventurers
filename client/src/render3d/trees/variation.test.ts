import { describe, expect, it } from 'vitest';
import { plantVariation } from './variation';

const RANGES = [0.245, 0.28, 0.19, 0.38]; // leaf brightness, leaf warmth, bark brightness, bark grey
const feet = Array.from({ length: 2000 }, (_, i) => ({ x: (i % 50) * 1.3 + (i % 7) / 16, z: Math.floor(i / 50) * 1.7 + (i % 11) / 16 }));

describe('plantVariation', () => {
  const all = feet.map((f) => plantVariation(f.x, f.z));
  it('stays inside the ranges, brightness as factors around 1 and the shifts around 0', () => {
    for (const v of all) {
      expect(Math.abs(v[0] - 1)).toBeLessThanOrEqual(RANGES[0]);
      expect(Math.abs(v[1])).toBeLessThanOrEqual(RANGES[1]);
      expect(Math.abs(v[2] - 1)).toBeLessThanOrEqual(RANGES[2]);
      expect(Math.abs(v[3])).toBeLessThanOrEqual(RANGES[3]);
    }
  });
  it('reaches at least 90 % of each range on both sides, spread evenly', () => {
    const centre = [1, 0, 1, 0];
    for (let k = 0; k < 4; k++) {
      const d = all.map((v) => v[k] - centre[k]);
      expect(Math.max(...d)).toBeGreaterThanOrEqual(0.9 * RANGES[k]);
      expect(Math.min(...d)).toBeLessThanOrEqual(-0.9 * RANGES[k]);
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      expect(Math.abs(mean)).toBeLessThan(0.1 * RANGES[k]);
    }
  });
  it('gives the same foot the same values, and the four values differ from each other', () => {
    expect(plantVariation(12.5, 40.25)).toEqual(plantVariation(12.5, 40.25));
    const v = plantVariation(12.5, 40.25);
    expect(new Set([(v[0] - 1) / RANGES[0], v[1] / RANGES[1], (v[2] - 1) / RANGES[2], v[3] / RANGES[3]]).size).toBe(4);
  });
});
