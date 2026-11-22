// The block layout of laid stone (#380 parts 3 and 4): which block covers each stone px of a floor or a wall, and each block's rectangle,
// stone, level and tilt. The painter and the mesh both read it, so paint and shape agree. Pure: no three, nothing that draws.
// Every block follows from the seed and its own position, so a query looks at a few neighbours only and never at the whole map.
import type { TileMap } from '../../sim/map';
import { inDipMesh } from '../dips/shape';
import { heightAt } from '../heights';
import { hash, rockAmount, STONE_PX, type StoneField } from './field';
import type { FloorPiece, Grate, Marks } from './place';
import type { Face } from './plan';

export interface Block {
  /** Stable for a seed; floor slabs, wall blocks and piece stones never share one. */
  id: number;
  /**
   * Stone px in the plane's own space (ground: world px; wall: world px along the wall, px down from its top), `u1` and `v1` exclusive.
   * A slab or wall block is this rectangle, except where a floor piece covers part of a slab. A piece's stone is not a rectangle:
   * this is then its bounding box, and `floorBlockAt` decides which px belong to it.
   */
  u0: number; v0: number; u1: number; v1: number;
  /** Brown, grey, sandstone. */
  stone: 0 | 1 | 2;
  /** Sunk, flush, raised. */
  level: -1 | 0 | 1;
  /** Height per px along u and v (tiles). The block's highest corner lies at its level and the rest falls away from it, so no point rises above the level. */
  tilt: [number, number];
  /** A wall block of the frieze course. */
  frieze: boolean;
  /** A wedge or the disc (ring 0) of a circle, a field of a mosaic. */
  piece?: { of: FloorPiece; ring: number; index: number };
  /** The shaft of a drain grate: no stone, a hole (the mesh sinks it, the painter makes it dark). */
  hole?: true;
}

// First guesses, all of them.
/**
 * Tiles between two levels; floors: raised 0, flush -STEP, sunk -2 * STEP; walls the same into the wall, behind the frieze (`laidMesh.ts`).
 * 0.03 was too little to see at the game's zoom; at 0.045 a step is a good stone px.
 */
export const LEVEL_STEP = 0.045;
/** The shares of sunk and raised blocks; the rest is flush. */
const SUNK = 0.18, RAISED = 0.14;
/** The most a block falls along one of its sides by its tilt (tiles): a small block leans more steeply than a long slab, and none sinks far. */
const TILT_DROP = 0.025;
/** The shares of brown and grey blocks; the rest is sandstone. */
const BROWN = 0.5, GREY = 0.27;
/** The floor's slabs: one per cell of this grid (px), whose corners are shifted by up to the jitter (below half a cell). */
const SLAB_U = 34, SLAB_V = 22, SLAB_JU = 11, SLAB_JV = 7;
/** A slab at least this long (px) is cut in two with this chance; the cut lies at `SPLIT_FROM` to `SPLIT_FROM + SPLIT_SPAN` of its length. */
const SPLIT_MIN = 26, SPLIT_SHARE = 0.4, SPLIT_FROM = 0.35, SPLIT_SPAN = 0.3;
/** The walls' courses: their edges in px down from the wall's top (64 px), and the one that is the frieze, just below the top third. */
export const COURSES = [0, 10, 21, 29, 41, 52, 64];
export const FRIEZE_COURSE = 2;
/** A frieze block's width (px): all alike, so the carving repeats. */
export const FRIEZE_W = 16;
/** A wall course's upright joints: one per this many px, shifted by up to the jitter; odd courses start half a step on. A joint is left out with the share `WALL_DROP`. */
const WALL_U = 16, WALL_JU = 3, WALL_DROP = 0.35;
/** A circle's rings: their outer edges as shares of the radius (ring 0 is the centre disc), and the stones in each. */
export const CIRCLE_RINGS = [0.16, 0.36, 0.58, 0.84, 1];
export const CIRCLE_STONES = [1, 6, 10, 12, 28];
/** The ring whose stones each get a carved rune. */
export const RUNE_RING = 3;
/** A mosaic's tessera (px), the width of its diamond bands and of its border (tesserae). */
export const MOSAIC_TESSERA = 4;
const MOSAIC_BAND = 5, MOSAIC_BORDER = 2;
/** The ring number of a mosaic's border. */
export const MOSAIC_BORDER_RING = 99;
/** A drain grate's shaft: a square of this many px in the middle of its cell. */
export const GRATE_PX = 16;

