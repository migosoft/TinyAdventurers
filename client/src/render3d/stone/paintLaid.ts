// The painter of laid stone (#380 part 3): what one stone px of a floor, a wall top or a wall face looks like, as colour and relief.
// Nothing here is shaded from a direction: a bevel, a chip, a tilt or a carving is a slope that the game's lights shade; the only dark
// that is painted is material (mortar, a crack, the dirt in a carving, moss). Pure: no three. Every number is a first guess.
import { MOSS_TONES, mossSource } from '../cover/moss';
import type { CoverSource } from '../cover/source';
import { DIP, OUTLINE_EDGE, dipOf, inDipMesh, maskAt } from '../dips/shape';
import { heightAt } from '../heights';
import { STONE } from '../light';
import type { TileMap } from '../../sim/map';
import { CIRCLE_RINGS, CIRCLE_STONES, MOSAIC_BORDER_RING, MOSAIC_TESSERA, RUNE_RING, circleTurn, floorBlockAt, ironPx, wallBlockAt, type Block } from './blocks';
import { STONE_PX, hash, type StoneField } from './field';
import { FACE_H, FLAG, FLAT_A, encodeRelief } from './format';
import { CHUNK } from './grid';
import type { FloorPiece, Marks } from './place';
import type { Face } from './plan';

type Rgb = readonly [number, number, number];

// ---- colours. Each stone has five tones of one named base colour (index 2), dark to light; a block takes one of the middle three and its
// grain the tones beside it.
const TONE = [0.68, 0.84, 1, 1.16, 1.34];
export const tones = (c: Rgb): number[] => TONE.flatMap((k) => c.map((x) => Math.min(255, Math.round(x * k))));
/** The three stones of floors and walls: brown, grey, sandstone (`Block.stone`). */
const STONES = [tones([98, 78, 68]), tones([84, 82, 88]), tones([134, 106, 74])];
/** A wall top's capping slabs: the old top's cool `STONE`. */
export const CAP = tones([STONE[0] * 255, STONE[1] * 255, STONE[2] * 255]);
/** A summoning circle's dark and pale rings. */
const CIRCLE_DARK = tones([62, 64, 78]), CIRCLE_PALE = tones([146, 128, 100]);
/** A mosaic's tesserae by `Block.stone` (terracotta, slate, cream) and its border. */
const MOSAIC = [tones([140, 66, 46]), tones([58, 76, 102]), tones([176, 156, 116])], MOSAIC_EDGE = tones([70, 60, 58]);
/** The edge stones round a pool, lava or a chasm. */
const RIM = tones([112, 104, 98]);
export const MORTAR: Rgb = [38, 31, 31], CRACK: Rgb = [20, 16, 17];
const TESSERA_JOINT: Rgb = [54, 46, 42];
/** The mean of the pack's `floor_1` tile, the old dungeon floor: what a laid page's mean colour stays near, by `MEAN_TOLERANCE` per channel. */
export const OLD_FLOOR: Rgb = [73, 59, 58];
export const MEAN_TOLERANCE = 36;

