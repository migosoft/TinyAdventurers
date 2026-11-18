import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataTexture, Mesh, Scene, Texture, type InstancedBufferGeometry } from 'three/webgpu';
import { decodePng } from '../../../scripts/png';
import type { Cam } from '../camera';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { FIGURE_ORDER, figureMaterials } from './nodes';
import { FigureLayer, figureLooks, stageSkin } from './layer';
import { STAGES } from './bones';
import { ROW, ROW_TEXELS, type FigureInst } from './instances';
import { createKit, directRunner, type FigureKit } from './kit';
import { BONES } from './model';
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

const cam: Cam = { x: 0, z: 0, yaw: 0, pitch: 0.9 };
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const SLOW = 120000;

let kit: FigureKit;
beforeAll(async () => {
  kit = createKit(sprite, directRunner);
  const keys = ['elf', 'skelet', 'weapon_bow', 'stag'];
  for (const k of keys) kit.get(k);
  while (keys.some((k) => !kit.get(k))) await settle();
}, SLOW);
afterAll(() => kit.dispose());

const inst = (model: string, o: Partial<FigureInst> = {}): FigureInst => {
  const m = kit.get(model)!;
  return {
    owner: 1, model, x: 0, z: 0, lift: 0, scale: m.scale, pose: restPose(m, 0), bone: -1, boneScale: 1,
    tint: [1, 1, 1], stone: false, alpha: 1, dark: false, cut: false, sight: { hard: 0, soft: 0 }, radius: m.radius, ...o,
  };
};
const frame = (insts: FigureInst[]): FigureFrame => ({ insts, kit });

