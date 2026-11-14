import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder } from 'three/webgpu';
import { float, positionLocal, vec2, vec3, vec4 } from 'three/tsl';
import { gustNode, swayNode } from './windNodes';
import { SWAY_WAVE } from './wind';
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

describe('the sway node and the CPU sway', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the shader carries the CPU wave's terms and frequencies`, () => {
      const m = new MeshBasicNodeMaterial();
      m.colorNode = vec4(swayNode(vec2(1, 2), positionLocal.y, float(2), float(0.11), float(3), float(1)), 1);
      const numbers = new Set((fragment(B, m).match(/\d+\.\d+|\b\d+\b/g) ?? []).map(Number));
      // The wave's three weights (the bound in forest.ts relies on their sum) and the frequencies and offsets of wind.ts's `sway` and `gust`.
      for (const n of [SWAY_WAVE.slow, SWAY_WAVE.fast, SWAY_WAVE.gust, 1.3, 0.9, 0.4, 2.9, 0.33, 0.3, 1.5, 6]) expect(numbers.has(n), `${B.name} lacks ${n}`).toBe(true);
    });
  }
});

describe('the gust node', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: builds`, () => {
      const m = new MeshBasicNodeMaterial();
      m.colorNode = vec4(vec3(gustNode(vec2(1, 2), float(3))), 1);
      expect(fragment(B, m).length).toBeGreaterThan(0);
    });
  }
});
