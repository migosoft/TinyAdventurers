import { describe, expect, it } from 'vitest';
import { DataTexture, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import { makeLighting, type Lighting } from './lightNodes';
import { makeSunLight } from './sunNodes';
import { makeSight } from './sightNodes';
import { seeUniforms, viewTowardUniform } from './materials';
import { makePlantShared, plantCardMaterial, plantDiscMaterial, plantTrunkMaterial } from './plantNodes';
import { fragment, type Builder } from './shaderCode.testutil';

/** A `Lighting` whose light is a constant, so the only texture reads in a plant material are its own. */
function stub(): Lighting {
  return {
    lightAt: () => ({ rgb: vec3(1, 1, 1), dv: float(0) }),
    sun: makeSunLight(),
    finish: (a: unknown) => a,
    shoulder: (c: unknown) => c,
    cellH: () => float(0),
  } as unknown as Lighting;
}
const real = (): Lighting => makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: true });

for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
  describe(`plant materials in ${B.name}`, () => {
    const t = new Texture();
    const mask = new Texture();

    it('the card material builds with the real light and ends with the sight step', () => {
      const l = real();
      const m = plantCardMaterial(t, 1024, 1024, l, viewTowardUniform(), makeSight(), seeUniforms(), mask, makePlantShared());
      const code = fragment(B, m, { compare: true });
      expect(code).toContain('sightMode');
      expect(code).toContain('sightOrigin');
    });

    it('the card material builds in a world without a sun', () => {
      const l = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture());
      const m = plantCardMaterial(t, 1024, 1024, l, viewTowardUniform(), makeSight(), seeUniforms(), mask, makePlantShared());
      const code = fragment(B, m);
      expect(code).toContain('sightMode');
      expect(code).not.toContain('43758');
    });

    it('the card samples the page, the sight mask and the see-through mask at the top level, once each', () => {
      const m = plantCardMaterial(t, 1024, 1024, stub(), viewTowardUniform(), makeSight(), seeUniforms(), mask, makePlantShared());
      const code = fragment(B, m);
      const hits = [...code.matchAll(B === WGSLNodeBuilder ? /textureSample\(/g : /texture\(/g)];
      expect(hits).toHaveLength(3);
      for (const h of hits) {
        const before = code.slice(0, h.index);
        const since = before.slice(Math.max(before.lastIndexOf('void main'), before.lastIndexOf('fn main')));
        // Every block opened since main began (three's own uniform flipY if/else) is closed again.
        expect((since.match(/\{/g) ?? []).length - 1).toBe((since.match(/\}/g) ?? []).length);
      }
    });

    it('the card is opaque with an alpha test', () => {
      const m = plantCardMaterial(t, 1024, 1024, stub(), viewTowardUniform(), makeSight(), seeUniforms(), mask, makePlantShared());
      expect(m.transparent).toBe(false);
      expect(m.alphaTest).toBe(0.5);
    });

    it('the trunk caster is depth only: the page alpha, no colour, no sight step', () => {
      const m = plantTrunkMaterial(t, 1024, 1024, makeSunLight(), makePlantShared());
      expect(m.colorWrite).toBe(false);
      const code = fragment(B, m);
      expect(code).not.toContain('sightMode');
      expect([...code.matchAll(B === WGSLNodeBuilder ? /textureSample\(/g : /texture\(/g)]).toHaveLength(1);
    });

    it('the disc caster is depth only and reads no texture', () => {
      const m = plantDiscMaterial(makeSunLight(), makePlantShared());
      expect(m.colorWrite).toBe(false);
      const code = fragment(B, m);
      expect(code).not.toContain('sightMode');
      expect([...code.matchAll(B === WGSLNodeBuilder ? /textureSample\(/g : /texture\(/g)]).toHaveLength(0);
    });
  });
}
