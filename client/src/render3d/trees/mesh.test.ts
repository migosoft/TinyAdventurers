import { describe, expect, it } from 'vitest';
import { CORE_VERTS, RAMP, SHAPE, TUFT_VERTS, TreeMesh, appendAt, coreBall, mirrorX, skirt, tube, tuftPatch, tufts, type Lobe3, type P3 } from './mesh';

const grad = () => [0.1, 0.2, 0.3, 0.4] as [number, number, number, number];
const lens = (m: TreeMesh) => {
  const v = m.verts;
  expect([m.position.length, m.normal.length, m.grad.length, m.part.length, m.misc.length, m.tuft.length]).toEqual([v * 3, v * 3, v * 4, v * 4, v * 4, v * 4]);
  expect(m.sway.length).toBe(v * 2);
  expect(Math.max(-1, ...m.index)).toBeLessThan(v);
};
const lobe: Lobe3 = { x: 0.5, y: 2, z: -0.25, rx: 6 / 16, ry: 5 / 16, rz: 6 / 16, k: 0.04 };
const seq = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

describe('tube', () => {
  it('3 points x 6 sides: 18 vertices, 24 triangles, equal streams', () => {
    const m = new TreeMesh(), pts: P3[] = [0, 1, 2].map((i) => ({ x: 0, y: i * 0.5, z: 0, w: 0.1 }));
    tube(m, pts, 6, RAMP.bark, (y) => y * 0.1, () => 0.5, true);
    expect([m.verts, m.tris]).toEqual([18, 24]);
    lens(m);
    expect(m.part[1]).toBe(SHAPE.wood);
    expect(m.misc[2]).toBe(1);
    expect(m.misc[3]).toBe(0);
  });
});

describe('coreBall', () => {
  it('adds 42 vertices and 80 triangles', () => {
    const m = new TreeMesh();
    coreBall(m, lobe, RAMP.leaf, grad, 0.3);
    expect([m.verts, m.tris]).toEqual([42, 80]);
    lens(m);
    expect(m.misc[3]).toBe(0.3);
    expect(m.part[1]).toBe(SHAPE.core);
  });
});

describe('tufts', () => {
  it('adds 4 vertices per patch, 14..64 patches', () => {
    const m = new TreeMesh();
    tufts(m, lobe, grad, 0.5, seq(), RAMP.leaf, [0.09, 0.08]);
    expect(m.verts % 4).toBe(0);
    expect(m.verts / 4).toBeGreaterThanOrEqual(14);
    expect(m.verts / 4).toBeLessThanOrEqual(64);
    expect(m.tris).toBe(m.verts / 2);
    lens(m);
    expect(m.part.slice(0, 4)).toEqual([RAMP.leaf, SHAPE.tuft, 0.09, 0.08]);
  });
});

describe('skirt', () => {
  it('builds a cone with three rings', () => {
    const m = new TreeMesh();
    skirt(m, { radius: 0.5, top: 2, height: 0.6, jag: 0.1, droop: 0.08, k: 0.03, anchor: 1.4, dark: 0, teeth: 6 });
    expect([m.verts, m.tris]).toEqual([36, 48]);
    lens(m);
  });
});

const sample = () => {
  const m = new TreeMesh();
  tube(m, [{ x: 0.1, y: 0, z: 0, w: 0.1 }, { x: 0.2, y: 1, z: 0.1, w: 0.08 }], 5, RAMP.bark, () => 0, () => 0, true);
  coreBall(m, lobe, RAMP.leaf, grad, 0);
  return m;
};

describe('mirrorX', () => {
  it('negates x and keeps the rest; twice is the original', () => {
    const m = sample(), r = mirrorX(m);
    for (let i = 0; i < m.position.length; i++) expect(r.position[i]).toBe(i % 3 === 0 ? -m.position[i] : m.position[i]);
    for (let i = 0; i < m.normal.length; i++) expect(r.normal[i]).toBe(i % 3 === 0 ? -m.normal[i] : m.normal[i]);
    for (let i = 0; i < m.grad.length; i++) expect(r.grad[i]).toBe(i % 4 === 0 ? -m.grad[i] : m.grad[i]);
    expect(r.sway).toEqual(m.sway); expect(r.part).toEqual(m.part); expect(r.misc).toEqual(m.misc); expect(r.tuft).toEqual(m.tuft);
    expect(r.index.slice(0, 3)).toEqual([m.index[0], m.index[2], m.index[1]]);
    expect(mirrorX(r)).toEqual(m);
  });
});

