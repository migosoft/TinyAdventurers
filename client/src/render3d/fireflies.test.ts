import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import type { Cam } from './camera';
import { newGlowBuf } from './cards';
import { Fireflies } from './fireflies';
import { SightMask, hiddenAt } from './sightmask';

const cam: Cam = { x: 20, z: 15, pitch: Math.PI / 4, yaw: 0 };

describe('Fireflies', () => {
  it('writes nothing at night 0', () => {
    const f = new Fireflies(3);
    f.step(0.1, { x: 20, z: 15 });
    const g = newGlowBuf();
    expect(f.push(g, cam, 0, null)).toBe(0);
    expect(g.n).toBe(0);
  });

  it('writes up to 70 glows at night 1, additive colour (0.8, 1.0, 0.4) at most', () => {
    const f = new Fireflies(3);
    f.step(0.1, { x: 20, z: 15 });
    const g = newGlowBuf();
    const n = f.push(g, cam, 1, null);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(70);
    expect(g.n).toBe(n);
    for (let i = 0; i < g.color.length; i += 3) {
      expect(g.color[i]).toBeLessThanOrEqual(0.8 + 1e-9);
      expect(g.color[i + 1]).toBeLessThanOrEqual(1 + 1e-9);
      expect(g.color[i + 2]).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it('keeps them in the 32 x 20 box around the centre after many steps, also when the centre moves', () => {
    const f = new Fireflies(3);
    for (let i = 0; i < 3000; i++) f.step(0.05, { x: 20 + i * 0.01, z: 15 - i * 0.005 });
    const c = { x: 20 + 2999 * 0.01, z: 15 - 2999 * 0.005 };
    for (let i = 0; i < f.count; i++) {
      expect(Math.abs(f.x[i] - c.x)).toBeLessThanOrEqual(16);
      expect(Math.abs(f.z[i] - c.z)).toBeLessThanOrEqual(10);
    }
  });

  it('gives the same positions for the same seed and different ones for another', () => {
    const run = (seed: number): number[] => {
      const f = new Fireflies(seed);
      for (let i = 0; i < 100; i++) f.step(0.05, { x: 20, z: 15 });
      return [...f.x, ...f.z];
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
    expect(new Fireflies(1).count).toBe(70);
  });

  it('skips fireflies on unseen texels', () => {
    const w = 40, h = 30, tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let y = 0; y < h; y++) tiles[y * w + 20] = TILE_ID.Wall;
    const map = new TileMap(w, h, tiles);
    const view = new View(w, h);
    view.compute(map, 5.5 * TILE, 15.5 * TILE, 14, 'hard');
    const mask = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });
    mask.update(view, null, 0);
    const f = new Fireflies(3);
    f.step(0.1, { x: 20, z: 15 });
    const open = newGlowBuf(), masked = newGlowBuf();
    f.push(open, cam, 1, null);
    f.push(masked, cam, 1, mask);
    expect(masked.n).toBeLessThan(open.n);
    // the ones that are left are on seen texels, and some are (the others stand behind the wall column or outside the mask)
    expect(masked.n).toBeGreaterThan(0);
    for (let i = 0; i < masked.n; i++) expect(hiddenAt(mask, masked.foot[i * 12], masked.foot[i * 12 + 1])).toBe(false);
    for (let i = 0; i < open.n; i++) if (hiddenAt(mask, open.foot[i * 12], open.foot[i * 12 + 1])) return;
    throw new Error('the open swarm has no hidden firefly: the test does not test the cull');
  });
});
