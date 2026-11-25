import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder, type Vector4 } from 'three/webgpu';
import { float, positionGeometry, positionLocal, vec2, vec3, vec4 } from 'three/tsl';
import { brushNode, gustNode, makeBrushUniforms, setBrushers, swayNode } from './windNodes';
import { BRUSH, type Brusher } from './brush';
import { SWAY_WAVE } from './wind';
import { fragment, loops, vertex, type Builder } from './shaderCode.testutil';

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

describe('the brush node', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: builds in the vertex stage with one loop and the CPU formula's numbers`, () => {
      const m = new MeshBasicNodeMaterial();
      m.positionNode = positionGeometry.add(brushNode(makeBrushUniforms(), positionGeometry.xz, float(1), vec2(0)));
      const code = vertex(B, m);
      expect(loops(code)).toHaveLength(1);
      const numbers = new Set((code.match(/\d+\.\d+|\b\d+\b/g) ?? []).map(Number));
      for (const n of [BRUSH.rate * 2 * Math.PI, BRUSH.max]) expect(numbers.has(n), `${B.name} lacks ${n}`).toBe(true);
    });
  }
});

describe('the brush uniforms', () => {
  const rec = (i: number): Brusher => ({ x: i + 1, z: i + 2, reach: 0.5, strength: 0.75, dx: 1, dz: 0, tail: 0.25 });
  it('writes the records and the count', () => {
    const u = makeBrushUniforms();
    setBrushers(u, [rec(0), rec(1), rec(2)], 1.5);
    expect(u.n.value).toBe(3);
    expect(u.t.value).toBe(1.5);
    const a = u.a.array[0] as Vector4;
    expect([a.x, a.y, a.z, a.w]).toEqual([1, 2, 0.5, 0.75]);
  });
  it('keeps at most BRUSH.cap records', () => {
    const u = makeBrushUniforms();
    setBrushers(u, Array.from({ length: 20 }, (_, i) => rec(i)), 0);
    expect(u.n.value).toBe(BRUSH.cap);
  });
  it('is empty with no brushers', () => {
    const u = makeBrushUniforms();
    setBrushers(u, [rec(0)], 0);
    setBrushers(u, [], 0);
    expect(u.n.value).toBe(0);
  });
});