// ---- relief
/** A block's bevel by level (sunk, flush, raised): the slope of the px beside the joint, and of the next one. */
const BEVEL = [[0.25], [0.5], [0.5, 0.25]];
/** A mosaic tessera's lean. (A block's tilt is not painted: it is the mesh's, `laidMesh.ts`.) */
const TESSERA_LEAN = 0.1;
/** A drain grate's shaft and its dark iron. */
const SHAFT: Rgb = [9, 8, 10], IRON: Rgb = [56, 58, 68];
/** The share of blocks with a chipped corner, its size range (px) and its slope on both axes. */
const CHIP_SHARE = 0.3, CHIP_MIN = 2, CHIP_SPAN = 3, CHIP_SLOPE = 0.5;
/** The share of blocks with a crack, and the shortest side (px) of a block that may have one. */
const CRACK_SHARE = 0.035, CRACK_MIN = 10;
/** A crack's pieces: each this share of the block's shorter side long (from, span), turned from the one before by up to half of `CRACK_TURN` (radians) either way. */
const CRACK_LEN = 0.35, CRACK_LEN_SPAN = 0.3, CRACK_TURN = 1;
/** Grain: the shares of single darker and lighter px, and of the 4 px runs that hold a darker streak. */
const GRAIN_DARK = 0.05, GRAIN_LIGHT = 0.03, STREAK = 0.035;
/** The slope of a carving's wall (frieze, rune). */
const CARVE = 0.5;
/** Moss in a damp patch: the share of groove px it fills and of the px beside a groove it creeps onto; on a wall both times the square of the height below the top. */
const MOSS_GROOVE = 0.8;
export const MOSS_CREEP = 0.3;
/** The rim round a dip: the outline's mask from which the edge stones lie (the outline itself is `OUTLINE_EDGE`), and a stone's length (px). */
const RIM_FROM = 0.2, RIM_LEN = 11;
/** A rune's cell (px); a glyph is 5 by 6 cells, so 15 by 18 px in the rune ring's 25. The share of a cell beside a cut one that is the cut's wall. */
const RUNE_CELL = 3, RUNE_WALL = 1 / 3;
/** The share of a mosaic's tesserae that are a tone darker, and a tone lighter, than their band. */
const MOSAIC_ODD = 0.15;
/** The ground of a rune's cut: the dirt that has gathered in it; and the tone of the ring's stone its walls have. */
const RUNE: Rgb = [24, 21, 26], RUNE_TONE = 2;

/** The frieze's carving, one block (16 px) wide, in the rows 2 to 6 of its course: a bar, a diamond, a bar. */
const FRIEZE = ['........#.......', '..##...###...##.', '..##..#####..##.', '..##...###...##.', '........#.......'];
/** The runes: 5 by 6 cells each, the top toward the circle's rim. */
export const RUNES = [
  ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..'], ['..#..', '.#.#.', '#...#', '#...#', '.#.#.', '..#..'],
  ['#####', '....#', '..##.', '..#..', '..#..', '..#..'], ['#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  ['.###.', '#....', '.##..', '...#.', '....#', '.###.'], ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..'], ['#....', '#....', '####.', '#...#', '#...#', '####.'],
  ['#####', '..#..', '..#..', '.###.', '..#..', '..#..'], ['#.#.#', '#.#.#', '#.#.#', '.###.', '..#..', '..#..'],
  ['.###.', '#...#', '#...#', '.###.', '..#..', '.###.'], ['#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#####'],
];
const cut = (rows: readonly string[], x: number, y: number): boolean => rows[y]?.[x] === '#';

/** The relief byte; never 0, which is no texel at all (the one slope pair that would give it leans a step less). */
export const relief = (du: number, dv: number, flag: number): number =>
  du === 0 && dv === 0 && flag === FLAG.plain ? FLAT_A : encodeRelief(du, dv, flag) || encodeRelief(du, -0.25, flag);

export function put(out: Uint8Array, at: number, pal: readonly number[], tone: number, a: number): void {
  const i = (tone < 0 ? 0 : tone > 4 ? 4 : tone) * 3;
  out[at] = pal[i]; out[at + 1] = pal[i + 1]; out[at + 2] = pal[i + 2]; out[at + 3] = a;
}

/** A groove px: the joint's mortar or a crack, or moss where it is damp. */
export function groove(out: Uint8Array, at: number, seed: number, u: number, v: number, c: Rgb, damp: number): void {
  if (damp > 0 && hash(seed, u, v, 54) < MOSS_GROOVE * damp) c = MOSS_TONES[Math.floor(hash(seed, u, v, 55) * 3)];
  out[at] = c[0]; out[at + 1] = c[1]; out[at + 2] = c[2]; out[at + 3] = relief(0, 0, FLAG.groove);
}

// ---- cracks: a jagged line of two or three straight pieces from one edge into the block, sometimes with a branch; its px by block.
const cracks = new WeakMap<Block, Set<number> | null>();
function crackOf(seed: number, b: Block): Set<number> | null {
  let c = cracks.get(b);
  if (c !== undefined) return c;
  c = null;
  const w = b.u1 - b.u0, h = b.v1 - b.v0, rnd = (k: number): number => hash(seed, b.id, k, 61);
  if (!b.frieze && !b.piece && Math.min(w, h) >= CRACK_MIN && rnd(0) < CRACK_SHARE) {
    const px = new Set<number>(), side = Math.floor(rnd(1) * 4);
    // the first px inside the joint and the bevel on the side it starts from
    let x = side < 2 ? 3 + rnd(2) * (w - 6) : side === 2 ? 2 : w - 2, y = side < 2 ? (side === 0 ? 2 : h - 2) : 3 + rnd(2) * (h - 6);
    let a = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][side] + (rnd(3) - 0.5) * 1.1;
    const line = (x0: number, y0: number, ang: number, len: number): [number, number] => {
      const n = Math.ceil(len * Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang))));
      let ex = x0, ey = y0;
      for (let i = 0; i <= n; i++) {
        const lx = Math.floor(x0 + (Math.cos(ang) * len * i) / n), ly = Math.floor(y0 + (Math.sin(ang) * len * i) / n);
        if (lx < 2 || ly < 2 || lx >= w - 1 || ly >= h - 1) break; // it stays off the joints and their bevels
        px.add(ly * 256 + lx); ex = lx + 0.5; ey = ly + 0.5;
      }
      return [ex, ey];
    };
    const pieces = rnd(4) < 0.5 ? 3 : 2;
    for (let i = 0; i < pieces; i++) {
      [x, y] = line(x, y, a, (CRACK_LEN + rnd(5 + i) * CRACK_LEN_SPAN) * Math.min(w, h));
      if (i === 0 && rnd(9) < 0.4) line(x, y, a + (rnd(10) < 0.5 ? 0.9 : -0.9), 0.25 * Math.min(w, h));
      a += (rnd(11 + i) - 0.5) * CRACK_TURN;
    }
    c = px;
  }
  cracks.set(b, c);
  return c;
}

