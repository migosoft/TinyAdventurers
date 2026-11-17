// The lava's and the shimmer's shader code as three generates it (GLSL and WGSL), built without a GPU (#344).
import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, GLSLNodeBuilder, Texture, WGSLNodeBuilder, type NodeMaterial } from 'three/webgpu';
import { makeSight } from '../sightNodes';
import { viewTowardUniform } from '../materials';
import { fragment, readsInBranches, vertex, type Builder } from '../shaderCode.testutil';
import { OUTLINE_EDGE } from '../dips/shape';
import { BUBBLE_CAP } from './bubbles';
import { STIR_CAP } from './lava';
import { lavaMaterial, shimmerMaterial, type LavaMaterial, type ShimmerMaterial } from './lavaNodes';

const lava = (): LavaMaterial => lavaMaterial(makeSight());
const shimmer = (): ShimmerMaterial => shimmerMaterial(makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform());

/** The lava surface's vertex layout (lavaMesh.ts); the builders read the attributes from the geometry. */
function lavaGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(18), 3));
  g.setAttribute('shore', new BufferAttribute(new Float32Array(12), 2));
  return g;
}
const both = (): [string, NodeMaterial, BufferGeometry | undefined][] => [['lava', lava().material, lavaGeometry()], ['shimmer', shimmer().material, undefined]];
const lavaCode = (B: Builder): string => fragment(B, lava().material, { geometry: lavaGeometry() });

/** Each `for` loop's index name and the names of the loops around it (by brace depth), as in waterNodes.test.ts. */
function loops(code: string): { name: string; outer: string[] }[] {
  const out: { name: string; outer: string[] }[] = [];
  const open: { name: string; depth: number }[] = [];
  let depth = 0;
  for (const line of code.split('\n')) {
    const m = /\bfor\s*\(\s*(?:int|var)\s+(\w+)/.exec(line);
    if (m) {
      out.push({ name: m[1], outer: open.map((o) => o.name) });
      open.push({ name: m[1], depth });
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        while (open.length && open[open.length - 1].depth >= depth) open.pop();
      }
    }
  }
  return out;
}

