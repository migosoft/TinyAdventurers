// The marks the client places from a level's seed (#380 part 5): rooms, puddles, cracks, crevices, floor pieces, grates and crystal
// shards. The painter and the mesh read them. Positions are tiles (x, z).
import { LIGHT_KIND, TILE_ID } from '../../generated/defs';
import { isTerrain, type TileMap } from '../../sim/map';
import { torchWall } from '../heights';
import { hash, kindAt, LAID, ROCK, STONE_PX, type StoneField } from './field';

export interface Room { cells: number[]; kind: 0 | 1; x0: number; z0: number; x1: number; z1: number }
export interface Puddle { x: number; z: number; r: number }
export interface Crack { pts: [number, number][]; branch: number[][] }
export interface Crevice extends Crack { width: number; depth: number }
export interface FloorPiece { kind: 'circle' | 'mosaic'; x: number; z: number; r: number }
export interface Grate { x: number; z: number }
export interface Shard { x: number; z: number; nx: number; nz: number; big: boolean; lightId?: number }
export interface Marks { rooms: Room[]; puddles: Puddle[]; rockCracks: Crack[]; crevices: Crevice[]; pieces: FloorPiece[]; grates: Grate[]; shards: Shard[] }

/** A crack's or a crevice's straight pieces, [x0, z0, x1, z1] each: its line, then its branches. */
export const piecesOf = (c: Crack): number[][] => [...c.pts.slice(1).map((q, i) => [...c.pts[i], ...q]), ...c.branch];
/** Whether the centre of the ground px (u, v) lies within `half` px of the piece from (x0, z0) to (x1, z1) (tiles): the px a crevice is made of, for the painter and the mesh alike. */
export function onPiece(u: number, v: number, x0: number, z0: number, x1: number, z1: number, half: number): boolean {
  const ax = x0 * STONE_PX, az = z0 * STONE_PX, dx = (x1 - x0) * STONE_PX, dz = (z1 - z0) * STONE_PX;
  const t = Math.min(1, Math.max(0, ((u + 0.5 - ax) * dx + (v + 0.5 - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(u + 0.5 - ax - dx * t, v + 0.5 - az - dz * t) < half;
}

/** No marks at all: what every caller passes until the placement exists. */
export function noMarks(): Marks {
  return { rooms: [], puddles: [], rockCracks: [], crevices: [], pieces: [], grates: [], shards: [] };
}

/** The static lights of RunStartInfo and the heroes' start: what no mark may cover. */
export interface Taken { lights: { id: number; kind: number; x: number; y: number }[]; spawn: { x: number; z: number } }

// First guesses, all of them.
/** Open ground is eroded and grown back this many cells: corridors (3 wide) drop out. */
const ROOM_ERODE = 2;
/** Puddles per rock room: one, and a second with this chance. */
const PUDDLE_SECOND = 0.5;
/** A puddle's radius range (tiles). */
const PUDDLE_R: [number, number] = [0.45, 0.8];
/** The chance of a floor piece in a laid room (about every third or fourth room). */
const PIECE_SHARE = 0.28;
/** The radius of a summoning circle and of a mosaic (tiles), and the clear ring round a floor piece. */
const CIRCLE_R = 3, MOSAIC_R = 2.5, PIECE_RING = 0.5;
/** The chance of a grate in a laid room, and its radius. */
const GRATE_SHARE = 0.4, GRATE_R = 0.45;
/** Small shards per rock room, their radius, and how far they stand from the wall foot's cell centre. */
const SHARDS_PER_ROOM = 3, SHARD_R = 0.2, SHARD_BIG_R = 0.3, SHARD_FOOT = 0.35;
/** Crevices and rock cracks per level (tries). */
const CREVICES = 3, ROCK_CRACKS = 3;
/** A crevice's width range (tiles) and depth. */
const CREVICE_WIDTH: [number, number] = [0.05, 0.11], CREVICE_DEPTH = 0.3;
/** Cracks keep this far from walls, puddles, pools and lava; they are checked every `CRACK_STEP`. */
const CRACK_MARGIN = 0.5, CRACK_STEP = 0.25;
/** The chance a crevice goes to a rock room when there is one. */
const CREVICE_IN_ROCK = 0.8;
/** Tries per mark before the room goes without. */
const TRIES = 8;

interface Disc { x: number; z: number; r: number }

const plain = (map: TileMap, x: number, z: number): boolean => {
  const t = map.get(x, z);
  return !map.opaque(x, z) && !isTerrain(t) && t !== TILE_ID.DoorOpen;
};

/** Every cell of open ground that survives eroding by `ROOM_ERODE` and growing back, grouped by 4-connection, in scan order. */
export function roomsOf(map: TileMap, f: StoneField): Room[] {
  const { w, h } = map;
  const step = (src: Uint8Array, all: boolean, within: Uint8Array | null): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      if (within && !within[z * w + x]) continue;
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) n += x + dx >= 0 && z + dz >= 0 && x + dx < w && z + dz < h ? src[(z + dz) * w + x + dx] : 0;
      out[z * w + x] = all ? +(n === 9) : +(n > 0);
    }
    return out;
  };
  const open = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) open[z * w + x] = +(!map.opaque(x, z) && map.get(x, z) !== TILE_ID.DoorOpen);
  let g: Uint8Array = open;
  for (let i = 0; i < ROOM_ERODE; i++) g = step(g, true, null);
  for (let i = 0; i < ROOM_ERODE; i++) g = step(g, false, open);
  const rooms: Room[] = [], seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!g[i] || seen[i]) continue;
    const cells: number[] = [], stack = [i];
    seen[i] = 1;
    let rock = 0, x0 = w, z0 = h, x1 = 0, z1 = 0;
    while (stack.length) {
      const c = stack.pop()!, x = c % w, z = (c - x) / w;
      cells.push(c);
      rock += kindAt(f, x, z) === ROCK ? 1 : 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, n = nz * w + nx;
        if (nx >= 0 && nz >= 0 && nx < w && nz < h && g[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    cells.sort((a, b) => a - b);
    rooms.push({ cells, kind: rock * 2 > cells.length ? ROCK : LAID, x0, z0, x1, z1 });
  }
  return rooms;
}

/** The marks of a level: the same map, field and `taken` always give the same marks. */
export function placeMarks(map: TileMap, f: StoneField, taken: Taken): Marks {
  const marks = noMarks();
  marks.rooms = roomsOf(map, f);
  if (!marks.rooms.length) return marks;
  const used: Disc[] = [{ x: taken.spawn.x, z: taken.spawn.z, r: 1 }];
  const lights = taken.lights.filter((l) => l.kind === LIGHT_KIND.Torch || l.kind === LIGHT_KIND.Crystal);
  for (const l of lights) used.push({ x: l.x + 0.5, z: l.y + 0.5, r: 0.7 });
  const rnd = (a: number, b: number, c: number): number => hash(f.seed, a, b, c);
  const free = (x: number, z: number, r: number): boolean => used.every((u) => Math.hypot(x - u.x, z - u.z) >= r + u.r);
  /** Disc free of other marks, and every cell it reaches plain floor of the stone `kind`. */
  const clear = (x: number, z: number, r: number, kind: number): boolean => {
    for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
      if ((!plain(map, cx, cz) || kindAt(f, cx, cz) !== kind) && Math.hypot(Math.max(cx - x, 0, x - cx - 1), Math.max(cz - z, 0, z - cz - 1)) < r) return false;
    }
    return free(x, z, r);
  };
  const cellOf = (room: Room, a: number, b: number): [number, number] => {
    const c = room.cells[Math.floor(rnd(room.x0 * 977 + a, room.z0, b) * room.cells.length)];
    return [c % map.w, Math.floor(c / map.w)];
  };
  /** The wall neighbour (not a door) of a floor cell, in the order north, west, east, south. */
  const wallDir = (x: number, z: number): [number, number] | null =>
    ([[0, -1], [-1, 0], [1, 0], [0, 1]] as [number, number][]).find(([dx, dz]) => map.opaque(x + dx, z + dz) && map.get(x + dx, z + dz) !== TILE_ID.DoorClosed) ?? null;

  for (const room of marks.rooms) {
    if (room.kind !== ROCK) continue;
    const n = rnd(room.x0, room.z0, 1) < PUDDLE_SECOND ? 2 : 1;
    for (let k = 0; k < n; k++) for (let t = 0; t < TRIES; t++) {
      const [cx, cz] = cellOf(room, 10 + k, t);
      const r = PUDDLE_R[0] + rnd(cx, cz, 2) * (PUDDLE_R[1] - PUDDLE_R[0]);
      const x = cx + 0.2 + rnd(cx, cz, 3) * 0.6, z = cz + 0.2 + rnd(cx, cz, 4) * 0.6;
      if (!clear(x, z, r + 0.15, ROCK)) continue;
      marks.puddles.push({ x, z, r }); used.push({ x, z, r });
      break;
    }
  }
  for (const room of marks.rooms) {
    if (room.kind !== LAID) continue;
    if (rnd(room.x0, room.z0, 5) < PIECE_SHARE) for (let t = 0; t < TRIES; t++) {
      const [cx, cz] = cellOf(room, 20, t), x = cx + 0.5, z = cz + 0.5;
      const kind = rnd(cx, cz, 6) < 0.5 ? 'circle' : 'mosaic', r = kind === 'circle' ? CIRCLE_R : MOSAIC_R;
      if (!clear(x, z, r + PIECE_RING, LAID)) continue;
      marks.pieces.push({ kind, x, z, r }); used.push({ x, z, r });
      break;
    }
    if (rnd(room.x0, room.z0, 7) < GRATE_SHARE) for (let t = 0; t < TRIES; t++) {
      const [cx, cz] = cellOf(room, 30, t), x = cx + 0.5, z = cz + 0.5;
      if (!wallDir(cx, cz) || !clear(x, z, GRATE_R, LAID)) continue;
      marks.grates.push({ x, z }); used.push({ x, z, r: GRATE_R });
      break;
    }
  }
  for (const l of lights.filter((l) => l.kind === LIGHT_KIND.Crystal)) {
    const w = torchWall(l.x, l.y, map);
    marks.shards.push({ x: w.x, z: w.z, nx: w.nx, nz: w.nz, big: true, lightId: l.id });
    used.push({ x: w.x, z: w.z, r: SHARD_BIG_R });
  }
  for (const room of marks.rooms) {
    if (room.kind !== ROCK) continue;
    let n = 0;
    for (let t = 0; t < SHARDS_PER_ROOM * 4 && n < SHARDS_PER_ROOM; t++) {
      const [cx, cz] = cellOf(room, 40, t), d = wallDir(cx, cz);
      if (!d || kindAt(f, cx, cz) !== ROCK || !plain(map, cx, cz)) continue;
      const x = cx + 0.5 + d[0] * SHARD_FOOT, z = cz + 0.5 + d[1] * SHARD_FOOT;
      if (!free(x, z, SHARD_R)) continue;
      marks.shards.push({ x, z, nx: -d[0], nz: -d[1], big: false }); used.push({ x, z, r: SHARD_R });
      n++;
    }
  }

  /** Two straight pieces and a branch from a point in the room, or null when anything is not clear. */
  const crack = (room: Room, base: number, t: number): Crack | null => {
    const salt = base * 16 + t * 10; // a retry (t) draws new numbers
    const [cx, cz] = cellOf(room, base, t);
    let a = rnd(cx, cz, salt + 1) * Math.PI * 2, x = cx + rnd(cx, cz, salt + 2), z = cz + rnd(cx, cz, salt + 3);
    const pts: [number, number][] = [[x, z]];
    for (let i = 0; i < 2; i++) {
      if (i) a += (rnd(cx, cz, salt + 6) - 0.5) * 1.2;
      const len = 1 + rnd(cx, cz, salt + 4 + i);
      x += Math.cos(a) * len; z += Math.sin(a) * len;
      pts.push([x, z]);
    }
    // the branch leaves the joint of the two pieces, on the drawn line
    const b = a + (rnd(cx, cz, salt + 8) < 0.5 ? 0.9 : -0.9), bl = 0.8 + rnd(cx, cz, salt + 9) * 0.5;
    const branch = [[pts[1][0], pts[1][1], pts[1][0] + Math.cos(b) * bl, pts[1][1] + Math.sin(b) * bl]];
    const segs = [...pts.slice(1).map((p, i) => [...pts[i], ...p]), ...branch];
    const samples: Disc[] = [];
    for (const s of segs) {
      const n = Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / CRACK_STEP);
      for (let i = 0; i <= n; i++) samples.push({ x: s[0] + ((s[2] - s[0]) * i) / n, z: s[1] + ((s[3] - s[1]) * i) / n, r: 0.1 });
    }
    // every point of a piece lies within half a step of a sample, so this margin holds between the samples too
    if (!samples.every((p) => clear(p.x, p.z, CRACK_MARGIN + CRACK_STEP / 2, room.kind))) return null;
    used.push(...samples);
    return { pts, branch };
  };
  const rock = marks.rooms.filter((r) => r.kind === ROCK);
  for (let k = 0; k < CREVICES; k++) {
    const pool = rock.length && rnd(k, 0, 50) < CREVICE_IN_ROCK ? rock : marks.rooms;
    const room = pool[Math.floor(rnd(k, 1, 50) * pool.length)];
    for (let t = 0; t < TRIES; t++) {
      const c = crack(room, 60 + k * 20, t);
      if (c) { marks.crevices.push({ ...c, width: CREVICE_WIDTH[0] + rnd(k, t, 51) * (CREVICE_WIDTH[1] - CREVICE_WIDTH[0]), depth: CREVICE_DEPTH }); break; }
    }
  }
  if (rock.length) for (let k = 0; k < ROCK_CRACKS; k++) {
    const room = rock[Math.floor(rnd(k, 2, 50) * rock.length)];
    for (let t = 0; t < TRIES; t++) {
      const c = crack(room, 200 + k * 20, t);
      if (c) { marks.rockCracks.push(c); break; }
    }
  }
  return marks;
}
