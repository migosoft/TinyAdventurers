import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { CHUNK, KIND } from '../worldMesh';
import { planSheets } from '../stone/plan';
import { ROCK, stoneField } from '../stone/field';
import { buildStoneChunk } from '../stone/mesh';
import { placeMarks } from '../stone/place';
import { DIP_RES, buildDipChunk as buildWithPlan, dipClassChanged, type DipChunk } from './dipMesh';
import { CHASM_BED, DIP, LIP, bedAt, inDipMesh, isChasm, isLava, isWater, kindOf, maskAt, nearAt } from './shape';

/** `buildDipChunk` as the view calls it, with the plan of the map's own layout. */
const buildDipChunk = (m: TileMap, painted: boolean, cx: number, cz: number): DipChunk | null => buildWithPlan(m, painted, cx, cz, planSheets(m));

const CH: Record<string, number> = { '#': TILE_ID.Wall, '.': TILE_ID.Floor, '~': TILE_ID.ShallowWater, C: TILE_ID.Chasm, L: TILE_ID.Lava };
const filled = (w: number, h: number, id = TILE_ID.Floor) => new TileMap(w, h, new Uint8Array(w * h).fill(id));
/** A w x h open floor room (no walls at all) with the given cells set. */
function open(w: number, h: number, cells: [number, number, number][]) {
  const m = filled(w, h);
  for (const [x, z, id] of cells) m.set(x, z, id);
  return m;
}
const R = DIP_RES, V = (R + 1) * (R + 1);

describe('dipClassChanged (F2)', () => {
  it('is false for a door toggle and any change that leaves the dip class, height and ground kind alone', () => {
    expect(dipClassChanged(TILE_ID.DoorOpen, TILE_ID.DoorClosed)).toBe(false);
    expect(dipClassChanged(TILE_ID.DoorClosed, TILE_ID.DoorOpen)).toBe(false);
    expect(dipClassChanged(TILE_ID.ShallowWater, TILE_ID.ShallowWater)).toBe(false);
  });
  it('is true between shallow and deep water (the bed and the deep plate differ)', () => {
    expect(dipClassChanged(TILE_ID.ShallowWater, TILE_ID.DeepWater)).toBe(true);
    expect(dipClassChanged(TILE_ID.DeepWater, TILE_ID.ShallowWater)).toBe(true);
  });
  it('is true when the dip kind, the height or the painted ground kind changes', () => {
    expect(dipClassChanged(TILE_ID.Floor, TILE_ID.Chasm)).toBe(true);
    expect(dipClassChanged(TILE_ID.Lava, TILE_ID.Floor)).toBe(true);
    expect(dipClassChanged(TILE_ID.Wall, TILE_ID.Floor)).toBe(true);
    expect(dipClassChanged(TILE_ID.Floor, TILE_ID.DoorClosed)).toBe(true); // a woodland's ground tile becomes a floor frame
  });
});

