import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import type { CoveInfo } from '../../generated/CoveInfo';
import { noise } from '../../game/covemath';
import { TILE, TileMap } from '../../sim/map';
import { COVER } from './kinds';
import { mossSource, MOSS, MOSS_TONES, tilesSeed } from './moss';
import type { CoverSource } from './source';
import { isWater, maskAt } from '../dips/shape';
import { noMarks, onPiece, piecesOf, type Marks } from '../stone/place';

// 5 x 5 rooms of 7 x 7 floor, walls between (1 tile), 1-tile doors in the walls between neighbours in a row,
// a 2 x 2 pool in room (1,1), and a 1-wide corridor leaving the grid at the bottom right.
const R = 7, STEP = R + 1, N = 5;
const W = N * STEP + 1 + 12, H = N * STEP + 1;
function roomsMap(tweak = 0): TileMap {
  const t = new Uint8Array(W * H).fill(TILE_ID.Wall);
  for (let ry = 0; ry < N; ry++) for (let rx = 0; rx < N; rx++)
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) t[(1 + ry * STEP + y) * W + 1 + rx * STEP + x] = TILE_ID.Floor;
  for (let ry = 0; ry < N; ry++) for (let rx = 0; rx < N - 1; rx++) t[(1 + ry * STEP + 3) * W + 1 + rx * STEP + R] = TILE_ID.DoorOpen;
  const pool = roomOrigin(1, 1);
  for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) t[(pool.y + y) * W + pool.x + x] = TILE_ID.ShallowWater;
  const c = roomOrigin(4, 4);
  for (let x = c.x + R; x < W - 1; x++) t[(c.y + 3) * W + x] = TILE_ID.Floor; // corridor, 1 wide, from the last room
  if (tweak) t[tweak] = TILE_ID.Floor; // an open border tile: a different layout, so a different seed, the same rooms
  return new TileMap(W, H, t);
}
const roomOrigin = (rx: number, ry: number) => ({ x: 1 + rx * STEP, y: 1 + ry * STEP });
const px = (tx: number, ty: number, f: (i: number) => void) => {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) f((ty * TILE + y) * W * TILE + tx * TILE + x);
};
function run(s: CoverSource): CoverSource { for (const p of s.prep) p(); return s; }
const make = (m: TileMap, cove: CoveInfo | null = null, everywhere = false) => run(mossSource(m, cove, noMarks(), { everywhere })!);

