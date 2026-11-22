// The ornaments' own shapes (#380 part 5). The drain grate: its shaft is the floor mesh's (a hole block, `blocks.ts`, sunk by
// `GRATE_DEPTH`, with the floor's skirts as its sides); here are the iron bars across it. Pure: no three.
import type { TileMap } from '../../sim/map';
import { LEVEL_STEP, floorBlockAt, ironPx } from './blocks';
import { STONE_PX, type StoneField } from './field';
import { KIND } from './grid';
import { NONE, type Corner, type Vec3 } from './laidMesh';
import type { Grate, Marks } from './place';

// First guesses, all of them.
/** The bars: where each begins across the shaft (px from its west side), their width (px), how far their tops lie below 0 (just under the flush floor round the shaft) and their height (tiles). */
const BAR_AT = [2, 7, 12], BAR_W = 2, BAR_TOP = -LEVEL_STEP - 0.015, BAR_TALL = 0.06;

/** The bars of a grate, north to south across its shaft: a top and two sides each (the ends lie in the shaft's sides). They read the shaft's iron px. */
export function grateBars(f: StoneField, map: TileMap, marks: Marks, g: Grate, ground: (x: number, z: number) => Vec3, quad: (c: [Corner, Corner, Corner, Corner], n: Vec3, kind: number) => void): void {
  const hole = floorBlockAt(f, map, marks, g.x * STONE_PX, g.z * STONE_PX);
  if (!hole?.hole) return;
  const px = ironPx(hole), iron = ground((px[0] + 0.5) / STONE_PX, (px[1] + 0.5) / STONE_PX);
  const at = (x: number, y: number, z: number): Corner => ({ p: [x, y, z], sheet: iron, a: NONE, b: NONE });
  const za = hole.v0 / STONE_PX, zb = hole.v1 / STONE_PX, lo = BAR_TOP - BAR_TALL;
  for (const o of BAR_AT) {
    const xa = (hole.u0 + o) / STONE_PX, xb = xa + BAR_W / STONE_PX;
    quad([at(xa, BAR_TOP, za), at(xb, BAR_TOP, za), at(xb, BAR_TOP, zb), at(xa, BAR_TOP, zb)], [0, 1, 0], KIND.floor);
    quad([at(xa, BAR_TOP, za), at(xa, BAR_TOP, zb), at(xa, lo, zb), at(xa, lo, za)], [-1, 0, 0], KIND.floor);
    quad([at(xb, BAR_TOP, za), at(xb, BAR_TOP, zb), at(xb, lo, zb), at(xb, lo, za)], [1, 0, 0], KIND.floor);
  }
}
