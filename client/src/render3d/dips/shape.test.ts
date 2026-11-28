import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import {
  BREAK_DEPTH, CHASM_BED, DEEP_BED, OUTLINE_EDGE, DIP, LAVA_BED, LAVA_LEVEL, LIP, ROUGH, SHALLOW_BED, WATER_LEVEL,
  NOTHING_HIDDEN, bedAt, growAt, depthFade, dipOf, hidingHeightAt, inDipMesh, kindOf, maskAt, nearAt, isChasm, isLava, isWater, surfaceAt, walkBedAt, type DipKind,
} from './shape';

const CH: Record<string, number> = {
  '#': TILE_ID.Wall, '.': TILE_ID.Floor, '~': TILE_ID.ShallowWater, W: TILE_ID.DeepWater,
  L: TILE_ID.Lava, C: TILE_ID.Chasm, ' ': TILE_ID.Void,
};

/** Rows of characters inside a one-cell wall border. */
function room(...rows: string[]): TileMap {
  const w = rows[0].length + 2, h = rows.length + 2;
  const m = new TileMap(w, h, new Uint8Array(w * h).fill(TILE_ID.Wall));
  rows.forEach((r, j) => [...r].forEach((c, i) => m.set(i + 1, j + 1, CH[c])));
  return m;
}

/** An n x n pool of one terrain character in a floor room with two floor cells all round. */
function pool(c: string, n: number): TileMap {
  const s = n + 4;
  return room(...Array.from({ length: s }, (_, j) =>
    Array.from({ length: s }, (_, i) => (i >= 2 && i < 2 + n && j >= 2 && j < 2 + n ? c : '.')).join('')));
}

// Pool of 5: cells 3..7 (border 1 + margin 2), centre 5.5, left edge 3, top edge 3.
const mid = 5.5, edgeX = 3, cornerX = 3, cornerZ = 3;

