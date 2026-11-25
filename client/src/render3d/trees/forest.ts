// The trees of one woodland on the CPU: each distinct look is built once (nearest the camera first, within a time budget),
// and the trees are appended per world chunk into one mesh with per-vertex plant values. No three.js: the view uploads what a frame holds.
import { PITCH_MAX } from '../params';
import { DrawQueue } from '../../game/woodland/plantpages';
import { buildTree, type BuiltTree } from './build';
import { plantChunks } from './chunks';
import { WILLOW_SHIFT } from './grow';
import { leafSeed, newLeafBuf, pushLeaves, type LeafBuf } from './leaves';
import { ChunkMesh, FLUTTER_PX } from './mesh';
import { lookKey, type TreeSpec } from './spec';
import { plantVariation } from './variation';
import { SWAY_WAVE_MAX } from '../wind';
import { BRUSH } from '../brush';

export interface Vec3 { x: number; y: number; z: number }
/** One world chunk's trees merged, in the GPU's layout (`ChunkMesh`: the plant's foot, leaf amount and look on every vertex), and the falling leaves of its trees (it grows with the chunk). */
export interface TreeChunk { mesh: ChunkMesh; leaves: LeafBuf; bounds: { min: Vec3; max: Vec3 } }
export interface TreeFrame {
  chunks: ReadonlyMap<number, TreeChunk>;
  /** Chunk index to a number that grows when a tree was added to it. */
  versions: ReadonlyMap<number, number>;
  palette: number;
  /** Every tree of the forest is built: no chunk will change again until the forest does. */
  complete: boolean;
  wind: boolean;
  t: number;
  /** Leaf amount forced on every living tree; negative: none. */
  leafOverride: number;
  plain: boolean;
  /** Dev page: a multiplier on how often leaves fall (1: the real rate). */
  leafRate: number;
}

/** Milliseconds of tree building per frame (first guess). */
export const TREE_BUDGET_MS = 3;
/** Tiles the camera may move before the building order is sorted again. */
const RESORT = 4;
/** Tiles of horizontal room a chunk's bounds allow beyond a tree's vertices at least. */
const MIN_MARGIN = 0.3;
const STRETCH = 1 / Math.cos((PITCH_MAX * Math.PI) / 180);
/** The flutter moves a patch along and across the wind, each by FLUTTER_PX / 16 tiles at most. */
const FLUTTER = (2 * FLUTTER_PX) / 16;

/** A built look with its extent (tiles, plant-local) as drawn: the patches' spread, the sway and the flutter included. */
interface Built { tree: BuiltTree; min: Vec3; max: Vec3 }
function extent(t: BuiltTree): Built {
  const m = t.mesh, p = m.position, min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    min.x = Math.min(min.x, p[i]); max.x = Math.max(max.x, p[i]);
    min.y = Math.min(min.y, p[i + 1]); max.y = Math.max(max.y, p[i + 1]);
    min.z = Math.min(min.z, p[i + 2]); max.z = Math.max(max.z, p[i + 2]);
  }
  let half = 0, swing = 0;
  const tuft = m.tuft, sway = m.sway;
  for (let i = 2; i < tuft.length; i += 4) half = Math.max(half, tuft[i]);
  // The sway stream's x is each vertex's sway factor (tiles per unit of wave; negative on a bush: the brush mark); the wave reaches SWAY_WAVE_MAX at most.
  let brushed = false;
  for (let i = 0; i < sway.length; i += 2) { swing = Math.max(swing, Math.abs(sway[i])); if (sway[i] < 0) brushed = true; }
  // A patch is spread along the camera's right and up axes, whose horizontal parts together reach sqrt 2 times the half-size.
  const room = Math.max(MIN_MARGIN, half * Math.SQRT2 + swing * SWAY_WAVE_MAX + FLUTTER) + (brushed ? BRUSH.max : 0);
  min.x -= room; min.z -= room; max.x += room; max.z += room;
  max.y = Math.max(max.y + half, (t.height + half) * STRETCH);
  return { tree: t, min, max };
}

export class Forest {
  private readonly looks = new Map<string, Built>();
  private readonly chunkMap = new Map<number, TreeChunk>();
  private readonly versionMap = new Map<number, number>();
  private readonly chunkOf: number[] = [];
  private readonly pending = new Set<number>();
  private readonly queue: DrawQueue;
  private sortedAt: { x: number; z: number } | null = null;
  private done = 0;

