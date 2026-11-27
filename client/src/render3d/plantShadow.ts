// Plant shadows (#333), the pure part: which depth tiles a frame needs (one orthographic tile per crack whose beam meets a plant, up to
// six 90 degree cube faces per point light whose frustum meets one) and the table the shader reads to find them. No GPU here.
import { Box3, Frustum, Matrix4, PerspectiveCamera } from 'three/webgpu';
import { LIGHT } from '../generated/defs';
import { CRACK_CAP, RIM_HI, type Crack } from './air/cracks';
import { CHASM_BED } from './dips/shape';
import { LIGHT_CAP, type Light } from './light';
import { LIGHT_MARGIN } from './lights';
import type { Vec3 } from './sun';

/** A plant's bounds: foot (x, z), reach (`BuiltTree.radius`) and height, in tiles. */
export interface PlantBound { x: number; z: number; r: number; h: number }
/** A tile's camera. `persp`: a 90 degree face at C (ext unused); else orthographic like the sun's (ext = half sizes along R, U, F, C the middle). */
export interface TileCam { C: Vec3; R: Vec3; U: Vec3; F: Vec3; ext: Vec3; persp: boolean }
export interface ShadowTile { kind: 'crack' | 'face'; slot: number; face: number; cam: TileCam }
export interface ShadowPlan { tiles: ShadowTile[]; lightFaces: Int16Array; crackTile: Int16Array }

/** The six faces: +x, -x, +y, -y, +z, -z. R = F x U. */
export const FACES: readonly { F: Vec3; U: Vec3 }[] = [
  { F: [1, 0, 0], U: [0, 1, 0] },
  { F: [-1, 0, 0], U: [0, 1, 0] },
  { F: [0, 1, 0], U: [0, 0, -1] },
  { F: [0, -1, 0], U: [0, 0, 1] },
  { F: [0, 0, 1], U: [0, 1, 0] },
  { F: [0, 0, -1], U: [0, 1, 0] },
];
/** First guesses (#333): the face cameras' planes; far is the longest light reach plus two tiles. */
export const PLANT_NEAR = 0.05;
export const PLANT_FAR = Math.max(...Object.values(LIGHT).map((l) => l.radius)) + LIGHT_MARGIN + 2;
/** A little room around a crack tile's box so a corner on its edge stays inside (first guess). */
const PAD = 1e-3;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const corners = (p: PlantBound): Vec3[] => {
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [0, p.h]) for (const sz of [-1, 1]) out.push([p.x + sx * p.r, sy, p.z + sz * p.r]);
  return out;
};

/** The orthographic tile of a crack's beam over the plants it meets, or null when none does. */
export function crackCam(c: Crack, plants: readonly PlantBound[]): TileCam | null {
  const F: Vec3 = [-c.dir[0], -c.dir[1], -c.dir[2]];
  const U = norm([-F[0] * F[1], 1 - F[1] * F[1], -F[2] * F[1]]); // up, made level-free: perpendicular to F
  const R = cross(F, U);
  const rho = Math.max(c.rx, c.rz) * RIM_HI * Math.max(1, c.widen); // the beam's radius across its axis (shortcut: the floor ellipse's, a bit wide)
  const P0: Vec3 = [c.fx, 0, c.fz];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of plants) {
    let pa0 = Infinity, pa1 = -Infinity, pb0 = Infinity, pb1 = -Infinity;
    for (const k of corners(p)) {
      const d: Vec3 = [k[0] - P0[0], k[1] - P0[1], k[2] - P0[2]];
      const a = dot(d, R), b = dot(d, U);
      pa0 = Math.min(pa0, a); pa1 = Math.max(pa1, a); pb0 = Math.min(pb0, b); pb1 = Math.max(pb1, b);
    }
    if (Math.hypot(Math.max(pa0, 0, -pa1), Math.max(pb0, 0, -pb1)) > rho) continue; // the box's nearest point to the axis is outside the beam
    a0 = Math.min(a0, Math.max(pa0, -rho)); a1 = Math.max(a1, Math.min(pa1, rho));
    b0 = Math.min(b0, Math.max(pb0, -rho)); b1 = Math.max(b1, Math.min(pb1, rho));
  }
  if (a0 > a1) return null;
  // depth along F from the ceiling (-ceil / dir.y) to the chasm bed (CHASM_BED + 1 below the floor)
  const t0 = -c.ceil / c.dir[1], t1 = (CHASM_BED + 1) / c.dir[1];
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2, ct = (t0 + t1) / 2;
  const C: Vec3 = [0, 1, 2].map((i) => P0[i] + R[i] * ca + U[i] * cb + F[i] * ct) as Vec3;
  return { C, R, U, F, ext: [(a1 - a0) / 2 + PAD, (b1 - b0) / 2 + PAD, (t1 - t0) / 2], persp: false };
}

