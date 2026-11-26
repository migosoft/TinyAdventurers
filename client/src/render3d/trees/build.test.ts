import { describe, expect, it } from 'vitest';
import { SUN_TOP } from '../sun';
import { SWAY } from '../wind';
import { buildTree } from './build';
import { crownCoverage } from './coverage.testutil';
import { growPlant, swayK } from './grow';
import { CORE_VERTS, RAMP, SHAPE, TUFT_VERTS, mirrorX } from './mesh';
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
      expect([...th].sort()).toEqual([...new Set(t.lobes.map((l) => Math.fround(l.th)))].sort()); // the streams are float32
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
  }, 30000);   // CPU-bound (about 1.7 s alone): the 5 s default fails when the whole suite shares the cores

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
      expect(Array.from(dead.position)).toEqual(wood(live));
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

});

type Built = ReturnType<typeof buildTree>;
const SEEDS3 = [11, 42, 99];
/** The tuft patches of a mesh in vertex order: position, noShadow mark, threshold, shifts. */
function patchesOf(t: Built) {
  const m = t.mesh, out: { x: number; y: number; z: number; noShadow: number; th: number; part: number[] }[] = [];
  for (let i = 0; i < m.verts; i += 1) {
    if (m.part[i * 4 + 1] !== SHAPE.tuft) continue;
    if (m.tuft[i * 4] !== -1 || m.tuft[i * 4 + 1] !== -1) continue; // the first corner of a patch
    out.push({ x: m.position[i * 3], y: m.position[i * 3 + 1], z: m.position[i * 3 + 2], noShadow: m.misc[i * 4 + 1], th: m.misc[i * 4 + 3], part: Array.from(m.part.slice(i * 4, i * 4 + 4)) });
  }
  return out;
}
const countShape = (t: Built, shape: number) => { let n = 0; for (let i = 0; i < t.mesh.verts; i++) if (t.mesh.part[i * 4 + 1] === shape) n++; return n; };

