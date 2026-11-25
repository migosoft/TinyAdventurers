import type { BridgeInfo } from '../../generated/BridgeInfo';
import type { PondInfo } from '../../generated/PondInfo';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { BED_RES, DEEP_BED, SHALLOW_BED, isWater, pondFieldOf, setPondField } from '../dips/shape';

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
const BODY_SHORE = 1.0; // a stream point this far from the shore is inside the pond body, not its own channel // balancing
const CORE = 0.5, REACH = 1.5; // stream: full current within CORE of the line, none REACH away // balancing
const FADE = 3; // tiles along the line past the mouth over which the current dies // balancing
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

export function pondField(rules: TileMap, pond: PondInfo): PondField {
  const view = pondViewMap(rules, pond);
  const W = view.w * BED_RES + 2, H = view.h * BED_RES + 2; // one sample of land all round
  const water = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    if (isWater(view.get(Math.floor((i - 1) / BED_RES), Math.floor((j - 1) / BED_RES)))) water[j * W + i] = 1;
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
  for (let k = 0; k < W * H; k++) shore[k] = water[k] ? Math.max(0, (Math.sqrt(d2[k]) - 0.5) / BED_RES) : 0;

  const shoreAt = (x: number, z: number): number => {
    const u = Math.min(W - 1, Math.max(0, x * BED_RES + 0.5)), w = Math.min(H - 1, Math.max(0, z * BED_RES + 0.5));
    const i = Math.min(W - 2, Math.floor(u)), j = Math.min(H - 2, Math.floor(w)), fx = u - i, fz = w - j;
    const a = shore[j * W + i] * (1 - fx) + shore[j * W + i + 1] * fx;
    const b = shore[(j + 1) * W + i] * (1 - fx) + shore[(j + 1) * W + i + 1] * fx;
    return a * (1 - fz) + b * fz;
  };

  // Streams: tile-space polylines with their arc length, and where the pond body starts (inflow) or ends (outflow).
  interface Line { pts: [number, number][]; arc: number[]; inflow: boolean; edge: number }
  const lines: Line[] = [];
  const mouths: Mouth[] = [];
  for (const s of pond.streams) {
    const pts = s.points.map(([px, pz]) => [px / 16, pz / 16] as [number, number]);
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const at = (a: number): { x: number; z: number; dx: number; dz: number } => {
      let i = 1;
      while (i < pts.length - 1 && arc[i] < a) i++;
      const len = arc[i] - arc[i - 1] || 1, t = Math.min(1, Math.max(0, (a - arc[i - 1]) / len));
      return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, z: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
        dx: (pts[i][0] - pts[i - 1][0]) / len, dz: (pts[i][1] - pts[i - 1][1]) / len };
    };
    const total = arc[arc.length - 1];
    let edge = s.inflow ? total : 0; // no body point found: an inflow ends at its last point, an outflow has no body
    if (s.inflow) {
      for (let a = 0; a <= total; a += 0.25) { const p = at(a); if (shoreAt(p.x, p.z) > BODY_SHORE) { edge = a; break; } }
      const m = at(edge);
      mouths.push({ x: m.x, z: m.z, dx: m.dx, dz: m.dz });
    } else {
      for (let a = total; a >= 0; a -= 0.25) { const p = at(a); if (shoreAt(p.x, p.z) > BODY_SHORE) { edge = a; break; } }
    }
    lines.push({ pts, arc, inflow: s.inflow, edge });
  }

  const flowAt = (x: number, z: number): { x: number; z: number; s: number } => {
    let best = { x: 0, z: 0, s: 0 }, bestD = REACH;
    for (const l of lines) for (let i = 1; i < l.pts.length; i++) {
      const [ax, az] = l.pts[i - 1], [bx, bz] = l.pts[i];
      const ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2));
      const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      if (d >= bestD) continue;
      bestD = d;
      const a = l.arc[i - 1] + Math.sqrt(len2) * t;
      const past = l.inflow ? a - l.edge : l.edge - a; // tiles into the pond body along the line
      const fade = past > 0 ? 1 - Math.min(1, past / FADE) : 1;
      const len = Math.sqrt(len2);
      best = { x: ex / len, z: ez / len, s: (1 - Math.min(1, Math.max(0, (d - CORE) / (REACH - CORE)))) * fade };
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
