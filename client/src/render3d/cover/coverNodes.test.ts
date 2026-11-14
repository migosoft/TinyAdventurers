import { describe, expect, it } from 'vitest';
import { DataTexture, GLSLNodeBuilder, MeshBasicNodeMaterial, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { float, vec2, vec3, vec4 } from 'three/tsl';
import { makeLighting, type Lighting } from '../lightNodes';
import { makeSunLight } from '../sunNodes';
import { makeSight } from '../sightNodes';
import { viewTowardUniform } from '../materials';
import { makeTreeShared, treeMaterials } from '../trees/treeNodes';
import { seeUniforms } from '../materials';
import { fragment, vertex, type Builder } from '../shaderCode.testutil';
import { GH_MAX as KINDS_GH_MAX } from './kinds';
import { GH_MAX, bushelMaterial, coverHeightNode, coverSheetMaterial, makeCoverShared } from './coverNodes';

/** A `Lighting` whose light is a constant, so the only texture reads in a cover material are its own. */
function stub(): Lighting {
  return {
    lightAt: () => ({ rgb: vec3(1, 1, 1), dv: float(0) }),
    sun: makeSunLight(),
    finish: (a: unknown) => a,
    shoulder: (c: unknown) => c,
    cellH: () => float(0),
  } as unknown as Lighting;
}
const real = (sun: boolean): Lighting => makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun });
const standIn = () => new DataTexture(new Uint8Array(4), 1, 1);

describe('GH_MAX', () => {
  it('is the cover kinds module\'s', () => {
    expect(GH_MAX).toBe(KINDS_GH_MAX);
  });
});

/** The node materials under test, with the lighting they are built on. */
function build(lighting: Lighting) {
  const shared = makeCoverShared(standIn());
  const sight = makeSight();
  return {
    shared,
    sheet: coverSheetMaterial({ lighting, sight, shared }),
    bushel: bushelMaterial({ lighting, sight, toward: viewTowardUniform(), shared }),
  };
}

/** Every block opened since main began (three's own uniform flipY if/else) is closed again at `index`. */
function atTopLevel(code: string, index: number): boolean {
  const before = code.slice(0, index);
  const since = before.slice(Math.max(before.lastIndexOf('void main'), before.lastIndexOf('fn main')));
  return (since.match(/\{/g) ?? []).length - 1 === (since.match(/\}/g) ?? []).length;
}

for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
  const wgsl = B === WGSLNodeBuilder;
  describe(`cover materials in ${B.name}`, () => {
    it('both build with the real light and end with the sight step', () => {
      const m = build(real(true));
      for (const [name, mat] of [['sheet', m.sheet], ['bushel', m.bushel]] as const) {
        const code = fragment(B, mat, { compare: true });
        expect(code, name).toContain('sightMode');
        expect(code, name).toContain('sightOrigin');
        expect(vertex(B, mat, { compare: true }).length, name).toBeGreaterThan(0);
      }
    });

    it('both sample the sight mask once, at the top level', () => {
      const m = build(stub());
      for (const [name, mat] of [['sheet', m.sheet], ['bushel', m.bushel]] as const) {
        const code = fragment(B, mat);
        const hits = [...code.matchAll(wgsl ? /textureSample\w*\(/g : /\btexture\(/g)];
        expect(hits, name).toHaveLength(1);
        expect(atTopLevel(code, hits[0].index), name).toBe(true);
      }
    });

    it('the sheet (fragment) and the bushel (vertex) read the cover image by texel fetch, outside any branch', () => {
      const m = build(stub());
      for (const [name, mat, code] of [['sheet', m.sheet, fragment(B, m.sheet)], ['bushel', m.bushel, vertex(B, m.bushel)]] as const) {
        void mat;
        const loads = [...code.matchAll(wgsl ? /textureLoad\(/g : /\btexelFetch\(/g)];
        expect(loads.length, name).toBeGreaterThan(0);
        for (const h of loads) expect(atTopLevel(code, h.index), name).toBe(true);
      }
    });

    it('the sun marker (the sun\'s own jitter constant 311.7) is in the code of a world with a sun', () => {
      const m = build(real(true));
      for (const [name, mat] of [['sheet', m.sheet], ['bushel', m.bushel]] as const) expect(fragment(B, mat, { compare: true }), name).toContain('311.7');
    });

    it('carry no sun code in a world without a sun', () => {
      const m = build(real(false));
      for (const [name, mat] of [['sheet', m.sheet], ['bushel', m.bushel]] as const) {
        const code = fragment(B, mat, { compare: true });
        expect(code, name).not.toMatch(wgsl ? /texture_depth_2d|textureSampleCompare/ : /uniform sampler2DShadow/);
        expect(code, name).not.toContain('311.7');
      }
    });

    it('are opaque, alpha tested and double sided; the sheet writes depth', () => {
      const m = build(stub());
      for (const mat of [m.sheet, m.bushel]) {
        expect(mat.transparent).toBe(false);
        expect(mat.alphaTest).toBe(0.5);
        expect(mat.side).toBe(2);
      }
      expect(m.sheet.depthWrite).toBe(true);
    });

    it('the cover height is zero while the layer is off', () => {
      const s = makeCoverShared(standIn());
      const mat = new MeshBasicNodeMaterial();
      mat.colorNode = vec4(vec3(coverHeightNode(s, vec2(1, 2))), 1);
      expect(fragment(B, mat)).toContain('coverOn');
    });

    it('the sheet reads the texture upwind of the cell (two fetches or more)', () => {
      const m = build(stub());
      const code = fragment(B, m.sheet);
      expect([...code.matchAll(wgsl ? /textureLoad\(/g : /\btexelFetch\(/g)].length).toBeGreaterThanOrEqual(2);
    });
  });

  describe(`the falling leaf and the cover in ${B.name}`, () => {
    const make = (cover: boolean) => {
      const t = new Texture();
      return treeMaterials({
        lighting: real(false), sight: makeSight(), see: seeUniforms(), mask: t, palette: t, shared: makeTreeShared(), hasSun: false,
        cover: cover ? makeCoverShared(standIn()) : undefined,
      }).leaf;
    };
    const fetches = (code: string) => [...code.matchAll(wgsl ? /textureLoad\(/g : /\btexelFetch\(/g)].length;
    it('reads the cover texture when given one, and not otherwise', () => {
      expect(fetches(vertex(B, make(true)))).toBeGreaterThan(0);
      expect(fetches(vertex(B, make(false)))).toBe(0);
    });
  });
}

describe('makeCoverShared', () => {
  it('starts with the layer off and follows setTexture', () => {
    const s = makeCoverShared(standIn());
    expect(s.on.value).toBe(0);
    const next = new DataTexture(new Uint8Array(4 * 32 * 16), 32, 16);
    s.setTexture(next);
    expect(s.texture.value).toBe(next);
  });
});

describe('kind ids index the tables rounded', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the bushel vertex shader adds 0.5 and floors the id before indexing`, () => {
      const code = vertex(B, build(stub()).bushel);
      expect(code).toMatch(/floor\(\s*\(?\s*[\w.]*bushelKind\w*\s*\+\s*0\.5\s*\)?\s*\)/);
    });
  }
});
