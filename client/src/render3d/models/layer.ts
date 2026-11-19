// The 3D figures in the view's scenes (#338, #364): per model the meshes that draw all its instances: an id draw (in the id scene), a
// piece draw, a hull draw (after every piece) and the sun's pass; one rows texture the vertex shader reads, one paint texture per model.
// A `FigureLayer` belongs to one view: after a lost device the rebuilt view makes a new layer, which finds every model it needs still in
// the same kit.
import {
  BufferAttribute, ClampToEdgeWrapping, DataTexture, FloatType, InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, LinearMipmapLinearFilter,
  Mesh, NearestFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType, type Scene, type Texture,
} from 'three/webgpu';
import { growRows, OWNER_MAX, packInstance, ROW_TEXELS, type FigureInst } from './instances';
import type { FigureFrame } from '../view';
import { FIGURE_ORDER, HULL_ORDER, SEE_DEPTH_ORDER, SEE_ORDER, makeFigureShared, type FigureMaterials, type FigureShared, type SeeMaterials } from './nodes';
import type { FigureModel } from './model';
import { skyPaint, stonePaint, type PaintImage } from './paint';

/** Floats of a row. */
const ROW_FLOATS = ROW_TEXELS * 4;
/** The rows the texture starts with; it doubles when there are more figures. */
const START_ROWS = 64;
/** The paint's anisotropic filtering. */
const ANISOTROPY = 8;

/**
 * A picture as a texture whose v = 1 is the picture's top row (the convention of the models' uv): the rows go up in reverse order,
 * so the texture needs no flip on either backend. Linear, `mips` for the paint (anisotropy 8), none for the sky (which is looked up
 * with a derivative that jumps at the seam of its longitude).
 */
export function imageTexture(img: PaintImage, o: { mips: boolean; repeat?: boolean }): DataTexture {
  const data = new Uint8Array(img.data.length), stride = img.w * 4;
  for (let y = 0; y < img.h; y++) data.set(img.data.subarray(y * stride, (y + 1) * stride), (img.h - 1 - y) * stride);
  const t = new DataTexture(data, img.w, img.h, RGBAFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = o.mips ? LinearMipmapLinearFilter : LinearFilter;
  t.generateMipmaps = o.mips;
  t.anisotropy = o.mips ? ANISOTROPY : 1;
  t.wrapS = o.repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.colorSpace = NoColorSpace;   // the colours are sRGB values used as they are, as the atlas texels of the cards
  t.needsUpdate = true;
  return t;
}

/** The shared pictures of a view's figures: the stone and the sky the polished steel mirrors. Made when the first model is drawn. */
export function figureLooks(): { stone: Texture; sky: Texture; dispose(): void } {
  const stone = imageTexture(stonePaint(), { mips: true }), sky = imageTexture(skyPaint(), { mips: false, repeat: true });
  return { stone, sky, dispose: () => { stone.dispose(); sky.dispose(); } };
}

/** The vertex streams and index lists of one model as attributes; the draws of the model share them. */
export interface ModelBuffers {
  position: BufferAttribute; normal: BufferAttribute; uv: BufferAttribute; skin: BufferAttribute; look: BufferAttribute; origin: BufferAttribute;
  /** All triangles in draw order (the stages' ranges index into it), the pieces' alone and the hulls' alone. */
  index: BufferAttribute; pieceIndex: BufferAttribute; lineIndex: BufferAttribute;
}

/**
 * A copy of `m.skin` whose second float of every vertex is the stage of the range its triangles belong to (the model's own
 * `skin[1]` stays the hull flag). A vertex belongs to one range: ranges do not share vertices.
 */
export function stageSkin(m: FigureModel): Float32Array {
  const out = m.skin.slice();
  for (const r of m.ranges) {
    for (let i = r.start; i < r.start + r.count; i++) out[m.index[i] * 4 + 1] = r.stage;
  }
  return out;
}

export function modelBuffers(m: FigureModel): ModelBuffers {
  // A bending vertex carries the pivot of its bend (the rest pose's), any other vertex 0.
  const n = m.skin.length / 4, origin = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = m.skin[i * 4 + 2];
    if (k >= 0) origin.set(m.bends[k].origin, i * 3);
  }
  return {
    position: new BufferAttribute(m.position, 3), normal: new BufferAttribute(m.normal, 3), uv: new BufferAttribute(m.uv, 2),
    skin: new BufferAttribute(stageSkin(m), 4), look: new BufferAttribute(m.look, 4), origin: new BufferAttribute(origin, 3),
    index: new BufferAttribute(m.index, 1), pieceIndex: new BufferAttribute(m.pieceIndex, 1), lineIndex: new BufferAttribute(m.lineIndex, 1),
  };
}

/** A geometry of the shared streams with the given `index` and its own instanced `row` (the row of each instance). */
export function figureGeometry(b: ModelBuffers, index: BufferAttribute, row: InstancedBufferAttribute): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', b.position);
  g.setAttribute('normal', b.normal);
  g.setAttribute('uv', b.uv);
  g.setAttribute('skin', b.skin);
  g.setAttribute('look', b.look);
  g.setAttribute('origin', b.origin);
  g.setAttribute('row', row);
  g.setIndex(index);
  g.instanceCount = 0;
  return g;
}

