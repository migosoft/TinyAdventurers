import { describe, expect, it } from 'vitest';
import { LIGHT_KIND } from '../generated/defs';
import { blackenDarkTiles, catmullRom, darknessAlpha, darkReach, DV_DARK, dvMask, flicker, nextDarkvision, SUB, tileDark, upsample } from './lightview';

describe('darkness', () => {
  it('is black where not seen or not lit', () => {
    expect(darknessAlpha(false, true, 255, 255, 255)).toBe(1);
    expect(darknessAlpha(true, false, 0, 0, 0)).toBe(1);
  });
  it('never draws a lit tile fully black', () => {
    expect(darknessAlpha(true, true, 10, 5, 0)).toBeCloseTo(0.92); // the floor: 0.08 bright
    expect(darknessAlpha(true, true, 0, 0, 0)).toBeLessThan(1);
    expect(darknessAlpha(true, true, 51, 0, 0)).toBeCloseTo(0.8); // a dim rim stays dim
    expect(darknessAlpha(true, true, 255, 120, 60)).toBe(0);
    expect(darknessAlpha(true, true, 600, 0, 0)).toBe(0); // over-bright sums are capped
  });
  it('flickers around 1 by the kind', () => {
    for (let t = 0; t < 5; t += 0.37) {
      const f = flicker(LIGHT_KIND.Torch, 7, t);
      expect(f).toBeGreaterThan(0.84);
      expect(f).toBeLessThan(1.16);
    }
  });
});

describe('upsampling the per-tile light', () => {
  it('weights the four taps to 1 and passes through the tile centres', () => {
    for (const t of [0, 0.125, 0.5, 0.875]) expect(catmullRom(t).reduce((a, b) => a + b)).toBeCloseTo(1);
    expect(catmullRom(0)).toEqual([0, 1, 0, 0]);
  });
  it('keeps a flat field flat and a ramp straight', () => {
    // One row of 6 tiles, one channel: a ramp 0, 20, ..., 100.
    const w = 6;
    const src = Float32Array.from([0, 20, 40, 60, 80, 100]);
    const dst = new Uint8ClampedArray(w * SUB * SUB * 4);
    upsample(src, 1, w, 1, 0, 0, w, 1, new Float32Array(w * SUB * 1), dst, 3);
    const row = Array.from({ length: w * SUB }, (_, px) => dst[px * 4 + 3]);
    // Pixel centres at tile coordinates (px + 0.5) / SUB - 0.5; the ramp is 20 per tile.
    for (let px = SUB; px < (w - 1) * SUB; px++) expect(row[px]).toBeCloseTo(((px + 0.5) / SUB - 0.5) * 20, 0);
    const flat = new Float32Array(w).fill(77);
    upsample(flat, 1, w, 1, 0, 0, w, 1, new Float32Array(w * SUB), dst, 0);
    for (let px = 0; px < w * SUB; px++) expect(dst[px * 4]).toBe(77);
  });
  it('clamps overshoot at a hard edge instead of wrapping it', () => {
    // Darkness: two black tiles, then two lit ones. Next to the edge the curve overshoots past 255 and below 0.
    const src = Float32Array.from([255, 255, 0, 0]);
    const dst = new Uint8ClampedArray(4 * SUB * SUB * 4);
    upsample(src, 1, 4, 1, 0, 0, 4, 1, new Float32Array(4 * SUB), dst, 3);
    const row = Array.from({ length: 4 * SUB }, (_, px) => dst[px * 4 + 3]);
    expect(row[SUB]).toBe(255); // about 273 before the clamp: not wrapped to a low value
    expect(row[3 * SUB - 1]).toBe(0); // about -18 before the clamp
    expect(row[0]).toBe(255);
    expect(row[4 * SUB - 1]).toBe(0);
  });
  it('keeps a dark tile black inside, next to a bright one', () => {
    const w = 4;
    // Darkness per tile: lit and bright, lit and bright, dark, dark.
    const darkTile = Float32Array.from([0, 0, 255, 255]);
    const dark = new Uint8ClampedArray(w * SUB * SUB * 4);
    const tint = new Uint8ClampedArray(w * SUB * SUB * 4).fill(200);
    upsample(darkTile, 1, w, 1, 0, 0, w, 1, new Float32Array(w * SUB), dark, 3);
    expect(dark[(2 * SUB) * 4 + 3]).toBeLessThan(255); // the bleed before the fix
    blackenDarkTiles(darkTile, w, 0, 0, w, 1, dark, tint);
    for (let py = 0; py < SUB; py++)
      for (let px = 2 * SUB; px < w * SUB; px++) {
        const p = (py * w * SUB + px) * 4;
        expect(dark[p + 3]).toBe(255);
        expect(tint[p + 3]).toBe(0);
      }
    expect(dark[(SUB - 1) * 4 + 3]).toBeLessThan(255); // the lit side keeps its fade
  });
});

describe('darkvision', () => {
  it('reaches tiles within the range, never at range 0', () => {
    expect(darkReach(0, 0, 0)).toBe(false);
    expect(darkReach(0, 0, 4.5)).toBe(true);
    expect(darkReach(4, 2, 4.5)).toBe(true); // 16 + 4 = 20 <= 20.25
    expect(darkReach(5, 0, 4.5)).toBe(false);
    expect(darkReach(3, 4, 5)).toBe(true); // exactly on the circle
    expect(darkReach(3, 4, 4.99)).toBe(false);
  });
  it('dims a seen unlit tile in reach, else leaves darknessAlpha', () => {
    expect(tileDark(true, false, true, 0, 0, 0)).toBe(DV_DARK);
    expect(tileDark(true, false, false, 0, 0, 0)).toBe(1);
    expect(tileDark(false, false, true, 0, 0, 0)).toBe(1);
    expect(tileDark(true, true, true, 10, 5, 0)).toBe(DV_DARK);
  });
  it('never makes a light rim in reach darker than darkvision, but keeps brighter light', () => {
    expect(tileDark(true, true, true, 25, 0, 0)).toBe(DV_DARK);
    expect(tileDark(true, true, true, 200, 0, 0)).toBeCloseTo(darknessAlpha(true, true, 200, 0, 0));
    expect(tileDark(true, true, false, 25, 0, 0)).toBe(darknessAlpha(true, true, 25, 0, 0));
  });
  it('greys fully where only darkvision shows the tile, fading out as light takes over', () => {
    expect(dvMask(false, 1)).toBe(0);
    expect(dvMask(true, 1)).toBe(1);
    expect(dvMask(true, DV_DARK)).toBe(0);
    expect(dvMask(true, 0.2)).toBe(0);
    const rim = dvMask(true, 0.9);
    expect(rim).toBeGreaterThan(0.5);
    expect(rim).toBeLessThan(1);
  });
  it('debug cycle: 0 -> 0.5 -> 1 -> 0, from any value', () => {
    expect(nextDarkvision(0)).toBe(0.5);
    expect(nextDarkvision(0.5)).toBe(1);
    expect(nextDarkvision(1)).toBe(0);
    expect(nextDarkvision(0.3)).toBe(0.5);
    expect(nextDarkvision(0.6)).toBe(1);
    expect(nextDarkvision(50 / 100)).toBe(1); // the snapshot's percent
  });
});
