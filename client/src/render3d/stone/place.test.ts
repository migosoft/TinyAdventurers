import { describe, expect, it } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../../generated/defs';
import { isTerrain, TileMap } from '../../sim/map';
import { torchWall } from '../heights';
import { hash, kindAt, LAID, ROCK, stoneField, type StoneField } from './field';
import { noMarks, placeMarks, roomsOf, type Crack, type Marks, type Taken } from './place';
import { stoneMap, zoneKinds } from './stoneMap';

interface Case { map: TileMap; f: StoneField; taken: Taken }

/** Test data: rectangles joined by 3-wide corridors, a few doors, a pool and a lava strip; the seed picks everything. */
function generated(seed: number): Case {
  const w = 70, h = 50, h01 = (a: number, b: number): number => hash(seed, a, b, 77);
  const map = new TileMap(w, h, new Uint8Array(w * h));
  const carve = (x0: number, z0: number, x1: number, z1: number, t: number): void => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) map.set(x, z, t); };
  const rooms: [number, number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const rw = 6 + Math.floor(h01(i, 1) * 8), rh = 6 + Math.floor(h01(i, 2) * 8);
    const x0 = 2 + (i % 3) * 22 + Math.floor(h01(i, 3) * 4), z0 = 2 + Math.floor(i / 3) * 24 + Math.floor(h01(i, 4) * 6);
    carve(x0, z0, x0 + rw - 1, z0 + rh - 1, TILE_ID.Floor);
    rooms.push([x0, z0, x0 + rw - 1, z0 + rh - 1]);
  }
  for (let i = 1; i < rooms.length; i++) {
    const [a, b] = [rooms[i - 1], rooms[i]], ax = (a[0] + a[2]) >> 1, az = (a[1] + a[3]) >> 1, bx = (b[0] + b[2]) >> 1, bz = (b[1] + b[3]) >> 1;
    carve(Math.min(ax, bx) - 1, az - 1, Math.max(ax, bx) + 1, az + 1, TILE_ID.Floor);
    carve(bx - 1, Math.min(az, bz) - 1, bx + 1, Math.max(az, bz) + 1, TILE_ID.Floor);
  }
  carve(rooms[0][0] + 2, rooms[0][1] + 2, rooms[0][0] + 3, rooms[0][1] + 3, TILE_ID.DeepWater);
  carve(rooms[1][0] + 1, rooms[1][3] - 1, rooms[1][2] - 1, rooms[1][3] - 1, TILE_ID.Lava);
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(h01(i, 5) * w), z = Math.floor(h01(i, 6) * h);
    if (map.get(x, z) === TILE_ID.Wall && map.opaque(x - 1, z) !== map.opaque(x + 1, z)) map.set(x, z, TILE_ID.DoorClosed);
  }
  const mode = seed % 3; // all laid, all rock, or rock in the west
  const kinds = Uint8Array.from({ length: w * h }, (_, i) => (mode === 1 || (mode === 2 && i % w < w / 2) ? ROCK : LAID));
  // a crystal in every rock room, a torch in every laid one, at the room's north-west corner; and a door in the first room's west wall
  const lights: Taken['lights'] = rooms.map(([x0, z0], i) => ({ id: i + 1, kind: kinds[z0 * w + x0] === ROCK ? LIGHT_KIND.Crystal : LIGHT_KIND.Torch, x: x0, y: z0 }));
  map.set(rooms[0][0] - 1, rooms[0][1] + 1, TILE_ID.DoorClosed);
  return { map, f: stoneField(map, kinds, seed), taken: { lights, spawn: { x: rooms[0][0] + 4.5, z: rooms[0][1] + 4.5 } } };
}

function stoneCase(): Case {
  const map = stoneMap();
  return { map, f: stoneField(map, zoneKinds(map), 5), taken: { lights: [{ id: 1, kind: LIGHT_KIND.Crystal, x: 4, y: 9 }, { id: 2, kind: LIGHT_KIND.Torch, x: 40, y: 4 }], spawn: { x: 10.5, z: 7.5 } } };
}