// The ids pack a block's place into bit fields (slab cell, wall plane, course and joint, piece and stone): they assume a map of fewer than
// 1024 cells a side and px no lower than -64.
const WALL_ID = 2 ** 29, PIECE_ID = 2 ** 30, HOLE_ID = 2 ** 28;
const GREY_STONE = 1, SAND = 2;

/** A block, and whether it is rock (then the queries answer null). */
interface Made { b: Block; rock: boolean }
// The blocks made so far for one field and map: the painter asks px by px, so nearly every call finds its block here.
// shortcut: a door that appears or goes within 2.5 tiles of a block made earlier does not change whether that block is rock; empty `made` on such a tile change if the game ever makes one
let made = new Map<number, Made>(), madeF: StoneField | null = null, madeMap: TileMap | null = null, madeMarks: Marks | null = null;
/** `made` is emptied at this size, so it never grows with the map. */
const MADE_MAX = 20000;

/** A floor cell beside one the dip mesh draws: its stone lies level with that mesh's rim, at height 0. */
const besideDip = (map: TileMap, x: number, z: number): boolean =>
  heightAt(map, x, z) === 0 && !inDipMesh(map, x, z) && (inDipMesh(map, x + 1, z) || inDipMesh(map, x - 1, z) || inDipMesh(map, x, z + 1) || inDipMesh(map, x, z - 1));

/** The level of a floor piece's stones: flush, or raised where it reaches a cell beside a dip. */
function pieceLie(map: TileMap, p: FloorPiece): 0 | 1 {
  for (let z = Math.floor(p.z - p.r); z <= Math.floor(p.z + p.r); z++) for (let x = Math.floor(p.x - p.r); x <= Math.floor(p.x + p.r); x++) {
    if (Math.hypot(Math.max(x - p.x, 0, p.x - x - 1), Math.max(z - p.z, 0, p.z - z - 1)) < p.r && besideDip(map, x, z)) return 1;
  }
  return 0;
}

/**
 * Where a slab must lie level, whatever its own number says: raised (height 0) where it reaches a cell beside a dip, so the floor meets
 * the dip mesh without a step; at a floor piece's level where it touches the piece, so the ground round a piece is level; flush round a
 * grate. Null: free.
 */
// shortcut: a block keeps the level it was made with (`made`), and the view rebuilds only the chunks a changed tile touches, so a tile change that makes or unmakes a dip-mesh cell (a wall opening one cell from a chasm) can leave a step of one level at that cell's edge; empty `made` and rebuild the chunks within two tiles if levels get such changes.
function lieOf(map: TileMap, marks: Marks, u0: number, v0: number, u1: number, v1: number): 0 | 1 | null {
  for (let z = v0 >> 5; z <= (v1 - 1) >> 5; z++) for (let x = u0 >> 5; x <= (u1 - 1) >> 5; x++) if (besideDip(map, x, z)) return 1;
  for (const p of marks.pieces) {
    const cx = p.x * STONE_PX, cz = p.z * STONE_PX;
    if (Math.hypot(Math.max(u0 - cx, 0, cx - u1), Math.max(v0 - cz, 0, cz - v1)) < p.r * STONE_PX + 1) return pieceLie(map, p);
  }
  // round a grate's shaft the floor is flush, so its bars lie at one depth below every edge
  for (const g of marks.grates) if (Math.max(u0 - g.x * STONE_PX, g.x * STONE_PX - u1, v0 - g.z * STONE_PX, g.z * STONE_PX - v1) < GRATE_PX / 2 + 1) return 0;
  return null;
}

/**
 * The block `id` with its rectangle. It is rock as a whole: the rock at its centre (x, z in tiles) against its own number, which breaks
 * the border up block by block. A frieze block is raised, level sandstone.
 */
function block(f: StoneField, map: TileMap, marks: Marks | null, id: number, u0: number, v0: number, u1: number, v1: number, x: number, z: number, frieze = false): Made {
  if (madeF !== f || madeMap !== map || (marks && madeMarks !== marks) || made.size >= MADE_MAX) {
    made = new Map(); madeF = f; madeMap = map; madeMarks = marks ?? madeMarks;
    lastFloor = lastWall = null; // they were made for the field, map and marks before
  }
  let m = made.get(id);
  if (m) return m;
  const s = hash(f.seed, id, 1, 31), l = hash(f.seed, id, 2, 31);
  const lie = frieze ? 1 : marks ? lieOf(map, marks, u0, v0, u1, v1) : null;
  m = {
    b: {
      id, u0, v0, u1, v1,
      stone: frieze ? SAND : s < BROWN ? 0 : s < BROWN + GREY ? 1 : 2,
      level: lie ?? (l >= 1 - RAISED ? 1 : l < SUNK ? -1 : 0),
      tilt: lie !== null ? [0, 0] : [((hash(f.seed, id, 3, 31) * 2 - 1) * TILT_DROP) / (u1 - u0), ((hash(f.seed, id, 4, 31) * 2 - 1) * TILT_DROP) / (v1 - v0)],
      frieze,
    },
    rock: rockAmount(f, map, x, z) > hash(f.seed, id, 5, 31),
  };
  made.set(id, m);
  return m;
}

