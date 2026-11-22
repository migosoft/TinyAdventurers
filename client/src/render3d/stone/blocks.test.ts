import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { CIRCLE_RINGS, CIRCLE_STONES, floorBlockAt, floorBlocksOf, RUNE_RING, wallBlockAt, wallBlocksOf, type Block } from './blocks';
import { LAID, ROCK, rockAmount, STONE_PX, stoneField } from './field';
import { noMarks, type FloorPiece, type Marks } from './place';
import type { Face } from './plan';

const W = 100, H = 100;
/** Rock west of the column `rockWest`, laid stone east of it. */
const kinds = (rockWest: number): Uint8Array => Uint8Array.from({ length: W * H }, (_, i) => (i % W < rockWest ? ROCK : LAID));
const map = new TileMap(W, H, new Uint8Array(W * H).fill(TILE_ID.Floor)), laid = stoneField(map, null, 7), none = noMarks();
const face: Face = { x: 10, z: 3, side: 0 };

/** Every px of a 64 by 64 window has one block whose rect holds it, and the rects (cut to the window) add up to the window: none overlaps. */
function tiles(at: (u: number, v: number) => Block | null, u0: number, v0: number): void {
  const seen = new Map<number, Block>();
  for (let v = v0; v < v0 + 64; v++) for (let u = u0; u < u0 + 64; u++) {
    const b = at(u, v)!;
    expect(b, `${u},${v}`).not.toBeNull();
    expect(u >= b.u0 && u < b.u1 && v >= b.v0 && v < b.v1, `${u},${v} in ${b.u0},${b.v0},${b.u1},${b.v1}`).toBe(true);
    const was = seen.get(b.id);
    if (was) expect([was.u0, was.v0, was.u1, was.v1]).toEqual([b.u0, b.v0, b.u1, b.v1]);
    seen.set(b.id, b);
  }
  let area = 0;
  for (const b of seen.values()) area += (Math.min(b.u1, u0 + 64) - Math.max(b.u0, u0)) * (Math.min(b.v1, v0 + 64) - Math.max(b.v0, v0));
  expect(area).toBe(64 * 64);
}

