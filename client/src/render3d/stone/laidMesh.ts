// The shape of laid stone (#380 part 4): every block of floor and wall masonry is its own piece of mesh, at its level with its tilt, and
// has a skirt on every side where its neighbour lies lower. A floor's blocks are cut at the cell's edges and a wall's at the face's, so a
// chunk owns its cells' triangles; whatever two pieces share an edge have the same vertices on it, so nothing gapes. Pure: no three.
//
// A piece lives in the px space of its plane (ground: world px; wall: world px along the wall, px down from its top) with a height over
// that plane in tiles: a floor's height is y (never above 0), a wall's is how far it stands out of the cell's edge (never above 0 either).
import type { TileMap } from '../../sim/map';
import { inDipMesh } from '../dips/shape';
import { WALL_H, heightAt } from '../heights';
import { COURSES, LEVEL_STEP, floorBlockAt, markAt, slabOf, wallBlockAt, type Block } from './blocks';
import { FACE_H, FACE_W } from './format';
import { KIND, SIDE_STEP } from './grid';
import { STONE_PX, type StoneField } from './field';
import type { Marks } from './place';
import type { Face, SheetPlan } from './plan';

export type Vec3 = [number, number, number];
/** A vertex: position, the three sheet coordinates, and the offset to where light and sight are read. */
export interface Corner { p: Vec3; sheet: Vec3; a: Vec3; b: Vec3; push?: [number, number] }
/** Takes one triangle and winds it to the normal. */
export type Tri = (c0: Corner, c1: Corner, c2: Corner, n: Vec3, kind: number) => void;
export const NONE: Vec3 = [0, 0, -1];

// First guesses, all of them.
/** How far the frieze course stands out of a wall's other courses (tiles): the frieze lies in the cell's edge, a raised block this far behind it. */
export const FRIEZE_OUT = 0.05;
/** A drain grate's shaft is this deep (tiles). */
export const GRATE_DEPTH = 0.3;
/** A skirt reads the px this far inside its block's edge: past the joint on the left and top, the first px on the right and bottom. */
const SKIRT_PAST_JOINT = 1.5, SKIRT_IN = 0.5;
/** A wall's skirt reads light and sight this far in front of the wall (tiles): its own normal does not point out of it. */
const SKIRT_PUSH = 0.03;

/** The plane a piece lies in: its height at (uh, vh) and its fall per px. `row`: a px row of a wall block's course; `solid`: no piece, the uncut stone beside one. */
interface Plane { h0: number; tu: number; tv: number; uh: number; vh: number; row: number; solid: boolean }
/** A piece of the mesh: a rectangle of px, `u1` and `v1` exclusive. */
interface Surf { u0: number; v0: number; u1: number; v1: number; p: Plane }
const flat = (h0: number, solid = false): Plane => ({ h0, tu: 0, tv: 0, uh: 0, vh: 0, row: -1, solid });
const hOf = (p: Plane, u: number, v: number): number => p.h0 + p.tu * (u - p.uh) + p.tv * (v - p.vh);
/** A block's plane: its highest corner lies at `top` and the rest falls away (`Block.tilt`). */
const planeOf = (b: Block, top: number): Plane => ({ h0: top, tu: b.tilt[0], tv: b.tilt[1], uh: b.tilt[0] > 0 ? b.u1 : b.u0, vh: b.tilt[1] > 0 ? b.v1 : b.v0, row: b.v0, solid: false });

/** Untilted floors by level (sunk, flush, raised; rock lies at the raised level), so level stones side by side are one piece. */
const LEVEL = [flat(-2 * LEVEL_STEP), flat(-LEVEL_STEP), flat(0)];
const SHAFT = flat(-GRATE_DEPTH);
/** The uncut stone beside a piece, at height 0: a neighbour that draws nothing, so the piece draws the skirt between them itself. */
const OUT: Surf = { u0: -Infinity, v0: -Infinity, u1: Infinity, v1: Infinity, p: flat(0, true) };

