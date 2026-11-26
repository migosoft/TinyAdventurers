import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TILE, TileMap } from '../../sim/map';
import { BASE, PATCH } from '../covemath';
import { BANK, flowerSpots, GRASS, GROUND_TILES, GroundPainter, groundKindAt, groundOf, kindRows, paintGround, ROAD, THICKET, type Shore } from './ground';

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
    for (let ty = p.rows - 1; ty >= 0; ty--) p.band(ty);
    p.blades();
    p.flowers();
    expect(Buffer.from(p.data).equals(Buffer.from(paintGround(m, 9).data))).toBe(true);
  });
});

// A drawn shore on a 24 x 13 map of grass (with a road column at x = 1): a round pond of radius 3 tiles at (6.5, 6.5), and a brook
// 0.4 tiles to either side of z = 6.5 from x = 14 eastward, away from the pond's body.
const W = 24, H = 13, R = 3, BROOK = 0.4, BROOK_X = 14;
const fromPond = (x: number, z: number): number => Math.hypot(x - 6.5, z - 6.5) - R;
const fromBrook = (x: number, z: number): number => Math.hypot(Math.max(0, BROOK_X - x), Math.max(0, Math.abs(z - 6.5) - BROOK)) - (x >= BROOK_X && Math.abs(z - 6.5) < BROOK ? BROOK - Math.abs(z - 6.5) : 0);
const SHORE: Shore = {
  shoreAt: (x, z) => Math.max(0, -Math.min(fromPond(x, z), fromBrook(x, z))),
  bankAt: (x, z) => Math.max(0, Math.min(fromPond(x, z), fromBrook(x, z))),
  bodyAt: (x, z) => Math.min(1, Math.max(0, 0.5 - fromPond(x, z) / 3)),
};
function pondMap(): TileMap {
  const t = new Uint8Array(W * H).fill(TILE_ID.Floor);
  for (let y = 0; y < H; y++) t[y * W + 1] = TILE_ID.Road;
  return new TileMap(W, H, t);
}
/** Every px's kind with the shore. */
function kindsOf(m: TileMap, seed: number): Uint8Array {
  const w = m.w * TILE, out = new Uint8Array(w * m.h * TILE), rows = kindRows(m, seed, SHORE);
  for (let ty = 0; ty < m.h; ty++) rows(ty, out.subarray(ty * TILE * w, (ty + 1) * TILE * w));
  return out;
}
const centre = (p: number): number => (p + 0.5) / TILE;

