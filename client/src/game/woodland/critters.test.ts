import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TILE, TileMap } from '../../sim/map';
import { reachesPhaser } from '../../testutil/importWalk';
import { rng } from '../covemath';
import { beeAt, beeDepth, butterflyAt, flowerPatches, WING_COLOURS } from './critters';
import { butterflyHomes } from './critterMath';

const bounds = { x: 100, y: 100, w: 190, h: 190 };

describe('critters', () => {
  it('bees stay near their flower (<= 10 px)', () => {
    const f = { x: 200, y: 150 };
    for (let i = 0; i < 12; i++) for (let t = 0; t < 10; t += 0.05) {
      const b = beeAt(i, t, f, 3);
      expect(Math.hypot(b.x - f.x, b.y - f.y)).toBeLessThanOrEqual(10);
    }
  });

  it('a bee sorts by its own position, so it passes in front of what stands just south of its flower (#263)', () => {
    const f = { x: 200, y: 150 };
    let south = 0, north = 0;
    for (let t = 0; t < 4; t += 0.05) {
      const b = beeAt(0, t, f, 3);
      if (b.y > f.y + 2) { expect(beeDepth(b)).toBeGreaterThan(beeDepth(f)); south++; }
      if (b.y < f.y - 2) { expect(beeDepth(b)).toBeLessThan(beeDepth(f)); north++; }
    }
    expect(south).toBeGreaterThan(0);
    expect(north).toBeGreaterThan(0);
  });

  it('a butterfly rises 1.5 px on a flap and sinks 0.6 px between flaps', () => {
    // the lift is the ground height minus y; look at a stretch of steady flapping (not landing, not gliding)
    let checked = 0;
    for (let i = 0; i < 6; i++) {
      let t0 = 0;
      for (; t0 < 60; t0 += 0.1) if (!butterflyAt(i, t0, 5, bounds).landed && !butterflyAt(i, t0 + 1.2, 5, bounds).landed && !butterflyAt(i, t0 + 0.6, 5, bounds).landed) break;
      const air: number[] = [];
      for (let k = 0; k < 1200; k++) { const b = butterflyAt(i, t0 + k * 0.001, 5, bounds); air.push(b.ground - b.y); }
      // alternating extremes of the lift
      const ext: number[] = [];
      for (let k = 1; k < air.length - 1; k++) if ((air[k] > air[k - 1] && air[k] >= air[k + 1]) || (air[k] < air[k - 1] && air[k] <= air[k + 1])) ext.push(air[k]);
      const rises: number[] = [], sinks: number[] = [];
      for (let k = 1; k < ext.length; k++) if (Math.abs(ext[k] - ext[k - 1]) < 2) (ext[k] > ext[k - 1] ? rises : sinks).push(Math.abs(ext[k] - ext[k - 1])); // not the long glide
      const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
      expect(rises.length).toBeGreaterThanOrEqual(2);
      expect(med(rises)).toBeCloseTo(1.5, 1);
      expect(med(sinks)).toBeCloseTo(0.6, 1);
      checked++;
    }
    expect(checked).toBe(6);
  });

  it('wings are shut at the bottom of the down-stroke and open on the up-stroke', () => {
    let open = 0, shut = 0;
    for (let t = 0.5; t < 3; t += 0.001) { const b = butterflyAt(1, t, 5, bounds); if (b.landed) continue; if (b.open) open++; else shut++; }
    expect(open).toBeGreaterThan(0);
    expect(shut).toBeGreaterThan(0);
  });

  it('flaps at 5-7 Hz and lands sometimes', () => {
    for (let i = 0; i < 6; i++) {
      let landed = 0, last = butterflyAt(i, 0, 5, bounds).open, lastShut = -1;
      const gaps: number[] = [];
      for (let t = 0.001; t < 60; t += 0.001) {
        const b = butterflyAt(i, t, 5, bounds);
        if (b.landed) landed++;
        if (!b.landed && last && !b.open) { if (lastShut >= 0 && t - lastShut < 0.3) gaps.push(t - lastShut); lastShut = t; }
        last = b.open;
      }
      gaps.sort((a, b) => a - b);
      expect(landed).toBeGreaterThan(1000);
      expect(gaps.length).toBeGreaterThan(20);
      const med = gaps[Math.floor(gaps.length / 2)];
      expect(med).toBeGreaterThan(1 / 7.1);
      expect(med).toBeLessThan(1 / 4.9);
    }
  });

  it('does not jump when it lands or takes off', () => {
    for (let i = 0; i < 6; i++) {
      let prev = butterflyAt(i, 0, 5, bounds);
      for (let t = 0.01; t < 60; t += 0.01) {
        const b = butterflyAt(i, t, 5, bounds);
        expect(Math.hypot(b.x - prev.x, b.y - prev.y)).toBeLessThan(3);
        prev = b;
      }
    }
  });

  it('is deterministic for a seed and different for another', () => {
    const a = butterflyAt(2, 12.3, 9, bounds), b = butterflyAt(2, 12.3, 9, bounds), c = butterflyAt(2, 12.3, 10, bounds);
    expect(a).toEqual(b);
    expect(a.x).not.toBe(c.x);
    expect(beeAt(1, 4, { x: 0, y: 0 }, 9)).toEqual(beeAt(1, 4, { x: 0, y: 0 }, 9));
    expect(WING_COLOURS).toHaveLength(4);
  });

  it('patches: at most 40, biggest first, at the flowers centre', () => {
    const spots = [];
    for (let k = 0; k < 60; k++) spots.push({ x: k * 100, y: 10 }, { x: k * 100 + 10, y: 20 });
    const patches = flowerPatches(spots);
    expect(patches).toHaveLength(40);
    expect(patches[0]).toEqual({ x: 5, y: 15 });
  });

  it('butterflyHomes gives floor(walkable / 120) homes, the ones the constructor drew before the move', () => {
    const map = new TileMap(60, 40, new Uint8Array(60 * 40));
    for (let y = 2; y < 38; y++) for (let x = 2; x < 58; x++) map.set(x, y, (x + y) % 7 === 0 ? TILE_ID.Road : TILE_ID.Floor);
    map.set(10, 10, TILE_ID.Wall);
    const seed = 9;
    // the loop the Critters constructor had (copied as the expectation)
    const walk: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_ID.Floor || map.tiles[i] === TILE_ID.Road) walk.push(i);
    const n = Math.floor(walk.length / 120);
    const r = rng(seed * 31 + 7);
    const side = 12 * TILE;
    const want: { bounds: { x: number; y: number; w: number; h: number }; colour: number }[] = [];
    for (let i = 0; i < n; i++) {
      const tile = walk[Math.floor(r() * walk.length)];
      const cx = (tile % map.w + 0.5) * TILE, cy = (Math.floor(tile / map.w) + 0.5) * TILE;
      const x = Math.max(0, Math.min(map.w * TILE - side, cx - side / 2)), y = Math.max(0, Math.min(map.h * TILE - side, cy - side / 2));
      want.push({ bounds: { x, y, w: Math.min(side, map.w * TILE), h: Math.min(side, map.h * TILE) }, colour: WING_COLOURS[Math.floor(r() * WING_COLOURS.length)] });
    }
    expect(n).toBeGreaterThan(5);
    expect(butterflyHomes(map, seed)).toEqual(want);
  });

  it('the pure modules reach no phaser import', () => {
    for (const f of ['game/pixieMath.ts', 'game/woodland/critterMath.ts', 'game/covemath.ts']) {
      const chain = reachesPhaser(f);
      expect(chain && chain.join(' > '), `${f} reaches phaser`).toBeNull();
    }
  });
});