/** What a piece is shaped in: its neighbours, and how plane points become vertices. */
interface Space {
  kind: number;
  /** The piece over a px (the asking piece's own px too); null: nothing to meet there. */
  at(u: number, v: number): Surf | null;
  /** The vertex at the plane point (u, v) and height h, which lies on the plane `p`, reading the px (su, sv). */
  corner(u: number, v: number, h: number, p: Plane, su: number, sv: number, skirt: boolean): Corner;
  /** The world direction of a step (du, dv) in the plane and dh out of it. */
  dir(du: number, dv: number, dh: number): Vec3;
}

/**
 * One piece: its top, and its skirts. Along each edge it meets the pieces beside it one after the other; where it lies higher it hangs a
 * skirt down to the neighbour's edge, facing the neighbour. Where two tilted pieces cross, each takes its side of the crossing, and the
 * crossing point becomes a vertex of both tops. Every point where a neighbour ends is a vertex of the top too.
 */
function shape(s: Surf, sp: Space, tri: Tri): void {
  const p = s.p, ring: [number, number, number][] = [], first = [0, 0, 0, 0];
  /** The vertices from `hi` down to `lo` at a point of the px grid: every piece that meets there has a vertex in between. */
  const column = (u: number, v: number, hi: number, pHi: Plane, lo: number, pLo: Plane, su: number, sv: number): Corner[] => {
    if (hi === lo) return [sp.corner(u, v, hi, pHi, su, sv, true)];
    const mid: [number, Plane][] = [];
    for (const [du, dv] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const o = sp.at(u + du, v + dv);
      if (!o) continue;
      const h = hOf(o.p, u, v);
      if (h < hi && h > lo && !mid.some((m) => m[0] === h)) mid.push([h, o.p]);
    }
    mid.sort((a, b) => b[0] - a[0]);
    return [sp.corner(u, v, hi, pHi, su, sv, true), ...mid.map(([h, q]) => sp.corner(u, v, h, q, su, sv, true)), sp.corner(u, v, lo, pLo, su, sv, true)];
  };
  for (let e = 0; e < 4; e++) {
    // 0 the top edge (v0), 1 the right (u1), 2 the bottom (v1), 3 the left (u0); (du, dv) points out of the piece
    const alongU = e % 2 === 0, fixed = [s.v0, s.u1, s.v1, s.u0][e], out = [s.v0 - 1, s.u1, s.v1, s.u0 - 1][e];
    const a0 = alongU ? s.u0 : s.v0, a1 = alongU ? s.u1 : s.v1, du = e === 1 ? 1 : e === 3 ? -1 : 0, dv = e === 0 ? -1 : e === 2 ? 1 : 0;
    const beside = (t: number): Surf | null => (alongU ? sp.at(t, out) : sp.at(out, t));
    const inset = e === 0 || e === 3 ? SKIRT_PAST_JOINT : SKIRT_IN;
    const inner: [number, number, number][] = [];
    for (let t = a0; t < a1;) {
      const n = beside(t);
      let end = t + 1;
      if (n) end = Math.min(a1, alongU ? n.u1 : n.v1);
      else while (end < a1 && !beside(end)) end++;
      const u0 = alongU ? t : fixed, v0 = alongU ? fixed : t, u1 = alongU ? end : fixed, v1 = alongU ? fixed : end;
      if (t > a0) inner.push([u0, v0, hOf(p, u0, v0)]);
      t = end;
      if (!n) continue;
      const m0 = hOf(p, u0, v0), m1 = hOf(p, u1, v1), n0 = hOf(n.p, u0, v0), n1 = hOf(n.p, u1, v1), d0 = m0 - n0, d1 = m1 - n1;
      /** The skirt between the two ends: `mine` on top, or (beside uncut stone) the neighbour's edge on top and the skirt facing this piece. */
      const hang = (mine: boolean): void => {
        const k = mine ? 1 : -1, normal = sp.dir(du * k, dv * k, 0);
        const c0 = mine ? column(u0, v0, m0, p, n0, n.p, u0 - du * inset, v0 - dv * inset) : column(u0, v0, n0, n.p, m0, p, u0 - du * inset, v0 - dv * inset);
        const c1 = mine ? column(u1, v1, m1, p, n1, n.p, u1 - du * inset, v1 - dv * inset) : column(u1, v1, n1, n.p, m1, p, u1 - du * inset, v1 - dv * inset);
        for (let i = 0; i + 1 < c1.length; i++) tri(c0[0], c1[i], c1[i + 1], normal, sp.kind);
        for (let i = 0; i + 1 < c0.length; i++) tri(c1[c1.length - 1], c0[i], c0[i + 1], normal, sp.kind);
      };
      if (n.p.solid) { if (d0 < 0 || d1 < 0) hang(false); }
      else if (d0 >= 0 && d1 >= 0) { if (d0 > 0 || d1 > 0) hang(true); }
      else if (d0 > 0 || d1 > 0) {
        // the two cross: both work the point out the same way, so it is one vertex
        const tx = end - (end - (alongU ? u0 : v0)) * (d1 / (d1 - d0)), ux = alongU ? tx : fixed, vx = alongU ? fixed : tx;
        const hx = (hOf(p, ux, vx) + hOf(n.p, ux, vx)) / 2;
        inner.push([ux, vx, hx]);
        const x = sp.corner(ux, vx, hx, p, ux - du * inset, vx - dv * inset, true), normal = sp.dir(du, dv, 0);
        const c = d0 > 0 ? column(u0, v0, m0, p, n0, n.p, u0 - du * inset, v0 - dv * inset) : column(u1, v1, m1, p, n1, n.p, u1 - du * inset, v1 - dv * inset);
        for (let i = 0; i + 1 < c.length; i++) tri(x, c[i], c[i + 1], normal, sp.kind);
      }
    }
    const start = [[s.u0, s.v0], [s.u1, s.v0], [s.u1, s.v1], [s.u0, s.v1]][e];
    first[e] = ring.length;
    ring.push([start[0], start[1], hOf(p, start[0], start[1])], ...(e < 2 ? inner : inner.reverse()));
  }
  const up = sp.dir(-p.tu * STONE_PX, -p.tv * STONE_PX, 1), len = Math.hypot(...up), normal: Vec3 = [up[0] / len, up[1] / len, up[2] / len];
  const c = ring.map(([u, v, h]) => sp.corner(u, v, h, p, u, v, false));
  c.push(c[0]);
  /**
   * The half of the top between two edges that meet in a corner and the diagonal: `a` runs along one edge to the corner, `r` along the
   * other. Every triangle has points of both edges, so none is flat, however many points lie on an edge.
   */
  const half = (a: Corner[], r: Corner[]): void => {
    const m = a.length - 2;
    for (let i = 0; i < m; i++) tri(r[0], a[i], a[i + 1], normal, sp.kind);
    for (let j = 0; j + 1 < r.length; j++) tri(a[m], r[j], r[j + 1], normal, sp.kind);
  };
  half(c.slice(first[0], first[1] + 1), c.slice(first[1], first[2] + 1).reverse());
  half(c.slice(first[2], first[3] + 1), c.slice(first[3]).reverse());
}