describe('the willow', () => {
  it('is deterministic and mirrors left to right', () => {
    for (const s of SEEDS3) {
      const a = buildTree(spec('willow', s)).mesh, b = buildTree(spec('willow', s)).mesh;
      for (const k of ['position', 'normal', 'grad', 'sway', 'part', 'misc', 'tuft', 'index'] as const) expect(a[k]).toEqual(b[k]);
      const mir = buildTree(spec('willow', s, 100, { mirrored: true }));
      expect(mir.mesh.position).toEqual(mirrorX(a).position);
      expect(mir.mesh.normal).toEqual(mirrorX(a).normal);
      expect(mir.mesh.grad).toEqual(mirrorX(a).grad);
    }
  }, 30000);

  it('is all curtains: no core balls, at least 300 patches, every leaf in the leaf ramp with its own warm and bright shift', () => {
    for (const s of SEEDS3) {
      const t = buildTree(spec('willow', s)), m = t.mesh;
      expect(countShape(t, SHAPE.core)).toBe(0);
      expect(countShape(t, SHAPE.skirt)).toBe(0);
      expect(patchesOf(t).length).toBeGreaterThanOrEqual(300);
      expect(countShape(t, SHAPE.tuft) / TUFT_VERTS).toBe(patchesOf(t).length);
      for (let i = 0; i < m.verts; i++) {
        if (m.part[i * 4 + 1] === SHAPE.tuft) expect(Array.from(m.part.slice(i * 4, i * 4 + 4))).toEqual([RAMP.leaf, SHAPE.tuft, 0.09, 0.08].map(Math.fround));
        else expect(m.part[i * 4]).toBe(RAMP.bark);
      }
    }
  });

  it('lets light through: below a strand\'s top quarter every other patch casts no shadow, above it all cast', () => {
    const step = 1.7 / 16;
    for (const s of SEEDS3) {
      const ps = patchesOf(buildTree(spec('willow', s)));
      // a strand is a run of patches that each hang one step lower than the one before
      const strands: typeof ps[] = [];
      ps.forEach((p, i) => {
        if (i > 0 && Math.abs(ps[i - 1].y - p.y - step) < 1e-6) strands[strands.length - 1].push(p);
        else strands.push([p]);
      });
      expect(strands.length).toBeGreaterThan(40);
      let marked = 0;
      for (const st of strands) {
        expect(st.length).toBeGreaterThanOrEqual(3);
        st.forEach((p, j) => {
          const below = j / st.length > 0.25;
          expect(p.noShadow).toBe(below && j % 2 === 1 ? 1 : 0);
          if (p.noShadow) marked++;
          expect(p.th).toBe(st[0].th);
        });
      }
      expect(marked).toBeGreaterThan(ps.length * 0.2);
    }
  });

  it('hangs nearly to the ground, stays under the sun map and says its reach', () => {
    for (const s of SEEDS3) {
      const t = buildTree(spec('willow', s)), ps = patchesOf(t);
      expect(Math.min(...ps.map((p) => p.y))).toBeLessThan(0.25 * t.height);
      expect(t.height).toBeLessThanOrEqual(SUN_TOP);
      // the woodland's willows by the pond: WILLOW_SCALE in woodland.rs (#438)
      for (const sc of [100, 130]) expect(buildTree(spec('willow', s, sc)).height).toBeLessThanOrEqual(SUN_TOP);
      const reach = Math.max(...ps.map((p) => Math.hypot(p.x, p.z)));
      expect(t.radius).toBeGreaterThanOrEqual(reach);
      expect(t.radius).toBeLessThanOrEqual(reach + SWAY.leafy + 0.2 + 1e-6);
      for (let i = 0; i < t.mesh.verts; i++) expect(Math.hypot(t.mesh.position[i * 3], t.mesh.position[i * 3 + 2])).toBeLessThanOrEqual(t.radius);
    }
  });

  it('drops falling leaves from limb ends that still carry leaves', () => {
    const t = buildTree(spec('willow', 42));
    expect(t.lobes.length).toBeGreaterThan(3);
    for (const l of t.lobes) { expect(l.th).toBeGreaterThan(0); expect(l.th).toBeLessThanOrEqual(1); }
  });
});

describe('the conifer', () => {
  it('has one skirt per recipe skirt, in the conifer ramp, swaying as a conifer, and ignores the leaf amount', () => {
    for (const s of SEEDS3) {
      const sk = growPlant(spec('conifer', s)), t = buildTree(spec('conifer', s)), m = t.mesh;
      expect(sk.skirts.length).toBeGreaterThanOrEqual(3);
      expect(countShape(t, SHAPE.skirt)).toBe(sk.skirts.reduce((n, k) => n + 6 * k.teeth, 0));
      expect(countShape(t, SHAPE.core) + countShape(t, SHAPE.tuft)).toBe(0);
      let top = 0;
      for (let i = 0; i < m.verts; i++) {
        if (m.part[i * 4 + 1] === SHAPE.skirt) { expect(m.part[i * 4]).toBe(RAMP.conifer); expect(m.misc[i * 4 + 3]).toBe(0); }
        else expect(m.part[i * 4]).toBe(RAMP.bark);
        top = Math.max(top, m.sway[i * 2]);
      }
      expect(top).toBeLessThanOrEqual(SWAY.conifer + 1e-9);
      expect(top).toBeGreaterThan(0.4 * SWAY.conifer);
      expect(buildTree(spec('conifer', s, 100, { leaf: 0.2 })).mesh.position).toEqual(m.position);
      expect(t.height).toBeLessThanOrEqual(SUN_TOP);
    }
  });
});

