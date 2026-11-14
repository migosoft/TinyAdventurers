import { describe, expect, it } from 'vitest';
import { COVER } from './kinds';
import { HeightBuilder, coverHeights, heightAt, signedDistance } from './heights';

const halfPlane = (w: number, h: number, x0: number): Uint8Array => {
  const g = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) for (let x = x0; x < w; x++) g[z * w + x] = 1;
  return g;
};
const lcg = (seed: number) => { let s = seed; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

describe('signedDistance', () => {
  it('measures to the nearest px on the other side of the edge', () => {
    const sd = signedDistance(halfPlane(20, 20, 10), 20, 20);
    expect(sd[5 * 20 + 12]).toBeCloseTo(3, 5);
    expect(sd[5 * 20 + 9]).toBeCloseTo(-1, 5);
    expect(sd[5 * 20 + 0]).toBeCloseTo(-10, 5);
  });
  it('clamps to the cap and counts the outside as non-grow', () => {
    const w = 40, sd = signedDistance(new Uint8Array(w * w).fill(1), w, w);
    expect(sd[20 * w + 20]).toBe(16);
    expect(sd[20 * w + 0]).toBeCloseTo(1, 5);
    expect(signedDistance(new Uint8Array(w * w).fill(1), w, w, 4)[20 * w + 20]).toBe(4);
  });
});

describe('coverHeights', () => {
  it('never exceeds maxH and is 0 where not allowed', () => {
    for (const m of [COVER.grass, COVER.moss]) for (const seed of [1, 2, 3]) {
      const w = 64, h = 48, r = lcg(seed * 77), grow = new Uint8Array(w * h), allow = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) { grow[i] = r() < 0.5 ? 1 : 0; allow[i] = r() < 0.7 ? 1 : 0; }
      const out = coverHeights(grow, allow, w, h, m, seed);
      for (let i = 0; i < out.length; i++) { expect(out[i]).toBeLessThanOrEqual(m.maxH); if (!allow[i]) expect(out[i]).toBe(0); }
    }
  });
  it('thins out toward the rim', () => {
    const w = 400, h = 200, x0 = 200, g = halfPlane(w, h, x0), all = new Uint8Array(w * h).fill(1);
    const out = coverHeights(g, all, w, h, COVER.grass, 5);
    // the column at x0 has sd 1; rows near the image border are skipped (outside counts as non-grow)
    const share = (sd: number): number => { const x = sd > 0 ? x0 + sd - 1 : x0 + sd; let n = 0; for (let z = 10; z < h - 10; z++) if (out[z * w + x]) n++; return n / (h - 20); };
    const creep = share(-3), mid = share(2), far = share(6);
    expect(creep).toBeGreaterThan(0);
    expect(creep).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    expect(far).toBeGreaterThan(0.9);
    const sd = signedDistance(g, w, h);
    let sum = 0, n = 0;
    for (let i = 0; i < out.length; i++) if (sd[i] >= 10) { sum += out[i]; n++; }
    expect(sum / n).toBeGreaterThan(3); // 3 + 0.22 - 0.2 = 3.02 on average
    expect(sum / n).toBeLessThan(4);
  });
  it('is deterministic per seed', () => {
    const w = 64, h = 64, g = halfPlane(w, h, 20), all = new Uint8Array(w * h).fill(1);
    const a = coverHeights(g, all, w, h, COVER.grass, 1);
    expect(coverHeights(g, all, w, h, COVER.grass, 1)).toEqual(a);
    expect(coverHeights(g, all, w, h, COVER.grass, 2)).not.toEqual(a);
  });
  it('heightAt is 0 far outside the cover', () => {
    expect(heightAt(-16, 3, 4, COVER.grass, 1)).toBe(0);
  });
});

describe('HeightBuilder', () => {
  it('run unit by unit equals coverHeights', () => {
    const w = 37 * 16, h = 23 * 16, r = lcg(9), grow = new Uint8Array(w * h), allow = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      grow[z * w + x] = ((x >> 4) * 7 + (z >> 4) * 3) % 5 < 2 ? 1 : 0;
      allow[z * w + x] = r() < 0.9 ? 1 : 0;
    }
    const b = new HeightBuilder(grow, allow, w, h, COVER.grass, 4);
    expect(b.units.length).toBeGreaterThan(3);
    for (const u of b.units) u();
    expect(b.heights).toEqual(coverHeights(grow, allow, w, h, COVER.grass, 4));
  });
});
