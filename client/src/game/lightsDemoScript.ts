// What the lights demo shows, apart from how it is drawn: the board, the torches, the fireball, the frost bolt and the explosion
// flash. The 2D page ?lights (LightsDemoScene) and the 3D page ?r3d=lights (render3d/lightsStage.ts) both play this script.
import { LIGHT_KIND, TILE_ID } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { TILE, TileMap } from '../sim/map';
import { TERRAIN } from './terrain-layers';

export const W = 30;
export const H = 20;
export const LOOP = 4;
export const SWITCH = 3;
/** How long the explosion at the fireball's turnaround flashes (the server's `BLAST_FLASH`). */
export const FLASH = 0.4;
/** The viewer stands in the middle of room 1 (tile). */
export const VIEWER: [number, number] = [7, 9];
export const CORRIDOR_Y = 9;
export const BLUE = 0x3060ff;
export const FIRE_COLOUR = 0xff7020;
export const FROST_COLOUR = 0x78c8ff;
/** The explosion's x: the dark room's doorway. */
export const BOOM_X = 15.5 * TILE;

export function buildMap(): TileMap {
  const tiles = new Uint8Array(W * H).fill(TILE_ID.Wall);
  const floor = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * W + x] = TILE_ID.Floor;
  };
  floor(2, 3, 11, 15); // room 1
  floor(12, CORRIDOR_Y, 14, CORRIDOR_Y); // corridor
  floor(15, 5, 28, 13); // room 2: the dark pocket
  tiles[6 * W + 5] = TILE_ID.Wall; // two pillars in room 1, for the shadow edges
  tiles[13 * W + 9] = TILE_ID.Wall;
  for (let y = 11; y <= 13; y++) for (let x = 3; x <= 6; x++) tiles[y * W + x] = TERRAIN.Lava;
  return new TileMap(W, H, tiles);
}

/**
 * The torches in the order their lights are added (ids from 1). `x`, `y` are the spot (px) a torch entity would have: the light
 * sits on the tile that spot lies in. `sprite`: whether a torch figure hangs there (the one beside the lava pool has only its light).
 */
export interface DemoTorch { x: number; y: number; side: 0 | 1 | 2; colour: number; blue: boolean; sprite: boolean }
export const TORCHES: DemoTorch[] = [
  // Torches hang on the first floor row, under the north wall.
  { x: 3.5 * TILE, y: 3 * TILE + 0.5, side: 0, colour: 0xffaa5a, blue: false, sprite: true },
  { x: 5.5 * TILE, y: 3 * TILE + 0.5, side: 0, colour: BLUE, blue: true, sprite: true },
  { x: 8.5 * TILE, y: 3 * TILE + 0.5, side: 0, colour: 0x50ff70, blue: false, sprite: true },
  { x: 10.5 * TILE, y: 3 * TILE + 0.5, side: 0, colour: 0xc040ff, blue: false, sprite: true },
  { x: 7.5 * TILE, y: 12 * TILE + 0.5, side: 0, colour: 0xffaa5a, blue: false, sprite: false }, // beside the lava pool
  // One on each side wall of room 1, each with its own light.
  { x: 2 * TILE + 0.5, y: 6.5 * TILE, side: 1, colour: 0xffaa5a, blue: false, sprite: true },
  { x: 12 * TILE - 0.5, y: 6.5 * TILE, side: 2, colour: 0xffaa5a, blue: false, sprite: true },
];

/** Whether the blue torch is on at time `t` (s): on at the start, switching every `SWITCH` s. */
export function blueOn(t: number): boolean {
  return Math.floor(t / SWITCH) % 2 === 0;
}

/** The fireball (out along the corridor to the far end of room 2 and back), the frost bolt (a circle in room 1) and the explosion's clock, at `t`. */
export function boltsAt(t: number): { fx: number; fy: number; cx: number; cy: number; sinceBoom: number } {
  const p = (t % LOOP) / LOOP;
  const tri = p < 0.5 ? p * 2 : 2 - p * 2;
  const a = p * Math.PI * 2;
  return {
    fx: (VIEWER[0] + 1 + tri * 13 + 0.5) * TILE,
    fy: (CORRIDOR_Y + 0.5) * TILE,
    cx: (6.5 + 2.5 * Math.cos(a)) * TILE,
    cy: (6.5 + 2.5 * Math.sin(a)) * TILE,
    sinceBoom: (t % LOOP) - LOOP / 2,
  };
}

/** The moving lights at `t`: the fireball, the frost bolt and, for `FLASH` s at the fireball's turnaround, the explosion. */
export function movingAt(t: number): MovingLight[] {
  const b = boltsAt(t);
  const out: MovingLight[] = [
    [b.fx, b.fy, LIGHT_KIND.Fire, FIRE_COLOUR],
    [b.cx, b.cy, LIGHT_KIND.Magic, FROST_COLOUR],
  ];
  if (b.sinceBoom >= 0 && b.sinceBoom < FLASH) out.push([BOOM_X, b.fy, LIGHT_KIND.Blast, null]);
  return out;
}

/** The lava tiles, in scan order (each carries a Lava light). */
export function lavaLights(map: TileMap): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.get(x, y) === TERRAIN.Lava) out.push({ x, y });
  return out;
}