// ---- floor slabs: a pinwheel of rectangles. Each grid corner has a shifted point; through it runs a level joint (even corners) or an
// upright one (odd corners) that ends at the joints of the corners beside it. No joint is longer than two cells.
const cu = (seed: number, i: number, j: number): number => i * SLAB_U + Math.round((hash(seed, i, j, 11) * 2 - 1) * SLAB_JU);
const cv = (seed: number, i: number, j: number): number => j * SLAB_V + Math.round((hash(seed, i, j, 12) * 2 - 1) * SLAB_JV);

function slabAt(f: StoneField, map: TileMap, marks: Marks, pu: number, pv: number): Made {
  const s = f.seed, i0 = Math.floor(pu / SLAB_U), j0 = Math.floor(pv / SLAB_V);
  for (const dj of [0, -1, 1]) for (const di of [0, -1, 1]) {
    const i = i0 + di, j = j0 + dj, odd = (i + j) & 1;
    let u0 = odd ? cu(s, i, j) : cu(s, i, j + 1), u1 = odd ? cu(s, i + 1, j + 1) : cu(s, i + 1, j);
    if (pu < u0 || pu >= u1) continue;
    let v0 = odd ? cv(s, i + 1, j) : cv(s, i, j), v1 = odd ? cv(s, i, j + 1) : cv(s, i + 1, j + 1);
    if (pv < v0 || pv >= v1) continue;
    let half = 0;
    const wide = u1 - u0 >= v1 - v0, long = wide ? u1 - u0 : v1 - v0;
    if (long >= SPLIT_MIN && hash(s, i, j, 13) < SPLIT_SHARE) {
      const cut = (wide ? u0 : v0) + Math.round(long * (SPLIT_FROM + SPLIT_SPAN * hash(s, i, j, 14)));
      half = (wide ? pu : pv) < cut ? 0 : 1;
      if (wide) { if (half) u0 = cut; else u1 = cut; } else if (half) v0 = cut; else v1 = cut;
    }
    return block(f, map, marks, ((j + 2) * 8192 + i + 2) * 2 + half, u0, v0, u1, v1, (u0 + u1) / 2 / STONE_PX, (v0 + v1) / 2 / STONE_PX);
  }
  throw new Error(`no slab at ${pu},${pv}`); // the jitter is below half a cell, so one of the nine cells holds the px
}

// ---- floor pieces: every px of a piece's disc is worked out once, which also gives each stone's bounding box.
interface PieceStones { seed: number; salt: number; u0: number; v0: number; n: number; at: Int16Array; blocks: Block[] }
const pieceStones = new WeakMap<FloorPiece, PieceStones>();

/** The share of a full turn a circle's ring is turned by; `salt` is the piece's place in the marks. The painter sets each rune by it. */
export const circleTurn = (seed: number, salt: number, ring: number): number => hash(seed, salt, ring, 41);

/** Ring and index of the stone at (du, dv) px from a circle's centre, `k` the distance as a share of the radius. */
function circleStone(seed: number, salt: number, du: number, dv: number, k: number): [number, number] {
  const ring = CIRCLE_RINGS.findIndex((edge) => k < edge);
  const turn = Math.atan2(dv, du) / (Math.PI * 2) + circleTurn(seed, salt, ring) + 1; // each ring is turned by its own angle, so the joints do not line up
  return [ring, Math.floor((turn % 1) * CIRCLE_STONES[ring])];
}

/** A mosaic: diamond bands round the centre inside a border ring. The tessera a px lies in decides, so the bands' edges run along tesserae. */
function mosaicStone(r: number, du: number, dv: number): [number, number] {
  const tu = Math.floor(du / MOSAIC_TESSERA) + 0.5, tv = Math.floor(dv / MOSAIC_TESSERA) + 0.5;
  if (Math.hypot(tu, tv) * MOSAIC_TESSERA >= r - MOSAIC_BORDER * MOSAIC_TESSERA) return [MOSAIC_BORDER_RING, 0];
  return [Math.floor((Math.abs(tu) + Math.abs(tv)) / MOSAIC_BAND), 0];
}