/**
 * One px of a block that is not a joint: bevel, chip, tilt, crack, grain, creeping moss. `kl`, `kt`, `kr`, `kb` are the px between it and
 * the joint on each side (0: beside it); `bevel` the row of `BEVEL`; `plain` a stone without tilt, chip and crack (a top, a rim stone, a wedge).
 */
function stonePx(out: Uint8Array, at: number, seed: number, b: Block, pal: readonly number[], u: number, v: number, kl: number, kt: number, kr: number, kb: number, bevel: number, plain: boolean, damp: number): void {
  if (!plain && crackOf(seed, b)?.has((v - b.v0) * 256 + u - b.u0)) return groove(out, at, seed, u, v, CRACK, damp);
  const bev = BEVEL[bevel];
  let du = (bev[kl] ?? 0) - (bev[kr] ?? 0), dv = (bev[kt] ?? 0) - (bev[kb] ?? 0);
  if (!plain) {
    if (hash(seed, b.id, 8, 31) < CHIP_SHARE) {
      const corner = Math.floor(hash(seed, b.id, 9, 31) * 4), right = corner & 1, low = corner & 2;
      if ((right ? kr : kl) + (low ? kb : kt) < CHIP_MIN + Math.floor(hash(seed, b.id, 10, 31) * CHIP_SPAN)) { du = right ? -CHIP_SLOPE : CHIP_SLOPE; dv = low ? -CHIP_SLOPE : CHIP_SLOPE; }
    }
  }
  const a = relief(du, dv, FLAG.plain);
  if (damp > 0 && (kl === 0 || kt === 0 || kr === 0 || kb === 0) && hash(seed, u, v, 53) < MOSS_CREEP * damp) {
    const c = MOSS_TONES[Math.floor(hash(seed, u, v, 55) * 3)];
    out[at] = c[0]; out[at + 1] = c[1]; out[at + 2] = c[2]; out[at + 3] = a;
    return;
  }
  // the block's own tone, one of the middle three, and its grain
  let tone = 1 + Math.floor(hash(seed, b.id, 6, 31) * 3);
  const g = hash(seed, u, v, 51);
  if (g < GRAIN_DARK || hash(seed, (u + v * 3) >> 2, v, 52) < STREAK) tone--;
  else if (g > 1 - GRAIN_LIGHT) tone++;
  put(out, at, pal, tone, a);
}

