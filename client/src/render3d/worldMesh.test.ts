import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { MAP_ROWS, parseMap } from './demoMap';
import { WALL_H, heightAt } from './heights';
import { CHUNK, KIND, buildChunk, chunkGrid, chunksOfTile, faceFrame, floorFrame, tileHash, type Chunk, type FrameRects } from './worldMesh';

const NAMES = [
  'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7', 'floor_8',
  'wall_mid', 'wall_hole_1', 'wall_hole_2', 'wall_goo',
  'wall_banner_red', 'wall_banner_blue', 'wall_banner_green', 'wall_banner_yellow',
];
const frames: FrameRects = {};
NAMES.forEach((n, i) => { frames[n] = { x: 100 + i * 16, y: 200 + i * 32, w: 16, h: 16 }; });

type Q = { q: number; kind: number; normal: number[]; min: number[]; max: number[] };

/** Every quad of the chunk (optionally of one kind): kind, normal and bounding corners. */
function quads(c: Chunk, kind?: number): Q[] {
  const w = c.world, out: Q[] = [];
  for (let q = 0; q < w.count / 6; q++) {
    const i = q * 6;
    if (kind !== undefined && w.kind[i] !== kind) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let j = i; j < i + 6; j++) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], w.position[j * 3 + a]);
      max[a] = Math.max(max[a], w.position[j * 3 + a]);
    }
    out.push({ q, kind: w.kind[i], normal: [w.normal[i * 3], w.normal[i * 3 + 1], w.normal[i * 3 + 2]], min, max });
  }
  return out;
}

const whole = (rows: string[], painted = false) => buildChunk(parseMap(rows), painted, 0, 0, frames);
const mapOf = (w: number, h: number, tiles: number[]) => new TileMap(w, h, Uint8Array.from(tiles));
const faceAt = (c: Chunk, x: number, z: number) => quads(c, KIND.face).filter((f) => f.min[0] >= x && f.max[0] <= x + 1 && f.min[2] >= z && f.max[2] <= z + 1);

/** Brute force: every face of the map must exist exactly where a neighbour is lower, 2 quads each, on the side plane. */
function checkFaces(rows: string[]) {
  const map = parseMap(rows);
  const { nx, nz } = chunkGrid(map);
  const faces: Q[] = [];
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) faces.push(...quads(buildChunk(map, false, cx, cz, frames), KIND.face));
  let exposed = 0;
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    if (heightAt(map, x, z) !== WALL_H) continue;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const lower = heightAt(map, x + dx, z + dz) < WALL_H;
      const n = faces.filter((f) => f.normal[0] === dx && f.normal[2] === dz && f.min[0] >= x && f.max[0] <= x + 1 && f.min[2] >= z && f.max[2] <= z + 1
        && (dx !== 0 ? f.min[0] === x + (dx > 0 ? 1 : 0) && f.max[0] === f.min[0] : f.min[2] === z + (dz > 0 ? 1 : 0) && f.max[2] === f.min[2]));
      expect(n.length, `cell ${x},${z} side ${dx},${dz}`).toBe(lower ? 2 : 0);
      if (lower) exposed++;
    }
  }
  expect(faces.length).toBe(2 * exposed);
}

