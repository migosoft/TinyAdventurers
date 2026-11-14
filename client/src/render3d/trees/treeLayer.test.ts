import { describe, expect, it } from 'vitest';
import { DataTexture, Mesh, Scene, Texture } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { seeUniforms } from '../materials';
import { Forest } from './forest';
import { paletteBytes } from './palette';
import type { TreeForm, TreeSpec } from './spec';
import { TREE_ORDER, treeMaterials } from './treeNodes';
import { TreeLayer } from './treeLayer';

const spec = (x: number, z: number, seed = 1, extra: Partial<TreeSpec> = {}): TreeSpec => ({ form: 'round' as TreeForm, x, z, seed, scalePct: 100, mirrored: false, leaf: 1, dead: false, ...extra });
const MAP = { w: 48, h: 32 }; // 3 x 2 chunks
const FEET = [spec(2, 2, 1), spec(20, 3, 2), spec(40, 20, 3)]; // three chunks

function layer(hasSun: boolean): { l: TreeLayer; scene: Scene; sun: Scene | null; made: { n: number } } {
  const scene = new Scene();
  const sun = hasSun ? new Scene() : null;
  const made = { n: 0 };
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: hasSun });
  const l = new TreeLayer(scene, sun, (palette, shared) => {
    made.n++;
    return treeMaterials({ lighting, sight: makeSight(), see: seeUniforms(), mask: new Texture(), palette, shared, hasSun });
  });
  return { l, scene, sun, made };
}
const built = (n: number): Forest => {
  const f = new Forest(FEET.slice(0, n), MAP, 0);
  f.step({ x: 0, z: 0 }, 1e6);
  return f;
};
const frame = (f: Forest) => f.frame({ wind: true, t: 3 });

describe('TreeLayer', () => {
  it('holds a depth and a colour mesh per chunk in the scene and a caster in the sun scene', () => {
    const { l, scene, sun } = layer(true);
    l.sync(frame(built(2)));
    expect(scene.children).toHaveLength(2 * 2);
    expect(sun!.children).toHaveLength(2);
    expect(l.meshCount).toBe(6);
  });

  it('makes no caster without a sun', () => {
    const { l, scene } = layer(false);
    l.sync(frame(built(3)));
    expect(scene.children).toHaveLength(3 * 2);
  });

  it('draws the depth pass before and the colour pass after the opaque things, on one geometry', () => {
    const { l, scene } = layer(true);
    l.sync(frame(built(1)));
    const [a, b] = scene.children as Mesh[];
    expect(a.geometry).toBe(b.geometry);
    expect([a.renderOrder, b.renderOrder].sort()).toEqual([TREE_ORDER.depth, TREE_ORDER.colour]);
    expect(a.matrixWorld.equals(b.matrixWorld)).toBe(true);
    expect(a.frustumCulled).toBe(true);
  });

  it('culls by the forest\'s bounds, not by the raw positions', () => {
    const f = built(1);
    const { l, scene } = layer(true);
    l.sync(frame(f));
    const g = (scene.children[0] as Mesh).geometry;
    const bounds = [...f.frame({ wind: false, t: 0 }).chunks.values()][0].bounds;
    expect(g.boundingBox!.min.toArray()).toEqual([bounds.min.x, bounds.min.y, bounds.min.z]);
    expect(g.boundingBox!.max.toArray()).toEqual([bounds.max.x, bounds.max.y, bounds.max.z]);
    expect(g.boundingSphere!.radius).toBeGreaterThan(0);
  });

  it('uploads the used length of the per-plant streams and a matching index', () => {
    const f = built(1);
    const { l, scene } = layer(true);
    l.sync(frame(f));
    const g = (scene.children[0] as Mesh).geometry;
    const c = [...f.frame({ wind: false, t: 0 }).chunks.values()][0];
    expect(g.getAttribute('position').count).toBe(c.mesh.verts);
    expect(g.getAttribute('plant').count).toBe(c.mesh.verts);
    expect(g.getAttribute('look').count).toBe(c.mesh.verts);
    expect(g.getIndex()!.count).toBe(c.mesh.index.length);
  });

  it('rebuilds only the chunks whose version moved', () => {
    const f = new Forest(FEET, MAP, 0);
    f.step({ x: 0, z: 0 }, 0); // one tree
    const { l, scene } = layer(true);
    l.sync(frame(f));
    const first = scene.children[0];
    l.sync(frame(f));
    expect(scene.children[0]).toBe(first);
    f.step({ x: 0, z: 0 }, 1e6);
    l.sync(frame(f));
    expect(scene.children).toHaveLength(3 * 2);
  });

  it('a new layer on the same half-built forest shows every chunk so far and keeps receiving new ones (a lost device)', () => {
    const f = new Forest(FEET, MAP, 0);
    f.step({ x: 0, z: 0 }, 0);
    f.step({ x: 0, z: 0 }, 0);
    const old = layer(true);
    old.l.sync(frame(f));
    expect(old.scene.children).toHaveLength(2 * 2);
    old.l.dispose();
    const fresh = layer(true);
    fresh.l.sync(frame(f));
    expect(fresh.scene.children).toHaveLength(2 * 2);
    expect(fresh.sun!.children).toHaveLength(2);
    f.step({ x: 0, z: 0 }, 1e6);
    fresh.l.sync(frame(f));
    expect(fresh.scene.children).toHaveLength(3 * 2);
  });

  it('clear and dispose take every mesh out', () => {
    const { l, scene, sun } = layer(true);
    l.sync(frame(built(3)));
    l.clear();
    expect(scene.children).toHaveLength(0);
    expect(sun!.children).toHaveLength(0);
    l.sync(frame(built(3)));
    expect(scene.children).toHaveLength(6);
    l.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('keeps one material set and one palette texture, in the rows the shader reads', () => {
    const { l, made } = layer(true);
    l.sync(frame(built(3)));
    l.sync(frame(built(3)));
    expect(made.n).toBe(1);
    const tex = l.paletteTexture!;
    expect(tex.magFilter).toBe(1003); // NearestFilter
    expect(tex.minFilter).toBe(1003);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.flipY).toBe(false);
    expect(Array.from(tex.image.data as Uint8Array)).toEqual(Array.from(paletteBytes(0)));
  });

  it('hands the frame\'s clock, wind, leaf override and plain switch to the shared uniforms', () => {
    const { l } = layer(true);
    l.sync({ ...frame(built(1)), t: 7.5, wind: false, leafOverride: 0.25, plain: true });
    expect(l.shared.t.value).toBe(7.5);
    expect(l.shared.windOn.value).toBe(0);
    expect(l.shared.leafOverride.value).toBe(0.25);
    expect(l.shared.plain.value).toBe(1);
  });
});
