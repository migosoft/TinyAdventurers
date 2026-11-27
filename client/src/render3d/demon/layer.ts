// The demon's meshes in the view (#379, #442): the skin is static geometry (made once per layer from the skin file, shared by every
// owner); per owner seven meshes (body, tail, tubes, web, cloth, blade, iron) with that owner's material and its own bone matrices,
// which the instance carries (`BuiltInst.bones`). No hull, no id pass. A view built after a lost device makes its own layer and geometry.
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type MeshBasicNodeMaterial, type Scene } from 'three/webgpu';
import type { BuiltInst } from '../built';
import { packLook } from '../models/instances';
import { FIGURE_ORDER } from '../models/nodes';
import type { BuiltLayer } from '../lich/layer';
import { BONES, type DemonSkin, type SkinPart } from './body';
import type { DemonMats } from './nodes';
import { demonSkin } from './skinFile';

/** The frames an owner may be missing before its meshes and materials are freed. */
const GONE_FRAMES = 300;
export const SKIN_PARTS = ['body', 'tail', 'tubes', 'web', 'cloth', 'blade', 'iron'] as const;

interface Res {
  mats: DemonMats; meshes: Mesh[]; mats4: Matrix4[];
  /** Frames since the owner was last drawn; `stamp`: the frame it last was. */
  gone: number; stamp: number;
}

/** The owner's material of a part: body, tail and tubes share the skin's. */
export const materialOf = (m: DemonMats, part: (typeof SKIN_PARTS)[number]): MeshBasicNodeMaterial =>
  (part === 'body' || part === 'tail' || part === 'tubes' ? m.skin : m[part]);

export function geometryOf(p: SkinPart): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p.position, 3));
  g.setAttribute('normal', new BufferAttribute(p.normal, 3));
  g.setAttribute('info', new BufferAttribute(p.info, 4));
  // body and tail have no uv; the skin's material reads the teeth's (in the tubes), so they get zeros
  g.setAttribute('uv', new BufferAttribute(p.uv ?? new Float32Array((p.position.length / 3) * 2), 2));
  g.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from(p.skinIndex), 4));
  g.setAttribute('skinWeight', new BufferAttribute(p.skinWeight, 4));
  g.setIndex(new BufferAttribute(p.index, 1));
  return g;
}

export class DemonLayer implements BuiltLayer {
  drawn = 0;
  private readonly owners = new Map<number, Res>();
  private readonly seen = new Set<number>();
  private readonly scratch = new Float32Array(12);
  private geoms: BufferGeometry[] | null = null;
  private frames = 0;

  constructor(private readonly scene: Scene, private readonly make: (kind: 'fire' | 'ice') => DemonMats) {}

  /** The geometry of the seven parts, shared by every owner; null until the skin file is loaded. */
  private geometries(): BufferGeometry[] | null {
    if (this.geoms) return this.geoms;
    const skin: DemonSkin | null = demonSkin();
    return skin ? (this.geoms = SKIN_PARTS.map((k) => geometryOf(skin[k]))) : null;
  }

  frame(insts: readonly BuiltInst[], slotOf: (id: number) => number): void {
    const seen = this.seen;
    seen.clear();
    let drawn = 0;
    const geoms = this.geometries(), stamp = ++this.frames;
    for (const i of insts) {
      if (seen.has(i.owner)) continue;
      seen.add(i.owner);
      if (!geoms || !i.bones) continue;
      const r = this.res(i, geoms);
      r.gone = 0; r.stamp = stamp;
      const u = r.mats.u, s = this.scratch;
      packLook(s, 0, i, slotOf(i.owner), 0);
      u.root.value.set(i.x, i.lift, i.z, i.yaw);
      u.scale.value = i.scale;
      u.tint.value.set(s[0], s[1], s[2], s[3]);
      u.seen.value.set(s[4], s[5], s[6], s[7]);
      u.flags.value.set(s[8], s[9], s[10], s[11]);
      u.levels.value.set(i.levels[0], i.levels[1], i.levels[2], i.levels[3]);
      if (i.paint) { u.pose.life.value.fromArray(i.paint, 0); u.pose.beat.value.fromArray(i.paint, 4); u.pose.gaze.value.fromArray(i.paint, 8); }
      const src = i.bones;
      for (let b = 0; b < BONES; b++) { const e = r.mats4[b].elements; for (let k = 0; k < 16; k++) e[k] = src[b * 16 + k]; }
      for (const m of r.meshes) m.visible = true;
      drawn++;
    }
    for (const [owner, r] of this.owners) {
      if (r.stamp === stamp) continue;
      for (const m of r.meshes) m.visible = false;
      if (++r.gone >= GONE_FRAMES) { this.free(r); this.owners.delete(owner); }
    }
    this.drawn = drawn;
  }

  dispose(): void {
    for (const r of this.owners.values()) this.free(r);
    this.owners.clear();
    this.geoms?.forEach((g) => g.dispose());
    this.geoms = null;
    this.drawn = 0;
  }

  private res(i: BuiltInst, geoms: BufferGeometry[]): Res {
    let r = this.owners.get(i.owner);
    if (!r) {
      const mats = this.make(i.temper === -1 ? 'ice' : 'fire');
      const meshes = geoms.map((g, k) => {
        const m = new Mesh(g, materialOf(mats, SKIN_PARTS[k]));
        m.frustumCulled = false;
        m.renderOrder = FIGURE_ORDER;
        this.scene.add(m);
        return m;
      });
      // the uniform array's own matrices: written each frame, uploaded by the node
      r = { mats, meshes, mats4: mats.bones.array as Matrix4[], gone: 0, stamp: 0 };
      this.owners.set(i.owner, r);
    }
    return r;
  }

  private free(r: Res): void {
    for (const m of r.meshes) this.scene.remove(m);
    r.mats.dispose();
  }
}
