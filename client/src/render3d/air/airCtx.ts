// What the parts of the air simulation share (#307): the map, the rng, the wind and the sight, in world tiles. The wind keeps
// px units (game/wind.ts); `airAt` converts to tiles/s.
import type { TileMap } from '../../sim/map';
import type { Wind } from '../../game/wind';
import type { Footprint } from '../lights';
import { hiddenAt, type SightMask } from '../sightmask';

/** One art pixel in tiles; px values (positions, px/s speeds) convert with this. */
export const PX = 1 / 16;
/** Tiles beyond the view in which lava, water and torches still count. */
export const MARGIN = 1;
/** Air faster than this (tiles/s; 8 px/s) stirs a dust cloud apart; the ambient draft (at most DRAFT_MAX) never does. */
export const STIR_SPEED = 8 * PX;
/** Shares of the sampled air that smoke and embers take on. */
export const SMOKE_WIND = 0.6;
export const EMBER_WIND = 0.4;
export const EMBER_COLOURS = [0xffb040, 0xff6a20];

export interface AirOn { dust: boolean; smoke: boolean; embers: boolean; drips: boolean; stir: boolean; draft: boolean }

export interface AirCtx {
  readonly map: TileMap;
  readonly rng: () => number;
  readonly wind: Wind;
  /** Per frame, set by `Air3d.step`. */
  t: number;
  fp: Footprint;
  mask: SightMask | null;
  on: AirOn;
  /** The wind is on this frame (stir or draft). */
  windOn: boolean;
  air: [number, number];
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const rnd = (c: AirCtx, lo: number, hi: number): number => lo + c.rng() * (hi - lo);

/** The air velocity (tiles/s, in x and z) at the world point (x, z) tiles, written into and returned as `c.air`. */
export function airAt(c: AirCtx, x: number, z: number): [number, number] {
  c.wind.sample(x / PX, z / PX, c.air);
  c.air[0] *= PX;
  c.air[1] *= PX;
  return c.air;
}

/** Is the point hidden from the viewer (a point thing's rule); false without a mask. */
export function hidden(c: AirCtx, x: number, z: number): boolean {
  return c.mask !== null && hiddenAt(c.mask, x, z);
}

/** Is (x, z) within the footprint plus `MARGIN` tiles? */
export function inView(c: AirCtx, x: number, z: number): boolean {
  return x >= c.fp.x0 - MARGIN && x <= c.fp.x1 + MARGIN && z >= c.fp.z0 - MARGIN && z <= c.fp.z1 + MARGIN;
}