// ---- what a chunk's build keeps: the pieces of the cells and faces it has asked for (its own and the ring round them)
/** A floor cell's pieces; `at`: the piece of each px, where the cell has too many to search. */
interface Cell { at: Uint16Array | null; surfs: Surf[] }
interface FaceShape { face: Face; h: number; hn: number; rock: boolean; surfs: Surf[] }
export interface Laid {
  map: TileMap; f: StoneField; plan: SheetPlan; marks: Marks; skip?: (x: number, z: number) => boolean;
  /** The chunk's ground page: its first cell and its layer. */
  x0: number; z0: number; layer: number;
  cells: Map<number, Cell | null>; faces: Map<number, FaceShape | null>; planes: Map<number, Plane>; marked: Map<object, Plane>;
}
export function laid(map: TileMap, f: StoneField, plan: SheetPlan, marks: Marks, x0: number, z0: number, layer: number, skip?: (x: number, z: number) => boolean): Laid {
  return { map, f, plan, marks, skip, x0, z0, layer, cells: new Map(), faces: new Map(), planes: new Map(), marked: new Map() };
}
const inMap = (c: Laid, x: number, z: number): boolean => x >= 0 && z >= 0 && x < c.map.w && z < c.map.h;
function planeFor(c: Laid, b: Block, top: number): Plane {
  let p = c.planes.get(b.id);
  if (!p) c.planes.set(b.id, p = planeOf(b, top));
  return p;
}

