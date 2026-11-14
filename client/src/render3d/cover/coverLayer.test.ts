import { describe, expect, it, vi } from 'vitest';
import { DataTexture, Mesh, Scene, Texture } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { viewTowardUniform } from '../materials';
import { makeSight } from '../sightNodes';
import { GroundTooLargeError } from '../groundError';
import { bushelMaterial, coverSheetMaterial } from './coverNodes';
import { makeCoverShared } from './coverRead';
import type { CoverResult } from './coverJob';
import { CoverLayer } from './coverLayer';
import { buildCoverChunk } from './coverMesh';
import { encodeCover, GH_MAX } from './kinds';
import type { Bushel } from './source';
import { CHUNK } from '../worldMesh';

const W = 40, H = 20; // 3 x 2 chunks
function result(put: [number, number, number][], bushels: Bushel[] = []): CoverResult {
  const w = W * 16, h = H * 16, data = new Uint8Array(w * h * 4);
  for (const [x, z, ht] of put) data[(z * w + x) * 4 + 3] = encodeCover(ht, 0);
  return { image: { w, h, data }, bare: null, bushels, sheets: 4 };
}
const bushel = (x: number, z: number): Bushel => ({ x, z, w: 8, h: 8, seed: 1, fern: false });
// Cover in chunk (0,0) and (2,1); a bushel in chunk (0,0) and one in (1,0).
const R = (): CoverResult => result([[5, 5, 2], [37 * 16, 18 * 16, 3]], [bushel(2.5, 2.5), bushel(20.5, 3.5)]);

function make() {
  const scene = new Scene();
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
  const shared = makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1));
  const sight = makeSight();
  const materials = {
    sheet: coverSheetMaterial({ lighting, sight, shared }),
    bushel: bushelMaterial({ lighting, sight, toward: viewTowardUniform(), shared }),
  };
  const layer = new CoverLayer(scene, shared, materials);
  return { layer, scene, shared, materials };
}

describe('CoverLayer', () => {
  it('makes one sheet mesh and at most one bushel mesh per non-empty chunk, with the chunk\'s bounds', () => {
    const { layer, scene } = make();
    const r = R();
    layer.set(r, 4096);
    // Chunks: (0,0) sheets+bushel, (1,0) bushel only, (2,1) sheets only.
    expect(layer.meshCount).toBe(2 + 1 + 1);
    expect(scene.children).toHaveLength(4);
    const c = buildCoverChunk(r, 0, 0)!;
    const sheet = (scene.children as Mesh[]).find((m) => m.renderOrder === 0.1 && m.geometry.boundingBox!.min.x === c.min[0] && m.geometry.boundingBox!.min.z === c.min[2])!;
    expect(sheet).toBeDefined();
    expect(sheet.geometry.boundingBox!.max.toArray()).toEqual(c.max);
    expect(sheet.frustumCulled).toBe(true);
    const bushels = (scene.children as Mesh[]).filter((m) => m.renderOrder === 0.15);
    expect(bushels).toHaveLength(2);
    const b = bushels.find((m) => m.geometry.boundingBox!.min.x < CHUNK)!;
    expect(b.geometry.boundingBox!.max.toArray()).toEqual(c.max);
    // The foot is the position attribute; the bounds are not computed from it.
    expect(Object.keys(b.geometry.attributes).sort()).toEqual(['corner', 'info', 'position']);
    expect(b.geometry.getAttribute('position').count).toBe(c.bushel.count);
  });

  it('throws GroundTooLargeError above the limit and leaves the layer empty', () => {
    const { layer } = make();
    layer.set(R(), 4096);
    expect(layer.meshCount).toBeGreaterThan(0);
    expect(() => layer.set(R(), 100)).toThrow(GroundTooLargeError);
    expect(layer.meshCount).toBe(0);
  });

  it('replaces the meshes on a second set', () => {
    const { layer, scene } = make();
    layer.set(R(), 4096);
    layer.set(R(), 4096);
    expect(layer.meshCount).toBe(4);
    expect(scene.children).toHaveLength(4);
  });

  it('builds no mesh for a run without cover', () => {
    const { layer } = make();
    layer.set({ image: { w: 1, h: 1, data: new Uint8Array(4) }, bare: null, bushels: [], sheets: 0 }, 4096);
    expect(layer.meshCount).toBe(0);
  });

  it('uploads the image as the shared texture and follows the frame', () => {
    const { layer, shared } = make();
    layer.set(R(), 4096);
    expect((shared.texture.value as Texture).image).toMatchObject({ width: W * 16, height: H * 16 });
    expect(shared.size.value.x).toBe(W * 16);
    layer.frame({ on: true, gh: 2, wind: true, t: 3 }, 0.5);
    expect([shared.on.value, shared.gh.value, shared.windOn.value, shared.t.value, shared.cosP.value]).toEqual([1, 2, 1, 3, 0.5]);
    layer.frame({ on: false, gh: 2, wind: false, t: 4 }, 0.5);
    expect(shared.on.value).toBe(0);
  });

  it('stays off (on = 0) without a good image and clamps gh to [0, GH_MAX]', () => {
    const { layer, shared } = make();
    const stand = shared.texture.value;
    const on = (): number => { layer.frame({ on: true, gh: 1, wind: false, t: 0 }, 1); return shared.on.value; };
    expect(on()).toBe(0); // before any set
    layer.set(R(), 4096);
    expect(on()).toBe(1);
    expect(() => layer.set(R(), 100)).toThrow(GroundTooLargeError);
    expect(on()).toBe(0); // after a too-large set
    expect(shared.texture.value).toBe(stand); // back on the stand-in
    layer.set({ image: { w: 1, h: 1, data: new Uint8Array(4) }, bare: null, bushels: [], sheets: 0 }, 4096);
    expect(on()).toBe(0); // no cover
    layer.frame({ on: true, gh: 9, wind: false, t: 0 }, 1);
    expect(shared.gh.value).toBe(GH_MAX);
    layer.frame({ on: true, gh: 0.25, wind: false, t: 0 }, 1);
    expect(shared.gh.value).toBe(0.25);
    layer.frame({ on: true, gh: -1, wind: false, t: 0 }, 1);
    expect(shared.gh.value).toBe(0);
  });

  it('dispose takes every mesh out and disposes its materials', () => {
    const { layer, scene, materials } = make();
    layer.set(R(), 4096);
    const spies = [materials.sheet, materials.bushel].map((m) => vi.spyOn(m, 'dispose'));
    layer.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
    expect(layer.meshCount).toBe(0);
  });
});
