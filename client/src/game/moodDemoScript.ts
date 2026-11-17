// The map and the script of the mood demo (#148, #158), which the 3D stage (?r3d=mood) plays.
// All positions are px on the board (feet), `t` is seconds since the start.
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { TERRAIN } from './terrain-layers';

export const MOOD_W = 15;
export const MOOD_H = 17;
export const MOOD_WARM = 0xffaa5a;

export function moodMap(): TileMap {
  const W = MOOD_W;
  const tiles = new Uint8Array(W * MOOD_H).fill(TILE_ID.Wall);
  for (let y = 3; y <= 15; y++) for (let x = 1; x <= 13; x++) tiles[y * W + x] = TILE_ID.Floor;
  tiles[7 * W + 4] = TILE_ID.Wall; // a pillar, for a shadow
  for (let y = 12; y <= 14; y++) for (let x = 9; x <= 12; x++) tiles[y * W + x] = TERRAIN.Lava;
  for (let y = 12; y <= 15; y++) for (let x = 1; x <= 4; x++) tiles[y * W + x] = TERRAIN.Shallow; // a pool, for the drips
  for (let y = 13; y <= 14; y++) for (let x = 2; x <= 3; x++) tiles[y * W + x] = TERRAIN.Deep;
  return new TileMap(MOOD_W, MOOD_H, tiles);
}

/** The warm wall torches: the light's tile (`tx`, `ty`), the torch's position in px and its wall `side`. All lit. */
export const MOOD_TORCHES: readonly { tx: number; ty: number; x: number; y: number; side: number; lit: boolean }[] = [
  ...[3, 7, 11].map((tx) => ({ tx, ty: 3, x: (tx + 0.5) * TILE, y: 3 * TILE + 0.5, side: 0, lit: true })),
  { tx: 1, ty: 9, x: 1 * TILE + 0.5, y: 9.5 * TILE, side: 1, lit: true },
];

/** The still figures and props, standing on their feet at (x, y) in tiles; `frame` is a pack frame name. */
export const MOOD_FIGURES: readonly { frame: string; x: number; y: number; flip: boolean }[] = [
  { frame: 'elf_f_idle_anim_f0', x: 5.5, y: 11.2, flip: false },
  { frame: 'wizzard_m_idle_anim_f0', x: 9.2, y: 8.6, flip: true },
  { frame: 'skelet_idle_anim_f0', x: 6.6, y: 12.8, flip: false },
  { frame: 'skelet_idle_anim_f0', x: 11.5, y: 6, flip: true },
  { frame: 'chest_full_open_anim_f0', x: 2.5, y: 5, flip: false },
  { frame: 'crate', x: 12.5, y: 4.8, flip: false },
  { frame: 'skull', x: 6.3, y: 14.4, flip: false },
  { frame: 'skull', x: 10.4, y: 5.4, flip: false },
];

/** Where the viewer stands (px). */
export const MOOD_VIEWER = { x: 7.5 * TILE, y: 9.5 * TILE };

export const WALK_SPEED = 60;
export const DASH_SPEED = 300;
export const DASH_EVERY = 6;
export const DASH_TIME = 0.25;
export const ARROW_SPEED = 260;
/** The arrow crosses every ARROW_EVERY s, from ARROW_START s on, at y = ARROW_Y px; it ends at ARROW_END_X px. */
export const ARROW_EVERY = 3;
export const ARROW_START = 1.5;
export const ARROW_X0 = 1.5 * TILE;
export const ARROW_END_X = 13.5 * TILE;
export const ARROW_Y = 8.5 * TILE;
/** The fireball: a period of FIRE_EVERY s, the first FIRE_FLIGHT s of which it flies along y = FIRE_Y; it then blasts at BLAST_X for BLAST_TIME s. */
export const FIRE_EVERY = 4;
export const FIRE_FLIGHT = 2;
export const FIRE_X0 = 2.5 * TILE;
export const FIRE_RANGE = 10 * TILE;
export const FIRE_Y = 5.5 * TILE;
export const BLAST_X = 12.5 * TILE;
export const BLAST_TIME = 0.4;