describe('buildChunk', () => {
  it('a floor cell is one floor quad at y 0 with normal (0, 1, 0)', () => {
    const c = whole(['.']);
    const q = quads(c);
    expect(q.length).toBe(1);
    expect(q[0].kind).toBe(KIND.floor);
    expect(q[0].normal).toEqual([0, 1, 0]);
    expect(q[0].min).toEqual([0, 0, 0]);
    expect(q[0].max).toEqual([1, 0, 1]);
  });

  it('a wall with floor on one side has a top and 2 face quads on that side', () => {
    const c = whole(['###', '###', '#.#', '###']);
    const f = faceAt(c, 1, 1);
    expect(f.length).toBe(2);
    for (const q of f) {
      expect(q.normal).toEqual([0, 0, 1]);
      expect(q.min[2]).toBe(2);
      expect(q.max[2]).toBe(2);
    }
    expect(f.map((q) => [q.min[1], q.max[1]]).sort()).toEqual([[0, 1], [1, 2]]);
    const tops = quads(c, KIND.top).filter((q) => q.min[0] === 1 && q.min[2] === 1);
    expect(tops.length).toBe(1);
    expect(tops[0].min[1]).toBe(2);
  });

  it('a wall with floor on two and on four sides has 4 and 8 face quads', () => {
    expect(faceAt(whole(['#..', '#..', '###']), 0, 0).length).toBe(2); // east only
    expect(faceAt(whole(['.#.', '.#.', '###']), 1, 0).length).toBe(4); // west and east
    expect(faceAt(whole(['...', '.#.', '...']), 1, 1).length).toBe(8);
  });

  it('a wall between walls has a top only', () => {
    const c = whole(['###', '###', '###']);
    expect(quads(c, KIND.face).length).toBe(0);
    expect(quads(c, KIND.top).length).toBe(9);
  });

  it('Wall beside Void and at the map edge has no face', () => {
    const t = TILE_ID;
    const m = mapOf(2, 1, [t.Wall, t.Void]);
    const c = buildChunk(m, false, 0, 0, frames);
    expect(quads(c, KIND.face).length).toBe(0);
    expect(quads(c, KIND.top).length).toBe(2);
    // the outer ring of a walled room faces only inward
    const ring = whole(['###', '#.#', '###']);
    const faces = quads(ring, KIND.face);
    expect(faces.length).toBe(8);
    for (const f of faces) {
      for (const q of [f.min, f.max]) {
        expect(q[0] >= 1 && q[0] <= 2 && q[2] >= 1 && q[2] <= 2).toBe(true);
      }
    }
  });

  it('a Void cell has a top', () => {
    const c = buildChunk(mapOf(1, 1, [TILE_ID.Void]), false, 0, 0, frames);
    expect(quads(c).map((q) => q.kind)).toEqual([KIND.top]);
  });

  it('a corridor junction has faces exactly on exposed sides', () => {
    const rows = [
      '#########',
      '#########',
      '#...#####',
      '#...#####',
      '#.......#',
      '#.......#',
      '#.......#',
      '#...#####',
      '#...#####',
      '#########',
    ];
    const map = parseMap(rows);
    const c = buildChunk(map, false, 0, 0, frames);
    // the inner corner cells (4, 3) and (4, 7) face two sides each, 2 quads per side
    for (const [x, z] of [[4, 3], [4, 7]]) {
      const sides = new Set(faceAt(c, x, z).map((f) => f.normal.join(',')));
      expect(sides.size, `${x},${z}`).toBe(2);
      expect(faceAt(c, x, z).length).toBe(4);
    }
    checkFaces(rows);
  });

  it('a room corner and a corridor mouth give faces where the neighbour is lower', () => {
    checkFaces([
      '###########',
      '#.....#####',
      '#.....#####',
      '#.....#####',
      '#..........',
      '#..........',
      '#..........',
      '#.....#####',
      '###########',
    ]);
    checkFaces(MAP_ROWS);
  });

  it('every face corner lies on its side plane', () => {
    const map = parseMap(MAP_ROWS);
    const c = buildChunk(map, false, 0, 0, frames);
    for (const f of quads(c, KIND.face)) {
      const a = f.normal[0] !== 0 ? 0 : 2;
      expect(f.min[a]).toBe(f.max[a]);
      expect(Number.isInteger(f.min[a])).toBe(true);
    }
  });

  it('terrain cells give no quad here', () => {
    const t = TILE_ID;
    for (const tile of [t.ShallowWater, t.DeepWater, t.Lava, t.Chasm]) {
      expect(quads(buildChunk(mapOf(1, 1, [tile]), true, 0, 0, frames)).length, String(tile)).toBe(0);
    }
  });

  it('DoorClosed and DoorOpen are floor', () => {
    const c = buildChunk(mapOf(2, 1, [TILE_ID.DoorClosed, TILE_ID.DoorOpen]), false, 0, 0, frames);
    expect(quads(c).map((q) => q.kind)).toEqual([KIND.floor, KIND.floor]);
  });

  it('woodland cells and Barrier give ground quads', () => {
    const t = TILE_ID;
    const m = mapOf(5, 1, [t.Floor, t.Road, t.Thicket, t.Trunk, t.Barrier]);
    const c = buildChunk(m, true, 0, 0, frames);
    const q = quads(c);
    expect(q.length).toBe(5);
    for (const x of q) expect(x.kind).toBe(KIND.ground);
    const i = q.find((x) => x.min[0] === 3)!.q * 6;
    const uvs: number[][] = [];
    for (let j = i; j < i + 6; j++) uvs.push([c.world.uv[j * 2], c.world.uv[j * 2 + 1]]);
    expect(Math.min(...uvs.map((u) => u[0]))).toBe(48);
    expect(Math.max(...uvs.map((u) => u[0]))).toBe(64);
    expect(Math.min(...uvs.map((u) => u[1]))).toBe(0);
    expect(Math.max(...uvs.map((u) => u[1]))).toBe(16);
    for (let j = i; j < i + 6; j++) expect([...c.world.rect.slice(j * 4, j * 4 + 4)]).toEqual([0, 0, 80, 16]);
    const plain = buildChunk(m, false, 0, 0, frames);
    expect(quads(plain).map((x) => x.kind)).toEqual([0, 0, 0, 0, 0]);
  });

  it('a face whose neighbour is in the next chunk is built by the chunk of the wall', () => {
    const w = 32, tiles = new Array<number>(w).fill(TILE_ID.Floor);
    tiles[15] = TILE_ID.Wall;
    const m = mapOf(w, 1, tiles);
    const c0 = buildChunk(m, false, 0, 0, frames);
    const east = quads(c0, KIND.face).filter((f) => f.normal[0] === 1);
    expect(east.length).toBe(2);
    expect(east[0].min[0]).toBe(16);
    const c1 = buildChunk(m, false, 1, 0, frames);
    expect(quads(c1, KIND.face).length).toBe(0);
    expect(quads(c1, KIND.floor).length).toBe(16);
  });

  it('edge chunks are narrower', () => {
    const m = mapOf(20, 5, new Array(100).fill(TILE_ID.Floor));
    expect(chunkGrid(m)).toEqual({ nx: 2, nz: 1 });
    const c = buildChunk(m, false, 1, 0, frames);
    expect(quads(c).length).toBe(20);
    expect(c.max[0]).toBe(20);
    expect(c.min[0]).toBe(16);
    expect(c.max[2]).toBe(5);
    expect(c.max[1]).toBe(WALL_H);
    for (let i = 0; i < c.world.count; i++) {
      expect(c.world.position[i * 3]).toBeLessThanOrEqual(20);
      expect(c.world.position[i * 3 + 2]).toBeLessThanOrEqual(5);
    }
    const small = mapOf(3, 3, new Array(9).fill(TILE_ID.Floor));
    expect(chunkGrid(small)).toEqual({ nx: 1, nz: 1 });
    expect(quads(buildChunk(small, false, 0, 0, frames)).length).toBe(9);
    expect(CHUNK).toBe(16);
  });

  it('winds every triangle counter-clockwise seen from its normal side and keeps uvs in their rect', () => {
    const w = buildChunk(parseMap(MAP_ROWS), false, 0, 0, frames).world;
    const p = (i: number) => [w.position[i * 3], w.position[i * 3 + 1], w.position[i * 3 + 2]];
    for (let t = 0; t < w.count / 3; t++) {
      const [a, b, c] = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = t * 3;
      expect(cr[0] * w.normal[n * 3] + cr[1] * w.normal[n * 3 + 1] + cr[2] * w.normal[n * 3 + 2]).toBeGreaterThan(0);
    }
    for (let i = 0; i < w.count; i++) {
      if (w.kind[i] === KIND.top) continue;
      const [rx, ry, rw, rh] = [w.rect[i * 4], w.rect[i * 4 + 1], w.rect[i * 4 + 2], w.rect[i * 4 + 3]];
      const u = w.uv[i * 2], v = w.uv[i * 2 + 1];
      expect(u >= rx && u <= rx + rw && v >= ry && v <= ry + rh).toBe(true);
    }
  });

  it('puts the frame top row of a face at the top and spans 16 px per tile', () => {
    const c = whole(['###', '#.#', '###']);
    for (const f of quads(c, KIND.face)) {
      const w = c.world;
      let vt = Infinity, vb = -Infinity;
      for (let i = f.q * 6; i < f.q * 6 + 6; i++) {
        const y = w.position[i * 3 + 1], v = w.uv[i * 2 + 1];
        if (y === f.max[1]) vt = v; else vb = v;
      }
      expect(vb - vt).toBe(16);
    }
  });
});