const cases: Case[] = [...Array.from({ length: 20 }, (_, i) => generated(i + 1)), stoneCase()];
const marksOf = (c: Case): Marks => placeMarks(c.map, c.f, c.taken);
const all = cases.map(marksOf);
const plain = (map: TileMap, x: number, z: number): boolean => {
  const t = map.get(Math.floor(x), Math.floor(z));
  return !map.opaque(Math.floor(x), Math.floor(z)) && !isTerrain(t) && t !== TILE_ID.DoorOpen;
};
/** Points along a straight piece, 0.05 apart. */
const along = (a: number[], b: number[]): [number, number][] => {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
};
const drawn = (c: Crack): number[][][] => c.pts.slice(1).map((p, i) => [c.pts[i], p]);
const lines = (m: Marks): number[][][] => [...m.rockCracks, ...m.crevices].flatMap((c) => [...drawn(c), ...c.branch.map((b) => [[b[0], b[1]], [b[2], b[3]]])]);
const onSegment = (p: number[], [a, b]: number[][]): boolean => Math.hypot(p[0] - a[0], p[1] - a[1]) + Math.hypot(p[0] - b[0], p[1] - b[1]) - Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6;
const rectDist = (x: number, z: number, cx: number, cz: number): number => Math.hypot(Math.max(cx - x, 0, x - cx - 1), Math.max(cz - z, 0, z - cz - 1));

