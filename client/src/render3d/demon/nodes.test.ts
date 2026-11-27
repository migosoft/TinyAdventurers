import { describe, expect, it } from 'vitest';
import { DataTexture, DoubleSide, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { fragment, readsInBranches, vertex, type Builder } from '../shaderCode.testutil';
import { makeFigureShared } from '../models/nodes';
import { buildDemonSkin } from './body';
import { SKIN_PARTS } from './layer';
import { demonMaterials } from './nodes';
import { BufferAttribute, BufferGeometry } from 'three/webgpu';

function make(kind: 'fire' | 'ice' = 'fire') {
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
  return demonMaterials({ lighting, sight: makeSight(), shared: makeFigureShared(), kind });
}

/** A geometry with the streams of a skin part, as the layer makes them. */
function geometryOf(k: (typeof SKIN_PARTS)[number], skin = buildDemonSkin(0.2)): BufferGeometry {
  const p = skin[k], g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p.position, 3));
  g.setAttribute('normal', new BufferAttribute(p.normal, 3));
  g.setAttribute('info', new BufferAttribute(p.info, 4));
  if (p.uv) g.setAttribute('uv', new BufferAttribute(p.uv, 2));
  g.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from(p.skinIndex), 4));
  g.setAttribute('skinWeight', new BufferAttribute(p.skinWeight, 4));
  g.setIndex(new BufferAttribute(p.index, 1));
  return g;
}

describe('the demon material', () => {
  it('is opaque, cut by alpha and two-sided (the webbing and the cloth)', () => {
    const m = make();
    expect(m.mat.side).toBe(DoubleSide);
    expect(m.mat.transparent).toBe(false);
    expect(m.mat.depthWrite).toBe(true);
    expect(m.mat.alphaTest).toBe(0.5);
    expect(m.bones.array.length).toBe(88);
    m.dispose();
  });

  for (const [name, B] of [['GLSL', GLSLNodeBuilder], ['WGSL', WGSLNodeBuilder]] as [string, Builder][]) {
    describe(name, () => {
      it('every material builds in GLSL and in WGSL; the uniform buffer stays within WebGPU\'s limit', () => {
        const skin = buildDemonSkin(0.2);
        for (const kind of ['fire', 'ice'] as const) {
          const m = make(kind);
          for (const k of SKIN_PARTS) {
            const g = geometryOf(k, skin);
            const f = fragment(B, m.mat, { compare: true, geometry: g }), v = vertex(B, m.mat, { compare: true, geometry: g });
            expect(v.length).toBeGreaterThan(0);
            expect(f).toMatch(/lightAmbient/);
            // the lighting's own lava read under its `darkOnly` switch (a uniform of this material) is the only read the heuristic reports; the lich's has it too
            expect(readsInBranches(f).length).toBeLessThanOrEqual(1);
            expect(f.length).toBeLessThan(45000);
            // the bones are an array of 88 matrices in a uniform buffer (88 x 64 bytes, WebGPU's limit is 64 KiB), not a texture
            if (B === WGSLNodeBuilder) expect(v).toMatch(/array< mat4x4<f32>, 88 >/);
            expect(v).toMatch(/skinIndex/);
            expect(v).toMatch(/skinWeight/);
          }
          m.dispose();
        }
        expect(88 * 16 * 4).toBeLessThan(65536);
      });
    });
  }
});
