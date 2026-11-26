// The meshes of the built figures in the view (#358): per owner a body mesh and a claw mesh with their own materials, drawn from the
// instance's own buffers, which the figure pass refills every frame (only the used ranges are uploaded and drawn).
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, type Scene } from 'three/webgpu';
import type { BuiltBuf, BuiltInst } from '../built';
import { packLook } from '../models/instances';
import { FIGURE_ORDER } from '../models/nodes';
import { CLAW_ORDER, type LichMaterials } from './nodes';

/** The frames an owner may be missing before its meshes and materials are freed. */
const GONE_FRAMES = 300;

export interface BuiltLayer {
  frame(insts: readonly BuiltInst[], slotOf: (id: number) => number): void;
  /** How many owners the last frame drew. */
  readonly drawn: number;
  /** True: the layer draws into the id scene, so the id pass must run. */
  readonly ids?: boolean;
  dispose(): void;
}

interface Res {
  mats: LichMaterials;
  bodyBuf: BuiltBuf; bodyGeom: BufferGeometry; body: Mesh;
  glowBuf: BuiltBuf | null; clawGeom: BufferGeometry | null; claws: Mesh | null;
  /** Frames since the owner was last in a frame. */
  gone: number;
}

const dyn = (a: Float32Array | Uint32Array, n: number): BufferAttribute => { const at = new BufferAttribute(a, n); at.setUsage(DynamicDrawUsage); return at; };

/** A geometry whose attributes wrap the buffer's own arrays; `lit` adds the normals, uvs and look the body reads. */
export function geometryOf(b: BuiltBuf, lit: boolean): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', dyn(b.position, 3));
  g.setAttribute('colour', dyn(b.colour, 3));
  if (lit) {
    g.setAttribute('normal', dyn(b.normal, 3));
    g.setAttribute('uv', dyn(b.uv, 2));
    g.setAttribute('look', dyn(b.look, 2));
  }
  const index = new BufferAttribute(b.index, 1);
  index.setUsage(DynamicDrawUsage);
  g.setIndex(index);
  return g;
}

/** Marks the used part of the buffer's attributes for upload and sets the draw range. */
export function upload(g: BufferGeometry, b: BuiltBuf): void {
  for (const at of Object.values(g.attributes) as BufferAttribute[]) {
    at.clearUpdateRanges();
    at.addUpdateRange(0, b.verts * at.itemSize);
    at.needsUpdate = true;
  }
  const index = g.index!;
  index.clearUpdateRanges();
  index.addUpdateRange(0, b.indices);
  index.needsUpdate = true;
  g.setDrawRange(0, b.indices);
}

export class LichLayer implements BuiltLayer {
  drawn = 0;
  private readonly owners = new Map<number, Res>();
  private readonly seen = new Set<number>();
  private readonly scratch = new Float32Array(12);

  constructor(private readonly scene: Scene, private readonly make: () => LichMaterials, private readonly clawLayer: number) {}

  frame(insts: readonly BuiltInst[], slotOf: (id: number) => number): void {
    const seen = this.seen;
    seen.clear();
    let drawn = 0;
    for (const i of insts) {
      if (seen.has(i.owner)) continue;
      seen.add(i.owner);
      const r = this.res(i);
      r.gone = 0;
      const u = r.mats.u;
      packLook(this.scratch, 0, i, slotOf(i.owner), 0);
      const s = this.scratch;
      u.root.value.set(i.x, i.lift, i.z, i.yaw);
      u.scale.value = i.scale;
      u.tint.value.set(s[0], s[1], s[2], s[3]);
      u.seen.value.set(s[4], s[5], s[6], s[7]);
      u.flags.value.set(s[8], s[9], s[10], s[11]);
      u.levels.value.set(i.levels[0], i.levels[1], i.levels[2], i.levels[3]);
      upload(r.bodyGeom, i.body);
      r.body.visible = true;
      // A stone lich draws no claws.
      if (r.claws) {
        const claws = !i.stone;
        if (claws) upload(r.clawGeom!, i.glow!);
        r.claws.visible = claws;
      }
      drawn++;
    }
    for (const [owner, r] of this.owners) {
      if (seen.has(owner)) continue;
      r.body.visible = false;
      if (r.claws) r.claws.visible = false;
      if (++r.gone >= GONE_FRAMES) { this.free(r); this.owners.delete(owner); }
    }
    this.drawn = drawn;
  }

  dispose(): void {
    for (const r of this.owners.values()) this.free(r);
    this.owners.clear();
    this.drawn = 0;
  }

  /** The owner's resources; a changed buffer object makes its geometry again (the materials stay). A figure without claws has no claw mesh. */
  private res(i: BuiltInst): Res {
    let r = this.owners.get(i.owner);
    if (!r) {
      const mats = this.make();
      r = { mats, bodyBuf: i.body, bodyGeom: geometryOf(i.body, true), body: null as unknown as Mesh, glowBuf: null, clawGeom: null, claws: null, gone: 0 };
      r.body = new Mesh(r.bodyGeom, mats.body);
      r.body.frustumCulled = false;
      r.body.renderOrder = FIGURE_ORDER;
      this.scene.add(r.body);
      this.owners.set(i.owner, r);
    } else if (r.bodyBuf !== i.body) {
      r.bodyGeom.dispose();
      r.bodyBuf = i.body;
      r.bodyGeom = r.body.geometry = geometryOf(i.body, true);
    }
    if (r.glowBuf !== i.glow) {
      if (r.claws) { this.scene.remove(r.claws); r.clawGeom!.dispose(); r.claws = null; r.clawGeom = null; }
      r.glowBuf = i.glow;
      if (i.glow) {
        r.clawGeom = geometryOf(i.glow, false);
        r.claws = new Mesh(r.clawGeom, r.mats.claws);
        r.claws.frustumCulled = false;
        r.claws.renderOrder = CLAW_ORDER;
        r.claws.layers.set(this.clawLayer);
        this.scene.add(r.claws);
      }
    }
    return r;
  }

  private free(r: Res): void {
    this.scene.remove(r.body);
    if (r.claws) this.scene.remove(r.claws);
    r.bodyGeom.dispose();
    r.clawGeom?.dispose();
    r.mats.dispose();
  }
}