describe('chunksOfTile', () => {
  const big = { w: 48, h: 48 };
  const set = (l: [number, number][]) => l.map((c) => c.join(',')).sort();
  it('lists the own chunk and differing neighbours without duplicates', () => {
    expect(chunksOfTile(big, 20, 20)).toEqual([[1, 1]]);
    expect(set(chunksOfTile(big, 16, 20))).toEqual(set([[1, 1], [0, 1]]));
    expect(set(chunksOfTile(big, 16, 16))).toEqual(set([[1, 1], [0, 1], [1, 0], [0, 0]]));
    expect(chunksOfTile(big, 0, 0)).toEqual([[0, 0]]);
    expect(set(chunksOfTile(big, 47, 47))).toEqual(set([[2, 2]]));
    expect(set(chunksOfTile(big, 15, 15))).toEqual(set([[0, 0], [1, 0], [0, 1], [1, 1]]));
  });
});

describe('frames', () => {
  it('floorFrame and faceFrame are stable and in their shares', () => {
    const N = 20000;
    let f1 = 0, lowerOdd = 0, banner = 0, plainOdd = 0;
    for (let i = 0; i < N; i++) {
      const x = i % 200, z = Math.floor(i / 200);
      expect(floorFrame(x, z)).toBe(floorFrame(x, z));
      if (floorFrame(x, z) === 'floor_1') f1++;
      else expect(/^floor_[2-8]$/.test(floorFrame(x, z))).toBe(true);
      const side = i % 4;
      if (faceFrame(x, z, side, 0, true) !== 'wall_mid') lowerOdd++;
      if (faceFrame(x, z, side, 1, true).startsWith('wall_banner')) banner++;
      if (faceFrame(x, z, side, 0, false) !== 'wall_mid' || faceFrame(x, z, side, 1, false) !== 'wall_mid') plainOdd++;
    }
    expect(f1 / N).toBeGreaterThan(0.92);
    expect(f1 / N).toBeLessThan(0.94);
    expect(lowerOdd / N).toBeGreaterThan(0.05);
    expect(lowerOdd / N).toBeLessThan(0.07);
    expect(banner / N).toBeGreaterThan(0.01);
    expect(banner / N).toBeLessThan(0.02);
    expect(plainOdd).toBe(0);
  });

  it('tileHash is in [0, 1) and deterministic', () => {
    for (let i = 0; i < 100; i++) {
      const h = tileHash(i, i * 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(h).toBe(tileHash(i, i * 3));
    }
  });
});