// ---- the damp patches: the moss cover's own source, worked a tile row at a time as the painter reaches it.
// shortcut: the painter keeps its own moss source (the cover job makes a second one, and only that one knows the cove, where this one
// may paint moss into joints under the grass, and the cover's options, so on a dev page that passes `everywhere` or `ignoreLava` paint
// and cover disagree); share the cover job's source if the two disagree.
let moss: { map: TileMap; marks: Marks; src: CoverSource | null; rows: Uint8Array } | null = null;
/** Drops the moss source (6 bytes per map px) and the last block's plain answer: the paint job calls it when its last unit is done. */
export const forgetMoss = (): void => { moss = null; plainFor = null; };
/** Whether moss grows at a map px (16 per tile). The source is made anew for other marks: a re-plan places new ones, and the map has changed then. */
export function dampAt(map: TileMap, marks: Marks, mx: number, mz: number): boolean {
  if (!moss || moss.map !== map || moss.marks !== marks) moss = { map, marks, src: mossSource(map, null, marks), rows: new Uint8Array(map.h) };
  const s = moss.src;
  if (!s || mx < 0 || mz < 0 || mx >= s.w || mz >= s.h) return false;
  const row = mz >> 4;
  if (!moss.rows[row]) { s.prep[row](); moss.rows[row] = 1; }
  return s.grow[mz * s.w + mx] === 1;
}

// ---- the ground: floors, wall tops and the rims of dips
// (the helpers below are module functions, not closures made per px: the painter runs a quarter of a million times a page)
const isDip = (t: number): boolean => dipOf(t) !== DIP.none;
/** The smooth outline of pools, lava and chasms together at a ground px. */
export const dipMask = (map: TileMap, u: number, v: number): number => maskAt(map, (u + 0.5) / STONE_PX, (v + 0.5) / STONE_PX, isDip);
/** A mosaic tessera's lean along one axis. */
const lean = (seed: number, i: number, j: number, k: number): number => [-TESSERA_LEAN, 0, 0, TESSERA_LEAN][Math.floor(hash(seed, i, j, k) * 4)];
/** The wall of the frieze's cut toward a neighbour px: none where that px is cut too. */
const friezeWall = (x: number, y: number): number => (cut(FRIEZE, x, y) ? 0 : CARVE);
/** What the ground painter keeps for one page: the dip mesh's cells of the page and one cell round it, and the floor pieces. */
export interface GroundCtx { f: StoneField; map: TileMap; marks: Marks; x0: number; z0: number; dip: Uint8Array }
export const SPAN = CHUNK + 2;
/** Whether the block's rectangle touches a cell of the dip mesh: such a slab is plain (no crack, no chips) as a whole, so a crack never stops on a tile line at a pool's rim. The last answer is kept: the painter asks px by px. */
let plainFor: { b: Block; map: TileMap; plain: boolean } | null = null;
export function touchesDip(map: TileMap, b: Block): boolean {
  if (plainFor && plainFor.b === b && plainFor.map === map) return plainFor.plain;
  let plain = false;
  for (let z = b.v0 >> 5; z <= (b.v1 - 1) >> 5 && !plain; z++) for (let x = b.u0 >> 5; x <= (b.u1 - 1) >> 5 && !plain; x++) plain = inDipMesh(map, x, z);
  plainFor = { b, map, plain };
  return plain;
}
/** `keyAt`'s answers for the page being painted and the 2 px round it (0: not asked yet): a px beside a piece or a dip asks for six neighbours. */
const KEYS_W = CHUNK * STONE_PX + 4, keys = new Int32Array(KEYS_W * KEYS_W);
export function groundCtx(f: StoneField, map: TileMap, marks: Marks, cx: number, cz: number): GroundCtx {
  const x0 = cx * CHUNK - 1, z0 = cz * CHUNK - 1, dip = new Uint8Array(SPAN * SPAN);
  for (let j = 0; j < SPAN; j++) for (let i = 0; i < SPAN; i++) dip[j * SPAN + i] = +inDipMesh(map, x0 + i, z0 + j);
  keys.fill(0);
  return { f, map, marks, x0, z0, dip };
}

