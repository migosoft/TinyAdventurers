import { describe, expect, it } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { inDipMesh } from '../dips/shape';
import { WALL_H, heightAt } from '../heights';
import { LEVEL_STEP, floorBlockAt, ironPx, type Block } from './blocks';
import { GRATE_DEPTH } from './laidMesh';
import { FACE_H, FACE_W, FLAG, PAGE, decodeRelief } from './format';
import { paintGroundRows } from './paint';
import { CHUNK, KIND } from './grid';
import { stoneField } from './field';
import { buildStoneChunk, type StoneArrays } from './mesh';
import { noMarks, placeMarks, type Marks } from './place';
import { planSheets } from './plan';
import { floorHeight } from './shape';
import { STONE_SEED, STONE_SPAWN, TORCH_TILES, stoneMap, zoneKinds } from './stoneMap';

/** The most triangles a chunk of 16 by 16 cells of laid floor may have (measured: 6 022, 24 a cell; the flat floor had 512). */
const LAID_CHUNK_TRIS = 6600;
/**
 * The same for the stone page's chunks with a floor piece, each with a crevice's groove in its room: the mosaic and a grate (measured:
 * 9 946, of them 1 014 the groove), and the circle, whose dark rings lie a step lower (measured: 13 873, of them 880 the groove; 7 843
 * with level rings and a painted crevice).
 */
const PIECE_CHUNK_TRIS = 10900, CIRCLE_CHUNK_TRIS = 15200;
/** The most triangles a crevice of two pieces and a branch, 9 tiles of line, may add to a chunk of laid floor (measured: 3 888). */
const CREVICE_TRIS = 4300;
/** What the mosaic's chunk measures: 8 914 for the laid stone, 18 more for the grate's wider shaft and its iron, 1 014 for the crevice's groove. The mesh of laid stone has not moved. */
const MOSAIC_CHUNK_TRIS = 9946;
/**
 * The most triangles a chunk of the stone page's caves may have (measured: 3 877, 5 238 with the passage's laid half, 4 830 and 3 834), and the
 * whole page of ten chunks as rock (measured: 25 335; as laid stone it has 59 215).
 */
const ROCK_CHUNK_TRIS = 5800, ROCK_PAGE_TRIS = 28000;

/** A 3 by 3 floor with a wall in the middle. */
function ring() {
  const m = new TileMap(3, 3, new Uint8Array(9).fill(TILE_ID.Floor));
  m.set(1, 1, TILE_ID.Wall);
  return m;
}
const floorMap = (w: number, h: number): TileMap => new TileMap(w, h, new Uint8Array(w * h).fill(TILE_ID.Floor));
const SEED = 7;
const build = (m: TileMap, cx = 0, cz = 0, marks: Marks = noMarks()): { a: StoneArrays; plan: ReturnType<typeof planSheets> } => {
  const plan = planSheets(m);
  return { a: buildStoneChunk(m, stoneField(m, null, SEED), plan, marks, cx, cz), plan };
};
type V = { p: number[]; n: number[]; sheet: number[]; A: number[]; B: number[]; kind: number; push: number[] };
const vertex = (a: StoneArrays, i: number): V => ({
  push: [a.push[i * 2], a.push[i * 2 + 1]],
  p: [a.position[i * 3], a.position[i * 3 + 1], a.position[i * 3 + 2]], n: [a.normal[i * 3], a.normal[i * 3 + 1], a.normal[i * 3 + 2]],
  sheet: [a.sheet[i * 3], a.sheet[i * 3 + 1], a.sheet[i * 3 + 2]], A: [a.faceA[i * 3], a.faceA[i * 3 + 1], a.faceA[i * 3 + 2]], B: [a.faceB[i * 3], a.faceB[i * 3 + 1], a.faceB[i * 3 + 2]],
  kind: a.kind[i],
});
const vertices = (a: StoneArrays): V[] => Array.from({ length: a.count }, (_, i) => vertex(a, i));
const triangles = (a: StoneArrays): V[][] => Array.from({ length: a.index.length / 3 }, (_, t) => [vertex(a, a.index[t * 3]), vertex(a, a.index[t * 3 + 1]), vertex(a, a.index[t * 3 + 2])]);

