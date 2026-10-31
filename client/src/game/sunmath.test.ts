import { describe, expect, it } from 'vitest';
import { cloudAt, sunLook } from './sunmath';

const look = { ...sunLook };

describe('cloudAt', () => {
  it('stays between the deepest dip and full sun', () => {
    for (let t = 0; t < 600; t += 0.25) {
      const k = cloudAt(3, t, look);
      expect(k).toBeGreaterThanOrEqual(1 - look.clouds - 1e-9);
      expect(k).toBeLessThanOrEqual(1);
    }
  });

  it('is full sun most of the time and changes smoothly', () => {
    let full = 0;
    for (let t = 0; t < 600; t += 0.05) {
      if (cloudAt(3, t, look) === 1) full++;
      expect(Math.abs(cloudAt(3, t + 0.05, look) - cloudAt(3, t, look))).toBeLessThan(0.03);
    }
    expect(full / (600 / 0.05)).toBeGreaterThan(0.6);
  });

  it('dips at least once in two minutes and differs per light', () => {
    const dips = (id: number) => Array.from({ length: 2400 }, (_, i) => cloudAt(id, i * 0.05, look));
    expect(Math.min(...dips(3))).toBeLessThan(0.75);
    expect(dips(3)).not.toEqual(dips(4));
  });

  it('with clouds 0 is always 1', () => {
    expect(cloudAt(3, 17.3, { ...look, clouds: 0 })).toBe(1);
  });
});
