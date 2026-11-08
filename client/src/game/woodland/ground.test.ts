import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TILE, TileMap } from '../../sim/map';
import { flowerSpots, GRASS, GroundPainter, groundKindAt, paintGround } from './ground';

// 12 x 6 tiles: thicket top row, road in columns 4..7 of rows 1..4, grass elsewhere, a wall at the bottom right
function mapOf(): TileMap {
  const w = 12, h = 6;
  const t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let x = 0; x < w; x++) t[x] = TILE_ID.Thicket;
  for (let y = 1; y <= 4; y++) for (let x = 4; x <= 7; x++) t[y * w + x] = TILE_ID.Road;
  t[5 * w + 11] = TILE_ID.Wall;
  return new TileMap(w, h, t);
}

describe('paintGround', () => {
  it('deterministic', () => {
    const a = paintGround(mapOf(), 7), b = paintGround(mapOf(), 7), c = paintGround(mapOf(), 8);
    expect(a.w).toBe(12 * TILE);
    expect(a.h).toBe(6 * TILE);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
    expect(flowerSpots(mapOf(), 7)).toEqual(flowerSpots(mapOf(), 7));
  });

  it('road pixels are brown and grass pixels green', () => {
    const m = mapOf();
    const img = paintGround(m, 3);
    const at = (tx: number, ty: number, dx: number, dy: number) => {
      const i = ((ty * TILE + dy) * img.w + tx * TILE + dx) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    };
    // tile centres of the road (5,2) and grass (1,3), thicket (1,0); and the transparent wall
    const [rr, rg, rb, ra] = at(5, 2, 8, 8);
    expect(ra).toBe(255);
    expect(rr).toBeGreaterThan(rg);
    expect(rg).toBeGreaterThan(rb);
    const [gr, gg, gb] = at(1, 3, 3, 3);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
    const [tr, tg, tb] = at(1, 0, 8, 8);
    expect(tg).toBeGreaterThan(tr);
    expect(tg).toBeGreaterThan(tb);
    expect(tg).toBeLessThan(110);
    expect(at(11, 5, 8, 8)[3]).toBe(0);
    // every road tile centre is brown
    for (let y = 1; y <= 4; y++) for (let x = 4; x <= 7; x++) { const [r, g, b] = at(x, y, 8, 8); expect(r > g && g > b).toBe(true); }
  });

  it('no flower on the road', () => {
    const m = mapOf();
    const spots = flowerSpots(m, 5);
    expect(spots.length).toBeGreaterThan(100);
    for (const s of spots) {
      const t = m.get(Math.floor(s.x / TILE), Math.floor(s.y / TILE));
      expect(t).toBe(TILE_ID.Floor);
    }
    // the ground under every spot is grass, creeping edges included
    for (const s of spots) expect(groundKindAt(m, 5, s.x, s.y)).toBe(GRASS);
  });

  it('the banded paint equals the one-shot paint', () => {
    const m = mapOf();
    const p = new GroundPainter(m, 9);
    for (let ty = p.rows - 1; ty >= 0; ty--) p.band(ty); // any order
    p.blades();
    p.flowers();
    expect(Buffer.from(p.data).equals(Buffer.from(paintGround(m, 9).data))).toBe(true);
  });
});
