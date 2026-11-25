// Every 3D material ends with the sight step (#305): the generated code of each carries the sight uniforms. #307 and #308 extend the list.
import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, GLSLNodeBuilder, NodeMaterial, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { cardMaterial, fxLitMaterial, fxMaterial,glowMaterial, seeUniforms, shadowMaterial, smokeMaterial, sunCasterMaterial, viewTowardUniform, worldMaterial } from './materials';
import { fieldMaterial, fieldUniforms } from './fieldMesh';
import { makeTreeShared, treeMaterials } from './trees/treeNodes';
import { makeBrushUniforms } from './windNodes';
import { makeLighting } from './lightNodes';
import { makeSight } from './sightNodes';
import { fragment, type Builder } from './shaderCode.testutil';
import { dipMaterial } from './dips/dipNodes';
import { unplanned } from './stone/plan';
import { makeSheets } from './stone/sheets';
import { crystalMaterial } from './stone/crystalNodes';
import { flameMaterial, holderMaterial } from './torch/torchNodes';
import { airMaterials } from './air/airNodes';
import { ceilingMaterial, waterMaterial } from './water/waterNodes';
import { lavaMaterial, shimmerMaterial } from './lava/lavaNodes';
import { bushelMaterial, coverSheetMaterial, makeCoverShared } from './cover/coverNodes';

const lit = () => {
  const heights = new DataTexture(new Uint8Array(12), 4, 3);
  return makeLighting(heights, { w: 4, h: 3 }, new Texture());
};

// The air's vertex layouts (airQuads.ts); the builders read the attributes from the geometry.
const DIP_ATTRS: [string, number][] = [['position', 3], ['normal', 3], ['uv', 2], ['rect', 4], ['kind', 1], ['sheet', 3], ['dip', 1], ['marks', 3]];
/** The stone sheets of the world and dip materials. */
const sheets = () => makeSheets(unplanned(), { size: 4096, layers: 256 });
const AIR_ATTRS: [string, number][] = [['position', 3], ['corner', 2], ['size', 2], ['rgba', 4], ['kind', 1], ['sightXZ', 2]];
const HAZE_ATTRS: [string, number][] = [['position', 3], ['sheet', 4]];
const FX_ATTRS: [string, number][] = [['position', 3], ['rgba', 4], ['sight', 2]];
const LAVA_ATTRS: [string, number][] = [['position', 3], ['shore', 2]];
const CRYSTAL_ATTRS: [string, number][] = [['position', 3], ['normal', 3], ['gem', 3], ['foot', 2]];
const HOLDER_ATTRS: [string, number][] = [['position', 3], ['normal', 3], ['colour', 3], ['warm', 1], ['foot', 2]];
const TORCH_FLAME_ATTRS: [string, number][] = [['position', 3], ['flame', 4], ['reach', 2], ['foot', 2]];
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
  const trees = treeMaterials({ lighting: l, sight, see: seeUniforms(), mask: t, palette: t, shared: makeTreeShared(), hasSun: false, cover, brush: makeBrushUniforms() });
  const air = airMaterials(l, sight, { sun: false, toward });
  return [
    { name: 'world', m: worldMaterial(l, t, t, sight, cover, sheets()).material, world: true },
    // The ground cover (#330): sheets and bushels end with the sight step.
    // The dips' ground (#324): floor above, bank rock below.
    { name: 'dip', m: dipMaterial(l, t, sight, cover, sheets()).material, world: true, attrs: DIP_ATTRS },
    // The water's surface and the ceiling of its mirror pass (#345).
    { name: 'water', m: waterMaterial(l, sight, t, { w: 4, h: 3 }, toward).material, world: true },
    { name: 'ceiling', m: ceilingMaterial(l, sight), world: true },
    // The crystals (#380): gems lit by the room, then the sight step.
    { name: 'crystal', m: crystalMaterial(l, sight).material, world: true, attrs: CRYSTAL_ATTRS },
    // The wall torch (#391): the holder lit by the room, the flame by itself; both end with the sight step.
    { name: 'torch holder', m: holderMaterial(l, sight), world: true, attrs: HOLDER_ATTRS },
    { name: 'torch flame', m: flameMaterial(sight, toward).material, world: true, attrs: TORCH_FLAME_ATTRS },
    // The lava's surface (#344) ends with the sight step.
    { name: 'lava', m: lavaMaterial(sight).material, world: true, attrs: LAVA_ATTRS },
    // The heat shimmer (#344) is the one material without the sight step: it shows the scene copy, which went through the step, and its
    // strength is gated by the seen share at the view ray's ground point (the mask's read and the mode are in its code).
    { name: 'shimmer', m: shimmerMaterial(sight, l.lavaTexture, { w: 4, h: 3 }, toward).material, world: true },
    { name: 'cover sheet', m: coverSheetMaterial({ lighting: l, sight, shared: cover }), world: false },
    { name: 'bushel', m: bushelMaterial({ lighting: l, sight, toward, shared: cover }), world: false },
    { name: 'card opaque', m: cardMaterial(t, 64, 64, l, toward, sight).material, world: false },
    { name: 'card translucent', m: cardMaterial(t, 64, 64, l, toward, sight, { translucent: true }).material, world: false },
    { name: 'card flat', m: cardMaterial(t, 64, 64, l, toward, sight, { flat: true, translucent: true }).material, world: false },
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
    // The air (#307): specks and embers (additive), smoke and drops (blended) and the haze sheets.
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

describe('a world without a sun', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the world and card materials carry no shadow compare`, () => {
      const sight = makeSight();
      const l = lit();
      const t = new Texture();
      const toward = viewTowardUniform();
      const cover = makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1));
      const ms = [worldMaterial(l, t, t, sight, cover, sheets()).material, cardMaterial(t, 64, 64, l, toward, sight).material];
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

// The smoke of a body of smoke (#359): the fragment makes its shape from noise, so it carries a noise call; the blended effect triangles carry none.
describe('the smoke material', () => {
  const SMOKE_ATTRS: [string, number][] = [['position', 3], ['rgba', 4], ['c', 4], ['sight', 2]];
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: compiles, reads rgba and c, calls a noise; fxMaterial has none`, () => {
      const sight = makeSight();
      const m = smokeMaterial(sight);
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(true);
      expect(m.forceSinglePass).toBe(true);
      expect(m.side).toBe(DoubleSide);
      const code = fragment(B, m, { geometry: geometryOf(SMOKE_ATTRS) });
      expect(code).toContain('sightMode');
      // The attributes are mangled into varyings: rgba and c are the two vec4, sight the vec2 (the generated names carry no attribute name).
      expect(code.match(/nodeVarying\d+\s*:\s*vec4|in vec4 nodeVarying\d+/g)).toHaveLength(2);
      expect(code).toMatch(/vec2(<f32>)?\( 1\.3, 0\.7 \)/);   // the warp noise's scale
      expect(code).toMatch(/vec2(<f32>)?\( 2\.6, 0\.9 \)/);   // the streak noise's scale
      expect((code.match(/\bfn\d+ \(/g) ?? []).length).toBeGreaterThanOrEqual(3);   // the noise function: its definition and two calls
      expect(fragment(B, fxMaterial(sight), { geometry: geometryOf(FX_ATTRS) })).not.toMatch(/1\.3, 0\.7|2\.6, 0\.9/);
    });
  }
});
