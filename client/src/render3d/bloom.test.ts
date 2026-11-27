import { describe, expect, it } from 'vitest';
import { DataTexture, GLSLNodeBuilder, NodeMaterial, RGBAFormat, WGSLNodeBuilder } from 'three/webgpu';
import { texture, uv, vec4 } from 'three/tsl';
import { BLOOM, bloomPresent, pressedJs } from './bloom';
import { fragment, type Builder } from './shaderCode.testutil';

describe('pressed', () => {
  it('pressed() leaves a colour within 0..1 alone and keeps the hue of a brighter one', () => {
    expect(pressedJs([0.5, 0.2, 0.1])).toEqual([0.5, 0.2, 0.1]);
    expect(pressedJs([2, 1, 0.5])).toEqual([1, 0.5, 0.25]);
  });
  it('has the spike\'s settings', () => {
    expect(BLOOM).toEqual({ strength: 0.4, radius: 0.4, threshold: 1.0 });
  });
});

describe('the present material', () => {
  const tex = (): DataTexture => new DataTexture(new Uint8Array(16), 2, 2, RGBAFormat);
  for (const [name, B] of [['GLSL', GLSLNodeBuilder], ['WGSL', WGSLNodeBuilder]] as [string, Builder][]) {
    it(`the present material builds in ${name} with and without bloom`, () => {
      const plain = new NodeMaterial();
      plain.fragmentNode = texture(tex(), uv());
      const without = fragment(B, plain);
      const withB = new NodeMaterial();
      const input = texture(tex());
      withB.fragmentNode = bloomPresent(vec4(texture(tex(), uv())), input).node;
      const code = fragment(B, withB);
      expect(code.length).toBeGreaterThan(without.length);
      // the colour is pressed by its largest channel, and the bloom's glow is a second texture read
      expect(code).toMatch(/max\(/);
      expect([...code.matchAll(/\b(?:textureSample|texture)\(/g)].length).toBeGreaterThan([...without.matchAll(/\b(?:textureSample|texture)\(/g)].length);
    });
  }
});
