import { describe, expect, it } from 'vitest';
import { newFxBuf } from '../models/fx';
import { burst, crystal, thrown, groundRing, screenAxes, type BurstSpec, type MAxes } from './shapes';
import { FxTris } from './tris';

const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const ax: MAxes = screenAxes(cam, { right: [0, 0, 0], up: [0, 0, 0] });
const dump = (T: FxTris): number[] => { const o = newFxBuf(); T.flush(o, cam, false); return o.position; };

describe('shapes', () => {
  it('groundRing is flat and within r1', () => {
    const T = new FxTris(1000);
    groundRing(T, 2, 3, 0.05, 0.4, 1.5, [1, 1, 1], 0.5, 0.2, 16);
    expect(T.n).toBe(32);
    const p = dump(T);
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i + 1]).toBeCloseTo(0.05, 6);
      expect(Math.hypot(p[i] - 2, p[i + 2] - 3)).toBeLessThanOrEqual(1.5 + 1e-6);
    }
  });
  it('crystal points along dir', () => {
    const T = new FxTris(100);
    const base = [1, 0.2, 2] as const, dir = [0.6, 0.8, 0] as const, len = 0.55;
    crystal(T, base, dir, len, 0.075, 1);
    const p = dump(T);
    let far = 0, fx = 0, fy = 0, fz = 0;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i] - base[0], p[i + 1] - base[1], p[i + 2] - base[2]);
      if (d > far) { far = d; fx = p[i]; fy = p[i + 1]; fz = p[i + 2]; }
    }
    expect(fx).toBeCloseTo(base[0] + dir[0] * len, 5);
    expect(fy).toBeCloseTo(base[1] + dir[1] * len, 5);
    expect(fz).toBeCloseTo(base[2] + dir[2] * len, 5);
  });
  for (const streakOn of [false, true]) {
    const spec: BurstSpec = { x: 1, y: 0.5, z: 1, n: 20, speed: [2, 5], up: [0.1, 1.2], life: [0.3, 0.8], g: 12, drag: 0, size: 0.06, colours: [0xff8800, 0xffffff], streak: streakOn };
    it(`burst ends (streak ${streakOn})`, () => {
      for (let seed = 0; seed < 20; seed++) {
        const T = new FxTris(1000);
        burst(T, ax, spec, 0.8 + 1e-3, seed);
        expect(T.n).toBe(0);
        burst(T, ax, { ...spec, drag: 3 }, 0.8 + 1e-3, seed);
        expect(T.n).toBe(0);
      }
    });
    it(`burst motes stay above the floor (streak ${streakOn})`, () => {
      for (const drag of [0, 3]) for (let seed = 0; seed < 20; seed++) {
        const T = new FxTris(1000);
        burst(T, ax, { ...spec, y: 0.1, drag }, 0.1, seed);
        expect(T.n).toBeGreaterThan(0);
        const p = dump(T);
        // a mote's quad corners lie within size of its centre; the centre is at least 0.03 up
        for (let i = 1; i < p.length; i += 3) expect(p[i]).toBeGreaterThanOrEqual(0.03 - spec.size - 1e-6);
      }
    });
  }
  it('thrown with the default floor is the same as with the explicit 0.03, and bounces on a given floor', () => {
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
    for (const t of [0, 0.1, 0.3, 0.6, 1.2]) {
      thrown([1, 0.2, 2], [0.5, 1.5, -0.3], 3, t, a);
      thrown([1, 0.2, 2], [0.5, 1.5, -0.3], 3, t, b, 0.03);
      expect(a).toEqual(b);
    }
    // a pinned value of the unchanged path: 0.2 + 1.5 * 0.1 - 1.5 * 0.01
    thrown([1, 0.2, 2], [0.5, 1.5, -0.3], 3, 0.1, a);
    expect(a[1]).toBeCloseTo(0.335, 9);
    // a floor below zero: born on it, never below it, finite
    for (const t of [0, 0.05, 0.2, 0.5, 1]) {
      thrown([0, -0.07, 0], [0.1, 0.4, 0], 3, t, a, -0.07);
      expect(Number.isFinite(a[1])).toBe(true);
      expect(a[1]).toBeGreaterThanOrEqual(-0.07);
    }
  });
  it('thrown stays finite for a downward throw without gravity', () => {
    const o: [number, number, number] = [0, 0, 0];
    for (const t of [0, 0.1, 0.5, 2]) {
      thrown([1, 0.1, 2], [0.3, -2, 0.1], 0, t, o);
      expect(o.every(Number.isFinite)).toBe(true);
      expect(o[1]).toBeGreaterThanOrEqual(0.03);
    }
  });
});