/**
 * Which stone a ground px belongs to: its block's id, -1 for rock, or below that an edge stone of a dip's rim. The rim is the band just
 * outside the dip's rounded outline; its stones are cut across the outline every `RIM_LEN` px along the axis the outline runs along there.
 */
export function keyAt(c: GroundCtx, u: number, v: number): number {
  const i = (v - (c.z0 + 1) * STONE_PX + 2) * KEYS_W + u - (c.x0 + 1) * STONE_PX + 2;
  return keys[i] || (keys[i] = keyNow(c, u, v));
}
function keyNow(c: GroundCtx, u: number, v: number): number {
  if (c.dip[((v >> 5) - c.z0) * SPAN + (u >> 5) - c.x0]) {
    const here = dipMask(c.map, u, v);
    if (here >= RIM_FROM && here < OUTLINE_EDGE) {
      const gx = dipMask(c.map, u + 1, v) - dipMask(c.map, u - 1, v), gz = dipMask(c.map, u, v + 1) - dipMask(c.map, u, v - 1), across = Math.abs(gx) >= Math.abs(gz);
      return -2 - (Math.floor((across ? v : u) / RIM_LEN) * 4 + (across ? (gx > 0 ? 0 : 1) : gz > 0 ? 2 : 3));
    }
  }
  return floorBlockAt(c.f, c.map, c.marks, u, v)?.id ?? -1;
}
/** The stand-in block of a rim stone: raised and level; only its id changes. */
const rimStone: Block = { id: 0, u0: 0, v0: 0, u1: 0, v1: 0, stone: 1, level: 1, tilt: [0, 0], frieze: false };
const FAR = 9;

/** The rune of a stone of a circle's rune ring at a px: the slopes of the cut's wall, [0, 0] on its ground; null where the px is not carved. The glyph stands in the wedge's own frame. */
function runeAt(seed: number, marks: Marks, p: FloorPiece, b: Block, u: number, v: number): [number, number] | null {
  const du = u + 0.5 - p.x * STONE_PX, dv = v + 0.5 - p.z * STONE_PX, d = Math.hypot(du, dv), n = CIRCLE_STONES[RUNE_RING];
  const pos = (((Math.atan2(dv, du) / (Math.PI * 2) + circleTurn(seed, marks.pieces.indexOf(p), RUNE_RING) + 1) % 1) * n) % 1;
  // across the wedge and outward from the ring's middle, in rune cells
  const t = ((pos - 0.5) * Math.PI * 2 * d) / n / RUNE_CELL + 2.5, s = 3 - (d - ((CIRCLE_RINGS[RUNE_RING - 1] + CIRCLE_RINGS[RUNE_RING]) / 2) * p.r * STONE_PX) / RUNE_CELL;
  const gx = Math.floor(t), gy = Math.floor(s), g = RUNES[(b.piece!.index + Math.floor(hash(seed, b.id >> 8, 0, 71) * RUNES.length)) % RUNES.length];
  if (cut(g, gx, gy)) return [0, 0];
  // the cut's walls: the stone beside a cut cell falls into it
  const ft = t - gx, fs = s - gy;
  const st = ft < RUNE_WALL && cut(g, gx - 1, gy) ? CARVE : ft >= 1 - RUNE_WALL && cut(g, gx + 1, gy) ? -CARVE : 0;
  const ss = fs < RUNE_WALL && cut(g, gx, gy - 1) ? CARVE : fs >= 1 - RUNE_WALL && cut(g, gx, gy + 1) ? -CARVE : 0;
  if (!st && !ss) return null;
  // t runs with the turn (-dv, du) / d, s inward (-du, -dv) / d
  return [(-st * dv - ss * du) / d, (st * du - ss * dv) / d];
}

