import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { MAP_ROWS, parseMap } from './demoMap';
import { inDipMesh } from './dips/shape';
import { WALL_H, heightAt } from './heights';
import { CHUNK, KIND, buildChunk as buildWithKit, chunkGrid, chunksOfTile, flatSurface, type Chunk } from './worldMesh';
import { stoneField } from './stone/field';
import { noMarks } from './stone/place';
import { planSheets } from './stone/plan';

/** `buildChunk` as the view calls it: the stone kit of the map (all laid, the plan of its layout, no marks). */
const buildChunk = (m: TileMap, painted: boolean, cx: number, cz: number): Chunk =>
  buildWithKit(m, painted, cx, cz, { field: stoneField(m), plan: planSheets(m), marks: noMarks() });

/** A triangle: kind, normal, bounding corners, the cell its middle lies in, and whether it is a wall block's front (not a skirt or the foot). */
type T = { t: number; kind: number; normal: number[]; min: number[]; max: number[]; cell: [number, number]; front: boolean; pts: number[][] };

/** Every triangle of the chunk (optionally of one kind), by the index. Laid stone is built block by block, so a cell or a face is many of them. */
function tris(c: Chunk, kind?: number): T[] {
  const w = c.world, out: T[] = [];
  for (let t = 0; t < w.index.length / 3; t++) {
    const i = w.index[t * 3];
    if (kind !== undefined && w.kind[i] !== kind) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], mid = [0, 0, 0], pts: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const j = w.index[t * 3 + k];
      pts.push([w.position[j * 3], w.position[j * 3 + 1], w.position[j * 3 + 2]]);
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], pts[k][a]);
        max[a] = Math.max(max[a], pts[k][a]);
        mid[a] += pts[k][a] / 3;
      }
    }
    out.push({ t, kind: w.kind[i], normal: [w.normal[i * 3], w.normal[i * 3 + 1], w.normal[i * 3 + 2]], min, max, cell: [Math.floor(mid[0]), Math.floor(mid[2])], front: w.kind[i] === KIND.face && w.sheet[i * 3 + 2] >= 0, pts });
  }
  return out;
}
/** The quads of the kinds that are still one quad each (a wall's top, the woodland's ground): two triangles in a row. */
const quads = (c: Chunk, kind: number): T[] => tris(c, kind).filter((_, i) => i % 2 === 0);
/** The floor's tops: the triangles of the floor kind that face up (a block of laid floor may reach over several cells). */
const floorTops = (c: Chunk): T[] => tris(c, KIND.floor).filter((t) => t.normal[1] > 0.9);
/** The ground area (tiles) the triangles cover, seen from above. */
const areaOf = (list: T[]): number => list.reduce((s, { pts: [a, b, d] }) => s + Math.abs((b[0] - a[0]) * (d[2] - a[2]) - (d[0] - a[0]) * (b[2] - a[2])) / 2, 0);
/** Whether one of the triangles lies over the ground point (x, z). */
const over = (list: T[], x: number, z: number): boolean => list.some(({ pts: [a, b, d] }) => {
  const s = (p: number[], q: number[]): number => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
  const k = [s(a, b), s(b, d), s(d, a)];
  return k.every((v) => v >= -1e-9) || k.every((v) => v <= 1e-9);
});
/** The cells of the chunk's box whose middle the floor covers. */
function floorCells(c: Chunk): Set<string> {
  const tops = floorTops(c), out = new Set<string>();
  for (let z = c.min[2]; z < c.max[2]; z++) for (let x = c.min[0]; x < c.max[0]; x++) if (over(tops, x + 0.5, z + 0.5)) out.add(`${x},${z}`);
  return out;
}

