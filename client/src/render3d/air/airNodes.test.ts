// The air's shader code as three generates it (GLSL and WGSL), built without a GPU (#307).
import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DataTexture, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { viewTowardUniform } from '../materials';
import { makeSight } from '../sightNodes';
import { fragment, vertex, type Builder } from '../shaderCode.testutil';
import { airMaterials } from './airNodes';

function geometry(attrs: [string, number][]): BufferGeometry {
  const g = new BufferGeometry();
  for (const [n, s] of attrs) g.setAttribute(n, new BufferAttribute(new Float32Array(6 * s), s));
  return g;
}
const AIR_ATTRS: [string, number][] = [['position', 3], ['corner', 2], ['size', 2], ['rgba', 4], ['kind', 1], ['sightXZ', 2]];
const HAZE_ATTRS: [string, number][] = [['position', 3], ['sheet', 4]];

function build(sun: boolean) {
  const heights = new DataTexture(new Uint8Array(12), 4, 3);
  const lighting = makeLighting(heights, { w: 4, h: 3 }, new Texture(), { sun });
  return airMaterials(lighting, makeSight(), { sun, toward: viewTowardUniform() });
}

describe('airMaterials', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    for (const sun of [false, true]) {
      it(`${B.name}${sun ? ' with sun' : ''}: the three materials build and end with the sight step`, () => {
        const a = build(sun);
        for (const [name, m, attrs] of [['add', a.add, AIR_ATTRS], ['blend', a.blend, AIR_ATTRS], ['haze', a.haze, HAZE_ATTRS]] as const) {
          const code = fragment(B, m, { geometry: geometry([...attrs]) });
          expect(code, name).toContain('sightMode');
          expect(vertex(B, m, { geometry: geometry([...attrs]) }).length, name).toBeGreaterThan(0);
        }
      });
    }

    it(`${B.name}: the haze keeps the wall walk but not the card or sun-ray walks, the smoke keeps all`, () => {
      const a = build(false);
      const loopNames = (m: typeof a.haze, attrs: [string, number][]): string[] =>
        [...fragment(B, m, { geometry: geometry(attrs) }).matchAll(/\bfor\s*\(\s*(?:int|var)\s+(\w+)/g)].map((x) => x[1]);
      expect(loopNames(a.haze, HAZE_ATTRS)).toContain('ws');
      expect(loopNames(a.haze, HAZE_ATTRS)).not.toContain('ss');
      expect(loopNames(a.haze, HAZE_ATTRS)).toContain('li');
      expect(loopNames(a.blend, AIR_ATTRS)).toContain('ws');
    });

    it(`${B.name}: each reads the sight mask once, at the top level`, () => {
      const a = build(false);
      for (const [name, m, attrs] of [['add', a.add, AIR_ATTRS], ['blend', a.blend, AIR_ATTRS], ['haze', a.haze, HAZE_ATTRS]] as const) {
        const code = fragment(B, m, { geometry: geometry([...attrs]) });
        // The mask's coordinate is built from `sightOrigin` once per read of the texture.
        const reads = code.match(/sightOrigin\.xy/g);
        expect(reads?.length ?? 0, name).toBe(1);
        const at = code.indexOf('sightOrigin.xy');
        const since = code.slice(Math.max(code.lastIndexOf('void main'), code.lastIndexOf('fn main')), at);
        expect((since.match(/\{/g) ?? []).length - 1, name).toBe((since.match(/\}/g) ?? []).length);
      }
    });

    it(`${B.name}: the speck shader subtracts the ambient uniform`, () => {
      const a = build(false);
      const code = fragment(B, a.add, { geometry: geometry(AIR_ATTRS) });
      expect(code).toContain('lightAmbient');
    });
  }
});