/** Paints the ground px (u, v) (world stone px) into `out` at `at`; false where the ground is rock there (nothing is written). */
export function laidGroundPx(c: GroundCtx, u: number, v: number, out: Uint8Array, at: number): boolean {
  const { f, map, marks } = c, seed = f.seed;
  const b = floorBlockAt(f, map, marks, u, v);
  if (!b) return false;
  if (b.hole) {
    const iron = ironPx(b), c = u === iron[0] && v === iron[1] ? IRON : SHAFT;
    out[at] = c[0]; out[at + 1] = c[1]; out[at + 2] = c[2]; out[at + 3] = FLAT_A;
    return true;
  }
  const x = u >> 5, z = v >> 5, top = heightAt(map, x, z) > 0;
  const damp = !top && dampAt(map, marks, u >> 1, v >> 1) ? 1 : 0;
  for (const g of marks.grates) {
    if (Math.floor(g.x) !== x || Math.floor(g.z) !== z) continue;
    // a grate's kerb: the cell round the shaft is four edge stones, mitred at the corners, with a joint round them
    const i = u & 31, j = v & 31, E = STONE_PX - 1;
    if (i === 0 || j === 0 || i === E || j === E || i === j || i === E - j) groove(out, at, seed, u, v, MORTAR, damp);
    else {
      rimStone.id = -2 - (marks.grates.indexOf(g) * 4 + (i < j ? (i < E - j ? 0 : 1) : i < E - j ? 2 : 3));
      stonePx(out, at, seed, rimStone, RIM, u, v, i - 1, j - 1, E - 1 - i, E - 1 - j, 1, true, damp);
    }
    return true;
  }
  const dip = c.dip[(z - c.z0) * SPAN + x - c.x0] === 1;
  let near = b.piece !== undefined || dip;
  if (!near) for (const p of marks.pieces) if (Math.abs(u - p.x * STONE_PX) < p.r * STONE_PX + 3 && Math.abs(v - p.z * STONE_PX) < p.r * STONE_PX + 3) near = true;
  if (!near) {
    // a slab away from pieces and dips: its rectangle says where its joints are (its left and top px)
    const dl = u - b.u0, dt = v - b.v0;
    if (dl === 0 || dt === 0) groove(out, at, seed, u, v, MORTAR, damp);
    else stonePx(out, at, seed, b, top ? CAP : STONES[b.stone], u, v, dl - 1, dt - 1, b.u1 - 1 - u, b.v1 - 1 - v, top ? 0 : b.level + 1, top || touchesDip(map, b), damp);
    return true;
  }
  // beside a floor piece or a dip the stones are not rectangles: the px round this one say where its stone ends
  const key = keyAt(c, u, v);
  if (keyAt(c, u - 1, v) !== key || keyAt(c, u, v - 1) !== key) { groove(out, at, seed, u, v, MORTAR, damp); return true; }
  const kl = keyAt(c, u - 2, v) !== key ? 0 : FAR, kt = keyAt(c, u, v - 2) !== key ? 0 : FAR, kr = keyAt(c, u + 1, v) !== key ? 0 : FAR, kb = keyAt(c, u, v + 1) !== key ? 0 : FAR;
  if (key < -1) {
    rimStone.id = key;
    stonePx(out, at, seed, rimStone, RIM, u, v, kl, kt, kr, kb, 1, true, damp);
    return true;
  }
  const p = b.piece?.of;
  if (!p) stonePx(out, at, seed, b, top ? CAP : STONES[b.stone], u, v, kl, kt, kr, kb, top ? 0 : b.level + 1, top || touchesDip(map, b), damp); // no block crack or chip on a slab that touches a pool
  else if (p.kind === 'mosaic') {
    // tesserae with thin joints; each has its own tone and leans its own way, so a passing light glints on them
    const tu = u - p.x * STONE_PX, tv = v - p.z * STONE_PX, T = MOSAIC_TESSERA;
    if ((((tu % T) + T) % T) === 0 || (((tv % T) + T) % T) === 0) groove(out, at, seed, u, v, TESSERA_JOINT, 0);
    else {
      const i = Math.floor(tu / T), j = Math.floor(tv / T);
      const h = hash(seed, i, j, 81), tone = h < MOSAIC_ODD ? 1 : h > 1 - MOSAIC_ODD ? 3 : 2; // mostly one tone, so the bands read
      put(out, at, b.piece!.ring === MOSAIC_BORDER_RING ? MOSAIC_EDGE : MOSAIC[b.stone], tone, relief(lean(seed, i, j, 82), lean(seed, i, j, 83), FLAG.plain));
    }
  } else {
    const pal = b.stone === 1 ? CIRCLE_DARK : CIRCLE_PALE;
    const r = b.piece!.ring === RUNE_RING && kl + kt + kr + kb === 4 * FAR ? runeAt(seed, marks, p, b, u, v) : null;
    // a rune's walls are the ring's own stone leaning into the cut: the lamp lights the side that faces it; its ground is dirt
    if (r && (r[0] || r[1])) put(out, at, pal, RUNE_TONE, relief(r[0], r[1], FLAG.plain));
    else if (r) { out[at] = RUNE[0]; out[at + 1] = RUNE[1]; out[at + 2] = RUNE[2]; out[at + 3] = FLAT_A; }
    else stonePx(out, at, seed, b, pal, u, v, kl, kt, kr, kb, 0, true, damp);
  }
  return true;
}