/** The stone page's level with its marks (a circle, a mosaic, a grate, a chasm), all laid; built once for the file (no test changes it). */
let level: ReturnType<typeof makeLevel> | undefined;
function makeLevel() {
  const map = stoneMap(), f = stoneField(map, null, STONE_SEED);
  const marks = placeMarks(map, f, { lights: TORCH_TILES.map(([x, y], i) => ({ id: i + 1, kind: LIGHT_KIND.Torch, x, y })), spawn: STONE_SPAWN });
  const plan = planSheets(map);
  return { map, f, marks, chunk: (cx: number, cz: number): StoneArrays => buildStoneChunk(map, f, plan, marks, cx, cz) };
}
const stoneLevel = () => (level ??= makeLevel());

describe('buildStoneChunk', () => {
  it('builds triangles wound to their normals, a flat top on a wall and nothing but stone kinds', () => {
    const { a } = build(ring());
    expect(a.index.length % 3).toBe(0);
    expect(a.count).toBeLessThan(a.index.length); // the triangles of a flat piece share their vertices
    expect(Math.max(...a.index)).toBe(a.count - 1);
    expect(Array.from(a.push).every((x) => Math.abs(x) < 0.5)).toBe(true);
    for (const t of triangles(a)) {
      const [p, q, r] = t.map((v) => v.p), e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      expect(c[0] * t[0].n[0] + c[1] * t[0].n[1] + c[2] * t[0].n[2]).toBeGreaterThan(0);
      expect(Math.hypot(...t[0].n)).toBeCloseTo(1, 5);
    }
    // the top: one quad at y = WALL_H over the cell (1, 1), normal up
    const top = vertices(a).filter((v) => v.kind === KIND.top);
    expect(top.length).toBe(4);
    for (const v of top) {
      expect(v.p[1]).toBe(WALL_H);
      expect(v.n).toEqual([0, 1, 0]);
    }
  });

  it('lets no floor vertex rise above 0 and no wall vertex leave its cell', () => {
    const { a } = build(ring());
    let floors = 0, faces = 0;
    for (const v of vertices(a)) {
      if (v.kind === KIND.floor) { floors++; expect(v.p[1]).toBeLessThanOrEqual(0); expect(v.p[1]).toBeGreaterThan(-0.2); }
      if (v.kind !== KIND.face) continue;
      faces++;
      for (const c of [v.p[0], v.p[2]]) { expect(c).toBeGreaterThanOrEqual(1); expect(c).toBeLessThanOrEqual(2); }
      expect(v.p[1]).toBeLessThanOrEqual(WALL_H);
    }
    expect(floors).toBeGreaterThan(100);
    expect(faces).toBeGreaterThan(100);
    // the stone page's level: walls in rows, inner corners, a grate, pieces and a chasm
    const { map, chunk } = stoneLevel();
    let low = 0;
    for (const [cx, cz] of [[2, 0], [3, 0], [2, 1]]) for (const v of vertices(chunk(cx, cz))) {
      if (v.kind === KIND.floor) { expect(v.p[1]).toBeLessThanOrEqual(0); low = Math.min(low, v.p[1]); }
      if (v.kind !== KIND.face) continue;
      // one of the cells the point touches is a wall
      const e = 1e-6;
      expect([[e, e], [-e, e], [e, -e], [-e, -e]].some(([dx, dz]) => heightAt(map, Math.floor(v.p[0] + dx), Math.floor(v.p[2] + dz)) > 0)).toBe(true);
    }
    expect(low).toBeLessThan(-0.2); // the grate's shaft
  });

  it('draws a wall\'s foot below 0 only beside laid floor: the dip mesh has its own skirt in that plane', () => {
    // a wall over a chasm at x = 1, and a wall over plain floor at x = 5
    const m = floorMap(7, 3);
    m.set(1, 0, TILE_ID.Wall); m.set(1, 1, TILE_ID.Chasm); m.set(5, 0, TILE_ID.Wall);
    const faces = vertices(build(m).a).filter((v) => v.kind === KIND.face);
    expect(Math.min(...faces.filter((v) => v.p[0] <= 2).map((v) => v.p[1]))).toBe(0);
    expect(Math.min(...faces.filter((v) => v.p[0] >= 5).map((v) => v.p[1]))).toBeLessThan(0);
  });

  it('gives a higher block a skirt that faces the lower one beside it', () => {
    const m = floorMap(16, 16), f = stoneField(m, null, SEED), none = noMarks();
    const tris = triangles(build(m).a);
    const lowest = (b: Block): number => (b.level - 1) * LEVEL_STEP - Math.abs(b.tilt[0]) * (b.u1 - b.u0) - Math.abs(b.tilt[1]) * (b.v1 - b.v0);
    let pairs = 0;
    for (let v = 3; v < 500; v += 5) for (let u = 3; u < 500; u++) {
      const l = floorBlockAt(f, m, none, u, v)!, r = floorBlockAt(f, m, none, u + 1, v)!;
      if (l.id === r.id) continue;
      // one of the two lies wholly above the other's level: `hi` and `lo`, and the x the skirt must face
      const [hi, lo, nx] = lowest(l) > (r.level - 1) * LEVEL_STEP ? [l, r, 1] : lowest(r) > (l.level - 1) * LEVEL_STEP ? [r, l, -1] : [null, null, 0];
      if (!hi || !lo) continue;
      pairs++;
      const x = (u + 1) / 32, z = (v + 0.5) / 32;
      const skirt = tris.filter((t) => t[0].n[0] === nx && t.every((c) => Math.abs(c.p[0] - x) < 1e-6) && Math.min(...t.map((c) => c.p[2])) <= z && Math.max(...t.map((c) => c.p[2])) >= z).flat();
      expect(skirt.length, `skirt at px ${u + 1},${v}`).toBeGreaterThan(0);
      // it reaches from the higher block's edge down to the lower one's, and is the floor's kind
      expect(skirt[0].kind).toBe(KIND.floor);
      expect(Math.max(...skirt.map((c) => c.p[1]))).toBeGreaterThanOrEqual(lowest(hi) - 1e-6);
      expect(Math.min(...skirt.map((c) => c.p[1]))).toBeLessThanOrEqual((lo.level - 1) * LEVEL_STEP + 1e-6);
    }
    expect(pairs).toBeGreaterThan(30);
  });

  it('leaves no gap between cells and chunks: every edge of the floor has a twin', () => {
    const edgesOf = (list: StoneArrays[]): Map<string, number> => {
      const edges = new Map<string, number>(), key = (p: number[]): string => p.map((c) => Math.round(c * 1e5)).join(',');
      for (const a of list) for (const t of triangles(a)) {
        if (t[0].kind !== KIND.floor) continue;
        for (let i = 0; i < 3; i++) {
          const k = [key(t[i].p), key(t[(i + 1) % 3].p)].sort().join(' ');
          edges.set(k, (edges.get(k) ?? 0) + 1);
        }
      }
      return edges;
    };
    // two chunks of open floor: an edge without a twin lies on the map's border
    const m = floorMap(32, 16), plan = planSheets(m), f = stoneField(m, null, SEED);
    let open = 0;
    for (const [k, n] of edgesOf([0, 1].map((cx) => buildStoneChunk(m, f, plan, noMarks(), cx, 0)))) {
      if (n % 2 === 0) continue;
      open++;
      const [p, q] = k.split(' ').map((s) => s.split(',').map((c) => Number(c) / 1e5));
      expect((p[0] === q[0] && (p[0] === 0 || p[0] === 32)) || (p[2] === q[2] && (p[2] === 0 || p[2] === 16)), `open edge ${k}`).toBe(true);
    }
    expect(open).toBeGreaterThan(96);
    // round the circle, the mosaic and the grate: the same, away from walls, the dip mesh and the chunks not built here
    const { map, marks, chunk } = stoneLevel();
    expect(marks.grates.length).toBeGreaterThan(0);
    for (const [k, n] of edgesOf([[2, 0], [3, 0], [2, 1], [3, 1]].map(([cx, cz]) => chunk(cx, cz)))) {
      if (n % 2 === 0) continue;
      const [p, q] = k.split(' ').map((s) => s.split(',').map((c) => Number(c) / 1e5));
      const x = (p[0] + q[0]) / 2, z = (p[2] + q[2]) / 2, e = 1e-3;
      if (marks.grates.some((g) => Math.abs(x - g.x) < 0.5 && Math.abs(z - g.z) < 0.5) && p[1] < -LEVEL_STEP - 0.01 && q[1] < -LEVEL_STEP - 0.01) continue; // a bar's end and underside, in the shaft below the flush floor
      const other = [[e, e], [-e, e], [e, -e], [-e, -e]].some(([dx, dz]) => heightAt(map, Math.floor(x + dx), Math.floor(z + dz)) > 0 || inDipMesh(map, Math.floor(x + dx), Math.floor(z + dz)));
      expect(other || x < 32 + e || x > 64 - e, `open edge ${k}`).toBe(true);
    }
  });

  it(`keeps a chunk of laid floor under ${LAID_CHUNK_TRIS} triangles`, () => {
    const { a } = build(floorMap(16, 16));
    expect(a.index.length / 3).toBeLessThan(LAID_CHUNK_TRIS);
    expect(a.index.length / 3).toBeGreaterThan(16 * 16 * 2); // blocks, not one quad a cell
    // the stone page's chunks with the mosaic and a grate, and with the circle
    expect(stoneLevel().chunk(3, 0).index.length / 3).toBeLessThan(PIECE_CHUNK_TRIS);
    expect(stoneLevel().chunk(2, 1).index.length / 3).toBeLessThan(CIRCLE_CHUNK_TRIS);
  });

  it('lays the ground under a floor piece level: every stone at its piece\'s level, only a circle\'s dark rings a step lower', () => {
    const { map, f, marks } = stoneLevel();
    expect(marks.pieces.map((p) => p.kind).sort()).toEqual(['circle', 'mosaic']);
    const bad: string[] = []; // px whose level, tilt or height is wrong
    for (const p of marks.pieces) {
      const cu = p.x * 32, cv = p.z * 32, R = p.r * 32;
      let low = 0, high = 0;
      for (let v = Math.floor(cv - R) - 2; v < cv + R + 2; v++) for (let u = Math.floor(cu - R) - 2; u < cu + R + 2; u++) {
        if (Math.hypot(u + 0.5 - cu, v + 0.5 - cv) >= R + 1) continue;
        const b = floorBlockAt(f, map, marks, u, v)!, dark = p.kind === 'circle' && b.piece !== undefined && b.stone === 1;
        // (the stone page's pieces lie away from dips: the piece's level is flush; so is every slab that touches it)
        if (b.level !== (dark ? -1 : 0) || b.tilt[0] !== 0 || b.tilt[1] !== 0 || Math.abs(floorHeight(f, map, marks, (u + 0.5) / 32, (v + 0.5) / 32) - (b.level - 1) * LEVEL_STEP) > 5e-7) bad.push(`${u},${v}`);
        if (dark) low++; else if (b.piece) high++;
      }
      expect(high).toBeGreaterThan(1000);
      expect(low > 1000).toBe(p.kind === 'circle');
    }
    expect(bad).toEqual([]);
  });

  it('cuts no stone of a floor piece by a slab outside it: inside a piece every top is level, and a step lies only between two rings', () => {
    const { map, f, marks, chunk } = stoneLevel();
    let tops = 0, steps = 0;
    for (const p of marks.pieces) for (const t of triangles(chunk(Math.floor(p.x / CHUNK), Math.floor(p.z / CHUNK)))) {
      if (t[0].kind !== KIND.floor) continue;
      const x = (t[0].p[0] + t[1].p[0] + t[2].p[0]) / 3, z = (t[0].p[2] + t[1].p[2] + t[2].p[2]) / 3, n = t[0].n;
      if (Math.hypot(x - p.x, z - p.z) > p.r - 2 / 32) continue;
      if (n[1] > 0.5) {
        tops++;
        expect(n[1]).toBe(1);
        const b = floorBlockAt(f, map, marks, Math.floor(x * 32), Math.floor(z * 32))!;
        for (const c of t) expect(c.p[1]).toBeCloseTo((b.level - 1) * LEVEL_STEP, 6);
        continue;
      }
      // a skirt: the px on its two sides are stones of two rings of a circle
      steps++;
      const a = floorBlockAt(f, map, marks, Math.floor(x * 32 + n[0] * 0.5), Math.floor(z * 32 + n[2] * 0.5))!, b = floorBlockAt(f, map, marks, Math.floor(x * 32 - n[0] * 0.5), Math.floor(z * 32 - n[2] * 0.5))!;
      expect(p.kind).toBe('circle');
      expect(a.piece!.ring, `skirt at ${x},${z}`).not.toBe(b.piece!.ring);
    }
    expect(tops).toBeGreaterThan(200);
    expect(steps).toBeGreaterThan(200);
  });

  it('sets a grate\'s iron into its cell: a frame and bars three quarters of the cell across, below the level floor round it and above the shaft\'s bottom', () => {
    const { map, f, marks, chunk } = stoneLevel(), g = marks.grates[0], hole = floorBlockAt(f, map, marks, g.x * 32, g.z * 32)!;
    expect(hole.hole).toBe(true);
    expect(hole.u1 - hole.u0).toBe(24);
    const cx = Math.floor(g.x / CHUNK), cz = Math.floor(g.z / CHUNK), iron = ironPx(hole);
    // the iron reads one px of the shaft
    const bars = vertices(chunk(cx, cz)).filter((v) => v.sheet[0] === iron[0] + 0.5 - cx * CHUNK * 32 && v.sheet[1] === iron[1] + 0.5 - cz * CHUNK * 32);
    for (const v of bars) {
      expect(v.kind).toBe(KIND.floor);
      for (const [c, o, lo, hi] of [[v.p[0], g.x, hole.u0, hole.u1], [v.p[2], g.z, hole.v0, hole.v1]]) {
        expect(Math.abs(c - o)).toBeLessThanOrEqual(0.5);
        expect(c * 32).toBeGreaterThanOrEqual(lo - 1e-4);
        expect(c * 32).toBeLessThanOrEqual(hi + 1e-4);
      }
      expect(v.p[1]).toBeLessThan(-LEVEL_STEP);
      expect(v.p[1]).toBeGreaterThan(-GRATE_DEPTH);
    }
    const tops = bars.filter((v) => v.n[1] === 1);
    expect(tops.length / 4).toBeGreaterThanOrEqual(8); // a frame of four, and bars
    for (const k of [0, 2]) expect(Math.max(...tops.map((v) => v.p[k])) - Math.min(...tops.map((v) => v.p[k]))).toBeCloseTo(0.75, 5);
    // the cell round the shaft is level, flush floor: the kerb
    for (const [du, dv] of [[-14, 0], [14, 0], [0, -14], [-14, -14], [14, 14]]) expect(floorHeight(f, map, marks, g.x + du / 32, g.z + dv / 32)).toBeCloseTo(-LEVEL_STEP, 6);
    expect(floorHeight(f, map, marks, g.x, g.z)).toBeCloseTo(-GRATE_DEPTH, 6);
  });

  it('cuts a groove along a crevice through laid floor: the px the painter makes black lie at the crevice\'s depth, and no edge gapes', () => {
    const m = floorMap(16, 16), f = stoneField(m, null, SEED), plan = planSheets(m), marks = noMarks();
    marks.crevices.push({ pts: [[4.2, 4.3], [7.6, 6.1], [9.3, 9.4]], branch: [[7.6, 6.1, 8.9, 5.2]], width: 0.1, depth: 0.3 });
    const page = new Uint8Array(PAGE * PAGE * 4);
    paintGroundRows(f, m, marks, 0, 0, 0, PAGE, page);
    let pits = 0;
    for (let v = 96; v < 352; v++) for (let u = 96; u < 352; u++) {
      const pit = decodeRelief(page[(v * PAGE + u) * 4 + 3]).flag === FLAG.pit, h = floorHeight(f, m, marks, (u + 0.5) / 32, (v + 0.5) / 32);
      if (pit) { pits++; expect(h, `px ${u},${v}`).toBeCloseTo(-0.3, 6); } else expect(h, `px ${u},${v}`).toBeGreaterThan(-0.15);
    }
    expect(pits).toBeGreaterThan(400);
    // every edge has a twin, but on the map's border
    const a = buildStoneChunk(m, f, plan, marks, 0, 0), edges = new Map<string, number>(), key = (p: number[]): string => p.map((c) => Math.round(c * 1e5)).join(',');
    for (const t of triangles(a)) for (let i = 0; i < 3; i++) {
      const k = [key(t[i].p), key(t[(i + 1) % 3].p)].sort().join(' ');
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    for (const [k, n] of edges) {
      if (n % 2 === 0) continue;
      const [p, q] = k.split(' ').map((s) => s.split(',').map((c) => Number(c) / 1e5));
      expect((p[0] === q[0] && (p[0] === 0 || p[0] === 16)) || (p[2] === q[2] && (p[2] === 0 || p[2] === 16)), `open edge ${k}`).toBe(true);
    }
    expect(a.index.length / 3).toBeLessThan(LAID_CHUNK_TRIS + CREVICE_TRIS);
  });

  it('makes a cell that is all rock one quad', () => {
    const m = floorMap(16, 16), plan = planSheets(m);
    const a = buildStoneChunk(m, stoneField(m, new Uint8Array(256).fill(1), SEED), plan, noMarks(), 0, 0);
    expect(a.index.length / 3).toBe(16 * 16 * 2);
    expect(a.count).toBe(16 * 16 * 4);
  });

  it('a floor vertex\'s sheet is its block\'s own px in the chunk\'s layer', () => {
    const m = floorMap(32, 16), f = stoneField(m, null, SEED), none = noMarks();
    const { a, plan } = build(m, 1, 0);
    expect(plan.groundOf(1, 0)).toBe(1);
    let tops = 0, skirts = 0;
    for (const t of triangles(a)) {
      const u = t.reduce((s, v) => s + v.sheet[0], 0) / 3 + CHUNK * 32, w = t.reduce((s, v) => s + v.sheet[1], 0) / 3;
      const b = floorBlockAt(f, m, none, Math.floor(u), Math.floor(w))!;
      for (const v of t) {
        expect(v.sheet[2]).toBe(1);
        expect(v.A[2]).toBe(-1);
        expect(v.B[2]).toBe(-1);
        // inside the block the triangle reads
        expect(v.sheet[0] + CHUNK * 32).toBeGreaterThanOrEqual(b.u0);
        expect(v.sheet[0] + CHUNK * 32).toBeLessThanOrEqual(b.u1);
        expect(v.sheet[1]).toBeGreaterThanOrEqual(b.v0);
        expect(v.sheet[1]).toBeLessThanOrEqual(b.v1);
        if (v.n[1] > 0.9) {
          // a top: the px under the vertex
          tops++;
          expect(v.sheet[0]).toBeCloseTo((v.p[0] - CHUNK) * 32, 4);
          expect(v.sheet[1]).toBeCloseTo(v.p[2] * 32, 4);
        } else {
          // a skirt: a px of the block's own stone beside the edge, past its joint
          skirts++;
          expect(v.n[1]).toBe(0);
          expect(Math.hypot((v.p[0] - CHUNK) * 32 - v.sheet[0], v.p[2] * 32 - v.sheet[1])).toBeLessThan(2);
          expect(Math.min(v.sheet[0] + CHUNK * 32 - b.u0, v.sheet[1] - b.v0)).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(tops).toBeGreaterThan(1000);
    expect(skirts).toBeGreaterThan(1000);
  });

  it('a face vertex\'s faceA or faceB lies inside its slot: a block\'s front reads the px in front of it, v = 0 at the wall\'s top', () => {
    // a wall five cells long (x 1..5, z 1) in open floor: its long faces have blocks that stand back between the corner stones
    const m = floorMap(7, 3);
    for (let x = 1; x <= 5; x++) m.set(x, 1, TILE_ID.Wall);
    const { a, plan } = build(m);
    const sideOf = (d: number[]): number => (d[1] > 0.9 ? 0 : d[1] < -0.9 ? 1 : d[0] > 0.9 ? 2 : 3);
    /** The slot of the face on `side` whose cell the vertex lies in (a vertex on a cell line may be either cell's), if `own` lies in it. */
    const slotOf = (v: V, own: number[], side: number) => (side === 2 ? [5] : side === 3 ? [1] : [Math.floor(v.p[0]), Math.floor(v.p[0]) - 1]).filter((x) => x >= 1 && x <= 5)
      .map((x) => ({ x, slot: plan.slotOf({ x, z: 1, side: side as 0 | 1 | 2 | 3 }) }))
      .find(({ slot }) => own[2] === slot.layer && own[0] >= slot.u && own[0] <= slot.u + FACE_W && own[1] >= slot.v && own[1] <= slot.v + FACE_H);
    let fronts = 0, skirts = 0;
    for (const v of vertices(a)) {
      if (v.kind !== KIND.face) continue;
      if (v.sheet[2] < 0) {
        // a skirt or the foot: both planes read the px of the block's own face, whichever way the skirt faces.
        // A skirt's light is read in front of its face (`push`), which names the face; the foot faces out of it.
        skirts++;
        expect(v.B).toEqual(v.A);
        const len = Math.hypot(v.push[0], v.push[1]), side = sideOf(len > 0 ? [v.push[0] / len, v.push[1] / len] : [v.n[0], v.n[2]]);
        expect(slotOf(v, v.A, side), `skirt at ${v.p} of side ${side}`).toBeDefined();
        continue;
      }
      fronts++;
      const side = sideOf([v.n[0], v.n[2]]), own = side < 2 ? v.A : v.B, other = side < 2 ? v.B : v.A, at = slotOf(v, own, side);
      expect(other[2]).toBe(-1);
      expect(at, `front at ${v.p} of side ${side}`).toBeDefined();
      // v = 0 (the slot's top) at y = WALL_H, a tile (32 px) per unit of height down
      expect(own[1]).toBeCloseTo(at!.slot.v + (WALL_H - v.p[1]) * 32, 4);
      // u grows with +x on sides 0 and 1, +z on sides 2 and 3
      expect(own[0]).toBeCloseTo(at!.slot.u + (side < 2 ? v.p[0] - at!.x : v.p[2] - 1) * FACE_W, 4);
    }
    expect(fronts).toBeGreaterThan(100);
    expect(skirts).toBeGreaterThan(50);
  });

  it('lays the stones of a wall\'s outer corner in the cell\'s edge, so the faces meet under the top\'s corner', () => {
    // a pillar of one cell: every vertex of a front that lies on a cell line lies in the cell's edge too
    const { a } = build(ring());
    let ends = 0;
    for (const v of vertices(a)) {
      if (v.kind !== KIND.face || v.sheet[2] < 0) continue;
      const along = Math.abs(v.n[2]) > 0.9 ? v.p[0] : v.p[2], across = Math.abs(v.n[2]) > 0.9 ? v.p[2] : v.p[0];
      if (along !== 1 && along !== 2) continue;
      ends++;
      expect(across === 1 || across === 2, `end vertex ${v.p}`).toBe(true);
    }
    expect(ends).toBeGreaterThan(20);
  });

  // ---- natural rock (`rockMesh.ts`)
  /** A cave of 8 by 6 cells in solid rock, with a lone wall cell at (4, 4) and a group of two at (7, 5) and (8, 5). */
  const cave = (): TileMap => {
    const m = new TileMap(12, 10, new Uint8Array(120).fill(TILE_ID.Wall));
    for (let z = 2; z < 8; z++) for (let x = 2; x < 10; x++) m.set(x, z, TILE_ID.Floor);
    for (const [x, z] of [[4, 4], [7, 5], [8, 5]]) m.set(x, z, TILE_ID.Wall);
    return m;
  };
  const rockBuild = (m: TileMap): StoneArrays => buildStoneChunk(m, stoneField(m, new Uint8Array(m.w * m.h).fill(1), SEED), planSheets(m), noMarks(), 0, 0);
/** The vertices of the rock's surface over wall cells: faces that are no foot strip, and where a slope leaves the floor its floor vertices (they alone of the floor's have a `push`). */
  const rockVertices = (a: StoneArrays): V[] => vertices(a).filter((v) => (v.kind === KIND.face && v.sheet[2] >= 0) || (v.kind === KIND.floor && (v.push[0] !== 0 || v.push[1] !== 0)));

  it('makes a lone rock wall cell a column, narrower at mid height than at its foot and its top, and a group of two an outcrop', () => {
    const vs = rockVertices(rockBuild(cave()));
    /** The widest reach from (cx, cz) of the vertices in the box whose height lies in [lo, hi]. */
    const reach = (cx: number, cz: number, lo: number, hi: number, d: (v: V) => number): number => {
      const at = vs.filter((v) => Math.abs(v.p[0] - cx) <= 1 && Math.abs(v.p[2] - cz) <= 0.5 && v.p[1] >= lo && v.p[1] <= hi).map(d);
      expect(at.length).toBeGreaterThan(8);
      return Math.max(...at);
    };
    const round = (v: V): number => Math.hypot(v.p[0] - 4.5, v.p[2] - 4.5);
    const foot = reach(4.5, 4.5, 0, 0.01, round), waist = reach(4.5, 4.5, 0.8, 1.2, round), top = reach(4.5, 4.5, WALL_H, WALL_H, round);
    expect(waist).toBeLessThan(top - 0.08);
    expect(top).toBeLessThan(foot - 0.03);
    expect(waist).toBeGreaterThan(0.15);
    // the group: a height field, so it is nowhere wider above than below
    const across = (v: V): number => Math.abs(v.p[2] - 5.5);
    const gFoot = reach(8, 5.5, 0, 0.01, across), gMid = reach(8, 5.5, 0.6, 1.4, across), gTop = reach(8, 5.5, WALL_H, WALL_H, across);
    expect(gFoot).toBeCloseTo(0.5, 6);
    expect(gMid).toBeLessThan(gFoot);
    expect(gTop).toBeLessThan(gMid);
    expect(gTop).toBeGreaterThan(0.02);
  });

  it('reads light and sight of every rock wall vertex in an open cell, and lets no vertex of a wall cell leave its cell', () => {
    const m = cave(), vs = rockVertices(rockBuild(m));
    expect(vs.length).toBeGreaterThan(1000);
    for (const v of vs) {
      expect(heightAt(m, Math.floor(v.p[0] + v.push[0]), Math.floor(v.p[2] + v.push[1])), `push of ${v.p}`).toBe(0);
      expect(v.p[1]).toBeGreaterThanOrEqual(0);
      expect(v.p[1]).toBeLessThanOrEqual(WALL_H);
      const e = 1e-6;
      expect([[e, e], [-e, e], [e, -e], [-e, -e]].some(([dx, dz]) => heightAt(m, Math.floor(v.p[0] + dx), Math.floor(v.p[2] + dz)) > 0), `vertex ${v.p}`).toBe(true);
    }
    // the lone cell and the group stand in open floor: what is drawn of them lies in their own cells
    const near = vs.filter((v) => v.p[0] > 3.2 && v.p[0] < 5.8 && v.p[2] > 3.2 && v.p[2] < 5.8);
    expect(near.length).toBeGreaterThan(100);
    for (const v of near) for (const c of [v.p[0], v.p[2]]) { expect(c).toBeGreaterThanOrEqual(4); expect(c).toBeLessThanOrEqual(5); }
    const group = vs.filter((v) => v.p[0] > 6.2 && v.p[0] < 9.8 && v.p[2] > 4.2 && v.p[2] < 6.8);
    for (const v of group) { expect(v.p[0]).toBeGreaterThanOrEqual(7); expect(v.p[0]).toBeLessThanOrEqual(9); expect(v.p[2]).toBeGreaterThanOrEqual(5); expect(v.p[2]).toBeLessThanOrEqual(6); }
    // floors of rock stay at or below 0
    for (const v of vertices(rockBuild(m))) if (v.kind === KIND.floor) expect(v.p[1]).toBeLessThanOrEqual(0);
  });

  it('builds the laid mesh where the rock amount is 0, and keeps the caves under their budgets', () => {
    const map = stoneMap(), plan = planSheets(map), lights = TORCH_TILES.map(([x, y], i) => ({ id: i + 1, kind: LIGHT_KIND.Torch, x, y }));
    const levelOf = (kinds: Uint8Array | null) => {
      const f = stoneField(map, kinds, STONE_SEED), marks = placeMarks(map, f, { lights, spawn: STONE_SPAWN });
      return (cx: number, cz: number): StoneArrays => buildStoneChunk(map, f, plan, marks, cx, cz);
    };
    const laid = levelOf(null), zones = levelOf(zoneKinds(map));
    // the mosaic room lies deep in laid stone: the same arrays, and the measured count
    expect(zones(3, 0)).toEqual(laid(3, 0));
    expect(laid(3, 0).index.length / 3).toBe(MOSAIC_CHUNK_TRIS);
    // the two caves' chunks, and the whole page as rock
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(zones(cx, cz).index.length / 3, `chunk ${cx},${cz}`).toBeLessThan(ROCK_CHUNK_TRIS);
    const rock = levelOf(new Uint8Array(map.w * map.h).fill(1));
    let all = 0;
    for (let cz = 0; cz < 2; cz++) for (let cx = 0; cx < 5; cx++) all += rock(cx, cz).index.length / 3;
    expect(all).toBeLessThan(ROCK_PAGE_TRIS);
  });

  it('leaves cells to another mesh when asked, and a chunk of only Void ground layer -1', () => {
    const m = new TileMap(2, 1, Uint8Array.from([TILE_ID.Floor, TILE_ID.Void]));
    const plan = planSheets(m);
    const skipped = buildStoneChunk(m, stoneField(m), plan, noMarks(), 0, 0, (x) => x === 0);
    expect(vertices(skipped).some((v) => v.kind === KIND.floor)).toBe(false); // the Void's top and its west face; no floor
    expect(vertices(skipped).filter((v) => v.kind === KIND.top).length).toBe(4);
    const v = new TileMap(1, 1, Uint8Array.from([TILE_ID.Void]));
    const all = buildStoneChunk(v, stoneField(v), planSheets(v), noMarks(), 0, 0);
    expect(all.sheet[2]).toBe(-1);
  });
});