describe('mossSource', () => {
  it('is the same for the same map, and tilesSeed follows the tiles', () => {
    const a = make(roomsMap(), null, true), b = make(roomsMap(), null, true);
    expect(a.kind).toBe(COVER.moss);
    expect(Buffer.from(a.grow).equals(Buffer.from(b.grow))).toBe(true);
    expect(Buffer.from(a.colour).equals(Buffer.from(b.colour))).toBe(true);
    expect(tilesSeed(roomsMap())).toBe(tilesSeed(roomsMap()));
    expect(tilesSeed(roomsMap())).not.toBe(tilesSeed(roomsMap(1)));
  });

  it('grows nothing in a puddle basin or on a crevice, and the same elsewhere', () => {
    const m = roomsMap(), o = roomOrigin(3, 3), cx = o.x + 3, cz = o.y + 3;
    const marks: Marks = { ...noMarks(), puddles: [{ x: cx, z: cz, r: 0.9 }], crevices: [{ pts: [[o.x + 0.5, o.y + 6.5], [o.x + 6.5, o.y + 6.5]], branch: [], width: 0.2, depth: 0.1 }] };
    const base = make(m, null, true), s = run(mossSource(m, null, marks, { everywhere: true })!);
    let inBasin = 0, onPit = 0, same = 0, differs = 0;
    for (let y = 0; y < H * TILE; y++) for (let x = 0; x < W * TILE; x++) {
      const i = y * W * TILE + x, d = Math.hypot((x + 0.5) / TILE - cx, (y + 0.5) / TILE - cz);
      const u = (x + 0.5) * 2 - 0.5, v = (y + 0.5) * 2 - 0.5, [x0, z0, x1, z1] = piecesOf(marks.crevices[0])[0];
      const pit = onPiece(u, v, x0, z0, x1, z1, 3.2);
      if (d < 0.9 || pit) {
        expect(s.grow[i] + s.allow[i]).toBe(0);
        if (base.grow[i]) differs++;
        if (d < 0.9) inBasin++; else onPit++;
      } else if (d > 1.2) { if (s.grow[i] !== base.grow[i]) same = -1e9; else same++; }
    }
    expect(inBasin).toBeGreaterThan(0); expect(onPit).toBeGreaterThan(0);
    expect(differs).toBeGreaterThan(0);
    expect(same).toBeGreaterThan(0);
  });

  it('is null in a map with lava', () => {
    const m = roomsMap(), t = m.tiles.slice();
    t[(roomOrigin(2, 2).y + 1) * W + roomOrigin(2, 2).x + 1] = TILE_ID.Lava;
    expect(mossSource(new TileMap(W, H, t), null, noMarks())).toBeNull();
  });

  it('rims every pool with moss, in a room the area noise leaves bare too, and keeps it off the bank', () => {
    const m = roomsMap(), s = make(m); // not `everywhere`: only the waterside is certain
    const pool = roomOrigin(1, 1);
    // The floor tile left of the pool's upper left water tile: moss at its edge to the water, none at its far edge.
    const tx = pool.x + 1, ty = pool.y + 2;
    const at = (lx: number, ly: number) => (ty * TILE + ly) * W * TILE + tx * TILE + lx;
    let nearEdge = 0, farEdge = 0;
    for (let ly = 0; ly < TILE; ly++) {
      for (let lx = TILE - 5; lx < TILE; lx++) nearEdge += s.grow[at(lx, ly)];
      for (let lx = 0; lx < 2; lx++) farEdge += s.grow[at(lx, ly)];
    }
    expect(nearEdge).toBeGreaterThan(20);
    expect(farEdge).toBe(0);
    // A tile that touches the pool only by its corner is waterside too.
    let corner = 0;
    px(pool.x + 1, pool.y + 1, (i) => { corner += s.grow[i]; });
    expect(corner).toBeGreaterThan(0);
    // Inside the pool's rounded outline the ground falls into the water: no moss there and none may creep there.
    let onBank = 0;
    for (let ty2 = pool.y + 1; ty2 <= pool.y + 4; ty2++) for (let tx2 = pool.x + 1; tx2 <= pool.x + 4; tx2++) {
      for (let ly = 0; ly < TILE; ly++) for (let lx = 0; lx < TILE; lx++) {
        const x = tx2 * TILE + lx, y = ty2 * TILE + ly;
        if (maskAt(m, (x + 0.5) / TILE, (y + 0.5) / TILE, isWater) >= MOSS.waterEdge) onBank += s.grow[y * W * TILE + x] + s.allow[y * W * TILE + x];
      }
    }
    expect(onBank).toBe(0);
    // Water tiles themselves carry nothing.
    let inWater = 0;
    px(pool.x + 2, pool.y + 2, (i) => { inWater += s.grow[i] + s.allow[i]; });
    expect(inWater).toBe(0);
  });

  it('grows with lava on the map only when asked to ignore it', () => {
    const m = roomsMap(), t = m.tiles.slice();
    t[(roomOrigin(2, 2).y + 1) * W + roomOrigin(2, 2).x + 1] = TILE_ID.Lava;
    const withLava = new TileMap(W, H, t);
    expect(mossSource(withLava, null, noMarks())).toBeNull();
    const s = run(mossSource(withLava, null, noMarks(), { ignoreLava: true })!);
    expect(s.grow.reduce((a, v) => a + v, 0)).toBeGreaterThan(0);
    // The tiles beside the lava stay bare.
    let byLava = 0;
    px(roomOrigin(2, 2).x + 2, roomOrigin(2, 2).y + 1, (i) => { byLava += s.grow[i] + s.allow[i]; });
    expect(byLava).toBe(0);
  });

  it('keeps off doors, their neighbours, water tiles, non-floor tiles and corridors', () => {
    const m = roomsMap(), s = make(m, null, true);
    const bad: [number, number][] = [];
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const t = m.get(tx, ty);
      let near = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const u = m.get(tx + dx, ty + dy);
        if (u === TILE_ID.DoorOpen) near = true;
      }
      if (near || t !== TILE_ID.Floor) bad.push([tx, ty]);
    }
    let hits = 0;
    for (const [tx, ty] of bad) px(tx, ty, (i) => { hits += s.allow[i] + s.grow[i]; });
    const c = roomOrigin(4, 4);
    for (let x = c.x + R; x < W - 1; x++) px(x, c.y + 3, (i) => { hits += s.allow[i]; });
    expect(hits).toBe(0);
    // the room interior still has allowed ground
    expect(s.allow.reduce((a, v) => a + v, 0)).toBeGreaterThan(0);
  });

  it('with everywhere reaches every room corner and covers 5..40 % of the floor px', () => {
    const s = make(roomsMap(), null, true), m = roomsMap();
    for (let ry = 0; ry < N; ry++) for (let rx = 0; rx < N; rx++) {
      const o = roomOrigin(rx, ry);
      let any = false;
      for (const [cx, cy] of [[0, 0], [R - 1, 0], [0, R - 1], [R - 1, R - 1]]) {
        const tx = o.x + cx, ty = o.y + cy;
        if (m.get(tx, ty) !== TILE_ID.Floor) continue;
        let near = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const u = m.get(tx + dx, ty + dy); if (u === TILE_ID.DoorOpen || u === TILE_ID.ShallowWater) near = true; }
        if (near) continue;
        px(tx, ty, (i) => { if (s.grow[i]) any = true; });
        expect(any, `room ${rx},${ry} corner ${cx},${cy}`).toBe(true);
        any = false;
      }
    }
    let floor = 0, grown = 0;
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) if (m.get(tx, ty) === TILE_ID.Floor) px(tx, ty, (i) => { floor++; grown += s.grow[i]; });
    const share = grown / floor;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.4);
  });

  it('puts moss in only some rooms', () => {
    let sum = 0, withNone = false;
    for (let seed = 0; seed < 10; seed++) {
      const m = roomsMap(seed), s = make(m);
      let mossy = 0;
      for (let ry = 0; ry < N; ry++) for (let rx = 0; rx < N; rx++) {
        const o = roomOrigin(rx, ry);
        let any = false;
        for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) px(o.x + x, o.y + y, (i) => { if (s.grow[i]) any = true; });
        if (any) mossy++; else withNone = true;
      }
      sum += mossy / (N * N);
    }
    const mean = sum / 10;
    expect(mean).toBeGreaterThan(0.1);
    expect(mean).toBeLessThan(0.6);
    expect(withNone).toBe(true);
  });

  // A sealed corridor of 9 floor tiles (walls above, below and at both ends) with one water tile of the given kind in the middle.
  const corridor = (water: number): TileMap => {
    const cw = 11, t = new Uint8Array(cw * 3).fill(TILE_ID.Wall);
    for (let x = 1; x <= 9; x++) t[cw + x] = TILE_ID.Floor;
    t[cw + 5] = water;
    return new TileMap(cw, 3, t);
  };
  const tileSum = (s: CoverSource, cw: number, tx: number, ty: number): number => {
    let sum = 0;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) sum += s.allow[(ty * TILE + y) * cw * TILE + tx * TILE + x] + s.grow[(ty * TILE + y) * cw * TILE + tx * TILE + x];
    return sum;
  };

  it.each([['ShallowWater', TILE_ID.ShallowWater], ['DeepWater', TILE_ID.DeepWater]])('moss grows on the corridor tiles beside %s, and nowhere else in the corridor', (_name, water) => {
    const s = make(corridor(water), null, true);
    // Walls on both sides make a corridor tile exempt, but water beside it makes it waterside, and waterside is always mossy.
    expect(tileSum(s, 11, 4, 1)).toBeGreaterThan(0);
    expect(tileSum(s, 11, 6, 1)).toBeGreaterThan(0);
    // Two tiles from the water the tile is an ordinary corridor tile: exempt, even with `everywhere`.
    expect(tileSum(s, 11, 3, 1)).toBe(0);
    expect(tileSum(s, 11, 7, 1)).toBe(0);
  });

  it('leaves the cove bare', () => {
    const o = roomOrigin(2, 2);
    const cove: CoveInfo = { x: o.x, y: o.y, w: R, h: R, tree_x: o.x + 3, tree_y: o.y + 3, seed: 1 };
    const s = make(roomsMap(), cove, true);
    let hits = 0;
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) px(o.x + x, o.y + y, (i) => { hits += s.allow[i] + s.grow[i]; });
    expect(hits).toBe(0);
  });

  it('colours grown px with the moss tones', () => {
    const s = make(roomsMap(), null, true);
    let n = 0, bad = 0;
    for (let i = 0; i < s.grow.length; i++) if (s.grow[i]) {
      n++;
      if (!MOSS_TONES.some((c) => c[0] === s.colour[i * 4] && c[1] === s.colour[i * 4 + 1] && c[2] === s.colour[i * 4 + 2]) || s.colour[i * 4 + 3] !== 255) bad++;
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toBe(0);
  });

  it('keeps free patches inside mossy areas', () => {
    let checked = 0;
    for (let seed = 0; seed < 6; seed++) {
      const m = roomsMap(seed), s = make(m), area = noise(tilesSeed(m), MOSS.area * TILE);
      const mossy = (tx: number, ty: number) => area(tx * TILE + TILE / 2, ty * TILE + TILE / 2) > MOSS.areaCut;
      let stray = 0;
      for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
        let any = false;
        px(tx, ty, (i) => { if (s.grow[i]) any = true; });
        if (!any) continue;
        // A waterside tile is mossy whatever the area noise says (the rim of a pool).
        let wet = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.get(tx + dx, ty + dy) === TILE_ID.ShallowWater) wet = true;
        if (wet) continue;
        checked++;
        let near = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (mossy(tx + dx, ty + dy)) near = true;
        if (!near) stray++;
      }
      expect(stray).toBe(0);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps the seed and the moss when doors close or water appears', () => {
    const m = roomsMap(), t = m.tiles.slice();
    const d = roomOrigin(0, 0);
    t[(d.y + 3) * W + d.x + R] = TILE_ID.DoorClosed;
    const o = roomOrigin(3, 3);
    t[(o.y + 5) * W + o.x + 5] = TILE_ID.ShallowWater;
    const m2 = new TileMap(W, H, t);
    expect(tilesSeed(m2)).toBe(tilesSeed(m));
    const a = make(m, null, true), b = make(new TileMap(W, H, m.tiles.map((v, i) => (i === (d.y + 3) * W + d.x + R ? TILE_ID.DoorClosed : v))), null, true);
    expect(Buffer.from(a.grow).equals(Buffer.from(b.grow))).toBe(true);
  });
});
