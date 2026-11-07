import { describe, expect, it } from 'vitest';
import { CLOUD_SCALE, cloudAlpha, DEFAULT_CLOUDS, fillCloud, type CloudLook } from './clouds';

describe('cloudAlpha', () => {
  it('is within [0, dark], covers part of the map and moves with t', () => {
    const look: CloudLook = { ...DEFAULT_CLOUDS };
    let min = 1, max = 0, shaded = 0, n = 0, moved = 0;
    for (let y = 0; y < 2000; y += 20) for (let x = 0; x < 2000; x += 20) {
      const a = cloudAlpha(x, y, 3, look);
      min = Math.min(min, a); max = Math.max(max, a);
      n++; if (a > 0.01) shaded++;
      if (Math.abs(cloudAlpha(x, y, 30, look) - a) > 0.01) moved++;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(look.dark + 1e-9);
    expect(shaded / n).toBeGreaterThan(0.1);
    expect(shaded / n).toBeLessThan(0.7);
    expect(moved).toBeGreaterThan(n / 20);
  });

  it('drifts along +x at the look speed', () => {
    const look = { ...DEFAULT_CLOUDS };
    expect(cloudAlpha(500 + 14 * 10, 300 + 14 * 0.2 * 10, 10, look)).toBeCloseTo(cloudAlpha(500, 300, 0, look), 9);
  });

  it('costs little for a full-screen quarter-resolution frame', () => {
    const w = Math.ceil(1280 / CLOUD_SCALE) + 3, h = Math.ceil(720 / CLOUD_SCALE) + 3;
    const buf = new Uint32Array(w * h);
    fillCloud(buf, w, h, 0, 0, 0, DEFAULT_CLOUDS); // warm up
    const t0 = performance.now();
    const N = 20;
    for (let k = 1; k <= N; k++) fillCloud(buf, w, h, 100, 100, k, DEFAULT_CLOUDS);
    const ms = (performance.now() - t0) / N;
    console.log(`cloudAlpha: ${w}x${h} = ${w * h} px, ${ms.toFixed(2)} ms per frame`);
    expect(ms).toBeLessThan(15);
    expect(buf.some((v) => v !== 0)).toBe(true);
  });
});
