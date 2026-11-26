import { describe, expect, it } from 'vitest';
import type { BridgeInfo } from '../../generated/BridgeInfo';
import { TILE_ID } from '../../generated/defs';
import demo from '../../generated/pond-demo.json';
import { TileMap } from '../../sim/map';
import { BUMP, DECK_FADE, DECK_GROW, ROAD_HALF, roadEdge, roadEdgeOf, setRoadEdge, SWELL } from './road';

const W = 228, H = 72, SEED = 0x51ed;
/** A centre line shaped like the generator's (two sines, clamped), for the tests only: the client never computes the real one. */
const wavy = (p1: number, p2: number): number[] => Array.from({ length: W }, (_, x) => Math.min(H - 25, Math.max(24, H / 2 + 9 * Math.sin(x / 29 + p1) + 3 * Math.sin(x / 11 + p2))));
const flat = (c: number): number[] => new Array<number>(W).fill(c);
const PHASES: [number, number][] = [[0, 0], [1.3, 4.1], [1.1, 1.45], [5.2, 2.6], [3.3, 0.4]]; // the third has both sines peaking together: the clamp cuts
/** The road deck over column `x` of a line: the column's three Road rows, as the generator lays it. */
const deckAt = (samples: number[], x: number): BridgeInfo => ({ rect: [x, Math.ceil(samples[x] - 1.5), 1, 3], along_x: true, road: true });
/** The column where a line is steepest. */
function steepestOf(samples: number[]): number {
  let steep = 1;
  for (let x = 2; x < samples.length - 1; x++) if (Math.abs(samples[x + 1] - samples[x - 1]) > Math.abs(samples[steep + 1] - samples[steep - 1])) steep = x;
  return steep;
}

/** The two tile bounds of the design (#430, 4) for a map's Road tiles: each column's middle Road tile's centre is drawn road, and nothing drawn lies more than 1.5 tiles from a Road tile. */
function expectNearTiles(isRoad: (x: number, y: number) => boolean, w: number, h: number, samples: ArrayLike<number>, decks: readonly BridgeInfo[], seed: number): void {
  const edge = roadEdge(samples, decks, seed);
  const rows: number[][] = Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => y).filter((y) => isRoad(x, y)));
  let far = 0, bare = 0;
  for (let x = 0; x < w; x++) {
    const r = rows[x];
    if (r.length && edge.insideAt(x + 0.5, r[r.length >> 1] + 0.5) <= 0) bare++;
    for (let px = x + 0.125; px < x + 1; px += 0.25) for (let py = 0.125; py < h; py += 0.25) {
      if (edge.insideAt(px, py) <= 0) continue;
      let best = Infinity;
      for (let tx = Math.max(0, x - 2); tx <= Math.min(w - 1, x + 2); tx++) for (const ty of rows[tx]) best = Math.min(best, Math.hypot(Math.max(tx - px, 0, px - tx - 1), Math.max(ty - py, 0, py - ty - 1)));
      if (best > 1.5) far++;
    }
  }
  expect(bare).toBe(0);
  expect(far).toBe(0);
}