/** Everything of one model its draws share. */
interface ModelRes { model: FigureModel; buffers: ModelBuffers; paint: DataTexture; mats: FigureMaterials; /** Made when the first see-through instance of the model comes. */ see?: SeeMaterials }

/** The draws of one model: id, piece, hull (none without hull triangles) and the sun's; or, for a see-through model's see-through instances, the depth and the colour draw. */
interface Entry {
  res: ModelRes;
  row: InstancedBufferAttribute;
  geoms: InstancedBufferGeometry[];
  meshes: { mesh: Mesh; scene: Scene }[];
  /** How many id, piece and hull draws the entry makes (the sun's is not counted). */
  draws: number;
}

const NO_INSTS: FigureInst[] = [];

export class FigureLayer {
  /** The uniforms the materials share; the view sets `cosP` and `idOn` each frame. */
  readonly shared: FigureShared = makeFigureShared();
  /** What the last `frame` drew: instances, and the id, piece and hull draws of the models shown. */
  readonly drawn = { figures: 0, draws: 0 };
  private rows: Float32Array = new Float32Array(START_ROWS * ROW_FLOATS);
  private readonly rowsTex: DataTexture;
  private readonly models = new Map<string, ModelRes>();
  private readonly entries = new Map<string, Entry>();
  /** Per-frame scratch: the maps are cleared and reused at the top of `frame`; the per-model group object and its list are made new each frame. */
  private readonly groups = new Map<string, { key: string; modelKey: string; model: FigureModel; see: boolean; list: number[] }>();
  private readonly live = new Set<Entry>();
  /** The entry key of a model's see-through instances, made once per model (no string per instance per frame). */
  private readonly seeKeys = new Map<string, string>();
  /** The frame's owner numbers: an entity id to its index in order of first appearance. */
  private readonly ownerNos = new Map<number, number>();

  /**
   * `sunScene`: the sun's pass, or null without a sun. `idScene`: the id pass (the view draws it into the id target before the picture).
   * `make` builds the materials of a model from the rows texture, the model's paint texture and the model itself (once per model; the view adds the
   * lighting, the sight, the shared pictures and the id target). `see`: the materials of a see-through model's instances (a model whose
   * `spectre.seeThrough` is set, not petrified) and the camera layer their meshes go on.
   */
  constructor(
    private readonly scene: Scene, private readonly sunScene: Scene | null, private readonly idScene: Scene,
    private readonly make: (rows: Texture, paint: Texture, model: FigureModel) => FigureMaterials,
    private readonly see: { make: (rows: Texture, model: FigureModel) => SeeMaterials; layer: number },
  ) {
    this.rowsTex = new DataTexture(this.rows, ROW_TEXELS, START_ROWS, RGBAFormat, FloatType);
    // Floats need exact texels (a bone matrix in sprite px, a root in tiles: half floats would not hold them), read by integer coordinates.
    this.rowsTex.magFilter = NearestFilter;
    this.rowsTex.minFilter = NearestFilter;
    this.rowsTex.generateMipmaps = false;
    this.rowsTex.flipY = false;
    this.rowsTex.premultiplyAlpha = false;
    this.rowsTex.colorSpace = NoColorSpace;
    this.rowsTex.needsUpdate = true;
  }

  /** How many rows the rows texture holds now. */
  get rowCapacity(): number { return this.rows.length / ROW_FLOATS; }

  /** The rows as the last frame wrote them. */
  rowsData(): Float32Array { return this.rows; }