const whole = (rows: string[], painted = false) => buildChunk(parseMap(rows), painted, 0, 0);
const mapOf = (w: number, h: number, tiles: number[]) => new TileMap(w, h, Uint8Array.from(tiles));
const SIDES = [[0, 1], [0, -1], [1, 0], [-1, 0]];
/** The fronts of the wall cell (x, z) on the side (dx, dz): they look that way and lie in the cell, at most 0.2 behind its edge. */
const fronts = (list: T[], x: number, z: number, dx: number, dz: number): T[] => list.filter((f) => f.front && f.normal[0] * dx + f.normal[2] * dz > 0.9
  && f.min[0] >= x && f.max[0] <= x + 1 && f.min[2] >= z && f.max[2] <= z + 1
  && (dx !== 0 ? Math.abs(f.min[0] - (x + (dx > 0 ? 1 : 0))) <= 0.2 : Math.abs(f.min[2] - (z + (dz > 0 ? 1 : 0))) <= 0.2));
/** The sides of a wall cell that have fronts, as 'dx,dz'. */
const sidesAt = (c: Chunk, x: number, z: number): string[] => SIDES.filter(([dx, dz]) => fronts(tris(c, KIND.face), x, z, dx, dz).length > 0).map((s) => s.join(','));

/** Brute force: every face of the map must exist exactly where a neighbour is lower, over the wall's whole height. */
function checkFaces(rows: string[]) {
  const map = parseMap(rows);
  const { nx, nz } = chunkGrid(map);
  const faces: T[] = [];
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) faces.push(...tris(buildChunk(map, false, cx, cz), KIND.face).filter((f) => f.front));
  let seen = 0;
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    if (heightAt(map, x, z) !== WALL_H) continue;
    for (const [dx, dz] of SIDES) {
      const lower = heightAt(map, x + dx, z + dz) < WALL_H;
      const n = fronts(faces, x, z, dx, dz);
      expect(n.length > 0, `cell ${x},${z} side ${dx},${dz}`).toBe(lower);
      if (!lower) continue;
      seen += n.length;
      expect(Math.min(...n.map((f) => f.min[1]))).toBe(0);
      expect(Math.max(...n.map((f) => f.max[1]))).toBe(WALL_H);
    }
  }
  expect(faces.length).toBe(seen);
}

