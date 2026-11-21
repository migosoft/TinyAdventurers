// The sharp-bilinear copy's formula, in code and as shader (#376).
import { describe, expect, it } from 'vitest';
import { DataTexture, GLSLNodeBuilder, NodeMaterial, RGBAFormat, WGSLNodeBuilder } from 'three/webgpu';
import { sharpCopyNode, sharpTexel } from './sharpCopy';
import { fragment, type Builder } from './shaderCode.testutil';

describe('sharpTexel', () => {
  it('gives the texel centre at the canvas pixel centres of a whole scale', () => {
    for (const s of [1, 2, 3]) {
      for (let k = 0; k < 3 * s; k++) {
        const t = (k + 0.5) / s;
        expect(sharpTexel(t, s) - Math.floor(t)).toBeCloseTo(0.5, 6);
      }
    }
  });

  it('blends only near the texel edge at s = 5/3 and never goes backwards', () => {
    const s = 5 / 3;
    for (const fr of [0.3, 0.4, 0.5, 0.6, 0.7]) expect(sharpTexel(2 + fr, s) - 2).toBeCloseTo(0.5, 6);
    const near = sharpTexel(2.95, s) - 2;
    expect(near).toBeGreaterThan(0.5);
    expect(near).toBeLessThan(1);
    let last = -Infinity;
    for (let t = 0; t <= 3; t += 0.01) {
      const v = sharpTexel(t, s);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
  });

  it('treats a scale below 1 as 1 (plain linear)', () => {
    for (const t of [0.1, 0.5, 1.3, 2.9]) expect(sharpTexel(t, 0.8)).toBeCloseTo(t, 6);
  });
});

describe('sharpCopyNode', () => {
  for (const [name, B] of [['GLSL', GLSLNodeBuilder], ['WGSL', WGSLNodeBuilder]] as [string, Builder][]) {
    it(`builds as ${name}`, () => {
      const m = new NodeMaterial();
      m.fragmentNode = sharpCopyNode(new DataTexture(new Uint8Array(16), 2, 2, RGBAFormat)).node;
      expect(fragment(B, m)).toContain('clamp');
    });
  }
});
