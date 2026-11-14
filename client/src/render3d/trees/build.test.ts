import { describe, expect, it } from 'vitest';
import { SUN_TOP } from '../sun';
import { buildTree } from './build';
import { crownCoverage } from './coverage.testutil';
import { RAMP, SHAPE, mirrorX } from './mesh';
import type { TreeForm, TreeSpec } from './spec';

const spec = (form: TreeForm, seed: number, scalePct = 100, extra: Partial<TreeSpec> = {}): TreeSpec => ({ form, x: 0, z: 0, seed, scalePct, mirrored: false, leaf: 1, dead: false, ...extra });
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const FORMS = ['round', 'wide', 'tall'] as const;
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

/** Crown width and height from the leaf vertices (tufts and core balls). */
function crownSize(s: TreeSpec): { w: number; h: number } {
  const m = buildTree(s).mesh;
  let r = 0, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < m.verts; i++) {
    const shape = m.part[i * 4 + 1];
    if (shape !== SHAPE.tuft && shape !== SHAPE.core) continue;
    r = Math.max(r, Math.hypot(m.position[i * 3], m.position[i * 3 + 2]));
    y0 = Math.min(y0, m.position[i * 3 + 1]); y1 = Math.max(y1, m.position[i * 3 + 1]);
  }
  return { w: 2 * r, h: y1 - y0 };
}
const ratio = (f: TreeForm) => mean(seeds.map((s) => { const c = crownSize(spec(f, s)); return c.w / c.h; }));

describe('buildTree', () => {
  it('is deterministic', () => {
    for (const f of FORMS) {
      const a = buildTree(spec(f, 7)).mesh, b = buildTree(spec(f, 7)).mesh;
      for (const k of ['position', 'normal', 'grad', 'sway', 'part', 'misc', 'tuft', 'index'] as const) expect(a[k]).toEqual(b[k]);
    }
  });

  it('removes lobes in a fixed order as the leaf amount falls', () => {
    for (const f of FORMS) for (const s of seeds) {
      const t = buildTree(spec(f, s));
      const present = (a: number) => new Set(t.lobes.map((l, i) => [l, i] as const).filter(([l]) => l.th <= a).map(([, i]) => i));
      expect(present(0).size).toBe(0);
      expect(present(1).size).toBe(t.lobes.length);
      let prev = present(1);
      for (const a of [0.9, 0.75, 0.6, 0.5, 0.4, 0.25, 0.1, 0]) {
        const cur = present(a);
        for (const i of cur) expect(prev.has(i)).toBe(true);
        prev = cur;
      }
      // the mesh agrees with the lobe list
      const th = new Set<number>();
      for (let i = 0; i < t.mesh.verts; i++) if (t.mesh.part[i * 4 + 1] === SHAPE.tuft || t.mesh.part[i * 4 + 1] === SHAPE.core) th.add(t.mesh.misc[i * 4 + 3]);
      expect([...th].sort()).toEqual([...new Set(t.lobes.map((l) => l.th))].sort());
    }
  });

  it('thins for real: coverage at 0.75, 0.5 and 0.25 against full, and none at 0', () => {
    for (const f of FORMS) {
      const cov = (a: number) => seeds.map((s) => crownCoverage(buildTree(spec(f, s)), a));
      const c1 = cov(1), c75 = cov(0.75), c5 = cov(0.5), c25 = cov(0.25), c0 = cov(0);
      expect(mean(c75)).toBeLessThanOrEqual(0.85 * mean(c1));
      expect(mean(c5)).toBeLessThanOrEqual(0.62 * mean(c1));
      expect(mean(c25)).toBeLessThanOrEqual(0.38 * mean(c1));
      expect(Math.max(...c0)).toBe(0);
      seeds.forEach((_, i) => {
        expect(c75[i]).toBeLessThan(c1[i]);
        expect(c5[i]).toBeLessThan(c75[i]);
        expect(c25[i]).toBeLessThan(c5[i]);
        expect(c0[i]).toBeLessThan(c25[i]);
      });
    }
  });

  it('tells the three silhouettes apart by shape: crown width over height', () => {
    const tall = ratio('tall'), round = ratio('round'), wide = ratio('wide');
    expect(tall).toBeLessThanOrEqual(0.8);
    expect(round).toBeGreaterThanOrEqual(0.95);
    expect(round).toBeLessThanOrEqual(1.3);
    expect(wide).toBeGreaterThanOrEqual(1.6);
    expect(wide).toBeGreaterThanOrEqual(1.3 * round);
    expect(tall).toBeLessThanOrEqual(0.75 * round);
  });

  it('a dead tree is the living tree at leaf 0 without its leaves: same wood, dead ramp, no sway', () => {
    for (const s of seeds) {
      const live = buildTree(spec('round', s)).mesh, dead = buildTree(spec('round', s, 100, { dead: true })).mesh;
      const wood = (m: typeof live) => { const out: number[] = []; for (let i = 0; i < m.verts; i++) if (m.part[i * 4 + 1] === SHAPE.wood) out.push(...m.position.slice(i * 3, i * 3 + 3)); return out; };
      expect(dead.position).toEqual(wood(live));
      for (let i = 0; i < dead.verts; i++) {
        expect(dead.part[i * 4 + 1]).toBe(SHAPE.wood);
        expect(dead.part[i * 4]).toBe(RAMP.dead);
        expect(dead.sway[i * 2]).toBe(0);
      }
      let top = 0;
      for (let i = 0; i < live.verts; i++) {
        if (live.part[i * 4 + 1] === SHAPE.wood) expect(live.part[i * 4]).toBe(RAMP.bark);
        top = Math.max(top, live.sway[i * 2]);
      }
      expect(top).toBeGreaterThan(0.05);
    }
  });

  it('a living tree at leaf 0 still sways; wood is never thresholded', () => {
    const m = buildTree(spec('wide', 4)).mesh;
    for (let i = 0; i < m.verts; i++) if (m.part[i * 4 + 1] === SHAPE.wood) expect(m.misc[i * 4 + 3]).toBe(0);
  });

  it('stays under the sun map height at every scale', () => {
    for (const f of FORMS) for (const sc of [50, 80, 100, 120]) for (const s of seeds.slice(0, 10)) {
      const t = buildTree(spec(f, s, sc));
      expect(t.height).toBeLessThanOrEqual(SUN_TOP);
      for (let i = 1; i < t.mesh.position.length; i += 3) expect(t.mesh.position[i]).toBeLessThanOrEqual(SUN_TOP);
    }
  }, 30000);

  it('reaches at least as far as its leaves', () => {
    for (const f of FORMS) for (const s of seeds.slice(0, 5)) {
      const t = buildTree(spec(f, s)), m = t.mesh;
      for (let i = 0; i < m.verts; i++) expect(Math.hypot(m.position[i * 3], m.position[i * 3 + 2])).toBeLessThanOrEqual(t.radius + 1e-6);
    }
  });

  it('mirrors left to right', () => {
    for (const f of FORMS) {
      const a = buildTree(spec(f, 9)), b = buildTree(spec(f, 9, 100, { mirrored: true }));
      expect(b.mesh.position).toEqual(mirrorX(a.mesh).position);
      expect(b.lobes[0].x).toBeCloseTo(-a.lobes[0].x, 6);
    }
  });

  it('says plainly that the other forms are not built yet', () => {
    expect(() => buildTree(spec('conifer', 1))).toThrow(/not built/);
  });
});
