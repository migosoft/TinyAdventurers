// Chooses 0x72 pack tiles for the dungeon grid, following the pack's
// 3/4 top-down style:
// - Walls with floor to the south show their brick face (`wall_mid`); the
//   cell above gets the wall-top rim (`wall_top_mid`).
// - Side walls show a light strip on the side facing the floor
//   (`wall_edge_mid_left/right`), so it meets the end of a brick face as a
//   clean corner. South walls show the rim along their bottom.
// - Corners use the pack's pieces (`wall_edge_bottom_*`, `wall_outer_top_*`).
import { TILE_ID } from '../generated/defs';
import type { TileMap } from '../sim/map';

export interface TileDraw {
  frame: string;
  /** Vertical pixel offset; only ever moves transparent sprite rows out of the cell. */
  dy?: number;
}

/** The boss hall entrance looks like floor even when sealed (a force field is drawn over it). */
function floorLike(t: number): boolean {
  return t === TILE_ID.Floor || t === TILE_ID.DoorOpen || t === TILE_ID.DoorClosed;
}

function hash(x: number, y: number): number {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;
}

const isWall = (m: TileMap, x: number, y: number) => {
  const t = m.get(x, y);
  return t === TILE_ID.Wall;
};
const fl = (m: TileMap, x: number, y: number) => floorLike(m.get(x, y));

/** Wall whose south face is visible (floor directly below). */
function isFace(m: TileMap, x: number, y: number): boolean {
  return isWall(m, x, y) && fl(m, x, y + 1);
}

/** Wall beside the end of a brick face: 'left' = top-left corner of a room, 'right' = top-right. */
function cornerFace(m: TileMap, x: number, y: number): 'left' | 'right' | null {
  if (!isWall(m, x, y) || fl(m, x, y + 1) || fl(m, x - 1, y) || fl(m, x + 1, y)) return null;
  if (fl(m, x + 1, y + 1) && isFace(m, x + 1, y)) return 'left';
  if (fl(m, x - 1, y + 1) && isFace(m, x - 1, y)) return 'right';
  return null;
}

function faceFrame(m: TileMap, x: number, y: number, h: number): string {
  // Occasional decoration on long straight faces.
  if (isFace(m, x - 1, y) && isFace(m, x + 1, y)) {
    if (h < 25) return 'wall_hole_1';
    if (h < 45) return 'wall_hole_2';
    if (h < 60) return ['wall_banner_red', 'wall_banner_blue', 'wall_banner_green', 'wall_banner_yellow'][h % 4];
  }
  return 'wall_mid';
}

/** Rim drawn on the cell directly above a brick face. */
function capFrames(m: TileMap, x: number, y: number): string[] {
  // A side wall going up meets the rim: its strip turns into the rim (a corner at the face's end).
  if (isWall(m, x, y) && (fl(m, x + 1, y) || fl(m, x - 1, y))) {
    const out: string[] = [];
    if (fl(m, x + 1, y)) out.push('wall_edge_bottom_right');
    if (fl(m, x - 1, y)) out.push('wall_edge_bottom_left');
    return out;
  }
  return ['wall_top_mid'];
}

/** The rim and stub sprites keep their art in the bottom 4 rows; this lifts it to the top of the cell. */
const TOP = -12;

/** Top view of a wall that shows no bricks. */
function topDraws(m: TileMap, x: number, y: number): TileDraw[] {
  // Room's top corners: the side strip runs up beside the face and a stub meets the rim.
  const corner = cornerFace(m, x, y);
  if (corner === 'left') return [{ frame: 'wall_edge_mid_right' }];
  if (corner === 'right') return [{ frame: 'wall_edge_mid_left' }];
  const cornerBelow = cornerFace(m, x, y + 1);
  if (cornerBelow === 'left') return [{ frame: 'wall_outer_top_left' }];
  if (cornerBelow === 'right') return [{ frame: 'wall_outer_top_right' }];

  const n = fl(m, x, y - 1);
  const e = fl(m, x + 1, y);
  const w = fl(m, x - 1, y);
  const out: TileDraw[] = [];
  if (n) out.push({ frame: 'wall_top_mid', dy: TOP }); // south wall: rim along the floor's edge
  if (e) out.push({ frame: 'wall_edge_mid_right' });
  if (w) out.push({ frame: 'wall_edge_mid_left' });
  if (out.length) return out;
  // Only diagonal floor: bottom corners of rooms, where the strip ends in the rim.
  if (fl(m, x + 1, y - 1)) return [{ frame: 'wall_outer_top_left', dy: TOP }];
  if (fl(m, x - 1, y - 1)) return [{ frame: 'wall_outer_top_right', dy: TOP }];
  return [];
}

export function tileDraws(m: TileMap, x: number, y: number): TileDraw[] {
  const t = m.get(x, y);
  const out: TileDraw[] = [];
  const h = hash(x, y);
  if (floorLike(t)) {
    // Mostly plain flagstones with occasional cracked variants.
    out.push({ frame: h < 930 ? 'floor_1' : `floor_${2 + (h % 7)}` });
  } else if (isFace(m, x, y)) {
    out.push({ frame: faceFrame(m, x, y, h) });
  } else if (isFace(m, x, y + 1)) {
    for (const f of capFrames(m, x, y)) out.push({ frame: f });
  } else if (isWall(m, x, y) || cornerFace(m, x, y + 1)) {
    out.push(...topDraws(m, x, y));
  }
  return out;
}