  /**
   * Writes the frame's instances into the rows and sets which meshes draw how many of them. An instance whose model has not arrived is
   * skipped (the caller draws its card). `slotOf`: the caster slot of an entity (-1 none).
   */
  frame(f: FigureFrame | undefined, slotOf: (id: number) => number): void {
    const insts = f ? f.insts : NO_INSTS;
    // Nothing to draw and nothing drawn last frame: nothing to hide either (the common run without models).
    if (insts.length === 0 && this.drawn.draws === 0 && this.drawn.figures === 0) return;
    const groups = this.groups, live = this.live;
    const ownerNos = this.ownerNos;
    groups.clear(); live.clear(); ownerNos.clear();
    let ready = 0;
    for (let i = 0; i < insts.length; i++) {
      const m = f!.kit.get(insts[i].model);
      if (!m) continue;
      ready++;
      if (!ownerNos.has(insts[i].owner)) ownerNos.set(insts[i].owner, ownerNos.size % OWNER_MAX);
      // A see-through model's instances (not the petrified ones) are drawn by their own entry: the depth and the colour draw.
      const see = !!m.spectre?.seeThrough && !insts[i].stone;
      const key = see ? this.seeKey(insts[i].model) : insts[i].model;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { key, modelKey: insts[i].model, model: m, see, list: [] });
      g.list.push(i);
    }
    this.fit(ready);
    let row = 0;
    let draws = 0;
    for (const g of groups.values()) {
      const e = this.entry(g.key, g.modelKey, g.model, g.list.length, g.see);
      const first = row;
      for (const i of g.list) { packInstance(this.rows, row, insts[i], slotOf(insts[i].owner), ownerNos.get(insts[i].owner)!); row++; }
      const ids = e.row.array as Float32Array;
      for (let k = 0; k < g.list.length; k++) ids[k] = first + k;
      e.row.needsUpdate = true;
      for (const geom of e.geoms) geom.instanceCount = g.list.length;
      for (const m of e.meshes) m.mesh.visible = true;
      live.add(e);
      draws += e.draws;
    }
    for (const e of this.entries.values()) {
      if (live.has(e)) continue;
      for (const geom of e.geoms) geom.instanceCount = 0;
      for (const m of e.meshes) m.mesh.visible = false;
    }
    if (ready > 0) this.rowsTex.needsUpdate = true;
    this.drawn.figures = ready;
    this.drawn.draws = draws;
  }

  /** Takes every mesh out of the scenes and frees the layer's geometry, materials and textures. */
  dispose(): void {
    for (const e of this.entries.values()) {
      for (const { mesh, scene } of e.meshes) scene.remove(mesh);
      for (const g of e.geoms) g.dispose();
    }
    this.entries.clear();
    for (const r of this.models.values()) {
      for (const m of [r.mats.piece, r.mats.line, r.mats.id, r.mats.sun, r.see?.depth, r.see?.colour]) m?.dispose();
      r.paint.dispose();
    }
    this.models.clear();
    this.rowsTex.dispose();
    this.drawn.figures = this.drawn.draws = 0;
  }

  /** Room for `n` rows. The texture is the same object (the materials hold it): it takes a bigger image and is uploaded anew. */
  private fit(n: number): void {
    if (n <= this.rowCapacity) return;
    this.rows = growRows(this.rows, n * ROW_FLOATS);
    const h = this.rows.length / ROW_FLOATS;
    this.rowsTex.image = { data: this.rows as Float32Array<ArrayBuffer>, width: ROW_TEXELS, height: h };
    this.rowsTex.dispose();
    this.rowsTex.needsUpdate = true;
  }

  private model(key: string, model: FigureModel): ModelRes {
    let r = this.models.get(key);
    if (!r) {
      const paint = imageTexture(model.paint, { mips: true });
      this.models.set(key, r = { model, buffers: modelBuffers(model), paint, mats: this.make(this.rowsTex, paint, model) });
    }
    return r;
  }

  private seeKey(model: string): string {
    let k = this.seeKeys.get(model);
    if (k === undefined) this.seeKeys.set(model, k = `${model}/see`);
    return k;
  }

  /** The draws of `model` under the entry `key` (the model's key, or `<key>/see` for its see-through instances), made on first use and given room for `n` instances. */
  private entry(key: string, modelKey: string, model: FigureModel, n: number, see: boolean): Entry {
    let e = this.entries.get(key);
    if (e && n > (e.row.array as Float32Array).length) {
      // A longer row list: a new attribute (an attribute cannot grow in place) for all the entry's geometries.
      e.row = new InstancedBufferAttribute(new Float32Array(Math.max(n, (e.row.array as Float32Array).length * 2)), 1);
      for (const g of e.geoms) g.setAttribute('row', e.row);
    }
    if (e) return e;
    const res = this.model(modelKey, model), b = res.buffers;
    const row = new InstancedBufferAttribute(new Float32Array(Math.max(n, 8)), 1);
    e = { res, row, geoms: [], meshes: [], draws: 0 };
    const add = (geom: InstancedBufferGeometry, material: Mesh['material'], into: Scene, order: number, counted: boolean): void => {
      const mesh = new Mesh(geom, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      into.add(mesh);
      e!.geoms.push(geom);
      e!.meshes.push({ mesh, scene: into });
      if (counted) e!.draws++;
    };
    if (see) {
      // The depth draw, then the colour draw, on the see layer: no id, hull or sun draw.
      const mats = res.see ??= this.see.make(this.rowsTex, model);
      add(figureGeometry(b, b.pieceIndex, row), mats.depth, this.scene, SEE_DEPTH_ORDER, true);
      add(figureGeometry(b, b.pieceIndex, row), mats.colour, this.scene, SEE_ORDER, true);
      for (const { mesh } of e.meshes) mesh.layers.set(this.see.layer);
    } else {
      add(figureGeometry(b, b.pieceIndex, row), res.mats.id, this.idScene, 0, true);
      add(figureGeometry(b, b.pieceIndex, row), res.mats.piece, this.scene, FIGURE_ORDER, true);
      if (model.lineIndex.length > 0) add(figureGeometry(b, b.lineIndex, row), res.mats.line, this.scene, HULL_ORDER, true);
      // A spectre casts no sun shadow.
      if (this.sunScene && res.mats.sun && !model.spectre) add(figureGeometry(b, b.pieceIndex, row), res.mats.sun, this.sunScene, 0, false);
    }
    this.entries.set(key, e);
    return e;
  }
}
