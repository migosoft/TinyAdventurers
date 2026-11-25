import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TILE, TileMap } from '../../sim/map';
import { BASE, PATCH } from '../covemath';
import { BANK, flowerSpots, GRASS, GROUND_TILES, GroundPainter, groundKindAt, groundOf, paintGround, ROAD, THICKET } from './ground';

// 12 x 6 tiles: thicket top row, road in columns 4..7 of rows 1..4, grass elsewhere, a wall at the bottom right
function mapOf(): TileMap {
  const w = 12, h = 6;
  const t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let x = 0; x < w; x++) t[x] = TILE_ID.Thicket;
  for (let y = 1; y <= 4; y++) for (let x = 4; x <= 7; x++) t[y * w + x] = TILE_ID.Road;
  t[5 * w + 11] = TILE_ID.Wall;
  return new TileMap(w, h, t);
}

describe('groundOf (#259)', () => {
  it('an invisible wall shows the ground west of it (else east), so the road runs on', () => {
    const m = mapOf();
    m.set(6, 2, TILE_ID.Barrier); // on the road
    m.set(9, 2, TILE_ID.Barrier); // on the grass, road two tiles west
    m.set(0, 3, TILE_ID.Barrier); // at the map's west edge: the east neighbour
    m.set(5, 0, TILE_ID.Barrier); // in the thicket row
    expect(groundOf(m, 6, 2)).toBe(ROAD);
    expect(groundOf(m, 9, 2)).toBe(GRASS);
    expect(groundOf(m, 0, 3)).toBe(GRASS);
    expect(groundOf(m, 5, 0)).toBe(THICKET);
    m.set(3, 2, TILE_ID.Barrier);
    m.set(4, 2, TILE_ID.Barrier); // west of it is a barrier: the east one (road)
    expect(groundOf(m, 4, 2)).toBe(ROAD);
  });
});

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

// 20 x 12 grass: a pond in columns 3..9 of rows 3..9 (deep in the middle), a stream one tile wide along row 6 from column 10 to 17
function pondMap(): TileMap {
  const w = 20, h = 12;
  const t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let y = 3; y <= 9; y++) for (let x = 3; x <= 9; x++) t[y * w + x] = x >= 5 && x <= 7 && y >= 5 && y <= 7 ? TILE_ID.DeepWater : TILE_ID.ShallowWater;
  for (let x = 10; x <= 17; x++) t[6 * w + x] = TILE_ID.ShallowWater;
  return new TileMap(w, h, t);
}

describe('the bank (#360)', () => {
  it('a woodland without water paints as before', () => {
    const m = mapOf();
    expect(createHash('sha256').update(paintGround(m, 7).data).digest('hex')).toBe('73d1ac2ed0a1f7c579181de831c54156977e4dfcfb7d94be7cf840d853aecb14');
    expect(flowerSpots(m, 7).length).toBe(265);
  });

  it('water tiles paint as bank', () => {
    const m = pondMap(), img = paintGround(m, 4);
    expect(GROUND_TILES.has(TILE_ID.ShallowWater) && GROUND_TILES.has(TILE_ID.DeepWater)).toBe(true);
    expect(groundOf(m, 3, 3)).toBe(BANK);
    expect(groundOf(m, 6, 6)).toBe(BANK);
    expect(groundOf(m, 14, 6)).toBe(BANK);
    const grass = (i: number) => [BASE, PATCH].some((c) => img.data[i] === c[0] && img.data[i + 1] === c[1] && img.data[i + 2] === c[2]);
    for (let y = 3 * TILE; y < 10 * TILE; y++) for (let x = 3 * TILE; x < 10 * TILE; x++) {
      const i = (y * img.w + x) * 4;
      expect(groundKindAt(m, 4, x, y)).toBe(BANK);
      expect(img.data[i + 3]).toBe(255);
      expect(grass(i)).toBe(false);
    }
  });

  it('the bank creeps onto the grass: under a tile at the pond, a few px at a stream', () => {
    const m = pondMap();
    // how far (px) the bank reaches north of a water tile's top edge, the farthest over the columns of tiles x0..x1
    const reach = (x0: number, x1: number, edge: number): number => {
      let far = 0;
      for (let x = x0 * TILE; x < (x1 + 1) * TILE; x++) for (let d = 1; d <= 2 * TILE; d++) if (groundKindAt(m, 4, x, edge * TILE - d) === BANK) far = Math.max(far, d);
      return far;
    };
    const pond = reach(4, 8, 3), stream = reach(12, 16, 6);
    expect(pond).toBeGreaterThanOrEqual(8);
    expect(pond).toBeLessThanOrEqual(TILE);
    expect(stream).toBeGreaterThanOrEqual(2);
    expect(stream).toBeLessThanOrEqual(5);
    // the px right at the water is bank everywhere
    for (let x = 4 * TILE; x < 9 * TILE; x++) expect(groundKindAt(m, 4, x, 3 * TILE - 1)).toBe(BANK);
  });

  it('the deep middle is darker than the shallows', () => {
    const m = pondMap(), img = paintGround(m, 4);
    const mean = (tx: number, ty: number): number => {
      let s = 0;
      for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = tx * TILE; x < tx * TILE + TILE; x++) { const i = (y * img.w + x) * 4; s += img.data[i] + img.data[i + 1] + img.data[i + 2]; }
      return s / (TILE * TILE * 3);
    };
    expect(mean(6, 6)).toBeLessThan(mean(6, 3) - 15);
  });

  it('flowerSpots avoids the bank', () => {
    const m = pondMap(), spots = flowerSpots(m, 5);
    expect(spots.length).toBeGreaterThan(100);
    for (const s of spots) {
      expect(m.get(Math.floor(s.x / TILE), Math.floor(s.y / TILE))).toBe(TILE_ID.Floor);
      expect(groundKindAt(m, 5, s.x, s.y)).toBe(GRASS);
    }
  });

  it('the banded paint equals the one-shot paint on a pond map', () => {
    const m = pondMap();
    const p = new GroundPainter(m, 9);
    for (let ty = p.rows - 1; ty >= 0; ty--) p.band(ty);
    p.blades();
    p.flowers();
    expect(Buffer.from(p.data).equals(Buffer.from(paintGround(m, 9).data))).toBe(true);
  });
});
