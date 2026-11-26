import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import type { PondInfo } from '../../generated/PondInfo';
import demo from '../../generated/pond-demo.json';
import { TileMap } from '../../sim/map';
import { DEEP_BED, SHALLOW_BED, bedAt, inDipMesh, isWater, surfaceAt, walkBedAt, waterMaskAt, WATER_LEVEL } from '../dips/shape';
import { waterCell } from '../water/waterMesh';
import { DECK_Y, DEEP_MIN, SHELF_BED, pondField, pondViewMap, setPondField } from './pondField';
import { inside } from './pondShape';

const NONE: PondInfo = { seed: 1, blobs: [], streams: [], bridges: [] };

/** A pond of one round blob of radius 5 at (10.5, 10.5) on a 21 x 21 map of floor, its tiles cut as the server cuts them (a tile is water when its centre is inside). */
const ROUND: PondInfo = { seed: 11, blobs: [[10.5, 10.5, 5, 5]], streams: [], bridges: [] };
function tilesOf(pond: PondInfo, w = 21, h = 21): TileMap {
  const m = new TileMap(w, h, new Uint8Array(w * h).fill(TILE_ID.Floor));
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) if (inside(pond.blobs, pond.seed, x + 0.5, z + 0.5) > 0) m.set(x, z, TILE_ID.ShallowWater);
  return m;
}
/** The same with a deep middle: DeepWater where the tile's centre is `deepIn` tiles inside (about the server's rule). */
function deepTilesOf(pond: PondInfo, deepIn = 2.4): TileMap {
  const m = tilesOf(pond);
  for (let z = 0; z < m.h; z++) for (let x = 0; x < m.w; x++) if (inside(pond.blobs, pond.seed, x + 0.5, z + 0.5) >= deepIn) m.set(x, z, TILE_ID.DeepWater);
  return m;
}
/** Tiles from (x, z) to the nearest DeepWater tile of `map` (0 inside one), among the tiles within 3; Infinity: none. */
function toDeepTile(map: TileMap, x: number, z: number): number {
  let best = Infinity;
  for (let tz = Math.floor(z) - 3; tz <= Math.floor(z) + 3; tz++) for (let tx = Math.floor(x) - 3; tx <= Math.floor(x) + 3; tx++) {
    if (map.get(tx, tz) === TILE_ID.DeepWater) best = Math.min(best, Math.hypot(Math.max(tx - x, 0, x - tx - 1), Math.max(tz - z, 0, z - tz - 1)));
  }
  return best;
}

const level = (i: number) => {
  const l = demo[i];
  return { rules: new TileMap(l.w, l.h, Uint8Array.from(l.tiles)), pond: l.woodland!.pond as unknown as PondInfo };
};
/** Tiles from (x, z) to the nearest water tile of `map` (0 inside one), among the tiles within 2. */
function toWaterTile(map: TileMap, x: number, z: number): number {
  let best = Infinity;
  for (let tz = Math.floor(z) - 2; tz <= Math.floor(z) + 2; tz++) for (let tx = Math.floor(x) - 2; tx <= Math.floor(x) + 2; tx++) {
    if (isWater(map.get(tx, tz))) best = Math.min(best, Math.hypot(Math.max(tx - x, 0, x - tx - 1), Math.max(tz - z, 0, z - tz - 1)));
  }
  return best;
}

