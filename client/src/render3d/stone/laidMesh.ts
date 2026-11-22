// The shape of laid stone (#380 part 4): every block of floor and wall masonry is its own piece of mesh, at its level with its tilt, and
// has a skirt on every side where its neighbour lies lower. A floor's blocks are cut at the chunk's borders (and at the cells of walls,
// dips, floor pieces, grates and crevices) and a wall's at the face's edges, so a chunk owns its triangles; whatever two pieces share an edge have
// the same vertices on it, so nothing gapes. Pure: no three.
//
// A piece lives in the px space of its plane (ground: world px; wall: world px along the wall, px down from its top) with a height over
// that plane in tiles: a floor's height is y (never above 0), a wall's is how far it stands out of the cell's edge (never above 0 either).
import type { TileMap } from '../../sim/map';
import { inDipMesh } from '../dips/shape';
import { WALL_H, heightAt } from '../heights';
import { COURSES, LEVEL_STEP, floorBlockAt, slabOf, wallBlockAt, type Block } from './blocks';
import { FACE_H, FACE_W } from './format';
import { CHUNK, KIND, SIDE_STEP } from './grid';
import { STONE_PX, rockWall, type StoneField } from './field';
import { onPiece, piecesOf, type Marks } from './place';
import type { Face, SheetPlan } from './plan';

export type Vec3 = [number, number, number];
/** A vertex: position, the three sheet coordinates, and the offset to where light and sight are read. */
export interface Corner { p: Vec3; sheet: Vec3; a: Vec3; b: Vec3; push?: [number, number] }
/** Where the mesh goes: vertices by number, shared by the triangles of one flat piece (they have one normal). */
export interface Out {
  vert(c: Corner, n: Vec3, kind: number): number;
  /** A triangle of three vertices; it is wound to the first one's normal. */
  tri(a: number, b: number, c: number): void;
}
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

/** The plane a piece lies in: its height at (uh, vh) and its fall per px. `solid`: no piece, the uncut stone beside one. `pit`: a crevice's bottom. */
interface Plane { h0: number; tu: number; tv: number; uh: number; vh: number; solid: boolean; pit?: true }
/** A piece of the mesh: a rectangle of px, `u1` and `v1` exclusive. */
interface Surf { u0: number; v0: number; u1: number; v1: number; p: Plane }
const flat = (h0: number, solid = false): Plane => ({ h0, tu: 0, tv: 0, uh: 0, vh: 0, solid });
const hOf = (p: Plane, u: number, v: number): number => p.h0 + p.tu * (u - p.uh) + p.tv * (v - p.vh);
/** A block's plane: its highest corner lies at `top` and the rest falls away (`Block.tilt`). */
const planeOf = (b: Block, top: number): Plane => ({ h0: top, tu: b.tilt[0], tv: b.tilt[1], uh: b.tilt[0] > 0 ? b.u1 : b.u0, vh: b.tilt[1] > 0 ? b.v1 : b.v0, solid: false });

/** Untilted floors by level (sunk, flush, raised; rock lies at the raised level), so level stones side by side are one piece. */
const LEVEL = [flat(-2 * LEVEL_STEP), flat(-LEVEL_STEP), flat(0)];
const SHAFT = flat(-GRATE_DEPTH);
/** The uncut stone beside a piece, at height 0: a neighbour that draws nothing, so the piece draws the skirt between them itself. */
const UNCUT = flat(0, true);
const OUT: Surf = { u0: -Infinity, v0: -Infinity, u1: Infinity, v1: Infinity, p: UNCUT };

/** What a piece is shaped in: its neighbours, and how plane points become vertices. */
interface Space {
  kind: number;
  /** The piece over a px (the asking piece's own px too); null: nothing to meet there. */
  at(u: number, v: number): Surf | null;
  /** The vertex at the plane point (u, v) and height h, reading the px (su, sv). */
  corner(u: number, v: number, h: number, su: number, sv: number, skirt: boolean): Corner;
  /** The world direction of a step (du, dv) in the plane and dh out of it. */
  dir(du: number, dv: number, dh: number): Vec3;
  /** A skirt facing (du, dv) that the camera never sees. */
  hidden(du: number, dv: number): boolean;
}