describe('dip shape', () => {
  it('is flat floor away from terrain', () => expect(Math.abs(bedAt(room('...', '...', '...'), 1.5, 1.5))).toBe(0));

  it('reaches the full depth in the middle of a wide pool', () => {
    expect(bedAt(pool('C', 5), mid, mid)).toBeCloseTo(-CHASM_BED, 5);
    expect(bedAt(pool('~', 5), mid, mid)).toBeGreaterThan(-SHALLOW_BED - ROUGH);
    expect(bedAt(pool('~', 5), mid, mid)).toBeLessThan(-SHALLOW_BED + ROUGH);
    expect(bedAt(pool('W', 5), mid, mid)).toBeLessThan(-DEEP_BED + ROUGH);
    expect(bedAt(pool('L', 5), mid, mid)).toBeLessThan(-LAVA_BED + ROUGH);
  });

  it('meets the floor on a straight cell edge, or a broken-off piece of the rim a step lower (#444)', () => {
    const b = bedAt(pool('C', 5), edgeX, mid);
    expect(Math.min(Math.abs(b), Math.abs(b + BREAK_DEPTH))).toBeLessThan(1e-9);
  });

  it('breaks the rim of a chasm into pieces a step lower, outside the outline only, where a foot still stands on the floor (#444)', () => {
    const m = pool('C', 9);
    let broken = 0, whole = 0;
    for (let z = 3.5; z <= 11.5; z += 0.05) {
      const out = bedAt(m, edgeX - 0.08, z);   // on the floor, just outside the outline
      if (out <= -BREAK_DEPTH + 1e-9) broken++; else whole++;
      expect(walkBedAt(m, edgeX - 0.08, z)).toBeGreaterThan(-ROUGH);
      expect(bedAt(m, edgeX - 0.3, z)).toBeGreaterThanOrEqual(0);   // never further out than the chip
    }
    expect(broken).toBeGreaterThan(10);
    expect(whole).toBeGreaterThan(10);
  });
  it('is exactly 0 half a tile outside the outline', () => expect(Math.abs(bedAt(pool('C', 5), edgeX - 0.5, mid))).toBe(0));

  it('bends the outline of water and lava outward off a straight tile edge, flat again a tile out, and keeps a chasm on its edge (#444)', () => {
    for (const c of ['~', 'L']) {
      const m = pool(c, 9), member = c === '~' ? isWater : isLava;
      let far = 0;
      for (let z = 3.5; z <= 11.5; z += 0.05) {
        // the outline's crossing along the pool's left side (x 3), from a tile out (x 2, where the dip mesh ends) into the pool
        let x = 2;
        while (maskAt(m, x, z, member) < OUTLINE_EDGE) x += 0.005;
        far = Math.max(far, 3 - x);
        expect(x, `${c} at z ${z}`).toBeGreaterThan(2.05);
        expect(x, `${c} at z ${z}: never inside the tiles`).toBeLessThanOrEqual(3.005);
        expect(bedAt(m, 2, z), `${c} a tile out`).toBe(0);
      }
      expect(far, c).toBeGreaterThan(0.3);
    }
    expect(maskAt(pool('C', 5), 3, 4.3, isChasm)).toBeCloseTo(0.5, 9);
  });

  it('never rises above the lip and is finite everywhere', () => {
    const maps = [
      room('...', '.C.', '...'),
      room('.....', '.CCC.', '.....'),
      room('.....', '.C...', '..C..', '.....'),
      room('C~W', 'CCL', '#LL'),
      room('~~~~', 'WWLL', 'LLCC', 'CC..'),
      room('C', 'C'),
      room('~W', 'L.'),
    ];
    for (const m of maps) {
      for (let z = -0.5; z <= m.h + 0.5; z += 0.125) {
        for (let x = -0.5; x <= m.w + 0.5; x += 0.125) {
          const h = bedAt(m, x, z);
          expect(Number.isFinite(h)).toBe(true);
          expect(h).toBeLessThanOrEqual(LIP);
          expect(h).toBeGreaterThanOrEqual(-CHASM_BED - ROUGH);
        }
      }
    }
  });

  it('has a lip: ground above 0, at most LIP, just outside the outline of a pool (mask 0.28 to 0.4)', () => {
    for (const c of ['C', '~', 'L']) {
      const m = pool(c, 5);
      let top = -Infinity;
      // water and lava: outside the outline grown by `growAt` (#444), which varies slowly enough to read at the tile edge
      for (let z = 4.5; z < 6.5; z += 0.05) for (const d of [0.15, 0.1, 0.07]) {
        const x = edgeX - (c === 'C' ? 0 : growAt(edgeX, z)) - d;
        top = Math.max(top, bedAt(m, x, z));
      }
      expect(top, c).toBeGreaterThan(0.005);
      expect(top, c).toBeLessThanOrEqual(LIP);
    }
  });

  it('rounds a convex corner inward', () => expect(bedAt(pool('C', 5), cornerX + 0.08, cornerZ + 0.08)).toBeGreaterThan(-0.5));

  it('depends only on the cells of the mask window of the point (so two cells agree on their shared edge)', () => {
    // Two chasm cells (2, 2) and (3, 2); along their shared edge x = 3 the window is the cells 2..3 x j..j+1.
    const make = (others: number) => {
      const m = new TileMap(7, 7, new Uint8Array(49).fill(others));
      m.set(2, 2, TILE_ID.Chasm); m.set(3, 2, TILE_ID.Chasm);
      m.set(2, 3, TILE_ID.Floor); m.set(3, 3, TILE_ID.Floor);
      return m;
    };
    const a = make(TILE_ID.Floor), b = make(TILE_ID.Lava), c = make(TILE_ID.DeepWater);
    let seen = 0;
    for (let z = 2.5; z < 3.5; z += 0.05) {
      // the window of (3, z): cells 2..3 in x, floor(z - 0.5) .. +1 in z: rows 2 and 3 for z in [2.5, 3.5): all set the same in the copies
      expect(bedAt(b, 3, z)).toBe(bedAt(a, 3, z));
      expect(bedAt(c, 3, z)).toBe(bedAt(a, 3, z));
      if (bedAt(a, 3, z) < -1) seen++;
    }
    expect(seen).toBeGreaterThan(0);
    // and a point outside the window does see the difference
    expect(bedAt(b, 4.5, 4.5)).not.toBe(bedAt(a, 4.5, 4.5));
  });

  it('measures how near a dip is, per kind', () => {
    // Each point: 1 minus the distance (plain hypot) to the cell's rectangle, at most 1, at least 0.
    const near = (cell: { x: number; z: number }, px: number, pz: number) =>
      Math.max(0, 1 - Math.hypot(Math.max(cell.x - px, 0, px - cell.x - 1), Math.max(cell.z - pz, 0, pz - cell.z - 1)));
    const at = (m: TileMap, px: number, pz: number) => { const o = [9, 9, 9, 9]; nearAt(m, px, pz, o, 1); return o; };
    const cell = { x: 5, z: 5 };
    const pts: [number, number][] = [[5.5, 5.5], [5, 5.5], [5.5, 5], [6, 5.5], [4.75, 5.5], [4.5, 5.5], [4, 5.5], [3.5, 5.5], [6.25, 5.5], [7, 5.5],
      [4.7, 4.6], [4.3, 4.3], [4, 4], [3.5, 3.5], [6.4, 6.3], [5.5, 6.5], [5.5, 7.6]];
    for (const [c, ch, slot] of [['L', 'lava', 0], ['C', 'chasm', 1]] as const) {
      const m = room(...Array.from({ length: 9 }, (_, j) => Array.from({ length: 9 }, (_, i) => (i === 4 && j === 4 ? c : '.')).join('')));
      for (const [px, pz] of pts) {
        const o = at(m, px, pz);
        // lava's marks start at its grown shore (#444): 1 up to growAt, then falling to 0 a tile out
        const d = 1 - near(cell, px, pz), g = d < 1 ? growAt(px, pz) : 0;
        const want = slot === 1 ? 1 - d : d <= g ? 1 : 1 - (d - g) / (1 - g);
        expect(o[1 + slot], `${ch} at ${px}, ${pz}`).toBeCloseTo(want, 9);
        expect(o[1 + 1 - slot], `other kind at ${px}, ${pz}`).toBe(0);
        expect([o[0], o[3]], 'outside the written slots').toEqual([9, 9]);
      }
    }
    const two = room('~.L');
    const o = at(two, 2.5, 1.5);
    const g = growAt(2.5, 1.5);
    expect(o[1]).toBeCloseTo(1 - (0.5 - g) / (1 - g), 9);              // lava is one cell and half a tile away, less its grown shore
    expect(o[2]).toBe(0);                                              // the chasm is none
  });
  it('picks the kind from three masks', () => {
    expect(kindOf(0.1, 0.14, 0.149)).toBe(DIP.none);                   // none below 0.15
    expect(kindOf(0.15, 0, 0)).toBe(DIP.water);
    expect(kindOf(0.2, 0.4, 0.3)).toBe(DIP.lava);
    expect(kindOf(0.5, 0.4, 0.3)).toBe(DIP.water);
    expect(kindOf(0.2, 0.3, 0.4)).toBe(DIP.chasm);
    expect(kindOf(0.5, 0.5, 0.5)).toBe(DIP.chasm);                     // ties: chasm over lava over water
    expect(kindOf(0.5, 0.5, 0.2)).toBe(DIP.lava);
    expect(kindOf(0.5, 0.2, 0.5)).toBe(DIP.chasm);
  });
  it('marks the outline by its masks', () => {
    const m = pool('C', 5);
    expect(maskAt(m, edgeX, mid, isChasm)).toBeCloseTo(0.5, 9);
    expect(maskAt(m, edgeX - 0.5, mid, isChasm)).toBe(0);
    expect(maskAt(m, mid, mid, isChasm)).toBe(1);
    expect(maskAt(m, mid, mid, isLava)).toBe(0);
  });
  it('names the kind', () => {
    const m = pool('C', 5);
    const at = (x: number, z: number) => kindOf(maskAt(m, x, z, isWater), maskAt(m, x, z, isLava), maskAt(m, x, z, isChasm));
    expect(at(mid, mid)).toBe(DIP.chasm);
    expect(at(edgeX - 1.5, mid)).toBe(DIP.none);
    const want: Record<keyof typeof TILE_ID, DipKind> = {
      Barrier: DIP.none, Chasm: DIP.chasm, DeepWater: DIP.water, DoorClosed: DIP.none, DoorOpen: DIP.none,
      Floor: DIP.none, Lava: DIP.lava, Road: DIP.none, ShallowWater: DIP.water, Thicket: DIP.none,
      Trunk: DIP.none, Void: DIP.none, Wall: DIP.none,
    };
    for (const [name, id] of Object.entries(TILE_ID)) {
      expect(want[name as keyof typeof TILE_ID], `${name} is listed`).toBeDefined();
      expect(dipOf(id)).toBe(want[name as keyof typeof TILE_ID]);
    }
  });

  it('gives the surface only inside a liquid', () => {
    expect(surfaceAt(pool('~', 5), mid, mid)).toBe(WATER_LEVEL);
    expect(surfaceAt(pool('W', 5), mid, mid)).toBe(WATER_LEVEL);
    expect(surfaceAt(pool('L', 5), mid, mid)).toBe(LAVA_LEVEL);
    expect(surfaceAt(pool('C', 5), mid, mid)).toBe(-Infinity);
    expect(surfaceAt(pool('L', 5), 1.5, 1.5)).toBe(-Infinity);
  });

  it('gives the height below which the world hides a figure: 0 on the floor, the lava surface in lava, nothing hidden in water or a chasm', () => {
    expect(hidingHeightAt(pool('.', 5), mid, mid)).toBe(0);
    expect(hidingHeightAt(pool('L', 5), mid, mid)).toBe(LAVA_LEVEL);
    expect(hidingHeightAt(pool('~', 5), mid, mid)).toBe(NOTHING_HIDDEN);
    expect(hidingHeightAt(pool('W', 5), mid, mid)).toBe(NOTHING_HIDDEN);
    expect(hidingHeightAt(pool('C', 5), mid, mid)).toBe(NOTHING_HIDDEN);
    expect(hidingHeightAt(pool('L', 5), 1.5, 1.5)).toBe(0);
    expect(NOTHING_HIDDEN).toBeLessThan(-CHASM_BED);
  });

  it('lists the mesh cells', () => {
    const m = room('.......', '.......', '...C...', '.......', '.......', '.......', '#.....#');
    m.set(1, 1, TILE_ID.Void);
    // Chasm at (4,3). Neighbours 3..5 x 2..4 are in, floor two away is not.
    for (let j = 2; j <= 4; j++) for (let i = 3; i <= 5; i++) expect(inDipMesh(m, i, j)).toBe(true);
    expect(inDipMesh(m, 6, 3)).toBe(false);
    expect(inDipMesh(m, 4, 5)).toBe(false);
    const w = room('C.', '..');
    expect(inDipMesh(w, 0, 0)).toBe(false); // the border wall
    expect(inDipMesh(w, 1, 1)).toBe(true);
    expect(inDipMesh(w, 2, 2)).toBe(true);
    const d = room('C.', '..');
    d.set(2, 1, TILE_ID.DoorClosed);
    d.set(1, 2, TILE_ID.DoorOpen);
    expect(inDipMesh(d, 2, 1)).toBe(true);
    expect(inDipMesh(d, 1, 2)).toBe(true);
    const v = room('C.');
    v.set(3, 1, TILE_ID.Void);
    expect(inDipMesh(v, 3, 1)).toBe(false);
  });

  it('fades with depth', () => {
    expect(depthFade(0)).toBe(1);
    expect(depthFade(-12)).toBeLessThan(0.035);
    expect(depthFade(3)).toBe(1);
  });

});

