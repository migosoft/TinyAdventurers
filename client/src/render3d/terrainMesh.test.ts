import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { terrainLayers } from '../game/terrain-layers';
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
  it('a shallow cell in floor has a water base and a shore edge', () => {
    const map = with_(3, 3, [[0, 0, T.ShallowWater]]);
    const c = buildTerrainChunk(map, 0, 0, frames, 0)!;
    expect(quadCount(c)).toBe(2);
    expect(ys(c)).toEqual([0, expect.closeTo(LAYER_STEP, 6)]);
    expect(rectOf(c, 0)).toEqual(rectArr('terrain_water_f0_q0'));
    expect([...c.arrays.kind].every((k) => k === 0)).toBe(true);
  });

  it('a deep cell has water, deep and its edges', () => {
    const map = with_(5, 5, [[2, 2, T.DeepWater]]);
    const c = buildTerrainChunk(map, 0, 0, frames, 0)!;
    const l = terrainLayers(map, 2, 2);
    expect(quadCount(c)).toBe(l.base.length + l.edges.length);
    expect(rectOf(c, 0)).toEqual(rectArr('terrain_water_f0_q' + ((2 % 2) + 2 * (2 % 2))));
    expect(rectOf(c, 1)).toEqual(rectArr('terrain_deep_f0_q' + ((2 % 4) + 4 * (2 % 4))));
  });

  it('lava and chasm cells give their sets; chasm is not animated', () => {
    const map = with_(4, 4, [[1, 1, T.Lava], [3, 3, T.Chasm]]);
    const c = buildTerrainChunk(map, 0, 0, frames, 0)!;
    const names = new Set<string>();
    for (let q = 0; q < quadCount(c); q++) for (const [k, r] of Object.entries(frames)) if (rectOf(c, q).join() === [r.x, r.y, r.w, r.h].join()) names.add(k);
    expect(names.has('terrain_lava_f0_q5')).toBe(true);
    expect(names.has('terrain_chasm_f0_q' + (1 % 2 + 2 * (1 % 2)) ) || names.has('terrain_chasm_f0_q' + (3 % 2 + 2 * (3 % 2)))).toBe(true);
    expect(c.anim.some((a) => a.set === 'lava')).toBe(true);
    expect(c.anim.some((a) => (a.set as string) === 'chasm')).toBe(false);
  });

  it('a chunk without terrain is null', () => {
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
    const map = with_(3, 3, [[0, 0, T.ShallowWater]]);
    const c = buildTerrainChunk(map, 0, 0, frames, 0)!;
    const edgeUv = uvOf(c, 1);
    expect(stepTerrainUv(c, frames, 0)).toBe(false);
    expect(stepTerrainUv(c, frames, 0.26)).toBe(true);
    expect(rectOf(c, 0)).toEqual(rectArr('terrain_water_f1_q0'));
    const r = frames['terrain_water_f1_q0'];
    const uv = uvOf(c, 0);
    expect(Math.min(...uv.filter((_, i) => i % 2 === 0))).toBe(r.x);
    expect(Math.max(...uv.filter((_, i) => i % 2 === 1))).toBe(r.y + 16);
    expect(uvOf(c, 1)).toEqual(edgeUv);
    expect(stepTerrainUv(c, frames, 0.27)).toBe(false);
  });
});
