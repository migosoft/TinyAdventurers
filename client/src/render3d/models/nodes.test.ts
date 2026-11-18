import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, GLSLNodeBuilder, InstancedBufferAttribute, NearestFilter, RGBAFormat, Texture, WGSLNodeBuilder, FrontSide, DoubleSide, type BufferGeometry } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { fragment, vertex, type Builder } from '../shaderCode.testutil';
import { FIGURE_ORDER, FIGURE_SHADE, HULL_ORDER, OUTLINE, figureMaterials, makeFigureShared } from './nodes';
import { figureGeometry, modelBuffers } from './layer';
import { buildFigure, type FigureModel } from './model';
import { ROW_TEXELS } from './instances';
import { DESCS } from './table';

// The cheapest figure with bends is the elf (a quiff or a plume); the skeleton is the cheapest without. Built once.
const elf: FigureModel = buildFigure('elf', DESCS.elf);
const skelet: FigureModel = buildFigure('skelet', DESCS.skelet);

function rowsTexture(): DataTexture {
  const t = new DataTexture(new Float32Array(ROW_TEXELS * 4 * 4), ROW_TEXELS, 4, RGBAFormat, FloatType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function make(hasSun: boolean) {
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: hasSun });
  const mats = figureMaterials({ lighting, sight: makeSight(), hasSun, rows: rowsTexture(), paint: new Texture(), stone: new Texture(), sky: new Texture(), shared: makeFigureShared(), idTex: new Texture() });
  return { mats, lighting };
}

/** A geometry as the layer makes it for the whole of a model's triangles (`which`: the pieces and hulls, the pieces or the hulls). */
function geometryOf(m: FigureModel, which: 'all' | 'piece' | 'line' = 'all'): BufferGeometry {
  const b = modelBuffers(m);
  return figureGeometry(b, which === 'all' ? b.index : which === 'piece' ? b.pieceIndex : b.lineIndex, new InstancedBufferAttribute(new Float32Array(4), 1));
}

describe('constants', () => {
  it('are the brief\'s', () => {
    expect(FIGURE_SHADE).toBe(0.55);
    expect(FIGURE_ORDER).toBe(10);
    expect(HULL_ORDER).toBe(FIGURE_ORDER + 0.5);
    expect(OUTLINE).toBe(0x222222);
  });
});

describe('the geometry of a model', () => {
  it('needs 7 vertex buffers: position, normal, uv, skin, look, origin and the instance row (WebGPU takes 8)', () => {
    for (const m of [elf, skelet]) {
      const g = geometryOf(m);
      expect(Object.keys(g.attributes).sort()).toEqual(['look', 'normal', 'origin', 'position', 'row', 'skin', 'uv']);
      expect(Object.keys(g.attributes).length).toBeLessThanOrEqual(8);
    }
  });

  it('gives a bending vertex the origin of its bend and every other vertex 0', () => {
    const b = modelBuffers(elf);
    expect(elf.bends.length).toBeGreaterThan(0);
    let bending = 0;
    for (let i = 0; i < elf.skin.length / 4; i++) {
      const k = elf.skin[i * 4 + 2];
      const o = [0, 1, 2].map((c) => b.origin.array[i * 3 + c]);
      if (k >= 0) { expect(o).toEqual(elf.bends[k].origin.map((v) => Math.fround(v))); bending++; } else expect(o).toEqual([0, 0, 0]);
    }
    expect(bending).toBeGreaterThan(0);
  });

  it('winds the pieces counter-clockwise about their normals and the hulls the other way, so one cull mode serves both', () => {
    // Three culls the back (clockwise) faces of a FrontSide material.
    const sideOf = (m: FigureModel, from: number, count: number): number => {
      let agree = 0, total = 0;
      for (let t = from; t < from + count; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => m.index[t + k]);
        const p = (i: number, k: number) => m.position[i * 3 + k];
        const e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k)), e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k));
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const vn = [0, 1, 2].map((k) => m.normal[a * 3 + k]);
        const d = n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2];
        if (Math.abs(d) < 1e-9) continue;
        total++;
        if (d > 0) agree++;
      }
      return agree / total;
    };
    let piece = 0, line = 0, pieces = 0, lines = 0;
    for (const r of elf.ranges) {
      const s = sideOf(elf, r.start, r.count);
      if (r.line) { line += s; lines++; } else { piece += s; pieces++; }
    }
    expect(piece / pieces).toBeGreaterThan(0.9);   // counter-clockwise: the piece is drawn by FrontSide
    expect(line / lines).toBeLessThan(0.1);        // reversed: the hull shows its inside, which is the outline
  });
});

