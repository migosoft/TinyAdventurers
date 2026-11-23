import { describe, expect, it } from 'vitest';
import { CHUNK } from '../stone/grid';
import { FLAME_BASE_Y, FLAME_FOOT_Y, FLAME_H, FLAME_R, FLAME_STAND, PLATE_SINK, buildTorchChunk, flameMesh, flameMid, flameTip, torchChunkOf, torchHolder, type TorchMark } from './torch';

const finite = (a: ArrayLike<number>): boolean => Array.from(a).every(Number.isFinite);
/** The mean of component `k` of an array `step` wide. */
const mean = (a: Float32Array, k: number, step = 3): number => {
  let s = 0;
  for (let i = k; i < a.length; i += step) s += a[i];
  return s / (a.length / step);
};
const unitNormals = (n: Float32Array): boolean => {
  for (let i = 0; i < n.length; i += 3) if (Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) > 1e-4) return false;
  return true;
};
/** A vertex's distance from the flame's axis in the holder's frame. */
const fromAxis = (p: Float32Array, i: number): number => Math.hypot(p[i * 3] - FLAME_STAND, p[i * 3 + 2]);

describe('torchHolder', () => {
  const h = torchHolder(true), count = h.position.length / 3;

  it('holder: finite, unit normals, indices in range, colours 0..1', () => {
    expect(count).toBeGreaterThan(0);
    expect(finite(h.position) && finite(h.normal) && finite(h.colour)).toBe(true);
    expect(unitNormals(h.normal)).toBe(true);
    expect(h.normal.length).toBe(count * 3);
    expect(h.colour.length).toBe(count * 3);
    expect(h.index.length % 3).toBe(0);
    expect(h.index.every((i) => i < count)).toBe(true);
    expect(h.colour.every((c) => c >= 0 && c <= 1)).toBe(true);
  });

  it('holder: nothing behind the sunk plate', () => {
    let min = Infinity;
    for (let i = 0; i < h.position.length; i += 3) min = Math.min(min, h.position[i]);
    expect(min).toBeGreaterThanOrEqual(-PLATE_SINK - 1e-6);
    expect(min).toBeLessThanOrEqual(-PLATE_SINK + 1e-6);   // it is sunk
  });

  it('holder: the basket holds the flame', () => {
    let held = false, top = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = h.position[i * 3 + 1];
      top = Math.max(top, y);
      if (fromAxis(h.position, i) <= 0.12 && Math.abs(y - FLAME_BASE_Y) <= 0.06) held = true;
    }
    expect(held).toBe(true);
    expect(top).toBeLessThanOrEqual(FLAME_BASE_Y + 0.5 * FLAME_H);   // the flame is taller than the spikes
  });

  it('holder: lit, the fire warms the basket and nothing far from it; out, nothing', () => {
    expect(h.warm.length).toBe(count);
    expect(torchHolder(false).warm.every((w) => w === 0)).toBe(true);
    let most = 0;
    for (let i = 0; i < count; i++) {
      expect(h.warm[i]).toBeGreaterThanOrEqual(0);
      expect(h.warm[i]).toBeLessThanOrEqual(1);
      most = Math.max(most, h.warm[i]);
      // the plate, the arm and the shaft's lower part stay the room's
      if (h.position[i * 3 + 1] < FLAME_BASE_Y - 0.2) expect(h.warm[i]).toBe(0);
    }
    expect(most).toBeGreaterThan(0.5);
  });

  it('holder: out differs from lit only in colour and warmth', () => {
    const out = torchHolder(false);
    expect(Array.from(out.position)).toEqual(Array.from(h.position));
    expect(Array.from(out.normal)).toEqual(Array.from(h.normal));
    let differ = 0;
    for (let i = 0; i < count; i++) {
      if ([0, 1, 2].every((k) => out.colour[i * 3 + k] === h.colour[i * 3 + k])) continue;
      differ++;
      expect(fromAxis(h.position, i)).toBeLessThanOrEqual(0.12);
    }
    expect(differ).toBeGreaterThan(0);
  });
});

describe('flameMesh', () => {
  const f = flameMesh(1), count = f.position.length / 3;

  /** The corners of quad `q` (0 the card, 1 the halo) as [x, y] pairs in index order of its vertices. */
  const corners = (q: number): number[][] => [0, 1, 2, 3].map((k) => [f.flame[(q * 4 + k) * 4], f.flame[(q * 4 + k) * 4 + 1]]);

  it('flame: two quads, the card then the halo; finite; each a full quad of its kind', () => {
    expect(count).toBe(8);
    expect(finite(f.position) && finite(f.flame) && finite(f.reach)).toBe(true);
    expect(f.flame.length).toBe(count * 4);
    expect(f.reach.length).toBe(count * 2);
    expect(f.index.length).toBe(12);
    expect(f.index.every((i) => i < count)).toBe(true);
    // each quad's two triangles use its own four vertices, and all four
    for (const q of [0, 1]) expect(new Set(f.index.slice(q * 6, q * 6 + 6))).toEqual(new Set([0, 1, 2, 3].map((k) => q * 4 + k)));
    for (let i = 0; i < count; i++) expect(f.flame[i * 4 + 3]).toBe(i < 4 ? 0 : 1);
    // the card stands on the foot (y 0..1), the halo lies round the middle (y -1..1)
    expect(corners(0)).toEqual([[-1, 0], [1, 0], [1, 1], [-1, 1]]);
    expect(corners(1)).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  });

  it('flame: every vertex is on the axis, so the card is the same from every side: the foot for the card, the middle for the halo', () => {
    for (let i = 0; i < count; i++) {
      expect(Math.hypot(f.position[i * 3], f.position[i * 3 + 2])).toBe(0);
      expect(f.position[i * 3 + 1]).toBeCloseTo(i < 4 ? 0 : flameMid({ x: 0, z: 0, nx: 0, nz: 1 })[1] - FLAME_FOOT_Y, 6);
    }
  });

  it('flame: the card holds the whole flame with room over it; the halo is round and wider than the card', () => {
    const [across, up] = [f.reach[0], f.reach[1]], [hx, hy] = [f.reach[8], f.reach[9]];
    expect(across).toBeGreaterThan(FLAME_R);
    expect(up).toBeGreaterThan(FLAME_H);
    expect(hx).toBe(hy);
    expect(hx).toBeGreaterThan(across);
  });

  it('flame: size scales it', () => {
    const half = flameMesh(0.5);
    expect(half.position.length).toBe(f.position.length);
    for (let i = 0; i < f.position.length; i++) expect(Math.abs(half.position[i] - 0.5 * f.position[i])).toBeLessThan(1e-6);
    for (let i = 0; i < f.reach.length; i++) expect(Math.abs(half.reach[i] - 0.5 * f.reach[i])).toBeLessThan(1e-6);
    expect(Array.from(half.flame)).toEqual(Array.from(f.flame));
  });
});

