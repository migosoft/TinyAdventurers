import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { Crack } from './air/cracks';
import { CRACK_CAP } from './air/cracks';
import { CHASM_BED } from './dips/shape';
import { LIGHT_CAP, type Light } from './light';
import { sunCamera } from './sunNodes';
import { FACES, PLANT_FAR, PLANT_NEAR, TABLE_LEN, crackCam, crackCoord, faceCoord, atlasLayout, faceHits, packTable, tileRect, planTiles, castingPlants, pointVisAt, crackVisAt, PLANT_BIAS, CRACK_BIAS, type PlantBound } from './plantShadow';

const light = (x: number, y: number, z: number, shadow = true, radius = 6): Light => ({ x, y, z, radius, r: 1, g: 1, b: 1, shadow, skip: -1 });
const crack = (fx: number, fz: number): Crack => ({
  id: 1, fx, fz, ceil: 6, dir: [0.3 / Math.sqrt(0.94), 0.9 / Math.sqrt(0.94), -0.2 / Math.sqrt(0.94)], rx: 1.2, rz: 0.8, rot: 0, widen: 0.5, rgb: [1, 1, 1], main: 0.45, rays: [], wave: 0,
});
const plant = (x: number, z: number, r = 1, h = 2): PlantBound => ({ x, z, r, h });
const corners = (p: PlantBound): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (const sx of [-1, 1]) for (const sy of [0, p.h]) for (const sz of [-1, 1]) out.push([p.x + sx * p.r, sy, p.z + sz * p.r]);
  return out;
};
const win = (f: number, n: number, a: number): number => (f * (a - n)) / (a * (f - n));

describe('crackCam', () => {
  it('is null when no plant meets the beam', () => {
    expect(crackCam(crack(10, 10), [plant(30, 30)])).toBeNull();
    expect(crackCam(crack(10, 10), [])).toBeNull();
  });
  it('holds every corner of a plant under the beam, depth from ceiling to floor', () => {
    const c = crack(10, 10);
    const p = plant(10.3, 10.1, 0.5, 1.5);
    const cam = crackCam(c, [p])!;
    expect(cam).not.toBeNull();
    for (const k of corners(p)) {
      const o = crackCoord(cam, k);
      expect(o.inside).toBe(true);
      expect(o.depth).toBeGreaterThan(0);
      expect(o.depth).toBeLessThan(1);
    }
    const top = [c.fx + (c.dir[0] * c.ceil) / c.dir[1], c.ceil, c.fz + (c.dir[2] * c.ceil) / c.dir[1]] as [number, number, number];
    const bed = -(CHASM_BED + 1);
    const bot = [c.fx + (c.dir[0] * bed) / c.dir[1], bed, c.fz + (c.dir[2] * bed) / c.dir[1]] as [number, number, number];
    expect(crackCoord(cam, top).depth).toBeCloseTo(0, 3);
    expect(crackCoord(cam, bot).depth).toBeCloseTo(1, 3);
  });
  it('clamps depth: below the bed is 1, above the ceiling is 0', () => {
    const c = crack(10, 10);
    const cam = crackCam(c, [plant(10.3, 10.1, 0.5, 1.5)])!;
    const at = (y: number): [number, number, number] => [c.fx + (c.dir[0] * y) / c.dir[1], y, c.fz + (c.dir[2] * y) / c.dir[1]];
    expect(crackCoord(cam, at(-(CHASM_BED + 1) - 3)).depth).toBe(1);
    expect(crackCoord(cam, at(c.ceil + 3)).depth).toBe(0);
  });
  it('matches an ortho camera built from the TileCam', () => {
    const cam = crackCam(crack(10, 10), [plant(10.3, 10.1, 0.5, 1.5)])!;
    const o = sunCamera({ ...cam, size: 1, texel: 1 }) as OrthographicCamera;
    for (const P of [[10.2, 0.5, 10], [10.5, 1, 10.3], [9.9, 0.1, 10.2]] as [number, number, number][]) {
      const q = new Vector3(...P).project(o);
      const m = crackCoord(cam, P);
      expect(q.x).toBeCloseTo(2 * m.u - 1, 4);
      expect(q.y).toBeCloseTo(2 * m.v - 1, 4);
      expect((q.z + 1) / 2).toBeCloseTo(m.depth, 4);
    }
  });
});

describe('faceHits', () => {
  it('hits +x and not -x for a plant to the east', () => {
    const L: [number, number, number] = [5, 1, 5];
    expect(faceHits(L, 0, 6, [plant(8, 5)])).toBe(true);
    expect(faceHits(L, 1, 6, [plant(8, 5)])).toBe(false);
  });
  it('hits nothing past reach', () => {
    for (let f = 0; f < 6; f++) expect(faceHits([5, 1, 5], f, 6, [plant(20, 5)])).toBe(false);
  });
});

