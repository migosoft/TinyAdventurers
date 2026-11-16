import { describe, expect, it } from 'vitest';
import { PITCH_MAX } from '../params';
import { CHUNK } from '../worldMesh';
import { buildTree, type BuiltTree } from './build';
import { ChunkSync } from './chunks';
import { FLUTTER_PX } from './mesh';
import { Forest } from './forest';
import type { TreeForm, TreeSpec } from './spec';
import { plantVariation } from './variation';
import { SWAY_WAVE_MAX } from '../wind';

const spec = (x: number, z: number, seed = 1, extra: Partial<TreeSpec> = {}): TreeSpec => ({ form: 'round' as TreeForm, x, z, seed, scalePct: 100, mirrored: false, leaf: 1, dead: false, ...extra });
const MAP = { w: 48, h: 32 }; // 3 x 2 chunks
const COS = Math.cos((PITCH_MAX * Math.PI) / 180);

/** A builder that records the specs it was asked for and moves a fake clock by `cost` ms each call. */
function counting(cost = 0) {
  const clock = { now: 0 };
  const calls: TreeSpec[] = [];
  const build = (s: TreeSpec): BuiltTree => { calls.push(s); clock.now += cost; return buildTree(s); };
  return { clock, calls, build, now: () => clock.now };
}
const make = (specs: TreeSpec[], c = counting()) => new Forest(specs, MAP, 0, c.build, c.now);

describe('Forest.step', () => {
  it('builds nearest the camera first', () => {
    const specs = [spec(30, 10, 1), spec(2, 2, 2), spec(10, 4, 3), spec(20, 20, 4)];
    const c = counting();
    const f = make(specs, c);
    f.step({ x: 0, z: 0 }, 1000);
    expect(c.calls.map((s) => s.seed)).toEqual([2, 3, 4, 1]);
    expect(f.built).toBe(4);
    expect(f.total).toBe(4);
  });
  it('stops once the budget is spent, and builds at least one look per call even over budget', () => {
    const specs = Array.from({ length: 8 }, (_, i) => spec(1 + i, 1, i + 1));
    const c = counting(10);
    const f = make(specs, c);
    expect(f.step({ x: 0, z: 0 }, 0)).toBe(1);
    expect(f.built).toBe(1);
    const n = f.step({ x: 0, z: 0 }, 25);
    // Each build costs 10 ms and the slowest seen is 10: a second one fits (10 + 10 <= 25), a third does not (20 + 10 > 25).
    expect(n).toBe(2);
    expect(f.built).toBe(1 + n);
    while (f.built < 8) f.step({ x: 0, z: 0 }, 25);
    expect(f.step({ x: 0, z: 0 }, 25)).toBe(0);
  });
  it('builds equal looks once and shares them, also across feet and leaf amounts', () => {
    const c = counting();
    const f = make([spec(2, 2, 5), spec(20, 3, 5, { leaf: 0.3 }), spec(35, 9, 5), spec(4, 4, 6)], c);
    f.step({ x: 0, z: 0 }, 1000);
    expect(c.calls.length).toBe(2);
    expect(f.built).toBe(4);
  });
  it('does not share a dead plant with a living one, nor a mirrored one with an unmirrored one', () => {
    const c = counting();
    const f = make([spec(2, 2, 5), spec(3, 2, 5, { dead: true }), spec(4, 2, 5, { mirrored: true })], c);
    f.step({ x: 0, z: 0 }, 1000);
    expect(c.calls.length).toBe(3);
  });
});