// ---- floors
/** A cell another mesh draws at height 0 (the woodland's ground): uncut stone to its neighbours. */
const OUT_CELL: Cell = { at: null, surfs: [OUT] };
const grid = new Int16Array(STONE_PX * STONE_PX), rows = new Int32Array(STONE_PX);
/** The piece of a cell over a px. */
const pieceAt = (o: Cell, u: number, v: number): Surf => {
  if (o.at) return o.surfs[o.at[(v & 31) * STONE_PX + (u & 31)]];
  for (const s of o.surfs) if (u >= s.u0 && u < s.u1 && v >= s.v0 && v < s.v1) return s;
  throw new Error(`no piece at ${u},${v}`);
};

/**
 * The pieces of the floor cell (x, z), or null where this mesh has no floor (a wall, the dip mesh's cells, beyond the map): each slab cut
 * at the cell's edges (rock: level at 0). Beside a floor piece or a grate every px takes its block's plane, and px in a row and rows on
 * end with the same plane are one piece: the level stones of a floor piece together.
 */
function cellOf(c: Laid, x: number, z: number): Cell | null {
  if (!inMap(c, x, z)) return null;
  const key = z * c.map.w + x;
  let cell = c.cells.get(key);
  if (cell !== undefined) return cell;
  cell = null;
  if (heightAt(c.map, x, z) === 0 && !inDipMesh(c.map, x, z)) {
    if (c.skip?.(x, z)) cell = OUT_CELL;
    else {
      const N = STONE_PX, pu = x * N, pv = z * N, planes: Plane[] = [];
      const index = (p: Plane): number => { const i = planes.indexOf(p); return i >= 0 ? i : planes.push(p) - 1; };
      const top = (b: Block | null): Plane => (!b ? LEVEL[2] : b.hole ? SHAFT : b.tilt[0] === 0 && b.tilt[1] === 0 ? LEVEL[b.level + 1] : planeFor(c, b, (b.level - 1) * LEVEL_STEP));
      // beside a floor piece or a grate the stones are no rectangles: there every px is asked
      const near = c.marks.grates.some((g) => Math.floor(g.x) === x && Math.floor(g.z) === z)
        || c.marks.pieces.some((p) => x + 1 > p.x - p.r - 0.1 && x < p.x + p.r + 0.1 && z + 1 > p.z - p.r - 0.1 && z < p.z + p.r + 0.1);
      cell = { at: null, surfs: [] };
      if (!near) {
        // slabs only: each is a rectangle, found at the first px of a row that none covers yet (a row's covered px are the bits of `rows`)
        rows.fill(0);
        for (let j = 0; j < N; j++) while (rows[j] !== -1) {
          const i = 31 - Math.clz32(~rows[j] & (rows[j] + 1)), s = slabOf(c.f, c.map, c.marks, pu + i, pv + j);
          const i1 = Math.min(N, s.b.u1 - pu), j1 = Math.min(N, s.b.v1 - pv), bits = (i1 === 32 ? -1 : (1 << i1) - 1) & ~((1 << i) - 1);
          for (let jj = j; jj < j1; jj++) rows[jj] |= bits;
          cell.surfs.push({ u0: pu + i, v0: pv + j, u1: pu + i1, v1: pv + j1, p: top(s.rock ? null : s.b) });
        }
        c.cells.set(key, cell);
        return cell;
      }
      grid.fill(-1);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const mark = markAt(c.marks, pu + i, pv + j);
        if (!mark) { const s = slabOf(c.f, c.map, c.marks, pu + i, pv + j); grid[j * N + i] = index(top(s.rock ? null : s.b)); continue; }
        // a piece's stones all lie at one level: its middle stone says which
        let p = c.marked.get(mark);
        if (!p) c.marked.set(mark, p = 'kind' in mark ? top(floorBlockAt(c.f, c.map, c.marks, Math.floor(mark.x * N), Math.floor(mark.z * N))) : SHAFT);
        grid[j * N + i] = index(p);
      }
      cell.at = new Uint16Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = grid[j * N + i];
        if (k < 0) continue;
        let w = 1, h = 1;
        while (i + w < N && grid[j * N + i + w] === k) w++;
        rows: for (; j + h < N; h++) for (let ii = i; ii < i + w; ii++) if (grid[(j + h) * N + ii] !== k) break rows;
        for (let jj = j; jj < j + h; jj++) { grid.fill(-1, jj * N + i, jj * N + i + w); cell.at!.fill(cell.surfs.length, jj * N + i, jj * N + i + w); }
        cell.surfs.push({ u0: pu + i, v0: pv + j, u1: pu + i + w, v1: pv + j + h, p: planes[k] });
      }
    }
  }
  c.cells.set(key, cell);
  return cell;
}

