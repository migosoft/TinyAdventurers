import { describe, expect, it } from 'vitest';
import { LIGHT_KIND } from '../generated/defs';
import { catmullRom, darknessAlpha, flicker, SUB, upsample } from './lightview';

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
  it('clamps overshoot at a hard edge to the byte range', () => {
    const src = Float32Array.from([0, 0, 255, 255]);
    const dst = new Uint8ClampedArray(4 * SUB * SUB * 4);
    upsample(src, 1, 4, 1, 0, 0, 4, 1, new Float32Array(4 * SUB), dst, 3);
    for (let px = 0; px < 4 * SUB; px++) expect(dst[px * 4 + 3]).toBeGreaterThanOrEqual(0);
    expect(dst[0 * 4 + 3]).toBe(0); // the dark side stays black
    expect(dst[(4 * SUB - 1) * 4 + 3]).toBe(255);
  });
});
