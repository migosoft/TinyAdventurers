import { describe, expect, it } from 'vitest';
import { GH, GW, blur, inflate } from './grid';

describe('grid', () => {
  it('inflates a disc to a ball: highest in the middle, nothing outside', () => {
    const cx = GW / 2, cy = GH / 2, inside = new Uint8Array(GW * GH);
    for (let Y = 0; Y < GH; Y++) for (let X = 0; X < GW; X++) if (Math.hypot(X - cx, Y - cy) < 30) inside[Y * GW + X] = 1;
    const { hgt } = inflate(inside);
    const mid = hgt[Math.floor(cy) * GW + Math.floor(cx)];
    let max = 0;
    for (let i = 0; i < hgt.length; i++) {
      max = Math.max(max, hgt[i]);
      if (!inside[i]) expect(hgt[i]).toBe(0);
    }
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeGreaterThanOrEqual(max * 0.99);
    expect(hgt[Math.floor(cy) * GW + Math.floor(cx) + 25]).toBeLessThan(mid * 0.7);
  });

  it('keeps the sum of an interior impulse when it blurs', () => {
    const w = 40, h = 40, a = new Float32Array(w * h);
    a[20 * w + 20] = 100;
    blur(a, w, h, 3);
    let sum = 0;
    for (const v of a) sum += v;
    expect(sum).toBeCloseTo(100, 3);
    expect(a[20 * w + 20]).toBeLessThan(100);
  });
});
