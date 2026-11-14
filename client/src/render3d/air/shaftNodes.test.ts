// The shaft pass's shader code as three generates it (GLSL and WGSL), built without a GPU (#307).
import { describe, expect, it } from 'vitest';
import { DataTexture, DepthTexture, FloatType, GLSLNodeBuilder, Matrix4, RGBAFormat, Texture, Vector2, Vector3, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { fragment, type Builder } from '../shaderCode.testutil';
import { makeShaftPass } from './shaftNodes';
import { SHAFT_GAIN, SHAFT_STEPS } from './shafts';

function pass() {
  const tex = (): DataTexture => new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
  return makeShaftPass(makeLighting(tex(), { w: 4, h: 4 }, tex()), makeSight());
}

describe('the shaft pass', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the march builds with its two loops under their own names, the cracks loop inside the march`, () => {
      const p = pass();
      const code = fragment(B, p.march);
      const open = B === WGSLNodeBuilder ? /\bfor\s*\(\s*var\s+(\w+)/g : /\bfor\s*\(\s*int\s+(\w+)/g;
      const names = [...code.matchAll(open)].map((m) => m[1]);
      expect(names).toContain('sm');
      expect(names).toContain('ss');
      expect(names.indexOf('sm')).toBeLessThan(names.indexOf('ss'));
      expect(code).toContain(String(SHAFT_STEPS));
      p.dispose();
    });

    it(`${B.name}: no time or frame uniform reaches the march (the offset is fixed per pixel)`, () => {
      const p = pass();
      const code = fragment(B, p.march);
      expect(code).not.toMatch(/\btime\b|frameId|deltaTime|frameGroup|uFrame/i);
      p.dispose();
    });

    it(`${B.name}: the pre-pass depth is sampled once, outside any branch or loop`, () => {
      const p = pass();
      const code = fragment(B, p.march);
      // The depth is the first texture the shader reads (GLSL: a plain sampler; WGSL: the one depth texture).
      const name = B === WGSLNodeBuilder ? /var\s+(\w+)\s*:\s*texture_depth_2d/.exec(code)?.[1] : /\btexture\(\s*(\w+)/.exec(code)?.[1];
      expect(name).toBeTruthy();
      const reads = [...code.matchAll(new RegExp(`\\b(?:texture|textureLoad|textureSample\\w*)\\(\\s*${name}\\b`, 'g'))].filter((m) => !/^\s*var/.test(code.slice(m.index! - 4, m.index)));
      expect(reads).toHaveLength(1);
      // Before the first loop, and at the depth of the main function's own body: no branch around it.
      const before = code.slice(0, reads[0].index);
      expect(before).not.toMatch(/\bfor\s*\(/);
      const since = before.slice(Math.max(before.lastIndexOf('void main'), before.lastIndexOf('fn main')));
      expect((since.match(/\{/g) ?? []).length - 1).toBe((since.match(/\}/g) ?? []).length);
      p.dispose();
    });

    it(`${B.name}: the composite builds and reads the shaft texture five times (the centre and four diagonals)`, () => {
      const p = pass();
      const code = fragment(B, p.composite);
      const reads = [...code.matchAll(/\btexture\w*\(\s*\w+/g)];
      expect(reads).toHaveLength(5);
      p.dispose();
    });
  }

  it('the composite adds: one-one blending, no depth test or write', () => {
    const p = pass();
    expect(p.composite.depthTest).toBe(false);
    expect(p.composite.depthWrite).toBe(false);
    expect(p.composite.blendSrc).toBe(p.composite.blendDst);
    p.dispose();
  });

  it('set takes the frame: the gain is a named constant and the uniforms follow', () => {
    expect(SHAFT_GAIN).toBe(0.11);
    const p = pass();
    p.set({ depth: new DepthTexture(2, 2), shaft: new Texture(), projInv: new Matrix4(), camWorld: new Matrix4(), toward: new Vector3(0, 1, 0), top: 3, uvScale: new Vector2(1, 1), texel: new Vector2(0.5, 0.5) });
    p.dispose();
  });
});