const faceCam = new PerspectiveCamera(90, 1, PLANT_NEAR, PLANT_FAR);
const frustum = new Frustum();
const pv = new Matrix4();
const box = new Box3();
/** Whether any plant meets the 90 degree frustum of `face` at L and lies within `reach` of it (horizontally). */
export function faceHits(L: Vec3, face: number, reach: number, plants: readonly PlantBound[]): boolean {
  const { F, U } = FACES[face];
  faceCam.position.set(...L);
  faceCam.up.set(...U);
  faceCam.lookAt(L[0] + F[0], L[1] + F[1], L[2] + F[2]);
  faceCam.updateMatrixWorld(true);
  faceCam.updateProjectionMatrix();
  frustum.setFromProjectionMatrix(pv.multiplyMatrices(faceCam.projectionMatrix, faceCam.matrixWorldInverse));
  for (const p of plants) {
    const dx = Math.max(Math.abs(L[0] - p.x) - p.r, 0), dz = Math.max(Math.abs(L[2] - p.z) - p.r, 0);
    if (Math.hypot(dx, dz) > reach) continue;
    box.min.set(p.x - p.r, 0, p.z - p.r);
    box.max.set(p.x + p.r, p.h, p.z + p.r);
    if (frustum.intersectsBox(box)) return true;
  }
  return false;
}

const faceTile = (L: Vec3, face: number): TileCam => {
  const { F, U } = FACES[face];
  return { C: L, R: cross(F, U), U, F, ext: [0, 0, 0], persp: true };
};

/** Cracks first (slot order), then lights in list order with their faces in `FACES` order, until `cap` tiles. */
export function planTiles(lights: readonly Light[], cracks: readonly Crack[], plants: readonly PlantBound[], cap: number): ShadowPlan {
  const plan: ShadowPlan = { tiles: [], lightFaces: new Int16Array(LIGHT_CAP * 6).fill(-1), crackTile: new Int16Array(CRACK_CAP).fill(-1) };
  if (plants.length === 0) return plan;
  const { tiles } = plan;
  for (let s = 0; s < Math.min(cracks.length, CRACK_CAP) && tiles.length < cap; s++) {
    const cam = crackCam(cracks[s], plants);
    if (!cam) continue;
    plan.crackTile[s] = tiles.length;
    tiles.push({ kind: 'crack', slot: s, face: 0, cam });
  }
  for (let i = 0; i < Math.min(lights.length, LIGHT_CAP); i++) {
    const l = lights[i];
    if (!l.shadow) continue;
    const L: Vec3 = [l.x, l.y, l.z];
    for (let f = 0; f < 6 && tiles.length < cap; f++) {
      if (!faceHits(L, f, l.radius + LIGHT_MARGIN, plants)) continue;
      plan.lightFaces[i * 6 + f] = tiles.length;
      tiles.push({ kind: 'face', slot: i, face: f, cam: faceTile(L, f) });
    }
  }
  return plan;
}

/** The CPU twin of the shader's face lookup: `d` = P - L. u, v in 0..1 (v unflipped), window depth `f(a - n) / (a(f - n))` clamped to 0..1 (1 past PLANT_FAR). */
export function faceCoord(d: Vec3, face: number): { u: number; v: number; depth: number } {
  const { F, U } = FACES[face];
  const a = Math.max(dot(d, F), PLANT_NEAR);
  const depth = Math.min(1, (PLANT_FAR * (a - PLANT_NEAR)) / (a * (PLANT_FAR - PLANT_NEAR)));
  return { u: 0.5 + dot(d, cross(F, U)) / (2 * a), v: 0.5 + dot(d, U) / (2 * a), depth: a >= PLANT_FAR ? 1 : depth };
}

/** The CPU twin of the crack lookup: P in the tile's box (ext, centred at C). depth clamped to 0..1; `inside` is about u and v. */
export function crackCoord(cam: TileCam, P: Vec3): { u: number; v: number; depth: number; inside: boolean } {
  const d: Vec3 = [P[0] - cam.C[0], P[1] - cam.C[1], P[2] - cam.C[2]];
  const u = 0.5 + dot(d, cam.R) / (2 * cam.ext[0]);
  const v = 0.5 + dot(d, cam.U) / (2 * cam.ext[1]);
  const depth = Math.min(1, Math.max(0, 0.5 + dot(d, cam.F) / (2 * cam.ext[2])));
  return { u, v, depth, inside: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
}

/** The table's length in vec4: the header, six face ids per light slot (two vec4), four vec4 per crack slot. */
export const TABLE_LEN = 1 + LIGHT_CAP * 2 + CRACK_CAP * 4;

/** Packs the plan into `into` (TABLE_LEN * 4 floats): `[0]` = (perRow, tileCount, flip, 0); light slot i at 1 + 2i (faces 0..3, then 4, 5, -1, -1); crack slot s at 1 + 2 LIGHT_CAP + 4s: (C, tile), (R, ext.x), (U, ext.y), (F, ext.z). */
export function packTable(plan: ShadowPlan, perRow: number, flip: boolean, into: Float32Array): void {
  into.fill(0);
  into.set([perRow, plan.tiles.length, flip ? 1 : 0, 0], 0);
  for (let i = 0; i < LIGHT_CAP; i++) {
    const o = (1 + 2 * i) * 4, f = plan.lightFaces;
    into.set([f[i * 6], f[i * 6 + 1], f[i * 6 + 2], f[i * 6 + 3], f[i * 6 + 4], f[i * 6 + 5], -1, -1], o);
  }
  const base = (1 + 2 * LIGHT_CAP) * 4;
  for (let s = 0; s < CRACK_CAP; s++) {
    const o = base + s * 16, id = plan.crackTile[s];
    if (id < 0) { into[o + 3] = -1; continue; }
    const { C, R, U, F, ext } = plan.tiles[id].cam;
    into.set([C[0], C[1], C[2], id, R[0], R[1], R[2], ext[0], U[0], U[1], U[2], ext[1], F[0], F[1], F[2], ext[2]], o);
  }
}

/** The atlas for `cap` tiles of `tile` px: `perRow` tiles a row, `size` px a side. */
export function atlasLayout(tile: number, cap: number): { perRow: number; size: number } {
  const perRow = Math.ceil(Math.sqrt(cap));
  return { perRow, size: perRow * tile };
}
/** Tile `i`'s rectangle in the atlas (px, origin top left: what a render target's viewport reads, row 0 on top). */
export function tileRect(i: number, perRow: number, tile: number): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(i / perRow);
  return { x: (i - row * perRow) * tile, y: row * tile, w: tile, h: tile };
}

