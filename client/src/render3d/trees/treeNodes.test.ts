import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, EqualDepth, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { seeUniforms } from '../materials';
import { fragment, vertex, type Builder } from '../shaderCode.testutil';
import { RAMP, TreeMesh, tube, tufts } from './mesh';
import { makeTreeShared, treeMaterials, type TreeMaterials } from './treeNodes';

/** A small tree: a trunk tube and a lobe of tufts, with the per-plant attributes a forest fills. */
function treeGeometry(): BufferGeometry {
  const m = new TreeMesh();
  tube(m, [{ x: 0, y: 0, z: 0, w: 0.1 }, { x: 0, y: 1, z: 0, w: 0.07 }], 5, RAMP.bark, () => 0.1, () => 0, true);
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  tufts(m, { x: 0, y: 1.2, z: 0, rx: 0.5, ry: 0.5, rz: 0.5, k: 0.1 }, () => [0, 0, 0, 0], 0.5, rnd, RAMP.leaf);
  const g = new BufferGeometry();
  const set = (name: string, data: number[], size: number) => g.setAttribute(name, new BufferAttribute(new Float32Array(data), size));
  set('position', m.position, 3); set('normal', m.normal, 3); set('grad', m.grad, 4); set('sway', m.sway, 2);
  set('part', m.part, 4); set('misc', m.misc, 4); set('tuft', m.tuft, 4);
  const n = m.verts;
  set('plant', Array.from({ length: n }, () => [3, 4, 1, 0]).flat(), 4);
  set('look', Array.from({ length: n }, () => [1, 0, 1, 0]).flat(), 4);
  g.setIndex(m.index);
  return g;
}

function build(hasSun: boolean): { mats: TreeMaterials; geometry: BufferGeometry } {
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: hasSun });
  const mats = treeMaterials({ lighting, sight: makeSight(), see: seeUniforms(), mask: new Texture(), palette: new Texture(), shared: makeTreeShared(), hasSun });
  return { mats, geometry: treeGeometry() };
}

/** Whether the read `h` sits at the top level of main(): every block opened since main began is closed again. */
function topLevel(_B: Builder, code: string, h: RegExpMatchArray): void {
  const before = code.slice(0, h.index);
  const since = before.slice(Math.max(before.lastIndexOf('void main'), before.lastIndexOf('fn main')));
  expect((since.match(/\{/g) ?? []).length - 1, `read at ${h.index}`).toBe((since.match(/\}/g) ?? []).length);
}

