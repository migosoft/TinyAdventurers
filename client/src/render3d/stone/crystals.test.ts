import { describe, expect, it, vi } from 'vitest';
import { BIG_SIZE, BROKEN_TOP, SMALL_SIZE, buildCrystalChunk, crystalChunkOf, crystalCluster, switchedChunks } from './crystals';
import { noMarks, type Marks } from './place';
import { torchChunkOf, type TorchMark } from '../torch/torch';

// Heavy painting and meshing: well over vitest's 5 s default on a loaded machine (#402).
vi.setConfig({ testTimeout: 30_000 });

const maxY = (p: Float32Array): number => {
  let m = -Infinity;
  for (let i = 1; i < p.length; i += 3) m = Math.max(m, p[i]);
  return m;
};

describe('crystalCluster', () => {
  it('is closed and outward, whole and broken: every edge has a twin and the volume is positive', () => {
    const bad: string[] = [];
    for (const broken of [false, true]) for (const size of [BIG_SIZE, SMALL_SIZE]) for (let seed = 1; seed <= 12; seed++) {
      const c = crystalCluster(seed, size, broken), what = `seed ${seed} size ${size} broken ${broken}`;
      const key = (i: number): string => [0, 1, 2].map((k) => Math.round(c.position[i * 3 + k] * 1e5)).join(',');
      const edges = new Map<string, number>();
      let vol = 0;
      expect(c.index.length % 3, what).toBe(0);
      expect(c.index.length, what).toBeGreaterThan(0);
      for (let t = 0; t < c.index.length; t += 3) {
        const [a, b, d] = [c.index[t], c.index[t + 1], c.index[t + 2]];
        for (const [p, q] of [[a, b], [b, d], [d, a]]) edges.set(`${key(p)}>${key(q)}`, (edges.get(`${key(p)}>${key(q)}`) ?? 0) + 1);
        const v = (i: number, k: number): number => c.position[i * 3 + k];
        vol += v(a, 0) * (v(b, 1) * v(d, 2) - v(b, 2) * v(d, 1)) - v(a, 1) * (v(b, 0) * v(d, 2) - v(b, 2) * v(d, 0)) + v(a, 2) * (v(b, 0) * v(d, 1) - v(b, 1) * v(d, 0));
        // the stored normal is the triangle's own, pointing the way its winding does
        const e1 = [0, 1, 2].map((k) => v(b, k) - v(a, k)), e2 = [0, 1, 2].map((k) => v(d, k) - v(a, k));
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (!(n[0] * c.normal[a * 3] + n[1] * c.normal[a * 3 + 1] + n[2] * c.normal[a * 3 + 2] > 0)) bad.push(`${what} normal of triangle ${t / 3}`);
      }
      for (const [e, n] of edges) {
        const [p, q] = e.split('>');
        if (n !== 1) bad.push(`${what} edge ${e}`);
        if (edges.get(`${q}>${p}`) !== 1) bad.push(`${what} twin of ${e}`);
      }
      expect(vol, what).toBeGreaterThan(0);
      expect(c.glow.length).toBe(c.position.length / 3);
      if (!c.glow.every((g) => g >= 0 && g <= 1)) bad.push(`${what} glow`);
    }
    expect(bad).toEqual([]);
  });

  it('whole: the tallest shard is about its size high; broken: no vertex above BROKEN_TOP of it', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const top = maxY(crystalCluster(seed, BIG_SIZE, false).position);
      expect(top).toBeGreaterThan(BIG_SIZE * 0.8);
      expect(top).toBeLessThanOrEqual(BIG_SIZE * 1.05);
      expect(maxY(crystalCluster(seed, BIG_SIZE, true).position)).toBeLessThanOrEqual(BROKEN_TOP * BIG_SIZE);
    }
  });

  it('differs by seed', () => {
    expect(Array.from(crystalCluster(1, 1, false).position)).not.toEqual(Array.from(crystalCluster(2, 1, false).position));
  });
});

