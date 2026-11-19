import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataTexture, Mesh, Scene, Texture, type InstancedBufferGeometry } from 'three/webgpu';
import { decodePng } from '../../../scripts/png';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { FIGURE_ORDER, HULL_ORDER, SEE_DEPTH_ORDER, SEE_ORDER, figureMaterials, seeMaterials } from './nodes';
import { FigureLayer, figureLooks, modelBuffers, stageSkin } from './layer';
import { STAGES } from './bones';
import { ROW, ROW_TEXELS, type FigureInst } from './instances';
import { createKit, directRunner, type FigureKit } from './kit';
import { BONES, type FigureModel } from './model';
import { restPose } from './pose3d';
import type { SpritePixels } from './weapons';
import type { FigureFrame } from '../view';

const PACK = join(__dirname, '../../../assets-src/0x72');
const sheet = decodePng(readFileSync(join(PACK, '0x72_DungeonTilesetII_v1.7.png')));
const rects = new Map<string, [number, number, number, number]>();
for (const line of readFileSync(join(PACK, 'tile_list_v1.7'), 'utf8').split(/\r?\n/)) {
  const [name, x, y, w, h] = line.trim().split(/\s+/);
  if (name && h !== undefined) rects.set(name, [+x, +y, +w, +h]);
}
const sprite = (name: string): SpritePixels | null => {
  const r = rects.get(name);
  if (!r) return null;
  const [x, y, w, h] = r;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) data.set(sheet.data.subarray(((y + row) * sheet.w + x) * 4, ((y + row) * sheet.w + x + w) * 4), row * w * 4);
  return { w, h, data };
};

/** The layer the see-through meshes go on in these tests (the view passes its AIR_SKIP_LAYER). */
const SEE_LAYER = 1;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const SLOW = 120000;

let kit: FigureKit;
beforeAll(async () => {
  kit = createKit(sprite, directRunner);
  const keys = ['elf', 'skelet', 'weapon_bow', 'stag', 'ghost', 'shade'];
  for (const k of keys) kit.get(k);
  while (keys.some((k) => !kit.get(k))) await settle();
}, SLOW);
afterAll(() => kit.dispose());

const inst = (model: string, o: Partial<FigureInst> = {}): FigureInst => {
  const m = kit.get(model)!;
  return {
    owner: 1, model, x: 0, z: 0, lift: 0, scale: m.scale, pose: restPose(m, 0), bone: -1, boneScale: 1,
    tint: [1, 1, 1], stone: false, alpha: 1, dark: false, cut: false, groundY: 0, sight: { hard: 0, soft: 0 }, ...o,
  };
};
const frame = (insts: FigureInst[]): FigureFrame => ({ insts, kit });

/** `hasSun`: the materials carry a sun material; `sunScene`: the layer is given a scene for it. */
function layerOf(hasSun: boolean, withSunScene = hasSun): { layer: FigureLayer; scene: Scene; sunScene: Scene | null; idScene: Scene; made: number; models: FigureModel[] } {
  const scene = new Scene(), sunScene = withSunScene ? new Scene() : null, idScene = new Scene();
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: hasSun });
  const sight = makeSight();
  const looks = figureLooks();
  const out = { layer: null as unknown as FigureLayer, scene, sunScene, idScene, made: 0, models: [] as FigureModel[] };
  out.layer = new FigureLayer(scene, sunScene, idScene, (rows, paint, model) => {
    out.made++;
    out.models.push(model);
    return figureMaterials({ lighting, sight, hasSun, rows, paint, stone: looks.stone, sky: looks.sky, shared: out.layer.shared, idTex: new Texture(), eyes: model.spectre?.seeThrough ? null : model.spectre?.eyes });
  }, {
    make: (rows, model) => seeMaterials({ sight, rows, shared: out.layer.shared, stands: model.stands!, peak: model.spectre!.seeThrough!.peak, eyes: model.spectre!.eyes }),
    layer: SEE_LAYER,
  });
  return out;
}
describe('stageSkin', () => {
  const check = (key: string, allStage?: number): void => {
    const m = kit.get(key)!;
    const before = m.skin.slice();
    const out = stageSkin(m);
    expect(Array.from(m.skin)).toEqual(Array.from(before));
    expect(out).not.toBe(m.skin);
    for (const r of m.ranges) {
      for (let i = r.start; i < r.start + r.count; i++) {
        expect(out[m.index[i] * 4 + 1]).toBe(allStage ?? r.stage);
      }
    }
    for (let v = 0; v < m.skin.length / 4; v++) for (const c of [0, 2, 3]) expect(out[v * 4 + c]).toBe(m.skin[v * 4 + c]);
  };
  it('puts the range\'s stage in the second float of every vertex of an elf', () => check('elf'), SLOW);
  it('puts the weapon stage in every vertex of a bow', () => check('weapon_bow', STAGES.indexOf('weapon')), SLOW);
  it('does the same for a tube model (the stag)', () => check('stag'), SLOW);
});

