import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, Vector3, WGSLNodeBuilder, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three/webgpu';
import { float, positionWorld, vec4 } from 'three/tsl';
import { fitSunMap, sky, sunCoord, type Vec3 } from './sun';
import { makeSunLight, sunCamera, sunDepthTexture } from './sunNodes';
import { fragment, type Builder } from './shaderCode.testutil';

const footprint = { x0: 10, x1: 42, z0: 8, z1: 30 };
const points: Vec3[] = [[10, 0, 8], [42, 0, 30], [20, 3, 15], [30.5, 9.2, 22.1], [25, 10, 25], [12.25, 1.5, 29]];

describe('sunCamera', () => {
  for (const hour of [6.5, 9.5, 13, 18.5, 23]) {
    for (const [name, system] of [['WebGL', WebGLCoordinateSystem], ['WebGPU', WebGPUCoordinateSystem]] as const) {
      it(`${name}: projects a point to sunCoord's u, v and depth at ${hour} h`, () => {
        const fit = fitSunMap(sky(hour).dir, footprint, { w: 64, h: 48 }, 2048);
        const cam = sunCamera(fit);
        cam.coordinateSystem = system;
        cam.updateProjectionMatrix();
        for (const p of points) {
          const ndc = new Vector3(...p).project(cam);
          const c = sunCoord(fit, p);
          expect(ndc.x).toBeCloseTo(2 * c.u - 1, 5);
          expect(ndc.y).toBeCloseTo(2 * c.v - 1, 5);
          // three's orthographic depth is linear: -1..1 in WebGL's clip space, 0..1 in WebGPU's.
          expect(system === WebGLCoordinateSystem ? (ndc.z + 1) / 2 : ndc.z).toBeCloseTo(c.depth, 5);
        }
      });
    }
  }
});

/** The fragment of a material that is just the sun's term at the world position. */
function termFragment(B: Builder, compare: boolean): string {
  const sun = makeSunLight();
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sun.term(positionWorld, positionWorld, float(1)), 1);
  return fragment(B, m, { compare });
}

describe('the sun term', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) for (const compare of [true, false]) {
    it(`${B.name}, ${compare ? 'compared by the sampler' : 'compared by a step'}: builds, with the depth texture read once at the top level`, () => {
      const code = termFragment(B, compare);
      const call = B === WGSLNodeBuilder ? /textureSample\w*\(/g : /\btexture\(/g;
      const hits = [...code.matchAll(call)];
      expect(hits).toHaveLength(1);
      const main = code.slice(0, hits[0].index);
      const since = main.slice(Math.max(main.lastIndexOf('void main'), main.lastIndexOf('fn main')));
      expect((since.match(/\{/g) ?? []).length - 1).toBe((since.match(/\}/g) ?? []).length);
    });
  }

  it('GLSL: the depth texture is compared (a shadow sampler), not just read', () => {
    const code = termFragment(GLSLNodeBuilder, true);
    expect(code).toMatch(/sampler2DShadow/);
  });

  it('takes a depth texture of the pass and keeps the stand-in compare function', () => {
    const sun = makeSunLight();
    const d = sunDepthTexture(8);
    sun.set(null, d, false);
    expect(d.compareFunction).not.toBeNull();
  });
});