/** The moss a wall face may carry, per px column: whether the floor px at its foot is damp. */
export function faceDamp(map: TileMap, marks: Marks, face: Face): boolean[] {
  const out: boolean[] = [];
  for (let u = 0; u < STONE_PX; u++) {
    const along = ((face.side < 2 ? face.x : face.z) * STONE_PX + u) >> 1;
    const foot = [(face.z + 1) * 16, face.z * 16 - 1, (face.x + 1) * 16, face.x * 16 - 1][face.side];
    out.push(face.side < 2 ? dampAt(map, marks, along, foot) : dampAt(map, marks, foot, along));
  }
  return out;
}

/** The seed of what is scattered over a wall's plane (grain, moss, a block's tone, rock facets): parallel walls differ. */
export const planeSeed = (seed: number, face: Face): number => seed ^ Math.imul(face.side * 1024 + (face.side < 2 ? face.z : face.x) + 1, 0x9e3779b1);

/** Paints the px (u, v) of a wall face (v down from the wall's top); `dampCol` from `faceDamp`. False where that wall is rock. */
export function laidFacePx(f: StoneField, map: TileMap, face: Face, dampCol: readonly boolean[], u: number, v: number, out: Uint8Array, at: number): boolean {
  const pu = (face.side < 2 ? face.x : face.z) * STONE_PX + u, b = wallBlockAt(f, map, face, pu, v);
  if (!b) return false;
  const dl = pu - b.u0, dt = v - b.v0, damp = dampCol[u] ? (v / FACE_H) ** 2 : 0, seed = planeSeed(f.seed, face);
  if (dl === 0 || dt === 0) groove(out, at, seed, pu, v, MORTAR, damp);
  else if (b.frieze && cut(FRIEZE, dl, dt - 2)) {
    // the carving: its walls fall into the cut from every side that is not cut, its ground is two tones darker
    const y = dt - 2;
    put(out, at, STONES[b.stone], 1, relief(friezeWall(dl + 1, y) - friezeWall(dl - 1, y), friezeWall(dl, y + 1) - friezeWall(dl, y - 1), FLAG.plain));
  } else stonePx(out, at, seed, b, STONES[b.stone], pu, v, dl - 1, dt - 1, b.u1 - 1 - pu, b.v1 - 1 - v, b.frieze ? 1 : b.level + 1, b.frieze, damp);
  return true;
}