/** `hasSun`: the materials carry a sun material; `sunScene`: the layer is given a scene for it. */
function layerOf(hasSun: boolean, withSunScene = hasSun): { layer: FigureLayer; scene: Scene; sunScene: Scene | null; made: number } {
  const scene = new Scene(), sunScene = withSunScene ? new Scene() : null;
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: hasSun });
  const sight = makeSight();
  const looks = figureLooks();
  const out = { layer: null as unknown as FigureLayer, scene, sunScene, made: 0 };
  out.layer = new FigureLayer(scene, sunScene, (rows, paint) => {
    out.made++;
    return figureMaterials({ lighting, sight, hasSun, rows, paint, stone: looks.stone, sky: looks.sky, shared: out.layer.shared });
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
  it('draws one elf in one batch: a hull draw and a piece draw per stage it uses, and the seal', () => {
    const { layer, scene } = layerOf(false);
    const elf = kit.get('elf')!;
    const stages = new Set(elf.ranges.map((r) => r.stage));
    layer.frame(frame([inst('elf')]), cam, slot);
    expect(layer.drawn.figures).toBe(1);
    expect(layer.drawn.batches).toBe(1);
    expect(elf.ranges.length).toBe(2 * stages.size);   // every stage has a hull and a piece
    expect(layer.drawn.draws).toBe(2 * stages.size + 1);
    const visible = meshes(scene).filter((m) => m.visible);
    expect(visible.length).toBe(2 * stages.size + 1);
    layer.dispose();
  }, SLOW);

  it('draws the hull of a stage before its pieces, the stages in order, and the seal last of the batch', () => {
    const { layer, scene } = layerOf(false);
    layer.frame(frame([inst('elf')]), cam, slot);
    const orders = meshes(scene).map((m) => m.renderOrder).sort((a, b) => a - b);
    expect(orders[0]).toBeGreaterThanOrEqual(FIGURE_ORDER);
    expect(orders[orders.length - 1]).toBe(FIGURE_ORDER + 63 / 64);
    expect(new Set(orders).size).toBe(orders.length);   // one model: no two draws share an order
    const elf = kit.get('elf')!;
    const byRange = meshes(scene).filter((m) => m.renderOrder < FIGURE_ORDER + 63 / 64);
    expect(byRange.length).toBe(elf.ranges.length);
    for (const r of elf.ranges) expect(orders).toContain(FIGURE_ORDER + (2 * r.stage + (r.line ? 0 : 1)) / 64);
    layer.dispose();
  }, SLOW);

  it('gives two elves that overlap two batches, one order step apart', () => {
    const { layer, scene } = layerOf(false);
    layer.frame(frame([inst('elf', { owner: 1, x: 0, z: 0 }), inst('elf', { owner: 2, x: 0.2, z: 0 })]), cam, slot);
    expect(layer.drawn.figures).toBe(2);
    expect(layer.drawn.batches).toBe(2);
    const floor = new Set(meshes(scene).filter((m) => m.visible).map((m) => Math.floor(m.renderOrder)));
    expect([...floor].sort()).toEqual([FIGURE_ORDER, FIGURE_ORDER + 1]);
    layer.dispose();
  }, SLOW);

  it('gives two elves far apart one batch with two instances in each draw', () => {
    const { layer, scene } = layerOf(false);
    layer.frame(frame([inst('elf', { owner: 1, x: 0, z: 0 }), inst('elf', { owner: 2, x: 20, z: 0 })]), cam, slot);
    expect(layer.drawn.batches).toBe(1);
    expect(layer.drawn.figures).toBe(2);
    for (const m of meshes(scene).filter((x) => x.visible)) expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(2);
    layer.dispose();
  }, SLOW);

  it('puts an elf and its bow in one batch, the bow\'s ranges after the elf\'s arms', () => {
    const { layer, scene } = layerOf(false);
    const elf = kit.get('elf')!, bow = kit.get('weapon_bow')!;
    const hand = BONES.indexOf('handR');
    layer.frame(frame([inst('elf', { owner: 1 }), inst('weapon_bow', { owner: 1, bone: hand, boneScale: 0.6, pose: restPose(elf, 0), scale: elf.scale })]), cam, slot);
    expect(layer.drawn.batches).toBe(1);
    expect(layer.drawn.figures).toBe(2);
    expect(layer.drawn.draws).toBe(elf.ranges.length + 1 + bow.ranges.length + 1);
    const arms = Math.max(...elf.ranges.map((r) => 2 * r.stage + (r.line ? 0 : 1)));
    const weaponOrders = bow.ranges.map((r) => FIGURE_ORDER + (2 * r.stage + (r.line ? 0 : 1)) / 64);
    for (const o of weaponOrders) expect(o).toBeGreaterThan(FIGURE_ORDER + arms / 64 - 1e-9);
    const all = meshes(scene).filter((m) => m.visible);
    expect(all.length).toBe(layer.drawn.draws);
    layer.dispose();
  }, SLOW);

  it('writes each instance\'s row: the rows texture holds the packed instance and the caster slot', () => {
    const { layer } = layerOf(false);
    layer.frame(frame([inst('elf', { x: 3, z: 5, alpha: 0.5, sight: { hard: 0.25, soft: 0.5 } })]), cam, () => 7);
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
    ]), cam, slot);
    const rows = layer.rowsData();
    const owners = new Map<string, number>();
    // The rows are written group by group; read each row's owner number and which instance it is by the place.
    const no = (r: number): number => rows[r * ROW_TEXELS * 4 + ROW.flags * 4 + 2];
    const seen = new Set<number>();
    for (let r = 0; r < 4; r++) seen.add(no(r));
    expect(seen.size).toBe(2);
    const counts = new Map<number, number>();
    for (let r = 0; r < 4; r++) counts.set(no(r), (counts.get(no(r)) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 3]);
    void owners;
    layer.dispose();
  }, SLOW);

  it('removes all of its meshes from the scenes on dispose', () => {
    const { layer, scene, sunScene } = layerOf(true);
    layer.frame(frame([inst('elf'), inst('skelet', { owner: 2, x: 9 })]), cam, slot);
    expect(meshes(scene).length).toBeGreaterThan(0);
    expect(meshes(sunScene!).length).toBeGreaterThan(0);
    layer.dispose();
    expect(meshes(scene)).toHaveLength(0);
    expect(meshes(sunScene!)).toHaveLength(0);
  }, SLOW);

  it('makes no sun mesh without a sun scene', () => {
    // Materials with a sun material, but no sun scene to put it in: the other scene gets its draws and nothing else is made.
    const { layer, scene, sunScene } = layerOf(true, false);
    expect(sunScene).toBeNull();
    layer.frame(frame([inst('elf')]), cam, slot);
    const elf = kit.get('elf')!;
    expect(meshes(scene).length).toBe(elf.ranges.length + 1);
    layer.dispose();
  }, SLOW);

  it('makes a sun mesh per draw group (depth only, the pieces as one list) in the sun scene', () => {
    const { layer, scene, sunScene } = layerOf(true);
    layer.frame(frame([inst('elf')]), cam, slot);
    expect(meshes(sunScene!)).toHaveLength(1);
    expect(meshes(scene).every((m) => !sunScene!.children.includes(m))).toBe(true);
    layer.dispose();
  }, SLOW);

  it('hides the draws of a model nobody shows this frame, and shows them again', () => {
    const { layer, scene } = layerOf(false);
    layer.frame(frame([inst('elf'), inst('skelet', { owner: 2, x: 9 })]), cam, slot);
    const both = layer.drawn.draws;
    layer.frame(frame([inst('elf')]), cam, slot);
    expect(layer.drawn.draws).toBeLessThan(both);
    expect(meshes(scene).filter((m) => m.visible).length).toBe(layer.drawn.draws);
    layer.frame(undefined, cam, slot);
    expect(layer.drawn).toEqual({ figures: 0, batches: 0, draws: 0 });
    expect(meshes(scene).filter((m) => m.visible)).toHaveLength(0);
    layer.dispose();
  }, SLOW);

  it('an empty frame after an empty frame creates nothing; an empty frame after a drawn one hides the meshes', () => {
    const { layer, scene, made } = layerOf(false);
    layer.frame(frame([]), cam, slot);
    layer.frame(undefined, cam, slot);
    expect(meshes(scene)).toHaveLength(0);
    expect(made).toBe(0);
    expect(layer.drawn).toEqual({ figures: 0, batches: 0, draws: 0 });
    layer.frame(frame([inst('elf')]), cam, slot);
    expect(meshes(scene).filter((m) => m.visible).length).toBeGreaterThan(0);
    layer.frame(frame([]), cam, slot);
    expect(meshes(scene).filter((m) => m.visible)).toHaveLength(0);
    expect(layer.drawn).toEqual({ figures: 0, batches: 0, draws: 0 });
    layer.frame(frame([]), cam, slot);
    expect(meshes(scene).filter((m) => m.visible)).toHaveLength(0);
    layer.dispose();
  }, SLOW);

  it('skips an instance whose model has not arrived, and draws it when it has', async () => {
    const { layer } = layerOf(false);
    const late = createKit(sprite, directRunner);
    const f: FigureFrame = { insts: [inst('elf')], kit: late };
    layer.frame(f, cam, slot);
    expect(layer.drawn.figures).toBe(0);
    await settle(); await settle();
    layer.frame(f, cam, slot);
    expect(layer.drawn.figures).toBe(1);
    late.dispose();
    layer.dispose();
  }, SLOW);

  it('grows the rows texture when there are more figures than rows: nothing is dropped', () => {
    const { layer, scene } = layerOf(false);
    const before = layer.rowCapacity;
    const n = before + 5;
    const insts = Array.from({ length: n }, (_, i) => inst('skelet', { owner: i + 1, x: i * 3 }));
    layer.frame(frame(insts), cam, slot);
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
    first.layer.frame(frame([inst('elf')]), cam, slot);
    first.layer.dispose();
    const version = kit.version;
    const second = layerOf(true);
    second.layer.frame(frame([inst('elf')]), cam, slot);
    expect(second.layer.drawn.figures).toBe(1);
    expect(second.layer.drawn.draws).toBeGreaterThan(0);
    expect(kit.version).toBe(version);
    expect(meshes(second.scene).filter((m) => m.visible).length).toBe(second.layer.drawn.draws);
    second.layer.dispose();
  }, SLOW);

  it('every geometry stays within 8 vertex buffers and the materials are made once per model', () => {
    const l = layerOf(true);
    l.layer.frame(frame([inst('elf'), inst('elf', { owner: 2, x: 0.1 }), inst('skelet', { owner: 3, x: 9 })]), cam, slot);
    for (const s of [l.scene, l.sunScene!]) for (const m of meshes(s)) expect(Object.keys(m.geometry.attributes).length).toBeLessThanOrEqual(8);
    expect(l.made).toBe(2);
    l.layer.dispose();
  }, SLOW);
});
