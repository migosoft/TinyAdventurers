import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder } from 'three/webgpu';
import { positionWorld, vec3, vec4 } from 'three/tsl';
import { makeSight } from './sightNodes';
import { fragment, type Builder } from './shaderCode.testutil';

describe('the sight nodes', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: a material ending in the sight step builds`, () => {
      const sight = makeSight();
      const m = new MeshBasicNodeMaterial();
      m.colorNode = sight.apply(vec3(1), positionWorld, sight.unseenAt(positionWorld.xz));
      const code = fragment(B, m);
      expect(code).toContain('sightMode');
      expect(code).toContain('sightOrigin');
      // The mask's texture node is named `sightMask`, but three does not write a texture's name into the code: its sampler is `nodeUniformN`.
      expect(code).toMatch(B === WGSLNodeBuilder ? /texture_2d<f32>/ : /uniform sampler2D/);
      sight.dispose();
    });
  }

  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the mask is sampled once, outside any if, for apply and shown together`, () => {
      const sight = makeSight();
      const m = new MeshBasicNodeMaterial();
      const u = sight.unseenAt(positionWorld.xz);
      m.colorNode = vec4(sight.apply(vec3(1), positionWorld, u), sight.shown(u.x, 0));
      const code = fragment(B, m);
      const call = B === WGSLNodeBuilder ? /textureSample\(/g : /texture\(/g;
      const hits = [...code.matchAll(call)];
      expect(hits).toHaveLength(1);
      // Top level of main(): every block opened since main began (three's own uniform flipY if/else) is closed again.
      const main = code.slice(0, hits[0].index);
      const since = main.slice(Math.max(main.lastIndexOf('void main'), main.lastIndexOf('fn main')));
      expect((since.match(/\{/g) ?? []).length - 1).toBe((since.match(/\}/g) ?? []).length);
    });
  }
});
