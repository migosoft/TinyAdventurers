import type { BridgeInfo } from '../../generated/BridgeInfo';
import type { PondInfo } from '../../generated/PondInfo';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { DEEP_BED, SHALLOW_BED, isWater, pondFieldOf, setPondField } from '../dips/shape';

export { pondFieldOf, setPondField };

/** Where an inflow meets the pond, and the flow direction there (tiles; the direction is a unit vector). */
export interface Mouth { x: number; z: number; dx: number; dz: number }
/** A bridge deck: its tile rect, the travel axis, whether it carries the road, and the top height above the ground. */
export interface Deck { x0: number; z0: number; x1: number; z1: number; alongX: boolean; road: boolean; y: number }
export interface PondField {
  /** Tiles to the nearest shore, > 0 in water, 0 on land. Bilinear over a grid of 4 per tile. */
  shoreAt(x: number, z: number): number;
  /** Bed depth below the ground, >= 0: SHALLOW_BED at 0.5 tiles from the shore, falling evenly to DEEP_BED at 2.5 tiles. */
  depthAt(x: number, z: number): number;
  /** The current: direction and strength 0..1. 1 on a stream, fading to 0 over 3 tiles inside the pond. */
  flowAt(x: number, z: number): { x: number; z: number; s: number };
  /** A deck's top height at this point, or null. */
  deckAt(x: number, z: number): number | null;
  mouths: Mouth[];
  decks: Deck[];
  seed: number;
}

export const DECK_Y = 0.14; // tiles above the ground // balancing
const SHORE_SHALLOW = 0.5, SHORE_DEEP = 2.5; // tiles from the shore where the bed is SHALLOW_BED / DEEP_BED // balancing
const FIELD_RES = 4; // samples per tile of the shore grid
const CORE = 0.5, REACH = 1.5; // stream: full current within CORE of the line, none REACH away // balancing
const FADE = 3; // tiles into the pond, straight on from the end segment, over which the current dies // balancing
const DECK_GROW = 0.5; // a deck reaches this far past its rect at both ends of its travel axis // balancing

const FAR = 1e12; // stands for infinity in the distance transform
const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };

/** The bed depth of a point `shore` tiles from the shore. */
function depthOf(shore: number): number {
  if (shore <= 0) return 0;
  if (shore <= SHORE_SHALLOW) return SHALLOW_BED * smooth(shore / SHORE_SHALLOW);
  return SHALLOW_BED + (DEEP_BED - SHALLOW_BED) * Math.min(1, (shore - SHORE_SHALLOW) / (SHORE_DEEP - SHORE_SHALLOW));
}

/** Squared distance transform of a 1D row (Felzenszwalb): `f` in, result in `out`. */
function edt1(f: Float64Array, out: Float64Array, n: number, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--; else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    out[q] = (q - p) * (q - p) + f[p];
  }
}