describe('Forest.frame', () => {
  it('says complete once every tree is built', () => {
    const f = make([spec(2, 2, 1), spec(3, 3, 2)], counting(10));
    expect(f.frame({ wind: true, t: 0 }).complete).toBe(false);
    f.step({ x: 0, z: 0 }, 0);
    expect(f.frame({ wind: true, t: 0 }).complete).toBe(false);
    f.step({ x: 0, z: 0 }, 1000);
    expect(f.frame({ wind: true, t: 0 }).complete).toBe(true);
  });

  it('grows a chunk version with each plant added', () => {
    const f = make([spec(2, 2, 1), spec(3, 3, 2), spec(40, 3, 3)]);
    expect(f.frame({ wind: true, t: 0 }).versions.size).toBe(0);
    f.step({ x: 0, z: 0 }, 1000);
    const v = f.frame({ wind: true, t: 0 }).versions;
    expect(v.get(0)).toBe(2);
    expect(v.get(2)).toBe(1);
  });
  it('carries the options and defaults', () => {
    const f = new Forest([], MAP, 3);
    const fr = f.frame({ wind: false, t: 4.5 });
    expect(fr).toMatchObject({ palette: 3, wind: false, t: 4.5, leafOverride: -1, plain: false });
    expect(f.frame({ wind: true, t: 0, leafOverride: 0.5, plain: true })).toMatchObject({ leafOverride: 0.5, plain: true });
  });
  it('holds each plant\'s foot, leaf, dead flag and variation on every one of its vertices', () => {
    const specs = [spec(2.5, 3.25, 1, { leaf: 0.4 }), spec(6.125, 9, 2, { dead: true, leaf: 0.8 }), spec(7, 5, 1, { leaf: 0.9 })];
    const f = make(specs);
    f.step({ x: 0, z: 0 }, 1000);
    const ch = f.frame({ wind: true, t: 0 }).chunks.get(0)!;
    const n = ch.mesh.verts;
    expect(ch.mesh.plant.length).toBe(n * 4);
    expect(ch.mesh.look.length).toBe(n * 4);
    // Order of appending is nearest first: (2.5,3.25), (7,5), (6.125,9)
    const order = [specs[0], specs[2], specs[1]];
    const counts = order.map((s) => buildTree(s).mesh.verts);
    let at = 0;
    order.forEach((s, k) => {
      const v = plantVariation(s.x, s.z), sway = buildTree(s).mesh.sway;
      for (let i = at; i < at + counts[k]; i++) {
        // Packed: foot x, z, the leaf amount (-1 when dead), the vertex's anchor height.
        expect(Array.from(ch.mesh.plant.slice(i * 4, i * 4 + 4))).toEqual([s.x, s.z, s.dead ? -1 : s.leaf, sway[(i - at) * 2 + 1]].map(Math.fround));
        expect(Array.from(ch.mesh.look.slice(i * 4, i * 4 + 4))).toEqual(v.map(Math.fround));
      }
      at += counts[k];
    });
    expect(at).toBe(n);
  });
  it('keeps every vertex, the sway and the stretched height inside the chunk bounds, also across a chunk border', () => {
    const specs = [spec(CHUNK - 0.1, 8, 3, { form: 'wide' }), spec(CHUNK + 0.05, 20, 4, { form: 'tall' }), spec(0.2, 0.2, 5, { scalePct: 130 }), spec(47.9, 31.9, 6), spec(30, 20, 7, { form: 'willow' })];
    const f = make(specs);
    f.step({ x: 0, z: 0 }, 1000);
    const fr = f.frame({ wind: true, t: 0 });
    const nx = Math.ceil(MAP.w / CHUNK);
    for (const s of specs) {
      const key = Math.min(1, Math.floor(s.z / CHUNK)) * nx + Math.min(nx - 1, Math.floor(s.x / CHUNK));
      const ch = fr.chunks.get(key)!;
      const b = buildTree(s);
      // Every patch corner (centre +/- half-size on each axis) plus the sway and the flutter, and at least 0.3 tiles around every vertex.
      const flutter = (2 * FLUTTER_PX) / 16;
      let maxHalf = 0, maxSway = 0;
      // Plain loops, no matcher per vertex: keep the worst overshoot of each bound with its vertex, assert once per bound.
      const worst = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0 };
      const at = { minX: -1, maxX: -1, minZ: -1, maxZ: -1, maxY: -1 };
      const over = (key: keyof typeof worst, amount: number, i: number) => { if (amount > worst[key]) { worst[key] = amount; at[key] = i; } };
      for (let i = 0; i < b.mesh.verts; i++) {
        // The sway stream is the factor; the drawn offset is up to SWAY_WAVE_MAX times it, and the patch spread (camera right + up) reaches sqrt 2 times the half-size.
        const half = b.mesh.tuft[i * 4 + 2], sway = b.mesh.sway[i * 2] * SWAY_WAVE_MAX, r = Math.max(0.3, half * Math.SQRT2 + sway + flutter), [px, py, pz] = [b.mesh.position[i * 3] + s.x, b.mesh.position[i * 3 + 1], b.mesh.position[i * 3 + 2] + s.z];
        maxHalf = Math.max(maxHalf, half);
        maxSway = Math.max(maxSway, sway);
        over('minX', ch.bounds.min.x - (px - r + 1e-6), i);
        over('maxX', px + r - 1e-6 - ch.bounds.max.x, i);
        over('minZ', ch.bounds.min.z - (pz - r + 1e-6), i);
        over('maxZ', pz + r - 1e-6 - ch.bounds.max.z, i);
        over('maxY', py + half - 1e-6 - ch.bounds.max.y, i);
      }
      for (const key of Object.keys(worst) as (keyof typeof worst)[]) expect({ key, vertex: at[key], overshoot: worst[key] }).toEqual({ key, vertex: -1, overshoot: 0 });
      expect(maxHalf).toBeGreaterThan(0.1);
      if (s.form === 'willow') expect(maxSway).toBeGreaterThan(0.2); // the strand tips swing more than a leafy crown
      expect(ch.bounds.max.y).toBeGreaterThanOrEqual((b.height + maxHalf) / COS - 1e-6);
    }
    // the plant on the border reaches past its chunk's cell, and is still inside its own chunk's bounds
    expect(fr.chunks.get(0)!.bounds.max.x).toBeGreaterThan(CHUNK);
  });
  it('keeps every chunk consistent after a step without a new frame call', () => {
    const f = make([spec(2, 2, 1), spec(3, 3, 2), spec(40, 20, 3), spec(20, 3, 4)]);
    const fr = f.frame({ wind: true, t: 0 });
    f.step({ x: 0, z: 0 }, 1000);
    expect(fr.chunks.size).toBe(3);
    for (const [k, c] of fr.chunks) {
      for (const s of [c.mesh.nrm, c.mesh.grad, c.mesh.part, c.mesh.misc, c.mesh.tuft, c.mesh.plant, c.mesh.look]) expect(s.length / 4).toBe(c.mesh.verts);
      expect(Math.max(-1, ...c.mesh.index)).toBeLessThan(c.mesh.verts);
      expect(fr.versions.has(k)).toBe(true);
    }
    for (const k of fr.versions.keys()) expect(fr.chunks.has(k)).toBe(true);
  });
  it('gives a living tree with leaf 0 leaf 0 (not dead) on all its vertices', () => {
    const f = make([spec(2, 2, 1, { leaf: 0 })]);
    f.step({ x: 0, z: 0 }, 1000);
    const ch = f.frame({ wind: true, t: 0 }).chunks.get(0)!;
    expect(ch.mesh.verts).toBeGreaterThan(0);
    const plant = ch.mesh.plant;
    for (let i = 0; i < ch.mesh.verts; i++) expect(plant[i * 4 + 2]).toBe(0);
  });
  it('marks a dead plant dead (-1) whatever its spec\'s leaf amount says', () => {
    const f = make([spec(2, 2, 1, { dead: true, leaf: 1 })]);
    f.step({ x: 0, z: 0 }, 1000);
    const ch = f.frame({ wind: true, t: 0 }).chunks.get(0)!;
    const plant = ch.mesh.plant;
    for (let i = 0; i < ch.mesh.verts; i++) expect(plant[i * 4 + 2]).toBe(-1);
  });
  it('reports every chunk to a new consumer through ChunkSync', () => {
    const f = make([spec(2, 2, 1), spec(40, 20, 2)]);
    f.step({ x: 0, z: 0 }, 1000);
    const v = f.frame({ wind: true, t: 0 }).versions;
    expect(new ChunkSync().changed(v).sort()).toEqual([0, 5]);
    const s = new ChunkSync();
    s.changed(v);
    expect(s.changed(f.frame({ wind: true, t: 0 }).versions)).toEqual([]);
  });
  it('gathers the falling leaves of its trees per chunk, one per lobe, with the plant\'s own leaf amount and colour', () => {
    const specs = [spec(2, 2, 1), spec(3, 3, 2, { leaf: 0.4 }), spec(30, 10, 5, { form: 'willow' }), spec(5, 5, 6, { dead: true }), spec(6, 6, 7, { form: 'conifer' }), spec(7, 7, 8, { form: 'bush' })];
    const f = make(specs);
    f.step({ x: 0, z: 0 }, 1000);
    const fr = f.frame({ wind: true, t: 0 });
    const lobes = (s: TreeSpec) => buildTree(s).lobes.length;
    const a = fr.chunks.get(0)!.leaves;
    // Chunk 0 holds the two leafy trees, the dead one, the conifer and the bush; only the two leafy ones drop leaves.
    expect(a.n).toBe(lobes(specs[0]) + lobes(specs[1]));
    expect(a.start).toHaveLength(a.n * 3);
    expect(a.leaf).toHaveLength(a.n);
    expect(a.look).toHaveLength(a.n * 4);
    expect([...new Set(a.leaf.map((v) => Math.fround(v)))].sort()).toEqual([Math.fround(0.4), 1].sort());
    expect(a.look.slice(0, 4)).toEqual(plantVariation(2, 2));
    // The willow's leaves take its own warmer, lighter shift.
    const nx = Math.ceil(MAP.w / CHUNK);
    const w = fr.chunks.get(Math.floor(10 / CHUNK) * nx + Math.floor(30 / CHUNK))!.leaves;
    const wv = plantVariation(30, 10);
    expect(w.n).toBe(lobes(specs[2]));
    expect(w.look.slice(0, 4)).toEqual([wv[0] + 0.08, wv[1] + 0.09, wv[2], wv[3]]);
  });
  it('grows a chunk\'s leaves as trees are added, and hands the leaf rate on', () => {
    const f = make([spec(2, 2, 1), spec(4, 4, 2)], counting(10));
    f.step({ x: 0, z: 0 }, 0);
    const ch = f.frame({ wind: true, t: 0 }).chunks.get(0)!;
    const n1 = ch.leaves.n;
    expect(n1).toBeGreaterThan(2);
    f.step({ x: 0, z: 0 }, 1000);
    expect(ch.leaves.n).toBeGreaterThan(n1);
    expect(f.frame({ wind: true, t: 0 }).leafRate).toBe(1);
    expect(f.frame({ wind: true, t: 0, leafRate: 12 }).leafRate).toBe(12);
  });
});