// The walker's loop: a rounded rectangle round the pillar (feet positions, px).
const LX0 = 3.3 * TILE;
const LX1 = 11.7 * TILE;
const LY0 = 6.3 * TILE;
const LY1 = 10.7 * TILE;
const LR = 1.2 * TILE;
const SEG_X = LX1 - LX0 - 2 * LR;
const SEG_Y = LY1 - LY0 - 2 * LR;
const ARC = (Math.PI / 2) * LR;
const LOOP = 2 * SEG_X + 2 * SEG_Y + 4 * ARC;

/** The point and heading (x direction) at arc length s along the loop, clockwise from the top left. */
export function loopAt(s: number): { x: number; y: number; dx: number } {
  s = ((s % LOOP) + LOOP) % LOOP;
  if (s < SEG_X) return { x: LX0 + LR + s, y: LY0, dx: 1 };
  s -= SEG_X;
  if (s < ARC) {
    const a = s / LR;
    return { x: LX1 - LR + Math.sin(a) * LR, y: LY0 + LR - Math.cos(a) * LR, dx: 1 };
  }
  s -= ARC;
  if (s < SEG_Y) return { x: LX1, y: LY0 + LR + s, dx: 0 };
  s -= SEG_Y;
  if (s < ARC) {
    const a = s / LR;
    return { x: LX1 - LR + Math.cos(a) * LR, y: LY1 - LR + Math.sin(a) * LR, dx: 1 };
  }
  s -= ARC;
  if (s < SEG_X) return { x: LX1 - LR - s, y: LY1, dx: -1 };
  s -= SEG_X;
  if (s < ARC) {
    const a = s / LR;
    return { x: LX0 + LR - Math.sin(a) * LR, y: LY1 - LR + Math.cos(a) * LR, dx: -1 };
  }
  s -= ARC;
  if (s < SEG_Y) return { x: LX0, y: LY1 - LR - s, dx: 0 };
  s -= SEG_Y;
  const a = s / LR;
  return { x: LX0 + LR - Math.cos(a) * LR, y: LY0 + LR - Math.sin(a) * LR, dx: -1 };
}

/** Arc length walked by time t: WALK_SPEED, and DASH_SPEED while a dash (the first DASH_TIME s of every DASH_EVERY s) runs. */
function walked(t: number): number {
  const dashed = Math.floor(t / DASH_EVERY) * DASH_TIME + Math.min(t % DASH_EVERY, DASH_TIME);
  return WALK_SPEED * t + (DASH_SPEED - WALK_SPEED) * dashed;
}

export interface MoodState {
  /** The knight: feet position, heading (x direction, 0 on the straights), and whether it dashes. */
  walker: { x: number; y: number; dx: number; dashing: boolean };
  /** The arrow in flight, or null outside its crossing. */
  arrow: { x: number; y: number } | null;
  /** The fireball in flight, or null. */
  fireball: { x: number; y: number } | null;
  /** The blast at the east wall (the first BLAST_TIME s after the flight), or null. */
  blast: { x: number; y: number } | null;
}

/** The demo at time `t` s, a pure function of the time. */
export function moodScript(t: number): MoodState {
  const w = loopAt(walked(t));
  const ap = (((t - ARROW_START) % ARROW_EVERY) + ARROW_EVERY) % ARROW_EVERY;
  const ax = ARROW_X0 + ap * ARROW_SPEED;
  const p = t % FIRE_EVERY;
  return {
    walker: { x: w.x, y: w.y, dx: w.dx, dashing: t % DASH_EVERY < DASH_TIME },
    arrow: ax < ARROW_END_X ? { x: ax, y: ARROW_Y } : null,
    fireball: p < FIRE_FLIGHT ? { x: FIRE_X0 + FIRE_RANGE * (p / FIRE_FLIGHT), y: FIRE_Y } : null,
    blast: p >= FIRE_FLIGHT && p < FIRE_FLIGHT + BLAST_TIME ? { x: BLAST_X, y: FIRE_Y } : null,
  };
}