/** `viewMap` is the view copy (`pondViewMap`) when the caller has one already; else it is made here. */
export function pondField(rules: TileMap, pond: PondInfo, viewMap?: TileMap): PondField {
  const view = viewMap ?? pondViewMap(rules, pond);
  const W = view.w * FIELD_RES + 2, H = view.h * FIELD_RES + 2; // one sample of land all round
  const water = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    if (isWater(view.get(Math.floor((i - 1) / FIELD_RES), Math.floor((j - 1) / FIELD_RES)))) water[j * W + i] = 1;
  }
  // Distance in samples to the nearest land sample, two passes of the 1D transform.
  const d2 = new Float64Array(W * H), n = Math.max(W, H);
  const f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), zz = new Float64Array(n + 1);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = water[j * W + i] ? FAR : 0;
    edt1(f, o, H, v, zz);
    for (let j = 0; j < H; j++) d2[j * W + i] = o[j];
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) f[i] = d2[j * W + i];
    edt1(f, o, W, v, zz);
    for (let i = 0; i < W; i++) d2[j * W + i] = o[i];
  }
  // A water sample centre lies half a sample inside the edge of its land neighbour's sample: the shore is that much nearer.
  const shore = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) shore[k] = water[k] ? Math.max(0, (Math.sqrt(d2[k]) - 0.5) / FIELD_RES) : 0;

  const shoreAt = (x: number, z: number): number => {
    const u = Math.min(W - 1, Math.max(0, x * FIELD_RES + 0.5)), w = Math.min(H - 1, Math.max(0, z * FIELD_RES + 0.5));
    const i = Math.min(W - 2, Math.floor(u)), j = Math.min(H - 2, Math.floor(w)), fx = u - i, fz = w - j;
    const a = shore[j * W + i] * (1 - fx) + shore[j * W + i + 1] * fx;
    const b = shore[(j + 1) * W + i] * (1 - fx) + shore[(j + 1) * W + i + 1] * fx;
    return a * (1 - fz) + b * fz;
  };

  // Streams as segments of the current: the stream's own (full strength) and, past an inflow's mouth or before an outflow's first
  // point, an extension of the end segment into the pond that fades over FADE tiles. `fadeFrom` is the extension's end that keeps
  // full strength (0 = a, 1 = b); none for a stream's own segments.
  interface Seg { ax: number; az: number; bx: number; bz: number; fadeFrom: 0 | 1 | null }
  const segs: Seg[] = [];
  const mouths: Mouth[] = [];
  for (const s of pond.streams) {
    const pts = s.points.map(([px, pz]) => [px / 16, pz / 16] as [number, number]);
    for (let i = 1; i < pts.length; i++) segs.push({ ax: pts[i - 1][0], az: pts[i - 1][1], bx: pts[i][0], bz: pts[i][1], fadeFrom: null });
    if (pts.length < 2) continue;
    const dirOf = (p: [number, number], q: [number, number]) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      return { dx: (q[0] - p[0]) / len, dz: (q[1] - p[1]) / len };
    };
    if (s.inflow) {
      const p = pts[pts.length - 1], { dx, dz } = dirOf(pts[pts.length - 2], p);
      mouths.push({ x: p[0], z: p[1], dx, dz });
      segs.push({ ax: p[0], az: p[1], bx: p[0] + dx * FADE, bz: p[1] + dz * FADE, fadeFrom: 0 });
    } else {
      const p = pts[0], { dx, dz } = dirOf(p, pts[1]);
      segs.push({ ax: p[0] - dx * FADE, az: p[1] - dz * FADE, bx: p[0], bz: p[1], fadeFrom: 1 });
    }
  }

  const flowAt = (x: number, z: number): { x: number; z: number; s: number } => {
    let best = { x: 0, z: 0, s: 0 };
    for (const g of segs) {
      const ex = g.bx - g.ax, ez = g.bz - g.az, len2 = ex * ex + ez * ez || 1;
      const t = Math.min(1, Math.max(0, ((x - g.ax) * ex + (z - g.az) * ez) / len2));
      const d = Math.hypot(x - (g.ax + ex * t), z - (g.az + ez * t));
      let s = 1 - Math.min(1, Math.max(0, (d - CORE) / (REACH - CORE)));
      if (g.fadeFrom !== null) s *= g.fadeFrom === 0 ? 1 - t : t;
      if (s <= best.s) continue;
      const len = Math.sqrt(len2);
      best = { x: ex / len, z: ez / len, s };
    }
    return best;
  };

  const decks: Deck[] = pond.bridges.map(deckOf);
  const deckAt = (x: number, z: number): number | null => {
    for (const d of decks) {
      const gx = d.alongX ? DECK_GROW : 0, gz = d.alongX ? 0 : DECK_GROW;
      if (x >= d.x0 - gx && x <= d.x1 + gx && z >= d.z0 - gz && z <= d.z1 + gz) return d.y;
    }
    return null;
  };

  return { shoreAt, depthAt: (x, z) => depthOf(shoreAt(x, z)), flowAt, deckAt, mouths, decks, seed: pond.seed };
}

function deckOf(b: BridgeInfo): Deck {
  const [x, z, w, h] = b.rect;
  return { x0: x, z0: z, x1: x + w, z1: z + h, alongX: b.along_x, road: b.road, y: DECK_Y };
}

/** A copy of the map for drawing: a bridge's tiles are ShallowWater, so the bed and the water run on under the deck. */
export function pondViewMap(rules: TileMap, pond: PondInfo): TileMap {
  const view = new TileMap(rules.w, rules.h, rules.tiles.slice());
  for (const b of pond.bridges) {
    const [x, z, w, h] = b.rect;
    for (let j = z; j < z + h; j++) for (let i = x; i < x + w; i++) view.set(i, j, TILE_ID.ShallowWater);
  }
  return view;
}
