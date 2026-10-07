// Terrain tiles (water, lava, chasm) generated at atlas build time. The 0x72
// pack has none, and no CC0 set matched its style, so the user allowed these
// to be made here: only pack colours, the pack's floor_1 for the ground around
// rounded corners, and the pack's 3/4 view (a bank face on the north side,
// like the pack's `hole`).
//
// Two kinds of frames:
// - Base textures, seamless over 2x2 or 4x4 tiles and split into 16x16 pieces
//   (`terrain_<set>_f<frame>_q<n>`, n = x%p + p*(y%p), see TERRAIN_PERIOD),
//   animated where the surface moves.
// - Edge overlays drawn on top (`terrain_<edge>_e<code>`), transparent in the
//   middle. `code` is four digits, one per quarter (NW, NE, SW, SE), each the
//   quarter's case from `edgeCase` below; the client computes the same code.
import type { Image } from './png';
import { edgeCode, TERRAIN_EDGES, TERRAIN_FRAMES, TERRAIN_PERIOD, type TerrainEdge, type TerrainSet } from '../src/game/terrain-codes';

type Rgb = [number, number, number];
const hex = (s: string): Rgb => [0, 2, 4].map((k) => parseInt(s.slice(k, k + 2), 16)) as Rgb;

// Pack colours, dark to light.
const C = {
  black: hex('111111'),
  void1: hex('140c11'),
  void2: hex('1d1218'),
  outline: hex('222222'),
  face3: hex('2b2929'),
  face2: hex('302c2b'),
  face1: hex('3b3332'),
  floor: hex('483b3a'),
  lip: hex('775c55'),
  w0: hex('243f4c'),
  w1: hex('314152'),
  w2: hex('38607c'),
  w3: hex('417089'),
  w4: hex('5698cc'),
  w5: hex('72d6ce'),
  w6: hex('cae6f5'),
  l0: hex('21141b'),
  l1: hex('62232f'),
  l2: hex('8f4029'),
  l3: hex('c56025'),
  l4: hex('da4e38'),
  l5: hex('ee8e2e'),
  l6: hex('facb3e'),
  l7: hex('ffcc68'),
};


