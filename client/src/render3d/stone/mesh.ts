// The flat stone mesh of one chunk (#380): one quad per floor cell, per face tile (two per wall side) and per wall top, as the world mesh
// built them before, now carrying the attributes the world material reads the stone sheets by. Pure: no three.
import type { TileMap } from '../../sim/map';
import { WALL_H, heightAt } from '../heights';
import { inDipMesh } from '../dips/shape';
import { FACE_H, FACE_W } from './format';
import { CHUNK, KIND, SIDE_STEP } from './grid';
import { STONE_PX, type StoneField } from './field';
import type { Marks } from './place';
import type { Face, FaceSlot, SheetPlan } from './plan';

export interface StoneArrays {
  position: Float32Array; normal: Float32Array; kind: Float32Array;
  /** vec3: the ground sheet's u, v (px) and layer; layer -1: no ground texel. */
  sheet: Float32Array;
  /** vec3: wall page u, v, layer for the north/south plane (sides 0 and 1); -1: none. */
  faceA: Float32Array;
  /** vec3: the same for the east/west plane (sides 2 and 3). */
  faceB: Float32Array;
  /** vec2: the offset (tiles, xz) to the point where light and sight are read; 0 for most. */
  push: Float32Array;
  index: Uint32Array; count: number;
}

/** The left and right edge end offsets of a face seen from outside, per side (the world mesh's order). */
const EDGE: readonly [number, number, number, number][] = [[0, 1, 1, 1], [1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 1]];
const NONE: [number, number, number] = [0, 0, -1];

/** A corner of a quad: position, and the three sheet coordinates. */
type Corner = { p: [number, number, number]; sheet: [number, number, number]; a: [number, number, number]; b: [number, number, number] };

/**
 * The stone cells of chunk (cx, cz). `skip` leaves cells to another mesh (the woodland's painted ground cells). Vertices are not shared:
 * `index` runs 0..count-1 in triangles (6 per quad), counter-clockwise seen from the normal.
 */
export function buildStoneChunk(map: TileMap, _f: StoneField, plan: SheetPlan, _marks: Marks, cx: number, cz: number, skip?: (x: number, z: number) => boolean): StoneArrays {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(map.w, x0 + CHUNK), z1 = Math.min(map.h, z0 + CHUNK);
  const layer = plan.groundOf(cx, cz);
  const position: number[] = [], normal: number[] = [], kind: number[] = [], sheet: number[] = [], faceA: number[] = [], faceB: number[] = [];

  /** The ground texel of the world point (x, z) in this chunk's page. */
  const ground = (x: number, z: number): [number, number, number] => [(x - x0) * STONE_PX, (z - z0) * STONE_PX, layer];
  const flatCorner = (x: number, y: number, z: number): Corner => ({ p: [x, y, z], sheet: ground(x, z), a: NONE, b: NONE });

  /** Pushes a quad as two triangles; c0..c3 run in either direction round it. */
  const quad = (c: [Corner, Corner, Corner, Corner], n: [number, number, number], k: number): void => {
    const [a, b, d] = [c[0].p, c[1].p, c[2].p];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const dot = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
    for (const i of dot > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      const v = c[i];
      position.push(...v.p);
      normal.push(...n);
      kind.push(k);
      sheet.push(...v.sheet);
      faceA.push(...v.a);
      faceB.push(...v.b);
    }
  };

  /** The faces of a wall cell on one side, one quad per tile of height; (ax, az) is the left edge end seen from outside. */
  const side = (x: number, z: number, s: number, h: number, hn: number, slot: FaceSlot): void => {
    const [dx, dz] = SIDE_STEP[s], [ax, az, bx, bz] = EDGE[s];
    for (let k = Math.floor(hn); k < h; k++) {
      const lo = Math.max(hn, k), hi = Math.min(h, k + 1);
      if (hi <= lo) continue;
      const vt = slot.v + (WALL_H - hi) * (FACE_H / WALL_H), vb = slot.v + (WALL_H - lo) * (FACE_H / WALL_H);
      // u grows with world +x on sides 0 and 1, with +z on sides 2 and 3.
      const u = (px: number, pz: number): number => slot.u + (s < 2 ? px - x : pz - z) * FACE_W;
      const corner = (ex: number, ey: number, ez: number, v: number): Corner => {
        const pos: [number, number, number] = [x + ex, ey, z + ez];
        const own: [number, number, number] = [u(x + ex, z + ez), v, slot.layer];
        return { p: pos, sheet: ground(pos[0], pos[2]), a: s < 2 ? own : NONE, b: s < 2 ? NONE : own };
      };
      quad([corner(ax, hi, az, vt), corner(bx, hi, bz, vt), corner(bx, lo, bz, vb), corner(ax, lo, az, vb)], [dx, 0, dz], KIND.face);
    }
  };

  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const h = heightAt(map, x, z);
    if (h === 0) {
      if (inDipMesh(map, x, z) || skip?.(x, z)) continue;
      quad([flatCorner(x, 0, z), flatCorner(x + 1, 0, z), flatCorner(x + 1, 0, z + 1), flatCorner(x, 0, z + 1)], [0, 1, 0], KIND.floor);
      continue;
    }
    quad([flatCorner(x, h, z), flatCorner(x + 1, h, z), flatCorner(x + 1, h, z + 1), flatCorner(x, h, z + 1)], [0, 1, 0], KIND.top);
    for (let s = 0; s < 4; s++) {
      const hn = heightAt(map, x + SIDE_STEP[s][0], z + SIDE_STEP[s][1]);
      if (hn >= h) continue;
      const face: Face = { x, z, side: s as 0 | 1 | 2 | 3 };
      side(x, z, s, h, hn, plan.slotOf(face));
    }
  }

  const count = kind.length;
  return {
    position: new Float32Array(position), normal: new Float32Array(normal), kind: new Float32Array(kind),
    sheet: new Float32Array(sheet), faceA: new Float32Array(faceA), faceB: new Float32Array(faceB),
    push: new Float32Array(count * 2),
    index: Uint32Array.from({ length: count }, (_, i) => i), count,
  };
}
