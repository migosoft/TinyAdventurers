import { beforeAll, describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { BASE, EDGE, FLOWERS, PATCH, type Rgb } from '../../game/covemath';
import { BANK, GroundPainter, groundKindAt, kindRow, kindRows, type Shore, paintGround, THICK_0, THICK_1 } from '../../game/woodland/ground';
import { TILE, TileMap } from '../../sim/map';
import { setRoadEdge } from '../../game/woodland/road';
import { setPondField, type PondField } from '../pond/pondField';
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

describe('kindRow after an in-place tile change', () => {
  it('still equals groundKindAt', () => {
    const m = mapOf(), w = m.w * TILE, out = new Uint8Array(w * TILE);
    kindRow(m, SEED, 3, out);
    m.set(2, 3, TILE_ID.Road);
    kindRow(m, SEED, 3, out);
    for (let x = 0; x < w; x++) expect(out[8 * w + x]).toBe(groundKindAt(m, SEED, x, 3 * TILE + 8));
  });
});

describe('woodlandSource', () => {
  const m = mapOf();
  let src: ReturnType<typeof woodlandSource>, before: Buffer;
  beforeAll(() => {
    src = woodlandSource(m, SEED, 3);
    before = Buffer.from(paintGround(m, SEED).data);
    src.prep.forEach((u) => u());
  });
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

describe('woodlandSource with a drawn road (#430)', () => {
  it('nothing grows on the drawn road, and a Road tile the line has left grows grass', () => {
    const m = mapOf();
    // the line runs along y = 3 with 1 tile to either side: tile rows 2 and 3 are on it, rows 4 and 5 (Road tiles) are off it
    setRoadEdge(m, { insideAt: (_x, y) => 1 - Math.abs(y - 3), lineAt: () => 3 });
    const src = woodlandSource(m, SEED, 3);
    src.prep.forEach((u) => u());
    const px = (tx: number, ty: number, lx = 8, ly = 8) => (ty * TILE + ly) * src.w + tx * TILE + lx;
    expect(src.grow[px(5, 2)]).toBe(0);
    expect(src.grow[px(5, 3)]).toBe(0);
    expect(src.grow[px(5, 5, 8, 12)]).toBe(1);
    expect(src.grow[px(6, 5)]).toBe(1);
    expect(src.allow[px(5, 3)]).toBe(1);
  });
});

describe('woodlandSource at a pond (#360)', () => {
  // 14 x 10 grass with a road column; the drawn shore is a round pond of radius 2.5 tiles at (6.5, 5.5), whatever the tiles
  const w = 14, h = 10;
  const t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let y = 0; y < h; y++) t[y * w + 12] = TILE_ID.Road;
  const m = new TileMap(w, h, t);
  const out = (x: number, z: number): number => Math.hypot(x - 6.5, z - 5.5) - 2.5;
  const shore: Shore = { shoreAt: (x, z) => Math.max(0, -out(x, z)), bankAt: (x, z) => Math.max(0, out(x, z)), bodyAt: (x, z) => Math.min(1, Math.max(0, 0.5 - out(x, z) / 3)) };
  const src = woodlandSource(m, SEED, 3, shore);
  src.prep.forEach((u) => u());
  const kinds = new Uint8Array(src.w * src.h);
  const rows = kindRows(m, SEED, shore);
  for (let ty = 0; ty < h; ty++) rows(ty, kinds.subarray(ty * TILE * src.w, (ty + 1) * TILE * src.w));
  const at = (p: number): number => (p + 0.5) / TILE;

  it('no cover grows on a bank, and none reaches over the drawn water or the wet line', () => {
    let land = 0, wet = 0;
    const d = src.bare!.image.data;
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const i = y * src.w + x, water = shore.shoreAt(at(x), at(y)) > 0;
      if (water) { wet++; expect(kinds[i]).toBe(BANK); }
      if (kinds[i] !== BANK) continue;
      expect(src.grow[i]).toBe(0);
      if (water || shore.bankAt(at(x), at(y)) * TILE < 2) expect(src.allow[i]).toBe(0); else { land++; expect(src.allow[i]).toBe(1); }
      // the bare picture shows the bank there, as the ground's own picture does
      expect(d[i * 4 + 3]).toBe(255);
    }
    expect(wet).toBeGreaterThan(4000);
    expect(land).toBeGreaterThan(500); // the bank reaches onto the grass around the pond
    expect(src.grow[(1 * TILE + 8) * src.w + 1 * TILE + 8]).toBe(1); // grass away from the pond
  });

  it('without a shore (a map with no pond field) nothing is bank', () => {
    const plain = woodlandSource(m, SEED, 3);
    plain.prep.forEach((u) => u());
    expect(plain.grow[(5 * TILE + 8) * plain.w + 6 * TILE + 8]).toBe(1); // the pond's middle is grass
  });

  it("nothing grows through a bridge's deck", () => {
    // a map of its own, whose field (all this source reads of it) has a deck over tiles (1..3, 1)
    const own = new TileMap(w, h, t.slice());
    setPondField(own, { deckAt: (x: number, z: number) => (x >= 1 && x <= 3 && z >= 1 && z <= 2 ? 0.14 : null) } as PondField);
    const s = woodlandSource(own, SEED, 3, shore);
    s.prep.forEach((u) => u());
    const px = (x: number, z: number): number => Math.floor(z * TILE) * s.w + Math.floor(x * TILE);
    expect([s.grow[px(2, 1.5)], s.allow[px(2, 1.5)]]).toEqual([0, 0]);
    expect([s.grow[px(2, 3.5)], s.allow[px(2, 3.5)]]).toEqual([1, 1]);
  });

  it('the bare picture shows the bank as the ground paints it', () => {
    const p = new GroundPainter(m, SEED, shore); // the bands only: a blade mark of the grass may lie on a bank px
    for (let ty = 0; ty < p.rows; ty++) p.band(ty);
    const bare = src.bare!.image.data, own = p.data;
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      if (kinds[y * src.w + x] !== BANK) continue;
      const i = (y * src.w + x) * 4;
      expect([bare[i], bare[i + 1], bare[i + 2]]).toEqual([own[i], own[i + 1], own[i + 2]]);
    }
  });
});
