// The painter of the stone sheets (#380). STAND-IN bodies in this task: a flat colour per kind with a one-pixel line at every tile edge, so
// page and slot addressing can be seen. Tasks 9 and 10 fill in the real painting (masonry, rock, relief). Pure: no three.
import type { TileMap } from '../../sim/map';
import { FACE_H, FACE_W, FLAT_A, PAGE } from './format';
import { CHUNK } from './grid';
import { STONE_PX, kindAt, type StoneField } from './field';
import type { Face } from './plan';
import type { Marks } from './place';

/** The stand-in colours (0..255): laid stone brown-grey, rock a little cooler; the grid line is this share of the colour. */
export const STAND_IN = { laid: [112, 100, 88], rock: [92, 90, 86] } as const;
export const GRID_SHARE = 0.65;

function put(out: Uint8Array, at: number, rgb: readonly number[], line: boolean): void {
  const k = line ? GRID_SHARE : 1;
  out[at] = rgb[0] * k;
  out[at + 1] = rgb[1] * k;
  out[at + 2] = rgb[2] * k;
  out[at + 3] = FLAT_A;
}

/**
 * Paints rows [row0, row1) of the ground page of chunk (cx, cz) into `out` (a whole page, PAGE by PAGE RGBA). The texel of world point
 * (x, z) is ((x - 16cx) * 32, (z - 16cz) * 32). The painter works in world stone px, so a pattern runs on across pages.
 */
export function paintGroundRows(f: StoneField, _map: TileMap, _marks: Marks, cx: number, cz: number, row0: number, row1: number, out: Uint8Array): void {
  for (let py = row0; py < row1; py++) {
    const wz = cz * CHUNK + py / STONE_PX;
    for (let px = 0; px < PAGE; px++) {
      const wx = cx * CHUNK + px / STONE_PX;
      const rgb = kindAt(f, wx, wz) === 1 ? STAND_IN.rock : STAND_IN.laid;
      put(out, (py * PAGE + px) * 4, rgb, px % STONE_PX === 0 || py % STONE_PX === 0);
    }
  }
}

/**
 * Paints one wall face into `out` (FACE_W by FACE_H RGBA). u grows with world +x (sides 0, 1) or +z (sides 2, 3), v grows downward from the
 * wall's top.
 */
export function paintFace(f: StoneField, _map: TileMap, _marks: Marks, face: Face, out: Uint8Array): void {
  const rgb = kindAt(f, face.x + 0.5, face.z + 0.5) === 1 ? STAND_IN.rock : STAND_IN.laid;
  for (let v = 0; v < FACE_H; v++) for (let u = 0; u < FACE_W; u++) put(out, (v * FACE_W + u) * 4, rgb, u === 0 || v % STONE_PX === 0);
}