describe('the block layout', () => {
  it('tiles a laid plane without gaps or overlaps', () => {
    tiles((u, v) => floorBlockAt(laid, map, none, u, v), 300, 500);
    tiles((u, v) => wallBlockAt(laid, map, face, u, v), 300, 0);
  });

  it('gives neighbouring cells the same shared blocks, each once', () => {
    for (const [x, z] of [[5, 5], [20, 31], [47, 12]]) {
      const here = floorBlocksOf(laid, map, none, x, z);
      expect(new Set(here.map((b) => b.id)).size).toBe(here.length);
      let shared = 0;
      for (const [dx, dz] of [[1, 0], [0, 1]]) for (const n of floorBlocksOf(laid, map, none, x + dx, z + dz)) {
        const same = here.find((b) => b.id === n.id);
        if (!same) continue;
        shared++;
        expect(same).toEqual(n);
      }
      expect(shared).toBeGreaterThan(0);
    }
    const a = wallBlocksOf(laid, map, face), b = wallBlocksOf(laid, map, { ...face, x: face.x + 1 });
    expect(new Set(a.map((k) => k.id)).size).toBe(a.length);
    const both = b.filter((k) => a.some((j) => j.id === k.id));
    expect(both.length).toBeGreaterThan(0);
    for (const k of both) expect(a.find((j) => j.id === k.id)).toEqual(k);
    expect(a.filter((k) => k.frieze).length).toBeGreaterThan(0);
    // the frieze is one course: all its blocks share their v range
    expect(new Set(a.filter((k) => k.frieze).map((k) => `${k.v0},${k.v1}`)).size).toBe(1);
  });

  it('sinks about 18 % and raises about 14 % of 10 000 blocks, in all three stones', () => {
    const all = new Map<number, Block>();
    for (let z = 0; z < H && all.size < 10000; z++) for (let x = 0; x < W; x++) for (const b of floorBlocksOf(laid, map, none, x, z)) all.set(b.id, b);
    const blocks = [...all.values()].slice(0, 10000);
    expect(blocks.length).toBe(10000);
    const share = (p: (b: Block) => boolean): number => blocks.filter(p).length / blocks.length;
    expect(Math.abs(share((b) => b.level === -1) - 0.18)).toBeLessThan(0.03);
    expect(Math.abs(share((b) => b.level === 1) - 0.14)).toBeLessThan(0.03);
    for (const s of [0, 1, 2]) expect(share((b) => b.stone === s)).toBeGreaterThan(0.1);
    expect(share((b) => b.stone === 0)).toBeGreaterThan(share((b) => b.stone === 1));
    expect(share((b) => b.stone === 0)).toBeGreaterThan(share((b) => b.stone === 2));
  });

  it('is null deep in rock, and null more often the more rock the border has', () => {
    const f = stoneField(map, kinds(50), 7);
    for (let z = 320; z < 400; z += 3) for (let x = 320; x < 400; x += 3) expect(floorBlockAt(f, map, none, x, z)).toBeNull();
    expect(wallBlockAt(f, map, face, 10 * STONE_PX + 5, 20)).toBeNull();
    expect(wallBlockAt(f, map, { ...face, x: 80 }, 80 * STONE_PX + 5, 20)).not.toBeNull();
    const bins = Array.from({ length: 6 }, () => [0, 0]); // amount 0, four steps between, amount 1
    for (let z = 5; z < H * STONE_PX; z += 7) for (let x = 46 * STONE_PX; x < 54 * STONE_PX; x += 3) {
      const a = rockAmount(f, map, (x + 0.5) / STONE_PX, (z + 0.5) / STONE_PX);
      const bin = a === 0 ? 0 : a === 1 ? 5 : 1 + Math.min(3, Math.floor(a * 4));
      bins[bin][0]++;
      if (!floorBlockAt(f, map, none, x, z)) bins[bin][1]++;
    }
    const shares = bins.map(([n, nulls]) => { expect(n).toBeGreaterThan(200); return nulls / n; });
    for (let i = 1; i < shares.length; i++) expect(shares[i], shares.join(' ')).toBeGreaterThan(shares[i - 1]);
    expect(shares[0]).toBeLessThan(0.02); // a block is rock as a whole, by its centre: a px beside the border can belong to one
    expect(shares[5]).toBeGreaterThan(0.98);
  });

  it("covers a circle's rings with wedges that alternate", () => {
    const p: FloorPiece = { kind: 'circle', x: 10.5, z: 10.5, r: 1.5 };
    const marks: Marks = { ...noMarks(), pieces: [p] };
    const cx = p.x * STONE_PX, cz = p.z * STONE_PX, R = p.r * STONE_PX;
    for (let z = Math.floor(cz - R) - 2; z < cz + R + 2; z++) for (let x = Math.floor(cx - R) - 2; x < cx + R + 2; x++) {
      const b = floorBlockAt(laid, map, marks, x, z)!, k = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / R;
      expect(x >= b.u0 && x < b.u1 && z >= b.v0 && z < b.v1).toBe(true);
      if (k >= 1) { expect(b.piece).toBeUndefined(); continue; }
      expect(b.piece!.of).toBe(p);
      expect(b.piece!.ring).toBe(CIRCLE_RINGS.findIndex((edge) => k < edge));
      expect(b.level).toBe(0);
    }
    expect(CIRCLE_STONES[0]).toBe(1);
    expect(RUNE_RING).toBeGreaterThan(0);
    for (let ring = 1; ring < CIRCLE_RINGS.length; ring++) {
      const mid = ((CIRCLE_RINGS[ring - 1] + CIRCLE_RINGS[ring]) / 2) * R, round: Block[] = [];
      for (let i = 0; i < 2000; i++) {
        const a = (i / 2000) * Math.PI * 2;
        const b = floorBlockAt(laid, map, marks, Math.floor(cx + Math.cos(a) * mid), Math.floor(cz + Math.sin(a) * mid))!;
        if (round[round.length - 1]?.id !== b.id) round.push(b);
      }
      if (round[0].id === round[round.length - 1].id) round.pop();
      expect(round.length, `ring ${ring}`).toBe(CIRCLE_STONES[ring]);
      round.forEach((b, i) => expect(b.stone).not.toBe(round[(i + 1) % round.length].stone));
    }
    const ids = floorBlocksOf(laid, map, marks, 10, 10).filter((b) => b.piece).length;
    expect(ids).toBeGreaterThan(CIRCLE_STONES[1]);
  });

  it('keeps its blocks for a seed', () => {
    const pin = (b: Block | null): string => (b ? `${b.id}:${b.u0},${b.v0},${b.u1},${b.v1}:${b.stone}${b.level}${b.frieze ? 'f' : ''}` : 'rock');
    expect([[40, 40], [300, 500], [1000, 77], [2222, 3111]].map(([x, z]) => pin(floorBlockAt(laid, map, none, x, z)))).toEqual(['65542:37,39,61,59:10', '393236:270,484,311,502:00', '81982:988,73,1031,87:20', '2343046:2207,3106,2232,3121:10']);
    expect([[330, 3], [340, 25], [350, 40], [361, 60]].map(([u, v]) => pin(wallBlockAt(laid, map, face, u, v)))).toEqual(['536969244:323,0,334,10:20', '536977437:336,21,352,29:21f', '536981533:344,29,361,41:00', '536989726:359,52,373,64:01']);
    expect(floorBlockAt(stoneField(map, null, 8), map, none, 300, 500)).not.toEqual(floorBlockAt(laid, map, none, 300, 500));
  });
});