describe('planTiles', () => {
  const plants = [plant(8, 5)];
  it('cracks first, then lights in list order, faces in FACES order; shadow false gets none', () => {
    const lights = [light(5, 1, 5, false), light(5, 1, 5), light(5, 1, 6)];
    const plan = planTiles(lights, [crack(8, 5)], plants, 99);
    expect(plan.tiles[0].kind).toBe('crack');
    expect(plan.crackTile[0]).toBe(0);
    expect(plan.lightFaces.length).toBe(LIGHT_CAP * 6);
    expect(plan.lightFaces.slice(0, 6).every((v) => v === -1)).toBe(true);
    const rest = plan.tiles.slice(1);
    expect(rest.every((t) => t.kind === 'face')).toBe(true);
    const keys = rest.map((t) => t.slot * 6 + t.face);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(plan.lightFaces[1 * 6 + 0]).toBe(plan.tiles.findIndex((t) => t.slot === 1 && t.face === 0));
    expect(plan.lightFaces[1 * 6 + 1]).toBe(-1);
    expect(plan.tiles.every((t) => t.slot !== 0 || t.kind === 'crack')).toBe(true);
    expect(FACES.length).toBe(6);
  });
  it('keeps exactly the first `cap` tiles', () => {
    const lights = [light(5, 1, 5), light(5, 1, 6), light(5, 1, 4)];
    const full = planTiles(lights, [crack(8, 5)], plants, 99);
    expect(full.tiles.length).toBeGreaterThan(3);
    const plan = planTiles(lights, [crack(8, 5)], plants, 3);
    expect(plan.tiles.length).toBe(3);
    expect(plan.tiles.map((t) => [t.kind, t.slot, t.face])).toEqual(full.tiles.slice(0, 3).map((t) => [t.kind, t.slot, t.face]));
    expect(Array.from(plan.lightFaces).filter((v) => v >= 0).length + Array.from(plan.crackTile).filter((v) => v >= 0).length).toBe(3);
  });
  it('a light that reaches only a hidden plant gets no tile once the hidden plants are left out', () => {
    const all = [plant(8, 5), plant(40, 40)];
    const hidden = [{ x: 40, z: 40 }];
    const lights = [light(40, 1, 38)];
    expect(planTiles(lights, [], all, 99).tiles.length).toBeGreaterThan(0);
    const cast = castingPlants(all, hidden);
    expect(cast).toEqual([all[0]]);
    expect(planTiles(lights, [], cast, 99).tiles.length).toBe(0);
  });
  it('no plants gives no tiles', () => {
    expect(planTiles([light(5, 1, 5)], [crack(8, 5)], [], 99).tiles.length).toBe(0);
  });
});

describe('camera parity', () => {
  it('faceCoord matches the 90 degree face camera', () => {
    const L = new Vector3(3, 2, -4);
    FACES.forEach((fc, face) => {
      const cam = new PerspectiveCamera(90, 1, PLANT_NEAR, PLANT_FAR);
      cam.position.copy(L);
      cam.up.set(...fc.U);
      cam.lookAt(L.x + fc.F[0], L.y + fc.F[1], L.z + fc.F[2]);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      const R = [fc.F[1] * fc.U[2] - fc.F[2] * fc.U[1], fc.F[2] * fc.U[0] - fc.F[0] * fc.U[2], fc.F[0] * fc.U[1] - fc.F[1] * fc.U[0]];
      for (const [a, b, c] of [[2, 0.3, -0.5], [5, -1, 2], [1.2, 0.9, 0.9]]) {
        const d: [number, number, number] = [0, 1, 2].map((i) => fc.F[i] * a + R[i] * b + fc.U[i] * c) as [number, number, number];
        const q = new Vector3(L.x + d[0], L.y + d[1], L.z + d[2]).project(cam);
        const m = faceCoord(d, face);
        expect(q.x).toBeCloseTo(2 * m.u - 1, 5);
        expect(q.y).toBeCloseTo(2 * m.v - 1, 5);
        expect(Math.abs((q.z + 1) / 2 - m.depth)).toBeLessThan(1e-5);
        expect(m.depth).toBeCloseTo(win(PLANT_FAR, PLANT_NEAR, a), 5);
      }
    });
  });
  it('clamps past PLANT_FAR to 1', () => {
    expect(faceCoord([PLANT_FAR + 5, 0, 0], 0).depth).toBe(1);
  });
});

