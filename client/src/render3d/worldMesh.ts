import { WALL_H, heightAt } from './heights';
import { isTerrain, type TileMap } from '../sim/map';
import { GROUND_TILES } from '../game/woodland/ground';

/** Atlas frames by name, in atlas px. */
export type FrameRects = Record<string, { x: number; y: number; w: number; h: number }>;

export const CHUNK = 16;

export const KIND = { floor: 0, face: 1, top: 2, ground: 3 } as const;

/** Per vertex: position (tiles), uv (atlas px), normal, kind, rect (the atlas frame the uv lies in). 6 vertices per quad. */
export interface WorldArrays {
  position: Float32Array;
  uv: Float32Array;
  normal: Float32Array;
  kind: Float32Array;
  rect: Float32Array;
  count: number;
}

export interface Chunk { cx: number; cz: number; world: WorldArrays; min: [number, number, number]; max: [number, number, number] }

export function tileHash(x: number, z: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export type Corner = [x: number, y: number, z: number, u: number, v: number];
export type Rect = { x: number; y: number; w: number; h: number };
const NO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** Growing vertex arrays, 6 vertices per quad. */
export interface QuadSink { position: number[]; uv: number[]; normal: number[]; kind: number[]; rect: number[] }

/**
 * Pushes one quad as two triangles. c0..c3 run top-left, top-right, bottom-right, bottom-left as seen from the normal's side.
 * Whatever that order, the triangles are wound counter-clockwise seen from the normal.
 */
export function pushQuad(s: QuadSink, c: [Corner, Corner, Corner, Corner], n: [number, number, number], k: number, r: Rect): void {
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
    s.rect.push(r.x, r.y, r.w, r.h);
  }
}

export function chunkGrid(map: { w: number; h: number }): { nx: number; nz: number } {
  return { nx: Math.ceil(map.w / CHUNK), nz: Math.ceil(map.h / CHUNK) };
}

