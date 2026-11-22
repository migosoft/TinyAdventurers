// The painter of the stone sheets (#380): laid stone is painted px by px by `paintLaid.ts`; rock is still a STAND-IN (a flat colour) that
// Task 10 fills in. Pure: no three.
import type { TileMap } from '../../sim/map';
import { FACE_H, FACE_W, FLAT_A, PAGE } from './format';
import { CHUNK } from './grid';
import type { StoneField } from './field';
import { faceDamp, groundCtx, laidFacePx, laidGroundPx } from './paintLaid';
import type { Face } from './plan';
import type { Marks } from './place';

/** The stand-in colour of rock (0..255). */
export const STAND_IN_ROCK = [92, 90, 86] as const;

function rock(out: Uint8Array, at: number): void {
  out[at] = STAND_IN_ROCK[0];
  out[at + 1] = STAND_IN_ROCK[1];
  out[at + 2] = STAND_IN_ROCK[2];
  out[at + 3] = FLAT_A;
}

/**
 * Paints rows [row0, row1) of the ground page of chunk (cx, cz) into `out` (a whole page, PAGE by PAGE RGBA). The texel of world point
 * (x, z) is ((x - 16cx) * 32, (z - 16cz) * 32). The painter works in world stone px, so a pattern runs on across pages.
 */
export function paintGroundRows(f: StoneField, map: TileMap, marks: Marks, cx: number, cz: number, row0: number, row1: number, out: Uint8Array): void {
  const c = groundCtx(f, map, marks, cx, cz), u0 = cx * CHUNK * 32, v0 = cz * CHUNK * 32;
  for (let py = row0; py < row1; py++) for (let px = 0; px < PAGE; px++) {
    const at = (py * PAGE + px) * 4;
    if (!laidGroundPx(c, u0 + px, v0 + py, out, at)) rock(out, at);
  }
}

/**
 * Paints one wall face into `out` (FACE_W by FACE_H RGBA). u grows with world +x (sides 0, 1) or +z (sides 2, 3), v grows downward from the
 * wall's top.
 */
export function paintFace(f: StoneField, map: TileMap, marks: Marks, face: Face, out: Uint8Array): void {
  const damp = faceDamp(map, marks, face);
  for (let v = 0; v < FACE_H; v++) for (let u = 0; u < FACE_W; u++) {
    const at = (v * FACE_W + u) * 4;
    if (!laidFacePx(f, map, face, damp, u, v, out, at)) rock(out, at);
  }
}
