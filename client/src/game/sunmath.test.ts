import { describe, expect, it } from 'vitest';
import { TILE } from '../sim/map';
import { beamShape, cloudAt, sunLook } from './sunmath';

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

describe('beamShape', () => {
  it('the patch is centred on the tile and 0.6 as tall as wide', () => {
    const s = beamShape(5, 8, { ...sunLook, patch: 2 });
    expect(s.patch).toEqual({ x: 5.5 * TILE, y: 8.5 * TILE, w: 2 * TILE, h: 1.2 * TILE });
  });
  it('the top is `height` tiles up, shifted to the light side, narrower when widening', () => {
    const s = beamShape(5, 8, { ...sunLook, slant: 1.5, dir: -1, widen: true, height: 3 });
    const cx = (s.top[0][0] + s.top[1][0]) / 2;
    expect(cx).toBeCloseTo(5.5 * TILE - 1.5 * TILE);
    expect(s.top[0][1]).toBeCloseTo(8.5 * TILE - 3 * TILE);
    expect(Math.abs(s.top[1][0] - s.top[0][0])).toBeCloseTo(0.5 * Math.abs(s.bottom[1][0] - s.bottom[0][0]));
    expect(beamShape(5, 8, { ...sunLook, height: 6 }).top[0][1]).toBeCloseTo(8.5 * TILE - 6 * TILE);
    const straight = beamShape(5, 8, { ...sunLook, widen: false });
    expect(Math.abs(straight.top[1][0] - straight.top[0][0])).toBeCloseTo(Math.abs(straight.bottom[1][0] - straight.bottom[0][0]));
  });
});