/**
 * One piece: its top, and its skirts. Along each edge it meets the pieces beside it one after the other; where it lies higher it hangs a
 * skirt down to the neighbour's edge, facing the neighbour. Where two tilted pieces cross, each takes its side of the crossing, and the
 * crossing point becomes a vertex of both tops. Every point where a neighbour ends is a vertex of the top too.
 */
function shape(s: Surf, sp: Space, out: Out): void {
  const p = s.p, ring: [number, number, number][] = [], first = [0, 0, 0, 0];
  /** The vertices from `hi` down to `lo` at a point of the px grid: every piece that meets there has a vertex in between. */
  const column = (u: number, v: number, hi: number, lo: number, su: number, sv: number, n: Vec3): number[] => {
    const hs = [hi];
    if (hi !== lo) {
      for (const [du, dv] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const o = sp.at(u + du, v + dv), h = o ? hOf(o.p, u, v) : hi;
        if (h < hi && h > lo && !hs.includes(h)) hs.push(h);
      }
      hs.sort((a, b) => b - a).push(lo);
    }
    return hs.map((h) => out.vert(sp.corner(u, v, h, su, sv, true), n, sp.kind));
  };
  for (let e = 0; e < 4; e++) {
    // 0 the top edge (v0), 1 the right (u1), 2 the bottom (v1), 3 the left (u0); (du, dv) points out of the piece
    const alongU = e % 2 === 0, fixed = [s.v0, s.u1, s.v1, s.u0][e], beyond = [s.v0 - 1, s.u1, s.v1, s.u0 - 1][e];
    const a0 = alongU ? s.u0 : s.v0, a1 = alongU ? s.u1 : s.v1, du = e === 1 ? 1 : e === 3 ? -1 : 0, dv = e === 0 ? -1 : e === 2 ? 1 : 0;
    const beside = (t: number): Surf | null => (alongU ? sp.at(t, beyond) : sp.at(beyond, t));
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
        const k = mine ? 1 : -1;
        if (sp.hidden(du * k, dv * k)) return;
        // a crevice's side reads the groove's own px, which the painter made black: the groove is black whichever way its sides face
        const normal = sp.dir(du * k, dv * k, 0), ins = n.p.pit ? -SKIRT_IN : inset;
        const c0 = column(u0, v0, mine ? m0 : n0, mine ? n0 : m0, u0 - du * ins, v0 - dv * ins, normal);
        const c1 = column(u1, v1, mine ? m1 : n1, mine ? n1 : m1, u1 - du * ins, v1 - dv * ins, normal);
        for (let i = 0; i + 1 < c1.length; i++) out.tri(c0[0], c1[i], c1[i + 1]);
        for (let i = 0; i + 1 < c0.length; i++) out.tri(c1[c1.length - 1], c0[i], c0[i + 1]);
      };
      if (n.p.solid) { if (d0 < 0 || d1 < 0) hang(false); }
      else if (d0 >= 0 && d1 >= 0) { if (d0 > 0 || d1 > 0) hang(true); }
      else if (d0 > 0 || d1 > 0) {
        // the two cross: both work the point out the same way, so it is one vertex
        const tx = end - (end - (alongU ? u0 : v0)) * (d1 / (d1 - d0)), ux = alongU ? tx : fixed, vx = alongU ? fixed : tx;
        const hx = (hOf(p, ux, vx) + hOf(n.p, ux, vx)) / 2;
        inner.push([ux, vx, hx]);
        if (sp.hidden(du, dv)) continue;
        const normal = sp.dir(du, dv, 0), x = out.vert(sp.corner(ux, vx, hx, ux - du * inset, vx - dv * inset, true), normal, sp.kind);
        const c = d0 > 0 ? column(u0, v0, m0, n0, u0 - du * inset, v0 - dv * inset, normal) : column(u1, v1, m1, n1, u1 - du * inset, v1 - dv * inset, normal);
        for (let i = 0; i + 1 < c.length; i++) out.tri(x, c[i], c[i + 1]);
      }
    }
    const start = [[s.u0, s.v0], [s.u1, s.v0], [s.u1, s.v1], [s.u0, s.v1]][e];
    first[e] = ring.length;
    ring.push([start[0], start[1], hOf(p, start[0], start[1])], ...(e < 2 ? inner : inner.reverse()));
  }
  const up = sp.dir(-p.tu * STONE_PX, -p.tv * STONE_PX, 1), len = Math.hypot(...up), normal: Vec3 = [up[0] / len, up[1] / len, up[2] / len];
  const c = ring.map(([u, v, h]) => out.vert(sp.corner(u, v, h, u, v, false), normal, sp.kind));
  c.push(c[0]);
  /**
   * The half of the top between two edges that meet in a corner and the diagonal: `a` runs along one edge to the corner, `r` along the
   * other. Every triangle has points of both edges, so none is flat, however many points lie on an edge.
   */
  const half = (a: number[], r: number[]): void => {
    const m = a.length - 2;
    for (let i = 0; i < m; i++) out.tri(r[0], a[i], a[i + 1]);
    for (let j = 0; j + 1 < r.length; j++) out.tri(a[m], r[j], r[j + 1]);
  };
  half(c.slice(first[0], first[1] + 1), c.slice(first[1], first[2] + 1).reverse());
  half(c.slice(first[2], first[3] + 1), c.slice(first[3]).reverse());
}