describe('the road line', () => {
  it('is continuous and never as steep as 1 on lines like the generator makes', () => {
    for (const [p1, p2] of PHASES) {
      const samples = wavy(p1, p2);
      // Squaring up to a deck costs height the line makes up beside it: with decks on the steepest stretches (0.58) the S may reach 1.25.
      for (const [decks, limit] of [[[], 1], [[deckAt(samples, steepestOf(samples)), deckAt(samples, 60), deckAt(samples, 147)], 1.25]] as [BridgeInfo[], number][]) {
        const edge = roadEdge(samples, decks, SEED);
        let steepest = 0;
        for (let x = -3; x < W + 3; x += 1 / 16) steepest = Math.max(steepest, Math.abs(edge.lineAt(x + 1 / 16) - edge.lineAt(x)) * 16);
        expect(steepest).toBeLessThan(limit);
      }
    }
  });

  it('runs through the tile band\'s middle and is flat past the ends', () => {
    const edge = roadEdge(flat(30), [], SEED);
    for (const x of [-5, 0, 0.3, 17.5, 100, W, W + 9]) expect(edge.lineAt(x)).toBeCloseTo(30.5, 9);
    const slanted = roadEdge(Array.from({ length: W }, (_, x) => 30 + x * 0.25), [], SEED);
    expect(slanted.lineAt(100.5)).toBeCloseTo(30 + 25 + 0.5, 9);
    expect(slanted.lineAt(100.75)).toBeCloseTo(30 + 25.0625 + 0.5, 9);
    expect(slanted.lineAt(-4)).toBeCloseTo(slanted.lineAt(0.5), 9);
  });

  it('has no corner where the clamp cuts a peak flat', () => {
    // A climb of 0.2 a column into a plateau: unsmoothed, the slope would change by 0.2 at one column.
    const samples = Array.from({ length: W }, (_, x) => Math.min(47, 27 + x * 0.2));
    const edge = roadEdge(samples, [], SEED);
    let sharpest = 0;
    for (let x = 1.5; x < W - 1; x++) sharpest = Math.max(sharpest, Math.abs(edge.lineAt(x + 1) - 2 * edge.lineAt(x) + edge.lineAt(x - 1)));
    expect(sharpest).toBeLessThan(0.11);
    expect(edge.lineAt(50.5)).toBeCloseTo(37.5, 9); // straight pieces are untouched
    expect(edge.lineAt(150.5)).toBeCloseTo(47.5, 9);
  });
});

describe('the road\'s width', () => {
  it('is 1.5 tiles each side on a straight line, with a swing inside the stated amplitudes', () => {
    const edge = roadEdge(flat(30), [], SEED);
    const offs: number[] = [];
    for (let x = 0; x < W; x += 1 / 16) for (const dy of [-1.5, 1.5, -0.9, 0.4, 2.5]) {
      const off = edge.insideAt(x, 30.5 + dy) - (ROAD_HALF - Math.abs(dy));
      expect(Math.abs(off)).toBeLessThanOrEqual(SWELL + BUMP + 1e-9);
      if (Math.abs(dy) === 1.5) offs.push(off);
    }
    expect(Math.max(...offs) - Math.min(...offs)).toBeGreaterThan(SWELL); // it does swing
    expect(Math.abs(offs.reduce((a, b) => a + b, 0) / offs.length)).toBeLessThan(0.06); // around 1.5
  });

  it('swells on each side on its own, and by the seed', () => {
    const a = roadEdge(flat(30), [], SEED), b = roadEdge(flat(30), [], SEED), c = roadEdge(flat(30), [], SEED + 1);
    let sides = 0, seeds = 0;
    for (let x = 0.5; x < W; x++) {
      expect(a.insideAt(x, 29)).toBe(b.insideAt(x, 29));
      sides = Math.max(sides, Math.abs(a.insideAt(x, 29) - a.insideAt(x, 32)));
      seeds = Math.max(seeds, Math.abs(a.insideAt(x, 29) - c.insideAt(x, 29)));
    }
    expect(sides).toBeGreaterThan(0.1);
    expect(seeds).toBeGreaterThan(0.1);
  });

  it('measures across the road, not straight down, on a slant', () => {
    const edge = roadEdge(Array.from({ length: W }, (_, x) => 20 + x * 0.5), [], SEED);
    const x = 100.5, y = edge.lineAt(x), k = 1 / Math.hypot(1, 0.5);
    for (const side of [1, -1]) expect(edge.insideAt(x, y + side * 1.6) - edge.insideAt(x, y + side * 0.6)).toBeCloseTo(-k, 6);
    expect(edge.insideAt(x, y + 1e-6)).toBeCloseTo(edge.insideAt(x, y - 1e-6), 4); // no jump on the middle line
  });
});

