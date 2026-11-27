import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataTexture, type Mesh, Scene, Texture } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { FIGURE_ORDER, makeFigureShared } from '../models/nodes';
import { newBuiltBuf, type BuiltInst } from '../built';
import { BONES, buildDemonSkin } from './body';
import { demonMaterials, type DemonMats } from './nodes';
import { DemonLayer, SKIN_PARTS } from './layer';
import { setDemonSkin } from './skinFile';

const shared = makeFigureShared();
const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
const make = (kind: 'fire' | 'ice'): DemonMats => demonMaterials({ lighting, sight: makeSight(), shared, kind });

beforeAll(() => { setDemonSkin(buildDemonSkin(0.1)); });
afterAll(() => { setDemonSkin(null); });

const inst = (owner: number, o: Partial<BuiltInst> = {}): BuiltInst => {
  const bones = new Float32Array(BONES * 16);
  for (let b = 0; b < BONES; b++) for (let k = 0; k < 4; k++) bones[b * 16 + k * 5] = 1;   // identity
  return {
    owner, key: 'demon', x: 1 + owner, z: 2, lift: 0.25, yaw: 0.5, scale: 0.07, body: newBuiltBuf(0, 0), glow: null, bones, levels: [0.1, 0.2, 0.3, 0],
    tint: [1, 0.5, 0.25], stone: false, alpha: 0.8, dark: false, cut: false, groundY: 0, sight: { hard: 0.1, soft: 0.2 }, reach: 0, ...o,
  };
};
const meshes = (s: Scene): Mesh[] => s.children.filter((c): c is Mesh => (c as Mesh).isMesh);
const slotOf = (id: number): number => id + 10;

describe('DemonLayer', () => {
  it('draws no id pass and no hull: seven meshes an owner, all with its one material', () => {
    const scene = new Scene(), layer = new DemonLayer(scene, make);
    expect((layer as { ids?: boolean }).ids).toBeUndefined();
    layer.frame([inst(1)], slotOf);
    const ms = meshes(scene);
    expect(ms.length).toBe(SKIN_PARTS.length);
    expect(new Set(ms.map((m) => m.material)).size).toBe(1);
    expect(new Set(ms.map((m) => m.geometry)).size).toBe(7);
    for (const m of ms) { expect(m.frustumCulled).toBe(false); expect(m.visible).toBe(true); expect(m.renderOrder).toBe(FIGURE_ORDER); }
    expect(layer.drawn).toBe(1);
    layer.dispose();
  });

  it('two owners share the geometry and have their own bone uniforms', () => {
    const mats: DemonMats[] = [];
    const scene = new Scene(), layer = new DemonLayer(scene, (k) => { const m = make(k); mats.push(m); return m; });
    const fire = inst(1), ice = inst(2, { key: 'iceDemon' });
    ice.bones![12] = 5;
    layer.frame([fire, ice], slotOf);
    const ms = meshes(scene);
    expect(ms.length).toBe(14);
    const body = ms.filter((m) => m.geometry === ms[0].geometry);
    expect(body.length).toBe(2);
    expect(body[0].material).not.toBe(body[1].material);
    expect(mats.map((m) => m.kind)).toEqual(['fire', 'ice']);
    expect(mats[0].bones).not.toBe(mats[1].bones);
    expect(mats[0].bones.array).not.toBe(mats[1].bones.array);
    // writing owner B's bones leaves A's untouched
    const a = (mats[0].bones.array as { elements: number[] }[]).map((m) => m.elements[12]), b = (mats[1].bones.array as { elements: number[] }[]).map((m) => m.elements[12]);
    expect(a[0]).toBe(0);
    expect(b[0]).toBe(5);
    layer.frame([fire, { ...ice, bones: new Float32Array(BONES * 16) }], slotOf);
    expect((mats[0].bones.array as { elements: number[] }[])[0].elements[0]).toBe(1);
    expect((mats[1].bones.array as { elements: number[] }[])[0].elements[0]).toBe(0);
    layer.dispose();
  });

  it('the uniforms hold the instance\'s place, yaw, scale, levels and look', () => {
    const mats: DemonMats[] = [];
    const layer = new DemonLayer(new Scene(), (k) => { const m = make(k); mats.push(m); return m; });
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

  it('an owner gone for 300 frames frees its meshes and materials, not the shared geometry', () => {
    const scene = new Scene(), layer = new DemonLayer(scene, make);
    layer.frame([inst(1)], slotOf);
    const geoms = meshes(scene).map((m) => m.geometry);
    let freed = 0;
    for (const g of geoms) g.addEventListener('dispose', () => freed++);
    layer.frame([], slotOf);
    expect(meshes(scene).every((m) => !m.visible)).toBe(true);
    for (let i = 0; i < 298; i++) layer.frame([], slotOf);
    expect(meshes(scene).length).toBe(7);
    layer.frame([], slotOf);
    expect(meshes(scene).length).toBe(0);
    expect(freed).toBe(0);
    layer.frame([inst(1)], slotOf);
    expect(meshes(scene).map((m) => m.geometry)).toEqual(geoms);   // the same geometry again
    layer.dispose();
    expect(freed).toBe(7);
    expect(layer.drawn).toBe(0);
  });

  it('draws nothing and throws nothing without bones, or while the skin is not loaded', () => {
    const scene = new Scene(), layer = new DemonLayer(scene, make);
    const bare = inst(1);
    delete bare.bones;
    expect(() => layer.frame([bare], slotOf)).not.toThrow();
    expect(meshes(scene).length).toBe(0);
    expect(layer.drawn).toBe(0);
    layer.frame([inst(1)], slotOf);
    layer.frame([bare], slotOf);
    expect(meshes(scene).every((m) => !m.visible)).toBe(true);
    expect(layer.drawn).toBe(0);
    layer.dispose();
  });

  it('while the skin file fails to load it draws nothing, throws nothing and warns once', async () => {
    setDemonSkin(null);
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const scene = new Scene(), layer = new DemonLayer(scene, make);
      for (let i = 0; i < 3; i++) { expect(() => layer.frame([inst(1)], slotOf)).not.toThrow(); await new Promise((r) => setTimeout(r, 0)); }
      expect(meshes(scene).length).toBe(0);
      expect(layer.drawn).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
      setDemonSkin(buildDemonSkin(0.1));
    }
  });
});
