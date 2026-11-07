import { describe, expect, it } from 'vitest';
import { bakeCloud, BAKE, cloudAlpha, cloudField, DEFAULT_CLOUDS, PERIOD, type CloudLook } from './clouds';

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

  it('drifts along +x with a slight +y at the look speed', () => {
    const look = { ...DEFAULT_CLOUDS };
    expect(cloudAlpha(500 + 14 * 10, 300 + 14 * 0.2 * 10, 10, look)).toBeCloseTo(cloudAlpha(500, 300, 0, look), 9);
  });

  it('is periodic: F(x + period, y) == F(x, y), and so in y, for every size', () => {
    for (const size of [200, 360, 700]) {
      const look = { ...DEFAULT_CLOUDS, size };
      for (let k = 0; k < 200; k++) {
        const x = (k * 97) % 3000, y = (k * 53) % 3000;
        expect(cloudField(x + PERIOD, y, look)).toBeCloseTo(cloudField(x, y, look), 9);
        expect(cloudField(x, y + PERIOD, look)).toBeCloseTo(cloudField(x, y, look), 9);
      }
    }
  });

  it('bakes the same pattern the sampler describes', () => {
    const buf = new Uint32Array(BAKE * BAKE);
    bakeCloud(buf, DEFAULT_CLOUDS);
    for (const [k, j] of [[3, 5], [100, 400], [511, 0], [250, 250]]) {
      expect(buf[j * BAKE + k] >>> 24).toBe(Math.round(cloudField((k + 0.5) * 4, (j + 0.5) * 4, DEFAULT_CLOUDS) * 255));
    }
    expect(buf.some((v) => v !== 0)).toBe(true);
  });
});
