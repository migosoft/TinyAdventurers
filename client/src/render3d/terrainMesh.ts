import { isTerrain, type TileMap } from '../sim/map';
import { TERRAIN_FPS, terrainLayers } from '../game/terrain-layers';
import { TERRAIN_FRAMES, TERRAIN_PERIOD, type TerrainSet } from '../game/terrain-codes';
import { CHUNK, KIND, pushQuad, type FrameRects, type Rect, type WorldArrays } from './worldMesh';

/** Tiles between the stacked layers of one cell. */
export const LAYER_STEP = 0.002;

export interface TerrainChunk {
  cx: number;
  cz: number;
  /** kind is KIND.floor for every vertex. */
  arrays: WorldArrays;
  /** Animated base quads: the index of their first vertex. */
  anim: { set: TerrainSet; q: number; first: number }[];
  /** The frame each set's uv currently shows. */
  frame: Record<TerrainSet, number>;
}

const SETS = Object.keys(TERRAIN_FRAMES) as TerrainSet[];

export function terrainFrame(set: TerrainSet, clock: number): number {
  return Math.floor(clock * TERRAIN_FPS[set]) % TERRAIN_FRAMES[set];
}

const rectOf = (frames: FrameRects, name: string): Rect => {
  const r = frames[name];
  if (!r) throw new Error(`atlas frame missing: ${name}`);
  return r;
};

/** The terrain layers of the cells in chunk (cx, cz), or null when it has no terrain cell. */
export function buildTerrainChunk(map: TileMap, cx: number, cz: number, frames: FrameRects, clock: number): TerrainChunk | null {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(map.w, x0 + CHUNK), z1 = Math.min(map.h, z0 + CHUNK);
  const sink = { position: [] as number[], uv: [] as number[], normal: [] as number[], kind: [] as number[], rect: [] as number[] };
  const anim: TerrainChunk['anim'] = [];
  const frame = {} as Record<TerrainSet, number>;
  for (const s of SETS) frame[s] = terrainFrame(s, clock);

  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (!isTerrain(map.get(x, z))) continue;
    const { base, edges } = terrainLayers(map, x, z);
    const names: string[] = [];
    base.forEach((set) => {
      const p = TERRAIN_PERIOD[set], q = (x % p) + p * (z % p);
      if (TERRAIN_FRAMES[set] > 1) anim.push({ set, q, first: sink.kind.length + 6 * names.length });
      names.push(`terrain_${set}_f${frame[set]}_q${q}`);
    });
    names.push(...edges);
    names.forEach((name, i) => {
      const r = rectOf(frames, name), y = i * LAYER_STEP;
      pushQuad(sink, [[x, y, z, r.x, r.y], [x + 1, y, z, r.x + 16, r.y], [x + 1, y, z + 1, r.x + 16, r.y + 16], [x, y, z + 1, r.x, r.y + 16]], [0, 1, 0], KIND.floor, r);
    });
  }
  if (sink.kind.length === 0) return null;
  return {
    cx, cz,
    arrays: {
      position: new Float32Array(sink.position), uv: new Float32Array(sink.uv), normal: new Float32Array(sink.normal),
      kind: new Float32Array(sink.kind), rect: new Float32Array(sink.rect), count: sink.kind.length,
    },
    anim, frame,
  };
}

/** Rewrites uv and rect of the animated quads whose set's frame changed; true when anything was written. */
export function stepTerrainUv(c: TerrainChunk, frames: FrameRects, clock: number): boolean {
  let wrote = false;
  const { uv, rect } = c.arrays;
  for (const set of SETS) {
    const f = terrainFrame(set, clock);
    if (f === c.frame[set]) continue;
    c.frame[set] = f;
    for (const a of c.anim) {
      if (a.set !== set) continue;
      const r = rectOf(frames, `terrain_${set}_f${f}_q${a.q}`);
      for (let v = a.first; v < a.first + 6; v++) {
        // uv keeps its offset inside the rect
        uv[v * 2] += r.x - rect[v * 4];
        uv[v * 2 + 1] += r.y - rect[v * 4 + 1];
        rect[v * 4] = r.x; rect[v * 4 + 1] = r.y; rect[v * 4 + 2] = r.w; rect[v * 4 + 3] = r.h;
      }
      wrote = true;
    }
  }
  return wrote;
}