// ---- what a chunk's build keeps: the pieces of the cells and faces it has asked for (its own and the ring round them)
/** A floor cell's pieces (one may reach on over other cells); `at`: the piece of each px, where the cell has too many to search. */
interface Cell { at: Uint16Array | null; surfs: Surf[]; rock?: true }
interface FaceShape { face: Face; h: number; hn: number; rock: boolean; surfs: Surf[] }
export interface Laid {
  map: TileMap; f: StoneField; plan: SheetPlan; marks: Marks; skip?: (x: number, z: number) => boolean;
  /** The chunk's ground page: its first cell and its layer. */
  x0: number; z0: number; layer: number;
  cells: Map<number, Cell | null>; faces: Map<number, FaceShape | null>; planes: Map<number, Plane>;
  open: Map<number, boolean>; wide: Map<number, Surf | null>;
  /** The crevices' straight pieces (tiles), half their width (px) and the plane of their groove's bottom. */
  grooves: { at: number[]; half: number; p: Plane }[];
}
export function laid(map: TileMap, f: StoneField, plan: SheetPlan, marks: Marks, x0: number, z0: number, layer: number, skip?: (x: number, z: number) => boolean): Laid {
  const grooves = marks.crevices.flatMap((cr) => { const p: Plane = { ...flat(-cr.depth), pit: true }; return piecesOf(cr).map((at) => ({ at, half: (cr.width * STONE_PX) / 2, p })); });
  return { map, f, plan, marks, skip, x0, z0, layer, cells: new Map(), faces: new Map(), planes: new Map(), open: new Map(), wide: new Map(), grooves };
}
const inMap = (c: Laid, x: number, z: number): boolean => x >= 0 && z >= 0 && x < c.map.w && z < c.map.h;
/** The groove's bottom over a ground px: the px the painter makes a crevice's black (`onPiece`); undefined: none. */
const grooveAt = (c: Laid, u: number, v: number): Plane | undefined => c.grooves.find((g) => onPiece(u, v, g.at[0], g.at[1], g.at[2], g.at[3], g.half))?.p;

// ---- floors
const grid = new Int16Array(STONE_PX * STONE_PX), rows = new Int32Array(STONE_PX);
/** The piece of a cell over a px. */
const pieceAt = (o: Cell, u: number, v: number): Surf => {
  if (o.at) return o.surfs[o.at[(v & 31) * STONE_PX + (u & 31)]];
  for (const s of o.surfs) if (u >= s.u0 && u < s.u1 && v >= s.v0 && v < s.v1) return s;
  throw new Error(`no piece at ${u},${v}`);
};
/** A slab's plane: level stones share one per level, a tilted one has its own. */
function top(c: Laid, b: Block): Plane {
  if (b.hole) return SHAFT;
  if (b.tilt[0] === 0 && b.tilt[1] === 0) return LEVEL[b.level + 1];
  let p = c.planes.get(b.id);
  if (!p) c.planes.set(b.id, p = planeOf(b, (b.level - 1) * LEVEL_STEP));
  return p;
}
/**
 * Beside a floor piece or a grate, and where a crevice runs through laid stone, the stones are no rectangles: there every px is asked.
 * (A cell that is all rock stays one piece under a crevice: its groove is the rock floor's, `rockMesh.ts`, or only painted.)
 */