describe('buildTorchChunk', () => {
  const north: TorchMark = { x: 5.5, z: 3, nx: 0, nz: 1, lightId: 2 };
  const lit = (): boolean => false;

  it('buildTorchChunk: nothing in, nothing out', () => {
    expect(buildTorchChunk([], lit, 0, 0)).toEqual({ holder: null, flame: null });
  });

  it('buildTorchChunk: a north wall torch', () => {
    const { holder, flame } = buildTorchChunk([north], lit, ...torchChunkOf(north));
    expect(Math.abs(mean(flame!.position, 0) - 5.5)).toBeLessThan(0.02);
    expect(Math.abs(mean(flame!.position, 2) - (3 + FLAME_STAND))).toBeLessThan(0.02);
    for (let i = 0; i < flame!.position.length / 3; i++) {
      expect(flame!.flame[i * 4 + 2]).toBeCloseTo(3.4, 5);
      expect([flame!.foot[i * 2], flame!.foot[i * 2 + 1]]).toEqual([5.5, 3.5]);
      expect(flame!.position[i * 3 + 1]).toBeGreaterThanOrEqual(FLAME_FOOT_Y - 1e-6);
    }
    expect(flame!.reach.length / 2).toBe(flame!.position.length / 3);
    expect(flame!.foot.length / 2).toBe(flame!.position.length / 3);
    expect(holder!.foot.length / 2).toBe(holder!.position.length / 3);
    for (let i = 0; i < holder!.position.length / 3; i++) {
      expect([holder!.foot[i * 2], holder!.foot[i * 2 + 1]]).toEqual([5.5, 3.5]);
      expect(holder!.position[i * 3 + 2]).toBeGreaterThanOrEqual(3 - PLATE_SINK - 1e-6);
    }
  });

  it('buildTorchChunk: a west and an east wall torch are turned', () => {
    for (const nx of [1, -1]) {
      const t: TorchMark = { x: 8, z: 4.5, nx, nz: 0, lightId: 1 };
      const { holder, flame } = buildTorchChunk([t], lit, ...torchChunkOf(t));
      expect(Math.abs(mean(flame!.position, 0) - (8 + nx * FLAME_STAND))).toBeLessThan(0.02);
      expect(Math.abs(mean(flame!.position, 2) - 4.5)).toBeLessThan(0.02);
      expect(unitNormals(holder!.normal)).toBe(true);
    }
  });

  it('buildTorchChunk: an out torch has a holder and no flame', () => {
    const { holder, flame } = buildTorchChunk([north], () => true, ...torchChunkOf(north));
    expect(holder).not.toBeNull();
    expect(flame).toBeNull();
  });

  it('buildTorchChunk: only the chunk\'s own torches', () => {
    const far: TorchMark = { x: CHUNK + 5.5, z: 3, nx: 0, nz: 1, lightId: 3 };
    expect(torchChunkOf(north)).toEqual([0, 0]);
    expect(torchChunkOf(far)).toEqual([1, 0]);
    const one = buildTorchChunk([north], lit, 0, 0), both = buildTorchChunk([north, far], lit, 0, 0);
    expect(both.holder!.position.length).toBe(one.holder!.position.length);
    expect(both.flame!.position.length).toBe(one.flame!.position.length);
    expect(buildTorchChunk([north, far], lit, 0, 1)).toEqual({ holder: null, flame: null });
  });

  it('buildTorchChunk: two torches at one floor tile are both built', () => {
    // the floor tile (5, 3): one on its north wall, one on its west wall
    const west: TorchMark = { x: 5, z: 3.5, nx: 1, nz: 0, lightId: 4 };
    const one = buildTorchChunk([north], lit, 0, 0), two = buildTorchChunk([north, west], lit, 0, 0);
    expect(two.holder!.position.length).toBe(2 * one.holder!.position.length);
    expect(two.flame!.position.length).toBe(2 * one.flame!.position.length);
    // the second flame's triangles use its own vertices
    const n = one.flame!.position.length / 3;
    expect(Array.from(two.flame!.index)).toEqual([...one.flame!.index, ...Array.from(one.flame!.index, (i) => i + n)]);
  });

  it('flameMid / flameTip', () => {
    const close = (a: number[], b: number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    // the foot is in the fuel, under its top
    expect(FLAME_FOOT_Y).toBeLessThan(FLAME_BASE_Y);
    close(flameMid(north), [5.5, FLAME_FOOT_Y + 0.4 * FLAME_H, 3 + FLAME_STAND]);
    close(flameTip(north), [5.5, FLAME_FOOT_Y + FLAME_H, 3 + FLAME_STAND]);
  });
});