describe('packTable', () => {
  it('lays out the header, light slots and crack slots', () => {
    const plan = planTiles([light(5, 1, 5)], [crack(8, 5)], [plant(8, 5)], 99);
    const t = new Float32Array(TABLE_LEN * 4).fill(7);
    packTable(plan, 4, true, t);
    expect(Array.from(t.slice(0, 4))).toEqual([4, plan.tiles.length, 1, 0]);
    const ids = [...t.slice(4, 8), ...t.slice(8, 10)];
    expect(ids).toEqual(Array.from(plan.lightFaces.slice(0, 6)));
    const s = (1 + 2 * LIGHT_CAP) * 4;
    const cam = plan.tiles[plan.crackTile[0]].cam;
    expect(t[s + 3]).toBe(plan.crackTile[0]);
    expect(t[s + 7]).toBeCloseTo(cam.ext[0]);
    expect(t[s + 15]).toBeCloseTo(cam.ext[2]);
    expect(t[s + 11]).toBeCloseTo(cam.ext[1]);
    expect(Array.from(t.slice(s, s + 3))).toEqual(cam.C.map(Math.fround));
    expect(Array.from(t.slice(s + 4, s + 7))).toEqual(cam.R.map(Math.fround));
    expect(Array.from(t.slice(s + 8, s + 11))).toEqual(cam.U.map(Math.fround));
    expect(Array.from(t.slice(s + 12, s + 15))).toEqual(cam.F.map(Math.fround));
    expect(t[s + 16 + 3]).toBe(-1); // crack slot 1: no tile
    expect(t[TABLE_LEN * 4 - 1]).not.toBe(7);
    expect(CRACK_CAP).toBeGreaterThan(1);
  });
});