/** The chunk of the cell and those of its four neighbours where they differ and lie inside the grid; no duplicates. */
export function chunksOfTile(map: { w: number; h: number }, x: number, z: number): [cx: number, cz: number][] {
  const { nx, nz } = chunkGrid(map);
  const out: [number, number][] = [];
  for (const [dx, dz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const cx = Math.floor((x + dx) / CHUNK), cz = Math.floor((z + dz) / CHUNK);
    if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
    if (!out.some((c) => c[0] === cx && c[1] === cz)) out.push([cx, cz]);
  }
  return out;
}

/** The floor frame of a cell: floor_1 for 93 %, the other seven share the rest (as autotile.ts). */
export function floorFrame(x: number, z: number): string {
  const h = tileHash(x, z);
  return h < 0.93 ? 'floor_1' : `floor_${2 + Math.floor(h * 1000) % 7}`;
}

const BANNERS = ['wall_banner_red', 'wall_banner_blue', 'wall_banner_green', 'wall_banner_yellow'];

/** Which frame a face quad shows. `side`: 0 south, 1 north, 2 east, 3 west; `row`: 0 the lower tile, 1 the upper. */
export function faceFrame(x: number, z: number, side: number, row: number, straight: boolean): string {
  if (!straight) return 'wall_mid';
  if (row === 0) {
    const q = tileHash(x * 4 + side + 91, z + 17);
    return q < 0.025 ? 'wall_hole_1' : q < 0.045 ? 'wall_hole_2' : q < 0.06 ? 'wall_goo' : 'wall_mid';
  }
  const q = tileHash(x + 31, z * 4 + side + 7);
  return q < 0.015 ? BANNERS[Math.floor(q * 4000) % 4] : 'wall_mid';
}

/** Floor, ground, faces and tops of the cells x in [16cx, min(w, 16cx+16)), z likewise. `painted`: the run has a woodland. */
export function buildChunk(m: TileMap, painted: boolean, cx: number, cz: number, frames: FrameRects): Chunk {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(m.w, x0 + CHUNK), z1 = Math.min(m.h, z0 + CHUNK);
  const position: number[] = [], uv: number[] = [], normal: number[] = [], kind: number[] = [], rect: number[] = [];
  const frame = (name: string): Rect => {
    const r = frames[name];
    if (!r) throw new Error(`atlas frame missing: ${name}`);
    return r;
  };

  const quad = (c: [Corner, Corner, Corner, Corner], n: [number, number, number], k: number, r: Rect) => pushQuad({ position, uv, normal, kind, rect }, c, n, k, r);

  /** Faces of a wall cell on one side, one quad per tile of height; (ax,az) is the left edge end seen from outside. */
  const side = (h: number, hn: number, ax: number, az: number, bx: number, bz: number, n: [number, number, number], pick: (k: number) => string) => {
    for (let k = Math.floor(hn); k < h; k++) {
      const lo = Math.max(hn, k), hi = Math.min(h, k + 1);
      if (hi <= lo) continue;
      const r = frame(pick(k));
      const vt = r.y + (k + 1 - hi) * 16, vb = r.y + (k + 1 - lo) * 16;
      quad([[ax, hi, az, r.x, vt], [bx, hi, bz, r.x + 16, vt], [bx, lo, bz, r.x + 16, vb], [ax, lo, az, r.x, vb]], n, KIND.face, r);
    }
  };

  // dx, dz of the neighbour, then the left (ax, az) and right (bx, bz) edge end offsets seen from outside.
  const sideDefs: [number, number, number, number, number, number][] = [
    [0, 1, 0, 1, 1, 1],
    [0, -1, 1, 0, 0, 0],
    [1, 0, 1, 1, 1, 0],
    [-1, 0, 0, 0, 0, 1],
  ];
  const fullFace = (x: number, z: number, s: number) => heightAt(m, x, z) === WALL_H && heightAt(m, x + sideDefs[s][0], z + sideDefs[s][1]) === 0;

  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const h = heightAt(m, x, z);
    if (h === 0) {
      const t = m.get(x, z);
      if (isTerrain(t)) continue;
      if (painted && GROUND_TILES.has(t)) {
        const gr: Rect = { x: 0, y: 0, w: m.w * 16, h: m.h * 16 };
        quad([[x, 0, z, x * 16, z * 16], [x + 1, 0, z, x * 16 + 16, z * 16], [x + 1, 0, z + 1, x * 16 + 16, z * 16 + 16], [x, 0, z + 1, x * 16, z * 16 + 16]], [0, 1, 0], KIND.ground, gr);
        continue;
      }
      const r = frame(floorFrame(x, z));
      quad([[x, 0, z, r.x, r.y], [x + 1, 0, z, r.x + 16, r.y], [x + 1, 0, z + 1, r.x + 16, r.y + 16], [x, 0, z + 1, r.x, r.y + 16]], [0, 1, 0], KIND.floor, r);
      continue;
    }
    quad([[x, h, z, 0, 0], [x + 1, h, z, 0, 0], [x + 1, h, z + 1, 0, 0], [x, h, z + 1, 0, 0]], [0, 1, 0], KIND.top, NO_RECT);
    for (let s = 0; s < 4; s++) {
      const d = sideDefs[s];
      const hn = heightAt(m, x + d[0], z + d[1]);
      if (hn >= h) continue;
      // beside along the wall: east and west for sides 0 and 1, north and south for sides 2 and 3
      const [bx, bz] = s < 2 ? [1, 0] : [0, 1];
      const straight = fullFace(x + bx, z + bz, s) && fullFace(x - bx, z - bz, s);
      side(h, hn, x + d[2], z + d[3], x + d[4], z + d[5], [d[0], 0, d[1]], (k) => faceFrame(x, z, s, k, straight));
    }
  }

  return {
    cx, cz,
    world: {
      position: new Float32Array(position),
      uv: new Float32Array(uv),
      normal: new Float32Array(normal),
      kind: new Float32Array(kind),
      rect: new Float32Array(rect),
      count: kind.length,
    },
    min: [x0, 0, z0],
    max: [x1, WALL_H, z1],
  };
}