const marked = (c: Laid, x: number, z: number): boolean => c.marks.grates.some((g) => Math.floor(g.x) === x && Math.floor(g.z) === z)
  || c.marks.pieces.some((p) => x + 1 > p.x - p.r - 0.1 && x < p.x + p.r + 0.1 && z + 1 > p.z - p.r - 0.1 && z < p.z + p.r + 0.1)
  || (c.grooves.some(({ at: [x0, z0, x1, z1], half }) => {
    const r = half / STONE_PX;
    return x + 1 > Math.min(x0, x1) - r && x < Math.max(x0, x1) + r && z + 1 > Math.min(z0, z1) - r && z < Math.max(z0, z1) + r;
  }) && someLaid(c, x, z));
/** Whether any px of the floor cell is laid stone. */
function someLaid(c: Laid, x: number, z: number): boolean {
  for (let v = z * STONE_PX; v < (z + 1) * STONE_PX; v++) for (let u = x * STONE_PX; u < (x + 1) * STONE_PX; u++) if (!slabOf(c.f, c.map, c.marks, u, v).rock) return true;
  return false;
}
/** A cell of this mesh's floor: height 0, not the dip mesh's, not left to another mesh. */
const floorCell = (c: Laid, x: number, z: number): boolean => inMap(c, x, z) && heightAt(c.map, x, z) === 0 && !inDipMesh(c.map, x, z);
/** A floor cell whose slabs are whole rectangles that this mesh draws. */
function open(c: Laid, x: number, z: number): boolean {
  if (!inMap(c, x, z)) return false;
  const key = z * c.map.w + x;
  let o = c.open.get(key);
  if (o === undefined) c.open.set(key, o = floorCell(c, x, z) && !c.skip?.(x, z) && !marked(c, x, z));
  return o;
}
/** A slab as one piece of its chunk: cut at the chunk's borders only, where every cell it lies on there is open; else null (it is cut cell by cell). */
function wide(c: Laid, b: Block, x: number, z: number): Surf | null {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), key = b.id * 0x40000 + cz * 512 + cx;
  let s = c.wide.get(key);
  if (s !== undefined) return s;
  const N = STONE_PX * CHUNK;
  s = { u0: Math.max(b.u0, cx * N), v0: Math.max(b.v0, cz * N), u1: Math.min(b.u1, (cx + 1) * N), v1: Math.min(b.v1, (cz + 1) * N), p: top(c, b) };
  for (let j = s.v0 >> 5; s && j <= (s.v1 - 1) >> 5; j++) for (let i = s.u0 >> 5; i <= (s.u1 - 1) >> 5; i++) if (!open(c, i, j)) { s = null; break; }
  c.wide.set(key, s);
  return s;
}

/**
 * The pieces over the floor cell (x, z), or null where this mesh has no floor (a wall, the dip mesh's cells, beyond the map). An open
 * cell has its slabs (`wide`, or cut at the cell's edges), its rock slabs level at 0, and is one piece where it is all rock. Beside a
 * floor piece or a grate and along a crevice (`marked`) every px takes its block's plane, or the groove's, and px in a row and rows on
 * end with the same plane are one piece: the level stones of a ring together. A cell another mesh draws at height 0 (the woodland's ground) is uncut stone to its neighbours.
 */
