import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { BASE, EDGE, FLOWERS, PATCH, type Rgb } from '../../game/covemath';
import { groundKindAt, kindRow, paintGround, THICK_0, THICK_1 } from '../../game/woodland/ground';
import { TILE, TileMap } from '../../sim/map';
import { woodlandSource } from './woodland';

// 12 x 8: thicket in row 0, road columns 4..7 rows 2..5, a trunk, a barrier, walls and void at the right edge
function mapOf(): TileMap {
  const w = 12, h = 8;
  const t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let x = 0; x < w; x++) t[x] = TILE_ID.Thicket;
  for (let y = 2; y <= 5; y++) for (let x = 4; x <= 7; x++) t[y * w + x] = TILE_ID.Road;
  t[3 * w + 1] = TILE_ID.Trunk;
  t[6 * w + 9] = TILE_ID.Barrier;
  t[7 * w + 11] = TILE_ID.Wall;
  t[6 * w + 11] = TILE_ID.Void;
  return new TileMap(w, h, t);
}
const SEED = 7;
const eq = (d: ArrayLike<number>, i: number, c: Rgb): boolean => d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2];

describe('kindRow', () => {
  it('equals groundKindAt for every px', () => {
    const m = mapOf(), w = m.w * TILE, out = new Uint8Array(w * TILE);
    for (let ty = 0; ty < m.h; ty++) {
      kindRow(m, SEED, ty, out);
      for (let ly = 0; ly < TILE; ly++) for (let x = 0; x < w; x++) expect(out[ly * w + x]).toBe(groundKindAt(m, SEED, x, ty * TILE + ly));
    }
  });
});

describe('woodlandSource', () => {
  const m = mapOf(), src = woodlandSource(m, SEED, 3);
  const before = Buffer.from(paintGround(m, SEED).data);
  src.prep.forEach((u) => u());
  const px = (tx: number, ty: number) => (ty * TILE + 8) * src.w + tx * TILE + 8;

  it('sizes and masks', () => {
    expect(src.w).toBe(12 * TILE);
    expect(src.h).toBe(8 * TILE);
    expect(src.grow[px(5, 3)]).toBe(0); // road
    expect(src.grow[px(2, 5)]).toBe(1); // grass
    expect(src.grow[px(2, 0)]).toBe(1); // thicket
    expect(src.grow[px(11, 7)]).toBe(0); // wall
    expect(src.allow[px(11, 7)]).toBe(0);
    expect(src.allow[px(11, 6)]).toBe(0); // void
    expect(src.allow[px(5, 3)]).toBe(1);
    expect(src.density!(2, 0)).toBe(4);
    expect(src.density!(2, 4)).toBe(1);
  });
  it('the bare picture has no grass colours', () => {
    const d = src.bare!.image.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      expect(eq(d, i, BASE) || eq(d, i, PATCH)).toBe(false);
    }
    expect(d[px(2, 5) * 4 + 3]).toBe(255); // a former grass px shows dirt
  });
  it('the cover picture is grass on roads and thicket colours on thicket', () => {
    const d = src.colour;
    const grass = [BASE, PATCH, EDGE, ...FLOWERS];
    for (const [tx, ty] of [[5, 3], [6, 4], [4, 2]]) expect(grass.some((c) => eq(d, px(tx, ty) * 4, c))).toBe(true);
    for (const tx of [1, 2, 5, 9]) expect([THICK_0, THICK_1].some((c) => eq(d, px(tx, 0) * 4, c))).toBe(true);
    expect(d[px(11, 7) * 4 + 3]).toBe(0);
  });
  it('leaves paintGround of the original map unchanged', () => {
    expect(Buffer.from(paintGround(m, SEED).data).equals(before)).toBe(true);
    expect(m.get(5, 3)).toBe(TILE_ID.Road);
  });
});
