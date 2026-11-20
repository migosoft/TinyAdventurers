// SPIKE (#380), throwaway: the stone demo level. Four rooms: a rock cave (start), a hall of laid stone with a summoning circle
// of masonry, a rune chamber, and a second cave. Per cell: the tile, whether it is rock, and an ornament flag.
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';

const W = 48, H = 29;

export interface StoneLevel {
  map: TileMap;
  /** 1 per rock cell, 0 per laid cell. */
  rock: Uint8Array;
  /** 1 per cell of the rune chamber. */
  orn: Uint8Array;
  /** The summoning circle: centre and radius in tiles. */
  circle: { x: number; z: number; r: number };
  torches: { x: number; y: number; z: number; ph: number }[];
  /** Glowing crystals: lights without a sprite. */
  crystals: { x: number; y: number; z: number; r: number; g: number; b: number }[];
  spawn: { x: number; z: number };
  /** Named places for the camera (`&at=<name>`). */
  places: Record<string, { x: number; z: number }>;
}

function build(): StoneLevel {
  const tiles = new Uint8Array(W * H).fill(TILE_ID.Wall);
  const rock = new Uint8Array(W * H);
  const orn = new Uint8Array(W * H);
  const carve = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) tiles[z * W + x] = TILE_ID.Floor;
  };
  const wall = (cells: [number, number][]): void => {
    for (const [x, z] of cells) tiles[z * W + x] = TILE_ID.Wall;
  };
  // Cave A (start): a ragged outline and two rock masses.
  carve(3, 3, 14, 12);
  wall([[3, 3], [4, 3], [3, 4], [14, 3], [13, 3], [14, 4], [3, 12], [3, 11], [4, 12], [14, 12], [13, 12], [14, 11], [8, 3], [9, 3], [3, 8], [9, 12]]);
  wall([[7, 6], [8, 6], [7, 7], [8, 7], [11, 9], [12, 9], [11, 10]]);
  // Passage to the hall.
  carve(15, 7, 19, 8);
  // Hall B with four pillars.
  carve(20, 3, 33, 13);
  wall([[22, 5], [31, 5], [22, 11], [31, 11]]);
  // Corridor to the rune chamber, and the chamber.
  carve(34, 8, 37, 8);
  carve(38, 5, 44, 11);
  // Corridor down to the second cave, and the cave.
  carve(26, 14, 27, 17);
  carve(20, 18, 33, 25);
  wall([[20, 18], [21, 18], [20, 19], [33, 18], [33, 19], [32, 18], [20, 25], [21, 25], [20, 24], [33, 25], [32, 25], [33, 24], [29, 18], [24, 25], [25, 25]]);
  wall([[23, 21], [24, 21], [23, 22], [30, 22], [30, 23], [31, 22]]);

  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (x < 18 || z >= 16) rock[z * W + x] = 1;
    if (x >= 38) orn[z * W + x] = 1;
  }
  const torch = (cx: number, cz: number, i: number) => ({ x: cx + 0.5, y: 1.0, z: cz + 1 + 0.16, ph: i * 1.7 });
  return {
    map: new TileMap(W, H, tiles),
    rock, orn,
    circle: { x: 27, z: 8.5, r: 3.1 },
    torches: [torch(21, 2, 0), torch(27, 2, 1), torch(33, 2, 2), torch(39, 4, 3), torch(43, 4, 4)],
    crystals: [
      { x: 5.6, y: 0.5, z: 4.4, r: 0.25, g: 0.9, b: 1.1 },
      { x: 12.6, y: 0.5, z: 11.3, r: 0.75, g: 0.35, b: 1.1 },
      { x: 21.8, y: 0.5, z: 19.6, r: 0.25, g: 0.9, b: 1.1 },
      { x: 32.2, y: 0.5, z: 23.6, r: 0.25, g: 1.0, b: 0.8 },
      { x: 26.5, y: 0.5, z: 24.4, r: 0.75, g: 0.35, b: 1.1 },
    ],
    spawn: { x: 9.5, z: 9.5 },
    places: { cave: { x: 9.5, z: 9.5 }, border: { x: 18.5, z: 8 }, hall: { x: 27, z: 10.2 }, runes: { x: 41.5, z: 8.5 }, cave2: { x: 27, z: 21.5 }, door: { x: 27, z: 15.5 } },
  };
}