describe('pondField (#360)', () => {
  it('shore distance grows inward from the drawn shore', () => {
    const f = pondField(tilesOf(ROUND), ROUND);
    expect(f.shoreAt(2, 2)).toBe(0);
    expect(f.bankAt(2, 2)).toBeGreaterThan(2);
    expect(f.shoreAt(10.5, 10.5)).toBeGreaterThan(4);
    expect(f.shoreAt(10.5, 10.5)).toBeLessThan(6);
    expect(f.bankAt(10.5, 10.5)).toBe(0);
    expect(f.shoreAt(7, 10.5)).toBeLessThan(f.shoreAt(10.5, 10.5));
    expect(f.wetAt(10.5, 10.5)).toBe(1);
    expect(f.wetAt(2, 2)).toBe(0);
    expect(f.bodyAt(10.5, 10.5)).toBe(1);
  });

  it('the drawn shore is the shape\'s zero line, not the tile edges', () => {
    const f = pondField(tilesOf(ROUND), ROUND);
    for (let z = 3; z < 18; z += 0.31) for (let x = 3; x < 18; x += 0.31) {
      const v = inside(ROUND.blobs, ROUND.seed, x, z);
      if (v > 0.15) { expect(f.wetAt(x, z)).toBeGreaterThan(0.5); expect(f.shoreAt(x, z)).toBeGreaterThan(0); }
      // (the bilinear read lets a trace of the nearest wet sample through just outside)
      if (v < -0.15) { expect(f.wetAt(x, z)).toBeLessThan(0.5); expect(f.shoreAt(x, z)).toBeLessThan(0.03); expect(f.depthAt(x, z)).toBeLessThan(0.01); }
      if (v < -0.4) { expect(f.shoreAt(x, z)).toBe(0); expect(f.depthAt(x, z)).toBe(0); }
    }
  });

  it('the bed is a shelf over shallow tiles and deep only around the deep ones (#431)', () => {
    // all shallow: a shelf from shore to shore, never deeper than SHELF_BED
    const flat = pondField(tilesOf(ROUND), ROUND);
    for (let z = 4; z < 17; z += 0.23) for (let x = 4; x < 17; x += 0.23) {
      const s = flat.shoreAt(x, z), d = flat.depthAt(x, z);
      expect(d).toBeLessThanOrEqual(SHELF_BED);
      if (Math.abs(s - 0.5) < 0.02) expect(d).toBeCloseTo(SHALLOW_BED, 1);
      if (s >= 0.5) expect(d).toBeGreaterThanOrEqual(SHALLOW_BED - 1e-6);
    }
    // a deep middle: down to DEEP_BED there, the shelf around it, and no step between them
    const m = deepTilesOf(ROUND), f = pondField(m, ROUND);
    expect(m.get(10, 10)).toBe(TILE_ID.DeepWater);
    expect(f.depthAt(10.5, 10.5)).toBeCloseTo(DEEP_BED, 5);
    let last = f.depthAt(4, 10.5);
    for (let x = 4; x <= 10.5; x += 0.05) { const d = f.depthAt(x, 10.5); expect(Math.abs(d - last)).toBeLessThan(0.25); last = d; }
    for (let z = 4; z < 17; z += 0.23) for (let x = 4; x < 17; x += 0.23) {
      const far = toDeepTile(m, x, z), d = f.depthAt(x, z);
      if (far >= 1.5) expect(d).toBeLessThanOrEqual(SHELF_BED);
      expect(d).toBeLessThanOrEqual(DEEP_BED);
    }
  });

  it('on the demo levels: a shallow tile away from the deep ones is shelf, a deep tile is deep (#431)', () => {
    let shelf = 0, deep = 0;
    for (let i = 0; i < demo.length; i++) {
      const { rules, pond } = level(i);
      const view = pondViewMap(rules, pond), f = pondField(rules, pond, view);
      for (let z = 0; z < rules.h; z++) for (let x = 0; x < rules.w; x++) {
        const t = view.get(x, z), d = f.depthAt(x + 0.5, z + 0.5);
        if (t === TILE_ID.DeepWater) { expect(d).toBeGreaterThanOrEqual(DEEP_MIN); deep++; }
        if (t === TILE_ID.ShallowWater && toDeepTile(view, x + 0.5, z + 0.5) >= 1.5) { expect(d, `level ${i} tile ${x},${z}`).toBeLessThanOrEqual(SHELF_BED); shelf++; }
      }
    }
    expect(shelf).toBeGreaterThan(100);
    expect(deep).toBeGreaterThan(40);
  });

  it('on the demo levels: deep tiles are deep, the body\'s tiles are drawn wet, the drawn water keeps to the water tiles', () => {
    for (let i = 0; i < demo.length; i++) {
      const { rules, pond } = level(i);
      const view = pondViewMap(rules, pond), f = pondField(rules, pond, view);
      for (let z = 0; z < rules.h; z++) for (let x = 0; x < rules.w; x++) {
        const t = view.get(x, z), cx = x + 0.5, cz = z + 0.5;
        if (t === TILE_ID.DeepWater) expect(f.depthAt(cx, cz)).toBeGreaterThanOrEqual(DEEP_MIN);
        // a tile whose centre is inside the pond's shape is drawn wet (the server made it water, or a pond bridge's floor)
        if (inside(pond.blobs, pond.seed, cx, cz) > 0.05) { expect(isWater(t)).toBe(true); expect(f.wetAt(cx, cz)).toBeGreaterThan(0.5); expect(f.shoreAt(cx, cz)).toBeGreaterThan(0); }
        // no drawn water a tile or more from the water tiles: it stays in the cells the dip mesh and the water quads cover
        for (const [dx, dz] of [[0.5, 0.5], [0, 0], [0.5, 0], [0, 0.5]]) {
          if (f.shoreAt(x + dx, z + dz) <= 0 && f.wetAt(x + dx, z + dz) <= 0.5) continue;
          expect(toWaterTile(view, x + dx, z + dz)).toBeLessThan(1);
        }
        if (f.wetAt(cx, cz) > 0.5) { expect(inDipMesh(view, x, z)).toBe(true); expect(waterCell(view, x, z)).toBe(true); }
      }
    }
  });

  it('a brook is one piece from its first point to the pond, under a road bridge too', () => {
    for (const i of [1, 2]) {
      const { rules, pond } = level(i);
      const f = pondField(rules, pond);
      for (const s of pond.streams) {
        const p = s.points.map(([x, z]) => [x / 16, z / 16]);
        for (let k = 0; k < p.length; k++) expect(f.wetAt(p[k][0], p[k][1]), `level ${i} point ${k}`).toBeGreaterThan(0.5);
        // its pond end lies in the pond's body: brook and pond are one shape
        const end = s.inflow ? p[p.length - 1] : p[0];
        expect(f.shoreAt(end[0], end[1])).toBeGreaterThan(0.5);
      }
    }
    // level 1's road bridge: wet along the deck's middle line
    const { rules, pond } = level(1);
    const f = pondField(rules, pond), [bx, bz, bw, bh] = pond.bridges[0].rect;
    for (let z = bz; z <= bz + bh; z += 0.25) expect(Math.max(f.wetAt(bx + 0.25, z), f.wetAt(bx + 0.5, z), f.wetAt(bx + 0.75, z))).toBeGreaterThan(0.5);
    expect(bw).toBe(1);
  });

  it('a brook is narrower than its tiles and opens toward the pond', () => {
    // A straight stream along +x at z = 5.5 into a round pond at (20.5, 5.5).
    const pond: PondInfo = { seed: 3, blobs: [[20.5, 5.5, 4, 4]], bridges: [], streams: [{ inflow: true, points: [[40, 88], [88, 88], [136, 88], [184, 88], [272, 88]] }] };
    const m = tilesOf(pond, 30, 12);
    for (let x = 2; x < 17; x++) m.set(x, 5, TILE_ID.ShallowWater);
    const f = pondField(m, pond);
    const width = (x: number): number => { let n = 0; for (let z = 4; z < 7; z += 0.02) if (f.wetAt(x, z) > 0.5) n++; return n * 0.02; };
    for (const x of [4, 6, 8, 10]) { expect(width(x)).toBeGreaterThan(0.45); expect(width(x)).toBeLessThan(1.25); }
    expect(width(15.5)).toBeGreaterThan(width(8)); // the mouth
    expect(f.bodyAt(6, 5.5)).toBe(0);
    expect(f.depthAt(6, 5.5)).toBeGreaterThan(0.2); // a shallow channel
    expect(f.depthAt(6, 5.5)).toBeLessThan(SHALLOW_BED + 0.05);
  });

  it('a mouth per inflow', () => {
    expect(pondField(level(0).rules, level(0).pond).mouths).toHaveLength(0);
    for (const i of [1, 2]) {
      const { rules, pond } = level(i);
      const f = pondField(rules, pond);
      expect(f.mouths).toHaveLength(pond.streams.filter((s) => s.inflow).length);
      const ins = pond.streams.filter((s) => s.inflow);
      f.mouths.forEach((m, k) => {
        const p = ins[k].points, [lx, lz] = p[p.length - 1], [qx, qz] = p[p.length - 2];
        const len = Math.hypot(lx - qx, lz - qz);
        expect(m.x).toBeCloseTo(lx / 16, 6);
        expect(m.z).toBeCloseTo(lz / 16, 6);
        expect(m.dx).toBeCloseTo((lx - qx) / len, 6);
        expect(m.dz).toBeCloseTo((lz - qz) / len, 6);
      });
    }
  });

  // A straight stream along +x at z = 5.5 on a plain map; the inflow ends at x = 10, the outflow starts at x = 10.
  const straight = (inflow: boolean) => pondField(new TileMap(30, 12, new Uint8Array(360).fill(TILE_ID.Floor)),
    { seed: 1, blobs: [], bridges: [], streams: [{ inflow, points: [[inflow ? 80 : 160, 88], [inflow ? 160 : 240, 88]] }] });

  it('the current runs three tiles into the pond', () => {
    const f = straight(true);
    expect(f.flowAt(10, 5.5).s).toBeCloseTo(1, 5); // at the mouth
    const mid = f.flowAt(11.5, 5.5);
    expect(mid.s).toBeCloseTo(0.5, 2);
    expect([mid.x, mid.z]).toEqual([1, 0]);
    expect(f.flowAt(13, 5.5).s).toBe(0);
    expect(f.flowAt(14, 5.5).s).toBe(0);
    expect(f.flowAt(11.5, 7.5).s).toBe(0); // 2 tiles to the side
    expect(f.flowAt(7, 5.5).s).toBe(1); // on the stream itself
  });

  it('the pond is drawn toward an outflow', () => {
    const f = straight(false);
    expect(f.flowAt(10, 5.5).s).toBeCloseTo(1, 5); // at the first point
    const mid = f.flowAt(8.5, 5.5);
    expect(mid.s).toBeCloseTo(0.5, 2);
    expect([mid.x, mid.z]).toEqual([1, 0]);
    expect(f.flowAt(7, 5.5).s).toBe(0);
    expect(f.flowAt(6, 5.5).s).toBe(0);
    expect(f.flowAt(8.5, 7.5).s).toBe(0);
    expect(f.flowAt(13, 5.5).s).toBe(1);
  });

  it('a figure on a deck stands on it, and the water runs on under it', () => {
    const { rules, pond } = level(3);
    const view = pondViewMap(rules, pond);
    const f = pondField(rules, pond);
    setPondField(view, f);
    const [x, z, w, h] = pond.bridges[0].rect;
    const ax = pond.bridges[0].along_x; // past the end along the deck, beside it across
    expect(DECK_Y).toBe(0.14);
    expect(walkBedAt(view, x + w / 2, z + h / 2)).toBe(DECK_Y);
    expect(ax ? f.deckAt(x + w + 0.4, z + h / 2) : f.deckAt(x + w / 2, z + h + 0.4)).toBe(DECK_Y); // half a tile past the end
    expect(ax ? f.deckAt(x + w + 0.6, z + h / 2) : f.deckAt(x + w / 2, z + h + 0.6)).toBeNull();
    // the water beside the deck: the centre of a water tile next to it (water lies on both sides of at least one deck tile)
    const side = Array.from({ length: Math.max(w, h) }, (_, i) => (ax ? [x + i + 0.5, z - 0.5] : [x - 0.5, z + i + 0.5]))
      .find(([sx, sz]) => isWater(view.get(Math.floor(sx), Math.floor(sz))))!;
    expect(walkBedAt(view, side[0], side[1])).toBeLessThan(0);
    expect(bedAt(view, x + w / 2, z + h / 2)).toBeLessThan(0); // the bed runs on under it
    expect(surfaceAt(view, x + w / 2, z + h / 2)).toBe(WATER_LEVEL);
  });

  it('the view map turns only bridge tiles to water', () => {
    const { rules, pond } = level(1);
    const before = Uint8Array.from(rules.tiles);
    const view = pondViewMap(rules, pond);
    expect(rules.tiles).toEqual(before);
    const [bx, bz, bw, bh] = pond.bridges[0].rect;
    for (let z = 0; z < rules.h; z++) for (let x = 0; x < rules.w; x++) {
      const inside = x >= bx && x < bx + bw && z >= bz && z < bz + bh;
      expect(view.get(x, z)).toBe(inside ? TILE_ID.ShallowWater : rules.get(x, z));
    }
  });

  it('the bed, the surface and the water mask follow the drawn shore on a map with a field', () => {
    const m = tilesOf(ROUND), f = pondField(m, ROUND);
    setPondField(m, f);
    for (let z = 3; z < 18; z += 0.37) for (let x = 3; x < 18; x += 0.37) {
      expect(waterMaskAt(m, x, z)).toBe(f.wetAt(x, z));
      expect(surfaceAt(m, x, z)).toBe(f.wetAt(x, z) > 0.5 ? WATER_LEVEL : -Infinity);
      if (f.shoreAt(x, z) > 0.3) expect(bedAt(m, x, z)).toBeLessThan(-0.2);
      if (f.wetAt(x, z) === 0) expect(bedAt(m, x, z)).toBe(0);
    }
  });

  it('a map without a pond is untouched', () => {
    const m = tilesOf(ROUND);
    const before = [bedAt(m, 10.5, 10.5), bedAt(m, 6.1, 10.5), walkBedAt(m, 10.5, 10.5), waterMaskAt(m, 6.1, 10.5), surfaceAt(m, 10.5, 10.5)];
    expect(Math.abs(before[0] + SHALLOW_BED)).toBeLessThan(0.07); // the tile masks' shallow bed, with its roughness
    setPondField(m, pondField(m, ROUND));
    expect(bedAt(m, 10.5, 10.5)).not.toBe(before[0]); // a field changes the bed ...
    setPondField(m, null);
    expect([bedAt(m, 10.5, 10.5), bedAt(m, 6.1, 10.5), walkBedAt(m, 10.5, 10.5), waterMaskAt(m, 6.1, 10.5), surfaceAt(m, 10.5, 10.5)]).toEqual(before); // ... and removing it restores the old path
  });

  it('a pond without blobs or water has an empty field', () => {
    const f = pondField(new TileMap(6, 6, new Uint8Array(36).fill(TILE_ID.Floor)), NONE);
    expect([f.shoreAt(3, 3), f.wetAt(3, 3), f.depthAt(3, 3), f.bodyAt(3, 3)]).toEqual([0, 0, 0, 0]);
    expect(f.bankAt(3, 3)).toBeGreaterThan(2);
  });
});
