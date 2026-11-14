// The trees of one woodland on the CPU: each distinct look is built once (nearest the camera first, within a time budget),
// and the trees are appended per world chunk into one mesh with per-vertex plant values. No three.js: the view uploads what a frame holds.
import { PITCH_MAX } from '../params';
import { DrawQueue } from '../../game/woodland/plantpages';
import { buildTree, type BuiltTree } from './build';
import { plantChunks } from './chunks';
import { TreeMesh, appendAt } from './mesh';
import { lookKey, type TreeSpec } from './spec';
import { plantVariation } from './variation';

export interface Vec3 { x: number; y: number; z: number }
/** One world chunk's trees merged: the mesh streams plus, per vertex, `plant` (foot x, z, leaf amount, dead) and `look` (leaf bright, leaf warm, bark light, bark grey). */
export interface TreeChunk { mesh: TreeMesh; plant: Float32Array; look: Float32Array; bounds: { min: Vec3; max: Vec3 } }
export interface TreeFrame {
  chunks: ReadonlyMap<number, TreeChunk>;
  /** Chunk index to a number that grows when a tree was added to it. */
  versions: ReadonlyMap<number, number>;
  palette: number;
  wind: boolean;
  t: number;
  /** Leaf amount forced on every living tree; negative: none. */
  leafOverride: number;
  plain: boolean;
}

/** Milliseconds of tree building per frame (first guess). */
export const TREE_BUDGET_MS = 3;
/** Tiles the camera may move before the building order is sorted again. */
const RESORT = 4;
/** Tiles of horizontal sway a chunk's bounds allow beyond a tree's vertices. */
const SWAY_MARGIN = 0.3;
const STRETCH = 1 / Math.cos((PITCH_MAX * Math.PI) / 180);

interface Built { tree: BuiltTree; min: Vec3; max: Vec3 }
interface Slot { chunk: TreeChunk; plant: number[]; look: number[]; dirty: boolean }

function extent(t: BuiltTree): Built {
  const p = t.mesh.position, min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    min.x = Math.min(min.x, p[i]); max.x = Math.max(max.x, p[i]);
    min.y = Math.min(min.y, p[i + 1]); max.y = Math.max(max.y, p[i + 1]);
    min.z = Math.min(min.z, p[i + 2]); max.z = Math.max(max.z, p[i + 2]);
  }
  return { tree: t, min, max };
}

export class Forest {
  private readonly looks = new Map<string, Built>();
  private readonly slots = new Map<number, Slot>();
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

  frame(o: { wind: boolean; t: number; leafOverride?: number; plain?: boolean }): TreeFrame {
    for (const [k, slot] of this.slots) {
      if (!slot.dirty) continue;
      slot.dirty = false;
      slot.chunk.plant = Float32Array.from(slot.plant);
      slot.chunk.look = Float32Array.from(slot.look);
      this.chunkMap.set(k, slot.chunk);
    }
    return { chunks: this.chunkMap, versions: this.versionMap, palette: this.palette, wind: o.wind, t: o.t, leafOverride: o.leafOverride ?? -1, plain: o.plain ?? false };
  }

  private add(i: number): void {
    const sp = this.specs[i], key = lookKey(sp);
    let b = this.looks.get(key);
    if (!b) { b = extent(this.builder(sp)); this.looks.set(key, b); }
    this.pending.delete(i);
    this.done++;
    const chunk = this.chunkOf[i];
    let slot = this.slots.get(chunk);
    if (!slot) {
      const c: TreeChunk = { mesh: new TreeMesh(), plant: new Float32Array(0), look: new Float32Array(0), bounds: { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } } };
      this.slots.set(chunk, (slot = { chunk: c, plant: [], look: [], dirty: false }));
    }
    const n = b.tree.mesh.verts, v = plantVariation(sp.x, sp.z);
    appendAt(slot.chunk.mesh, b.tree.mesh, sp.x, sp.z);
    for (let k = 0; k < n; k++) {
      slot.plant.push(sp.x, sp.z, sp.dead ? 0 : sp.leaf, sp.dead ? 1 : 0);
      slot.look.push(v[0], v[1], v[2], v[3]);
    }
    const bd = slot.chunk.bounds;
    bd.min.x = Math.min(bd.min.x, b.min.x + sp.x - SWAY_MARGIN); bd.max.x = Math.max(bd.max.x, b.max.x + sp.x + SWAY_MARGIN);
    bd.min.z = Math.min(bd.min.z, b.min.z + sp.z - SWAY_MARGIN); bd.max.z = Math.max(bd.max.z, b.max.z + sp.z + SWAY_MARGIN);
    bd.min.y = Math.min(bd.min.y, b.min.y);
    bd.max.y = Math.max(bd.max.y, b.max.y, b.tree.height * STRETCH);
    slot.dirty = true;
    this.versionMap.set(chunk, (this.versionMap.get(chunk) ?? 0) + 1);
  }
}