/** The floor of the cell (x, z): its pieces with their skirts. */
export function laidFloor(c: Laid, x: number, z: number, tri: Tri): void {
  const cell = cellOf(c, x, z);
  if (!cell || cell === OUT_CELL) return;
  const ou = c.x0 * STONE_PX, ov = c.z0 * STONE_PX;
  const sp: Space = {
    kind: KIND.floor,
    at(u, v) {
      const o = u >> 5 === x && v >> 5 === z ? cell : cellOf(c, u >> 5, v >> 5);
      return o ? pieceAt(o, u, v) : null;
    },
    corner: (u, v, h, _p, su, sv) => ({ p: [u / STONE_PX, h, v / STONE_PX], sheet: [su - ou, sv - ov, c.layer], a: NONE, b: NONE }),
    dir: (du, dv, dh) => [du, dh, dv],
  };
  for (const s of cell.surfs) shape(s, sp, tri);
}

// ---- walls
/** A wall block's plane: the frieze in the cell's edge, the rest behind it by `FRIEZE_OUT` and its level. */
const wallTop = (b: Block): number => (b.frieze ? 0 : -FRIEZE_OUT + (b.level - 1) * LEVEL_STEP);

/**
 * The side `s` of the wall cell (x, z) where it borders a lower cell, or null. Its blocks are cut at the face's edges. `rock`: some of it
 * is no block, and the whole face stays one flat piece in the cell's edge (uncut stone to its neighbours).
 */
export function faceOf(c: Laid, x: number, z: number, s: number): FaceShape | null {
  if (!inMap(c, x, z)) return null;
  const key = (z * c.map.w + x) * 4 + s;
  let fs = c.faces.get(key);
  if (fs !== undefined) return fs;
  const h = heightAt(c.map, x, z), hn = heightAt(c.map, x + SIDE_STEP[s][0], z + SIDE_STEP[s][1]);
  fs = null;
  if (h > 0 && hn < h) {
    const face: Face = { x, z, side: s as 0 | 1 | 2 | 3 }, U0 = (s < 2 ? x : z) * STONE_PX, V0 = (WALL_H - h) * STONE_PX, V1 = (WALL_H - hn) * STONE_PX;
    fs = { face, h, hn, rock: false, surfs: [] };
    courses: for (let k = 0; k + 1 < COURSES.length; k++) {
      if (COURSES[k + 1] <= V0 || COURSES[k] >= V1) continue;
      for (let u = U0; u < U0 + STONE_PX;) {
        const b = wallBlockAt(c.f, c.map, face, u, COURSES[k]);
        if (!b) { fs.rock = true; fs.surfs = []; break courses; }
        fs.surfs.push({ u0: Math.max(b.u0, U0), v0: Math.max(b.v0, V0), u1: Math.min(b.u1, U0 + STONE_PX), v1: Math.min(b.v1, V1), p: planeFor(c, b, wallTop(b)) });
        u = b.u1;
      }
    }
  }
  c.faces.set(key, fs);
  return fs;
}
const surfAt = (fs: FaceShape, u: number, v: number): Surf | null => fs.surfs.find((o) => u >= o.u0 && u < o.u1 && v >= o.v0 && v < o.v1) ?? null;

