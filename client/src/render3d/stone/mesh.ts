// The stone mesh of one chunk (#380): laid floors and wall faces block by block (`laidMesh.ts`), a flat quad per wall top and per face
// tile of rock, and the drain grates' bars (`ornamentMesh.ts`), with the attributes the world material reads the stone sheets by.
// Pure: no three.
import type { TileMap } from '../../sim/map';
import { inDipMesh } from '../dips/shape';
import { WALL_H, heightAt } from '../heights';
import { FACE_H, FACE_W } from './format';
import { CHUNK, KIND, SIDE_STEP } from './grid';
import { STONE_PX, type StoneField } from './field';
import { NONE, faceOf, laid, laidFace, laidFloor, type Corner, type Tri, type Vec3 } from './laidMesh';
import { grateBars } from './ornamentMesh';
import type { Marks } from './place';
import type { FaceSlot, SheetPlan } from './plan';

export interface StoneArrays {
  position: Float32Array; normal: Float32Array; kind: Float32Array;
  /** vec3: the ground sheet's u, v (px) and layer; layer -1: no ground texel. */
  sheet: Float32Array;
  /** vec3: wall page u, v, layer for the north/south plane (sides 0 and 1); -1: none. A skirt of a wall block has its px in both planes. */
  faceA: Float32Array;
  /** vec3: the same for the east/west plane (sides 2 and 3). */
  faceB: Float32Array;
  /** vec2: the offset (tiles, xz) to the point where light and sight are read: a wall block that stands back reads at the cell's edge. */
  push: Float32Array;
  index: Uint32Array; count: number;
}

/** The left and right edge end offsets of a face seen from outside, per side (the world mesh's order). */
const EDGE: readonly [number, number, number, number][] = [[0, 1, 1, 1], [1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 1]];
/** A wall's face goes on this far (tiles) below its foot, so the floor's sunk blocks end against stone. */
const FOOT = 0.25;

/**
 * The stone cells of chunk (cx, cz). `skip` leaves cells to another mesh (the woodland's painted ground cells). Vertices are not shared:
 * `index` runs 0..count-1 in triangles, counter-clockwise seen from the normal.
 */
