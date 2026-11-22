import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { BED_RES, OUTLINE_EDGE, bedAt, isWater, maskAt } from '../dips/shape';
import { ROCK, stoneField } from '../stone/field';
import { noMarks } from '../stone/place';
import { floorHeight } from '../stone/shape';
import { refreshWaterField, sampleWaterField, waterField } from './waterField';
import { PUDDLE_LEVEL } from './waterMesh';

/** The weighted sum of the field of the test below, recorded before puddles existed. */
const PINNED_SUM = -4653.0024;

const CH: Record<string, number> = {
  '#': TILE_ID.Wall, '.': TILE_ID.Floor, '~': TILE_ID.ShallowWater, W: TILE_ID.DeepWater,
  L: TILE_ID.Lava, C: TILE_ID.Chasm, ' ': TILE_ID.Void,
};

/** Rows of characters inside a one-cell wall border. */
function room(...rows: string[]): TileMap {
  const w = rows[0].length + 2, h = rows.length + 2;
  const m = new TileMap(w, h, new Uint8Array(w * h).fill(TILE_ID.Wall));
  rows.forEach((r, j) => [...r].forEach((c, i) => m.set(i + 1, j + 1, CH[c])));
  return m;
}

describe('waterField', () => {
  it('holds bedAt and the water mask at every grid point', () => {
    const m = room('.......', '.~~W...', '.~WW.LL', '.....LL', '.CC....', '.CC....', '.......');
    const f = waterField(m);
    expect(f.w).toBe(m.w * BED_RES + 1);
    expect(f.h).toBe(m.h * BED_RES + 1);
    expect(f.data.length).toBe(2 * f.w * f.h);
    let wet = 0, deep = 0;
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
      const k = j * f.w + i, x = i / BED_RES, z = j / BED_RES;
      expect(f.data[2 * k], `bed at ${i}, ${j}`).toBe(Math.fround(bedAt(m, x, z)));
      expect(f.data[2 * k + 1], `mask at ${i}, ${j}`).toBe(Math.fround(maskAt(m, x, z, isWater)));
      if (f.data[2 * k + 1] > OUTLINE_EDGE) wet++;
      if (f.data[2 * k] < -1) deep++;
    }
    expect(wet).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(0);
  });

  it('is (0, 0) away from terrain', () => {
    const m = room('.........', '.........', '.........', '....~....', '.........', '.........', '.........');
    const f = waterField(m);
    // The pool is cell (5, 4); the texel at (1.5, 1.5) is 3 tiles from it.
    const k = (1.5 * BED_RES) * f.w + 1.5 * BED_RES;
    expect([f.data[2 * k], f.data[2 * k + 1]]).toEqual([0, 0]);
    const far = (7.5 * BED_RES) * f.w + 9.5 * BED_RES;
    expect([f.data[2 * far], f.data[2 * far + 1]]).toEqual([0, 0]);
    const near = (4.5 * BED_RES) * f.w + 5.5 * BED_RES;
    expect(f.data[2 * near + 1]).toBeGreaterThan(OUTLINE_EDGE);
  });

  it('samples between its texels', () => {
    const m = room('.....', '.~W..', '.W~..', '.....', '.....');
    const f = waterField(m);
    const at = (i: number, j: number) => ({ bed: f.data[2 * (j * f.w + i)], mask: f.data[2 * (j * f.w + i) + 1] });
    // on a grid point: the texel
    for (const [i, j] of [[0, 0], [9, 8], [10, 10], [13, 14], [f.w - 1, f.h - 1]]) {
      const s = sampleWaterField(f, i / BED_RES, j / BED_RES), t = at(i, j);
      expect(s.bed).toBeCloseTo(t.bed, 6);
      expect(s.mask).toBeCloseTo(t.mask, 6);
    }
    // inside a texel: the bilinear mix of the four corners, so inside their range and exactly the mix at the centre
    const i0 = 7, j0 = 5;
    const c = [at(i0, j0), at(i0 + 1, j0), at(i0, j0 + 1), at(i0 + 1, j0 + 1)];
    const mid = sampleWaterField(f, (i0 + 0.5) / BED_RES, (j0 + 0.5) / BED_RES);
    expect(mid.bed).toBeCloseTo((c[0].bed + c[1].bed + c[2].bed + c[3].bed) / 4, 6);
    expect(mid.mask).toBeCloseTo((c[0].mask + c[1].mask + c[2].mask + c[3].mask) / 4, 6);
    const q = sampleWaterField(f, (i0 + 0.25) / BED_RES, (j0 + 0.75) / BED_RES);
    const bil = (key: 'bed' | 'mask') => (c[0][key] * 0.75 + c[1][key] * 0.25) * 0.25 + (c[2][key] * 0.75 + c[3][key] * 0.25) * 0.75;
    expect(q.bed).toBeCloseTo(bil('bed'), 6);
    expect(q.mask).toBeCloseTo(bil('mask'), 6);
    // outside the map: clamped to the edge texel
    expect(sampleWaterField(f, -5, -5)).toEqual(at(0, 0));
    expect(sampleWaterField(f, 999, 999)).toEqual(at(f.w - 1, f.h - 1));
  });

  it('has no water mask over a chasm or lava beside the pool', () => {
    for (const other of ['C', 'L']) {
      const m = room(`~${other}`);
      const f = waterField(m);
      const centre = (cx: number) => sampleWaterField(f, cx, 1.5).mask;
      expect(centre(1.5), `water beside ${other}`).toBeGreaterThan(OUTLINE_EDGE);
      expect(centre(2.5), `${other}`).toBeLessThan(OUTLINE_EDGE);
    }
  });

  it('gives a map without puddles the field it gave before (#380, pinned)', () => {
    const m = room('.......', '.~~W...', '.~WW.LL', '.....LL', '.CC....', '.CC....', '.......');
    const f = waterField(m), g = waterField(m, [], () => { throw new Error('no floor is asked without a puddle'); });
    expect(Array.from(g.data)).toEqual(Array.from(f.data));
    let sum = 0;
    f.data.forEach((v, i) => { sum += v * ((i % 13) + 1); });
    expect(sum).toBeCloseTo(PINNED_SUM, 3);
  });

  it('keeps the outline of a puddle inside its basin (#380)', () => {
    const m = room('.........', '.........', '.........', '.........', '.........', '.........', '.........');
    const sf = stoneField(m, new Uint8Array(m.w * m.h).fill(ROCK), 7);
    const p = { x: 4.6, z: 4.3, r: 0.7 }, marks = { ...noMarks(), puddles: [p] };
    const floor = (x: number, z: number) => floorHeight(sf, m, marks, x, z);
    const f = waterField(m, marks.puddles, floor);
    // water in the middle: inside the outline, and the bed (the rock mesh's own floor) below the puddle's level
    const mid = sampleWaterField(f, p.x, p.z);
    expect(mid.mask).toBeGreaterThan(OUTLINE_EDGE);
    expect(mid.bed).toBeLessThan(PUDDLE_LEVEL);
    const i = Math.round(p.x * BED_RES), j = Math.round(p.z * BED_RES);
    expect(f.data[2 * (j * f.w + i)]).toBe(Math.fround(floor(i / BED_RES, j / BED_RES)));
    let wet = 0;
    for (let z = 0; z <= m.h; z += 0.05) for (let x = 0; x <= m.w; x += 0.05) {
      const s = sampleWaterField(f, x, z), d = Math.hypot(x - p.x, z - p.z);
      // inside the outline is inside the basin, and the surface never lies over floor outside it
      if (s.mask >= OUTLINE_EDGE) { wet++; expect(d, `${x}, ${z}`).toBeLessThanOrEqual(p.r + 1e-6); }
      if (d > p.r) expect(floor(x, z), `floor at ${x}, ${z}`).toBeGreaterThan(PUDDLE_LEVEL);
    }
    expect(wet).toBeGreaterThan(100);
    // a tile change beside it leaves the puddle in the field
    const before = Array.from(f.data);
    refreshWaterField(f, m, 4, 4, marks.puddles, floor);
    expect(Array.from(f.data)).toEqual(before);
  });

  it('follows a tile change', () => {
    const F = TILE_ID.Floor;
    const steps: [number, number][] = [
      [F, TILE_ID.ShallowWater], [TILE_ID.ShallowWater, TILE_ID.DeepWater], [TILE_ID.DeepWater, F],
      [TILE_ID.Wall, F], [F, TILE_ID.Wall],
      [F, TILE_ID.Chasm], [TILE_ID.Chasm, F], [F, TILE_ID.Lava], [TILE_ID.Lava, F],
    ];
    const make = () => room('.......', '.......', '...~...', '.......', '.......', '.......', '.......');
    const spots = (m: TileMap): [number, number][] => [[0, 0], [m.w - 1, m.h - 1], [0, m.h - 1], [m.w - 1, 0], [4, 4], [3, 3], [5, 2]];
    for (const [from, to] of steps) {
      for (const idx of [0, 1, 2, 3, 4, 5, 6]) {
        const m = make();
        const [x, z] = spots(m)[idx];
        m.set(x, z, from);
        const f = waterField(m);
        m.set(x, z, to);
        refreshWaterField(f, m, x, z);
        const want = waterField(m);
        expect(f.w).toBe(want.w);
        expect(f.h).toBe(want.h);
        expect(Array.from(f.data), `${from} -> ${to} at ${x}, ${z}`).toEqual(Array.from(want.data));
      }
    }
  });
});
