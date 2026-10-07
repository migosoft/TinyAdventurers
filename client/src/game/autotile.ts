// Chooses 0x72 pack tiles for the dungeon grid, following the pack's
// 3/4 top-down style:
// - Walls with floor to the south show their brick face (`wall_mid`); the
//   cell above gets the wall-top rim (`wall_top_mid`).
// - Every other wall shows only its top: a light rim on its OUTER side
//   (away from the floor), so walls read as thick blocks.
// - Corners and junctions use the pack's dedicated pieces
//   (`wall_edge_left/right`, `wall_edge_top_*`, `wall_edge_bottom_*`, `wall_outer_top_*`).
import { TILE_ID } from '../generated/defs';
import type { TileMap } from '../sim/map';

export interface TileDraw {
  frame: string;
}

function floorLike(t: number): boolean {
  return t === TILE_ID.Floor || t === TILE_ID.DoorOpen;
}

function hash(x: number, y: number): number {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;
}

const isWall = (m: TileMap, x: number, y: number) => {
  const t = m.get(x, y);
  return t === TILE_ID.Wall || t === TILE_ID.DoorClosed;
};
const fl = (m: TileMap, x: number, y: number) => floorLike(m.get(x, y));

/** Wall whose south face is visible (floor directly below). */
function isFace(m: TileMap, x: number, y: number): boolean {
  return isWall(m, x, y) && fl(m, x, y + 1);
}

/** Room corner continuing a brick face: 'left' = top-left corner of a room, 'right' = top-right. */
function cornerFace(m: TileMap, x: number, y: number): 'left' | 'right' | null {
  if (!isWall(m, x, y) || fl(m, x, y + 1) || fl(m, x - 1, y) || fl(m, x + 1, y)) return null;
  if (fl(m, x + 1, y + 1) && isFace(m, x + 1, y)) return 'left';
  if (fl(m, x - 1, y + 1) && isFace(m, x - 1, y)) return 'right';
  return null;
}

/** Any wall that shows bricks (straight face or room corner). */
export function isFrontWall(m: TileMap, x: number, y: number): boolean {
  return isFace(m, x, y) || cornerFace(m, x, y) !== null;
}

function faceFrame(m: TileMap, x: number, y: number, h: number): string {
  if (m.get(x, y) === TILE_ID.DoorClosed) return 'wall_mid';
  // Occasional decoration on long straight faces.
  if (isFace(m, x - 1, y) && isFace(m, x + 1, y)) {
    if (h < 25) return 'wall_hole_1';
    if (h < 45) return 'wall_hole_2';
    if (h < 60) return ['wall_banner_red', 'wall_banner_blue', 'wall_banner_green', 'wall_banner_yellow'][h % 4];
  }
  return 'wall_mid';
}

/** Rim drawn on the cell directly above a brick face. */
function capFrame(m: TileMap, x: number, y: number): string {
  const below = cornerFace(m, x, y + 1);
  if (isWall(m, x, y) && fl(m, x + 1, y)) return 'wall_edge_bottom_left'; // corridor wall going up meets the rim
  if (isWall(m, x, y) && fl(m, x - 1, y)) return 'wall_edge_bottom_right';
  if (below === 'left') return 'wall_edge_top_left';
  if (below === 'right') return 'wall_edge_top_right';
  return 'wall_top_mid';
}

/** Top view of a wall that shows no bricks. */
function topFrames(m: TileMap, x: number, y: number): string[] {
  const n = fl(m, x, y - 1);
  const e = fl(m, x + 1, y);
  const w = fl(m, x - 1, y);
  if (n) {
    // South wall of an area: rim along the bottom; stubs where a corridor leaves sideways.
    if (w && !e) return ['wall_outer_top_left'];
    if (e && !w) return ['wall_outer_top_right'];
    if (e && w) return [];
    return ['wall_top_mid'];
  }
  if (e || w) {
    const out: string[] = [];
    if (e) out.push('wall_edge_mid_left');
    if (w) out.push('wall_edge_mid_right');
    return out;
  }
  // Only diagonal floor: bottom corners of rooms.
  if (fl(m, x + 1, y - 1)) return ['wall_edge_bottom_left'];
  if (fl(m, x - 1, y - 1)) return ['wall_edge_bottom_right'];
  return [];
}

export function tileDraws(m: TileMap, x: number, y: number): TileDraw[] {
  const t = m.get(x, y);
  const out: TileDraw[] = [];
  const h = hash(x, y);
  if (t === TILE_ID.Floor || t === TILE_ID.DoorOpen) {
    // Mostly plain flagstones with occasional cracked variants.
    out.push({ frame: h < 930 ? 'floor_1' : `floor_${2 + (h % 7)}` });
  } else if (isFace(m, x, y)) {
    out.push({ frame: faceFrame(m, x, y, h) });
  } else if (cornerFace(m, x, y) === 'left') {
    out.push({ frame: 'wall_edge_left' });
  } else if (cornerFace(m, x, y) === 'right') {
    out.push({ frame: 'wall_edge_right' });
  } else if (isFrontWall(m, x, y + 1)) {
    out.push({ frame: capFrame(m, x, y) });
  } else if (isWall(m, x, y)) {
    for (const f of topFrames(m, x, y)) out.push({ frame: f });
  }
  return out;
}
