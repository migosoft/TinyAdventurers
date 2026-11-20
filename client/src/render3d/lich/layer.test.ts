import { describe, expect, it } from 'vitest';
import { DataTexture, Mesh, RGBAFormat, Scene, Texture, UnsignedByteType } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { FIGURE_ORDER, makeFigureShared } from '../models/nodes';
import { newBuiltBuf, type BuiltInst } from '../built';
import { CLAW_ORDER, lichMaterials, type LichMaterials } from './nodes';
import { LichLayer } from './layer';

const CLAW_LAYER = 1;
const shared = makeFigureShared();
const paint = new DataTexture(new Uint8Array(16), 2, 2, RGBAFormat, UnsignedByteType);
const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
const made: LichMaterials[] = [];
const make = (): LichMaterials => { const m = lichMaterials({ lighting, sight: makeSight(), shared, paint }); made.push(m); return m; };

const inst = (owner: number, o: Partial<BuiltInst> = {}): BuiltInst => {
  const body = newBuiltBuf(8, 12), glow = newBuiltBuf(4, 6);
  body.verts = 5; body.indices = 9 + owner; glow.verts = 3; glow.indices = 3;
  return {
    owner, key: 'lich', x: 1 + owner, z: 2, lift: 0.25, yaw: 0.5, scale: 0.07, body, glow, levels: [0.1, 0.2, 0.3, 0],
    tint: [1, 0.5, 0.25], stone: false, alpha: 0.8, dark: false, cut: false, groundY: 0, sight: { hard: 0.1, soft: 0.2 }, reach: 0, ...o,
  };
};
const meshes = (s: Scene): Mesh[] => s.children.filter((c): c is Mesh => (c as Mesh).isMesh);
const slotOf = (id: number): number => id + 10;

describe('LichLayer', () => {
  it('one instance gives a body at FIGURE_ORDER and claws at CLAW_ORDER on the claw layer only', () => {
    const scene = new Scene(), layer = new LichLayer(scene, make, CLAW_LAYER);
    const a = inst(1);
    layer.frame([a], slotOf);
    const ms = meshes(scene);
    expect(ms.length).toBe(2);
    const body = ms.find((m) => m.renderOrder === FIGURE_ORDER)!, claws = ms.find((m) => m.renderOrder === CLAW_ORDER)!;
    expect(body.layers.mask).toBe(1);
    expect(claws.layers.mask).toBe(1 << CLAW_LAYER);
    expect(body.frustumCulled).toBe(false);
    expect(body.geometry.drawRange.count).toBe(a.body.indices);
    expect(claws.geometry.drawRange.count).toBe(a.glow!.indices);
    expect(body.visible && claws.visible).toBe(true);
    expect(layer.drawn).toBe(1);
    layer.dispose();
  });

  it('two instances give four meshes with different materials; a frame without one hides its two; an empty frame hides all', () => {
    const scene = new Scene(), layer = new LichLayer(scene, make, CLAW_LAYER);
    const a = inst(1), b = inst(2);
    layer.frame([a, b], slotOf);
    const ms = meshes(scene);
    expect(ms.length).toBe(4);
    expect(new Set(ms.map((m) => m.material)).size).toBe(4);
    expect(layer.drawn).toBe(2);
    layer.frame([a], slotOf);
    expect(ms.filter((m) => m.visible).length).toBe(2);
    expect(layer.drawn).toBe(1);
    layer.frame([], slotOf);
    expect(ms.some((m) => m.visible)).toBe(false);
    expect(layer.drawn).toBe(0);
    layer.dispose();
  });

  it('a stone instance hides its claw mesh', () => {
    const scene = new Scene(), layer = new LichLayer(scene, make, CLAW_LAYER);
    layer.frame([inst(1, { stone: true })], slotOf);
    const ms = meshes(scene);
    expect(ms.find((m) => m.renderOrder === FIGURE_ORDER)!.visible).toBe(true);
    expect(ms.find((m) => m.renderOrder === CLAW_ORDER)!.visible).toBe(false);
    layer.dispose();
  });

  it('a figure without claws has no claw mesh', () => {
    const scene = new Scene(), layer = new LichLayer(scene, make, CLAW_LAYER);
    layer.frame([inst(1, { glow: null })], slotOf);
    expect(meshes(scene).length).toBe(1);
    expect(meshes(scene)[0].renderOrder).toBe(FIGURE_ORDER);
    layer.dispose();
  });

  it('the uniforms hold the instance\'s place, yaw, scale, levels and look; seen carries the caster slot', () => {
    const mats: LichMaterials[] = [];
    const layer = new LichLayer(new Scene(), () => { const m = make(); mats.push(m); return m; }, CLAW_LAYER);
    layer.frame([inst(3, { stone: true, dark: true, cut: true, groundY: -2 })], slotOf);
    const u = mats[0].u;
    expect(u.root.value.toArray()).toEqual([4, 0.25, 2, 0.5].map(Math.fround));
    expect(u.scale.value).toBeCloseTo(0.07, 6);
    expect(u.levels.value.toArray()).toEqual([0.1, 0.2, 0.3, 0]);
    expect(u.tint.value.toArray()).toEqual([1, 0.5, 0.25, 1]);
    expect(u.seen.value.toArray()).toEqual([0.8, 0.1, 0.2, 13].map(Math.fround));
    expect(u.flags.value.toArray()).toEqual([1, 1, 0, -2]);
    layer.dispose();
  });

  it('a second layer from the same buffers draws the same ranges', () => {
    const a = inst(1), s1 = new Scene(), s2 = new Scene();
    const l1 = new LichLayer(s1, make, CLAW_LAYER), l2 = new LichLayer(s2, make, CLAW_LAYER);
    l1.frame([a], slotOf); l2.frame([a], slotOf);
    const counts = (s: Scene): number[] => meshes(s).map((m) => m.geometry.drawRange.count).sort();
    expect(counts(s2)).toEqual(counts(s1));
    l1.dispose(); l2.dispose();
  });

  it('a new body buffer makes the geometry again; an owner gone for 300 frames is disposed', () => {
    const scene = new Scene(), layer = new LichLayer(scene, make, CLAW_LAYER);
    const a = inst(1);
    layer.frame([a], slotOf);
    const g0 = meshes(scene)[0].geometry;
    const material = meshes(scene)[0].material;
    layer.frame([{ ...a, body: { ...a.body, indices: 7 } }], slotOf);
    expect(meshes(scene)[0].geometry).not.toBe(g0);
    expect(meshes(scene)[0].material).toBe(material);
    expect(meshes(scene)[0].geometry.drawRange.count).toBe(7);
    for (let i = 0; i < 300; i++) layer.frame([], slotOf);
    expect(meshes(scene).length).toBe(0);
    layer.dispose();
  });

  it('dispose leaves no mesh in the scene', () => {
    const scene = new Scene(), layer = new LichLayer(scene, make, CLAW_LAYER);
    layer.frame([inst(1), inst(2)], slotOf);
    layer.dispose();
    expect(meshes(scene).length).toBe(0);
  });
});
