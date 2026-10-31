import { describe, expect, it } from 'vitest';
import { TILE } from '../sim/map';
import { beamShape, cloudAt, lookFor, rayGlow, rayShapes, sunLook, sunVariant } from './sunmath';

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

describe('rayShapes', () => {
  const shape = beamShape(5, 8, { ...sunLook, widen: true });
  const widths = (id: number, n: 1 | 2 | 3) => rayShapes(shape, id, { ...sunLook, rays: n }).map((r) => r.bottom[1][0] - r.bottom[0][0]);
  it('gives one ray per setting, the whole beam for one', () => {
    for (const n of [1, 2, 3] as const) expect(rayShapes(shape, 4, { ...sunLook, rays: n })).toHaveLength(n);
    expect(rayShapes(shape, 4, { ...sunLook, rays: 1 })[0]).toEqual({ top: shape.top, bottom: shape.bottom });
  });
  it('is deterministic per id, and differs between ids', () => {
    expect(widths(4, 3)).toEqual(widths(4, 3));
    expect(widths(4, 3)).not.toEqual(widths(5, 3));
    const w = widths(4, 3);
    expect(new Set(w.map((x) => x.toFixed(3))).size).toBeGreaterThan(1);
  });
  it('spans about the beam width at the floor and the top, never beyond the beam', () => {
    const bw = shape.bottom[1][0] - shape.bottom[0][0];
    const tw = shape.top[1][0] - shape.top[0][0];
    for (const n of [2, 3] as const) {
      for (const id of [1, 2, 3, 4, 5, 99, 1234]) {
        const rays = rayShapes(shape, id, { ...sunLook, rays: n });
        const bl = Math.min(...rays.map((r) => r.bottom[0][0]));
        const br = Math.max(...rays.map((r) => r.bottom[1][0]));
        expect((br - bl) / bw).toBeGreaterThanOrEqual(0.85);
        expect(bl).toBeGreaterThanOrEqual(shape.bottom[0][0] - 0.01);
        expect(br).toBeLessThanOrEqual(shape.bottom[1][0] + 0.01);
        const tl = Math.min(...rays.map((r) => r.top[0][0]));
        const tr = Math.max(...rays.map((r) => r.top[1][0]));
        expect((tr - tl) / tw).toBeGreaterThanOrEqual(0.7);
        for (const r of rays) {
          expect(r.top[0][0]).toBeGreaterThanOrEqual(shape.top[0][0] - 0.01);
          expect(r.top[1][0]).toBeLessThanOrEqual(shape.top[1][0] + 0.01);
          expect(r.top[0][1]).toBe(shape.top[0][1]);
          expect(r.bottom[0][1]).toBe(shape.bottom[0][1]);
        }
      }
    }
  });
  it('dims each ray so overlapping rays stay near one beam', () => {
    expect(rayGlow(1, 1)).toBe(1);
    expect(rayGlow(2, 4)).toBeCloseTo(1);
    expect(rayGlow(1, 2) * Math.sqrt(2)).toBeCloseTo(1);
  });
});

describe('sunVariant', () => {
  const base = { ...sunLook, slant: 1.7, dir: 1 as const, gap: [3, 9] as [number, number] };
  const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
  it('is deterministic per id, and keeps slant, direction and gap', () => {
    expect(sunVariant(7, base)).toEqual(sunVariant(7, base));
    expect(sunVariant(7, base)).not.toEqual(sunVariant(8, base));
    for (const id of ids.slice(0, 200)) {
      const v = sunVariant(id, base);
      expect(v.slant).toBe(1.7);
      expect(v.dir).toBe(1);
      expect(v.gap).toBe(base.gap);
    }
  });
  it('stays within its ranges', () => {
    for (const id of ids) {
      const v = sunVariant(id, base);
      expect(v.patch).toBeGreaterThanOrEqual(1.5);
      expect(v.patch).toBeLessThanOrEqual(3);
      expect(v.height).toBeGreaterThanOrEqual(3);
      expect(v.height).toBeLessThanOrEqual(6);
      expect(v.glow).toBeGreaterThanOrEqual(0.8);
      expect(v.glow).toBeLessThanOrEqual(1.3);
      expect(v.clouds).toBeGreaterThanOrEqual(0);
      expect(v.clouds).toBeLessThanOrEqual(0.45);
      expect([1, 2, 3]).toContain(v.rays);
    }
  });
  it('mixes the looks: rays about 30 / 45 / 25 %, widening about 65 %', () => {
    const count = (f: (l: ReturnType<typeof sunVariant>) => boolean) => ids.filter((id) => f(sunVariant(id, base))).length / ids.length;
    expect(count((l) => l.rays === 1)).toBeCloseTo(0.3, 1);
    expect(count((l) => l.rays === 2)).toBeCloseTo(0.45, 1);
    expect(count((l) => l.rays === 3)).toBeCloseTo(0.25, 1);
    expect(count((l) => l.widen)).toBeCloseTo(0.65, 1);
  });
  it('lookFor uses the base itself unless vary, and caches per id', () => {
    expect(lookFor(5, { ...base, vary: false })).toEqual({ ...base, vary: false });
    const on = { ...base, vary: true };
    expect(lookFor(5, on)).toBe(lookFor(5, on));
    expect(lookFor(5, { ...on, slant: 2 }).slant).toBe(2);
  });
  it('rays of a variant can differ a lot in width but still span the beam', () => {
    const shape = beamShape(5, 8, { ...sunLook, widen: true });
    let thin = 0;
    for (const id of ids.slice(0, 300)) {
      const v = sunVariant(id, base);
      const rays = rayShapes(shape, id, v);
      if (rays.length < 2) continue;
      const ws = rays.map((r) => r.bottom[1][0] - r.bottom[0][0]);
      if (Math.max(...ws) / Math.min(...ws) > 2) thin++;
      expect(Math.min(...rays.map((r) => r.bottom[0][0]))).toBeCloseTo(shape.bottom[0][0]);
      expect(Math.max(...rays.map((r) => r.bottom[1][0]))).toBeCloseTo(shape.bottom[1][0]);
    }
    expect(thin).toBeGreaterThan(20);
  });
});
