import { describe, expect, it } from 'vitest';
import { drawPlant, type Drawn, type Rgba } from '../vegetation';
import { shadowOf, shadowVector } from './shadows';

/** A 3-wide, 10-tall post of opaque pixels; its foot is at (1, 9). */
function makePost(): Rgba {
  const data = new Uint8ClampedArray(3 * 10 * 4);
  for (let i = 0; i < 30; i++) data.set([120, 80, 40, 255], i * 4);
  return { w: 3, h: 10, data };
}
const post = makePost();

function alphaAt(d: Drawn, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= d.img.w || y >= d.img.h) return 0;
  return d.img.data[(y * d.img.w + x) * 4 + 3];
}
function centroidX(d: Drawn): number {
  let sum = 0, n = 0;
  for (let y = 0; y < d.img.h; y++) for (let x = 0; x < d.img.w; x++) if (alphaAt(d, x, y) > 0) { sum += x; n++; }
  return sum / n;
}

describe('shadows', () => {
  it('shadowVector: the shadow falls away from the sun and toward the viewer; a high sun is short', () => {
    const left = shadowVector({ side: -1, elevation: 45 });
    expect(left.sx).toBeCloseTo(0.9, 5); expect(left.sy).toBeCloseTo(0.45, 5);
    expect(shadowVector({ side: 1, elevation: 45 }).sx).toBeCloseTo(-0.9, 5);
    expect(shadowVector({ side: -1, elevation: 70 }).sx).toBeLessThan(shadowVector({ side: -1, elevation: 35 }).sx);
    for (const e of [35, 70]) { const v = shadowVector({ side: 1, elevation: e }); expect(Number.isFinite(v.sx) && Number.isFinite(v.sy)).toBe(true); }
  });
  it('a post casts a line of solid pixels along the vector', () => {
    const s = shadowOf(post, { x: 1, y: 9 }, { sx: 1, sy: 0 }, false);
    expect(alphaAt(s, s.foot.x + 9, s.foot.y)).toBe(255);
    expect(alphaAt(s, s.foot.x + 9, s.foot.y - 1)).toBe(0);
    for (let i = 3; i < s.img.data.length; i += 4) expect([0, 255]).toContain(s.img.data[i]);
  });
  it('pixels at or below the foot cast nothing but the contact ellipse exists', () => {
    const s = shadowOf(post, { x: 1, y: 9 }, { sx: 0, sy: 0 }, false);
    expect(alphaAt(s, s.foot.x, s.foot.y)).toBe(255);
    expect(alphaAt(s, s.foot.x + Math.round(0.3 * 3) + 2, s.foot.y)).toBe(0);
  });
  it('an opaque pixel below the foot casts nothing with a non-zero vector (only the ellipse is there)', () => {
    const data = new Uint8ClampedArray(1 * 6 * 4);
    data.set([1, 1, 1, 255], 5 * 4); // the lowest row, below a foot at y 3
    const s = shadowOf({ w: 1, h: 6, data }, { x: 0, y: 3 }, { sx: 1, sy: 0.5 }, false);
    const none = shadowOf({ w: 1, h: 6, data: new Uint8ClampedArray(24) }, { x: 0, y: 3 }, { sx: 1, sy: 0.5 }, false);
    expect(s).toEqual(none);
  });
  it('a thin post at a low sun casts a shadow without gaps', () => {
    const data = new Uint8ClampedArray(1 * 21 * 4);
    for (let y = 0; y < 20; y++) data.set([1, 1, 1, 255], y * 4);
    const s = shadowOf({ w: 1, h: 21, data }, { x: 0, y: 20 }, shadowVector({ side: -1, elevation: 35 }), false);
    const cols: number[] = [];
    for (let x = 0; x < s.img.w; x++) { let any = false; for (let y = 0; y < s.img.h; y++) if (alphaAt(s, x, y) > 0) any = true; cols.push(any ? 1 : 0); }
    const first = cols.indexOf(1), last = cols.lastIndexOf(1);
    expect(cols.slice(first, last + 1).every((c) => c === 1)).toBe(true);
    expect(last - first).toBeGreaterThan(15);
  });
  it('mirroring equals shadowing the hand-mirrored raster, foot included', () => {
    const t = drawPlant('wide', 5, 100), { w, h, data } = t.img;
    const flipped = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) flipped.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
    const vec = { sx: 1.2, sy: 0.5 };
    const a = shadowOf(t.img, t.foot, vec, true), b = shadowOf({ w, h, data: flipped }, { x: w - t.foot.x, y: t.foot.y }, vec, false);
    expect(a.foot).toEqual(b.foot);
    expect(a.img.w).toBe(b.img.w); expect(a.img.h).toBe(b.img.h);
    expect(Array.from(a.img.data)).toEqual(Array.from(b.img.data));
  });
  it('mirroring the plant does not flip the shadow', () => {
    const t = drawPlant('wide', 5, 100);
    const a = shadowOf(t.img, t.foot, { sx: 1, sy: 0.5 }, false), b = shadowOf(t.img, t.foot, { sx: 1, sy: 0.5 }, true);
    expect(centroidX(a) - a.foot.x).toBeGreaterThan(0);
    expect(centroidX(b) - b.foot.x).toBeGreaterThan(0);
  });
  it('a low sun (elevation 20, sy > 1) leaves no empty row in a thin post shadow', () => {
    const vec = shadowVector({ side: -1, elevation: 20 });
    expect(vec.sy).toBeGreaterThan(1);
    const thin = { w: 1, h: 10, data: new Uint8ClampedArray(40).fill(255) };
    const s = shadowOf(thin, { x: 0, y: 9 }, vec, false);
    const rows: boolean[] = [];
    for (let y = 0; y < s.img.h; y++) {
      let any = false;
      for (let x = 0; x < s.img.w; x++) if (alphaAt(s, x, y) > 0) any = true;
      rows.push(any);
    }
    expect(rows.indexOf(true)).toBeGreaterThanOrEqual(0);
    expect(rows.slice(rows.indexOf(true), rows.lastIndexOf(true) + 1).every(Boolean)).toBe(true);
  });
  it('shadow bounds are finite and contain the contact ellipse', () => {
    const t = drawPlant('tall', 3, 130);
    const s = shadowOf(t.img, t.foot, shadowVector({ side: -1, elevation: 35 }), false);
    expect(s.img.w).toBeLessThan(t.img.w + t.foot.y * 2); expect(s.img.h).toBeLessThan(t.img.h + t.foot.y);
    expect(s.foot.x).toBeGreaterThanOrEqual(0); expect(s.foot.y).toBeLessThan(s.img.h);
  });
});
