// The trees in the view's scenes (#329): per changed forest chunk one geometry with three meshes (the depth pass and the colour pass in the
// scene, the caster in the sun's scene when there is a sun), culled by the chunk's bounds. Holds one palette texture and one material set.
// A `TreeLayer` belongs to one view: a rebuilt view makes a new one and re-reads every chunk of the same `Forest`.
import { Box3, BufferAttribute, type Camera, BufferGeometry, DataTexture, Mesh, NearestFilter, NoColorSpace, RGBAFormat, Scene, Sphere, UnsignedByteType, Vector3 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { ChunkSync } from './chunks';
import type { TreeChunk, TreeFrame } from './forest';
import { LEAF_DRIFT, LEAF_FLUTTER, LEAF_HALF, type LeafBuf } from './leaves';
import { paletteBytes } from './palette';
import { TREE_ORDER, makeTreeShared, type TreeMaterials, type TreeShared } from './treeNodes';

/** The palette's size in texels: tones across, ramps down. */
const PALETTE_W = 5, PALETTE_H = 4;

/** The least time between two uploads of one chunk while the forest is still growing (ms, first guess). */
export const TREE_UPLOAD_MS = 250;

/**
 * One chunk's geometry: the chunk's streams (already in the GPU's layout, `ChunkMesh`) and the forest's bounds for culling. The attributes are
 * views of the forest's streams at their used length, not copies: the forest only appends past them, and stays the source when a new layer
 * (after a lost device) re-reads the chunk.
 */
export function chunkGeometry(c: TreeChunk): BufferGeometry {
  const m = c.mesh;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setAttribute('nrm', new BufferAttribute(m.nrm, 4));
  g.setAttribute('grad', new BufferAttribute(m.grad, 4));
  g.setAttribute('part', new BufferAttribute(m.part, 4));
  g.setAttribute('misc', new BufferAttribute(m.misc, 4));
  g.setAttribute('tuft', new BufferAttribute(m.tuft, 4));
  g.setAttribute('plant', new BufferAttribute(m.plant, 4));
  g.setAttribute('look', new BufferAttribute(m.look, 4));
  g.setIndex(new BufferAttribute(m.index, 1));
  // The raw positions lack the patches' spread, the sway and the stretched height: the forest's bounds hold them.
  const b = c.bounds;
  g.boundingBox = new Box3(new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.max.x, b.max.y, b.max.z));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

/** The corners of a leaf's quad, in half-widths. */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
/** How far a leaf can end up from its lobe in x and z (the wind's drift at its largest, the flutter and the quad), tiles. */
const LEAF_REACH = LEAF_DRIFT * 1.4 + LEAF_FLUTTER + 2 * LEAF_HALF;

/**
 * One chunk's falling leaves as a geometry: a quad per leaf with five attributes (`position` the corner, `start`, `params`, `plant`, `look`: far
 * under the 8 vertex buffers WebGPU allows). `bounds` (the chunk's) are widened by the leaves' reach and run down to the ground, for culling.
 */
export function leafGeometry(l: LeafBuf, bounds?: TreeChunk['bounds']): BufferGeometry {
  const n = l.n, g = new BufferGeometry();
  const position = new Float32Array(n * 12), start = new Float32Array(n * 16), params = new Float32Array(n * 16), plant = new Float32Array(n * 16), look = new Float32Array(n * 16);
  const index = new Uint32Array(n * 6);
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      position[v * 3] = CORNERS[c][0]; position[v * 3 + 1] = CORNERS[c][1];
      start.set([l.start[i * 3], l.start[i * 3 + 1], l.start[i * 3 + 2], l.sway[i]], v * 4);
      for (let k = 0; k < 4; k++) { params[v * 4 + k] = l.params[i * 4 + k]; look[v * 4 + k] = l.look[i * 4 + k]; }
      plant.set([l.foot[i * 2], l.foot[i * 2 + 1], l.leaf[i], 0], v * 4);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    x0 = Math.min(x0, l.start[i * 3]); x1 = Math.max(x1, l.start[i * 3]); y1 = Math.max(y1, l.start[i * 3 + 1]);
    z0 = Math.min(z0, l.start[i * 3 + 2]); z1 = Math.max(z1, l.start[i * 3 + 2]);
  }
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('start', new BufferAttribute(start, 4));
  g.setAttribute('params', new BufferAttribute(params, 4));
  g.setAttribute('plant', new BufferAttribute(plant, 4));
  g.setAttribute('look', new BufferAttribute(look, 4));
  g.setIndex(new BufferAttribute(index, 1));
  // A leaf starts at y > 0 and a lifted leaf stays below its start's lifted height; the tree's own bounds cover that.
  const b = bounds ?? { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
  g.boundingBox = new Box3(new Vector3(Math.min(b.min.x, x0) - LEAF_REACH, 0, Math.min(b.min.z, z0) - LEAF_REACH), new Vector3(Math.max(b.max.x, x1) + LEAF_REACH, Math.max(b.max.y, y1) + LEAF_HALF, Math.max(b.max.z, z1) + LEAF_REACH));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

export class TreeLayer {
  /** The uniforms the materials share; the view sets `cosP` each frame. */
  readonly shared: TreeShared = makeTreeShared();
  private mats: TreeMaterials | null = null;
  private palette: DataTexture | null = null;
  private paletteId = -1;
  private warmed = false;
  private readonly meshes = new Map<number, { mesh: Mesh; scene: Scene }[]>();
  private sync_ = new ChunkSync();
  private versionsOf: ReadonlyMap<number, number> | null = null;
  /** Chunks that changed and wait for their upload, and when each chunk was last uploaded. */
  private readonly dirty = new Set<number>();
  private readonly uploadedAt = new Map<number, number>();

  /** `sunScene`: the sun's pass, or null without a sun. `castScene`: the plant shadow tiles' pass (#333), or null without a cove. `make` builds the three materials once, from the palette texture and the shared uniforms. `now`: the clock in ms. */
  constructor(
    private readonly scene: Scene, private readonly sunScene: Scene | null, private readonly castScene: Scene | null,
    private readonly make: (palette: Texture, shared: TreeShared) => TreeMaterials,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Meshes held, in both scenes. */
  get meshCount(): number {
    let n = 0;
    for (const l of this.meshes.values()) n += l.length;
    return n;
  }

  get paletteTexture(): DataTexture | null { return this.palette; }

  /** Takes the frame's changed chunks (all of them for a new layer) and sets the shared uniforms. */
  sync(f: TreeFrame): void {
    // Another forest has other chunks: start over (a forest keeps its own maps for its life).
    if (this.versionsOf !== f.versions) {
      if (this.versionsOf) this.clear();
      this.versionsOf = f.versions;
    }
    const mats = this.materials(f.palette);
    this.shared.t.value = f.t;
    this.shared.windOn.value = f.wind ? 1 : 0;
    this.shared.leafOverride.value = f.leafOverride;
    this.shared.plain.value = f.plain ? 1 : 0;
    this.shared.leafRate.value = f.leafRate;
    for (const k of this.sync_.changed(f.versions)) this.dirty.add(k);
    const now = this.now();
    for (const k of this.dirty) {
      // A chunk never shown is built at once; a shown one that is still growing waits out the window, unless the forest is complete.
      const last = this.uploadedAt.get(k);
      if (last !== undefined && !f.complete && now - last < TREE_UPLOAD_MS) continue;
      this.dirty.delete(k);
      this.drop(k);
      const c = f.chunks.get(k);
      if (!c || c.mesh.verts === 0) continue;
      this.uploadedAt.set(k, now);
      // The chunk's stream views end at its length now: take them from the chunk at every upload, never cache them.
      const g = chunkGeometry(c);
      const list: { mesh: Mesh; scene: Scene }[] = [];
      const add = (material: Mesh['material'], into: Scene, order: number): void => {
        const mesh = new Mesh(g, material);
        mesh.frustumCulled = true;
        mesh.renderOrder = order;
        into.add(mesh);
        list.push({ mesh, scene: into });
      };
      add(mats.depth, this.scene, TREE_ORDER.depth);
      add(mats.colour, this.scene, TREE_ORDER.colour);
      if (this.sunScene && mats.sun) add(mats.sun, this.sunScene, 0);
      if (this.castScene && mats.cast) add(mats.cast, this.castScene, 0);
      // The falling leaves are their own geometry and one more draw, in the scene only (a leaf casts no shadow).
      if (c.leaves.n > 0) {
        const mesh = new Mesh(leafGeometry(c.leaves, c.bounds), mats.leaf);
        mesh.frustumCulled = true;
        mesh.renderOrder = TREE_ORDER.leaf;
        this.scene.add(mesh);
        list.push({ mesh, scene: this.scene });
      }
      this.meshes.set(k, list);
    }
  }

  /**
   * Compiles the falling leaves' program once, before the first trees come, so it does not add to the frame they appear in: a leaf that is gone
   * is compiled alone, against the scene's lights (`targetScene`). The renderer keeps the program. Needs the materials (made by the first `sync`).
   * Only that mesh (#366): compiling the whole scene built the visible meshes' programs a second time, asynchronously, racing the frames'
   * own builds; the copy that finished last replaced the cached one, so the next mesh of that material to come into view compiled a new pipeline (a 50-70 ms frame).
   */
  async warm(renderer: { compileAsync(scene: Mesh, camera: Camera, targetScene: Scene): Promise<unknown> }, camera: Camera): Promise<void> {
    if (!this.mats || this.warmed) return;
    this.warmed = true;
    const one: LeafBuf = { start: [0, 0, 0], params: [100, 0, 2, 0], sway: [0], foot: [0, 0], leaf: [0], look: [1, 0, 1, 0], n: 1 }; // threshold 2: gone
    const mesh = new Mesh(leafGeometry(one), this.mats.leaf);
    mesh.frustumCulled = false;
    try {
      await renderer.compileAsync(mesh, camera, this.scene);
    } catch {
      // The program is then compiled by the first draw, as without the warm-up.
    } finally {
      mesh.geometry.dispose();
    }
  }

  /** Takes every mesh out; the next `sync` re-reads every chunk. */
  clear(): void {
    for (const k of [...this.meshes.keys()]) this.drop(k);
    this.sync_ = new ChunkSync();
    this.dirty.clear();
    this.uploadedAt.clear();
  }

  dispose(): void {
    this.clear();
    if (this.mats) for (const m of [this.mats.depth, this.mats.colour, this.mats.sun, this.mats.cast, this.mats.leaf]) m?.dispose();
    this.mats = null;
    this.palette?.dispose();
    this.palette = null;
  }

  private drop(k: number): void {
    const list = this.meshes.get(k);
    if (!list) return;
    for (const { mesh, scene } of list) scene.remove(mesh);
    for (const g of new Set(list.map((e) => e.mesh.geometry))) g.dispose();
    this.meshes.delete(k);
  }

  /** The palette texture (rows in `RAMP` order, v = row / 4 with no flip; nearest, no mipmaps) and the materials, made at the first frame. */
  private materials(id: number): TreeMaterials {
    if (!this.palette) {
      const t = new DataTexture(paletteBytes(id), PALETTE_W, PALETTE_H, RGBAFormat, UnsignedByteType);
      t.magFilter = NearestFilter;
      t.minFilter = NearestFilter;
      t.generateMipmaps = false;
      t.flipY = false;
      t.premultiplyAlpha = false;
      t.colorSpace = NoColorSpace;
      t.needsUpdate = true;
      this.palette = t;
      this.paletteId = id;
    } else if (id !== this.paletteId) {
      (this.palette.image.data as Uint8Array).set(paletteBytes(id));
      this.palette.needsUpdate = true;
      this.paletteId = id;
    }
    return (this.mats ??= this.make(this.palette, this.shared));
  }
}