describe('a road bridge', () => {
  const samples = Array.from({ length: W }, (_, x) => 43.3 + (x - 147) * 0.5); // arrives slanted and 0.2 tiles off the deck's middle
  const deck: BridgeInfo = { rect: [147, 42, 1, 3], along_x: true, road: true };
  const edge = roadEdge(samples, [deck], SEED), plain = roadEdge(samples, [], SEED);

  it('gets the line level at the deck\'s middle, three tiles wide', () => {
    for (let x = 147 - DECK_GROW + 0.1; x < 148 + DECK_GROW; x += 0.1) {
      expect(edge.lineAt(x)).toBeCloseTo(43.5, 9);
      expect(edge.insideAt(x, 43.5)).toBeCloseTo(1.5, 2);
      expect(edge.insideAt(x, 42)).toBeCloseTo(0, 2);
      expect(edge.insideAt(x, 45)).toBeCloseTo(0, 2);
    }
  });

  it('fades out within the stated reach each side', () => {
    for (const x of [147 - DECK_GROW - DECK_FADE - 0.5, 148 + DECK_GROW + DECK_FADE + 0.5, 20.3, 200]) {
      expect(edge.lineAt(x)).toBeCloseTo(plain.lineAt(x), 9);
      expect(edge.insideAt(x, plain.lineAt(x) + 1.4)).toBeCloseTo(plain.insideAt(x, plain.lineAt(x) + 1.4), 9);
    }
    const half = 147 - DECK_GROW - DECK_FADE / 2; // halfway: between the two lines
    expect(Math.abs(edge.lineAt(half) - plain.lineAt(half))).toBeGreaterThan(0.1);
    expect(Math.abs(edge.lineAt(half) - 43.5)).toBeGreaterThan(0.1);
  });

  it('ignores footbridges', () => {
    const foot = roadEdge(samples, [{ rect: [109, 52, 5, 1], along_x: true, road: false }], SEED);
    for (let x = 100; x < 125; x += 0.37) for (const y of [48, 52.5, 60]) expect(foot.insideAt(x, y)).toBe(plain.insideAt(x, y));
  });
});

describe('the road and its tiles', () => {
  it('stays within the tile bounds on lines like the generator makes', () => {
    for (const [p1, p2] of PHASES) {
      const samples = wavy(p1, p2);
      const isRoad = (x: number, y: number) => Math.abs(y - samples[x]) <= 1.5;
      expectNearTiles(isRoad, W, H, samples, [], SEED);
      // Decks on the steepest column and on one where the line sits half a tile off the row.
      const steep = steepestOf(samples);
      const off = samples.findIndex((c, x) => x > 30 && Math.abs(steep - x) > 12 && Math.abs(c - Math.floor(c) - 0.45) < 0.05);
      expectNearTiles(isRoad, W, H, samples, [deckAt(samples, steep), ...(off > 0 ? [deckAt(samples, off)] : [])], SEED);
    }
  });

  // The cross-language check (#430, 1): the server's own maps and its own line. Skipped until the export carries `woodland.road`.
  it.skipIf(!('road' in demo[0].woodland))('matches the Road tiles of the generated demo maps', () => {
    for (const m of demo) {
      const samples = (m.woodland as unknown as { road: number[] }).road;
      const decks = (m.woodland.pond?.bridges ?? []) as BridgeInfo[];
      expect(samples.length).toBe(m.w);
      const onDeck = (x: number, y: number) => decks.some(({ rect: [dx, dy, dw, dh], road }) => road && x >= dx && x < dx + dw && y >= dy && y < dy + dh);
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.tiles[y * m.w + x] === TILE_ID.Road) expect(Math.abs(y - samples[x])).toBeLessThanOrEqual(1.5);
      expectNearTiles((x, y) => m.tiles[y * m.w + x] === TILE_ID.Road || onDeck(x, y), m.w, m.h, samples, decks, m.woodland.seed);
    }
  });
});

describe('the edge beside the view map', () => {
  it('is kept and dropped per map', () => {
    const map = new TileMap(2, 2, new Uint8Array(4)), edge = roadEdge(flat(1), [], 1);
    expect(roadEdgeOf(map)).toBeUndefined();
    setRoadEdge(map, edge);
    expect(roadEdgeOf(map)).toBe(edge);
    setRoadEdge(map, null);
    expect(roadEdgeOf(map)).toBeUndefined();
  });
});
