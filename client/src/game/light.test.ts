import { describe, expect, it } from 'vitest';
import fixtures from '../generated/fixtures.json';
import { CONST, LIGHT, LIGHT_KIND, TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { addColour, falloff, LightField } from './light';
import type { LightInfo } from '../generated/LightInfo';

const fmap = () => new TileMap(fixtures.w, fixtures.h, Uint8Array.from(fixtures.tiles));

describe('light field', () => {
  it('lights exactly the tiles the server lights', () => {
    const f = new LightField(fmap());
    f.load(fixtures.lights.sources as LightInfo[]);
    const lit: number[] = [];
    for (let y = 0; y < fixtures.h; y++) for (let x = 0; x < fixtures.w; x++) if (f.isLit(x, y)) lit.push(y * fixtures.w + x);
    expect(lit).toEqual(fixtures.lights.lit);
  });

  it('lights exactly the tiles the server lights around a moving light', () => {
    const m = fmap();
    const f = new LightField(m);
    for (const c of fixtures.lights.moving) {
      const lit = new Uint8Array(m.w * m.h);
      f.addMoving(new Float32Array(m.w * m.h * 3), lit, c.x, c.y, c.kind, LIGHT[c.kind].colour, 1, CONST.TILE);
      const tiles: number[] = [];
      lit.forEach((v, i) => v && tiles.push(i));
      expect(tiles, `light at ${c.x},${c.y}`).toEqual(c.lit);
    }
  });

  it('switches, recolours, removes and follows map changes', () => {
    const m = new TileMap(9, 3, new Uint8Array(27).fill(TILE_ID.Floor));
    const f = new LightField(m);
    f.add({ id: 1, kind: LIGHT_KIND.Torch, colour: 0xffaa5a, x: 1, y: 1, on: true });
    expect(f.isLit(5, 1)).toBe(true);
    f.set(1, false, 0xffaa5a);
    expect(f.isLit(5, 1)).toBe(false);
    f.set(1, true, 0x3060ff);
    expect(f.lights.get(1)!.colour).toBe(0x3060ff);
    m.set(3, 1, TILE_ID.Wall);
    m.set(3, 0, TILE_ID.Wall);
    m.set(3, 2, TILE_ID.Wall);
    f.mapChanged();
    expect(f.isLit(5, 1)).toBe(false);
    f.remove(1);
    expect(f.isLit(1, 1)).toBe(false);
  });

  it('adds overlapping colours per channel', () => {
    const rgb = new Float32Array(3);
    addColour(rgb, 0, 0xff0000, 1);
    addColour(rgb, 0, 0x0000ff, 1);
    expect(Array.from(rgb)).toEqual([255, 0, 255]); // red + blue = purple
    addColour(rgb, 0, 0xff8000, 1);
    expect(Math.min(255, rgb[0])).toBe(255); // capped by the drawer
    expect(rgb[1]).toBe(128);
  });

  it('accumulates a torch and lava on one tile into an orange', () => {
    const m = new TileMap(5, 1, new Uint8Array(5).fill(TILE_ID.Floor));
    m.set(4, 0, TILE_ID.Lava);
    const f = new LightField(m);
    f.add({ id: 1, kind: LIGHT_KIND.Torch, colour: LIGHT[LIGHT_KIND.Torch].colour, x: 0, y: 0, on: true });
    f.add({ id: 2, kind: LIGHT_KIND.Lava, colour: LIGHT[LIGHT_KIND.Lava].colour, x: 4, y: 0, on: true });
    const rgb = new Float32Array(5 * 3);
    f.accumulate(rgb, 0, 0, 5, 1, () => 1);
    const i = 3; // reached by both
    expect(rgb[i * 3]).toBeGreaterThan(rgb[i * 3 + 1]);
    expect(rgb[i * 3 + 1]).toBeGreaterThan(rgb[i * 3 + 2]);
    f.remove(2);
    const torch = new Float32Array(5 * 3);
    f.accumulate(torch, 0, 0, 5, 1, () => 1);
    expect(rgb[i * 3]).toBeGreaterThan(torch[i * 3]); // more red than the torch alone gives it
  });

  it('falls off smoothly from 1 at the centre to near black at the edge', () => {
    expect(falloff(0, 7)).toBe(1);
    expect(falloff(7, 7)).toBeCloseTo(0.1);
    expect(falloff(9, 7)).toBeCloseTo(0.1);
    expect(falloff(3.5, 7)).toBeCloseTo(0.55); // half way out: half way down
    for (const r of [2, 3, 4, 7]) {
      let prev = Infinity;
      for (let d = 0; d <= r + 1; d += 0.05) {
        const f = falloff(d, r);
        expect(f).toBeLessThanOrEqual(prev); // never brighter further out
        prev = f;
      }
    }
  });
});