/** Depth biases (window depth, first guesses, set by eye in Task 5): a point light's face and a crack's tile. */
export const PLANT_BIAS = 0.0015;
export const CRACK_BIAS = 0.0005;

/**
 * The CPU twin of the shader's soft compare (`plantShadowNodes.ts` mirrors it line by line): the four texels around (u, v) of tile `id`
 * (tiles of `atlasTexels / perRow` texels, row 0 on top), each a 0/1 compare (lit when its depth is not nearer than `depth - bias`), mixed by
 * the bilinear weights; every texel is clamped inside the tile. `v` is unflipped; the table's flip flag mirrors it (the sun's rule).
 */
function softCompare(table: Float32Array, read: (x: number, y: number) => number, atlasTexels: number, id: number, u: number, v: number, depth: number, bias: number): number {
  const perRow = table[0], T = atlasTexels / perRow;
  const row = Math.floor((id + 0.5) / perRow), col = id - row * perRow; // the +0.5 keeps an inexact GPU division from landing in the wrong row
  const fu = Math.min(Math.max(u, 0), 1) * T - 0.5;
  const fv = (table[2] > 0.5 ? 1 - v : v);
  const fvv = Math.min(Math.max(fv, 0), 1) * T - 0.5;
  const x0 = Math.floor(fu), y0 = Math.floor(fvv), wx = fu - x0, wy = fvv - y0;
  const cl = (k: number): number => Math.min(Math.max(k, 0), T - 1);
  const at = (dx: number, dy: number): number => (read(col * T + cl(x0 + dx), row * T + cl(y0 + dy)) >= depth - bias ? 1 : 0);
  const top = at(0, 0) * (1 - wx) + at(1, 0) * wx, bot = at(0, 1) * (1 - wx) + at(1, 1) * wx;
  return top * (1 - wy) + bot * wy;
}

/** 1 (lit) or less where a plant shadows P from the light at L (light slot `slot`): the face by the major axis of P - L, one soft compare. A slot without a tile, or an empty table, is lit and reads nothing. */
export function pointVisAt(table: Float32Array, read: (x: number, y: number) => number, atlasTexels: number, P: Vec3, slot: number, L: Vec3): number {
  if (table[1] < 0.5) return 1;
  const d: Vec3 = [P[0] - L[0], P[1] - L[1], P[2] - L[2]];
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  const face = ax >= ay && ax >= az ? (d[0] >= 0 ? 0 : 1) : ay >= az ? (d[1] >= 0 ? 2 : 3) : d[2] >= 0 ? 4 : 5;
  const id = table[(1 + 2 * slot) * 4 + face];
  if (id < 0) return 1;
  const c = faceCoord(d, face);
  return softCompare(table, read, atlasTexels, id, c.u, c.v, c.depth, PLANT_BIAS);
}

/** The same for crack slot `slot`: the tile's box at P; a point outside it, a slot without a tile or an empty table is lit and reads nothing. */
export function crackVisAt(table: Float32Array, read: (x: number, y: number) => number, atlasTexels: number, P: Vec3, slot: number): number {
  if (table[1] < 0.5) return 1;
  const o = (1 + 2 * LIGHT_CAP + 4 * slot) * 4;
  const id = table[o + 3];
  if (id < 0) return 1;
  const cam: TileCam = {
    C: [table[o], table[o + 1], table[o + 2]], R: [table[o + 4], table[o + 5], table[o + 6]], U: [table[o + 8], table[o + 9], table[o + 10]],
    F: [table[o + 12], table[o + 13], table[o + 14]], ext: [table[o + 7], table[o + 11], table[o + 15]], persp: false,
  };
  const c = crackCoord(cam, P);
  return c.inside ? softCompare(table, read, atlasTexels, id, c.u, c.v, c.depth, CRACK_BIAS) : 1;
}
