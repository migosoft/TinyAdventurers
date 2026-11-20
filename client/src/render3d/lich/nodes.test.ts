import { describe, expect, it } from 'vitest';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture, DoubleSide, GLSLNodeBuilder, RGBAFormat, Texture, UnsignedByteType, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { fragment, vertex, type Builder } from '../shaderCode.testutil';
import { FIGURE_ORDER, SEE_ORDER, makeFigureShared } from '../models/nodes';
import { builtPoint, newBuiltBuf, type V3 } from '../built';
import { CLAW_ORDER, YAW_TURN, lichMaterials } from './nodes';

function make() {
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
  const paint = new DataTexture(new Uint8Array(16), 2, 2, RGBAFormat, UnsignedByteType);
  return lichMaterials({ lighting, sight: makeSight(), shared: makeFigureShared(), paint });
}

/** A geometry with the streams of a built buffer. */
function geometryOf(claws: boolean): BufferGeometry {
  const b = newBuiltBuf(4, 6), g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('colour', new BufferAttribute(b.colour, 3));
  if (!claws) {
    g.setAttribute('normal', new BufferAttribute(b.normal, 3));
    g.setAttribute('uv', new BufferAttribute(b.uv, 2));
    g.setAttribute('look', new BufferAttribute(b.look, 2));
  }
  g.setIndex(new BufferAttribute(b.index, 1));
  return g;
}

describe('the lich materials', () => {
  it('the constants', () => {
    expect(CLAW_ORDER).toBeCloseTo(SEE_ORDER + 0.1, 9);
    expect(FIGURE_ORDER).toBe(10);
  });

  it('the body is opaque, writes depth, is double sided and sets no render order of its own; the claws add light, write no depth', () => {
    const m = make();
    expect(m.body.transparent).toBe(false);
    expect(m.body.depthWrite).toBe(true);
    expect(m.body.side).toBe(DoubleSide);
    expect(m.body.alphaTest).toBe(0.5);
    expect((m.body as { renderOrder?: number }).renderOrder).toBeUndefined();
    expect(m.claws.blending).toBe(AdditiveBlending);
    expect(m.claws.transparent).toBe(true);
    expect(m.claws.depthWrite).toBe(false);
    expect(m.claws.depthTest).toBe(true);
    expect(m.claws.side).toBe(DoubleSide);
    expect((m.claws as { renderOrder?: number }).renderOrder).toBeUndefined();
    m.dispose();
  });

  it('the yaw turns the model as builtPoint does: +x to (cos, sin), +z to (-sin, cos)', () => {
    const out: V3 = [0, 0, 0];
    for (const yaw of [0, 0.7, -2.1, 3]) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const turn = (x: number, z: number): [number, number] => [c * x + YAW_TURN.xFromZ * s * z, YAW_TURN.zFromX * s * x + c * z];
      for (const [x, z] of [[1, 0], [0, 1], [2, -3]] as const) {
        builtPoint([x, 0, z], 0, 0, 0, yaw, 1, 1, out);
        const t = turn(x, z);
        expect(t[0]).toBeCloseTo(out[0], 9);
        expect(t[1]).toBeCloseTo(out[2], 9);
      }
    }
  });

  for (const [name, B] of [['GLSL', GLSLNodeBuilder], ['WGSL', WGSLNodeBuilder]] as [string, Builder][]) {
    describe(name, () => {
      it('both materials build; the body reads the picture and the lights, the claws neither', () => {
        const m = make();
        const bg = geometryOf(false), cg = geometryOf(true);
        const bf = fragment(B, m.body, { compare: true, geometry: bg });
        const cf = fragment(B, m.claws, { compare: true, geometry: cg });
        expect(vertex(B, m.body, { compare: true, geometry: bg }).length).toBeGreaterThan(0);
        expect(vertex(B, m.claws, { compare: true, geometry: cg }).length).toBeGreaterThan(0);
        expect(bf).toMatch(/lichPaint/);
        expect(bf).toMatch(/lightAmbient/);
        expect(cf).not.toMatch(/lichPaint/);
        expect(cf).not.toMatch(/lightAmbient/);
        expect(cf).not.toMatch(wgslOr(B, /textureSample|textureLoad/, /texture\(|texelFetch/));
        m.dispose();
      });
    });
  }
});

const wgslOr = (B: Builder, w: RegExp, g: RegExp): RegExp => (B === WGSLNodeBuilder ? w : g);
