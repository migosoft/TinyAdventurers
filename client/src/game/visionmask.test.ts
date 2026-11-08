import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser (window) on import; the helpers tested here do not use it.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { blurGrey, fillPlan, levels } from './visionmask';

/** RGBA data of a w×h image whose grey (alpha 255) comes from `f(x, y)`. */
const grey = (w: number, h: number, f: (x: number, y: number) => number) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([f(x, y), f(x, y), f(x, y), 255], (y * w + x) * 4);
  return d;
};

describe('blurGrey', () => {
  it('keeps a constant image constant', () => {
    const d = grey(20, 12, () => 77);
    blurGrey(d, 20, 12, 3);
    for (let i = 0; i < d.length; i += 4) expect([d[i], d[i + 1], d[i + 2], d[i + 3]]).toEqual([77, 77, 77, 255]);
  });
  it('turns a hard step into a monotonic ramp about 3 x radius wide', () => {
    const w = 60, r = 4;
    const d = grey(w, 3, (x) => (x < 30 ? 0 : 255));
    blurGrey(d, w, 3, r);
    const row = Array.from({ length: w }, (_, x) => d[x * 4]);
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    expect(row[30 - 3 * r - 1]).toBe(0);
    expect(row[30 + 3 * r]).toBe(255);
    const mid = row.filter((v) => v > 0 && v < 255).length;
    expect(mid).toBeGreaterThan(2 * r);
    expect(mid).toBeLessThanOrEqual(6 * r);
    expect(d[3]).toBe(255);
  });
  it('blurs vertically too, and copies the grey into green and blue', () => {
    const d = grey(8, 30, (_, y) => (y < 15 ? 0 : 255));
    blurGrey(d, 8, 30, 2);
    const at = (y: number) => d.slice((y * 8) * 4, (y * 8) * 4 + 4);
    expect(at(15)[0]).toBeGreaterThan(0);
    expect(at(15)[0]).toBeLessThan(255);
    expect(at(15)[1]).toBe(at(15)[0]);
    expect(at(15)[2]).toBe(at(15)[0]);
  });
  it('radius 0 leaves the data unchanged', () => {
    const d = grey(10, 4, (x) => x * 20);
    const before = d.slice();
    blurGrey(d, 10, 4, 0);
    expect(d).toEqual(before);
  });
});

describe('fillPlan', () => {
  it('haze: the hard view at the soft level, then the full view in white', () => {
    expect(fillPlan(true, levels(1, 0.7))).toEqual([
      { poly: 'hard', grey: 77 },
      { poly: 'full', grey: 255 },
    ]);
  });
  it('haze with soft 0 fills the hard view white: no haze behind blockers', () => {
    expect(fillPlan(true, levels(1, 0))[0]).toEqual({ poly: 'hard', grey: 255 });
  });
  it('no haze: the view in white only', () => {
    expect(fillPlan(false, levels(0.3, 0))).toEqual([{ poly: 'hard', grey: 255 }]);
  });
});

describe('levels', () => {
  it('turns unseen strengths into canvas greys', () => {
    expect(levels(1, 0.7)).toEqual({ outside: 0, soft: 77 });
    expect(levels(0.3, 0)).toEqual({ outside: 179, soft: 255 });
  });
  it('clamps out-of-range strengths', () => {
    expect(levels(2, -1)).toEqual({ outside: 0, soft: 255 });
  });
});