function cellOf(c: Laid, x: number, z: number): Cell | null {
  if (!inMap(c, x, z)) return null;
  const key = z * c.map.w + x;
  let cell = c.cells.get(key);
  if (cell !== undefined) return cell;
  const N = STONE_PX, pu = x * N, pv = z * N, whole = { u0: pu, v0: pv, u1: pu + N, v1: pv + N };
  if (!floorCell(c, x, z)) cell = null;
  else if (c.skip?.(x, z)) cell = { at: null, surfs: [{ ...whole, p: UNCUT }] };
  else if (open(c, x, z)) {
    // slabs only: each is a rectangle, found at the first px of a row that none covers yet (a row's covered px are the bits of `rows`)
    cell = { at: null, surfs: [] };
    let laidStone = false;
    rows.fill(0);
    for (let j = 0; j < N; j++) while (rows[j] !== -1) {
      const i = 31 - Math.clz32(~rows[j] & (rows[j] + 1)), s = slabOf(c.f, c.map, c.marks, pu + i, pv + j);
      const i1 = Math.min(N, s.b.u1 - pu), j1 = Math.min(N, s.b.v1 - pv), bits = (i1 === 32 ? -1 : (1 << i1) - 1) & ~((1 << i) - 1);
      for (let jj = j; jj < j1; jj++) rows[jj] |= bits;
      laidStone ||= !s.rock;
      cell.surfs.push((s.rock ? null : wide(c, s.b, x, z)) ?? { u0: pu + i, v0: pv + j, u1: pu + i1, v1: pv + j1, p: s.rock ? LEVEL[2] : top(c, s.b) });
    }
    if (!laidStone) cell = { at: null, surfs: [{ ...whole, p: LEVEL[2] }], rock: true };
  } else {
    const planes: Plane[] = [];
    const index = (p: Plane): number => { const i = planes.indexOf(p); return i >= 0 ? i : planes.push(p) - 1; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      // a crevice's groove, else a slab, a piece's stone (level, so the stones of a ring are one plane) or a grate's shaft; rock lies at the raised level
      const b = floorBlockAt(c.f, c.map, c.marks, pu + i, pv + j);
      grid[j * N + i] = index(grooveAt(c, pu + i, pv + j) ?? (b ? top(c, b) : LEVEL[2]));
    }
    cell = { at: new Uint16Array(N * N), surfs: [] };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = grid[j * N + i];
      if (k < 0) continue;
      let w = 1, h = 1;
      while (i + w < N && grid[j * N + i + w] === k) w++;
      more: for (; j + h < N; h++) for (let ii = i; ii < i + w; ii++) if (grid[(j + h) * N + ii] !== k) break more;
      for (let jj = j; jj < j + h; jj++) { grid.fill(-1, jj * N + i, jj * N + i + w); cell.at!.fill(cell.surfs.length, jj * N + i, jj * N + i + w); }
      cell.surfs.push({ u0: pu + i, v0: pv + j, u1: pu + i + w, v1: pv + j + h, p: planes[k] });
    }
  }
  c.cells.set(key, cell);
  return cell;
}

/** Whether the floor cell (x, z) is rock all over; null: this mesh has no floor there. */
export function floorIsRock(c: Laid, x: number, z: number): boolean | null {
  const cell = cellOf(c, x, z);
  return cell ? !!cell.rock : null;
}
/** The height of the floor piece over the ground point (u, v) in px; null: this mesh has no floor there. */
export function laidHeight(c: Laid, u: number, v: number): number | null {
  const iu = Math.floor(u), iv = Math.floor(v), cell = cellOf(c, iu >> 5, iv >> 5);
  return cell ? hOf(pieceAt(cell, iu, iv).p, u, v) : null;
}

/** The floor pieces that begin in the cell (x, z), with their skirts: a piece that reaches over several cells is drawn from its first. */
export function laidFloor(c: Laid, x: number, z: number, out: Out): void {
  const cell = cellOf(c, x, z);
  if (!cell) return;
  const ou = c.x0 * STONE_PX, ov = c.z0 * STONE_PX;
  const sp: Space = {
    kind: KIND.floor,
    at(u, v) {
      const o = u >> 5 === x && v >> 5 === z ? cell : cellOf(c, u >> 5, v >> 5);
      return o ? pieceAt(o, u, v) : null;
    },
    corner: (u, v, h, su, sv) => ({ p: [u / STONE_PX, h, v / STONE_PX], sheet: [su - ou, sv - ov, c.layer], a: NONE, b: NONE }),
    dir: (du, dv, dh) => [du, dh, dv],
    hidden: () => false,
  };
  for (const s of cell.surfs) if (!s.p.solid && s.u0 >> 5 === x && s.v0 >> 5 === z) shape(s, sp, out);
}

// ---- walls
/** The plane in the cell's edge: the frieze course, and the corner stones of a wall's outer corners. */
const FRONT = flat(0);

/**
 * A wall block's plane: behind the cell's edge by `FRIEZE_OUT` and its level, with its tilt. The frieze lies in the edge, and so does
 * every block that reaches an outer corner of its wall: the two faces of the corner meet in the cell's corner, under the wall top's own.
 */
