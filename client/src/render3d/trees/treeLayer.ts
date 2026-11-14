// The trees in the view's scenes (#329): per changed forest chunk one geometry with three meshes (the depth pass and the colour pass in the
// scene, the caster in the sun's scene when there is a sun), culled by the chunk's bounds. Holds one palette texture and one material set.
// A `TreeLayer` belongs to one view: a rebuilt view makes a new one and re-reads every chunk of the same `Forest`.
import { Box3, BufferAttribute, BufferGeometry, DataTexture, Mesh, NearestFilter, NoColorSpace, RGBAFormat, Scene, Sphere, UnsignedByteType, Vector3 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { ChunkSync } from './chunks';
import type { TreeChunk, TreeFrame } from './forest';
import { paletteBytes } from './palette';
import { TREE_ORDER, makeTreeShared, packTreeStreams, type TreeMaterials, type TreeShared } from './treeNodes';

/** The palette's size in texels: tones across, ramps down. */
const PALETTE_W = 5, PALETTE_H = 4;

/** The least time between two uploads of one chunk while the forest is still growing (ms, first guess). */
export const TREE_UPLOAD_MS = 250;

/** One chunk's geometry: the mesh streams, the per-plant `plant` and `look` streams (copied at their used length; `packTreeStreams` fits them to the 8 vertex buffers WebGPU allows) and the forest's bounds for culling. */
export function chunkGeometry(c: TreeChunk): BufferGeometry {
  const m = c.mesh;
  const g = new BufferGeometry();
  const set = (name: string, data: ArrayLike<number>, size: number): void => { g.setAttribute(name, new BufferAttribute(Float32Array.from(data), size)); };
  set('position', m.position, 3);
  const packed = packTreeStreams(m.normal, m.sway, c.plant);
  g.setAttribute('nrm', new BufferAttribute(packed.nrm, 4));
  set('grad', m.grad, 4);
  set('part', m.part, 4);
  set('misc', m.misc, 4);
  set('tuft', m.tuft, 4);
  g.setAttribute('plant', new BufferAttribute(packed.plant, 4));
  g.setAttribute('look', new BufferAttribute(c.look.slice(), 4));
  g.setIndex(new BufferAttribute(Uint32Array.from(m.index), 1));
  // The raw positions lack the patches' spread, the sway and the stretched height: the forest's bounds hold them.
  const b = c.bounds;
  g.boundingBox = new Box3(new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.max.x, b.max.y, b.max.z));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

export class TreeLayer {
  /** The uniforms the materials share; the view sets `cosP` each frame. */
  readonly shared: TreeShared = makeTreeShared();
  private mats: TreeMaterials | null = null;
  private palette: DataTexture | null = null;
  private paletteId = -1;
  private readonly meshes = new Map<number, { mesh: Mesh; scene: Scene }[]>();
  private sync_ = new ChunkSync();
  private versionsOf: ReadonlyMap<number, number> | null = null;
  /** Chunks that changed and wait for their upload, and when each chunk was last uploaded. */
  private readonly dirty = new Set<number>();
  private readonly uploadedAt = new Map<number, number>();

  /** `sunScene`: the sun's pass, or null without a sun. `make` builds the three materials once, from the palette texture and the shared uniforms. `now`: the clock in ms. */
  constructor(
    private readonly scene: Scene, private readonly sunScene: Scene | null,
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
      // The chunk's `plant` and `look` are views the forest re-assigns on every added tree: read them now, from the chunk, never cache them.
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
      this.meshes.set(k, list);
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
    if (this.mats) for (const m of [this.mats.depth, this.mats.colour, this.mats.sun]) m?.dispose();
    this.mats = null;
    this.palette?.dispose();
    this.palette = null;
  }

  private drop(k: number): void {
    const list = this.meshes.get(k);
    if (!list) return;
    for (const { mesh, scene } of list) scene.remove(mesh);
    list[0].mesh.geometry.dispose();
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
