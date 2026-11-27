import { describe, expect, it } from 'vitest';
import { BackSide, BufferAttribute, BufferGeometry, DataTexture, DoubleSide, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { imageTexture } from '../models/layer';
import { fragment, readsInBranches, vertex, type Builder } from '../shaderCode.testutil';
import { makeFigureShared } from '../models/nodes';
import { newBuiltBuf } from '../built';
import { DEMON_PAINT } from './paint';
import { DEMON_GLOW, glowAt } from './glow';
import { demonMaterials } from './nodes';

function make() {
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
  // The real picture's kind of texture: filtered with mips (WGSL then samples with derivatives, which must not sit in a branch).
  const paint = imageTexture({ w: 2, h: 2, data: new Uint8Array(16) }, { mips: true });
  return demonMaterials({ lighting, sight: makeSight(), shared: makeFigureShared(), paint, idTex: new Texture() });
}

/** A geometry with the streams of the body's buffer, or of the hull's (position and look only). */
function geometryOf(hull: boolean): BufferGeometry {
  const b = newBuiltBuf(4, 6), g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('look', new BufferAttribute(b.look, 2));
  if (!hull) {
    g.setAttribute('colour', new BufferAttribute(b.colour, 3));
    g.setAttribute('normal', new BufferAttribute(b.normal, 3));
    g.setAttribute('uv', new BufferAttribute(b.uv, 2));
  }
  g.setIndex(new BufferAttribute(b.index, 1));
  return g;
}

describe('the demon materials', () => {
  it('the body and the id are two-sided (the webbing), the hull shows its inside; all three are opaque and cut by alpha', () => {
    const m = make();
    expect(m.body.side).toBe(DoubleSide);
    expect(m.id.side).toBe(DoubleSide);
    expect(m.hull.side).toBe(BackSide);
    for (const x of [m.body, m.id, m.hull]) { expect(x.transparent).toBe(false); expect(x.depthWrite).toBe(true); expect(x.alphaTest).toBe(0.5); }
    m.dispose();
  });

  it('the pulse keeps the spike\'s darkest and brightest value and travels up the body', () => {
    const lo = 1e9, at = (phase: number, y: number): number => glowAt(phase, y);
    let min = lo, max = 0;
    for (let i = 0; i < 400; i++) { const g = at(i / 400, 10); min = Math.min(min, g); max = Math.max(max, g); }
    expect(min).toBeCloseTo(DEMON_GLOW.dark, 3);
    expect(max).toBeCloseTo(1, 3);
    // the crest at height y comes y / wave later in the phase: the wave climbs
    expect(at(0.25, 0)).toBeCloseTo(1, 9);
    expect(at(0.25 + 11 / DEMON_GLOW.wave, 11)).toBeCloseTo(1, 9);
    expect(at(0.5, DEMON_GLOW.wave)).toBeCloseTo(at(0.5, 0), 9);
  });

  it('sorts the picture\'s alpha by ranges: a hole is cut below the plain class, a glow starts above it', () => {
    expect(DEMON_GLOW.cut).toBeGreaterThan(0);
    expect(DEMON_GLOW.cut).toBeLessThan(DEMON_PAINT.plain / 255);
    expect(DEMON_GLOW.hot[0]).toBeGreaterThanOrEqual(DEMON_PAINT.plain / 255);
    expect(DEMON_GLOW.hot[1]).toBeLessThanOrEqual(DEMON_PAINT.glow / 255);
  });

  for (const [name, B] of [['GLSL', GLSLNodeBuilder], ['WGSL', WGSLNodeBuilder]] as [string, Builder][]) {
    describe(name, () => {
      it('the three materials build; the body reads the picture once and the lights, the hull the id target and the ambient', () => {
        const m = make();
        const bg = geometryOf(false), hg = geometryOf(true);
        const bf = fragment(B, m.body, { compare: true, geometry: bg });
        const idf = fragment(B, m.id, { compare: true, geometry: bg });
        const hf = fragment(B, m.hull, { compare: true, geometry: hg });
        for (const [mat, g] of [[m.body, bg], [m.id, bg], [m.hull, hg]] as const) expect(vertex(B, mat, { compare: true, geometry: g }).length).toBeGreaterThan(0);
        expect(bf).toMatch(/demonPaint/);
        expect(bf).toMatch(/lightAmbient/);
        expect(readsInBranches(bf).filter((l) => /demonPicture/.test(l))).toEqual([]);
        expect(bf.split('\n').filter((l) => /demonPicture\b/.test(l) && /texture/i.test(l) && !/binding|uniform/.test(l)).length).toBe(1);
        expect(bf.length).toBeLessThan(45000);
        // the id pass is not lit; it reads the picture for the webbing's holes
        expect(idf).not.toMatch(/lightAmbient/);
        expect(idf).toMatch(/demonPicture/);
        expect(readsInBranches(idf)).toEqual([]);
        // the hull is dimmed by the ambient light and reads the id texel at its own pixel
        expect(hf).toMatch(/lightAmbient/);
        expect(hf).toMatch(B === WGSLNodeBuilder ? /textureLoad/ : /texelFetch/);
        expect(hf).not.toMatch(/demonPicture/);
        expect(readsInBranches(hf)).toEqual([]);
        m.dispose();
      });
    });
  }
});