function wallPlane(c: Laid, face: Face, b: Block): Plane {
  let p = c.planes.get(b.id);
  if (p) return p;
  const s = face.side, h = (j: number, out: number): number => (s < 2 ? heightAt(c.map, j, face.z + out * SIDE_STEP[s][1]) : heightAt(c.map, face.x + out * SIDE_STEP[s][0], j));
  let front = b.frieze;
  for (let j = b.u0 >> 5; !front && j <= (b.u1 - 1) >> 5; j++) {
    // the wall has a face in cell j of this plane, and ends there in an outer corner the block reaches
    front = h(j, 0) > 0 && h(j, 1) < h(j, 0) && ((h(j - 1, 0) < h(j, 0) && b.u0 <= j * STONE_PX) || (h(j + 1, 0) < h(j, 0) && b.u1 >= (j + 1) * STONE_PX));
  }
  c.planes.set(b.id, p = front ? FRONT : planeOf(b, -FRIEZE_OUT + (b.level - 1) * LEVEL_STEP));
  return p;
}

/**
 * The side `s` of the wall cell (x, z) where it borders a lower cell, or null. Its blocks are cut at the face's edges. `rock`: some of it
 * is no block, or the cell is shaped as rock (`rockMesh.ts`): no piece of this mesh, uncut stone in the cell's edge to its neighbours.
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
    fs = { face, h, hn, rock: rockWall(c.f, c.map, x, z), surfs: [] };
    courses: for (let k = 0; !fs.rock && k + 1 < COURSES.length; k++) {
      if (COURSES[k + 1] <= V0 || COURSES[k] >= V1) continue;
      for (let u = U0; u < U0 + STONE_PX;) {
        const b = wallBlockAt(c.f, c.map, face, u, COURSES[k]);
        if (!b) { fs.rock = true; fs.surfs = []; break courses; }
        fs.surfs.push({ u0: Math.max(b.u0, U0), v0: Math.max(b.v0, V0), u1: Math.min(b.u1, U0 + STONE_PX), v1: Math.min(b.v1, V1), p: wallPlane(c, face, b) });
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
 * end where the wall goes on without a face, or with a rock face. A skirt that faces down, under a block that stands out further than the
 * one below it, is left out: the camera looks from above.
 */
export function laidFace(c: Laid, fs: FaceShape, out: Out): void {
  const { x, z, side: s } = fs.face, [dx, dz] = SIDE_STEP[s], U0 = (s < 2 ? x : z) * STONE_PX, U1 = U0 + STONE_PX;
  const V0 = (WALL_H - fs.h) * STONE_PX, V1 = (WALL_H - fs.hn) * STONE_PX, slot = c.plan.slotOf(fs.face);
  /** The plane of the cell's edge the face looks out of. */
  const edge = (s < 2 ? z : x) + (s === 0 || s === 2 ? 1 : 0);
  const sp: Space = {
    kind: KIND.face,
    at(u, v) {
      if (v < V0) return null; // under the top's rim: nobody sees that skirt
      if (v >= V1) return OUT;
      if (u >= U0 && u < U1) return surfAt(fs, u, v);
      const d = u < U0 ? -1 : 1, bx = s < 2 ? x + d : x, bz = s < 2 ? z : z + d, g = faceOf(c, bx, bz, s);
      if (g) return g.rock ? OUT : surfAt(g, u, v) ?? OUT;
      return heightAt(c.map, bx, bz) < fs.h ? null : OUT; // an outer corner (its stones lie in the edge), or the wall goes on without a face
    },
    corner(u, v, h, su, sv, skirt) {
      const y = WALL_H - v / STONE_PX, pos: Vec3 = s < 2 ? [u / STONE_PX, y, edge + dz * h] : [edge + dx * h, y, u / STONE_PX];
      const reach = -h + (skirt ? SKIRT_PUSH : 0), push: [number, number] = [dx * reach, dz * reach];
      if (skirt) {
        // both wall planes read the block's own px, whichever way the skirt faces
        const own: Vec3 = [slot.u + Math.min(FACE_W, Math.max(0, su - U0)), slot.v + Math.min(FACE_H, Math.max(0, sv)), slot.layer];
        return { p: pos, sheet: NONE, a: own, b: own, push };
      }
      const own: Vec3 = [slot.u + u - U0, slot.v + v, slot.layer];
      return { p: pos, sheet: [(pos[0] - c.x0) * STONE_PX, (pos[2] - c.z0) * STONE_PX, c.layer], a: s < 2 ? own : NONE, b: s < 2 ? NONE : own, push };
    },
    dir: (du, dv, dh) => (s < 2 ? [du + dx * dh, -dv, dz * dh] : [dx * dh, -dv, du + dz * dh]),
    hidden: (_du, dv) => dv > 0,
  };
  for (const o of fs.surfs) shape(o, sp, out);
}