// ---------------------------------------------------------------- noise ----
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise that wraps every `period` px (lattice of `cells`x`cells`). */
function periodicNoise(seed: number, cells: number, period = 32): (x: number, y: number) => number {
  const r = rng(seed);
  const g = Array.from({ length: cells * cells }, () => r());
  const at = (i: number, j: number) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  const step = period / cells;
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / step;
    const fy = y / step;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = sm(fx - i);
    const v = sm(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

// ------------------------------------------------------- base textures ----
type Tex = (x: number, y: number, f: number) => Rgb;

function waterTex(deep: boolean): Tex {
  const P = TERRAIN_PERIOD[deep ? 'deep' : 'water'] * 16;
  const n = periodicNoise(deep ? 11 : 7, deep ? 5 : 4, P);
  const r = rng(deep ? 21 : 17);
  // Ripple dashes: short horizontal highlights that sway left and right.
  const dashes = Array.from({ length: deep ? 20 : 9 }, () => ({ x: Math.floor(r() * P), y: Math.floor(r() * P), len: 2 + Math.floor(r() * 3), ph: Math.floor(r() * 4) }));
  const glints = Array.from({ length: deep ? 8 : 5 }, () => ({ x: Math.floor(r() * P), y: Math.floor(r() * P), on: Math.floor(r() * 4) }));
  const sway = [0, 1, 0, -1];
  return (x, y, f) => {
    for (const g of glints) if (g.on === f && g.x === x && g.y === y) return deep ? C.w4 : C.w5;
    for (const d of dashes) {
      const dx = (((x - d.x - sway[(f + d.ph) % 4]) % P) + P) % P;
      if (y === d.y && dx < d.len) return deep ? C.w2 : C.w4;
    }
    const v = n(x, y);
    if (deep) return v < 0.28 ? C.w0 : C.w1;
    return v < 0.3 ? C.w2 : C.w3;
  };
}

function lavaTex(): Tex {
  const P = 64;
  const n1 = periodicNoise(31, 8, P);
  const n2 = periodicNoise(37, 4, P);
  const r = rng(41);
  const bubbles = Array.from({ length: 7 }, () => ({ x: Math.floor(r() * P), y: Math.floor(r() * P), t: Math.floor(r() * 6) }));
  const lava = (x: number, y: number, f: number) =>
    // Crust plates drift slowly: the second noise shifts the field over the loop.
    n1(x, y) * 0.8 + 0.12 * Math.sin((f / 6) * 2 * Math.PI + n2(x, y) * 2 * Math.PI);
  return (x, y, f) => {
    for (const b of bubbles) {
      const age = (f - b.t + 6) % 6;
      const dx = Math.abs(((x - b.x + P + P / 2) % P) - P / 2);
      const dy = Math.abs(((y - b.y + P + P / 2) % P) - P / 2);
      if (age === 0 && dx + dy === 0) return C.l7;
      if (age === 1 && dx + dy === 1) return C.l6;
      if (age === 2 && dx + dy === 2 && (x + y) % 2 === 0) return C.l5;
    }
    const v = lava(x, y, f);
    if (v < 0.36) {
      // Dark crust with a glowing seam where it meets the melt.
      const seam = [lava(x + 1, y, f), lava(x - 1, y, f), lava(x, y + 1, f), lava(x, y - 1, f)].some((u) => u >= 0.36);
      return seam ? C.l2 : C.l1;
    }
    return v < 0.44 ? C.l3 : v < 0.58 ? C.l4 : v < 0.7 ? C.l5 : C.l6;
  };
}

function chasmTex(): Tex {
  const r = rng(53);
  const specks = new Set(Array.from({ length: 4 }, () => Math.floor(r() * 32) + 32 * Math.floor(r() * 32)));
  return (x, y) => (specks.has(x + 32 * y) ? C.void2 : C.black);
}

const TEX: Record<TerrainSet, Tex> = { water: waterTex(false), deep: waterTex(true), lava: lavaTex(), chasm: chasmTex() };

// -------------------------------------------------------------- edges ----
/** All edge codes that occur (47), skipping the all-inside one. */
function allCodes(): { code: string; n: boolean[] }[] {
  const seen = new Map<string, boolean[]>();
  for (let m = 0; m < 256; m++) {
    const n = Array.from({ length: 8 }, (_, i) => !!(m & (1 << i)));
    const code = edgeCode(n);
    if (code !== '0000' && !seen.has(code)) seen.set(code, n);
  }
  return [...seen].map(([code, n]) => ({ code, n }));
}

interface EdgeStyle {
  /** Bank face rows below an outside cell to the north, top to bottom. */
  face: Rgb[];
  /** Rim colours by distance (1 = next to the ground) on the other sides; null = leave the base. */
  rim: (Rgb | null)[];
  /** Outside the rounded shape: the floor, or a flat colour. */
  ground: 'floor' | Rgb;
  /** Masonry seams in the bank face (the chasm's cliff). */
  seams?: boolean;
}
const EDGES: Record<TerrainEdge, EdgeStyle> = {
  shore: { face: [C.lip, C.face1, C.face2, C.outline], rim: [C.outline, C.w2], ground: 'floor' },
  // Deep water inside the shallow rim: a dark lip, no bank.
  deep: { face: [C.w2], rim: [C.w2], ground: C.w3 },
  lava: { face: [C.lip, C.face1, C.l0, C.l1], rim: [C.l0, C.l1, C.l2], ground: 'floor' },
  chasm: { face: [C.lip, C.floor, C.floor, C.face1, C.face1, C.face2, C.face3, C.outline, C.void2], rim: [C.lip, C.outline], ground: 'floor', seams: true },
};

function edgeTile(style: EdgeStyle, n: boolean[], floor: (x: number, y: number) => Rgb): (Rgb | null)[] {
  // Inside map over the 3x3 cell block (48x48), then an opening with radius 3
  // rounds the terrain's outer corners.
  const [N, NE, E, SE, S, SW, W, NW] = n;
  const cell = [
    [NW, N, NE],
    [W, true, E],
    [SW, S, SE],
  ];
  const ins = (x: number, y: number) => x >= 0 && y >= 0 && x < 48 && y < 48 && cell[Math.floor(y / 16)][Math.floor(x / 16)];
  const R = 3;
  const disc: [number, number][] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R + 1) disc.push([dx, dy]);
  const eroded = (x: number, y: number) => disc.every(([dx, dy]) => ins(x + dx, y + dy));
  const inside = (x: number, y: number) => disc.some(([dx, dy]) => eroded(x + dx, y + dy));

  const px: (Rgb | null)[] = [];
  for (let y = 16; y < 32; y++)
    for (let x = 16; x < 32; x++) {
      if (!inside(x, y)) {
        px.push(style.ground === 'floor' ? floor(x - 16, y - 16) : style.ground);
        continue;
      }
      // Bank face: rows just below ground to the north.
      let face = -1;
      for (let k = 1; k <= style.face.length; k++)
        if (!inside(x, y - k)) {
          face = k - 1;
          break;
        }
      if (face >= 0) {
        // Cliff masonry: two courses of blocks with offset vertical joints.
        const joint = style.seams && face >= 2 && face <= 6 && (face === 4 || (x + (face < 4 ? 0 : 4)) % 8 === 0);
        px.push(joint ? C.outline : style.face[face]);
        continue;
      }
      // Rim on the other sides: Chebyshev distance to the outside.
      let rim = -1;
      for (let k = 1; k <= style.rim.length && rim < 0; k++)
        for (let d = -k; d <= k; d++)
          if (!inside(x + d, y - k) || !inside(x + d, y + k) || !inside(x - k, y + d) || !inside(x + k, y + d)) {
            rim = k - 1;
            break;
          }
      if (rim >= 0 && style.rim[rim]) px.push(style.rim[rim]);
      else px.push(null);
    }
  return px;
}

// -------------------------------------------------------------- sheet ----
export interface TerrainSheet {
  img: Image;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

/** Builds all terrain frames into one image, `floor1` being the pack's floor_1 pixels (16x16 RGBA). */
export function buildTerrain(floor1: Uint8Array): TerrainSheet {
  const floor = (x: number, y: number): Rgb => {
    const i = (y * 16 + x) * 4;
    return [floor1[i], floor1[i + 1], floor1[i + 2]];
  };
  const tiles: { name: string; px: (Rgb | null)[] }[] = [];
  for (const set of Object.keys(TERRAIN_FRAMES) as TerrainSet[])
    for (let f = 0; f < TERRAIN_FRAMES[set]; f++)
      for (let q = 0, p = TERRAIN_PERIOD[set]; q < p * p; q++) {
        const ox = (q % p) * 16;
        const oy = Math.floor(q / p) * 16;
        const px: Rgb[] = [];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.push(TEX[set](ox + x, oy + y, f));
        tiles.push({ name: `terrain_${set}_f${f}_q${q}`, px });
      }
  const codes = allCodes();
  for (const edge of TERRAIN_EDGES) for (const { code, n } of codes) tiles.push({ name: `terrain_${edge}_e${code}`, px: edgeTile(EDGES[edge], n, floor) });

  const COLS = 32;
  const w = COLS * 16;
  const h = Math.ceil(tiles.length / COLS) * 16;
  const img: Image = { w, h, data: new Uint8Array(w * h * 4) };
  const frames: TerrainSheet['frames'] = {};
  tiles.forEach((t, i) => {
    const tx = (i % COLS) * 16;
    const ty = Math.floor(i / COLS) * 16;
    t.px.forEach((c, j) => {
      if (!c) return;
      const d = ((ty + Math.floor(j / 16)) * w + tx + (j % 16)) * 4;
      img.data.set([c[0], c[1], c[2], 255], d);
    });
    frames[t.name] = { x: tx, y: ty, w: 16, h: 16 };
  });
  return { img, frames };
}
