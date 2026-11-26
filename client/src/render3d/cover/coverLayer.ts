// The ground-cover layer in the view (#330): per non-empty map chunk one mesh of stacked sheets and one of bushel cards, culled by the chunk's
// bounds, plus the cover image as a texture the shaders read. A `CoverLayer` belongs to one view: a rebuilt view makes a new one and the
// caller sets the kept result again.
import { Box3, BufferAttribute, BufferGeometry, DataTexture, Mesh, NearestFilter, NoColorSpace, RGBAFormat, Sphere, UnsignedByteType, Vector3 } from 'three/webgpu';
import type { Material, Scene, Texture } from 'three/webgpu';
import { GH_MAX } from './kinds';
import { GroundTooLargeError } from '../groundError';
import { CHUNK } from '../worldMesh';
import type { CoverResult } from './coverJob';
import { buildCoverChunk, type CoverChunk } from './coverMesh';
import type { CoverShared } from './coverRead';

export interface CoverFrame { on: boolean; gh: number; wind: boolean; t: number }

/** Draw orders: after the world, before the trees' depth pass (0.25). */
export const COVER_ORDER = { sheet: 0.1, bushel: 0.15 } as const;

function boxed(g: BufferGeometry, c: CoverChunk): BufferGeometry {
  // The raw positions lack the sway, the stretch and the card's push: the chunk's own bounds hold them.
  g.boundingBox = new Box3(new Vector3(...c.min), new Vector3(...c.max));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

export class CoverLayer {
  private readonly meshes: Mesh[] = [];
  private tex: DataTexture | null = null;
  /** True only while a good image with cover is bound; the layer stays off (the ground bare) otherwise. */
  private ready = false;
  /** The result and floor the meshes were built from. */
  private kept: { r: CoverResult; floorY?: (x: number, z: number) => number } | null = null;
  /** The texture the shared uniforms started with, bound again when `set` fails. */
  private readonly standIn: Texture;

  /** The layer owns the two materials and disposes them. */
  constructor(private readonly scene: Scene, private readonly shared: CoverShared, private readonly materials: { sheet: Material; bushel: Material }) {
    this.standIn = shared.texture.value as Texture;
  }

  get meshCount(): number { return this.meshes.length; }

  /** Builds every chunk's meshes and uploads the image; throws GroundTooLargeError above `limit` (the layer is then empty). */
  set(r: CoverResult, limit: number, floorY?: (x: number, z: number) => number): void {
    this.clear();
    this.kept = { r, floorY };
    this.ready = false;
    const { w, h } = r.image;
    if (w > limit || h > limit) {
      this.shared.setTexture(this.standIn);
      this.tex?.dispose();
      this.tex = null;
      throw new GroundTooLargeError(w, h, limit);
    }
    const t = new DataTexture(r.image.data, w, h, RGBAFormat, UnsignedByteType);
    t.colorSpace = NoColorSpace;
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.needsUpdate = true;
    this.shared.setTexture(t);
    this.tex?.dispose();
    this.tex = t;
    if (r.sheets <= 0) return;
    this.ready = true;
    this.build();
  }

  /** Builds the meshes again from the kept result, for a floor that changed under the cover (new marks after a re-plan). */
  rebuild(): void {
    if (!this.ready || !this.kept) return;
    this.clear();
    this.build();
  }

  private build(): void {
    const { r, floorY } = this.kept!, { w, h } = r.image;
    const nx = Math.ceil(Math.floor(w / 16) / CHUNK), nz = Math.ceil(Math.floor(h / 16) / CHUNK);
    for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
      const c = buildCoverChunk(r, cx, cz, floorY);
      if (!c) continue;
      if (c.sheet.count > 0) {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(c.sheet.position, 3));
        g.setAttribute('layer', new BufferAttribute(c.sheet.layer, 1));
        this.add(new Mesh(boxed(g, c), this.materials.sheet), COVER_ORDER.sheet);
      }
      if (c.bushel.count > 0) {
        const g = new BufferGeometry();
        // The bushel material reads `positionGeometry` as the foot.
        g.setAttribute('position', new BufferAttribute(c.bushel.foot, 3));
        g.setAttribute('corner', new BufferAttribute(c.bushel.corner, 2));
        g.setAttribute('info', new BufferAttribute(c.bushel.info, 4));
        this.add(new Mesh(boxed(g, c), this.materials.bushel), COVER_ORDER.bushel);
      }
    }
  }

  frame(f: CoverFrame, cosP: number): void {
    const s = this.shared;
    s.on.value = f.on && this.ready ? 1 : 0;
    s.gh.value = Math.min(GH_MAX, Math.max(0, f.gh)); // the chunk bounds assume at most GH_MAX
    s.windOn.value = f.wind ? 1 : 0;
    s.t.value = f.t;
    s.cosP.value = cosP;
  }

  /** Takes the meshes out. The image stays until the next `set` (the shaders still point at it); `dispose` frees it. */
  private clear(): void {
    for (const m of this.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.meshes.length = 0;
  }

  dispose(): void {
    this.clear();
    this.ready = false;
    this.shared.on.value = 0;
    this.materials.sheet.dispose();
    this.materials.bushel.dispose();
    this.tex?.dispose();
    this.tex = null;
  }

  private add(mesh: Mesh, order: number): void {
    mesh.frustumCulled = true;
    mesh.renderOrder = order;
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }
}
