import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { LAVA_LEVEL, WATER_LEVEL } from './dips/shape';
import { TERRAIN_FRAMES, TERRAIN_PERIOD, type TerrainSet } from '../game/terrain-codes';
import { LAYER_STEP, buildTerrainChunk, stepTerrainUv, terrainFrame } from './terrainMesh';
import type { FrameRects } from './worldMesh';

const frames: FrameRects = {};
let n = 0;
const add = (name: string) => { frames[name] = { x: 16 * (n % 50), y: 16 * Math.floor(n / 50), w: 16, h: 16 }; n++; };
for (const set of Object.keys(TERRAIN_FRAMES) as TerrainSet[]) {
  const p = TERRAIN_PERIOD[set];
  for (let f = 0; f < TERRAIN_FRAMES[set]; f++) for (let q = 0; q < p * p; q++) add(`terrain_${set}_f${f}_q${q}`);
}
for (const e of ['shore', 'deep', 'lava', 'chasm']) for (let c = 0; c < 625; c++) add(`terrain_${e}_e${c.toString(5).padStart(4, '0')}`);

const T = TILE_ID;
const mapOf = (w: number, h: number, tiles: number[]) => new TileMap(w, h, Uint8Array.from(tiles));
/** A w x h floor map with the given cells set. */
function with_(w: number, h: number, cells: [number, number, number][]) {
  const t = new Array(w * h).fill(T.Floor);
  for (const [x, z, id] of cells) t[z * w + x] = id;
  return mapOf(w, h, t);
}
const quadCount = (c: { arrays: { count: number } }) => c.arrays.count / 6;
const ys = (c: { arrays: { position: Float32Array } }) => {
  const out: number[] = [];
  for (let q = 0; q < c.arrays.position.length / 18; q++) out.push(c.arrays.position[q * 18 + 1]);
  return out;
};
const rectOf = (c: { arrays: { rect: Float32Array } }, q: number) => [...c.arrays.rect.slice(q * 24, q * 24 + 4)];
const rectArr = (name: string) => [frames[name].x, frames[name].y, frames[name].w, frames[name].h];
const uvOf = (c: { arrays: { uv: Float32Array } }, q: number) => [...c.arrays.uv.slice(q * 12, q * 12 + 12)];

describe('buildTerrainChunk', () => {
  const quadYs = (c: { arrays: { position: Float32Array } }) => ys(c).map((y) => Math.round(y * 1e4) / 1e4);
  const names = (c: { arrays: { rect: Float32Array; count: number } }) => {
    const out: string[] = [];
    for (let q = 0; q < quadCount(c); q++) for (const [k, r] of Object.entries(frames)) if (rectOf(c, q).join() === [r.x, r.y, r.w, r.h].join()) out.push(k);
    return out;
  };

  it('lays the plates at the surface level', () => {
    const shallow = buildTerrainChunk(with_(5, 5, [[2, 2, T.ShallowWater]]), 0, 0, frames, 0)!;
    expect(quadCount(shallow)).toBe(9);
    expect(ys(shallow).every((y) => y === Math.fround(WATER_LEVEL))).toBe(true);

    const deep = buildTerrainChunk(with_(5, 5, [[2, 2, T.DeepWater]]), 0, 0, frames, 0)!;
    expect(quadCount(deep)).toBe(10);
    expect(quadYs(deep).filter((y) => y === Math.round((WATER_LEVEL + LAYER_STEP) * 1e4) / 1e4).length).toBe(1);
    expect(names(deep)).toContain('terrain_deep_f0_q' + ((2 % 4) + 4 * (2 % 4)));

    const lava = buildTerrainChunk(with_(5, 5, [[2, 2, T.Lava]]), 0, 0, frames, 0)!;
    expect(quadCount(lava)).toBe(9);
    expect(ys(lava).every((y) => y === Math.fround(LAVA_LEVEL))).toBe(true);
    expect(lava.anim.every((a) => a.set === 'lava')).toBe(true);

    expect(buildTerrainChunk(with_(5, 5, [[2, 2, T.Chasm]]), 0, 0, frames, 0)).toBeNull();
  });

  it('gives a border cell shared by water and lava both plates, and a chasm cell beside water its water plate', () => {
    const c = buildTerrainChunk(with_(7, 5, [[2, 2, T.ShallowWater], [4, 2, T.Lava], [3, 3, T.Chasm]]), 0, 0, frames, 0)!;
    // (3, 2) borders both pools: one water and one lava plate; the chasm (3, 3) touches both too
    const at = (x: number, z: number) => {
      let w = 0, l = 0;
      for (let q = 0; q < quadCount(c); q++) {
        if (c.arrays.position[q * 18] !== x || c.arrays.position[q * 18 + 2] !== z) continue;
        const y = c.arrays.position[q * 18 + 1];
        if (y === Math.fround(LAVA_LEVEL)) l++; else w++;
      }
      return [w, l];
    };
    expect(at(3, 2)).toEqual([1, 1]);
    expect(at(3, 3)).toEqual([1, 1]);
    expect(at(2, 2)).toEqual([1, 0]);
    expect(at(4, 2)).toEqual([0, 1]);
  });

  it('uses no edge overlay', () => {
    const c = buildTerrainChunk(with_(7, 7, [[2, 2, T.DeepWater], [3, 2, T.ShallowWater], [4, 4, T.Lava]]), 0, 0, frames, 0)!;
    expect(names(c).some((k) => k.includes('_e'))).toBe(false);
  });

  it('a chunk without water or lava is null', () => {
    expect(buildTerrainChunk(with_(3, 3, []), 0, 0, frames, 0)).toBeNull();
  });
});

describe('terrainFrame', () => {
  it('follows the clock per set', () => {
    expect(terrainFrame('water', 0.26)).toBe(1);
    expect(terrainFrame('water', 1.0)).toBe(0);
    expect(terrainFrame('lava', 1.0)).toBe(5);
    expect(terrainFrame('chasm', 7)).toBe(0);
  });
});

describe('stepTerrainUv', () => {
  it('writes only when a frame steps', () => {
    const map = with_(4, 4, [[0, 0, T.ShallowWater], [3, 3, T.Lava]]);
    const c = buildTerrainChunk(map, 0, 0, frames, 0)!;
    expect(quadCount(c)).toBe(8);
    const lavaUv = uvOf(c, 4);
    expect(stepTerrainUv(c, frames, 0)).toBe(false);
    // water is on frame 1 at 1.25 s, lava is back on its frame 0
    expect(stepTerrainUv(c, frames, 1.25)).toBe(true);
    expect(rectOf(c, 0)).toEqual(rectArr('terrain_water_f1_q0'));
    const r = frames['terrain_water_f1_q0'];
    const uv = uvOf(c, 0);
    expect(Math.min(...uv.filter((_, i) => i % 2 === 0))).toBe(r.x);
    expect(Math.max(...uv.filter((_, i) => i % 2 === 1))).toBe(r.y + 16);
    expect(uvOf(c, 4)).toEqual(lavaUv);
    expect(stepTerrainUv(c, frames, 1.26)).toBe(false);
  });
});