describe('buildCrystalChunk', () => {
  const marks: Marks = { ...noMarks(), shards: [{ x: 3.5, z: 2, nx: 0, nz: 1, big: true, lightId: 7 }, { x: 20.5, z: 3.15, nx: 0, nz: 1, big: false }] };

  it('follows `broken`: a big cluster is whole while its light is on and a stump once it is off', () => {
    const asked: number[] = [];
    const whole = buildCrystalChunk(marks, (id) => (asked.push(id), false), 0, 0)!;
    expect(asked).toEqual([7]);
    expect(maxY(whole.position)).toBeGreaterThan(BIG_SIZE * 0.8);
    const stump = buildCrystalChunk(marks, () => true, 0, 0)!;
    expect(maxY(stump.position)).toBeLessThanOrEqual(BROKEN_TOP * BIG_SIZE);
    // only the whole big cluster glows; the stump glimmers
    const glow = (a: { gem: Float32Array }): number => a.gem.reduce((m, g, i) => (i % 3 === 0 ? Math.max(m, g) : m), 0);
    expect(glow(stump)).toBeLessThan(glow(whole) * 0.5);
    expect(glow(stump)).toBeGreaterThan(0);
  });

  it('stands at the wall foot in front of the wall, a small shard in its own chunk, and an empty chunk is null', () => {
    const big = buildCrystalChunk(marks, () => false, 0, 0)!;
    for (let i = 0; i < big.position.length; i += 3) {
      expect(Math.abs(big.position[i] - 3.5)).toBeLessThan(0.8);
      expect(big.position[i + 2]).toBeGreaterThan(2);   // never inside the wall's plane
      expect(big.position[i + 2]).toBeLessThan(3);
    }
    const small = buildCrystalChunk(marks, () => { throw new Error('a small shard has no light'); }, 1, 0)!;
    expect(maxY(small.position)).toBeLessThanOrEqual(SMALL_SIZE * 1.05);
    expect(small.foot.length / 2).toBe(small.position.length / 3);
    expect(buildCrystalChunk(marks, () => false, 0, 1)).toBeNull();
  });
});

describe('switchedChunks', () => {
  const marks: Marks = { ...noMarks(), shards: [{ x: 3.5, z: 2, nx: 0, nz: 1, big: true, lightId: 7 }, { x: 20.5, z: 3.15, nx: 0, nz: 1, big: false }] };

  it('marks the chunk of a light that switched, once; a small shard (no light) marks nothing', () => {
    const built = new Set<number>();
    expect(switchedChunks(marks.shards, () => false, built, crystalChunkOf)).toEqual([]);
    expect(switchedChunks(marks.shards, (id) => id === 7, built, crystalChunkOf)).toEqual([crystalChunkOf(marks.shards[0])]);
    expect(switchedChunks(marks.shards, (id) => id === 7, built, crystalChunkOf)).toEqual([]);
    expect(switchedChunks(marks.shards, () => false, built, crystalChunkOf)).toEqual([crystalChunkOf(marks.shards[0])]);
  });

  it('marks a torch\'s chunk by torchChunkOf when its light goes out or is lit; two torches of one chunk mark it once', () => {
    // the second hangs on a chunk's west edge: its wall point's chunk, not its floor tile's
    const torches: TorchMark[] = [{ x: 3.5, z: 2, nx: 0, nz: 1, lightId: 4 }, { x: 16, z: 5.5, nx: -1, nz: 0, lightId: 5 }, { x: 20.5, z: 2, nx: 0, nz: 1, lightId: 6 }];
    const built = new Set<number>();
    expect(switchedChunks(torches, () => false, built, torchChunkOf)).toEqual([]);
    expect(switchedChunks(torches, (id) => id === 4, built, torchChunkOf)).toEqual([[0, 0]]);
    expect(switchedChunks(torches, (id) => id !== 6, built, torchChunkOf)).toEqual([[1, 0]]);
    expect(switchedChunks(torches, () => false, built, torchChunkOf)).toEqual([[0, 0], [1, 0]]);
    expect(switchedChunks(torches, () => false, built, torchChunkOf)).toEqual([]);
  });
});
