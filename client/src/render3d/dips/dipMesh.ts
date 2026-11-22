import type { TileMap } from '../../sim/map';
import { cellHeight } from '../heights';
import { CHUNK, KIND, flatSurface } from '../worldMesh';
import { STONE_PX } from '../stone/field';
import type { SheetPlan } from '../stone/plan';
import { TILE_ID } from '../../generated/defs';
import { GROUND_TILES } from '../../game/woodland/ground';
import { bedAt, dipOf, inDipMesh, isChasm, isLava, isWater, kindOf, maskAt, nearAt } from './shape';

/** Quads per cell edge of the dip ground. */
export const DIP_RES = 12;

export interface DipArrays {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  kind: Float32Array;
  /** The ground sheet's u, v (px) and layer of the vertex's world point (layer -1: no ground page, as on the woodland); the dip ground reads the stone through it. */
  sheet: Float32Array;
  /** The DipKind at each vertex: which bank material it takes. */
  dip: Float32Array;
  /**
   * Three values at each vertex, for the marks on the floor along a rim: x is the chasm's mask (0.5 on a straight outline, 1 inside), y how
   * near lava lies and z how near a chasm lies (`nearAt`: 1 on the cells, 0 one tile away).
   */
  marks: Float32Array;
  index: Uint32Array;
  count: number;
}

export interface DipChunk { cx: number; cz: number; arrays: DipArrays; min: [number, number, number]; max: [number, number, number] }

// dx, dz of the neighbour, then the inward normal of the edge and the edge's first point (offsets) with its direction.
const SIDES: { dx: number; dz: number; n: [number, number]; ox: number; oz: number; ax: number; az: number }[] = [
  { dx: -1, dz: 0, n: [1, 0], ox: 0, oz: 0, ax: 0, az: 1 },
  { dx: 1, dz: 0, n: [-1, 0], ox: 1, oz: 0, ax: 0, az: 1 },
  { dx: 0, dz: -1, n: [0, 1], ox: 0, oz: 0, ax: 1, az: 0 },
  { dx: 0, dz: 1, n: [0, -1], ox: 0, oz: 1, ax: 1, az: 0 },
];

/**
 * Whether a cell turning from tile `a` to tile `b` can change the dip chunks or the liquid plates around it: its dip kind, its height
 * (wall or not) or its painted-ground kind (`flatSurface`) differs. A door opening or closing changes none of them.
 */
export function dipClassChanged(a: number, b: number): boolean {
  return dipOf(a) !== dipOf(b) || (a === TILE_ID.DeepWater) !== (b === TILE_ID.DeepWater) || cellHeight(a) !== cellHeight(b) || GROUND_TILES.has(a) !== GROUND_TILES.has(b);
}

/** The ground of the dip cells of chunk (cx, cz), or null when it has none. `plan` gives the chunk's ground page. */
export function buildDipChunk(map: TileMap, painted: boolean, cx: number, cz: number, plan: SheetPlan): DipChunk | null {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(map.w, x0 + CHUNK), z1 = Math.min(map.h, z0 + CHUNK);
  const layer = plan.groundOf(cx, cz);
  const position: number[] = [], normal: number[] = [], uv: number[] = [], kind: number[] = [], sheet: number[] = [], dip: number[] = [], marks: number[] = [];
  const index: number[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const R = DIP_RES, N = R + 1, G = R + 3;
  const grid = new Float64Array(G * G);

  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (!inDipMesh(map, x, z)) continue;
    const s = flatSurface(map, painted, x, z);
    const push = (px: number, py: number, pz: number, n: [number, number, number]) => {
      position.push(px, py, pz);
      normal.push(n[0], n[1], n[2]);
      uv.push(s.u0 + (px - x) * 16, s.v0 + (pz - z) * 16);
      kind.push(s.kind);
      sheet.push((px - x0) * STONE_PX, (pz - z0) * STONE_PX, s.kind === KIND.ground ? -1 : layer);
      const chasm = maskAt(map, px, pz, isChasm);
      dip.push(kindOf(maskAt(map, px, pz, isWater), maskAt(map, px, pz, isLava), chasm));
      marks.push(chasm, 0, 0);
      nearAt(map, px, pz, marks, marks.length - 2);
      min[0] = Math.min(min[0], px); min[1] = Math.min(min[1], py); min[2] = Math.min(min[2], pz);
      max[0] = Math.max(max[0], px); max[1] = Math.max(max[1], py); max[2] = Math.max(max[2], pz);
    };

    // The bed once per grid point, with a border of one point: the normals are central differences of the grid (one step either way).
    // A shared edge gets the same values from either cell, because `bedAt` is a pure function of the point.
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) grid[j * G + i] = bedAt(map, x + (i - 1) / R, z + (j - 1) / R);
    const base = kind.length;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j + 1) * G + i + 1;
      const dx = (grid[k + 1] - grid[k - 1]) * (R / 2);
      const dz = (grid[k + G] - grid[k - G]) * (R / 2);
      const len = Math.hypot(dx, 1, dz);
      push(x + i / R, grid[k], z + j / R, [-dx / len, 1 / len, -dz / len]);
    }
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const a = base + j * N + i, b = a + 1, c = a + N + 1, d = a + N;
      index.push(a, c, b, a, d, c);
    }

    // A skirt closes the slit under a wall (or void) side, where the bed dips below the wall face's foot at y = 0.
    for (const side of SIDES) {
      if (cellHeight(map.get(x + side.dx, z + side.dz)) === 0) continue;
      const pts = Array.from({ length: N }, (_, k) => ({ px: x + side.ox + side.ax * k / R, pz: z + side.oz + side.az * k / R }));
      const beds = pts.map((p) => bedAt(map, p.px, p.pz));
      if (beds.every((b) => b >= 0)) continue;
      const n: [number, number, number] = [side.n[0], 0, side.n[1]];
      const top = kind.length;
      for (const p of pts) push(p.px, 0, p.pz, n);
      const bot = kind.length;
      pts.forEach((p, k) => push(p.px, Math.min(beds[k], 0), p.pz, n));
      // (top, bottom, next top) has the normal (-az, 0, ax); flip the winding when that points out of the dip cell.
      const forward = -side.az * n[0] + side.ax * n[2] > 0;
      for (let k = 0; k < R; k++) {
        const t0 = top + k, t1 = t0 + 1, b0 = bot + k, b1 = b0 + 1;
        if (forward) index.push(t0, b0, t1, t1, b0, b1);
        else index.push(t0, t1, b0, t1, b1, b0);
      }
    }
  }
  if (kind.length === 0) return null;
  return {
    cx, cz,
    arrays: {
      position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv),
      kind: new Float32Array(kind), sheet: new Float32Array(sheet), dip: new Float32Array(dip), marks: new Float32Array(marks),
      index: new Uint32Array(index), count: kind.length,
    },
    min, max,
  };
}