/** How often each sampler is read in the code, most first. */
function samples(code: string): number[] {
  const by = new Map<string, number>();
  for (const m of code.matchAll(/\b(?:textureSample\w*|texture)\s*\(\s*(\w+)/g)) by.set(m[1], (by.get(m[1]) ?? 0) + 1);
  return [...by.values()].sort((a, b) => b - a);
}

const discards = (code: string): number => (code.match(/\bdiscard\b/g) ?? []).length;

describe('the lava and shimmer materials', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: both build, and building logs no TSL error`, () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (const [name, m, geometry] of both()) {
          expect(fragment(B, m, { geometry }).length, name).toBeGreaterThan(100);
          expect(vertex(B, m, { geometry }).length, name).toBeGreaterThan(100);
        }
        expect(err).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        err.mockRestore();
        warn.mockRestore();
      }
    });

    it(`${B.name}: uses no sine hash`, () => {
      for (const [name, m, geometry] of both()) {
        for (const code of [fragment(B, m, { geometry }), vertex(B, m, { geometry })]) {
          expect(code, name).not.toContain('43758');
          expect(code, name).not.toMatch(/fract\s*\(\s*\(?\s*sin\s*\(/);
        }
      }
    });

    it(`${B.name}: reads no texture and no derivative in a branch`, () => {
      for (const [name, m, geometry] of both()) expect(readsInBranches(fragment(B, m, { geometry })), name).toEqual([]);
    });

    it(`${B.name}: the lava names its loops apart`, () => {
      const ls = loops(lavaCode(B));
      const count = (n: string): number => ls.filter((l) => l.name === n).length;
      // The Voronoi's 3 by 3 search, the stirs' rings and the bubbles; the dome's loop belongs to the vertex stage.
      for (const n of ['vj', 'vi', 'st', 'bb']) expect(count(n), n).toBe(1);
      expect(count('bv')).toBe(0);
      for (const l of ls) expect(l.outer, l.name).toEqual(l.name === 'vi' ? ['vj'] : []);
      const vs = loops(vertex(B, lava().material, { geometry: lavaGeometry() }));
      expect(vs.map((l) => l.name)).toEqual(['bv']);
    });

    it(`${B.name}: the lava holds the outline discard and the sight step, and no light loop`, () => {
      const code = lavaCode(B);
      // The alpha test's discard (`DiffuseColor.w <= alphaTest`) next to the sight clip's ...
      expect(code).toMatch(/if\s*\(\s*\(\s*DiffuseColor\.w\s*<=\s*[\w.]+\s*\)\s*\)\s*\{\s*discard/);
      expect(discards(code)).toBe(2);
      // ... and the alpha it tests is the outline mask: `step(OUTLINE_EDGE, <the shore attribute's first value>)`.
      expect(code).toMatch(new RegExp(`DiffuseColor\\s*=\\s*vec4(?:<f32>)?\\(.*step\\(\\s*${OUTLINE_EDGE}\\s*,\\s*[\\w.]+\\.x\\s*\\)\\s*\\)`));
      expect(code).toContain('sightMode');
      expect(code).toContain('sightOrigin');
      // It glows by itself: no light list, no light loop, and the sight mask is its one texture.
      expect(code).not.toContain('lightAmbient');
      expect(loops(code).map((l) => l.name)).not.toContain('li');
      expect(samples(code)).toEqual([1]);
    });

    it(`${B.name}: the shimmer samples the lava light four times and the copy once, and discards nothing`, () => {
      const code = fragment(B, shimmer().material);
      // The lava light at four heights of the view ray, the scene copy and the sight mask.
      expect(samples(code)).toEqual([4, 1, 1]);
      // Its colour is the scene copy, which went through the sight step; the mask only scales its strength.
      expect(code).toContain('sightOrigin');
      // With the sight off everything is seen, so the mode is read too.
      expect(code).toContain('sightMode');
      expect(discards(code)).toBe(0);
      expect(loops(code)).toEqual([]);
    });
  }

  it('stays within the uniform buffers of a WebGPU fragment stage', () => {
    for (const [name, m, geometry] of both()) expect((fragment(WGSLNodeBuilder, m, { geometry }).match(/var<uniform>/g) ?? []).length, name).toBeLessThanOrEqual(12);
  });

  it('the lava is opaque and writes depth; the shimmer blends, tests depth and writes none', () => {
    const l = lava().material, s = shimmer().material;
    expect([l.transparent, l.depthTest, l.depthWrite, l.alphaTest]).toEqual([false, true, true, 0.5]);
    expect([s.transparent, s.depthTest, s.depthWrite]).toEqual([true, true, false]);
  });

  it('setBubbles and setStirs fill the slots; null empties them', () => {
    const l = lava();
    expect(l.bubbles.length).toBe(BUBBLE_CAP);
    expect(l.stirs.length).toBe(STIR_CAP);
    l.bubbles.forEach((v, i) => expect(v.z, `bubble ${i}`).toBe(-1));
    l.stirs.forEach((v, i) => expect(v.z, `stir ${i}`).toBe(0));

    const bubbles = new Float32Array(BUBBLE_CAP * 4);
    for (let i = 0; i < BUBBLE_CAP; i++) bubbles[i * 4 + 2] = -1;
    bubbles.set([3, 4, 0.5, 0.25], 4);
    l.setBubbles(bubbles);
    expect(l.bubbles[1].toArray()).toEqual([3, 4, 0.5, 0.25].map(Math.fround));
    l.bubbles.forEach((v, i) => { if (i !== 1) expect(v.z, `bubble ${i}`).toBe(-1); });
    l.setBubbles(null);
    l.bubbles.forEach((v, i) => expect(v.z, `bubble ${i}`).toBe(-1));

    const stirs = new Float32Array(STIR_CAP * 4);
    stirs.set([5, 6, 0.75, 0], 8);
    l.setStirs(stirs);
    expect(l.stirs[2].toArray()).toEqual([5, 6, 0.75, 0]);
    l.stirs.forEach((v, i) => { if (i !== 2) expect(v.z, `stir ${i}`).toBe(0); });
    l.setStirs(null);
    l.stirs.forEach((v, i) => expect(v.z, `stir ${i}`).toBe(0));
  });

  it('the shimmer takes the scene copy', () => {
    const s = shimmer();
    expect(() => s.setScene(new Texture())).not.toThrow();
    s.time.value = 2;
    expect(s.time.value).toBe(2);
  });
});
