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
  it('mirroring the plant does not flip the shadow', () => {
    const t = drawPlant('wide', 5, 100);
    const a = shadowOf(t.img, t.foot, { sx: 1, sy: 0.5 }, false), b = shadowOf(t.img, t.foot, { sx: 1, sy: 0.5 }, true);
    expect(centroidX(a) - a.foot.x).toBeGreaterThan(0);
    expect(centroidX(b) - b.foot.x).toBeGreaterThan(0);
  });
  it('shadow bounds are finite and contain the contact ellipse', () => {
    const t = drawPlant('tall', 3, 130);
    const s = shadowOf(t.img, t.foot, shadowVector({ side: -1, elevation: 35 }), false);
    expect(s.img.w).toBeLessThan(t.img.w + t.foot.y * 2); expect(s.img.h).toBeLessThan(t.img.h + t.foot.y);
    expect(s.foot.x).toBeGreaterThanOrEqual(0); expect(s.foot.y).toBeLessThan(s.img.h);
  });
});
