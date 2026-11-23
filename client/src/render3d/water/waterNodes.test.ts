// The water's and the ceiling's shader code as three generates it (GLSL and WGSL), built without a GPU (#345).
import { describe, expect, it, vi } from 'vitest';
import { DataTexture, GLSLNodeBuilder, Matrix4, Texture, WGSLNodeBuilder, type NodeMaterial } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { viewTowardUniform } from '../materials';
import { fragment, loops, readsInBranches, type Builder } from '../shaderCode.testutil';
import { OUTLINE_EDGE, WATER_LEVEL } from '../dips/shape';
import { PUDDLE_LEVEL } from '../stone/shape';
import { PUDDLE_GATE, ceilingMaterial, waterMaterial, type WaterMaterial } from './waterNodes';

const lighting = () => makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture());
const water = (): WaterMaterial => waterMaterial(lighting(), makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform());
const both = (): [string, NodeMaterial][] => [['water', water().material], ['ceiling', ceilingMaterial(lighting(), makeSight())]];

describe('the water and ceiling materials', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: both build, and building logs no TSL error`, () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (const [name, m] of both()) expect(fragment(B, m).length, name).toBeGreaterThan(100);
        expect(err).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        err.mockRestore();
        warn.mockRestore();
      }
    });

    it(`${B.name}: uses no sine hash`, () => {
      for (const [name, m] of both()) expect(fragment(B, m), name).not.toContain('43758');
    });

    it(`${B.name}: reads no texture and no derivative in a branch`, () => {
      for (const [name, m] of both()) expect(readsInBranches(fragment(B, m)), name).toEqual([]);
    });

    it(`${B.name}: the water keeps its loops apart`, () => {
      const ls = loops(fragment(B, water().material));
      const names = new Set(ls.map((l) => l.name));
      // The ripples (three evaluations of the surface height), the light's loops and the glints'.
      for (const n of ['rp', 'li', 'cs', 'ws', 'gl', 'gc']) expect(names.has(n), n).toBe(true);
      expect(ls.filter((l) => l.name === 'rp').length).toBe(3);
      // No loop sits inside a loop of its own name, and a ripple loop sits in none.
      for (const l of ls) expect(l.outer, l.name).not.toContain(l.name);
      for (const l of ls.filter((x) => x.name === 'rp')) expect(l.outer).toEqual([]);
    });

    it(`${B.name}: only a puddle's sheet gets the ring sheen (#380)`, () => {
      // the gate lies above a pool's sheet and not above a puddle's, and the shader steps on the surface's own height with it
      expect(PUDDLE_GATE).toBeGreaterThan(WATER_LEVEL);
      expect(PUDDLE_GATE).toBeLessThanOrEqual(PUDDLE_LEVEL);
      const w = fragment(B, water().material);
      const gate = `${PUDDLE_GATE}`.replace('.', '\\.');
      expect(w).toMatch(new RegExp(`step\\(\\s*${gate}\\s*,\\s*\\w+\\.y\\s*\\)`));
      expect((w.match(new RegExp(gate, 'g')) ?? []).length).toBe(1);
    });

    it(`${B.name}: the water discards outside the pool's outline`, () => {
      // Every material holds the sight clip's discard; only the water adds the alpha test's (`DiffuseColor.w <= alphaTest`).
      const alphaTest = /if\s*\(\s*\(\s*DiffuseColor\.w\s*<=\s*[\w.]+\s*\)\s*\)\s*\{\s*discard/;
      const discards = (code: string): number => (code.match(/\bdiscard\b/g) ?? []).length;
      const w = fragment(B, water().material);
      const c = fragment(B, ceilingMaterial(lighting(), makeSight()));
      expect(w).toMatch(alphaTest);
      // ... and the alpha it tests is the outline mask: `step(OUTLINE_EDGE, <the field's second channel>)`.
      expect(w).toMatch(new RegExp(`DiffuseColor\\s*=\\s*vec4(?:<f32>)?\\(.*step\\(\\s*${OUTLINE_EDGE}\\s*,\\s*\\w+\\.y\\s*\\)\\s*\\)`));
      expect(c).not.toMatch(alphaTest);
      expect(discards(w)).toBe(discards(c) + 1);
    });
  }

  it('stays within the uniform buffers of a WebGPU fragment stage', () => {
    for (const [name, m] of both()) expect((fragment(WGSLNodeBuilder, m).match(/var<uniform>/g) ?? []).length, name).toBeLessThanOrEqual(12);
  });

  it('reads no caster (the walls shadow the water, cards do not)', () => {
    // The world material's light carries three caster arrays more than the water's.
    const count = (m: NodeMaterial): number => (fragment(WGSLNodeBuilder, m).match(/var<uniform>/g) ?? []).length;
    const l = lighting();
    const build = (lit: typeof l): NodeMaterial => waterMaterial(lit, makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform()).material;
    const full = build({ ...l, lightAt: (p, n, w, o) => l.lightAt(p, n, w, { ...o, shadow: 'full' }) });
    expect(count(full) - count(build(l))).toBe(3);
  });

  it('has no mirror term without a mirror', () => {
    const w = water();
    expect(w.mirrorOn.value).toBe(0);
    w.setMirror({ picture: new Texture(), matrix: new Matrix4() });
    expect(w.mirrorOn.value).toBe(1);
    w.setMirror(null);
    expect(w.mirrorOn.value).toBe(0);
  });

  it('takes the packed ripples and clears them', () => {
    const w = water();
    const packed = new Float32Array(64).fill(-1);
    packed.set([3, 4, 0.5, 1.6], 4);
    w.setRipples(packed);
    expect(w.ripples.length).toBe(16);
    expect(w.ripples[1].toArray()).toEqual([3, 4, 0.5, 1.6].map(Math.fround));
    w.ripples.forEach((v, i) => { if (i !== 1) expect(v.z, `slot ${i}`).toBe(-1); });
    w.setRipples(null);
    w.ripples.forEach((v, i) => expect(v.z, `slot ${i}`).toBe(-1));
  });
});
