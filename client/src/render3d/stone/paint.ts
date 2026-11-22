// The painter of the stone sheets (#380): laid stone is painted px by px by `paintLaid.ts`, and where the block layout has no block
// (rock, and the gaps of the border where masonry breaks up) by `paintRock.ts`. Pure: no three.
import type { TileMap } from '../../sim/map';
import { FACE_H, FACE_W, PAGE } from './format';
import { CHUNK } from './grid';
import type { StoneField } from './field';
import { faceDamp, forgetMoss, groundCtx, laidFacePx, laidGroundPx } from './paintLaid';
import { forgetLines, rockFacePx, rockGroundPx, rockLines } from './paintRock';
import type { Face } from './plan';
import type { Marks } from './place';

/** Drops what the painters keep of the level (the moss source, the rock's line masks): the paint job calls it when its last unit is done. */
export const paintDone = (): void => { forgetMoss(); forgetLines(); };

/**
 * Paints rows [row0, row1) of the ground page of chunk (cx, cz) into `out` (a whole page, PAGE by PAGE RGBA). The texel of world point
 * (x, z) is ((x - 16cx) * 32, (z - 16cz) * 32). The painter works in world stone px, so a pattern runs on across pages.
 */
export function paintGroundRows(f: StoneField, map: TileMap, marks: Marks, cx: number, cz: number, row0: number, row1: number, out: Uint8Array): void {
  const c = groundCtx(f, map, marks, cx, cz), l = rockLines(f, map, marks), u0 = cx * CHUNK * 32, v0 = cz * CHUNK * 32;
  for (let py = row0; py < row1; py++) for (let px = 0; px < PAGE; px++) {
    const at = (py * PAGE + px) * 4;
    if (!laidGroundPx(c, u0 + px, v0 + py, out, at)) rockGroundPx(c, l, u0 + px, v0 + py, out, at);
  }
}

/**
 * Paints one wall face into `out` (FACE_W by FACE_H RGBA). u grows with world +x (sides 0, 1) or +z (sides 2, 3), v grows downward from the
 * wall's top.
 */
export function paintFace(f: StoneField, map: TileMap, marks: Marks, face: Face, out: Uint8Array): void {
  const damp = faceDamp(map, marks, face), l = rockLines(f, map, marks);
  for (let v = 0; v < FACE_H; v++) for (let u = 0; u < FACE_W; u++) {
    const at = (v * FACE_W + u) * 4;
    if (!laidFacePx(f, map, face, damp, u, v, out, at)) rockFacePx(f, map, l, face, damp, u, v, out, at);
  }
}