// The CPU twin of the shader's lookups (`plantShadowNodes.ts` mirrors it line by line).
describe('the lookup twin', () => {
  const T = 8, perRow = 2, size = T * perRow;
  /** An atlas of `size` x `size` texels, all empty (1), with `set` writing single texels. */
  const atlas = (): { read: (x: number, y: number) => number; set: (x: number, y: number, d: number) => void; seen: [number, number][] } => {
    const a = new Float32Array(size * size).fill(1), seen: [number, number][] = [];
    return { read: (x, y) => { seen.push([x, y]); return a[y * size + x]; }, set: (x, y, d) => { a[y * size + x] = d; }, seen };
  };
  const table = (plan: ReturnType<typeof planTiles>, flip = false): Float32Array => { const t = new Float32Array(TABLE_LEN * 4); packTable(plan, perRow, flip, t); return t; };
  const L: [number, number, number] = [10, 2, 10];
  const facePlan = () => planTiles([light(...L)], [], [plant(12, 10, 0.5, 3)], 4);
  const fill = (a: ReturnType<typeof atlas>, tile: number, x: number, y: number, depth: number, w = 1): void => {
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) a.set((tile % perRow) * T + x + i, Math.floor(tile / perRow) * T + y + j, depth);
  };

  it('point: a texel nearer than the receiver shadows it; an empty one leaves it lit', () => {
    const plan = facePlan();
    const id = plan.lightFaces[0]; // +x
    expect(id).toBeGreaterThanOrEqual(0);
    const P: [number, number, number] = [14, 2, 10];
    const c = faceCoord([P[0] - L[0], P[1] - L[1], P[2] - L[2]], 0);
    const a = atlas();
    expect(pointVisAt(table(plan), a.read, size, P, 0, L)).toBe(1);
    fill(a, id, 0, 0, 0, T); // the whole tile holds something nearer
    expect(pointVisAt(table(plan), a.read, size, P, 0, L)).toBe(0);
    expect(c.depth).toBeGreaterThan(0 + PLANT_BIAS);
  });
  it('point: a tile of -1 is lit and reads nothing', () => {
    const a = atlas();
    expect(pointVisAt(table(planTiles([light(...L)], [], [plant(30, 30)], 4)), a.read, size, [14, 2, 10], 0, L)).toBe(1);
    expect(a.seen).toHaveLength(0);
  });
  it('point: an empty plan (tileCount 0) is lit', () => {
    const t = new Float32Array(TABLE_LEN * 4);
    expect(pointVisAt(t, () => 0, size, [14, 2, 10], 0, L)).toBe(1);
  });
  it('point: the flip reads the mirrored row, and every read stays inside the tile', () => {
    const plan = facePlan();
    const id = plan.lightFaces[0];
    const P: [number, number, number] = [14, 2.9, 10]; // above the axis: v > 0.5
    const c = faceCoord([P[0] - L[0], P[1] - L[1], P[2] - L[2]], 0);
    for (const flip of [false, true]) {
      const a = atlas();
      expect(pointVisAt(table(plan, flip), a.read, size, P, 0, L)).toBe(1);
      const row = Math.floor((flip ? 1 - c.v : c.v) * T);
      const mid = Math.floor(c.u * T);
      expect(a.seen.some(([x, y]) => x === (id % perRow) * T + mid && y === Math.floor(id / perRow) * T + row), `flip ${flip}`).toBe(true);
      for (const [x, y] of a.seen) {
        expect(x).toBeGreaterThanOrEqual((id % perRow) * T); expect(x).toBeLessThan((id % perRow) * T + T);
        expect(y).toBeGreaterThanOrEqual(Math.floor(id / perRow) * T); expect(y).toBeLessThan(Math.floor(id / perRow) * T + T);
      }
    }
  });
  it('point: the 2x2 softening gives a share between 0 and 1 on a one-texel edge', () => {
    const plan = facePlan();
    const id = plan.lightFaces[0];
    const P: [number, number, number] = [14, 2, 10];
    const c = faceCoord([P[0] - L[0], P[1] - L[1], P[2] - L[2]], 0);
    const a = atlas();
    fill(a, id, Math.floor(c.u * T - 0.5), Math.floor(c.v * T - 0.5), 0, 1); // one blocker texel of the four
    const v = pointVisAt(table(plan), a.read, size, P, 0, L);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  const cp = () => planTiles([], [crack(10, 10)], [plant(10.3, 10.1, 0.5, 1.5)], 4);
  it('crack: a blocker in the tile shadows a point inside; the same point outside the box is lit', () => {
    const plan = cp();
    const cam = plan.tiles[0].cam;
    const P: [number, number, number] = [10.2, 0.5, 10];
    expect(crackCoord(cam, P).inside).toBe(true);
    const a = atlas();
    fill(a, 0, 0, 0, 0, T);
    expect(crackVisAt(table(plan), a.read, size, P, 0)).toBe(0);
    const far: [number, number, number] = [P[0] + 20, P[1], P[2]];
    expect(crackCoord(cam, far).inside).toBe(false);
    const b = atlas();
    fill(b, 0, 0, 0, 0, T);
    expect(crackVisAt(table(plan), b.read, size, far, 0)).toBe(1);
    expect(b.seen).toHaveLength(0);
  });
  it('crack: an empty texel is lit, a slot without a tile is lit, the bias is smaller than the face bias', () => {
    const plan = cp();
    expect(crackVisAt(table(plan), atlas().read, size, [10.2, 0.5, 10], 0)).toBe(1);
    expect(crackVisAt(table(plan), () => 0, size, [10.2, 0.5, 10], 3)).toBe(1); // slot 3 has no tile
    expect(CRACK_BIAS).toBeLessThan(PLANT_BIAS);
  });
  it('crack: the flip reads the mirrored row', () => {
    const plan = cp();
    const P: [number, number, number] = [10.2, 0.9, 10];
    const c = crackCoord(plan.tiles[0].cam, P);
    for (const flip of [false, true]) {
      const a = atlas();
      crackVisAt(table(plan, flip), a.read, size, P, 0);
      const row = Math.floor((flip ? 1 - c.v : c.v) * T);
      expect(a.seen.some(([, y]) => y === row), `flip ${flip}`).toBe(true);
    }
  });
});

describe('the atlas', () => {
  it('atlasLayout: perRow = ceil(sqrt(cap)), a side of perRow tiles', () => {
    expect(atlasLayout(256, 16)).toEqual({ perRow: 4, size: 1024 });
    expect(atlasLayout(128, 10)).toEqual({ perRow: 4, size: 512 });
    expect(atlasLayout(64, 1)).toEqual({ perRow: 1, size: 64 });
  });
  it('tileRect: row 0 on top, tiles left to right', () => {
    expect(tileRect(0, 3, 64)).toEqual({ x: 0, y: 0, w: 64, h: 64 });
    expect(tileRect(4, 3, 64)).toEqual({ x: 64, y: 64, w: 64, h: 64 });
    expect(tileRect(8, 3, 64)).toEqual({ x: 128, y: 128, w: 64, h: 64 });
  });
  it('a receiver past PLANT_FAR (depth clamped to 1) is shadowed by a texel below 1', () => {
    const T = 4, perRow = 1, size = T;
    const L: [number, number, number] = [0, 2, 0];
    const plan = planTiles([light(...L)], [], [plant(2, 0, 0.5, 3)], 1);
    const t = new Float32Array(TABLE_LEN * 4);
    packTable(plan, perRow, false, t);
    const P: [number, number, number] = [PLANT_FAR + 5, 2, 0];
    expect(faceCoord([P[0], 0, 0], 0).depth).toBe(1);
    expect(pointVisAt(t, () => 0.5, size, P, 0, L)).toBe(0);
    expect(pointVisAt(t, () => 1, size, P, 0, L)).toBe(1);
  });
});