function stonesOf(f: StoneField, map: TileMap, marks: Marks, p: FloorPiece): PieceStones {
  let t = pieceStones.get(p);
  const salt = marks.pieces.indexOf(p);
  if (t && t.seed === f.seed && t.salt === salt) return t; // the stones follow the seed and the piece's place in the marks
  const cx = p.x * STONE_PX, cz = p.z * STONE_PX, r = p.r * STONE_PX;
  const u0 = Math.floor(cx - r), v0 = Math.floor(cz - r), n = Math.max(Math.ceil(cx + r) - u0, Math.ceil(cz + r) - v0);
  t = { seed: f.seed, salt, u0, v0, n, at: new Int16Array(n * n).fill(-1), blocks: [] };
  const byKey = new Map<number, number>(), level = pieceLie(map, p);
  for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
    const du = u0 + u + 0.5 - cx, dv = v0 + v + 0.5 - cz, d = Math.hypot(du, dv);
    if (d >= r) continue;
    const [ring, index] = p.kind === 'circle' ? circleStone(f.seed, salt, du, dv, d / r) : mosaicStone(r, du, dv);
    const key = ring * 256 + index;
    let i = byKey.get(key);
    if (i === undefined) {
      i = t.blocks.length;
      byKey.set(key, i);
      // level ground: every stone flush and untilted. A circle's rings go pale, dark from the disc outward (the rune ring dark, the rim pale);
      // a mosaic's bands take the three stones in turn.
      const stone = p.kind === 'mosaic' ? (ring === MOSAIC_BORDER_RING ? GREY_STONE : ((ring + 2) % 3)) : ring % 2 ? GREY_STONE : SAND;
      t.blocks.push({ id: PIECE_ID + (salt * 128 + (ring % 128)) * 256 + index, u0: u0 + u, v0: v0 + v, u1: u0 + u + 1, v1: v0 + v + 1, stone: stone as 0 | 1 | 2, level, tilt: [0, 0], frieze: false, piece: { of: p, ring, index } });
    }
    const b = t.blocks[i];
    b.u0 = Math.min(b.u0, u0 + u); b.u1 = Math.max(b.u1, u0 + u + 1); b.v1 = v0 + v + 1;
    t.at[v * n + u] = i;
  }
  pieceStones.set(p, t);
  return t;
}

// The last answer of each query, tried first: the next px along a row mostly lies in the same block.
let lastFloor: Made | null = null, lastWall: Made | null = null, lastPlane = -1;
const holds = (m: Made | null, f: StoneField, map: TileMap, pu: number, pv: number): m is Made =>
  m !== null && madeF === f && madeMap === map && pu >= m.b.u0 && pu < m.b.u1 && pv >= m.b.v0 && pv < m.b.v1;

/**
 * The laid block over a ground px (world px, 32 per tile), or null where the ground is rock there.
 * A floor piece's stones replace the slabs inside its radius; they are always laid.
 */
export function floorBlockAt(f: StoneField, map: TileMap, marks: Marks, px: number, pz: number): Block | null {
  const m = markAt(marks, px, pz);
  if (!m) {
    const s = slabOf(f, map, marks, px, pz);
    return s.rock ? null : s.b;
  }
  if ('kind' in m) {
    const t = stonesOf(f, map, marks, m);
    return t.blocks[t.at[(pz - t.v0) * t.n + px - t.u0]];
  }
  let b = holes.get(m);
  if (!b) {
    const u0 = m.x * STONE_PX - GRATE_PX / 2, v0 = m.z * STONE_PX - GRATE_PX / 2;
    holes.set(m, b = { id: HOLE_ID + marks.grates.indexOf(m), u0, v0, u1: u0 + GRATE_PX, v1: v0 + GRATE_PX, stone: GREY_STONE, level: -1, tilt: [0, 0], frieze: false, hole: true });
  }
  return b;
}
const holes = new WeakMap<Grate, Block>();