/**
 * A laid face: its blocks with their skirts. Below its foot lies uncut stone (the ledge the blocks stand back from); so does beyond an
 * end where the wall goes on without a face, or with a rock face. At an end that is the wall's outer corner the blocks stop where the
 * blocks of the face round the corner begin: each end vertex moves in by that face's depth there, and that face's by this one's.
 */
// shortcut: the corner lookup takes a course's first px row, which lies outside a face of a wall lower than WALL_H (then: no move in); pass a row inside the face when levels get such walls.
export function laidFace(c: Laid, fs: FaceShape, tri: Tri): void {
  const { x, z, side: s } = fs.face, [dx, dz] = SIDE_STEP[s], along = s < 2 ? x : z, U0 = along * STONE_PX, U1 = U0 + STONE_PX;
  const V0 = (WALL_H - fs.h) * STONE_PX, V1 = (WALL_H - fs.hn) * STONE_PX, slot = c.plan.slotOf(fs.face);
  /** The plane of the cell's edge the face looks out of, and that coordinate in px along the faces round the corner. */
  const edge = (s < 2 ? z : x) + (s === 0 || s === 2 ? 1 : 0), ePx = edge * STONE_PX;
  /** The wall cell beyond an end (-1 the low end, 1 the high one), and whether the wall ends there in an outer corner. */
  const beyond = (d: number): [number, number] => (s < 2 ? [x + d, z] : [x, z + d]);
  const outer = (d: number): boolean => heightAt(c.map, ...beyond(d)) < fs.h;
  const round = [-1, 1].map((d) => (outer(d) ? faceOf(c, x, z, s < 2 ? (d < 0 ? 3 : 2) : d < 0 ? 1 : 0) : null));
  /** How deep the face round the corner lies at this face's end, for a vertex of the course of `row` at px `v` down. */
  const depthRound = (end: number, row: number, v: number): number => {
    const g = round[end], o = g && surfAt(g, s === 0 || s === 2 ? ePx - 1 : ePx, row);
    return o ? -hOf(o.p, ePx, v) : 0;
  };
  const sp: Space = {
    kind: KIND.face,
    at(u, v) {
      if (v < V0) return null; // under the top's rim: nobody sees that skirt
      if (v >= V1) return OUT;
      if (u >= U0 && u < U1) return surfAt(fs, u, v);
      const d = u < U0 ? -1 : 1, g = faceOf(c, ...beyond(d), s);
      if (g) return g.rock ? OUT : surfAt(g, u, v) ?? OUT;
      return outer(d) ? null : OUT;
    },
    corner(u, v, h, p, su, sv, skirt) {
      let t = u;
      if (p.row >= 0 && u === U0) t += depthRound(0, p.row, v) * STONE_PX;
      else if (p.row >= 0 && u === U1) t -= depthRound(1, p.row, v) * STONE_PX;
      const y = WALL_H - v / STONE_PX, pos: Vec3 = s < 2 ? [t / STONE_PX, y, edge + dz * h] : [edge + dx * h, y, t / STONE_PX];
      const reach = -h + (skirt ? SKIRT_PUSH : 0), push: [number, number] = [dx * reach, dz * reach];
      if (skirt) {
        // both wall planes read the block's own px, whichever way the skirt faces
        const own: Vec3 = [slot.u + Math.min(FACE_W, Math.max(0, su - U0)), slot.v + Math.min(FACE_H, Math.max(0, sv)), slot.layer];
        return { p: pos, sheet: NONE, a: own, b: own, push };
      }
      const own: Vec3 = [slot.u + t - U0, slot.v + v, slot.layer];
      return { p: pos, sheet: [(pos[0] - c.x0) * STONE_PX, (pos[2] - c.z0) * STONE_PX, c.layer], a: s < 2 ? own : NONE, b: s < 2 ? NONE : own, push };
    },
    dir: (du, dv, dh) => (s < 2 ? [du + dx * dh, -dv, dz * dh] : [dx * dh, -dv, du + dz * dh]),
  };
  for (const o of fs.surfs) shape(o, sp, tri);
}