export function buildStoneChunk(map: TileMap, f: StoneField, plan: SheetPlan, marks: Marks, cx: number, cz: number, skip?: (x: number, z: number) => boolean): StoneArrays {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(map.w, x0 + CHUNK), z1 = Math.min(map.h, z0 + CHUNK);
  const layer = plan.groundOf(cx, cz);
  // Typed arrays that double when full: a laid chunk has some thirty thousand vertices, and plain arrays took most of the build's time.
  let cap = 16384, count = 0;
  let position = new Float32Array(cap * 3), normal = new Float32Array(cap * 3), kind = new Float32Array(cap), sheet = new Float32Array(cap * 3);
  let faceA = new Float32Array(cap * 3), faceB = new Float32Array(cap * 3), push = new Float32Array(cap * 2);
  const more = (a: Float32Array): Float32Array<ArrayBuffer> => { const b = new Float32Array(a.length * 2); b.set(a); return b; };

  /** The ground texel of the world point (x, z) in this chunk's page. */
  const ground = (x: number, z: number): Vec3 => [(x - x0) * STONE_PX, (z - z0) * STONE_PX, layer];
  const flatCorner = (x: number, y: number, z: number): Corner => ({ p: [x, y, z], sheet: ground(x, z), a: NONE, b: NONE });

  const tri: Tri = (c0, c1, c2, n, k) => {
    const [a, b, d] = [c0.p, c1.p, c2.p];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const dot = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
    if (count + 3 > cap) {
      cap *= 2;
      position = more(position); normal = more(normal); kind = more(kind); sheet = more(sheet); faceA = more(faceA); faceB = more(faceB); push = more(push);
    }
    for (let i = 0; i < 3; i++) {
      const v = i === 0 ? c0 : (i === 1) === dot > 0 ? c1 : c2, at = count * 3;
      position[at] = v.p[0]; position[at + 1] = v.p[1]; position[at + 2] = v.p[2];
      normal[at] = n[0]; normal[at + 1] = n[1]; normal[at + 2] = n[2];
      sheet[at] = v.sheet[0]; sheet[at + 1] = v.sheet[1]; sheet[at + 2] = v.sheet[2];
      faceA[at] = v.a[0]; faceA[at + 1] = v.a[1]; faceA[at + 2] = v.a[2];
      faceB[at] = v.b[0]; faceB[at + 1] = v.b[1]; faceB[at + 2] = v.b[2];
      if (v.push) { push[count * 2] = v.push[0]; push[count * 2 + 1] = v.push[1]; }
      kind[count++] = k;
    }
  };
  /** A quad as two triangles; c0..c3 run in either direction round it. */
  const quad = (c: [Corner, Corner, Corner, Corner], n: Vec3, k: number): void => { tri(c[0], c[1], c[2], n, k); tri(c[0], c[2], c[3], n, k); };

  /** A face of rock, one quad per tile of height; (ax, az) is the left edge end seen from outside. */
  const side = (x: number, z: number, s: number, h: number, hn: number, slot: FaceSlot): void => {
    const [dx, dz] = SIDE_STEP[s], [ax, az, bx, bz] = EDGE[s];
    for (let k = Math.floor(hn); k < h; k++) {
      const lo = Math.max(hn, k), hi = Math.min(h, k + 1);
      if (hi <= lo) continue;
      const vt = slot.v + (WALL_H - hi) * (FACE_H / WALL_H), vb = slot.v + (WALL_H - lo) * (FACE_H / WALL_H);
      // u grows with world +x on sides 0 and 1, with +z on sides 2 and 3.
      const u = (px: number, pz: number): number => slot.u + (s < 2 ? px - x : pz - z) * FACE_W;
      const corner = (ex: number, ey: number, ez: number, v: number): Corner => {
        const pos: Vec3 = [x + ex, ey, z + ez];
        const own: Vec3 = [u(x + ex, z + ez), v, slot.layer];
        return { p: pos, sheet: ground(pos[0], pos[2]), a: s < 2 ? own : NONE, b: s < 2 ? NONE : own };
      };
      quad([corner(ax, hi, az, vt), corner(bx, hi, bz, vt), corner(bx, lo, bz, vb), corner(ax, lo, az, vb)], [dx, 0, dz], KIND.face);
    }
  };
  /** The foot below a face: the face's lowest px row, drawn on down in the cell's edge. */
  const foot = (x: number, z: number, s: number, hn: number, slot: FaceSlot): void => {
    const [dx, dz] = SIDE_STEP[s], [ax, az, bx, bz] = EDGE[s];
    const corner = (ex: number, y: number, ez: number): Corner => {
      const own: Vec3 = [slot.u + (s < 2 ? ex : ez) * FACE_W, slot.v + FACE_H - 0.5, slot.layer];
      return { p: [x + ex, y, z + ez], sheet: NONE, a: own, b: own };
    };
    quad([corner(ax, hn, az), corner(bx, hn, bz), corner(bx, hn - FOOT, bz), corner(ax, hn - FOOT, az)], [dx, 0, dz], KIND.face);
  };

  const c = laid(map, f, plan, marks, x0, z0, layer, skip);
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const h = heightAt(map, x, z);
    if (h === 0) { laidFloor(c, x, z, tri); continue; }
    quad([flatCorner(x, h, z), flatCorner(x + 1, h, z), flatCorner(x + 1, h, z + 1), flatCorner(x, h, z + 1)], [0, 1, 0], KIND.top);
    for (let s = 0; s < 4; s++) {
      const fs = faceOf(c, x, z, s);
      if (!fs) continue;
      const slot = plan.slotOf(fs.face);
      if (fs.rock) side(x, z, s, h, fs.hn, slot);
      else laidFace(c, fs, tri);
      // only beside laid floor: a lower wall hides it, and the dip mesh draws its own skirt in this plane
      if (fs.hn === 0 && !inDipMesh(map, x + SIDE_STEP[s][0], z + SIDE_STEP[s][1])) foot(x, z, s, fs.hn, slot);
    }
  }
  for (const g of marks.grates) if (g.x >= x0 && g.x < x1 && g.z >= z0 && g.z < z1) grateBars(f, map, marks, g, ground, quad);

  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  return {
    position: position.slice(0, count * 3), normal: normal.slice(0, count * 3), kind: kind.slice(0, count),
    sheet: sheet.slice(0, count * 3), faceA: faceA.slice(0, count * 3), faceB: faceB.slice(0, count * 3), push: push.slice(0, count * 2),
    index, count,
  };
}
