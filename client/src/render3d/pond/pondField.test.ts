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
      for (const m of f.mouths) {
        expect(f.shoreAt(m.x, m.z)).toBeGreaterThan(0.4); // a stream that never leaves its channel ends at its last point
        expect(Math.hypot(m.dx, m.dz)).toBeCloseTo(1, 5);
      }
    }
  });

  it('the current follows the stream and fades in the pond', () => {
    const { rules, pond } = level(2);
    const f = pondField(rules, pond);
    const [px, pz] = pond.streams[0].points[0];
    const on = f.flowAt(px / 16, pz / 16);
    expect(on.s).toBe(1);
    const [bx, bz] = pond.streams[0].points[1];
    expect(on.x * (bx - px) + on.z * (bz - pz)).toBeGreaterThan(0); // along the flow
    expect(f.flowAt(px / 16 + 5, pz / 16).s).toBe(0);
    const m = f.mouths[0];
    expect(f.flowAt(m.x, m.z).s).toBeGreaterThan(0.9);
    const far = f.flowAt(m.x + m.dx * 3.5, m.z + m.dz * 3.5);
    expect(far.s).toBeLessThan(0.1);
    expect(f.flowAt(m.x + m.dx * 1.5, m.z + m.dz * 1.5).s).toBeLessThan(f.flowAt(m.x, m.z).s);
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
