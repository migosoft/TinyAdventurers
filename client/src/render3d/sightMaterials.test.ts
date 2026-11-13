// Every 3D material ends with the sight step (#305): the generated code of each carries the sight uniforms. #307 and #308 extend the list.
import { describe, expect, it } from 'vitest';
import { DataTexture, GLSLNodeBuilder, NodeMaterial, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { cardMaterial, emissiveMaterial, glowMaterial, shadowMaterial, sunCasterMaterial, viewTowardUniform, worldMaterial } from './materials';
import { fieldMaterial } from './fieldMesh';
import { makeLighting } from './lightNodes';
import { makeSight } from './sightNodes';
import { fragment, type Builder } from './shaderCode.testutil';

const lit = () => {
  const heights = new DataTexture(new Uint8Array(12), 4, 3);
  return makeLighting(heights, { w: 4, h: 3 }, new Texture());
};

/** Each material of the view, built against one `Sight`. */
function materials(): { name: string; m: NodeMaterial; world: boolean }[] {
  const sight = makeSight();
  const l = lit();
  const toward = viewTowardUniform();
  const t = new Texture();
  return [
    { name: 'world', m: worldMaterial(t, t, 64, 64, l, t, t, sight).material, world: true },
    { name: 'card opaque', m: cardMaterial(t, 64, 64, l, toward, sight).material, world: false },
    { name: 'card translucent', m: cardMaterial(t, 64, 64, l, toward, sight, { translucent: true }).material, world: false },
    { name: 'card flat', m: cardMaterial(t, 64, 64, l, toward, sight, { flat: true, translucent: true }).material, world: false },
    { name: 'flame', m: emissiveMaterial(t, 64, 64, l, toward, sight), world: false },
    { name: 'glow', m: glowMaterial(sight), world: false },
    { name: 'shadow', m: shadowMaterial(sight), world: false },
    // Depth only (no colour to veil), but it stipples by the same sight value as the opaque card, so a figure the hero cannot see casts no shadow.
    { name: 'sun caster', m: sunCasterMaterial(t, 64, 64, l.sun, sight), world: false },
    { name: 'force field', m: fieldMaterial(sight), world: false },
  ];
}

describe('the sight step in the materials', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: every world material ends with the sight step`, () => {
      for (const { name, m, world } of materials()) {
        const code = fragment(B, m);
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
      const ms = [worldMaterial(t, t, 64, 64, l, t, t, sight).material, cardMaterial(t, 64, 64, l, toward, sight).material];
      for (const m of ms) {
        const code = fragment(B, m, { compare: true });
        expect(code).not.toMatch(B === WGSLNodeBuilder ? /texture_depth_2d|textureSampleCompare/ : /uniform sampler2DShadow/);
        expect(code).not.toContain('43758');
      }
    });
  }
});
