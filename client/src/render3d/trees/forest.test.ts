import { describe, expect, it } from 'vitest';
import { PITCH_MAX } from '../params';
import { CHUNK } from '../worldMesh';
import { buildTree, type BuiltTree } from './build';
import { ChunkSync } from './chunks';
import { FLUTTER_PX } from './mesh';
import { Forest } from './forest';
import type { TreeForm, TreeSpec } from './spec';
import { plantVariation } from './variation';

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
    expect(ch.plant.length).toBe(n * 4);
    expect(ch.look.length).toBe(n * 4);
    // Order of appending is nearest first: (2.5,3.25), (7,5), (6.125,9)
    const order = [specs[0], specs[2], specs[1]];
    const counts = order.map((s) => buildTree(s).mesh.verts);
    let at = 0;
    order.forEach((s, k) => {
      const v = plantVariation(s.x, s.z);
      for (let i = at; i < at + counts[k]; i++) {
        expect(Array.from(ch.plant.slice(i * 4, i * 4 + 4))).toEqual([s.x, s.z, s.dead ? 0 : Math.fround(s.leaf), s.dead ? 1 : 0].map(Math.fround));
        expect(Array.from(ch.look.slice(i * 4, i * 4 + 4))).toEqual(v.map(Math.fround));
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
      for (let i = 0; i < b.mesh.verts; i++) {
        const half = b.mesh.tuft[i * 4 + 2], sway = b.mesh.sway[i * 2], r = Math.max(0.3, half + sway + flutter), [px, py, pz] = [b.mesh.position[i * 3] + s.x, b.mesh.position[i * 3 + 1], b.mesh.position[i * 3 + 2] + s.z];
        maxHalf = Math.max(maxHalf, half);
        maxSway = Math.max(maxSway, sway);
        expect(ch.bounds.min.x).toBeLessThanOrEqual(px - r + 1e-6);
        expect(ch.bounds.max.x).toBeGreaterThanOrEqual(px + r - 1e-6);
        expect(ch.bounds.min.z).toBeLessThanOrEqual(pz - r + 1e-6);
        expect(ch.bounds.max.z).toBeGreaterThanOrEqual(pz + r - 1e-6);
        expect(ch.bounds.max.y).toBeGreaterThanOrEqual(py + half - 1e-6);
      }
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
      expect(c.plant.length / 4).toBe(c.mesh.verts);
      expect(c.look.length / 4).toBe(c.mesh.verts);
      expect(fr.versions.has(k)).toBe(true);
    }
    for (const k of fr.versions.keys()) expect(fr.chunks.has(k)).toBe(true);
  });
  it('gives a living tree with leaf 0 leaf 0 and dead 0 on all its vertices', () => {
    const f = make([spec(2, 2, 1, { leaf: 0 })]);
    f.step({ x: 0, z: 0 }, 1000);
    const ch = f.frame({ wind: true, t: 0 }).chunks.get(0)!;
    expect(ch.mesh.verts).toBeGreaterThan(0);
    for (let i = 0; i < ch.mesh.verts; i++) { expect(ch.plant[i * 4 + 2]).toBe(0); expect(ch.plant[i * 4 + 3]).toBe(0); }
  });
  it('leaves leaf 0 on a dead plant whatever its spec says', () => {
    const f = make([spec(2, 2, 1, { dead: true, leaf: 1 })]);
    f.step({ x: 0, z: 0 }, 1000);
    const ch = f.frame({ wind: true, t: 0 }).chunks.get(0)!;
    for (let i = 0; i < ch.mesh.verts; i++) { expect(ch.plant[i * 4 + 2]).toBe(0); expect(ch.plant[i * 4 + 3]).toBe(1); }
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
});