  constructor(
    private readonly specs: readonly TreeSpec[],
    map: { w: number; h: number },
    private readonly palette: number,
    private readonly builder: (s: TreeSpec) => BuiltTree = buildTree,
    now: () => number = () => performance.now(),
  ) {
    this.queue = new DrawQueue(TREE_BUDGET_MS, now);
    for (const [chunk, list] of plantChunks(specs, map)) for (const i of list) this.chunkOf[i] = chunk;
    specs.forEach((_, i) => this.pending.add(i));
  }

  get built(): number { return this.done; }
  get total(): number { return this.specs.length; }
  /** How many built looks are kept for sharing (none once the forest is complete). */
  get cachedLooks(): number { return this.looks.size; }

  /** Builds trees within `budgetMs` (nearest to `cam` first, sorted again after the camera moved 4 tiles; at least one when any is pending). Returns how many were added. */
  step(cam: { x: number; z: number }, budgetMs: number): number {
    if (this.pending.size === 0) return 0;
    const s = this.sortedAt;
    if (!s || Math.hypot(cam.x - s.x, cam.z - s.z) >= RESORT) {
      this.sortedAt = { x: cam.x, z: cam.z };
      this.queue.clear();
      const idx = [...this.pending];
      const d = idx.map((i) => Math.hypot(this.specs[i].x - cam.x, this.specs[i].z - cam.z));
      idx.map((_, o) => o).sort((a, b) => d[a] - d[b] || idx[a] - idx[b]).forEach((o) => this.queue.push(() => this.add(idx[o])));
    }
    return this.queue.run(budgetMs);
  }

  frame(o: { wind: boolean; t: number; leafOverride?: number; plain?: boolean; leafRate?: number }): TreeFrame {
    return { chunks: this.chunkMap, versions: this.versionMap, palette: this.palette, complete: this.done === this.specs.length, wind: o.wind, t: o.t, leafOverride: o.leafOverride ?? -1, plain: o.plain ?? false, leafRate: o.leafRate ?? 1 };
  }

  private add(i: number): void {
    const sp = this.specs[i], key = lookKey(sp);
    let b = this.looks.get(key);
    if (!b) { b = extent(this.builder(sp)); this.looks.set(key, b); }
    this.pending.delete(i);
    this.done++;
    const chunk = this.chunkOf[i];
    let c = this.chunkMap.get(chunk);
    if (!c) {
      c = { mesh: new ChunkMesh(), leaves: newLeafBuf(), bounds: { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } } };
      this.chunkMap.set(chunk, c);
    }
    const v = plantVariation(sp.x, sp.z);
    c.mesh.append(b.tree.mesh, sp.x, sp.z, sp.dead ? 0 : sp.leaf, sp.dead, v);
    // The falling leaves, with the plant's own leaf amount and colour (a willow's leaves carry its own warmer, lighter shift).
    const leaves = c.leaves, from = leaves.n;
    pushLeaves(leaves, b.tree, sp.x, sp.z, leafSeed(sp.seed, sp.x, sp.z));
    const look: [number, number, number, number] = sp.form === 'willow' ? [v[0] + WILLOW_SHIFT.bright, v[1] + WILLOW_SHIFT.warm, v[2], v[3]] : v;
    for (let k = from; k < leaves.n; k++) { leaves.leaf.push(sp.leaf); leaves.look.push(...look); }
    const bd = c.bounds;
    bd.min.x = Math.min(bd.min.x, b.min.x + sp.x); bd.max.x = Math.max(bd.max.x, b.max.x + sp.x);
    bd.min.z = Math.min(bd.min.z, b.min.z + sp.z); bd.max.z = Math.max(bd.max.z, b.max.z + sp.z);
    bd.min.y = Math.min(bd.min.y, b.min.y);
    bd.max.y = Math.max(bd.max.y, b.max.y);
    this.versionMap.set(chunk, (this.versionMap.get(chunk) ?? 0) + 1);
    // The looks only share builds between trees; the chunks keep their merged meshes, so a finished forest lets them go.
    if (this.done === this.specs.length) this.looks.clear();
  }
}
