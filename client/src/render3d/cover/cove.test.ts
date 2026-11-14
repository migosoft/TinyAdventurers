import { describe, expect, it } from 'vitest';
import type { CoveInfo } from '../../generated/CoveInfo';
import { TILE_ID } from '../../generated/defs';
import { BASE, coveGrass, coveLayout, MARGIN, paintCove } from '../../game/covemath';
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

const built = (m: TileMap, spots: { x: number; z: number; fern: boolean; count: number }[]) => {
  const src = coveSource(m, cove, spots);
  for (const p of src.prep) p();
  return src;
};

describe('coveSource', () => {
  const map = mapOf();
  const spots = [{ x: 8, z: 6, fern: false, count: 4 }];
  const s = built(map, spots);
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
    const wantGrow = new Uint8Array(s.w * s.h), wantAllow = new Uint8Array(s.w * s.h);
    for (let y = origin.y; y < origin.y + spec.h; y++) for (let x = origin.x; x < origin.x + spec.w; x++) {
      wantAllow[at(x, y)] = 1;
      if (grass(x - origin.x, y - origin.y)) wantGrow[at(x, y)] = 1;
    }
    expect(s.grow).toEqual(wantGrow);
    expect(s.allow).toEqual(wantAllow);
  });

  it('allows no px of a non-floor tile in the rect', () => {
    const m = mapOf();
    m.tiles[3 * m.w + 4] = TILE_ID.Wall;
    const t = built(m, []);
    expect(t.allow[(3 * TILE) * t.w + 4 * TILE]).toBe(0);
    expect(t.allow[(3 * TILE) * t.w + 5 * TILE]).toBe(1);
  });

  it("paints paintCove's colour at the carpet and BASE in the rest of the rectangle", () => {
    const art = paintCove(spec);
    const mx = Math.floor(spec.w / 2), my = Math.floor(spec.h / 2);
    const a = ((my + MARGIN) * art.w + mx + MARGIN) * 4, o = at(origin.x + mx, origin.y + my) * 4;
    expect(art.data[a + 3]).toBe(255);
    expect([...s.colour.slice(o, o + 3)]).toEqual([...art.data.slice(a, a + 3)]);
    const c = at(origin.x, origin.y) * 4; // the rectangle's corner has no grass
    expect([...s.colour.slice(c, c + 3)]).toEqual([...BASE]);
    expect(s.colour[at(0, 0) * 4 + 3]).toBe(0); // outside the rectangle nothing is worked: colour is never read there
  });

  it('takes no stone-shadow px of paintCove: they stay BASE, never black', () => {
    const art = paintCove(spec);
    let shadows = 0;
    for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) {
      const a = (y * art.w + x) * 4;
      if (art.data[a + 3] === 0 || art.data[a + 3] === 255) continue;
      const px = origin.x + x - MARGIN, py = origin.y + y - MARGIN;
      if (px < origin.x || px >= origin.x + spec.w || py < origin.y || py >= origin.y + spec.h) continue; // only the rectangle is worked
      shadows++;
      const o = at(origin.x + x - MARGIN, origin.y + y - MARGIN) * 4;
      expect([...s.colour.slice(o, o + 3)]).toEqual([...BASE]);
    }
    expect(shadows).toBeGreaterThan(0);
  });
});
