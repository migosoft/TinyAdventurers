import { describe, expect, it } from 'vitest';
import { type BufferAttribute, DataTexture, Mesh, RGBAFormat, Scene, Texture, UnsignedByteType } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { FIGURE_ORDER, HULL_ORDER, makeFigureShared } from '../models/nodes';
import { newBuiltBuf, type BuiltInst } from '../built';
import { demonMaterials } from './nodes';
import { DemonLayer } from './layer';

type Mats = ReturnType<typeof demonMaterials>;
const shared = makeFigureShared();
const paint = new DataTexture(new Uint8Array(16), 2, 2, RGBAFormat, UnsignedByteType);
const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
const make = (): Mats => demonMaterials({ lighting, sight: makeSight(), shared, paint, idTex: new Texture() });

const inst = (owner: number, o: Partial<BuiltInst> = {}): BuiltInst => {
  const body = newBuiltBuf(8, 12), hull = newBuiltBuf(6, 9);
  body.verts = 5; body.indices = 9; hull.verts = 4; hull.indices = 6;
  return {
    owner, key: 'demon', x: 1 + owner, z: 2, lift: 0.25, yaw: 0.5, scale: 0.07, body, glow: null, hull, levels: [0.1, 0.2, 0.3, 0],
    tint: [1, 0.5, 0.25], stone: false, alpha: 0.8, dark: false, cut: false, groundY: 0, sight: { hard: 0.1, soft: 0.2 }, reach: 0, ...o,
  };
};
const meshes = (s: Scene): Mesh[] => s.children.filter((c): c is Mesh => (c as Mesh).isMesh);
const slotOf = (id: number): number => id + 10;

describe('DemonLayer', () => {
  it('draws into the id scene', () => {
    expect(new DemonLayer(new Scene(), new Scene(), make).ids).toBe(true);
  });

  it('one owner gives a body mesh and a hull mesh in the scene and the body a second time in the id scene', () => {
    const scene = new Scene(), idScene = new Scene(), layer = new DemonLayer(scene, idScene, make);
    const a = inst(1);
    layer.frame([a], slotOf);
    const ms = meshes(scene), ids = meshes(idScene);
    expect(ms.length).toBe(2);
    expect(ids.length).toBe(1);
    const body = ms.find((m) => m.renderOrder === FIGURE_ORDER)!, hull = ms.find((m) => m.renderOrder === HULL_ORDER)!;
    expect(ids[0].geometry).toBe(body.geometry);
    expect(ids[0].material).not.toBe(body.material);
    expect(body.geometry.drawRange.count).toBe(a.body.indices);
    expect(hull.geometry.drawRange.count).toBe(a.hull!.indices);
    expect(hull.geometry.getAttribute('position').array).toBe(a.hull!.position);
    expect(hull.geometry.getAttribute('look').array).toBe(a.hull!.look);
    for (const m of [...ms, ...ids]) { expect(m.frustumCulled).toBe(false); expect(m.visible).toBe(true); }
    expect(layer.drawn).toBe(1);
    layer.dispose();
  });

  it('two owners have separate geometries, materials and owner numbers; a frame without one hides its three meshes', () => {
    const mats: Mats[] = [];
    const scene = new Scene(), idScene = new Scene(), layer = new DemonLayer(scene, idScene, () => { const m = make(); mats.push(m); return m; });
    const a = inst(1), b = inst(2);
    layer.frame([a, b], slotOf);
    const all = [...meshes(scene), ...meshes(idScene)];
    expect(all.length).toBe(6);
    expect(new Set(all.map((m) => m.material)).size).toBe(6);
    expect(new Set(all.map((m) => m.geometry)).size).toBe(4);
    expect(mats[0].u.flags.value.z).not.toBe(mats[1].u.flags.value.z);
    expect(layer.drawn).toBe(2);
    layer.frame([a], slotOf);
    expect(all.filter((m) => m.visible).length).toBe(3);
    expect(layer.drawn).toBe(1);
    layer.dispose();
  });

  it('the uniforms hold the instance\'s place, yaw, scale, levels and look', () => {
    const mats: Mats[] = [];
    const layer = new DemonLayer(new Scene(), new Scene(), () => { const m = make(); mats.push(m); return m; });
    layer.frame([inst(3, { stone: true, dark: true, cut: true, groundY: -2 })], slotOf);
    const u = mats[0].u;
    expect(u.root.value.toArray()).toEqual([4, 0.25, 2, 0.5].map(Math.fround));
    expect(u.scale.value).toBeCloseTo(0.07, 6);
    expect(u.levels.value.toArray()).toEqual([0.1, 0.2, 0.3, 0]);
    expect(u.tint.value.toArray()).toEqual([1, 0.5, 0.25, 1]);
    expect(u.seen.value.toArray()).toEqual([0.8, 0.1, 0.2, 13].map(Math.fround));
    expect([u.flags.value.x, u.flags.value.y, u.flags.value.w]).toEqual([1, 1, -2]);
    layer.dispose();
  });

  it('a frame marks only the moving streams for upload', () => {
    const scene = new Scene(), layer = new DemonLayer(scene, new Scene(), make);
    const a = inst(1);
    layer.frame([a], slotOf);
    const g = meshes(scene).find((m) => m.renderOrder === FIGURE_ORDER)!.geometry;
    const v = (n: string): number => (g.getAttribute(n) as BufferAttribute).version;
    const before = { position: v('position'), normal: v('normal'), uv: v('uv'), colour: v('colour'), look: v('look'), index: g.index!.version };
    layer.frame([a], slotOf);
    expect(v('position')).toBeGreaterThan(before.position);
    expect(v('normal')).toBeGreaterThan(before.normal);
    expect([v('uv'), v('colour'), v('look'), g.index!.version]).toEqual([before.uv, before.colour, before.look, before.index]);
    layer.dispose();
  });

  it('a new buffer makes the geometry again; an owner gone for 300 frames is freed; dispose frees all', () => {
    const scene = new Scene(), idScene = new Scene(), layer = new DemonLayer(scene, idScene, make);
    const a = inst(1);
    layer.frame([a], slotOf);
    const g0 = meshes(idScene)[0].geometry;
    layer.frame([{ ...a, body: { ...a.body, indices: 6 } }], slotOf);
    expect(meshes(idScene)[0].geometry).not.toBe(g0);
    expect(meshes(idScene)[0].geometry.drawRange.count).toBe(6);
    for (let i = 0; i < 299; i++) layer.frame([], slotOf);
    expect(meshes(scene).length).toBe(2);
    layer.frame([], slotOf);
    expect(meshes(scene).length + meshes(idScene).length).toBe(0);
    layer.frame([inst(1), inst(2)], slotOf);
    layer.dispose();
    expect(meshes(scene).length + meshes(idScene).length).toBe(0);
    expect(layer.drawn).toBe(0);
  });
});
