import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser (window) on import; the helpers tested here do not use it.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { blurGrey, extendPoints, extendRim, levels, maskSteps, rampLayers } from './visionmask';

describe('extendPoints', () => {
  it('moves every point outward along its ray from the centre', () => {
    const out = extendPoints([10, 0, 0, -20, -3, -4], 0, 0, 5);
    expect(out[0]).toBeCloseTo(15);
    expect(out[1]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(0);
    expect(out[3]).toBeCloseTo(-25);
    expect(out[4]).toBeCloseTo(-6);
    expect(out[5]).toBeCloseTo(-8);
  });
  it('works around an off-origin centre and keeps a point at the centre where it is', () => {
    expect(extendPoints([13, 4, 3, 4], 3, 4, 2)).toEqual([15, 4, 3, 4]);
  });
});

describe('extendRim', () => {
  it('moves only the points at the radius (within 1 px)', () => {
    const out = extendRim([40, 0, 39.5, 0, 38, 0, 0, 40.9], 0, 0, 40, 10);
    expect(out[0]).toBeCloseTo(50);
    expect(out[2]).toBeCloseTo(49.5);
    expect(out.slice(4, 6)).toEqual([38, 0]);
    expect(out[6]).toBeCloseTo(0);
    expect(out[7]).toBeCloseTo(50.9);
  });
});

describe('rampLayers', () => {
  it('four layers from depth 0 to three quarters of the ramp, lightest first, the last at the soft grey', () => {
    const l = rampLayers(0, 24, 4);
    expect(l.map((x) => x.depth)).toEqual([0, 6, 12, 18]);
    expect(l.map((x) => x.grey)).toEqual([191, 128, 64, 0]);
  });
  it('ramp 0: one crisp layer at the full soft grey', () => {
    expect(rampLayers(77, 0, 4)).toEqual([{ depth: 0, grey: 77 }]);
  });
});

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
  it('gives the same result with reused scratch buffers, also oversized ones', () => {
    const f = (x: number, y: number) => ((x * 37 + y * 11) % 5) * 50;
    const a = grey(16, 9, f), b = grey(16, 9, f);
    blurGrey(a, 16, 9, 3);
    const scratch = { a: new Float32Array(400), b: new Float32Array(400) };
    blurGrey(b, 16, 9, 3, scratch);
    expect(b).toEqual(a);
  });
  it('radius 0 leaves the data unchanged', () => {
    const d = grey(10, 4, (x) => x * 20);
    const before = d.slice();
    blurGrey(d, 10, 4, 0);
    expect(d).toEqual(before);
  });
});

describe('maskSteps', () => {
  it('haze: the sight edge is feathered, then the wedge and the seen plants (no whole-tile blockers)', () => {
    expect(maskSteps(true, levels(0.8, 0.7))).toEqual([
      { step: 'sight' },
      { step: 'walls' },
      { step: 'feather' },
      { step: 'wedge', grey: 77 },
      { step: 'seen' },
    ]);
  });
  it('haze with soft 0 draws a white wedge: no haze behind blockers', () => {
    expect(maskSteps(true, levels(1, 0)).find((s) => s.step === 'wedge')).toEqual({ step: 'wedge', grey: 255 });
  });
  it('no haze: the view and its walls in white only', () => {
    expect(maskSteps(false, levels(0.3, 0))).toEqual([{ step: 'sight' }, { step: 'walls' }]);
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
