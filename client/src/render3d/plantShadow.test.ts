import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { Crack } from './air/cracks';
import { CRACK_CAP } from './air/cracks';
import { CHASM_BED } from './dips/shape';
import { LIGHT_CAP, type Light } from './light';
import { sunCamera } from './sunNodes';
import { FACES, PLANT_FAR, PLANT_NEAR, TABLE_LEN, crackCam, crackCoord, faceCoord, faceHits, packTable, planTiles, type PlantBound } from './plantShadow';

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
