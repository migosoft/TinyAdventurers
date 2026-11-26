// The woodland road's drawn edge (#430): a smooth band along the generator's centre line instead of the Road tiles' steps. The
// server sends the line as one sample per column (`WoodlandInfo.road`); the road is a function of x that bends gently, so no
// distance field is needed: everything is a few arrays along x. Each side's width swells and narrows on its own, less than the
// brook's (carts keep a road even). At a road bridge the line squares up to the deck's middle and the width settles to the deck's
// three tiles. Pure and seeded; the rules (which tiles are Road) are not touched.
import type { BridgeInfo } from '../../generated/BridgeInfo';
import { lattice } from '../../render3d/pond/pondShape';
import type { TileMap } from '../../sim/map';

/** Half the road's width, tiles: the three Road tiles of a column. */
export const ROAD_HALF = 1.5;
export const SWELL = 0.2, SWELL_LEN = 7; // tiles: how far each side swells and narrows, and over what length // balancing
export const BUMP = 0.08, BUMP_LEN = 0.9; // tiles: the small bumps on top, as the brook's EDGE_ROUGH / EDGE_WAVE // balancing
// Tiles: beside a road deck, the line bends to the deck's middle over this length. Shorter makes the S steeper where the road
// crosses on a slant (3: up to 1.34; 4: 1.22), longer takes the dirt further off its tiles (6 breaks the 1.5-tile bound).
export const DECK_FADE = 4; // balancing
export const DECK_GROW = 0.5; // as pondField.ts: a deck reaches this far past its rect at both ends of its travel axis // balancing
/** Array entries per tile along x: the ground's pixels. */
const SUB = 16;

/** The road's drawn edge of one woodland map, in tile coordinates (the ground painter's pixel / 16). */
export interface RoadEdge {
  /** Tiles inside the drawn edge at (x, y), measured across the road: positive on the road, negative beside it. */
  insideAt(x: number, y: number): number;
  /** The road's middle line: its y at x. */
  lineAt(x: number): number;
}

const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
/** Smooth value noise in -1..1 along a line; `row` picks an independent one. */
function noise1(seed: number, x: number, row: number): number {
  const i = Math.floor(x), a = lattice(seed, i, row);
  return a + (lattice(seed, i + 1, row) - a) * smooth(x - i);
}

/**
 * The drawn road of a centre line: `samples[x]` is the generator's `centre(x)` of column x (the Road tiles are the rows within 1.5
 * of it), `decks` the map's bridges (only road decks count), `seed` the woodland's.
 */
export function roadEdge(samples: ArrayLike<number>, decks: readonly BridgeInfo[], seed: number): RoadEdge {
  const n = samples.length, at = (i: number) => samples[Math.min(n - 1, Math.max(0, i))];
  // One 1-2-1 pass: where the generator's clamp cuts a peak flat, the corner at each end becomes a short bend.
  const soft = Float64Array.from({ length: n }, (_, i) => (at(i - 1) + 2 * at(i) + at(i + 1)) / 4);
  const N = n * SUB + 1, line = new Float64Array(N), even = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    // A sample belongs to its column's middle, and a row's tiles to their middle: both half a tile on.
    const t = Math.min(n - 1, Math.max(0, k / SUB - 0.5)), i = Math.min(n - 2, Math.floor(t));
    line[k] = (n < 2 ? soft[0] : soft[i] + (soft[i + 1] - soft[i]) * (t - i)) + 0.5;
  }
  for (const { rect: [dx, dy, dw, dh], along_x, road } of decks) {
    if (!road) continue;
    const grow = along_x ? DECK_GROW : 0, x0 = dx - grow, x1 = dx + dw + grow, mid = dy + dh / 2;
    for (let k = Math.max(0, Math.floor((x0 - DECK_FADE) * SUB)); k < N && k <= (x1 + DECK_FADE) * SUB; k++) {
      const g = smooth(1 - Math.max(x0 - k / SUB, k / SUB - x1, 0) / DECK_FADE);
      line[k] += (mid - line[k]) * g;
      even[k] = Math.max(even[k], g);
    }
  }
  // Per entry: how much of a step in y is a step across the road, and the two sides' half-widths (north: smaller y).
  const across = new Float64Array(N), north = new Float64Array(N), south = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const a = Math.max(0, k - 1), b = Math.min(N - 1, k + 1), x = k / SUB, swing = 1 - even[k];
    across[k] = 1 / Math.hypot(1, ((line[b] - line[a]) * SUB) / (b - a));
    north[k] = ROAD_HALF + swing * (SWELL * noise1(seed, x / SWELL_LEN, 0) + BUMP * noise1(seed, x / BUMP_LEN, 1));
    south[k] = ROAD_HALF + swing * (SWELL * noise1(seed, x / SWELL_LEN, 2) + BUMP * noise1(seed, x / BUMP_LEN, 3));
  }
  /** The entry left of x and the share of the next one; past the ends the road runs on level. */
  let k = 0, u = 0;
  const seek = (x: number) => { const f = Math.min(N - 1, Math.max(0, x * SUB)); k = Math.min(N - 2, Math.floor(f)); u = f - k; };
  const mix = (a: Float64Array) => a[k] + (a[k + 1] - a[k]) * u;
  return {
    lineAt: (x) => { seek(x); return mix(line); },
    insideAt: (x, y) => {
      seek(x);
      const dy = y - mix(line), n0 = mix(north);
      // Around the middle line the two sides' widths blend, so the value has no jump there; at either edge it is that side's own.
      return n0 + (mix(south) - n0) * Math.min(1, Math.max(0, dy + 0.5)) - Math.abs(dy) * mix(across);
    },
  };
}

/** The road's drawn edge of a view map, kept beside the map (as the pond's field): maps without one paint the road by its tiles. */
const roads = new WeakMap<TileMap, RoadEdge>();
export function setRoadEdge(map: TileMap, edge: RoadEdge | null): void {
  if (edge) roads.set(map, edge); else roads.delete(map);
}
export function roadEdgeOf(map: TileMap): RoadEdge | undefined {
  return roads.get(map);
}