describe('appendAt', () => {
  it('moves positions by (x, 0, z) and offsets indices', () => {
    const out = sample(), m = sample(), v0 = out.verts, i0 = out.index.length;
    appendAt(out, m, 3, -2);
    expect(out.verts).toBe(v0 * 2);
    for (let i = 0; i < m.position.length; i += 3) {
      expect(out.position[v0 * 3 + i]).toBeCloseTo(m.position[i] + 3, 6);
      expect(out.position[v0 * 3 + i + 1]).toBe(m.position[i + 1]);
      expect(out.position[v0 * 3 + i + 2]).toBeCloseTo(m.position[i + 2] - 2, 6);
    }
    expect(out.index.slice(i0)).toEqual(m.index.map((i) => i + v0));
    lens(out);
  });
});

describe('vertex counts', () => {
  it('match what the primitives add', () => {
    const a = new TreeMesh();
    coreBall(a, lobe, RAMP.leaf, grad, 0);
    expect(a.verts).toBe(CORE_VERTS);
    const b = new TreeMesh();
    tuftPatch(b, { p: [0, 1, 0], n: [0, 1, 0], grad: [0, 0, 0, 0], sway: [0, 1], ramp: RAMP.leaf, th: 0, size: 0.1, seed: 3 });
    expect(b.verts).toBe(TUFT_VERTS);
  });
});

describe('tuftPatch', () => {
  it('writes one camera-facing patch with its own streams: normal, gradient, shift, no-shadow mark, threshold', () => {
    const m = new TreeMesh();
    tuftPatch(m, { p: [1, 2, 3], n: [0.1, 0.9, 0], grad: [0.2, 0.3, 0.4, 0.5], sway: [0.04, 1.5], ramp: RAMP.leaf, shift: [0.09, 0.08], noShadow: true, th: 0.6, size: 0.07, seed: 11 });
    expect([m.verts, m.tris]).toEqual([4, 2]);
    lens(m);
    for (let i = 0; i < 4; i++) {
      expect(m.position.slice(i * 3, i * 3 + 3)).toEqual([1, 2, 3]);
      expect(m.normal.slice(i * 3, i * 3 + 3)).toEqual([0.1, 0.9, 0]);
      expect(m.grad.slice(i * 4, i * 4 + 4)).toEqual([0.2, 0.3, 0.4, 0.5]);
      expect(m.sway.slice(i * 2, i * 2 + 2)).toEqual([0.04, 1.5]);
      expect(m.part.slice(i * 4, i * 4 + 4)).toEqual([RAMP.leaf, SHAPE.tuft, 0.09, 0.08]);
      expect(m.misc.slice(i * 4, i * 4 + 4)).toEqual([0, 1, 0, 0.6]);
      expect(m.tuft.slice(i * 4 + 2, i * 4 + 4)).toEqual([0.07, 11]);
    }
    expect(m.tuft.slice(0, 2)).toEqual([-1, -1]);
    expect(m.tuft.slice(8, 10)).toEqual([1, 1]);
  });

  it('casts a shadow unless told otherwise', () => {
    const m = new TreeMesh();
    tuftPatch(m, { p: [0, 0, 0], n: [0, 1, 0], grad: [0, 0, 0, 0], sway: [0, 0], ramp: RAMP.leaf, th: 0, size: 0.1, seed: 0 });
    expect(m.misc[1]).toBe(0);
    expect(m.misc[0]).toBe(0);
  });
});

describe('light lift', () => {
  it('is 0 by default and set on core balls and tufts when given', () => {
    const a = new TreeMesh(), b = new TreeMesh();
    coreBall(a, lobe, RAMP.leaf, grad, 0); tufts(a, lobe, grad, 0, seq(), RAMP.leaf);
    for (let i = 0; i < a.verts; i++) expect(a.misc[i * 4]).toBe(0);
    coreBall(b, lobe, RAMP.leaf, grad, 0, 0.3); tufts(b, lobe, grad, 0, seq(), RAMP.leaf, [0, 0], 0.3);
    for (let i = 0; i < b.verts; i++) expect(b.misc[i * 4]).toBe(0.3);
    expect(b.position).toEqual(a.position);
  });
});
