// A torch on a cut wall is hidden (#347): both materials' vertex code reads the cut's uniforms, on both builders.
import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DataTexture, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { viewTowardUniform, worldMaterial } from '../materials';
import { makeSight } from '../sightNodes';
import { vertex, type Builder } from '../shaderCode.testutil';
import { makeCoverShared } from '../cover/coverNodes';
import { makeSheets } from '../stone/sheets';
import { unplanned } from '../stone/plan';
import { flameMaterial, holderMaterial } from './torchNodes';

const geometryOf = (attrs: [string, number][]) => {
  const g = new BufferGeometry();
  for (const [n, s] of attrs) g.setAttribute(n, new BufferAttribute(new Float32Array(6 * s), s));
  return g;
};
const HOLDER: [string, number][] = [['position', 3], ['normal', 3], ['colour', 3], ['warm', 1], ['foot', 4]];
const FLAME: [string, number][] = [['position', 3], ['flame', 4], ['reach', 2], ['foot', 4]];

describe('wall torches on a cut wall (#347)', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the vertex stage of the holder and the flame reads the cut's uniforms`, () => {
      const t = new Texture(), sight = makeSight();
      const l = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture());
      const wm = worldMaterial(l, t, t, sight, makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1)), makeSheets(unplanned(), { size: 4096, layers: 256 }));
      const holder = holderMaterial(l, sight, wm.cut, wm.see);
      const flame = flameMaterial(sight, viewTowardUniform(), wm.cut, wm.see).material;
      for (const [m, attrs] of [[holder, HOLDER], [flame, FLAME]] as const) {
        const code = vertex(B, m, { geometry: geometryOf([...attrs]) });
        for (const n of ['cutTarget', 'cutOn', 'cutLine', 'cutRamp']) expect(code).toContain(n);
      }
    });
  }
});