for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
  const wgsl = B === WGSLNodeBuilder;

  describe(`figure materials in ${B.name}`, () => {
    it('all four compile to shader code, with and without a sun', () => {
      for (const sun of [true, false]) {
        const { mats } = make(sun);
        expect(mats.sun !== null).toBe(sun);
        expect('seal' in mats).toBe(false);
        const list = [[mats.piece, 'all'], [mats.line, 'line'], [mats.id, 'piece'], [mats.sun, 'piece']] as const;
        for (const [m, which] of list) {
          if (!m) continue;
          const g = geometryOf(elf, which);
          expect(fragment(B, m, { compare: true, geometry: g }).length).toBeGreaterThan(0);
          expect(vertex(B, m, { compare: true, geometry: g }).length).toBeGreaterThan(0);
        }
      }
    });

    it('the render states: the outline, the id and the piece write colour and depth, the sun depth only', () => {
      const { mats } = make(true);
      for (const m of [mats.line, mats.id, mats.piece]) {
        expect(m.depthWrite).toBe(true);
        expect(m.colorWrite).toBe(true);
      }
      expect(mats.sun!.colorWrite).toBe(false);
      // One cull mode serves the hull, the id and the piece.
      expect(mats.piece.side).toBe(FrontSide);
      expect(mats.line.side).toBe(mats.piece.side);
      expect(mats.id.side).toBe(mats.piece.side);
      expect(mats.sun!.side).toBe(DoubleSide);
    });

    it('the line reads the id target and the shared switch; the id writes no light, no paint and has no switch', () => {
      const { mats } = make(true);
      const line = fragment(B, mats.line, { compare: true, geometry: geometryOf(elf, 'line') });
      expect(line).toMatch(/figIdOn/);
      const id = fragment(B, mats.id, { compare: true, geometry: geometryOf(elf, 'piece') });
      expect(id).not.toMatch(/lightAmbient/);
      expect(id).not.toMatch(/figPaint|figStone|figSky/);
      expect(id).not.toMatch(/figIdOn/);
    });

    it('the hull\'s cut rule: the line fetches the id texel at its own fragment coordinate; the piece does not', () => {
      const { mats } = make(true);
      // These patterns match the text TSL generates today: re-read them when three.js is updated.
      // The fetch of a texture at the fragment's own pixel: `texelFetch` of an `ivec2` of `gl_FragCoord`, or `textureLoad` at `fragCoord.xy`.
      const own = wgsl ? /textureLoad\(\s*\w+,\s*vec2<i32>\(\s*fragCoord\.xy\s*\)/ : /ivec2\(\s*vec2\(\s*gl_FragCoord\.xy\.x[^;]*;[\s\S]*?texelFetch\(/;
      expect(fragment(B, mats.line, { compare: true, geometry: geometryOf(elf, 'line') })).toMatch(own);
      expect(fragment(B, mats.piece, { compare: true, geometry: geometryOf(elf, 'piece') })).not.toMatch(own);
    });

    it('the id leaves out what the world hides, by the figure\'s own height (the row\'s fourth flag float), not by a constant 0; the piece keeps only its cut rule', () => {
      const { mats } = make(true);
      const id = fragment(B, mats.id, { compare: true, geometry: geometryOf(elf, 'piece') });
      const piece = fragment(B, mats.piece, { compare: true, geometry: geometryOf(elf, 'piece') });
      // The fragment's true height against the flags' fourth float (a flat varying of the row), and the cut rule's own test against 0.
      const against = /figPos\.y >= figFlags\.w/g, cutRule = /figPos\.y >= 0\.0/g;
      const n = (src: string, re: RegExp): number => (src.match(re) ?? []).length;
      expect(n(id, against)).toBe(1);
      expect(n(id, cutRule)).toBe(1);
      expect(n(piece, against)).toBe(0);
      expect(n(piece, cutRule)).toBe(1);
    });

    it('the id and the piece share one vertex stage: the rows texture read and the stretch by cos(pitch)', () => {
      const { mats } = make(true);
      const g = geometryOf(elf, 'piece');
      for (const m of [mats.id, mats.piece]) {
        const v = vertex(B, m, { compare: true, geometry: g });
        expect(v).toMatch(wgsl ? /textureLoad\(/ : /texelFetch\(/);
        expect(v).toMatch(/figCosP/);
      }
    });

    it('the piece reads the rows texture in the vertex stage, one instance row for every read', () => {
      const { mats } = make(true);
      const g = geometryOf(elf);
      const v = vertex(B, mats.piece, { compare: true, geometry: g });
      expect(v).toMatch(wgsl ? /textureLoad\(/ : /texelFetch\(/);
      // The row index comes from the instanced attribute.
      expect(v).toMatch(/\brow\b/);
      // Bones: the bone matrix is chosen by the vertex's own bone index; the loads are by integer coordinates.
      expect((v.match(wgsl ? /textureLoad\(/g : /texelFetch\(/g) ?? []).length).toBeGreaterThanOrEqual(12);
    });

    it('the fragment shader of the piece reads no row (it takes the instance data as flat varyings)', () => {
      const { mats } = make(true);
      const g = geometryOf(elf);
      const f = fragment(B, mats.piece, { compare: true, geometry: g });
      expect(f).toMatch(/flat/);
    });

    it('the line shader is not lit: no light uniforms, only the sight step on the outline colour', () => {
      const { mats } = make(true);
      const g = geometryOf(elf, 'line');
      const piece = fragment(B, mats.piece, { compare: true, geometry: geometryOf(elf) });
      const line = fragment(B, mats.line, { compare: true, geometry: g });
      expect(line.length).toBeLessThan(piece.length / 3);
      const shadowMap = wgsl ? /texture_depth_2d|textureSampleCompare/ : /uniform sampler2DShadow/;
      expect(piece).toMatch(shadowMap);
      expect(line).not.toMatch(shadowMap);
    });

    it('the outline is dimmed by the ambient light alone, so it is no brighter than the dark ground where nothing lights the figure (#338)', () => {
      const { mats } = make(true);
      const line = fragment(B, mats.line, { compare: true, geometry: geometryOf(elf, 'line') });
      expect(line).toMatch(/lightAmbient/);
      // ... and still no lamp: no light list, no lava texture read.
      expect(line).not.toMatch(/lightPos|lightCol|lava/i);
    });

    it('the unlit look (the seams) is dimmed by the ambient alone too: the piece finishes its flat colour with the ambient (#338)', () => {
      const { mats } = make(false);
      const f = fragment(B, mats.piece, { compare: true, geometry: geometryOf(elf) });
      // lightAt reads the ambient once; the unlit branch's own finish reads it again (the outline's finish is in the line shader).
      expect((f.match(/lightAmbient/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });

    it('the glowing look (3: a tube model\'s eyes) is told from the unlit one by the look value 2.5 (#356)', () => {
      const { mats } = make(false);
      const f = fragment(B, mats.piece, { compare: true, geometry: geometryOf(elf) });
      expect(f).toMatch(/2\.5/);
      // The hull has no looks: it never glows.
      expect(fragment(B, mats.line, { compare: true, geometry: geometryOf(elf, 'line') })).not.toMatch(/2\.5/);
    });

    it('the piece without a sun carries no shadow-map sampler', () => {
      const { mats } = make(false);
      const shadowMap = wgsl ? /texture_depth_2d|textureSampleCompare/ : /uniform sampler2DShadow/;
      expect(fragment(B, mats.piece, { compare: true, geometry: geometryOf(elf) })).not.toMatch(shadowMap);
    });

    it('the sun\'s pass carries no stretch: its vertex shader never reads the view\'s cos(pitch)', () => {
      const { mats } = make(true);
      const sunV = vertex(B, mats.sun!, { compare: true, geometry: geometryOf(elf, 'piece') });
      const pieceV = vertex(B, mats.piece, { compare: true, geometry: geometryOf(elf) });
      // The camera passes divide y by the shared cosP uniform; the sun's pass does not have it.
      expect(pieceV.length).toBeGreaterThan(0);
      expect(sunV).not.toMatch(/cosP|figCosP/);
      expect(pieceV).toMatch(/figCosP/);
    });

    it('builds for a figure without bends too', () => {
      const { mats } = make(true);
      expect(vertex(B, mats.piece, { compare: true, geometry: geometryOf(skelet) }).length).toBeGreaterThan(0);
    });
  });
}
