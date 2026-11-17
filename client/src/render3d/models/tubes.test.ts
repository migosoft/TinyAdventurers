import { describe, expect, it } from 'vitest';
import { ball, drop, tube } from './tubes';
import type { Mesh3 } from './part';

const range = (m: Mesh3, axis: number): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (let i = axis; i < m.position.length; i += 3) { lo = Math.min(lo, m.position[i]); hi = Math.max(hi, m.position[i]); }
  return [lo, hi];
};
const clean = (m: Mesh3): void => {
  expect(m.position.every(Number.isFinite)).toBe(true);
  expect(m.normal.every(Number.isFinite)).toBe(true);
  expect(m.position.length).toBe(m.normal.length);
  expect(m.index.length % 3).toBe(0);
  expect(m.index.every((i) => i < m.position.length / 3)).toBe(true);
};

describe('tube', () => {
  const m = tube([{ p: [0, 0], r: 1 }, { p: [4, 0], r: 1 }]);
  it('stays within its radius of the axis, with rounded ends', () => {
    clean(m);
    for (let i = 0; i < m.position.length; i += 3) {
      const x = m.position[i], d = Math.hypot(m.position[i + 1], m.position[i + 2], x < 0 ? x : x > 4 ? x - 4 : 0);
      expect(d).toBeLessThanOrEqual(1 + 1e-3);
    }
    const [lo, hi] = range(m, 0);
    expect(lo).toBeCloseTo(-1, 3);
    expect(hi).toBeCloseTo(5, 3);
  });
  it('has unit normals pointing away from the axis and uv within 0..1', () => {
    expect(m.uv).not.toBeNull();
    expect(m.uv!.length / 2).toBe(m.position.length / 3);
    expect(m.uv!.every((v) => v >= 0 && v <= 1)).toBe(true);
    for (let i = 0; i < m.normal.length; i += 3) {
      expect(Math.hypot(m.normal[i], m.normal[i + 1], m.normal[i + 2])).toBeCloseTo(1, 4);
    }
    // Ring vertices of the straight middle: u strictly inside the tube.
    let checked = 0;
    for (let v = 0; v < m.position.length / 3; v++) {
      const u = m.uv![v * 2];
      if (u > 0.2 && u < 0.8) {
        const dot = m.position[v * 3 + 1] * m.normal[v * 3 + 1] + m.position[v * 3 + 2] * m.normal[v * 3 + 2];
        expect(dot).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('wide flattens the sideways axis only', () => {
    const w = tube([{ p: [0, 0], r: 1, wide: 0.5 }, { p: [4, 0], r: 1, wide: 0.5 }], { ref: [0, 0, 1] });
    const [zl, zh] = range(w, 2), [yl, yh] = range(w, 1);
    expect(zh).toBeCloseTo(0.5, 1); expect(zl).toBeCloseTo(-0.5, 1);   // 18 ring points: none sits exactly at 90 degrees
    expect(zh).toBeLessThanOrEqual(0.5 + 1e-4);
    expect(yh).toBeCloseTo(1, 2); expect(yl).toBeCloseTo(-1, 2);
  });
  it('passes through the middle point of a bent tube', () => {
    const b = tube([{ p: [0, 0], r: 0.5 }, { p: [3, 3], r: 0.5 }, { p: [6, 0], r: 0.5 }]);
    clean(b);
    let best = Infinity;
    for (let i = 0; i < b.position.length; i += 3) best = Math.min(best, Math.hypot(b.position[i] - 3, b.position[i + 1] - 3, b.position[i + 2]));
    expect(best).toBeLessThanOrEqual(0.5 + 1e-3);
  });
});

describe('ball', () => {
  it('spans its three radii', () => {
    const b = ball(2, 1, 3);
    clean(b);
    expect(range(b, 0)).toEqual([expect.closeTo(-2, 3), expect.closeTo(2, 3)]);
    expect(range(b, 1)).toEqual([expect.closeTo(-1, 3), expect.closeTo(1, 3)]);
    const [zl, zh] = range(b, 2);   // 26 segments: no vertex sits exactly at 90 degrees
    expect(zh).toBeGreaterThan(2.95); expect(zh).toBeLessThanOrEqual(3 + 1e-4); expect(zl).toBeCloseTo(-zh, 3);
  });
  it('pow below 1 keeps the extents and pushes the 45 degree point out', () => {
    const round = ball(2, 1, 3), sq = ball(2, 1, 3, 0.85);
    clean(sq);
    expect(range(sq, 0)[1]).toBeCloseTo(2, 3);
    expect(range(sq, 1)[1]).toBeCloseTo(1, 3);
    const reach = (m: Mesh3): number => {
      let r = 0;
      for (let i = 0; i < m.position.length; i += 3) r = Math.max(r, Math.abs(m.position[i]) / 2 + Math.abs(m.position[i + 2]) / 3);
      return r;
    };
    expect(reach(sq)).toBeGreaterThan(reach(round) + 0.05);
  });
  it('turnZ turns positions and normals about z', () => {
    const a = ball(2, 1, 1, 1, Math.PI / 2);
    clean(a);
    expect(range(a, 0)[1]).toBeCloseTo(1, 3);
    expect(range(a, 1)[1]).toBeCloseTo(2, 3);
    for (let i = 0; i < a.normal.length; i += 3) {
      // Before the turn the ellipsoid's gradient is (x / 4, y, z); turning by 90 degrees maps (x, y) to (-y, x).
      const ox = a.position[i + 1], oy = -a.position[i], oz = a.position[i + 2], l = Math.hypot(ox / 4, oy, oz);
      expect(a.normal[i]).toBeCloseTo(-oy / l, 4);
      expect(a.normal[i + 1]).toBeCloseTo(ox / 4 / l, 4);
      expect(a.normal[i + 2]).toBeCloseTo(oz / l, 4);
    }
  });
});

describe('drop', () => {
  it('stands along its direction, sunk by `sink`', () => {
    const d = drop(1, 4, 0.5, 0.6, [0, 1, 0]);
    clean(d);
    const [lo, hi] = range(d, 1);
    expect(lo).toBeCloseTo(-0.5 - 0.24, 1);
    expect(hi).toBeCloseTo(3.6 - 0.5 + 0.18, 1);
    const t = drop(1, 4, 0.5, 0.6, [1, 0, 0]);
    clean(t);
    expect(range(t, 0)[0]).toBeCloseTo(lo, 1);
    expect(range(t, 0)[1]).toBeCloseTo(hi, 1);
  });
});
