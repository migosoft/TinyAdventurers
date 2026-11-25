import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import type { PondInfo } from '../../generated/PondInfo';
import demo from '../../generated/pond-demo.json';
import { TileMap } from '../../sim/map';
import { DEEP_BED, SHALLOW_BED, bedAt, walkBedAt } from '../dips/shape';
import { DECK_Y, pondField, pondViewMap, setPondField } from './pondField';

const NONE: PondInfo = { seed: 1, streams: [], bridges: [] };

/** A map of floor with a 7 x 7 pond at cells 4..10 of a 15 x 15 grid. */
function pond7(): TileMap {
  const m = new TileMap(15, 15, new Uint8Array(225).fill(TILE_ID.Floor));
  for (let j = 4; j < 11; j++) for (let i = 4; i < 11; i++) m.set(i, j, TILE_ID.ShallowWater);
  return m;
}

const level = (i: number) => {
  const l = demo[i];
  return { rules: new TileMap(l.w, l.h, Uint8Array.from(l.tiles)), pond: l.woodland!.pond as unknown as PondInfo };
};

describe('pondField (#360)', () => {
  it('shore distance grows inward', () => {
    const f = pondField(pond7(), NONE);
    expect(f.shoreAt(2, 2)).toBe(0);
    expect(f.shoreAt(7.5, 7.5)).toBeGreaterThan(3.3);
    expect(f.shoreAt(7.5, 7.5)).toBeLessThan(3.7);
    expect(f.shoreAt(5.5, 7.5)).toBeLessThan(f.shoreAt(7.5, 7.5));
  });

  it('the bed slopes evenly', () => {
    const f = pondField(pond7(), NONE);
    let last = -1;
    for (let x = 4; x <= 7.5; x += 0.05) { const d = f.depthAt(x, 7.5); expect(d).toBeGreaterThanOrEqual(last); last = d; }
    expect(f.depthAt(4.5, 7.5)).toBeCloseTo(SHALLOW_BED, 1); // 0.5 tiles in
    expect(f.depthAt(6.5, 7.5)).toBeCloseTo(DEEP_BED, 1); // 2.5 tiles in
    expect(f.depthAt(7.5, 7.5)).toBe(DEEP_BED);
  });

  it('deep tiles are deep', () => {
    for (let i = 0; i < demo.length; i++) {
      const { rules, pond } = level(i);
      const f = pondField(rules, pond), view = pondViewMap(rules, pond);
      for (let z = 0; z < rules.h; z++) for (let x = 0; x < rules.w; x++) {
        const t = view.get(x, z);
        if (t === TILE_ID.DeepWater) expect(f.depthAt(x + 0.5, z + 0.5)).toBeGreaterThanOrEqual(1.2);
        else if (t !== TILE_ID.ShallowWater) expect(f.depthAt(x + 0.5, z + 0.5)).toBe(0);
      }
    }
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
    { seed: 1, bridges: [], streams: [{ inflow, points: [[inflow ? 80 : 160, 88], [inflow ? 160 : 240, 88]] }] });

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

  it('a figure on a deck stands on it', () => {
    const { rules, pond } = level(3);
    const view = pondViewMap(rules, pond);
    const f = pondField(rules, pond);
    setPondField(view, f);
    const [x, z, w, h] = pond.bridges[0].rect;
    expect(DECK_Y).toBe(0.14);
    expect(walkBedAt(view, x + w / 2, z + h / 2)).toBe(DECK_Y);
    expect(f.deckAt(x + w / 2, z + h + 0.4)).toBe(DECK_Y); // half a tile past the end
    expect(f.deckAt(x + w / 2, z + h + 0.6)).toBeNull();
    expect(walkBedAt(view, x - 1.5, z + h / 2)).toBeLessThan(0); // the water beside the deck
    expect(bedAt(view, x + w / 2, z + h / 2)).toBeLessThan(0); // the bed runs on under it
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

  it('a map without a pond is untouched', () => {
    const m = pond7();
    const before = [bedAt(m, 7.5, 7.5), bedAt(m, 4.6, 7.5), walkBedAt(m, 7.5, 7.5)];
    expect(before[0]).toBeCloseTo(-SHALLOW_BED, 1);
    setPondField(m, pondField(m, NONE));
    expect(bedAt(m, 7.5, 7.5)).not.toBe(before[0]); // a field changes the bed ...
    setPondField(m, null);
    expect([bedAt(m, 7.5, 7.5), bedAt(m, 4.6, 7.5), walkBedAt(m, 7.5, 7.5)]).toEqual(before); // ... and removing it restores the old path
  });
});
