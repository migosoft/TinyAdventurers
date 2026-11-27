import { describe, expect, it } from 'vitest';
import { PICTURES } from '../models/build';
import { DEMON_PAINT, paintDemon, skinUv, webUv } from './paint';

describe('the demon paint', () => {
  const img = paintDemon(), P = DEMON_PAINT;
  /** The texel a uv reads: x = u * w, the image row counted from the bottom (row 0 of the image is on top). */
  const at = (uv: readonly number[]): number[] => {
    const x = Math.min(img.w - 1, Math.floor(uv[0] * img.w)), row = img.h - 1 - Math.min(img.h - 1, Math.floor(uv[1] * img.h)), o = (row * img.w + x) * 4;
    return Array.from(img.data.subarray(o, o + 4));
  };
  const skin = (band: number, u: number, v: number): number[] => at(skinUv(band, u, v, [0, 0]));
  const web = (side: 1 | -1, across: number, out: number): number[] => at(webUv(side, across, out, [0, 0]));
  const lum = (p: number[]): number => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2];
  const N = 96, steps = Array.from({ length: N }, (_, i) => (i + 0.5) / N);
  const bandTexels = (band: number): number[][] => steps.flatMap((u) => steps.map((v) => skin(band, u, v)));

  it('is 1536 x 384 RGBA, the same bytes on every call, and registered as a picture', () => {
    expect([img.w, img.h, img.data.length]).toEqual([1536, 384, 1536 * 384 * 4]);
    expect(Buffer.from(paintDemon().data).equals(Buffer.from(img.data))).toBe(true);
    expect(PICTURES.demon).toBe(paintDemon);
  });

  it('knows only the three alpha classes', () => {
    const seen = new Set<number>();
    for (let i = 3; i < img.data.length; i += 4) seen.add(img.data[i]);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, P.plain, P.glow]);
  });

  it('has six skin bands: glowing cracks on the trunk, none on the foot, a glowing horn tip', () => {
    const glowing = (band: number): number => bandTexels(band).filter((p) => p[3] === P.glow).length;
    expect(glowing(0)).toBeGreaterThan(0);
    expect(glowing(4)).toBe(0);
    for (const v of steps) {
      for (const u of [0.96, 0.975, 0.99, 1]) expect(skin(5, u, v)[3]).toBe(P.glow);
      for (const u of [0, 0.3, 0.6, 0.9]) expect(skin(5, u, v)[3]).toBe(P.plain);
    }
    // no skin texel is a hole
    for (let b = 0; b < P.bands; b++) expect(bandTexels(b).filter((p) => p[3] === 0).length).toBe(0);
  });

  it('darkens the leg from the thigh to the foot', () => {
    const mean = (band: number): number => { const t = bandTexels(band); return t.reduce((s, p) => s + lum(p), 0) / t.length; };
    expect(mean(3)).toBeLessThan(mean(2));
    expect(mean(4)).toBeLessThan(mean(3));
    expect(mean(4)).toBeLessThan(20);
  });

  it('is not mirrored round a piece and joins at the seam', () => {
    let differ = 0;
    for (const u of steps) if (skin(0, u, 0.2).join() !== skin(0, u, 0.8).join()) differ++;
    expect(differ).toBeGreaterThan(N / 2);
    // the seam: the last row's neighbour is the first row, as near to it as any row is to the next
    const rowDiff = (v0: number, v1: number): number => steps.reduce((s, u) => s + Math.abs(lum(skin(0, u, v0)) - lum(skin(0, u, v1))), 0) / N;
    const inside = Math.max(rowDiff(0.25, 0.25 + 1 / 127), rowDiff(0.5, 0.5 + 1 / 127), rowDiff(0.75, 0.75 + 1 / 127));
    expect(rowDiff(1, 0)).toBeLessThan(inside * 2 + 4);
    expect(rowDiff(0, 0.5)).toBeGreaterThan(rowDiff(1, 0) * 2);
  });

  it('tears the two webbings differently, in the outer 45 % only', () => {
    let differ = 0;
    for (const side of [1, -1] as const) {
      let holes = 0;
      for (const a of steps) for (const o of steps) {
        const p = web(side, a, o);
        expect(p[3] === 0 || p[3] === P.plain).toBe(true);
        if (p[3] === 0) { holes++; expect(o).toBeGreaterThan(0.55); }
        if (side === 1 && p.join() !== web(-1, a, o).join()) differ++;
      }
      expect(holes).toBeGreaterThan(0);
    }
    expect(differ).toBeGreaterThan(0);
  });

  it('paints the webbing dark at the root, red in the middle, burnt at the rim', () => {
    for (const side of [1, -1] as const) for (const a of [0.125, 0.375, 0.625, 0.875]) {
      const root = web(side, a, 0), mid = web(side, a, 0.45), rim = web(side, a, 1);
      expect(lum(root)).toBeLessThan(lum(mid));
      expect(mid[0]).toBeGreaterThan(120);
      expect(rim[0]).toBeLessThan(60);
    }
  });

  it('keeps a plain and a glowing white block for the flat-coloured parts', () => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      expect(at([(P.flat.x + x + 0.5) / P.w, (P.flat.y + y + 0.5) / P.h])).toEqual([255, 255, 255, P.plain]);
      expect(at([(P.hot.x + x + 0.5) / P.w, (P.hot.y + y + 0.5) / P.h])).toEqual([255, 255, 255, P.glow]);
    }
  });
});