const meshes = (s: Scene): Mesh[] => s.children.filter((c): c is Mesh => (c as Mesh).isMesh);
const slot = (): number => -1;

describe('FigureLayer', () => {
  it('draws one elf with an id draw, a piece draw and a hull draw, each on the model\'s own index list', () => {
    const { layer, scene, idScene } = layerOf(false);
    const elf = kit.get('elf')!;
    layer.frame(frame([inst('elf')]), slot);
    expect(layer.drawn).toEqual({ figures: 1, draws: 3 });
    const picture = meshes(scene).filter((m) => m.visible), ids = meshes(idScene).filter((m) => m.visible);
    expect(picture).toHaveLength(2);
    expect(ids).toHaveLength(1);
    expect(picture.map((m) => m.renderOrder).sort((a, b) => a - b)).toEqual([FIGURE_ORDER, HULL_ORDER]);
    const b = modelBuffers(elf);
    const indexOf = (m: Mesh): ArrayLike<number> => (m.geometry.index as { array: ArrayLike<number> }).array;
    const byOrder = (o: number): Mesh => picture.find((m) => m.renderOrder === o)!;
    expect(indexOf(byOrder(FIGURE_ORDER))).toEqual(b.pieceIndex.array);
    expect(indexOf(byOrder(HULL_ORDER))).toEqual(b.lineIndex.array);
    expect(indexOf(ids[0])).toEqual(b.pieceIndex.array);
    for (const m of [...picture, ...ids]) {
      expect(m.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    }
    layer.dispose();
  }, SLOW);

  it('12 elves on one spot: still 3 draws, 12 instances in each, 12 different owner numbers', () => {
    const { layer, scene, idScene } = layerOf(false);
    layer.frame(frame(Array.from({ length: 12 }, (_, i) => inst('elf', { owner: i + 1 }))), slot);
    expect(layer.drawn).toEqual({ figures: 12, draws: 3 });
    for (const m of [...meshes(scene), ...meshes(idScene)].filter((x) => x.visible)) expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(12);
    const rows = layer.rowsData();
    const owners = new Set<number>();
    for (let r = 0; r < 12; r++) owners.add(rows[(r * ROW_TEXELS + ROW.flags) * 4 + 2]);
    expect(owners.size).toBe(12);
    layer.dispose();
  }, SLOW);

  it('an elf and its bow: 6 draws, every hull after every piece', () => {
    const { layer, scene } = layerOf(false);
    const elf = kit.get('elf')!;
    const hand = BONES.indexOf('handR');
    layer.frame(frame([inst('elf', { owner: 1 }), inst('weapon_bow', { owner: 1, bone: hand, boneScale: 0.6, pose: restPose(elf, 0), scale: elf.scale })]), slot);
    expect(layer.drawn).toEqual({ figures: 2, draws: 6 });
    const all = meshes(scene).filter((m) => m.visible);
    expect(all).toHaveLength(4);
    const hulls = all.filter((m) => m.renderOrder === HULL_ORDER), pieces = all.filter((m) => m.renderOrder === FIGURE_ORDER);
    expect(hulls).toHaveLength(2);
    expect(pieces).toHaveLength(2);
    for (const h of hulls) for (const p of pieces) expect(h.renderOrder).toBeGreaterThan(p.renderOrder);
    layer.dispose();
  }, SLOW);

  it('writes each instance\'s row: the rows texture holds the packed instance and the caster slot', () => {
    const { layer } = layerOf(false);
    layer.frame(frame([inst('elf', { x: 3, z: 5, alpha: 0.5, sight: { hard: 0.25, soft: 0.5 } })]), () => 7);
    // The layer's texture is the first argument `make` got; read it through the materials' rows via the layer.
    const rows = layer.rowsData();
    const o = (ROW.seen) * 4;
    expect(Array.from(rows.subarray(o, o + 4))).toEqual([0.5, 0.25, 0.5, 7]);
    expect(rows[ROW.root * 4 + 3]).toBeCloseTo(3, 5);   // the place in the root's shift
    expect(rows[ROW.root * 4 + 11]).toBeCloseTo(5, 5);
    layer.dispose();
  }, SLOW);

  it('gives every owner of the frame a number in its rows: an owner\'s weapon and dash copy share it', () => {
    const { layer } = layerOf(false);
    const elf = kit.get('elf')!, hand = BONES.indexOf('handR');
    layer.frame(frame([
      inst('elf', { owner: 7 }),
      inst('weapon_bow', { owner: 7, bone: hand, boneScale: 0.6, pose: restPose(elf, 0), scale: elf.scale }),
      inst('elf', { owner: 9, x: 20 }),
      inst('elf', { owner: 7, x: 5 }),   // a dash copy of 7
    ]), slot);
    const rows = layer.rowsData();
    // The rows are written group by group: tell them apart by the place in the root's shift (x of each instance).
    const at = (r: number, c: number): number => rows[r * ROW_TEXELS * 4 + c];
    const byX = (x: number): number[] => [0, 1, 2, 3].filter((r) => Math.abs(at(r, ROW.root * 4 + 3) - x) < 0.01);
    const no = (r: number): number => at(r, ROW.flags * 4 + 2);
    expect(byX(0)).toHaveLength(2);   // the elf and its bow (the bow takes the wielder's root)
    expect(byX(5)).toHaveLength(1);
    expect(byX(20)).toHaveLength(1);
    expect(no(byX(0)[0])).toBe(no(byX(0)[1]));
    expect(no(byX(5)[0])).toBe(no(byX(0)[0]));   // the dash copy holds its owner's number
    expect(no(byX(20)[0])).not.toBe(no(byX(0)[0]));
    layer.dispose();
  }, SLOW);

  it('removes all of its meshes from the scenes on dispose', () => {
    const { layer, scene, sunScene, idScene } = layerOf(true);
    layer.frame(frame([inst('elf'), inst('skelet', { owner: 2, x: 9 })]), slot);
    expect(meshes(scene).length).toBeGreaterThan(0);
    expect(meshes(sunScene!).length).toBeGreaterThan(0);
    expect(meshes(idScene).length).toBeGreaterThan(0);
    layer.dispose();
    expect(meshes(scene)).toHaveLength(0);
    expect(meshes(sunScene!)).toHaveLength(0);
    expect(meshes(idScene)).toHaveLength(0);
  }, SLOW);

  it('makes no sun mesh without a sun scene', () => {
    // Materials with a sun material, but no sun scene to put it in: the other scene gets its draws and nothing else is made.
    const { layer, scene, sunScene } = layerOf(true, false);
    expect(sunScene).toBeNull();
    layer.frame(frame([inst('elf')]), slot);
    expect(meshes(scene)).toHaveLength(2);
    layer.dispose();
  }, SLOW);

  it('makes a sun mesh per draw group (depth only, the pieces as one list) in the sun scene', () => {
    const { layer, scene, sunScene } = layerOf(true);
    layer.frame(frame([inst('elf')]), slot);
    expect(meshes(sunScene!)).toHaveLength(1);
    expect(meshes(scene).every((m) => !sunScene!.children.includes(m))).toBe(true);
    layer.dispose();
  }, SLOW);

  it('hides the draws of a model nobody shows this frame, and shows them again', () => {
    const { layer, scene, idScene } = layerOf(false);
    layer.frame(frame([inst('elf'), inst('skelet', { owner: 2, x: 9 })]), slot);
    expect(layer.drawn).toEqual({ figures: 2, draws: 6 });
    layer.frame(frame([inst('elf')]), slot);
    expect(layer.drawn).toEqual({ figures: 1, draws: 3 });
    expect(meshes(scene).filter((m) => m.visible).length + meshes(idScene).filter((m) => m.visible).length).toBe(layer.drawn.draws);
    layer.frame(undefined, slot);
    expect(layer.drawn).toEqual({ figures: 0, draws: 0 });
    expect(meshes(scene).filter((m) => m.visible)).toHaveLength(0);
    expect(meshes(idScene).filter((m) => m.visible)).toHaveLength(0);
    layer.dispose();
  }, SLOW);

  it('an empty frame after an empty frame creates nothing; an empty frame after a drawn one hides the meshes', () => {
    const { layer, scene, made } = layerOf(false);
    layer.frame(frame([]), slot);
    layer.frame(undefined, slot);
    expect(meshes(scene)).toHaveLength(0);
    expect(made).toBe(0);
    expect(layer.drawn).toEqual({ figures: 0, draws: 0 });
    layer.frame(frame([inst('elf')]), slot);
    expect(meshes(scene).filter((m) => m.visible).length).toBeGreaterThan(0);
    layer.frame(frame([]), slot);
    expect(meshes(scene).filter((m) => m.visible)).toHaveLength(0);
    expect(layer.drawn).toEqual({ figures: 0, draws: 0 });
    layer.frame(frame([]), slot);
    expect(meshes(scene).filter((m) => m.visible)).toHaveLength(0);
    layer.dispose();
  }, SLOW);

  it('skips an instance whose model has not arrived, and draws it when it has', async () => {
    const { layer, idScene } = layerOf(false);
    const late = createKit(sprite, directRunner);
    const f: FigureFrame = { insts: [inst('elf')], kit: late };
    layer.frame(f, slot);
    expect(layer.drawn.figures).toBe(0);
    expect(meshes(idScene).filter((m) => m.visible)).toHaveLength(0);
    await settle(); await settle();
    layer.frame(f, slot);
    expect(layer.drawn.figures).toBe(1);
    late.dispose();
    layer.dispose();
  }, SLOW);

  it('grows the rows texture when there are more figures than rows: nothing is dropped', () => {
    const { layer, scene } = layerOf(false);
    const before = layer.rowCapacity;
    const n = before + 5;
    const insts = Array.from({ length: n }, (_, i) => inst('skelet', { owner: i + 1, x: i * 3 }));
    layer.frame(frame(insts), slot);
    expect(layer.rowCapacity).toBeGreaterThanOrEqual(n);
    expect(layer.rowCapacity).toBeGreaterThan(before);
    expect(layer.drawn.figures).toBe(n);
    let max = 0;
    for (const m of meshes(scene).filter((x) => x.visible)) max = Math.max(max, (m.geometry as InstancedBufferGeometry).instanceCount);
    expect(max).toBeGreaterThan(0);
    // Every instance's place made it into the texture.
    const rows = layer.rowsData();
    const places = new Set<number>();
    for (let r = 0; r < n; r++) places.add(Math.round(rows[(r * ROW_TEXELS + ROW.root) * 4 + 3]));
    expect(places.size).toBe(n);
    layer.dispose();
  }, SLOW);

  it('a second layer made from the same kit draws at once, without a new build (after a lost device the view is rebuilt)', () => {
    const first = layerOf(true);
    first.layer.frame(frame([inst('elf')]), slot);
    first.layer.dispose();
    const version = kit.version;
    const second = layerOf(true);
    second.layer.frame(frame([inst('elf')]), slot);
    expect(second.layer.drawn.figures).toBe(1);
    expect(second.layer.drawn.draws).toBeGreaterThan(0);
    expect(kit.version).toBe(version);
    expect(meshes(second.scene).filter((m) => m.visible).length + meshes(second.idScene).filter((m) => m.visible).length).toBe(second.layer.drawn.draws);
    second.layer.dispose();
  }, SLOW);

  describe('the see-through Ghost (#359)', () => {
    const only = (s: Scene): Mesh[] => meshes(s).filter((m) => m.visible);

    it('one Ghost: an id-free, hull-free pair of draws (depth, then colour), on the piece list and the see layer only', () => {
      const { layer, scene, sunScene, idScene } = layerOf(true);
      layer.frame(frame([inst('ghost')]), slot);
      expect(layer.drawn).toEqual({ figures: 1, draws: 2 });
      expect(only(idScene)).toHaveLength(0);
      expect(only(sunScene!)).toHaveLength(0);
      const seen = only(scene);
      expect(seen).toHaveLength(2);
      expect(seen.map((m) => m.renderOrder).sort((a, b) => a - b)).toEqual([SEE_DEPTH_ORDER, SEE_ORDER]);
      const b = modelBuffers(kit.get('ghost')!);
      for (const m of seen) {
        expect((m.geometry.index as { array: ArrayLike<number> }).array).toEqual(b.pieceIndex.array);
        expect(m.layers.mask).toBe(1 << SEE_LAYER);
        expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(1);
      }
      layer.dispose();
    }, SLOW);

    it('the Ghost\'s two draws are in the transparent list (3.1 then 3.2, after the opaque scene); an ordinary figure\'s piece is opaque', () => {
      const { layer, scene } = layerOf(false);
      layer.frame(frame([inst('ghost'), inst('elf', { owner: 2, x: 5 })]), slot);
      const visible = only(scene);
      const mat = (m: Mesh): { transparent: boolean } => m.material as { transparent: boolean };
      const see = visible.filter((m) => m.renderOrder === SEE_DEPTH_ORDER || m.renderOrder === SEE_ORDER);
      expect(see).toHaveLength(2);
      for (const m of see) expect(mat(m).transparent).toBe(true);
      for (const m of visible.filter((x) => x.renderOrder === FIGURE_ORDER || x.renderOrder === HULL_ORDER)) expect(mat(m).transparent).toBe(false);
      expect(visible.filter((m) => m.renderOrder === FIGURE_ORDER)).toHaveLength(1);
      layer.dispose();
    }, SLOW);

    it('a stone Ghost is an ordinary figure: an id and a piece draw, no see draw', () => {
      const { layer, scene, idScene } = layerOf(false);
      layer.frame(frame([inst('ghost', { stone: true })]), slot);
      expect(layer.drawn).toEqual({ figures: 1, draws: 2 });
      expect(only(idScene)).toHaveLength(1);
      const picture = only(scene);
      expect(picture).toHaveLength(1);
      expect(picture[0].renderOrder).toBe(FIGURE_ORDER);
      expect(picture[0].layers.mask).toBe(1);
      layer.dispose();
    }, SLOW);

    it('a stone Ghost and a Ghost in one frame: both entries, one instance each', () => {
      const { layer, scene, idScene } = layerOf(false);
      layer.frame(frame([inst('ghost', { owner: 1, stone: true }), inst('ghost', { owner: 2, x: 4 })]), slot);
      expect(layer.drawn).toEqual({ figures: 2, draws: 4 });
      for (const m of [...only(scene), ...only(idScene)]) expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(1);
      expect(only(scene)).toHaveLength(3);
      // The rows: the stone one is first (its group came first), the see one second, each with its own place.
      const rows = layer.rowsData();
      const xs = [0, 1].map((r) => rows[(r * ROW_TEXELS + ROW.root) * 4 + 3]).sort((a, b) => a - b);
      expect(xs).toEqual([0, 4]);
      layer.dispose();
    }, SLOW);

    it('a frame without figures after one with a Ghost hides both see meshes and counts no instances', () => {
      const { layer, scene } = layerOf(false);
      layer.frame(frame([inst('ghost')]), slot);
      layer.frame(frame([]), slot);
      expect(only(scene)).toHaveLength(0);
      for (const m of meshes(scene)) expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(0);
      expect(layer.drawn).toEqual({ figures: 0, draws: 0 });
      layer.frame(frame([inst('ghost')]), slot);
      expect(only(scene)).toHaveLength(2);
      layer.dispose();
    }, SLOW);

    it('twelve Ghosts: still two draws', () => {
      const { layer, scene } = layerOf(false);
      layer.frame(frame(Array.from({ length: 12 }, (_, i) => inst('ghost', { owner: i + 1, x: i * 2 }))), slot);
      expect(layer.drawn).toEqual({ figures: 12, draws: 2 });
      for (const m of only(scene)) expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(12);
      layer.dispose();
    }, SLOW);

    it('the Shade: an id and a piece draw, no hull, and no sun mesh though the layer has a sun scene', () => {
      const { layer, scene, sunScene, idScene } = layerOf(true);
      layer.frame(frame([inst('shade')]), slot);
      expect(layer.drawn).toEqual({ figures: 1, draws: 2 });
      expect(only(idScene)).toHaveLength(1);
      expect(only(scene).map((m) => m.renderOrder)).toEqual([FIGURE_ORDER]);
      expect(meshes(sunScene!)).toHaveLength(0);
      layer.dispose();
    }, SLOW);

    it('a smoke body\'s piece mesh is on the see layer only, its id mesh is as before; a model without smoke stays on the default layer (R4)', () => {
      expect(kit.get('shade')!.spectre?.smoke).toBeTruthy();
      expect(kit.get('elf')!.spectre?.smoke).toBeUndefined();
      const { layer, scene, idScene } = layerOf(true);
      layer.frame(frame([inst('shade'), inst('elf', { owner: 2, x: 5 })]), slot);
      const piece = only(scene).filter((m) => m.renderOrder === FIGURE_ORDER);
      expect(piece).toHaveLength(2);
      const masks = piece.map((m) => m.layers.mask).sort((a, b) => a - b);
      expect(masks).toEqual([1, 1 << SEE_LAYER]);   // the elf: the default layer 0; the Shade: the see layer only
      for (const m of only(idScene)) expect(m.layers.mask).toBe(1);
      // the elf's hull stays on the default layer (the Shade has none: the test above)
      for (const m of only(scene).filter((x) => x.renderOrder === HULL_ORDER)) expect(m.layers.mask).toBe(1);
      layer.dispose();
    }, SLOW);

    it('dispose takes the see meshes out of the scene and frees both see materials', () => {
      const { layer, scene } = layerOf(false);
      layer.frame(frame([inst('ghost')]), slot);
      const freed: string[] = [];
      for (const m of meshes(scene)) {
        const mat = m.material as { addEventListener(t: 'dispose', f: () => void): void };
        mat.addEventListener('dispose', () => freed.push(m.renderOrder === SEE_DEPTH_ORDER ? 'depth' : 'colour'));
      }
      expect(meshes(scene)).toHaveLength(2);
      layer.dispose();
      expect(meshes(scene)).toHaveLength(0);
      expect(freed.sort()).toEqual(['colour', 'depth']);
    }, SLOW);
  });

  it('every geometry stays within 8 vertex buffers and the materials are made once per model', () => {
    const l = layerOf(true);
    l.layer.frame(frame([inst('elf'), inst('elf', { owner: 2, x: 0.1 }), inst('skelet', { owner: 3, x: 9 })]), slot);
    for (const s of [l.scene, l.sunScene!, l.idScene]) for (const m of meshes(s)) expect(Object.keys(m.geometry.attributes).length).toBeLessThanOrEqual(8);
    expect(l.made).toBe(2);
    // The factory is given the model it builds for.
    expect(new Set(l.models)).toEqual(new Set([kit.get('elf')!, kit.get('skelet')!]));
    l.layer.dispose();
  }, SLOW);
});
