// Every 3D material ends with the sight step (#305): the generated code of each carries the sight uniforms. #307 and #308 extend the list.
import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DataTexture, GLSLNodeBuilder, NodeMaterial, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { cardMaterial, emissiveMaterial, fxLitMaterial, fxMaterial,glowMaterial, seeUniforms, shadowMaterial, sunCasterMaterial, viewTowardUniform, worldMaterial } from './materials';
import { fieldMaterial, fieldUniforms } from './fieldMesh';
import { makeTreeShared, treeMaterials } from './trees/treeNodes';
import { makeLighting } from './lightNodes';
import { makeSight } from './sightNodes';
import { fragment, type Builder } from './shaderCode.testutil';
import { dipMaterial } from './dips/dipNodes';
import { airMaterials } from './air/airNodes';
import { bushelMaterial, coverSheetMaterial, makeCoverShared } from './cover/coverNodes';

const lit = () => {
  const heights = new DataTexture(new Uint8Array(12), 4, 3);
  return makeLighting(heights, { w: 4, h: 3 }, new Texture());
};

// The air's vertex layouts (airQuads.ts); the builders read the attributes from the geometry.
const DIP_ATTRS: [string, number][] = [['position', 3], ['normal', 3], ['uv', 2], ['rect', 4], ['kind', 1], ['dip', 1]];
const AIR_ATTRS: [string, number][] = [['position', 3], ['corner', 2], ['size', 2], ['rgba', 4], ['kind', 1], ['sightXZ', 2]];
const HAZE_ATTRS: [string, number][] = [['position', 3], ['sheet', 4]];
const FX_ATTRS: [string, number][] = [['position', 3], ['rgba', 4], ['sight', 2]];
const geometryOf = (attrs?: [string, number][]): BufferGeometry | undefined => {
  if (!attrs) return undefined;
  const g = new BufferGeometry();
  for (const [n, s] of attrs) g.setAttribute(n, new BufferAttribute(new Float32Array(6 * s), s));
  return g;
};

/** Each material of the view, built against one `Sight`. */
function materials(): { name: string; m: NodeMaterial; world: boolean; attrs?: [string, number][] }[] {
  const sight = makeSight();
  const l = lit();
  const toward = viewTowardUniform();
  const t = new Texture();
  // The tree's depth pass stipples by the sight value at the foot; its colour pass ends with the sight step. The sun's pass is depth only and never hidden (plants are scenery).
  const cover = makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1));
  const trees = treeMaterials({ lighting: l, sight, see: seeUniforms(), mask: t, palette: t, shared: makeTreeShared(), hasSun: false, cover });
  const air = airMaterials(l, sight, { sun: false, toward });
  return [
    { name: 'world', m: worldMaterial(t, t, 64, 64, l, t, t, sight, cover).material, world: true },
    // The ground cover (#330): sheets and bushels end with the sight step.
    // The dips' ground (#324): floor above, bank rock below.
    { name: 'dip', m: dipMaterial(t, t, 64, 64, l, t, sight).material, world: true, attrs: DIP_ATTRS },
    { name: 'cover sheet', m: coverSheetMaterial({ lighting: l, sight, shared: cover }), world: false },
    { name: 'bushel', m: bushelMaterial({ lighting: l, sight, toward, shared: cover }), world: false },
    { name: 'card opaque', m: cardMaterial(t, 64, 64, l, toward, sight).material, world: false },
    { name: 'card translucent', m: cardMaterial(t, 64, 64, l, toward, sight, { translucent: true }).material, world: false },
    { name: 'card flat', m: cardMaterial(t, 64, 64, l, toward, sight, { flat: true, translucent: true }).material, world: false },
    { name: 'flame', m: emissiveMaterial(t, 64, 64, l, toward, sight), world: false },
    { name: 'glow', m: glowMaterial(sight), world: false },
    { name: 'shadow', m: shadowMaterial(sight), world: false },
    // The figures' effect triangles (#338): vertex colours, hidden like a glow.
    { name: 'figure fx', m: fxMaterial(sight), world: false, attrs: FX_ATTRS },
    { name: 'lit fx', m: fxLitMaterial(sight, l), world: false, attrs: FX_ATTRS },
    // Depth only (no colour to veil), but it stipples by the same sight value as the opaque card, so a figure the hero cannot see casts no shadow.
    { name: 'sun caster', m: sunCasterMaterial(t, 64, 64, l.sun, sight), world: false },
    { name: 'force field', m: fieldMaterial(sight, fieldUniforms()), world: false },
    { name: 'tree depth', m: trees.depth, world: false },
    { name: 'tree colour', m: trees.colour, world: false },
    // A falling leaf: lit like the leaves and veiled like every world material.
    { name: 'tree leaf', m: trees.leaf, world: false },
    // The air (#307): specks and embers (additive), smoke, rings and drops (blended) and the haze sheets.
    { name: 'air add', m: air.add, world: false, attrs: AIR_ATTRS },
    { name: 'air blend', m: air.blend, world: false, attrs: AIR_ATTRS },
    { name: 'air haze', m: air.haze, world: false, attrs: HAZE_ATTRS },
  ];
}