/** The grate whose shaft, or the floor piece whose stones, a ground px belongs to; null: a slab's px. */
export function markAt(marks: Marks, px: number, pz: number): Grate | FloorPiece | null {
  for (const g of marks.grates) if (Math.abs(px + 0.5 - g.x * STONE_PX) < GRATE_PX / 2 && Math.abs(pz + 0.5 - g.z * STONE_PX) < GRATE_PX / 2) return g;
  for (const p of marks.pieces) {
    const du = px + 0.5 - p.x * STONE_PX, dv = pz + 0.5 - p.z * STONE_PX, r = p.r * STONE_PX;
    if (du * du + dv * dv < r * r) return p;
  }
  return null;
}
/** The one px of a grate's shaft that is painted iron: the bars read their colour there (the default camera sees it behind the shaft's near side). */
export const ironPx = (hole: Block): [number, number] => [hole.u0, hole.v1 - 1];

/**
 * The slab over a ground px whatever its stone, and whether it is rock: the mesh fills whole rectangles by it. It knows no floor piece
 * and no grate: ask only away from them.
 */
export function slabOf(f: StoneField, map: TileMap, marks: Marks, px: number, pz: number): { b: Block; rock: boolean } {
  if (madeMarks !== marks || !holds(lastFloor, f, map, px, pz)) lastFloor = slabAt(f, map, marks, px, pz);
  return lastFloor;
}

/** The upright joint `k` of a course: where it stands, and whether it is there (every third one always is, so no block grows without end). */
const jointAt = (seed: number, row: number, k: number): number => k * WALL_U + (row & 1 ? WALL_U / 2 : 0) + Math.round((hash(seed, row, k, 21) * 2 - 1) * WALL_JU);
const jointStands = (seed: number, row: number, k: number): boolean => (k + Math.floor(hash(seed, row, 0, 23) * 3)) % 3 === 0 || hash(seed, row, k, 22) >= WALL_DROP;

/**
 * The laid block over a wall px of the plane of `face`, or null where that wall is rock. `pu` is the world px along the wall (x for
 * sides 0 and 1, z for sides 2 and 3: the face's own px plus 32 times its cell), so blocks run on across the faces of a plane;
 * `pv` is px down from the wall's top.
 */
export function wallBlockAt(f: StoneField, map: TileMap, face: Face, pu: number, pv: number): Block | null {
  const across = face.side < 2, plane = face.side * 1024 + (across ? face.z : face.x);
  if (lastPlane === plane && holds(lastWall, f, map, pu, pv)) return lastWall.rock ? null : lastWall.b;
  let course = 0;
  while (course < COURSES.length - 2 && pv >= COURSES[course + 1]) course++;
  const row = plane * 8 + course, frieze = course === FRIEZE_COURSE;
  let k = Math.floor(pu / FRIEZE_W), u0 = k * FRIEZE_W, u1 = u0 + FRIEZE_W;
  if (!frieze) {
    k = Math.floor(pu / WALL_U) + 1;
    while (!jointStands(f.seed, row, k) || jointAt(f.seed, row, k) > pu) k--;
    let next = k + 1;
    while (!jointStands(f.seed, row, next)) next++;
    u0 = jointAt(f.seed, row, k); u1 = jointAt(f.seed, row, next);
  }
  // the block's centre on the ground: on the edge of the face's cell that the side looks out of
  const along = (u0 + u1) / 2 / STONE_PX, off = face.side === 0 || face.side === 2 ? 1 : 0;
  lastWall = block(f, map, null, WALL_ID + row * 4096 + k + 8, u0, COURSES[course], u1, COURSES[course + 1], across ? along : face.x + off, across ? face.z + off : along, frieze);
  lastPlane = plane;
  return lastWall.rock ? null : lastWall.b;
}

/** The blocks a scan of `w` by `h` px from (u0, v0) meets, each once, in the order met. */
function met(at: (u: number, v: number) => Block | null, u0: number, v0: number, w: number, h: number): Block[] {
  const out = new Map<number, Block>();
  for (let v = v0; v < v0 + h; v++) for (let u = u0; u < u0 + w; u++) {
    const b = at(u, v);
    if (b && !out.has(b.id)) out.set(b.id, b);
  }
  return [...out.values()];
}

/** Every block that touches the floor cell (x, z), each once: what the mesh iterates. */
export function floorBlocksOf(f: StoneField, map: TileMap, marks: Marks, x: number, z: number): Block[] {
  return met((u, v) => floorBlockAt(f, map, marks, u, v), x * STONE_PX, z * STONE_PX, STONE_PX, STONE_PX);
}

/** Every block that touches the face, each once. */
export function wallBlocksOf(f: StoneField, map: TileMap, face: Face): Block[] {
  return met((u, v) => wallBlockAt(f, map, face, u, v), (face.side < 2 ? face.x : face.z) * STONE_PX, 0, STONE_PX, COURSES[COURSES.length - 1]);
}