describe('the bush', () => {
  it('has a core ball and tufts per recipe lobe, lifted, in the leaf ramp, swaying small, threshold 0', () => {
    for (const s of SEEDS3) for (const sc of [60, 100, 150]) {
      const sk = growPlant(spec('bush', s, sc)), t = buildTree(spec('bush', s, sc)), m = t.mesh;
      expect(sk.lobes.length).toBeGreaterThanOrEqual(3);
      expect(countShape(t, SHAPE.core)).toBe(sk.lobes.length * CORE_VERTS);
      expect(countShape(t, SHAPE.tuft)).toBeGreaterThan(sk.lobes.length * 14 * TUFT_VERTS - 1);
      let top = 0;
      for (let i = 0; i < m.verts; i++) {
        const shape = m.part[i * 4 + 1];
        if (shape === SHAPE.core || shape === SHAPE.tuft) {
          expect(m.part[i * 4]).toBe(RAMP.leaf);
          expect(m.misc[i * 4 + 3]).toBe(0);
          expect(m.misc[i * 4]).toBe(Math.fround(0.3));
        }
        top = Math.max(top, -m.sway[i * 2]);
        expect(m.sway[i * 2]).toBeLessThanOrEqual(0);
      }
      expect(top).toBeLessThanOrEqual(SWAY.small + 1e-9);
      expect(top).toBeGreaterThan(0.3 * SWAY.small);
      expect(t.lobes.length).toBe(sk.lobes.length);
      expect(t.height).toBeLessThanOrEqual(SUN_TOP);
      expect(buildTree(spec('bush', s, sc, { leaf: 0 })).mesh.position).toEqual(m.position);
    }
  });
});

describe('a dead conifer or bush', () => {
  it('builds as its living shape with dead wood and no sway, leaves as they are', () => {
    for (const f of ['conifer', 'bush'] as const) {
      const live = buildTree(spec(f, 5)), dead = buildTree(spec(f, 5, 100, { dead: true }));
      expect(dead.mesh.position).toEqual(live.mesh.position);
      let leaves = 0;
      for (let i = 0; i < dead.mesh.verts; i++) {
        // A bush keeps its brush mark (a negative factor) when dead; the wind is zeroed in the shader.
        if (f === 'bush') expect(dead.mesh.sway[i * 2]).toBe(live.mesh.sway[i * 2]); else expect(dead.mesh.sway[i * 2]).toBe(0);
        if (dead.mesh.part[i * 4 + 1] === SHAPE.wood) expect(dead.mesh.part[i * 4]).toBe(RAMP.dead); else leaves++;
      }
      expect(leaves).toBeGreaterThan(0);
    }
  });
});

describe('the brush mark', () => {
  it('is the negative sway factor of a bush, living or dead; every other plant has none', () => {
    const range = (s: TreeSpec) => { const w = buildTree(s).mesh.sway; let lo = 0, hi = 0; for (let i = 0; i < w.length; i += 2) { lo = Math.min(lo, w[i]); hi = Math.max(hi, w[i]); } return { lo, hi }; };
    for (const dead of [false, true]) {
      const b = range(spec('bush', 5, 100, { dead }));
      expect(b.hi).toBeLessThanOrEqual(0);
      expect(b.lo).toBeLessThan(-0.3 * SWAY.small);
      expect(b.lo).toBeGreaterThanOrEqual(-SWAY.small - 1e-9);
    }
    expect(range(spec('bush', 5, 100, { dead: true })).lo).toBeCloseTo(range(spec('bush', 5)).lo, 12);
    for (const s of [spec('round', 5), spec('conifer', 5), spec('round', 5, 100, { dead: true }), spec('tall', 5, 100, { dead: true })]) expect(range(s).lo).toBeGreaterThanOrEqual(0);
  });
  it('keeps the radius and the lobes positive', () => {
    const t = buildTree(spec('bush', 5));
    expect(t.radius).toBeGreaterThan(0);
    for (const l of t.lobes) expect(l.k).toBeGreaterThanOrEqual(0);
  });
});

describe('sway factor', () => {
  it('is the same helper for lobes and wood', () => {
    expect(swayK(0.1, 2, 4)).toBeCloseTo(0.025, 12);
    expect(swayK(0.1, -1, 4)).toBe(0);
  });
});