export const STONE_LEVEL: StoneLevel = build();

/** How much rock a world point is, 0..1: the cells' rock flags read between cell centres, so the border is a soft band about a tile wide. */
export function rockAmount(x: number, z: number): number {
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  const v = Math.max(c(18.5 - x), c(z - 15.5));
  const t = c((v - 0.25) / 0.5);
  return t * t * (3 - 2 * t);
}

// ---- Cracks: straight jagged fault lines (second version; the winding ones did not read as cracks). ----

export interface CrackSeg { ax: number; az: number; bx: number; bz: number; hw: number }

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildCracks(): CrackSeg[] {
  const L = STONE_LEVEL, out: CrackSeg[] = [];
  const open = (x: number, z: number): boolean => L.map.get(Math.floor(x), Math.floor(z)) === TILE_ID.Floor;
  const walk = (x: number, z: number, ang: number, n: number, hw: number, r: () => number, branch: boolean): void => {
    for (let i = 0; i < n; i++) {
      const len = 0.35 + r() * 0.75;
      // Sharp turns between straight pieces, alternating sides, so the line zigzags along one direction.
      const a = ang + (i % 2 ? 1 : -1) * (0.25 + r() * 0.55);
      const nx = x + Math.cos(a) * len, nz = z + Math.sin(a) * len;
      if (!open(nx, nz) || !open((x + nx) / 2, (z + nz) / 2)) return;
      const w = hw * (1 - (i / n) * 0.75);
      out.push({ ax: x, az: z, bx: nx, bz: nz, hw: w });
      if (branch && r() < 0.35) walk(nx, nz, a + (r() < 0.5 ? 1 : -1) * (0.7 + r() * 0.4), 2, w * 0.6, r, false);
      x = nx;
      z = nz;
    }
  };
  const seeds: [number, number, number, number, number][] = [
    [5.2, 5.6, 0.4, 7, 0.05], [10.5, 11.2, -2.3, 5, 0.04], [22.4, 20.2, 0.5, 8, 0.055], [31.2, 23.8, 3.5, 6, 0.045], [27.2, 19.2, 1.5, 4, 0.04],
    [21.2, 12.4, -0.5, 4, 0.03], [15.4, 7.5, 0.1, 4, 0.035],
  ];
  seeds.forEach(([x, z, a, n, hw], i) => walk(x, z, a, n, hw, rng(977 + i * 131), true));
  return out;
}

export const CRACKS: CrackSeg[] = buildCracks();

/** How deep in a crack a point is, 0 (outside) to 1 (the middle). */
export function crackDepth(x: number, z: number): number {
  let best = 0;
  for (const s of CRACKS) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
    if (d < s.hw) best = Math.max(best, 1 - d / s.hw);
  }
  return best;
}

/** The cracks as a mask, `CRACK_RES` texels per tile, 255 inside a crack: the shader's crisp edge. */
export const CRACK_RES = 32;
export function crackMask(): { data: Uint8Array; w: number; h: number } {
  const w = W * CRACK_RES, h = H * CRACK_RES, data = new Uint8Array(w * h);
  for (const s of CRACKS) {
    const pad = s.hw + 0.05;
    const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) * CRACK_RES), x1 = Math.ceil((Math.max(s.ax, s.bx) + pad) * CRACK_RES);
    const z0 = Math.floor((Math.min(s.az, s.bz) - pad) * CRACK_RES), z1 = Math.ceil((Math.max(s.az, s.bz) + pad) * CRACK_RES);
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    for (let pz = Math.max(0, z0); pz < Math.min(h, z1); pz++) for (let px = Math.max(0, x0); px < Math.min(w, x1); px++) {
      const x = (px + 0.5) / CRACK_RES, z = (pz + 0.5) / CRACK_RES;
      const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
      // At least one texel wide, so a thin end stays a line.
      if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) < Math.max(s.hw, 0.6 / CRACK_RES)) data[pz * w + px] = 255;
    }
  }
  return { data, w, h };
}

/** The mosaic in the chamber's floor and the drain grate in the hall: centre and half size in tiles. */
export const MOSAIC = { x: 41.5, z: 8.5, hx: 2.25, hz: 1.75 };
export const GRATE = { x: 24.5, z: 12.5, half: 0.375 };
