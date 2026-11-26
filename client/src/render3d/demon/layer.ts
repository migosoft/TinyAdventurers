// The demon's meshes in the view (#379): per owner the body in the scene, the body a second time in the id scene (the same geometry)
// and the outline hull, each with the owner's own materials, drawn from the instance's own buffers.
// The builder writes the uvs, colours, looks and indices once and only the positions and normals each frame (shape.ts), so a frame
// uploads only those.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, type Scene } from 'three/webgpu';
import type { BuiltBuf, BuiltInst } from '../built';
import { geometryOf, type BuiltLayer } from '../lich/layer';
import { OWNER_MAX, packLook } from '../models/instances';
import { FIGURE_ORDER, HULL_ORDER } from '../models/nodes';
import type { demonMaterials } from './nodes';

/** The frames an owner may be missing before its meshes and materials are freed. */
const GONE_FRAMES = 300;
/** The streams a frame rewrites. */
const MOVING = ['position', 'normal'] as const;

type Mats = ReturnType<typeof demonMaterials>;
interface Res {
  mats: Mats; no: number;
  bodyBuf: BuiltBuf; geom: BufferGeometry; body: Mesh; id: Mesh;
  hullBuf: BuiltBuf | null; hullGeom: BufferGeometry | null; hull: Mesh | null;
  /** Frames since the owner was last in a frame. */
  gone: number;
}

/** The hull's geometry: its buffer holds only positions, looks and indices. */
function hullGeometry(b: BuiltBuf): BufferGeometry {
  const g = new BufferGeometry(), position = new BufferAttribute(b.position, 3);
  position.setUsage(DynamicDrawUsage);
  g.setAttribute('position', position);
  g.setAttribute('look', new BufferAttribute(b.look, 2));
  g.setIndex(new BufferAttribute(b.index, 1));
  return g;
}

/** Marks the used part of the moving streams for upload and sets the draw range. */
function refresh(g: BufferGeometry, b: BuiltBuf): void {
  for (const name of MOVING) {
    const at = g.getAttribute(name) as BufferAttribute | undefined;
    if (!at) continue;
    at.clearUpdateRanges();
    at.addUpdateRange(0, b.verts * at.itemSize);
    at.needsUpdate = true;
  }
  g.setDrawRange(0, b.indices);
}

export class DemonLayer implements BuiltLayer {
  readonly ids = true;
  drawn = 0;
  private readonly owners = new Map<number, Res>();
  private readonly seen = new Set<number>();
  private readonly scratch = new Float32Array(12);
  private made = 0;

  constructor(private readonly scene: Scene, private readonly idScene: Scene, private readonly make: () => Mats) {}

  frame(insts: readonly BuiltInst[], slotOf: (id: number) => number): void {
    const seen = this.seen;
    seen.clear();
    let drawn = 0;
    for (const i of insts) {
      if (seen.has(i.owner)) continue;
      seen.add(i.owner);
      const r = this.res(i);
      r.gone = 0;
      const u = r.mats.u, s = this.scratch;
      packLook(s, 0, i, slotOf(i.owner), r.no);
      u.root.value.set(i.x, i.lift, i.z, i.yaw);
      u.scale.value = i.scale;
      u.tint.value.set(s[0], s[1], s[2], s[3]);
      u.seen.value.set(s[4], s[5], s[6], s[7]);
      u.flags.value.set(s[8], s[9], s[10], s[11]);
      u.levels.value.set(i.levels[0], i.levels[1], i.levels[2], i.levels[3]);
      refresh(r.geom, i.body);
      r.body.visible = r.id.visible = true;
      if (r.hull) { refresh(r.hullGeom!, i.hull!); r.hull.visible = true; }
      drawn++;
    }
    for (const [owner, r] of this.owners) {
      if (seen.has(owner)) continue;
      r.body.visible = r.id.visible = false;
      if (r.hull) r.hull.visible = false;
      if (++r.gone >= GONE_FRAMES) { this.free(r); this.owners.delete(owner); }
    }
    this.drawn = drawn;
  }

  dispose(): void {
    for (const r of this.owners.values()) this.free(r);
    this.owners.clear();
    this.drawn = 0;
  }

  /** The owner's resources; a changed buffer object makes its geometry again (the materials stay). */
  private res(i: BuiltInst): Res {
    let r = this.owners.get(i.owner);
    if (!r) {
      // The owner's number in the id target: counted down from the top, so it is not one of the model figures' (they count up from 0 each frame).
      const mats = this.make(), geom = geometryOf(i.body, true), no = OWNER_MAX - 1 - (this.made++ % (OWNER_MAX / 2));
      r = { mats, no, bodyBuf: i.body, geom, body: this.mesh(geom, mats.body, this.scene, FIGURE_ORDER), id: this.mesh(geom, mats.id, this.idScene, 0), hullBuf: null, hullGeom: null, hull: null, gone: 0 };
      this.owners.set(i.owner, r);
    } else if (r.bodyBuf !== i.body) {
      r.geom.dispose();
      r.bodyBuf = i.body;
      r.geom = r.body.geometry = r.id.geometry = geometryOf(i.body, true);
    }
    const hull = i.hull ?? null;
    if (r.hullBuf !== hull) {
      if (r.hull) { this.scene.remove(r.hull); r.hullGeom!.dispose(); r.hull = null; r.hullGeom = null; }
      r.hullBuf = hull;
      if (hull) { r.hullGeom = hullGeometry(hull); r.hull = this.mesh(r.hullGeom, r.mats.hull, this.scene, HULL_ORDER); }
    }
    return r;
  }

  private mesh(g: BufferGeometry, m: Mats['body'], scene: Scene, order: number): Mesh {
    const mesh = new Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    scene.add(mesh);
    return mesh;
  }

  private free(r: Res): void {
    this.scene.remove(r.body);
    this.idScene.remove(r.id);
    if (r.hull) this.scene.remove(r.hull);
    r.geom.dispose();
    r.hullGeom?.dispose();
    r.mats.dispose();
  }
}
