import { describe, expect, it } from 'vitest';
import { armMesh, band, hatCone, hull, legMesh, ring, shell, spike } from './addons';
import type { SpikeDesc } from './desc';
import type { Mesh3, PartRow } from './part';

const ROWS: PartRow[] = Array.from({ length: 12 }, (_, i) => ({ Y: 30 + i * 4, a: 40, b: 60, c: 49.5, rc: 10, deep: 1.4 }));
const sane = (m: Mesh3): void => {
  const n = m.position.length / 3;
  expect(n).toBeGreaterThan(8);
  expect(m.normal.length).toBe(m.position.length);
  expect(m.index.length % 3).toBe(0);
  for (const i of m.index) expect(i).toBeLessThan(n);
  for (const v of m.position) expect(Number.isFinite(v)).toBe(true);
  for (const v of m.normal) expect(Number.isFinite(v)).toBe(true);
};
const SPIKE: SpikeDesc = { colour: 'c', row: 17.3, dir: [-0.05, 1, 0.16], radius: 1.7, length: 4.8, sink: 1.3, shape: 'drop', flat: 0.65, flatAxis: 'x' };

describe('hull', () => {
  const m = spike({ ...SPIKE, shape: 'ball' }, [0, 1, 0]);

  it('keeps the vertex count, moves each vertex by w along its normal and reverses every triangle', () => {
    const h = hull(m, 0.4);
    expect(h.position.length).toBe(m.position.length);
    for (let i = 0; i < m.position.length; i++) expect(h.position[i]).toBeCloseTo(m.position[i] + m.normal[i] * 0.4, 5);
    expect(h.index.length).toBe(m.index.length);
    for (let t = 0; t < m.index.length; t += 3) {
      expect([h.index[t], h.index[t + 1], h.index[t + 2]]).toEqual([m.index[t], m.index[t + 2], m.index[t + 1]]);
    }
  });

  it('leaves the piece alone', () => {
    const before = m.position.slice();
    hull(m, 1);
    expect(m.position).toEqual(before);
  });
});

describe('spike', () => {
  // The widest angle between two normals at one place: the sharpness of the tip (a cone's apex is the sharpest).
  const sharpest = (m: Mesh3): number => {
    const n = m.position.length / 3;
    let worst = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(m.position[i * 3] - m.position[j * 3], m.position[i * 3 + 1] - m.position[j * 3 + 1], m.position[i * 3 + 2] - m.position[j * 3 + 2]);
      if (d > 0.05) continue;
      const dot = m.normal[i * 3] * m.normal[j * 3] + m.normal[i * 3 + 1] * m.normal[j * 3 + 1] + m.normal[i * 3 + 2] * m.normal[j * 3 + 2];
      worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, dot))));
    }
    return worst * 180 / Math.PI;
  };

  it('has a drop with no vertex where two normals differ by more than 90 degrees (a cone\'s apex has over 110)', () => {
    // As built, before the page's flattening (`flat`) squeezes the tip: the wolf's ear, the wizard's and the dwarf's beard.
    for (const [r, l] of [[1.7, 4.8], [4.3, 8.6], [4.6, 5.6]]) {
      const s: SpikeDesc = { ...SPIKE, radius: r, length: l, flat: undefined };
      expect(sharpest(spike(s, [0, 1, 0]))).toBeLessThan(90);
      expect(sharpest(spike({ ...s, shape: undefined }, [0, 1, 0]))).toBeGreaterThan(110);
    }
  });

  it('keeps the flattened drops (as approved on the page) blunter than a cone', () => {
    expect(sharpest(spike(SPIKE, [-0.05, 1, 0.16]))).toBeLessThan(115);
  });

  it('makes a cone, a ball and a plume that start at the sunk foot and reach the length along dir', () => {
    for (const shape of [undefined, 'ball', 'drop', 'wave'] as const) {
      const s: SpikeDesc = { ...SPIKE, shape, wave: 0.2, flat: undefined }, m = spike(s, [0, 1, 0]);
      sane(m);
      let lo = Infinity, hi = -Infinity;
      for (let k = 1; k < m.position.length; k += 3) { lo = Math.min(lo, m.position[k]); hi = Math.max(hi, m.position[k]); }
      expect(lo, String(shape)).toBeCloseTo(-1.3, 1);
      expect(hi, String(shape)).toBeCloseTo(4.8 - 1.3, 1);
    }
  });
});

describe('pieces round the base', () => {
  it('shell, ring and band give valid meshes', () => {
    sane(shell(ROWS, 8, 1, { thick: 0.6, from: 6, cover: [0.7, 0.7, 0.7] }));
    sane(ring(ROWS, 8, 1, { row: 20, like: 7, out: 1, thick: 0.3, high: 0.3 }));
    sane(band(ROWS, 8, 1, { row: 20, like: 7, gap: 40, back: 2, tip: 1, tilt: 20, thick: 0.2 }));
  });

  it('puts a ring at the row asked for', () => {
    const m = ring(ROWS, 8, 1, { row: 20, like: 7, out: 1, thick: 0.3, high: 0.3 });
    let lo = Infinity, hi = -Infinity;
    for (let k = 1; k < m.position.length; k += 3) { lo = Math.min(lo, m.position[k]); hi = Math.max(hi, m.position[k]); }
    expect((lo + hi) / 2).toBeCloseTo(28 - 20, 5);
  });
});

describe('hat, leg and arm shapes', () => {
  it('builds a hat cone between two heights', () => {
    const m = hatCone(5.2, 9.5, -2.2, 0, 1, 0);
    sane(m);
    let hi = -Infinity;
    for (let k = 1; k < m.position.length; k += 3) hi = Math.max(hi, m.position[k]);
    expect(hi).toBeCloseTo(9.5, 5);
  });

  it('hangs the leg from the hip and the arm and hand from the shoulder', () => {
    const leg = legMesh({ top: 25, colour: 'd', radius: 1.55, foot: 0.8, apart: 1.9 }, 4);
    sane(leg);
    let lo = Infinity, hi = -Infinity;
    for (let k = 1; k < leg.position.length; k += 3) { lo = Math.min(lo, leg.position[k]); hi = Math.max(hi, leg.position[k]); }
    expect(lo).toBeCloseTo(-4, 5);
    expect(hi).toBeCloseTo(0, 5);
    const { arm, hand } = armMesh({ row: 19.6, colour: 'g', hand: 's', radius: 0.95, length: 4.2 });
    sane(arm); sane(hand);
    let ay = Infinity, hy = Infinity;
    for (let k = 1; k < arm.position.length; k += 3) ay = Math.min(ay, arm.position[k]);
    for (let k = 1; k < hand.position.length; k += 3) hy = Math.min(hy, hand.position[k]);
    expect(ay).toBeCloseTo(-4.2 + 0.95, 4);   // the arm's end cap is the hand's
    expect(hy).toBeLessThan(-4.2 + 0.95 * 1.05);
  });
});
