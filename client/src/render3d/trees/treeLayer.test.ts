import { describe, expect, it } from 'vitest';
import { DataTexture, Mesh, Scene, Texture } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { seeUniforms } from '../materials';
import { buildTree } from './build';
import { Forest } from './forest';
import { paletteBytes } from './palette';
import type { TreeForm, TreeSpec } from './spec';
import { TREE_ORDER, treeMaterials } from './treeNodes';
import { TREE_UPLOAD_MS, TreeLayer } from './treeLayer';

const spec = (x: number, z: number, seed = 1, extra: Partial<TreeSpec> = {}): TreeSpec => ({ form: 'round' as TreeForm, x, z, seed, scalePct: 100, mirrored: false, leaf: 1, dead: false, ...extra });
const MAP = { w: 48, h: 32 }; // 3 x 2 chunks
const FEET = [spec(2, 2, 1), spec(20, 3, 2), spec(40, 20, 3)]; // three chunks

function layer(hasSun: boolean, now?: () => number): { l: TreeLayer; scene: Scene; sun: Scene | null; made: { n: number } } {
  const scene = new Scene();
  const sun = hasSun ? new Scene() : null;
  const made = { n: 0 };
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: hasSun });
  const l = new TreeLayer(scene, sun, (palette, shared) => {
    made.n++;
    return treeMaterials({ lighting, sight: makeSight(), see: seeUniforms(), mask: new Texture(), palette, shared, hasSun });
  }, now);
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
    // Per chunk: the depth and colour passes, the leaves (all in the scene), and the caster in the sun's scene.
    expect(scene.children).toHaveLength(2 * 3);
    expect(sun!.children).toHaveLength(2);
    expect(l.meshCount).toBe(2 * 4);
  });

  it('makes no caster without a sun', () => {
    const { l, scene } = layer(false);
    l.sync(frame(built(3)));
    expect(scene.children).toHaveLength(3 * 3);
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

  it('uses at most 8 vertex attributes: a WebGPU pipeline takes no more buffers', () => {
    const { l, scene } = layer(true);
    l.sync(frame(built(1)));
    const g = (scene.children[0] as Mesh).geometry;
    expect(Object.keys(g.attributes).sort()).toEqual(['grad', 'look', 'misc', 'nrm', 'part', 'plant', 'position', 'tuft']);
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
    expect(scene.children).toHaveLength(3 * 3);
  });

  it('a new layer on the same half-built forest shows every chunk so far and keeps receiving new ones (a lost device)', () => {
    const f = new Forest(FEET, MAP, 0);
    f.step({ x: 0, z: 0 }, 0);
    f.step({ x: 0, z: 0 }, 0);
    const old = layer(true);
    old.l.sync(frame(f));
    expect(old.scene.children).toHaveLength(2 * 3);
    old.l.dispose();
    const fresh = layer(true);
    fresh.l.sync(frame(f));
    expect(fresh.scene.children).toHaveLength(2 * 3);
    expect(fresh.sun!.children).toHaveLength(2);
    f.step({ x: 0, z: 0 }, 1e6);
    fresh.l.sync(frame(f));
    expect(fresh.scene.children).toHaveLength(3 * 3);
  });

  describe('uploads of a growing chunk', () => {
    const SAME = [spec(2, 2, 1), spec(4, 4, 2), spec(6, 6, 3), spec(8, 8, 4)]; // one chunk
    // A forest on a fake clock that moves 10 ms per reading, so a step with no budget builds exactly one tree.
    const forest = (): Forest => { let c = 0; return new Forest(SAME, MAP, 0, buildTree, () => (c += 10)); };
    const grow = (f: Forest) => f.step({ x: 0, z: 0 }, 0); // one tree
    const verts = (scene: Scene) => ((scene.children[0] as Mesh).geometry.getAttribute('position').count);
    const total = (f: Forest) => [...f.frame({ wind: false, t: 0 }).chunks.values()][0].mesh.verts;

    it('rebuilds a chunk that gains trees on consecutive frames once inside the window, not per frame', () => {
      let now = 0;
      const f = forest();
      const { l, scene } = layer(true, () => now);
      grow(f);
      l.sync(frame(f)); // never shown: built at once
      const first = scene.children[0] as Mesh;
      const v1 = verts(scene);
      for (let i = 0; i < 2; i++) { now += 16; grow(f); l.sync(frame(f)); }
      expect(scene.children[0]).toBe(first); // same mesh: no rebuild
      expect(verts(scene)).toBe(v1);
      expect(scene.children).toHaveLength(3);
    });

    it('shows every tree after the window', () => {
      let now = 0;
      const f = forest();
      const { l, scene } = layer(true, () => now);
      grow(f);
      l.sync(frame(f));
      now += 16; grow(f); l.sync(frame(f));
      now += 16; grow(f); l.sync(frame(f));
      expect(verts(scene)).toBeLessThan(total(f));
      now += TREE_UPLOAD_MS; // no new tree: the pending change is still uploaded
      l.sync(frame(f));
      expect(verts(scene)).toBe(total(f));
      expect(scene.children).toHaveLength(3);
    });

    it('is complete on the next sync when the forest is complete, inside the window', () => {
      let now = 0;
      const f = forest();
      const { l, scene } = layer(true, () => now);
      grow(f);
      l.sync(frame(f));
      now += 16; grow(f); grow(f); grow(f);
      expect(f.built).toBe(f.total);
      l.sync(frame(f));
      expect(verts(scene)).toBe(total(f));
    });

    it('a new layer on the same forest (a lost device) shows everything at once', () => {
      const f = forest();
      grow(f); grow(f);
      const fresh = layer(true, () => 0);
      fresh.l.sync(frame(f));
      expect(verts(fresh.scene)).toBe(total(f));
    });
  });

  it('draws the depth pass after the ground (order 0) and the colour pass before the translucent passes (order 1 and up)', () => {
    const { l, scene } = layer(true);
    l.sync(frame(built(1)));
    const orders = (scene.children as Mesh[]).map((m) => m.renderOrder).sort((a, b) => a - b);
    expect(orders[0]).toBeGreaterThan(new Mesh().renderOrder);
    expect(orders[1]).toBeLessThan(1);
    expect(orders[0]).toBeLessThan(orders[1]);
  });

  it('starts over when handed another forest', () => {
    const { l, scene, sun } = layer(true);
    l.sync(frame(built(3)));
    expect(scene.children).toHaveLength(9);
    const other = new Forest([spec(2, 2, 9)], MAP, 0);
    other.step({ x: 0, z: 0 }, 1e6);
    l.sync(frame(other));
    expect(scene.children).toHaveLength(3); // the first forest's chunks are gone
    expect(sun!.children).toHaveLength(1);
  });

  it('clear and dispose take every mesh out', () => {
    const { l, scene, sun } = layer(true);
    l.sync(frame(built(3)));
    l.clear();
    expect(scene.children).toHaveLength(0);
    expect(sun!.children).toHaveLength(0);
    l.sync(frame(built(3)));
    expect(scene.children).toHaveLength(9);
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

  describe('falling leaves', () => {
    const leafMeshes = (scene: Scene) => (scene.children as Mesh[]).filter((m) => m.renderOrder === TREE_ORDER.leaf);
    const leafCount = (f: Forest) => [...f.frame({ wind: false, t: 0 }).chunks.values()].reduce((n, c) => n + c.leaves.n, 0);

    it('adds one more mesh per chunk with leaves, drawn after the tree colour pass, in the scene only (no shadow)', () => {
      const { l, scene, sun } = layer(true);
      const f = built(3);
      l.sync(frame(f));
      expect(leafMeshes(scene)).toHaveLength(3);
      expect(scene.children).toHaveLength(3 * 3);
      expect(sun!.children).toHaveLength(3);
      expect(TREE_ORDER.leaf).toBeGreaterThan(TREE_ORDER.colour);
      expect(TREE_ORDER.leaf).toBeLessThan(1);
    });

    it('has no leaf mesh for a chunk whose trees drop none (a dead tree, a conifer)', () => {
      const f = new Forest([spec(2, 2, 1, { dead: true }), spec(20, 3, 2, { form: 'conifer' }), spec(40, 20, 3)], MAP, 0);
      f.step({ x: 0, z: 0 }, 1e6);
      const { l, scene } = layer(true);
      l.sync(frame(f));
      expect(leafMeshes(scene)).toHaveLength(1);
      expect(scene.children).toHaveLength(3 * 2 + 1);
    });

    it('uses at most 8 vertex attributes, one quad of four vertices per leaf', () => {
      const f = built(1);
      const { l, scene } = layer(true);
      l.sync(frame(f));
      const g = leafMeshes(scene)[0].geometry;
      expect(Object.keys(g.attributes).sort()).toEqual(['look', 'params', 'plant', 'position', 'start']);
      expect(Object.keys(g.attributes).length).toBeLessThanOrEqual(8);
      const n = leafCount(f);
      expect(n).toBeGreaterThan(2);
      expect(g.getAttribute('position').count).toBe(n * 4);
      for (const k of ['start', 'params', 'plant', 'look']) expect(g.getAttribute(k).count, k).toBe(n * 4);
      expect(g.getIndex()!.count).toBe(n * 6);
    });

    it('keeps the leaf bounds wide enough for the drift and above the ground', () => {
      const f = built(1);
      const { l, scene } = layer(true);
      l.sync(frame(f));
      const c = [...f.frame({ wind: false, t: 0 }).chunks.values()][0];
      const b = leafMeshes(scene)[0].geometry.boundingBox!;
      expect(b.min.x).toBeLessThan(c.bounds.min.x);
      expect(b.max.z).toBeGreaterThan(c.bounds.max.z);
      expect(b.min.y).toBeLessThanOrEqual(0);
      expect(b.max.y).toBeGreaterThanOrEqual(c.bounds.max.y);
    });

    it('a new layer on the same forest (a lost device) shows the leaves again, and clear takes them out', () => {
      const f = built(2);
      const old = layer(true);
      old.l.sync(frame(f));
      old.l.dispose();
      expect(old.scene.children).toHaveLength(0);
      const fresh = layer(true);
      fresh.l.sync(frame(f));
      expect(leafMeshes(fresh.scene)).toHaveLength(2);
      expect(leafMeshes(fresh.scene)[0].geometry.getAttribute('position').count % 4).toBe(0);
      fresh.l.clear();
      expect(fresh.scene.children).toHaveLength(0);
    });

    it('uploads a growing chunk\'s leaves with its trees, inside the same window', () => {
      let now = 0;
      let c = 0;
      const f = new Forest([spec(2, 2, 1), spec(4, 4, 2), spec(6, 6, 3)], MAP, 0, buildTree, () => (c += 10));
      const { l, scene } = layer(true, () => now);
      f.step({ x: 0, z: 0 }, 0);
      l.sync(frame(f));
      const first = leafMeshes(scene)[0], n1 = first.geometry.getAttribute('position').count;
      now += 16; f.step({ x: 0, z: 0 }, 0); l.sync(frame(f));
      expect(leafMeshes(scene)[0]).toBe(first); // inside the window: not rebuilt
      now += TREE_UPLOAD_MS; l.sync(frame(f));
      expect(leafMeshes(scene)[0].geometry.getAttribute('position').count).toBeGreaterThan(n1);
    });

    it('hands the leaf rate to the shared uniform', () => {
      const { l } = layer(true);
      l.sync({ ...frame(built(1)), leafRate: 12 });
      expect(l.shared.leafRate.value).toBe(12);
    });
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