describe('the sight step in the materials', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: every world material ends with the sight step`, () => {
      for (const { name, m, world, attrs } of materials()) {
        const code = fragment(B, m, { geometry: geometryOf(attrs) });
        expect(code, name).toContain('sightMode');
        if (world) {
          // The mask's sampler is a plain `nodeUniformN` in the code; its origin uniform carries the name.
          expect(code, name).toContain('sightOrigin');
          expect(code, name).toMatch(B === WGSLNodeBuilder ? /texture_2d<f32>/ : /uniform sampler2D/);
        }
      }
    });
  }
});

// #325: a wall card that is not burning (a torch that is out) is lit by the light model, so the flame material carries the lights.
describe('the flame material', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: reads the room's light`, () => {
      const code = fragment(B, emissiveMaterial(new Texture(), 64, 64, lit(), viewTowardUniform(), makeSight()));
      expect(code).toContain('lightAmbient');
    });
  }
});

describe('a world without a sun', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the world and card materials carry no shadow compare`, () => {
      const sight = makeSight();
      const l = lit();
      const t = new Texture();
      const toward = viewTowardUniform();
      const cover = makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1));
      const ms = [worldMaterial(t, t, 64, 64, l, t, t, sight, cover).material, cardMaterial(t, 64, 64, l, toward, sight).material];
      for (const m of ms) {
        const code = fragment(B, m, { compare: true });
        expect(code).not.toMatch(B === WGSLNodeBuilder ? /texture_depth_2d|textureSampleCompare/ : /uniform sampler2DShadow/);
        expect(code).not.toContain('311.7');
      }
    });
  }
});

// WebGPU allows 12 uniform buffers per fragment stage (`maxUniformBuffersPerShaderStage`); a material over it fails to build its pipeline on a real GPU
// and draws nothing (#307: the crack arrays took the world material from 8 to 13). The tests build without a GPU, so the count is read from the code.
describe('the uniform buffers of the WebGPU shaders', () => {
  const LIMIT = 12;
  it('no material needs more than the stage limit', () => {
    for (const { name, m, attrs } of materials()) {
      const code = fragment(WGSLNodeBuilder, m, { geometry: geometryOf(attrs) });
      expect((code.match(/var<uniform>/g) ?? []).length, name).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('the shaft march fits too', async () => {
    const { makeShaftPass } = await import('./air/shaftNodes');
    const pass = makeShaftPass(lit(), makeSight());
    expect((fragment(WGSLNodeBuilder, pass.march).match(/var<uniform>/g) ?? []).length).toBeLessThanOrEqual(LIMIT);
    expect((fragment(WGSLNodeBuilder, pass.composite).match(/var<uniform>/g) ?? []).length).toBeLessThanOrEqual(LIMIT);
    pass.dispose();
  });
});
