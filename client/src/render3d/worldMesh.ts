import { WALL_H, heightAt } from './heights';
import { isTerrain, type TileMap } from '../sim/map';
import { GROUND_TILES } from '../game/woodland/ground';
import { inDipMesh } from './dips/shape';
import { CHUNK, KIND, chunkBounds, chunkGrid, chunksOfTile } from './stone/grid';
import { buildStoneChunk } from './stone/mesh';
import { GRATE_DEPTH } from './stone/laidMesh';
import type { StoneField } from './stone/field';
import type { Marks } from './stone/place';
import type { SheetPlan } from './stone/plan';

export { CHUNK, KIND, chunkGrid, chunksOfTile };

/** Atlas frames by name, in atlas px. */
export type FrameRects = Record<string, { x: number; y: number; w: number; h: number }>;

/**
 * Per vertex: position (tiles), uv (the woodland ground's image px; zero on stone vertices), normal, kind, the
 * stone attributes (`sheet`, `faceA`, `faceB` as 3 values each, `push` as 2: see `stone/mesh.ts`; the woodland ground has layer -1) and an index.
 * `index`: three vertex numbers per triangle; `count`: vertices. The stone's flat pieces share theirs; the woodland's ground has 6 per quad.
 */
export interface WorldArrays {
  position: Float32Array;
  uv: Float32Array;
  normal: Float32Array;
  kind: Float32Array;
  sheet: Float32Array;
  faceA: Float32Array;
  faceB: Float32Array;
  push: Float32Array;
  index: Uint32Array;
  count: number;
}

export interface Chunk { cx: number; cz: number; world: WorldArrays; min: [number, number, number]; max: [number, number, number] }

/** What the stone cells of a chunk are built from. */
export interface StoneKit { field: StoneField; plan: SheetPlan; marks: Marks }

export type Corner = [x: number, y: number, z: number, u: number, v: number];

/** Growing vertex arrays, 6 vertices per quad. */
export interface QuadSink { position: number[]; uv: number[]; normal: number[]; kind: number[] }

/**
 * Pushes one quad as two triangles. c0..c3 run top-left, top-right, bottom-right, bottom-left as seen from the normal's side.
 * Whatever that order, the triangles are wound counter-clockwise seen from the normal.
 */
export function pushQuad(s: QuadSink, c: [Corner, Corner, Corner, Corner], n: [number, number, number], k: number): void {
  const [a, b, d] = [c[0], c[1], c[2]];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const dot = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
  const order = dot > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  for (const i of order) {
    const p = c[i];
    s.position.push(p[0], p[1], p[2]);
    s.uv.push(p[3], p[4]);
    s.normal.push(n[0], n[1], n[2]);
    s.kind.push(k);
  }
}

/**
 * What a height-0 cell shows where it is flat: the painted ground (kind ground) on a painted map's GROUND_TILES, else a stone sheet's
 * floor (kind floor). Terrain cells take the floor kind. (u0, v0) is the uv of the cell's corner (x, z).
 */
export function flatSurface(m: TileMap, painted: boolean, x: number, z: number): { kind: number; u0: number; v0: number } {
  const t = m.get(x, z);
  if (painted && !isTerrain(t) && GROUND_TILES.has(t)) return { kind: KIND.ground, u0: x * 16, v0: z * 16 };
  return { kind: KIND.floor, u0: 0, v0: 0 };
}

/**
 * The woodland's ground quads, then the stone cells (`buildStoneChunk`), of the cells x in [16cx, min(w, 16cx+16)), z likewise.
 * `painted`: the run has a woodland. One vertex layout for both, because one material draws them.
 */
export function buildChunk(m: TileMap, painted: boolean, cx: number, cz: number, kit: StoneKit): Chunk {
  const { x0, z0, x1, z1 } = chunkBounds(m, cx, cz);
  const position: number[] = [], uv: number[] = [], normal: number[] = [], kind: number[] = [];
  const isGround = (x: number, z: number): boolean => flatSurface(m, painted, x, z).kind === KIND.ground;

  if (painted) {
    const sink = { position, uv, normal, kind };
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      if (heightAt(m, x, z) !== 0 || inDipMesh(m, x, z) || !isGround(x, z)) continue;
      const f = flatSurface(m, painted, x, z);
      pushQuad(sink, [[x, 0, z, f.u0, f.v0], [x + 1, 0, z, f.u0 + 16, f.v0], [x + 1, 0, z + 1, f.u0 + 16, f.v0 + 16], [x, 0, z + 1, f.u0, f.v0 + 16]], [0, 1, 0], f.kind);
    }
  }
  const groundCount = kind.length;
  const s = buildStoneChunk(m, kit.field, kit.plan, kit.marks, cx, cz, painted ? isGround : undefined);
  const count = groundCount + s.count;
  const cat = (a: number[], b: Float32Array, per: number, fill: number[]): Float32Array => {
    const out = new Float32Array(count * per);
    out.set(a);
    out.set(b, groundCount * per);
    if (fill.length) for (let i = 0; i < groundCount; i++) out.set(fill, i * per);
    return out;
  };
  const NONE3 = [0, 0, -1];
  // the ground's quads keep six vertices each; the stone's own index follows, moved past them
  const index = new Uint32Array(groundCount + s.index.length);
  for (let i = 0; i < groundCount; i++) index[i] = i;
  for (let i = 0; i < s.index.length; i++) index[groundCount + i] = s.index[i] + groundCount;
  return {
    cx, cz,
    world: {
      position: cat(position, s.position, 3, []),
      uv: cat(uv, new Float32Array(s.count * 2), 2, []),
      normal: cat(normal, s.normal, 3, []),
      kind: cat(kind, s.kind, 1, []),
      sheet: cat([], s.sheet, 3, NONE3),
      faceA: cat([], s.faceA, 3, NONE3),
      faceB: cat([], s.faceB, 3, NONE3),
      push: cat([], s.push, 2, []),
      index,
      count,
    },
    min: [x0, -GRATE_DEPTH, z0], // floors lie at or below 0, a grate's shaft deepest
    max: [x1, WALL_H, z1],
  };
}