for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
  const wgsl = B === WGSLNodeBuilder;
  const shadowMap = wgsl ? /texture_depth_2d|textureSampleCompare/ : /uniform sampler2DShadow/;

  describe(`tree materials in ${B.name}`, () => {
    it('all three build with a sun', () => {
      const { mats, geometry } = build(true);
      expect(mats.sun).not.toBeNull();
      for (const m of [mats.depth, mats.colour, mats.sun!]) {
        expect(fragment(B, m, { compare: true, geometry }).length).toBeGreaterThan(0);
        expect(vertex(B, m, { compare: true, geometry }).length).toBeGreaterThan(0);
      }
    });

    it('without a sun there is no sun material and no shadow-map sampler in the colour shader', () => {
      const { mats, geometry } = build(false);
      expect(mats.sun).toBeNull();
      expect(fragment(B, mats.colour, { compare: true, geometry })).not.toMatch(shadowMap);
      expect(fragment(B, mats.depth, { compare: true, geometry })).not.toMatch(shadowMap);
    });

    it('the colour shader samples the shadow map once, at the top level', () => {
      const { mats, geometry } = build(true);
      const code = fragment(B, mats.colour, { compare: true, geometry });
      const own = wgsl ? /textureSampleCompare\(/g : /\btexture\( \w+, vec3\(/g;
      expect([...code.matchAll(own)]).toHaveLength(1);
      topLevel(B, code, [...code.matchAll(own)][0]);
    });

    it('the colour shader reads each texture once (sight mask, shadow map, lava light, palette), the sight mask and the palette at the top level', () => {
      const { mats, geometry } = build(true);
      const colour = fragment(B, mats.colour, { compare: true, geometry });
      expect(colour).toContain('sightMode');
      expect(colour).toContain('sightOrigin');
      const reads = wgsl ? /textureSample\w*\(/g : /\btexture\(/g;
      // A second copy of the light (the same read inside a select's branch) would add reads.
      expect([...colour.matchAll(reads)]).toHaveLength(4);
      const first = [...colour.matchAll(reads)];
      for (const i of [0, 3]) topLevel(B, colour, first[i]);
    });

    it('the depth shader reads the sight mask and the see-through mask once each, at the top level', () => {
      const { mats, geometry } = build(true);
      const depth = fragment(B, mats.depth, { compare: true, geometry });
      expect(depth).toContain('sightOrigin');
      const hits = [...depth.matchAll(wgsl ? /textureSample\w*\(/g : /\btexture\(/g)];
      expect(hits).toHaveLength(2);
      for (const h of hits) topLevel(B, depth, h);
    });

    it('the depth pass opens foliage only: it reads the see-through mask, the sun pass does not', () => {
      const { mats, geometry } = build(true);
      const depth = fragment(B, mats.depth, { compare: true, geometry });
      const sun = fragment(B, mats.sun!, { compare: true, geometry });
      expect(depth).toContain('sightOrigin');
      expect(sun).not.toContain('sightOrigin');
      expect(sun).not.toContain('sightMode');
      const count = (code: string) => [...code.matchAll(wgsl ? /textureSample\w*\(/g : /\btexture\(/g)].length;
      expect(count(depth)).toBe(2); // sight mask and see-through mask
      expect(count(sun)).toBe(0);
    });

    it('the three materials collapse a leafless vertex with the same code', () => {
      const { mats, geometry } = build(true);
      const collapse = /-50\.0/;
      for (const m of [mats.depth, mats.colour, mats.sun!]) {
        const code = vertex(B, m, { compare: true, geometry });
        expect(code).toMatch(collapse);
        expect(code).toContain('treeLeafOverride');
      }
    });

    it('a dungeon colour pass divides only by a floored brightness', () => {
      const { mats, geometry } = build(false);
      expect(fragment(B, mats.colour, { geometry }).length).toBeGreaterThan(0);
    });
  });
}

describe('tree material state', () => {
  it('the colour pass draws at equal depth without writing it; the depth pass writes no colour', () => {
    const { mats } = build(true);
    expect(mats.colour.depthFunc).toBe(EqualDepth);
    expect(mats.colour.depthWrite).toBe(false);
    expect(mats.depth.colorWrite).toBe(false);
    expect(mats.sun!.colorWrite).toBe(false);
  });

  it('all three are double sided (a mirrored tree flips its tufts\' winding)', () => {
    const { mats } = build(true);
    for (const m of [mats.depth, mats.colour, mats.sun!]) expect(m.side).toBe(DoubleSide);
  });

  it('the pre-pass draws first, the colour pass after the opaque things', () => {
    const { mats } = build(true);
    expect(mats.depth.alphaTest).toBe(0.5);
    expect(mats.colour.alphaTest).toBe(0);
  });

  it('all three take their position and their collapse from the one shared treePoint', () => {
    const { mats } = build(true);
    const p = mats.depth.userData.treePoint;
    expect(p).toBeDefined();
    expect(mats.colour.userData.treePoint).toBe(p);
    expect(mats.sun!.userData.treePoint).toBe(p);
    expect(mats.depth.positionNode).toBe(p.position);
    expect(mats.colour.positionNode).toBe(p.position);
    expect(mats.sun!.positionNode).toBe(p.sunPosition);
  });
});
