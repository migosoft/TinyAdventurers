import { describe, expect, it } from 'vitest';
import type { CoveInfo } from '../../generated/CoveInfo';
import { TILE_ID } from '../../generated/defs';
import { BASE, coveGrass, coveLayout, paintCove } from '../../game/covemath';
import { TILE, TileMap } from '../../sim/map';
import { coveSource } from './cove';
import { COVER } from './kinds';

const cove: CoveInfo = { x: 4, y: 3, w: 14, h: 10, tree_x: 11, tree_y: 8, seed: 5 };
// A 24 x 18 map: stone floor everywhere inside a wall ring, the cove's rect inside it.
function mapOf(): TileMap {
  const w = 24, h = 18, t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let x = 0; x < w; x++) { t[x] = TILE_ID.Wall; t[(h - 1) * w + x] = TILE_ID.Wall; }
  for (let y = 0; y < h; y++) { t[y * w] = TILE_ID.Wall; t[y * w + w - 1] = TILE_ID.Wall; }
  return new TileMap(w, h, t);
}
const MARGIN = 32;

describe('coveSource', () => {
  const map = mapOf();
  const spots = [{ x: 8, z: 6, fern: false, count: 4 }];
  const s = coveSource(map, cove, spots);
  const { spec, origin } = coveLayout(cove);
  const grass = coveGrass(spec);
  const at = (x: number, y: number) => y * s.w + x;

  it('is a grass source the size of the map, with the given spots', () => {
    expect(s.kind).toBe(COVER.grass);
    expect(s.w).toBe(map.w * TILE);
    expect(s.h).toBe(map.h * TILE);
    expect(s.spots).toBe(spots);
    expect(s.colour.length).toBe(s.w * s.h * 4);
  });

  it('grows at the carpet and not at the room corner', () => {
    const mx = Math.floor(spec.w / 2), my = Math.floor(spec.h / 2);
    expect(grass(mx, my)).toBe(true);
    expect(s.grow[at(origin.x + mx, origin.y + my)]).toBe(1);
    expect(grass(0, 0)).toBe(false);
    expect(s.grow[at(origin.x, origin.y)]).toBe(0);
  });

  it('grows exactly where coveGrass says, and allows only floor px inside the cove rect', () => {
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const inside = x >= origin.x && x < origin.x + spec.w && y >= origin.y && y < origin.y + spec.h;
      expect(s.grow[at(x, y)]).toBe(inside && grass(x - origin.x, y - origin.y) ? 1 : 0);
      expect(s.allow[at(x, y)]).toBe(inside ? 1 : 0);
    }
  });

  it('allows no px of a non-floor tile in the rect', () => {
    const m = mapOf();
    m.tiles[3 * m.w + 4] = TILE_ID.Wall;
    const t = coveSource(m, cove, []);
    expect(t.allow[(3 * TILE) * t.w + 4 * TILE]).toBe(0);
    expect(t.allow[(3 * TILE) * t.w + 5 * TILE]).toBe(1);
  });

  it("paints paintCove's colour at the carpet and BASE elsewhere", () => {
    const art = paintCove(spec);
    const mx = Math.floor(spec.w / 2), my = Math.floor(spec.h / 2);
    const a = ((my + MARGIN) * art.w + mx + MARGIN) * 4, o = at(origin.x + mx, origin.y + my) * 4;
    expect(art.data[a + 3]).toBe(255);
    expect([...s.colour.slice(o, o + 3)]).toEqual([...art.data.slice(a, a + 3)]);
    const c = at(0, 0) * 4;
    expect([...s.colour.slice(c, c + 3)]).toEqual([...BASE]);
  });
});