describe('the bank (#360)', () => {
  it('a woodland without a shore paints as before, water tiles or not', () => {
    const m = mapOf();
    expect(createHash('sha256').update(paintGround(m, 7).data).digest('hex')).toBe('73d1ac2ed0a1f7c579181de831c54156977e4dfcfb7d94be7cf840d853aecb14');
    expect(flowerSpots(m, 7).length).toBe(265);
    // a water tile without a shore is grass, as it was before ponds; the painted ground still covers it
    const wet = mapOf();
    wet.set(1, 3, TILE_ID.ShallowWater);
    wet.set(2, 3, TILE_ID.DeepWater);
    expect(Buffer.from(paintGround(wet, 7).data).equals(Buffer.from(paintGround(m, 7).data))).toBe(true);
    expect(GROUND_TILES.has(TILE_ID.ShallowWater) && GROUND_TILES.has(TILE_ID.DeepWater)).toBe(true);
  });

  it('the drawn water paints as bank, whatever the tiles', () => {
    const m = pondMap(), img = paintGround(m, 4, SHORE), k = kindsOf(m, 4);
    const grass = (i: number) => [BASE, PATCH].some((c) => img.data[i] === c[0] && img.data[i + 1] === c[1] && img.data[i + 2] === c[2]);
    let wet = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      if (SHORE.shoreAt(centre(x), centre(y)) <= 0) continue;
      wet++;
      const i = y * img.w + x;
      expect(k[i]).toBe(BANK);
      expect(groundKindAt(m, 4, x, y, SHORE)).toBe(BANK);
      expect(img.data[i * 4 + 3]).toBe(255);
      expect(grass(i * 4)).toBe(false);
    }
    expect(wet).toBeGreaterThan(Math.PI * R * R * TILE * TILE);
    expect(k[(1 * TILE + 8) * img.w + 20 * TILE + 8]).toBe(GRASS); // far from the water
  });

  it('the bank creeps onto the land: under a tile at the pond, a few px at a brook, and over a road too', () => {
    const m = pondMap(), k = kindsOf(m, 4), w = m.w * TILE;
    // the farthest bank px from the drawn shore (px), among the px where `where` holds
    const reach = (where: (x: number, z: number) => boolean): number => {
      let far = 0;
      for (let y = 0; y < m.h * TILE; y++) for (let x = 0; x < w; x++) {
        if (k[y * w + x] === BANK && where(centre(x), centre(y))) far = Math.max(far, SHORE.bankAt(centre(x), centre(y)) * TILE);
      }
      return far;
    };
    const pond = reach((x) => x < 11), brook = reach((x) => x > 16);
    expect(pond).toBeGreaterThanOrEqual(8);
    expect(pond).toBeLessThanOrEqual(TILE);
    expect(brook).toBeGreaterThanOrEqual(2);
    expect(brook).toBeLessThanOrEqual(5);
    // the px right at the water is bank everywhere
    for (let y = 0; y < m.h * TILE; y++) for (let x = 0; x < w; x++) {
      const d = SHORE.bankAt(centre(x), centre(y)) * TILE;
      if (d > 0 && d <= 1) expect(k[y * w + x]).toBe(BANK);
    }
    // a road beside the water gives way as grass does
    const road = new TileMap(W, H, new Uint8Array(W * H).fill(TILE_ID.Road));
    expect(groundKindAt(road, 4, 6 * TILE + 8, 3 * TILE + 6, SHORE)).toBe(BANK); // 2 px outside the pond
    expect(groundKindAt(road, 4, 20 * TILE, 2 * TILE, SHORE)).toBe(ROAD);
  });

  it('the deep middle is darker than the shallows', () => {
    const img = paintGround(pondMap(), 4, SHORE);
    const mean = (tx: number, ty: number): number => {
      let s = 0;
      for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = tx * TILE; x < tx * TILE + TILE; x++) { const i = (y * img.w + x) * 4; s += img.data[i] + img.data[i + 1] + img.data[i + 2]; }
      return s / (TILE * TILE * 3);
    };
    expect(mean(6, 6)).toBeLessThan(mean(6, 4) - 10);
  });

  it('with the bed\'s depth the mud lies where the bed is deep: a shelf\'s middle stays light (#431)', () => {
    const middle = (depth: number): number => {
      const img = paintGround(pondMap(), 4, { ...SHORE, depthAt: () => depth });
      let s = 0;
      for (let y = 6 * TILE; y < 7 * TILE; y++) for (let x = 6 * TILE; x < 7 * TILE; x++) { const i = (y * img.w + x) * 4; s += img.data[i] + img.data[i + 1] + img.data[i + 2]; }
      return s / (TILE * TILE * 3);
    };
    expect(middle(0.7)).toBeGreaterThan(middle(2.3) + 10);
  });

  it('flowerSpots avoids the bank', () => {
    const m = pondMap(), spots = flowerSpots(m, 5, SHORE);
    expect(spots.length).toBeGreaterThan(100);
    expect(spots.length).toBeLessThan(flowerSpots(m, 5).length);
    for (const s of spots) {
      expect(SHORE.shoreAt(centre(s.x), centre(s.y))).toBe(0);
      expect(groundKindAt(m, 5, s.x, s.y, SHORE)).toBe(GRASS);
    }
  });

  it('the banded paint equals the one-shot paint with a shore', () => {
    const m = pondMap();
    const p = new GroundPainter(m, 9, SHORE);
    for (let ty = p.rows - 1; ty >= 0; ty--) p.band(ty);
    p.blades();
    p.flowers();
    expect(Buffer.from(p.data).equals(Buffer.from(paintGround(m, 9, SHORE).data))).toBe(true);
  });
});

describe('a road deck over a brook (#360)', () => {
  it('keeps the road paint where the drawn shore is dry and paints bed where it is wet', () => {
    // a road down x = 18, a brook across z = 6.5, and a deck over rows 5 to 7 (the view map has water under it)
    const m = pondMap();
    for (let y = 0; y < H; y++) m.set(18, y, TILE_ID.Road);
    for (let y = 5; y < 8; y++) m.set(18, y, TILE_ID.ShallowWater);
    const shore: Shore = { ...SHORE, decks: [{ x0: 18, z0: 5, x1: 19, z1: 8, road: true }] };
    const rows = kindRows(m, 4, shore), w = m.w * TILE, px = (tx: number, ty: number, lx: number, ly: number): number => {
      const out = new Uint8Array(w * TILE);
      rows(ty, out);
      return out[ly * w + tx * TILE + lx];
    };
    expect(px(18, 5, 8, 2)).toBe(ROAD); // the deck, a tile from the brook
    expect(px(18, 7, 8, 13)).toBe(ROAD);
    expect(px(18, 6, 8, 8)).toBe(BANK); // the brook under it
    // a deck that does not carry the road stays as it was
    const wood: Shore = { ...SHORE, decks: [{ x0: 18, z0: 5, x1: 19, z1: 8, road: false }] };
    const out = new Uint8Array(w * TILE);
    kindRows(m, 4, wood)(5, out);
    expect(out[2 * w + 18 * TILE + 8]).toBe(GRASS);
  });
});