describe('buildChunk', () => {
  it('a floor cell is floor at or just below y 0, its tops facing up', () => {
    const q = tris(whole(['.']));
    expect(q.length).toBeGreaterThan(1);
    for (const t of q) {
      expect(t.kind).toBe(KIND.floor);
      for (const a of [0, 2]) { expect(t.min[a]).toBeGreaterThanOrEqual(0); expect(t.max[a]).toBeLessThanOrEqual(1); }
      expect(t.max[1]).toBeLessThanOrEqual(0);
      expect(t.min[1]).toBeGreaterThan(-0.2);
    }
    // the tops cover the cell exactly once, and so do those of a floor of several cells, whose blocks reach from cell to cell
    expect(areaOf(q.filter((t) => t.normal[1] > 0.9))).toBeCloseTo(1, 6);
    const room = whole(['.....', '.....', '.....', '.....']);
    expect(areaOf(floorTops(room))).toBeCloseTo(20, 5);
    expect(floorCells(room).size).toBe(20);
  });

  it('a wall with floor on one side has a top and a face on that side', () => {
    const c = whole(['###', '###', '#.#', '###']);
    expect(sidesAt(c, 1, 1)).toEqual(['0,1']);
    const f = fronts(tris(c, KIND.face), 1, 1, 0, 1);
    expect(Math.min(...f.map((q) => q.min[1]))).toBe(0);
    expect(Math.max(...f.map((q) => q.max[1]))).toBe(WALL_H);
    expect(Math.max(...f.map((q) => q.max[2]))).toBe(2); // the frieze lies in the cell's edge
    const tops = quads(c, KIND.top).filter((q) => q.cell[0] === 1 && q.cell[1] === 1);
    expect(tops.length).toBe(1);
    expect(tops[0].min[1]).toBe(2);
  });

  it('a wall with floor on two and on four sides has a face on each', () => {
    expect(sidesAt(whole(['#..', '#..', '###']), 0, 0)).toEqual(['1,0']); // east only
    expect(sidesAt(whole(['.#.', '.#.', '###']), 1, 0)).toEqual(['1,0', '-1,0']); // west and east
    expect(sidesAt(whole(['...', '.#.', '...']), 1, 1).length).toBe(4);
  });

  it('a wall between walls has a top only', () => {
    const c = whole(['###', '###', '###']);
    expect(tris(c, KIND.face).length).toBe(0);
    expect(quads(c, KIND.top).length).toBe(9);
  });

  it('Wall beside Void and at the map edge has no face', () => {
    const t = TILE_ID;
    const m = mapOf(2, 1, [t.Wall, t.Void]);
    const c = buildChunk(m, false, 0, 0);
    expect(tris(c, KIND.face).length).toBe(0);
    expect(quads(c, KIND.top).length).toBe(2);
    // the outer ring of a walled room faces only inward
    const ring = whole(['###', '#.#', '###']), faces = tris(ring, KIND.face).filter((f) => f.front);
    expect([[1, 0], [0, 1], [2, 1], [1, 2], [0, 0], [2, 2]].map(([x, z]) => sidesAt(ring, x, z).length)).toEqual([1, 1, 1, 1, 0, 0]);
    for (const f of faces) expect(f.normal[0] * (1.5 - (f.min[0] + f.max[0]) / 2) + f.normal[2] * (1.5 - (f.min[2] + f.max[2]) / 2)).toBeGreaterThan(0);
  });

  it('a Void cell has a top', () => {
    const c = buildChunk(mapOf(1, 1, [TILE_ID.Void]), false, 0, 0);
    expect(tris(c).map((q) => q.kind)).toEqual([KIND.top, KIND.top]);
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
    const c = buildChunk(map, false, 0, 0);
    // the inner corner cells (4, 3) and (4, 7) face two sides each
    for (const [x, z] of [[4, 3], [4, 7]]) expect(sidesAt(c, x, z).length, `${x},${z}`).toBe(2);
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

  it('every wall vertex lies in a wall cell, on its edge or just behind it', () => {
    const map = parseMap(MAP_ROWS);
    const w = buildChunk(map, false, 0, 0).world, e = 1e-6;
    let seen = 0;
    for (let i = 0; i < w.count; i++) {
      if (w.kind[i] !== KIND.face) continue;
      seen++;
      const x = w.position[i * 3], z = w.position[i * 3 + 2];
      // the way its face looks: a skirt's light is read in front of its face (`push`), a front and the foot face that way themselves
      const px = w.push[i * 2], pz = w.push[i * 2 + 1], [dx, dz] = px || pz ? [px, pz] : [w.normal[i * 3], w.normal[i * 3 + 2]];
      const onX = Math.abs(dx) > Math.abs(dz), sign = Math.sign(onX ? dx : dz), c = onX ? x : z, other = onX ? z : x;
      // the cell's edge the face looks out of, and how far behind it the vertex lies: along the face's own axis
      const plane = sign > 0 ? Math.ceil(c - e) : Math.floor(c + e), behind = (plane - c) * sign;
      expect(behind, `${x},${z}`).toBeGreaterThanOrEqual(-e);
      expect(behind, `${x},${z}`).toBeLessThan(0.2);
      // behind that edge is a wall, in front of it a lower cell (a vertex on a cell line may belong to the cell on either side of it)
      const wall = sign > 0 ? plane - 1 : plane, front = sign > 0 ? plane : plane - 1;
      const h = (a: number, b: number): number => (onX ? heightAt(map, a, b) : heightAt(map, b, a));
      expect([Math.floor(other + e), Math.floor(other - e)].some((o) => h(wall, o) > 0 && h(front, o) < h(wall, o)), `${x},${z}`).toBe(true);
    }
    expect(seen).toBeGreaterThan(1000);
  });

  it('terrain cells give no quad here', () => {
    const t = TILE_ID;
    for (const tile of [t.ShallowWater, t.DeepWater, t.Lava, t.Chasm]) {
      expect(tris(buildChunk(mapOf(1, 1, [tile]), true, 0, 0)).length, String(tile)).toBe(0);
    }
  });

  it('leaves every flat cell to exactly one mesh', () => {
    const t = TILE_ID;
    const kinds = [t.Floor, t.Floor, t.Floor, t.Wall, t.ShallowWater, t.DeepWater, t.Lava, t.Chasm, t.DoorClosed];
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    const N = 40;
    const map = mapOf(N, N, Array.from({ length: N * N }, () => kinds[Math.floor(rnd() * kinds.length)]));
    // the floor cells of each chunk; a tile change rebuilds the chunks it touches, as the view does
    const { nx, nz } = chunkGrid(map), built = new Map<string, Set<string>>();
    const check = (chunks: [number, number][]) => {
      for (const [cx, cz] of chunks) built.set(`${cx},${cz}`, floorCells(buildChunk(map, false, cx, cz)));
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const has = built.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`)!.has(`${x},${z}`);
        if (heightAt(map, x, z) !== 0) { expect(has, `wall ${x},${z}`).toBe(false); continue; }
        expect(has !== inDipMesh(map, x, z), `cell ${x},${z}`).toBe(true);
      }
    };
    check(Array.from({ length: nx * nz }, (_, i) => [i % nx, Math.floor(i / nx)]));
    for (const [x, z] of [[10, 10], [15, 16], [0, 0], [39, 39], [20, 5]]) {
      const was = map.get(x, z), near = chunksOfTile(map, x, z);
      map.set(x, z, t.Floor); check(near);
      map.set(x, z, t.Chasm); check(near);
      map.set(x, z, t.Floor); check(near);
      map.set(x, z, was); check(near);
    }
  });

  it('flatSurface gives a sheet floor, or the painted ground', () => {
    const t = TILE_ID;
    const m = mapOf(3, 1, [t.Floor, t.Chasm, t.Road]);
    expect(flatSurface(m, false, 0, 0)).toEqual({ kind: KIND.floor, u0: 0, v0: 0 });
    expect(flatSurface(m, true, 1, 0).kind).toBe(KIND.floor);
    expect(flatSurface(m, true, 2, 0)).toEqual({ kind: KIND.ground, u0: 32, v0: 0 });
    expect(flatSurface(m, false, 2, 0).kind).toBe(KIND.floor);
    // a painted map's water is ground too: the pond's bank and bed are painted (#360); lava and a chasm stay stone
    const w = mapOf(3, 1, [t.ShallowWater, t.DeepWater, t.Lava]);
    expect(flatSurface(w, true, 0, 0)).toEqual({ kind: KIND.ground, u0: 0, v0: 0 });
    expect(flatSurface(w, true, 1, 0)).toEqual({ kind: KIND.ground, u0: 16, v0: 0 });
    expect(flatSurface(w, true, 2, 0).kind).toBe(KIND.floor);
    expect(flatSurface(w, false, 0, 0).kind).toBe(KIND.floor);
  });

  it('DoorClosed and DoorOpen are floor', () => {
    const c = buildChunk(mapOf(2, 1, [TILE_ID.DoorClosed, TILE_ID.DoorOpen]), false, 0, 0);
    expect(tris(c).every((t) => t.kind === KIND.floor)).toBe(true);
    expect(floorCells(c)).toEqual(new Set(['0,0', '1,0']));
  });

  it('woodland cells and Barrier give ground quads', () => {
    const t = TILE_ID;
    const m = mapOf(5, 1, [t.Floor, t.Road, t.Thicket, t.Trunk, t.Barrier]);
    const c = buildChunk(m, true, 0, 0);
    expect(tris(c).every((x) => x.kind === KIND.ground)).toBe(true);
    const q = quads(c, KIND.ground);
    expect(q.length).toBe(5);
    const i = q.find((x) => x.cell[0] === 3)!.t * 3;
    const uvs: number[][] = [];
    for (let j = i; j < i + 6; j++) uvs.push([c.world.uv[j * 2], c.world.uv[j * 2 + 1]]);
    expect(Math.min(...uvs.map((u) => u[0]))).toBe(48);
    expect(Math.max(...uvs.map((u) => u[0]))).toBe(64);
    expect(Math.min(...uvs.map((u) => u[1]))).toBe(0);
    expect(Math.max(...uvs.map((u) => u[1]))).toBe(16);
    const plain = buildChunk(m, false, 0, 0);
    expect(tris(plain).every((x) => x.kind === KIND.floor)).toBe(true);
    expect(floorCells(plain).size).toBe(5);
  });

  it('a face whose neighbour is in the next chunk is built by the chunk of the wall', () => {
    const w = 32, tiles = new Array<number>(w).fill(TILE_ID.Floor);
    tiles[15] = TILE_ID.Wall;
    const m = mapOf(w, 1, tiles);
    const c0 = buildChunk(m, false, 0, 0);
    const east = fronts(tris(c0, KIND.face), 15, 0, 1, 0);
    expect(east.length).toBeGreaterThan(0);
    expect(Math.max(...east.map((f) => f.max[0]))).toBe(16);
    const c1 = buildChunk(m, false, 1, 0);
    expect(tris(c1, KIND.face).length).toBe(0);
    expect(floorCells(c1).size).toBe(16);
  });

  it('edge chunks are narrower', () => {
    const m = mapOf(20, 5, new Array(100).fill(TILE_ID.Floor));
    expect(chunkGrid(m)).toEqual({ nx: 2, nz: 1 });
    const c = buildChunk(m, false, 1, 0);
    expect(floorCells(c).size).toBe(20);
    expect(areaOf(floorTops(c))).toBeCloseTo(20, 5);
    expect(c.max[0]).toBe(20);
    expect(c.min[0]).toBe(16);
    expect(c.max[2]).toBe(5);
    expect(c.max[1]).toBe(WALL_H);
    expect(c.min[1]).toBeLessThan(0); // floors lie at or below 0, a grate's shaft deepest
    for (let i = 0; i < c.world.count; i++) {
      expect(c.world.position[i * 3]).toBeLessThanOrEqual(20);
      expect(c.world.position[i * 3 + 2]).toBeLessThanOrEqual(5);
      expect(c.world.position[i * 3 + 1]).toBeGreaterThanOrEqual(c.min[1]);
    }
    const small = mapOf(3, 3, new Array(9).fill(TILE_ID.Floor));
    expect(chunkGrid(small)).toEqual({ nx: 1, nz: 1 });
    expect(floorCells(buildChunk(small, false, 0, 0)).size).toBe(9);
    expect(CHUNK).toBe(16);
  });

  it('winds every triangle counter-clockwise seen from its normal side', () => {
    const w = buildChunk(parseMap(MAP_ROWS), false, 0, 0).world;
    const p = (i: number) => [w.position[i * 3], w.position[i * 3 + 1], w.position[i * 3 + 2]];
    expect(w.index.length).toBeGreaterThan(3000);
    for (let t = 0; t < w.index.length / 3; t++) {
      const [a, b, c] = [p(w.index[t * 3]), p(w.index[t * 3 + 1]), p(w.index[t * 3 + 2])];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = w.index[t * 3];
      expect(cr[0] * w.normal[n * 3] + cr[1] * w.normal[n * 3 + 1] + cr[2] * w.normal[n * 3 + 2]).toBeGreaterThan(0);
    }
  });

  it('gives every vertex the stone attributes: the woodland ground has layer -1 and zero uv on stone vertices', () => {
    const t = TILE_ID;
    const m = mapOf(3, 1, [t.Floor, t.Wall, t.Void]);
    const w = buildChunk(m, true, 0, 0).world;
    expect(w.sheet.length).toBe(w.count * 3);
    expect(w.faceA.length).toBe(w.count * 3);
    expect(w.faceB.length).toBe(w.count * 3);
    expect(w.push.length).toBe(w.count * 2);
    // every index names a vertex, and the stone's (after the ground's one quad of six) share theirs
    expect(w.index.length % 3).toBe(0);
    expect(Math.max(...w.index)).toBe(w.count - 1);
    expect(Array.from(w.index.slice(0, 6))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(w.index.length).toBeGreaterThan(w.count);
    for (let i = 0; i < w.count; i++) {
      if (w.kind[i] === KIND.ground) {
        expect(w.sheet[i * 3 + 2]).toBe(-1);
      } else {
        expect(w.uv[i * 2]).toBe(0);
      }
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

