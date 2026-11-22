// The ornaments' own shapes (#380 part 5). The drain grate: its shaft is the floor mesh's (a hole block, `blocks.ts`, sunk by
// `GRATE_DEPTH`, with the floor's skirts as its sides); here is the iron over it: a frame, bars and a cross bar. Pure: no three.
import type { TileMap } from '../../sim/map';
import { LEVEL_STEP, floorBlockAt, ironPx } from './blocks';
import { STONE_PX, type StoneField } from './field';
import { KIND } from './grid';
import { NONE, type Corner, type Vec3 } from './laidMesh';
import type { Grate, Marks } from './place';

// First guesses, all of them.
/** The frame's width (px), the bars across the shaft from north to south and their width (px). */
const FRAME_W = 2, BARS = 4, BAR_W = 1.5;
/** How far the iron's top lies below 0 (just under the flush floor round the shaft), and its height (tiles). */
const BAR_TOP = -LEVEL_STEP - 0.015, BAR_TALL = 0.05;
/** The cross bar under the bars' middle: its width (px) and how far its top lies below theirs (tiles). */
const CROSS_W = 2, CROSS_DROP = 0.02;

/**
 * The iron of a grate: a frame along the shaft's sides, bars from north to south inside it and a cross bar under their middle. Each is
 * a top and the sides named (`w`, `e`, `n`, `s`): a side that lies in the shaft's own side, or in another piece of iron, is left out.
 * All of it reads the shaft's iron px.
 */
export function grateBars(f: StoneField, map: TileMap, marks: Marks, g: Grate, ground: (x: number, z: number) => Vec3, quad: (c: [Corner, Corner, Corner, Corner], n: Vec3, kind: number) => void): void {
  const hole = floorBlockAt(f, map, marks, g.x * STONE_PX, g.z * STONE_PX);
  if (!hole?.hole) return;
  const px = ironPx(hole), iron = ground((px[0] + 0.5) / STONE_PX, (px[1] + 0.5) / STONE_PX);
  const at = (x: number, y: number, z: number): Corner => ({ p: [x, y, z], sheet: iron, a: NONE, b: NONE });
  /** A piece of iron over the px (u0, v0) to (u1, v1) of the shaft. */
  const box = (u0: number, v0: number, u1: number, v1: number, top: number, sides: string): void => {
    const xa = (hole.u0 + u0) / STONE_PX, xb = (hole.u0 + u1) / STONE_PX, za = (hole.v0 + v0) / STONE_PX, zb = (hole.v0 + v1) / STONE_PX, lo = top - BAR_TALL;
    quad([at(xa, top, za), at(xb, top, za), at(xb, top, zb), at(xa, top, zb)], [0, 1, 0], KIND.floor);
    if (sides.includes('w')) quad([at(xa, top, za), at(xa, top, zb), at(xa, lo, zb), at(xa, lo, za)], [-1, 0, 0], KIND.floor);
    if (sides.includes('e')) quad([at(xb, top, za), at(xb, top, zb), at(xb, lo, zb), at(xb, lo, za)], [1, 0, 0], KIND.floor);
    if (sides.includes('n')) quad([at(xa, top, za), at(xb, top, za), at(xb, lo, za), at(xa, lo, za)], [0, 0, -1], KIND.floor);
    if (sides.includes('s')) quad([at(xa, top, zb), at(xb, top, zb), at(xb, lo, zb), at(xa, lo, zb)], [0, 0, 1], KIND.floor);
  };
  const N = hole.u1 - hole.u0, F = FRAME_W, gap = (N - 2 * F - BARS * BAR_W) / (BARS + 1);
  box(0, 0, F, N, BAR_TOP, 'e'); box(N - F, 0, N, N, BAR_TOP, 'w'); box(F, 0, N - F, F, BAR_TOP, 's'); box(F, N - F, N - F, N, BAR_TOP, 'n');
  for (let i = 0; i < BARS; i++) { const u = F + gap + i * (BAR_W + gap); box(u, F, u + BAR_W, N - F, BAR_TOP, 'we'); }
  box(F, (N - CROSS_W) / 2, N - F, (N + CROSS_W) / 2, BAR_TOP - CROSS_DROP, 'ns');
}
