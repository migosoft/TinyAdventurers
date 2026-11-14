import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { butterflyAt, BEES_PER_PATCH, butterflyHomes, flowerPatches } from '../game/woodland/critterMath';
import { DEFAULT_HAZE } from '../game/sightField';
import { flowerSpots } from '../game/woodland/ground';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import type { Cam } from './camera';
import { newCardBuf } from './cards';
import { BEE_LIFT, butterflyLift, Critters3d, PX_FRAME } from './critters3d';
import { SightMask, hiddenAt } from './sightmask';
import type { FrameRects } from './worldMesh';

const frames: FrameRects = { [PX_FRAME]: { x: 0, y: 0, w: 16, h: 16 } };
const cam: Cam = { x: 20, z: 15, pitch: Math.PI / 4, yaw: 0 };
const ALL = { x0: 0, z0: 0, x1: 100, z1: 100 };

/** An open meadow of w x h tiles inside a ring of walls, with a wall column at x = `wallX` (none when -1). */
function meadow(w: number, h: number, wallX = -1): TileMap {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) tiles[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 || x === wallX ? TILE_ID.Wall : TILE_ID.Floor;
  return new TileMap(w, h, tiles);
}

describe('Critters3d', () => {
  it('has the flower patches times the bees per patch plus the butterflies', () => {
    const map = meadow(40, 30);
    const patches = flowerPatches(flowerSpots(map, 5)).length;
    const homes = butterflyHomes(map, 5).length;
    expect(patches).toBeGreaterThan(0);
    expect(homes).toBeGreaterThan(0);
    expect(new Critters3d(map, 5).count).toBe(patches * BEES_PER_PATCH + homes);
  });

  it('writes nothing before day 0.5 and something by day', () => {
    const c = new Critters3d(meadow(40, 30), 5);
    const night = newCardBuf();
    expect(c.push(night, frames, cam, 3, 0.4, null, ALL)).toBe(0);
    expect(night.n).toBe(0);
    const noon = newCardBuf();
    expect(c.push(noon, frames, cam, 3, 1, null, ALL)).toBeGreaterThan(0);
    expect(noon.n).toBeGreaterThan(0);
  });

  it('draws opaque fill-mode rects of the pixel frame', () => {
    const b = newCardBuf();
    new Critters3d(meadow(40, 30), 5).push(b, frames, cam, 3, 1, null, ALL);
    for (let i = 0; i < b.n; i++) expect(b.look[i * 30 + 3]).toBe(1); // mode 1 on the first vertex of every quad
    for (let i = 0; i < b.n; i++) expect(b.look[i * 30 + 4]).toBe(1); // alpha
  });

  it('skips a critter on an unseen texel', () => {
    const map = meadow(40, 30, 20);
    const c = new Critters3d(map, 5);
    const view = new View(map.w, map.h);
    view.compute(map, 5.5 * TILE, 15.5 * TILE, 14, 'hard');
    const mask = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });
    mask.update(view, null, 0);
    const open = newCardBuf(), masked = newCardBuf();
    c.push(open, frames, cam, 3, 1, null, ALL);
    c.push(masked, frames, cam, 3, 1, mask, ALL);
    expect(masked.n).toBeLessThan(open.n);
    // what is left is seen (and some critters are), nothing behind the wall column
    expect(masked.n).toBeGreaterThan(0);
    for (let i = 0; i < masked.n; i++) expect(hiddenAt(mask, masked.foot[i * 24], masked.foot[i * 24 + 1])).toBe(false);
  });

  it('skips a critter on an unseen texel of a daylight mask too', () => {
    const map = meadow(40, 30, 20);
    const c = new Critters3d(map, 5);
    const view = new View(map.w, map.h);
    view.compute(map, 5.5 * TILE, 15.5 * TILE, 14, 'hard');
    const mask = new SightMask(map, { daylight: true, feather: DEFAULT_HAZE.feather, ramp: DEFAULT_HAZE.ramp });
    mask.update(view, null, 0);
    const open = newCardBuf(), masked = newCardBuf();
    c.push(open, frames, cam, 3, 1, null, ALL);
    c.push(masked, frames, cam, 3, 1, mask, ALL);
    expect(masked.n).toBeGreaterThan(0);
    expect(masked.n).toBeLessThan(open.n);
  });

  it('skips critters outside the view box', () => {
    const b = newCardBuf();
    expect(new Critters3d(meadow(40, 30), 5).push(b, frames, cam, 3, 1, null, { x0: -50, z0: -50, x1: -40, z1: -40 })).toBe(0);
  });
});

describe('critter pixels above the ground', () => {
  it('keeps every pixel at or above the landed butterfly lift (nothing sinks into the ground), and a bee above its lift', () => {
    const c = new Critters3d(meadow(40, 30), 5);
    let lowest = Infinity;
    for (let t = 0; t < 60; t += 0.1) {
      const b = newCardBuf();
      c.push(b, frames, cam, t, 1, null, ALL);
      for (let i = 1; i < b.position.length; i += 3) lowest = Math.min(lowest, b.position[i]);
    }
    expect(lowest).toBeGreaterThanOrEqual(0.02 - 1e-6);
    expect(lowest).toBeLessThan(0.02 + 1 / 16); // a butterfly did land
  });
});

describe('critters on the cover (#330)', () => {
  it('lifts only the landed butterflies by ground(x, z, 0); bees and flyers in the air keep their height', () => {
    const map = meadow(40, 30);
    const base = new Critters3d(map, 5), lifted = new Critters3d(map, 5);
    const rs: number[] = [];
    let moved = 0, same = 0;
    for (let t = 0; t < 60; t += 0.7) {
      const a = newCardBuf(), b = newCardBuf();
      base.push(a, frames, cam, t, 1, null, ALL);
      lifted.push(b, frames, cam, t, 1, null, ALL, (_x, _z, r) => { rs.push(r); return 0.5; });
      expect(b.n).toBe(a.n);
      for (let q = 0; q < a.n; q++) {
        const d = b.position[q * 18 + 1] - a.position[q * 18 + 1];
        if (Math.abs(d - 0.5) < 1e-5) moved++;
        else { expect(d).toBeCloseTo(0, 6); same++; }
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(same).toBeGreaterThan(0);
    expect(new Set(rs)).toEqual(new Set([0]));
  });
});

describe('critter heights', () => {
  it('lifts a landed butterfly by at most 0.02 and a flying one by its air plus 0.25', () => {
    const bounds = { x: 0, y: 0, w: 192, h: 192 };
    let landed = 0, flying = 0;
    for (let t = 0; t < 60; t += 0.1) {
      const b = butterflyAt(0, t, 5, bounds);
      if (b.landed) { landed++; expect(butterflyLift(b)).toBeLessThanOrEqual(0.02); }
      else { flying++; expect(butterflyLift(b)).toBeCloseTo((b.ground - b.y) / 16 + 0.25, 9); }
    }
    expect(landed).toBeGreaterThan(0);
    expect(flying).toBeGreaterThan(0);
    expect(BEE_LIFT).toBe(0.35);
  });
});
