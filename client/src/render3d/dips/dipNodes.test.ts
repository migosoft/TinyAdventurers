// The dip ground's shader code as three generates it (GLSL and WGSL), built without a GPU (#324).
import { describe, expect, it, vi } from 'vitest';
import { worldMaterial } from '../materials';
import { makeCoverShared } from '../cover/coverRead';
import { BufferAttribute, BufferGeometry, DataTexture, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting, type Lighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { fragment, readsInBranches, type Builder } from '../shaderCode.testutil';
import { dipMaterial } from './dipNodes';
import { unplanned } from '../stone/plan';
import { makeSheets } from '../stone/sheets';

/** The dip mesh's vertex layout (`DipArrays`). */
const DIP_ATTRS: [string, number][] = [['position', 3], ['normal', 3], ['uv', 2], ['rect', 4], ['kind', 1], ['sheet', 3], ['dip', 1], ['marks', 3]];
/** The stone sheets of the world and dip materials. */
const sheets = () => makeSheets(unplanned(), { size: 4096, layers: 256 });
const geometry = (): BufferGeometry => {
  const g = new BufferGeometry();
  for (const [n, s] of DIP_ATTRS) g.setAttribute(n, new BufferAttribute(new Float32Array(6 * s), s));
  return g;
};

/** The material and the options `lightAt` was called with. */
function build(): { m: ReturnType<typeof dipMaterial>; calls: unknown[] } {
  const t = new Texture();
  const real = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture());
  const calls: unknown[] = [];
  const lighting: Lighting = { ...real, lightAt: (p, n, w, o) => { calls.push(o); return real.lightAt(p, n, w, o); } };
  return { m: dipMaterial(lighting, t, makeSight(), makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1)), sheets()), calls };
}

/** Each `for` loop's index name and the names of the loops around it (by brace depth). */
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

describe('dipMaterial', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: builds`, () => {
      expect(() => fragment(B, build().m.material, { geometry: geometry() })).not.toThrow();
    });

    it(`${B.name}: reads the sheet's groove flag (the lava's embers follow the joints and cracks)`, () => {
      expect(/\bgroove\b/.test(fragment(B, build().m.material, { geometry: geometry() }))).toBe(true);
    });

    it(`${B.name}: uses no sine hash`, () => {
      expect(fragment(B, build().m.material, { geometry: geometry() })).not.toContain('43758');
    });

    it(`${B.name}: the hash keeps its mixing step, and building logs no TSL error`, () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(fragment(B, build().m.material, { geometry: geometry() })).toContain('33.33');
        expect(err).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        err.mockRestore();
        warn.mockRestore();
      }
    });

    it(`${B.name}: the lighting is built once (as many loops as the world material)`, () => {
      const t = new Texture();
      const l = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture());
      const world = worldMaterial(l, t, t, makeSight(), makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1)), sheets()).material;
      const count = (code: string): number => loops(code).length;
      expect(count(fragment(B, build().m.material, { geometry: geometry() }))).toBe(count(fragment(B, world, { geometry: geometry() })));
    });

    it(`${B.name}: the chasm slabs are emitted once`, () => {
      // `slabs` writes its tilt constant (LEDGE_COS, 0.906) twice (the layer's own axis and the one across it), and the ridges call it four
      // times (two runs along z, one along x, and the two of a corner blend): 8 in all for one copy of the block. A second use of `ridges`
      // outside the rock's pick would emit a second copy: 16.
      const code = fragment(B, build().m.material, { geometry: geometry() });
      expect((code.match(/\b0\.906\b/g) ?? []).length).toBe(8);
    });

    it(`${B.name}: no atlas or ground sample and no derivative sits in a branch`, () => {
      expect(readsInBranches(fragment(B, build().m.material, { geometry: geometry() }))).toEqual([]);
    });

    it(`${B.name}: keeps its loops apart`, () => {
      const ls = loops(fragment(B, build().m.material, { geometry: geometry() }));
      expect(ls.length).toBeGreaterThan(0);
      for (const l of ls) expect(l.outer, `loop ${l.name} inside ${l.outer.join(', ')}`).not.toContain(l.name);
    });
  }

  it('reads the light once and carries the sight step', () => {
    const { m, calls } = build();
    expect(calls).toHaveLength(1);
    expect(fragment(WGSLNodeBuilder, m.material, { geometry: geometry() })).toContain('sightMode');
  });

  it('hands back the handles the view drives', () => {
    const { m } = build();
    expect(m.smooth.value).toBe(0);
    expect(m.time.value).toBe(0);
    expect(typeof m.setGround).toBe('function');
    expect(typeof m.setSheets).toBe('function');
  });
});
