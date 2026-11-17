// Cover kinds (#330): what a soft ground-cover layer (grass, moss, later snow) looks like. Pure data: no three.js.
import { P } from '../../game/vegetation/canvas';

type Rgb = [number, number, number];

/** The tall-grass bushels standing on thick cover. */
export interface BushelLook {
  w: [number, number]; h: [number, number];
  fernW: [number, number]; fernH: [number, number];
  perArea: number; cluster: [number, number];
  tones: [Rgb, Rgb, Rgb];
  sway: number;
}

export interface CoverKind {
  /** Index in COVER_KINDS, 0..15. */
  id: number;
  name: string;
  /** Art px, 1..15. */
  maxH: number;
  /** Px over which blades thin out toward the rim. */
  taper: number;
  /** Px of distance per px of height. */
  climb: number;
  /** Px the cover reaches over its rim. */
  creep: number;
  /** Rim noise amplitude factor (the spike: 5 px * rough). */
  rough: number;
  /** Tiles at the top sheet. */
  sway: number;
  /** Colour factor at the blades' foot, rising to 1 at the top. */
  footShade: number;
  /** Ground colour factor under standing cover. */
  darken: number;
  bushels: BushelLook | null;
}

/** The largest `gh` height factor (params allow 0.25 to 3); the chunk bounds assume it. A kind's `maxH` is its maximum height in art px (grass 4, moss 2). */
export const GH_MAX = 3;

const grass: CoverKind = {
  id: 0, name: 'grass', maxH: 4, taper: 5, climb: 3, creep: 3.5, rough: 1, sway: 0.06, footShade: 0.62, darken: 0.4, // rough, footShade, darken: spike values, first guess
  bushels: { // fernW, fernH, perArea, cluster: spike values, first guess
    w: [7, 12], h: [7, 13], fernW: [10, 14], fernH: [5, 8], perArea: 12, cluster: [3, 9], tones: [P['1'], P['2'], P['3']], sway: 0.22 },
};
const moss: CoverKind = {
  id: 1, name: 'moss', maxH: 2, taper: 2, climb: 2, creep: 1.5, rough: 0.6, sway: 0, footShade: 0.75, darken: 0.55, // first guess
  bushels: null,
};

export const COVER: { grass: CoverKind; moss: CoverKind } = { grass, moss };
/** COVER_KINDS[m.id] === m. */
export const COVER_KINDS: readonly CoverKind[] = [grass, moss];

/** One byte per art px: the height in the low 4 bits, the cover kind id above; no height, no cover. */
export const encodeCover = (h: number, id: number): number => (h === 0 ? 0 : h | (id << 4));
export const coverH = (a: number): number => a & 15;
export const coverId = (a: number): number => a >> 4;