describe('buildDipChunk', () => {
  it('has no chunk without terrain', () => {
    expect(buildDipChunk(filled(6, 6), false, 0, 0)).toBeNull();
  });

  it('covers the terrain cell and its eight neighbours', () => {
    const c = buildDipChunk(open(9, 9, [[4, 4, TILE_ID.Chasm]]), false, 0, 0)!;
    expect(c.arrays.count).toBe(9 * V);
    expect(c.arrays.index.length).toBe(9 * 2 * R * R * 3);
    expect(c.arrays.position.length).toBe(9 * V * 3);
    const cells = new Set<string>();
    for (let v = 0; v < c.arrays.count; v += V) cells.add(`${Math.floor(c.arrays.position[v * 3])},${Math.floor(c.arrays.position[v * 3 + 2])}`);
    expect([...cells].sort()).toEqual(['3,3', '3,4', '3,5', '4,3', '4,4', '4,5', '5,3', '5,4', '5,5']);
  });

  it('lies on bedAt', () => {
    const m = open(9, 9, [[4, 4, TILE_ID.Chasm], [6, 6, TILE_ID.ShallowWater]]);
    const c = buildDipChunk(m, false, 0, 0)!;
    const p = c.arrays.position;
    for (let v = 0; v < c.arrays.count; v++) expect(p[v * 3 + 1]).toBeCloseTo(bedAt(m, p[v * 3], p[v * 3 + 2]), 2);
  });

  it('agrees with its neighbour on a shared edge, also across a chunk border', () => {
    const m = open(34, 9, [[15, 4, TILE_ID.ShallowWater], [16, 4, TILE_ID.ShallowWater]]);
    const heights = new Map<string, number>();
    let shared = 0;
    for (const cx of [0, 1]) {
      const c = buildDipChunk(m, false, cx, 0)!;
      const p = c.arrays.position;
      for (let v = 0; v < c.arrays.count; v++) {
        const key = `${p[v * 3].toFixed(4)},${p[v * 3 + 2].toFixed(4)}`;
        const y = p[v * 3 + 1];
        const was = heights.get(key);
        if (was !== undefined) { expect(y).toBe(was); shared++; }
        heights.set(key, y);
      }
    }
    expect(shared).toBeGreaterThan(R);
    expect(heights.has('16.0000,4.5000')).toBe(true);
  });

  it('meets the stone mesh along shared cell edges at equal heights, in laid stone and in rock', () => {
    const m = open(16, 16, [[3, 3, TILE_ID.Chasm], [4, 3, TILE_ID.Chasm], [10, 4, TILE_ID.Lava], [10, 5, TILE_ID.Lava], [5, 10, TILE_ID.ShallowWater], [6, 10, TILE_ID.DeepWater], [6, 11, TILE_ID.DeepWater]]);
    const plan = planSheets(m);
    /** The height of every vertex that faces up on an edge between a dip-mesh cell and a floor cell of the stone mesh, by its point. */
    const onJoin = (position: Float32Array, normal: Float32Array, count: number): number[] => {
      const ys: number[] = [];
      for (let v = 0; v < count; v++) {
        const x = position[v * 3], z = position[v * 3 + 2];
        if (normal[v * 3 + 1] < 0.5) continue;
        const cells = [[Math.floor(x - 1e-3), Math.floor(z - 1e-3)], [Math.floor(x + 1e-3), Math.floor(z - 1e-3)], [Math.floor(x - 1e-3), Math.floor(z + 1e-3)], [Math.floor(x + 1e-3), Math.floor(z + 1e-3)]];
        if (cells.some(([i, j]) => inDipMesh(m, i, j)) && cells.some(([i, j]) => !inDipMesh(m, i, j))) ys.push(position[v * 3 + 1]);
      }
      return ys;
    };
    const dip = buildWithPlan(m, false, 0, 0, plan)!.arrays;
    const dipYs = onJoin(dip.position, dip.normal, dip.count);
    expect(dipYs.length).toBeGreaterThan(R * 8);
    for (const kinds of [null, new Uint8Array(16 * 16).fill(ROCK)]) {
      const f = stoneField(m, kinds, 7), stone = buildStoneChunk(m, f, plan, placeMarks(m, f, { lights: [], spawn: { x: 1.5, z: 14.5 } }), 0, 0);
      const stoneYs = onJoin(stone.position, stone.normal, stone.count);
      expect(stoneYs.length).toBeGreaterThan(8);
      for (const y of [...dipYs, ...stoneYs]) expect(y).toBeCloseTo(0, 6);
    }
  });

  it('carries its own chunk\'s ground layer in `sheet`', () => {
    const m = open(34, 9, [[4, 4, TILE_ID.Lava], [20, 4, TILE_ID.Lava]]);
    const plan = planSheets(m);
    expect(plan.groundOf(1, 0)).not.toBe(plan.groundOf(0, 0));
    for (const cx of [0, 1]) {
      const { sheet, position: p, count } = buildWithPlan(m, false, cx, 0, plan)!.arrays;
      for (let v = 0; v < count; v++) {
        expect(sheet[v * 3 + 2]).toBe(plan.groundOf(cx, 0));
        expect(sheet[v * 3]).toBeCloseTo((p[v * 3] - cx * CHUNK) * 32, 3);
      }
    }
  });

  it('faces up', () => {
    const c = buildDipChunk(open(9, 9, [[4, 4, TILE_ID.Chasm], [2, 2, TILE_ID.Lava]]), false, 0, 0)!;
    const { position: p, normal: n, index } = c.arrays;
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, d] = [index[t], index[t + 1], index[t + 2]];
      const e1 = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k]), e2 = [0, 1, 2].map((k) => p[d * 3 + k] - p[a * 3 + k]);
      expect(e1[2] * e2[0] - e1[0] * e2[2], `triangle ${t / 3}`).toBeGreaterThan(0);
    }
    for (let v = 0; v < c.arrays.count; v++) {
      expect(Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2])).toBeCloseTo(1, 5);
      expect(n[v * 3 + 1]).toBeGreaterThan(0);
    }
  });

  it('takes the normal by central differences of bedAt at one grid step (1 / DIP_RES), position.y exactly bedAt', () => {
    const m = open(34, 9, [[15, 4, TILE_ID.Chasm], [16, 4, TILE_ID.Lava], [16, 5, TILE_ID.Lava]]);
    const h = 1 / R;
    for (const cx of [0, 1]) {
      const c = buildDipChunk(m, false, cx, 0)!;
      const { position: p, normal: n } = c.arrays;
      let checked = 0;
      for (let v = 0; v < c.arrays.count; v++) {
        if (n[v * 3 + 1] === 0) continue; // a skirt vertex (horizontal normal)
        const x = p[v * 3], z = p[v * 3 + 2];
        if (Math.abs(p[v * 3 + 1] - bedAt(m, x, z)) > 1e-6) continue; // a skirt's top vertex on the wall side: y = 0
        const dx = (bedAt(m, x + h, z) - bedAt(m, x - h, z)) / (2 * h);
        const dz = (bedAt(m, x, z + h) - bedAt(m, x, z - h)) / (2 * h);
        const len = Math.hypot(dx, 1, dz);
        // (positions are float32: the point is rounded a little, so the tolerance is not exact)
        expect(p[v * 3 + 1]).toBeCloseTo(bedAt(m, x, z), 5);
        expect(n[v * 3]).toBeCloseTo(-dx / len, 3);
        expect(n[v * 3 + 1]).toBeCloseTo(1 / len, 3);
        expect(n[v * 3 + 2]).toBeCloseTo(-dz / len, 3);
        checked++;
      }
      expect(checked).toBeGreaterThan(V);
    }
  });

  it('carries the floor of its cell', () => {
    const m = open(9, 9, [[4, 4, TILE_ID.Chasm]]);
    const c = buildDipChunk(m, false, 0, 0)!;
    const { position: p, kind, sheet } = c.arrays;
    expect(sheet.length).toBe(c.arrays.count * 3);
    for (let v = 0; v < c.arrays.count; v++) {
      // stone: the floor kind with no atlas rect; the ground sheet's texel of the vertex's world point in the chunk's page
      expect(kind[v]).toBe(KIND.floor);
      expect([sheet[v * 3], sheet[v * 3 + 1], sheet[v * 3 + 2]]).toEqual([p[v * 3] * 32, p[v * 3 + 2] * 32, 0]);
    }
  });

  it('carries the marks and the kind of every vertex', () => {
    const m = open(11, 9, [[3, 4, TILE_ID.Chasm], [4, 4, TILE_ID.Chasm], [7, 4, TILE_ID.Lava], [5, 7, TILE_ID.ShallowWater]]);
    const c = buildDipChunk(m, false, 0, 0)!;
    const arrays = c.arrays as unknown as Record<string, Float32Array | undefined>;
    expect(arrays.rim).toBeUndefined();
    expect(arrays.near).toBeUndefined();
    const { position: p, marks, dip, count } = c.arrays;
    expect(marks.length).toBe(count * 3);
    const seen = [0, 0, 0, 0];
    for (let v = 0; v < count; v++) {
      const x = p[v * 3], z = p[v * 3 + 2], n = [0, 0];
      nearAt(m, x, z, n, 0);
      expect(marks[v * 3]).toBeCloseTo(maskAt(m, x, z, isChasm), 6);
      expect(marks[v * 3 + 1]).toBeCloseTo(n[0], 6);
      expect(marks[v * 3 + 2]).toBeCloseTo(n[1], 6);
      expect(dip[v]).toBe(kindOf(maskAt(m, x, z, isWater), maskAt(m, x, z, isLava), maskAt(m, x, z, isChasm)));
      seen[dip[v]]++;
    }
    for (const k of seen) expect(k).toBeGreaterThan(0);
    // The marks end where the mesh ends: on the outer border of the cells beside the chasm nothing is near.
    const one = buildDipChunk(open(9, 9, [[4, 4, TILE_ID.Chasm]]), false, 0, 0)!.arrays;
    for (let v = 0; v < one.count; v++) {
      const x = one.position[v * 3], z = one.position[v * 3 + 2];
      if (x === 3 || x === 6 || z === 3 || z === 6) expect(one.marks[v * 3 + 2]).toBeCloseTo(0, 6);
    }
  });
  it('names the bank', () => {
    const m = open(9, 9, [[4, 4, TILE_ID.Chasm]]);
    const c = buildDipChunk(m, false, 0, 0)!;
    const { position: p, dip } = c.arrays;
    const at = (x: number, z: number) => {
      for (let v = 0; v < c.arrays.count; v++) if (Math.abs(p[v * 3] - x) < 1e-5 && Math.abs(p[v * 3 + 2] - z) < 1e-5) return dip[v];
      throw new Error('no vertex');
    };
    expect(at(4.5, 4.5)).toBe(DIP.chasm);
    expect(at(3.0, 3.0)).toBe(DIP.none);
    expect(at(3.0, 4.5)).toBe(DIP.none);
  });

  it('bounds its geometry', () => {
    const m = open(34, 9, [[15, 4, TILE_ID.Chasm], [16, 4, TILE_ID.Chasm]]);
    for (const cx of [0, 1]) {
      const c: DipChunk = buildDipChunk(m, false, cx, 0)!;
      const p = c.arrays.position;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < c.arrays.count; v++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[v * 3 + a]); mx[a] = Math.max(mx[a], p[v * 3 + a]); }
      for (let a = 0; a < 3; a++) { expect(c.min[a]).toBeCloseTo(mn[a], 5); expect(c.max[a]).toBeCloseTo(mx[a], 5); }
      expect(c.min[1]).toBeLessThanOrEqual(-CHASM_BED + 1e-6);
      expect(c.max[1]).toBeLessThanOrEqual(LIP);
      expect(c.min[0]).toBeGreaterThanOrEqual(cx * CHUNK - 1);
      expect(c.max[0]).toBeLessThanOrEqual((cx + 1) * CHUNK + 1);
    }
  });

  it('draws the cells inDipMesh says and nothing else', () => {
    const m = open(12, 12, [[2, 2, TILE_ID.Lava], [3, 2, TILE_ID.ShallowWater], [8, 8, TILE_ID.Chasm]]);
    m.set(5, 5, TILE_ID.Wall); m.set(9, 8, TILE_ID.Wall);
    const c = buildDipChunk(m, false, 0, 0)!;
    let cells = 0;
    for (let z = 0; z < 12; z++) for (let x = 0; x < 12; x++) if (inDipMesh(m, x, z)) cells++;
    expect(c.arrays.count).toBeGreaterThanOrEqual(cells * V);
  });

  it('closes a wall side with a skirt from y = 0 down to the bed, wherever the bed is below 0', () => {
    // Over random maps with walls: every vertex with a horizontal normal is a skirt vertex, on a side shared with a wall.
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    const kinds = [CH['.'], CH['.'], CH['#'], CH['~'], CH.C, CH.L];
    const N = 24;
    const m = filled(N, N);
    for (let i = 0; i < N * N; i++) m.tiles[i] = kinds[Math.floor(rnd() * kinds.length)];
    const c = buildDipChunk(m, false, 0, 0)!;
    const { position: p, normal: n } = c.arrays;
    let skirt = 0;
    for (let v = 0; v < c.arrays.count; v++) {
      if (n[v * 3 + 1] !== 0) continue;
      skirt++;
      const y = p[v * 3 + 1], b = bedAt(m, p[v * 3], p[v * 3 + 2]);
      expect(y === 0 || Math.abs(y - Math.min(b, 0)) < 2e-3).toBe(true);
    }
    expect(skirt).toBeGreaterThan(0);
    expect(skirt % (2 * (R + 1))).toBe(0);
  });

  it('closes the slit at a concave corner against a wall', () => {
    const m = open(8, 8, [[4, 4, TILE_ID.Wall], [3, 3, TILE_ID.ShallowWater], [3, 4, TILE_ID.ShallowWater], [4, 3, TILE_ID.ShallowWater]]);
    const c = buildDipChunk(m, false, 0, 0)!;
    const { position: p, normal: n, index } = c.arrays;
    const strip = (nx: number, nz: number, onX: boolean, at: number) => {
      const out: number[] = [];
      for (let v = 0; v < c.arrays.count; v++) {
        if (n[v * 3] === nx && n[v * 3 + 1] === 0 && n[v * 3 + 2] === nz && Math.abs(p[v * 3 + (onX ? 0 : 2)] - at) < 1e-6) out.push(v);
      }
      return out;
    };
    for (const [nx, nz, onX] of [[-1, 0, true], [0, -1, false]] as [number, number, boolean][]) {
      // the west cell's east side is x = 4; the north cell's south side is z = 4
      const s = strip(nx, nz, onX, 4).filter((v) => (onX ? p[v * 3 + 2] >= 4 : p[v * 3] >= 4) && (onX ? p[v * 3 + 2] <= 5 : p[v * 3] <= 5));
      expect(s.length, `${nx},${nz}`).toBe(2 * (R + 1));
      let corner = 0;
      for (const v of s) {
        const y = p[v * 3 + 1], b = bedAt(m, p[v * 3], p[v * 3 + 2]);
        expect(y === 0 || Math.abs(y - Math.min(b, 0)) < 2e-3).toBe(true);
        if (y < -0.01) corner = Math.min(corner, y);
      }
      // the strip's first R + 1 vertices are its tops; a bottom reaches 0 where the bed does
      expect(s.slice(0, R + 1).every((v) => p[v * 3 + 1] === 0)).toBe(true);
      expect(corner).toBeLessThan(0);
    }
    // every triangle that uses a skirt vertex faces the way its vertex normals do
    let tris = 0;
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, d] = [index[t], index[t + 1], index[t + 2]];
      if (n[a * 3 + 1] !== 0) continue;
      const e1 = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k]), e2 = [0, 1, 2].map((k) => p[d * 3 + k] - p[a * 3 + k]);
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const dot = g[0] * n[a * 3] + g[1] * n[a * 3 + 1] + g[2] * n[a * 3 + 2];
      expect(dot).toBeGreaterThanOrEqual(0);
      if (Math.hypot(...g) > 1e-9) { expect(dot).toBeGreaterThan(0); tris++; }
    }
    expect(tris).toBeGreaterThan(0);
  });
});
