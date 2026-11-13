import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder } from 'three/webgpu';
import { float, positionLocal, vec2, vec4 } from 'three/tsl';
import { swayNode } from './windNodes';
import { fragment, type Builder } from './shaderCode.testutil';

describe('the sway node', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: builds`, () => {
      const m = new MeshBasicNodeMaterial();
      const off = swayNode(vec2(1, 2), positionLocal.y, float(2), float(0.11), float(3), float(1));
      m.colorNode = vec4(off, 1);
      expect(fragment(B, m).length).toBeGreaterThan(0);
    });
  }
});
