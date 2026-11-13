import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder } from 'three/webgpu';
import { positionWorld, vec3 } from 'three/tsl';
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
});