describe('placement', () => {
  it('places something on the generated maps', () => {
    expect(all.reduce((n, m) => n + m.puddles.length + m.pieces.length + m.grates.length + m.shards.length + m.crevices.length + m.rockCracks.length, 0)).toBeGreaterThan(40);
  });

  it('no_crack_or_crevice_touches_a_puddle_or_liquid', () => {
    cases.forEach((c, i) => {
      for (const [a, b] of lines(all[i])) for (const [x, z] of along(a, b)) {
        for (const p of all[i].puddles) expect(Math.hypot(x - p.x, z - p.z)).toBeGreaterThanOrEqual(p.r + 0.5 - 1e-6);
        for (let cz = Math.floor(z) - 1; cz <= Math.floor(z) + 1; cz++) for (let cx = Math.floor(x) - 1; cx <= Math.floor(x) + 1; cx++) {
          if (isTerrain(c.map.get(cx, cz))) expect(rectDist(x, z, cx, cz)).toBeGreaterThanOrEqual(0.5 - 1e-6);
        }
      }
    });
  });

  it('nothing_overlaps', () => {
    cases.forEach((c, i) => {
      const m = all[i];
      const discs = [
        ...m.puddles.map((p) => ({ ...p, what: 'puddle' })), ...m.pieces.map((p) => ({ ...p, what: 'piece' })),
        ...m.grates.map((g) => ({ x: g.x, z: g.z, r: 0.45, what: 'grate' })), ...m.shards.map((s) => ({ x: s.x, z: s.z, r: s.big ? 0.3 : 0.2, what: 'shard' })),
        ...c.taken.lights.filter((l) => l.kind === LIGHT_KIND.Torch || l.kind === LIGHT_KIND.Crystal).map((l) => ({ x: l.x + 0.5, z: l.y + 0.5, r: 0.5, what: 'front' })),
        { x: c.taken.spawn.x, z: c.taken.spawn.z, r: 0.5, what: 'spawn' },
      ];
      const bigAt = (d: { x: number; z: number }): boolean => m.shards.some((s) => s.big && s.x === d.x && s.z === d.z);
      const fixed = (what: string): boolean => what === 'front' || what === 'spawn';
      discs.forEach((a, j) => discs.slice(j + 1).forEach((b) => {
        if (fixed(a.what) && fixed(b.what)) return;
        if ((fixed(a.what) && bigAt(b)) || (fixed(b.what) && bigAt(a))) return; // a crystal's big shard stands on its own front
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.what} ${b.what}`).toBeGreaterThanOrEqual(a.r + b.r - 1e-9);
      }));
      for (const d of [...m.puddles, ...m.pieces]) for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        expect(plain(c.map, d.x + Math.cos(a) * d.r, d.z + Math.sin(a) * d.r)).toBe(true);
      }
      for (const g of m.grates) expect(plain(c.map, g.x, g.z)).toBe(true);
      for (const s of m.shards.filter((s) => !s.big)) expect(plain(c.map, s.x, s.z)).toBe(true);
      const cracks = [...m.rockCracks, ...m.crevices];
      cracks.forEach((ck, j) => {
        const mine = [...drawn(ck), ...ck.branch.map((b) => [[b[0], b[1]], [b[2], b[3]]])].flatMap(([a, b]) => along(a, b));
        for (const [x, z] of mine) {
          expect(plain(c.map, x, z)).toBe(true);
          for (const d of [...m.pieces, ...m.grates.map((g) => ({ ...g, r: 0.45 })), ...m.shards.map((s) => ({ ...s, r: 0.2 })), ...discs.filter((d) => fixed(d.what))]) expect(Math.hypot(x - d.x, z - d.z)).toBeGreaterThan(d.r);
        }
        for (const other of cracks.slice(j + 1)) for (const [a, b] of [...drawn(other), ...other.branch.map((b) => [[b[0], b[1]], [b[2], b[3]]])]) for (const [x, z] of along(a, b).filter((_, k) => k % 5 === 0)) {
          for (const [px, pz] of mine.filter((_, k) => k % 5 === 0)) expect(Math.hypot(x - px, z - pz)).toBeGreaterThan(0.3); // coarse: points are 0.25 apart, cracks keep 0.7
        }
      });
    });
  }, 20000); // about 1.3 s alone, but the default 5 s failed once under a full parallel run

  it('puddles_only_in_rock_and_pieces_only_in_laid', () => {
    cases.forEach((c, i) => {
      const covered = (p: { x: number; z: number; r: number }): number[] => {
        const out: number[] = [];
        for (let dz = -p.r; dz <= p.r; dz += 0.1) for (let dx = -p.r; dx <= p.r; dx += 0.1) if (Math.hypot(dx, dz) <= p.r) out.push(kindAt(c.f, p.x + dx, p.z + dz));
        return out;
      };
      for (const p of all[i].puddles) expect(covered(p).every((k) => k === ROCK)).toBe(true);
      for (const p of all[i].pieces) expect(covered(p).every((k) => k === LAID)).toBe(true);
      const room = (x: number, z: number): number | undefined => all[i].rooms.find((r) => r.cells.includes(Math.floor(z) * c.map.w + Math.floor(x)))?.kind;
      for (const ck of all[i].rockCracks) expect(room(ck.pts[0][0], ck.pts[0][1])).toBe(ROCK);
    });
  });

  it('branches_start_on_their_crack', () => {
    let n = 0;
    all.forEach((m) => [...m.rockCracks, ...m.crevices].forEach((ck) => {
      n++;
      for (const b of ck.branch) expect(drawn(ck).some((s) => onSegment(b, s))).toBe(true);
    }));
    expect(n).toBeGreaterThan(20);
  });

  it('at_most_one_grate_and_one_piece_per_room', () => {
    cases.forEach((c, i) => {
      const m = all[i], inRoom = (r: { cells: number[] }, x: number, z: number): boolean => r.cells.includes(Math.floor(z) * c.map.w + Math.floor(x));
      for (const r of m.rooms) {
        expect(m.grates.filter((g) => inRoom(r, g.x, g.z)).length).toBeLessThanOrEqual(1);
        expect(m.pieces.filter((p) => inRoom(r, p.x, p.z)).length).toBeLessThanOrEqual(1);
      }
      for (const g of m.grates) expect(m.rooms.some((r) => inRoom(r, g.x, g.z))).toBe(true);
    });
  });

  it('a_big_shard_per_crystal_light_at_its_wall', () => {
    cases.forEach((c, i) => {
      const crystals = c.taken.lights.filter((l) => l.kind === LIGHT_KIND.Crystal);
      const big = all[i].shards.filter((s) => s.big);
      expect(big.length).toBe(crystals.length);
      for (const l of crystals) {
        const w = torchWall(l.x, l.y, c.map);
        expect(big.find((s) => s.lightId === l.id)).toMatchObject({ x: w.x, z: w.z, nx: w.nx, nz: w.nz });
      }
    });
    expect(all[all.length - 1].shards.some((s) => s.big)).toBe(true);
  });

  it('placement_is_deterministic', () => {
    cases.forEach((c, i) => expect(marksOf(c)).toEqual(all[i]));
  });

  it('corridors_are_no_rooms', () => {
    const c = generated(4);
    for (const r of roomsOf(c.map, c.f)) {
      expect(r.x1 - r.x0).toBeGreaterThanOrEqual(4);
      expect(r.z1 - r.z0).toBeGreaterThanOrEqual(4);
    }
    const tube = new TileMap(30, 9, Uint8Array.from({ length: 270 }, (_, i) => (Math.floor(i / 30) >= 3 && Math.floor(i / 30) <= 5 && i % 30 > 0 && i % 30 < 29 ? TILE_ID.Floor : TILE_ID.Wall)));
    expect(roomsOf(tube, stoneField(tube))).toEqual([]);
  });

  it('gives_empty_lists_for_a_map_without_a_room', () => {
    const tube = new TileMap(30, 9, Uint8Array.from({ length: 270 }, (_, i) => (Math.floor(i / 30) === 4 ? TILE_ID.Floor : TILE_ID.Wall)));
    expect(placeMarks(tube, stoneField(tube), { lights: [], spawn: { x: 2, z: 4.5 } })).toEqual(noMarks());
  });
});