describe('walkBedAt', () => {
  it('is bedAt in water and in lava', () => {
    for (const c of ['~', 'W', 'L']) {
      const m = pool(c, 5);
      for (let i = 0; i <= 80; i++) for (const z of [mid, 3.2, 3.5, 2.9]) {
        const x = 2 + (i / 80) * 7;
        expect(walkBedAt(m, x, z)).toBe(bedAt(m, x, z));
      }
    }
  });

  it('is within the roughness and the lip of 0 over a chasm, also where bedAt is its full depth', () => {
    const m = pool('C', 5);
    for (let i = 0; i <= 80; i++) for (let j = 0; j <= 80; j++) {
      const w = walkBedAt(m, 2 + (i / 80) * 7, 2 + (j / 80) * 7);
      expect(w).toBeGreaterThanOrEqual(-ROUGH - 1e-9);   // the bank's own roughness, no wall
      expect(w).toBeLessThanOrEqual(LIP + 1e-9);
    }
    expect(bedAt(m, mid, mid)).toBeCloseTo(-CHASM_BED, 6);
    expect(walkBedAt(m, mid, mid)).toBe(0);
  });

  it('puts a floor cell at an inner corner of the outline on the floor, where bedAt is down the wall', () => {
    const m = room('....', '.CC.', '.C..', '....');
    expect(bedAt(m, 2.92, 2.92)).toBeLessThan(-5);
    expect(Math.abs(walkBedAt(m, 2.92, 2.92))).toBeLessThanOrEqual(LIP + 1e-9);
  });
});
