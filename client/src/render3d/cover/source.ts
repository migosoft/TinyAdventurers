// What fills a cover layer (#330): per map px the cover kind's masks and colours, produced by `prep` units that a
// time-sliced job runs before any height unit. Pure data: no three.js, no Phaser.
import type { GroundImage } from '../view';
import type { CoverKind } from './kinds';

/** A tall-grass bushel: the foot in tiles on the 1/16 grid, w/h in art px. */
export interface Bushel { x: number; z: number; w: number; h: number; seed: number; fern: boolean }
/** An extra cluster of bushels (a spot the source asks for). */
export interface BushelSpot { x: number; z: number; fern: boolean; count: number }

export interface CoverSource {
  kind: CoverKind;
  /** Map px. */
  w: number; h: number;
  /** Per map px: 1 where cover grows, 1 where it may reach over a rim; colour RGBA. */
  grow: Uint8Array; allow: Uint8Array; colour: Uint8ClampedArray;
  /** Fill grow/allow/colour; all run before any height unit. */
  prep: (() => void)[];
  /** Bushel clusters per area factor at a tile (default 1). */
  density?(tx: number, tz: number): number;
  spots?: BushelSpot[];
  /** The bare ground picture (woodland only), complete after prep. */
  bare?: { image: GroundImage };
}
