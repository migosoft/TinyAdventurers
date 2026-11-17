// The lighting's shader code as three generates it (GLSL for the WebGL2 fallback, WGSL for WebGPU), built without a GPU (#304).
import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, GLSLNodeBuilder, MeshBasicNodeMaterial, RGBAFormat, WGSLNodeBuilder } from 'three/webgpu';
import { float, positionWorld, vec2, vec3, vec4 } from 'three/tsl';
import { GLINT, makeLighting } from './lightNodes';
import { fragment, type Builder } from './shaderCode.testutil';

/** The fragment shader of a material lit by `lightAt` (a card's options: its own slot, the dark flag). */
function lightFragment(B: Builder, withSun = false, compare = false, foot = false): string {
  const tex = (): DataTexture => new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
  const lighting = makeLighting(tex(), { w: 4, h: 4 }, tex(), { sun: withSun });
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(lighting.lightAt(positionWorld, vec3(0, 1, 0), float(0.5), { self: float(0), darkOnly: float(0), ...(foot ? { selfFoot: vec2(1, 2) } : {}), ...(withSun ? { sun: { Ps: positionWorld, ndl: float(1) } } : {}) }).rgb, 1);
  return fragment(B, m, { compare });
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

describe('the lighting shader', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: no loop reuses the index name of a loop around it`, () => {
      // An expression of the light loop's index pasted into the wall walk or the card test would read that loop's own index
      // instead (the shadow then came from another light's slot, #304); distinct names make that impossible.
      const ls = loops(lightFragment(B));
      expect(ls.some((l) => l.outer.length >= 1)).toBe(true); // the light loop holds the shadow loops
      for (const l of ls) expect(l.outer, `loop ${l.name} inside ${l.outer.join(', ')}`).not.toContain(l.name);
    });

    it(`${B.name}: the crack term builds, its loops are named apart, and the sun-ray visibility is built from the wall walk and the card test`, () => {
      const ls = loops(lightFragment(B));
      const names = ls.map((l) => l.name);
      expect(names).toContain('cs');
      expect(names).toContain('cr');
      for (const l of ls) expect(l.outer, `loop ${l.name} inside ${l.outer.join(', ')}`).not.toContain(l.name);
      // Inside the crack loop: the ray loop of the mask, the wall walk and the card test of the sun-ray visibility.
      const inCs = ls.filter((l) => l.outer.includes('cs')).map((l) => l.name);
      expect(inCs).toEqual(expect.arrayContaining(['cr', 'ws', 'ci']));
    });

    it(`${B.name}: the own-foot comparison is built only for a material that gives a selfFoot`, () => {
      const without = lightFragment(B);
      const withFoot = lightFragment(B, false, false, true);
      // The foot test is `length(caster.xy - foot) > 0.02`: it adds a length() of a difference to the card loop.
      const lengths = (code: string): number => (code.match(/\blength\(/g) ?? []).length;
      expect(lengths(withFoot)).toBeGreaterThan(lengths(without));
      expect(withFoot.length).toBeGreaterThan(without.length);
    });

    it(`${B.name}: darkvision leaves out the top of a block that rises above the eye`, () => {
      // The wall walk skips the cell a point lies in, so alone it would let the eye "see" the top of a wall from below
      // (grey tops beyond sight, #328). The test of the top is a variable of its own, set before the walk.
      const code = lightFragment(B);
      expect(code).toContain('dvOnTop');
      expect(code.indexOf('dvOnTop')).toBeLessThan(code.lastIndexOf('dvOnTop'));
    });

    it(`${B.name}: with the sun it builds, keeps the loop indices apart, and samples the sun's shadow map first, before any branch`, () => {
      const code = lightFragment(B, true, true);
      const ls = loops(code);
      for (const l of ls) expect(l.outer, `loop ${l.name} inside ${l.outer.join(', ')}`).not.toContain(l.name);
      // The sun's own sample (a compare of the depth texture) is the only one of its kind and sits at the top level of main():
      // every block opened since main began is closed again.
      const own = B === WGSLNodeBuilder ? /textureSampleCompare\(/g : /\btexture\( \w+, vec3\(/g;
      const sun = [...lightFragment(B, true, true).matchAll(own)];
      expect(sun).toHaveLength(1);
      const main = lightFragment(B, true, true).slice(0, sun[0].index);
      const since = main.slice(Math.max(main.lastIndexOf('void main'), main.lastIndexOf('fn main')));
      expect((since.match(/\{/g) ?? []).length - 1).toBe((since.match(/\}/g) ?? []).length);
      // Without a sun in the lighting the option is ignored: no compare sample at all.
      expect([...lightFragment(B, false, true).matchAll(own)]).toHaveLength(0);
    });
  }
});

describe('the lava light', () => {
  const tex = (): DataTexture => new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
  const code = (B: Builder): string => {
    const lighting = makeLighting(tex(), { w: 4, h: 4 }, tex());
    const m = new MeshBasicNodeMaterial();
    // An upward face: the surface the lava cell's own glow used to be added on.
    m.colorNode = vec4(lighting.lightAt(positionWorld, vec3(0, 1, 0), float(0.5)).rgb, 1);
    return fragment(B, m);
  };
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the light's code holds no textureLoad of the lava texture`, () => {
      // The lava's own glow is its surface's (#344). The lava texture is the one filtered read of this shader (WGSL textureSample,
      // GLSL texture); the heights and the atlas are texel loads (WGSL textureLoad, GLSL texelFetch) of other textures.
      const c = code(B);
      const sampled = [...c.matchAll(/\b(?:textureSample|texture)\( (\w+)/g)].map((m) => m[1]);
      expect(new Set(sampled).size).toBe(1);
      const loaded = [...c.matchAll(/\b(?:textureLoad|texelFetch)\( (\w+)/g)].map((m) => m[1]);
      expect(loaded.length).toBeGreaterThan(0);
      expect(loaded).not.toContain(sampled[0]);
    });
  }
});

describe('finish', () => {
  const finished = (B: Builder, grey?: unknown): string => {
    const tex = (): DataTexture => new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
    const lighting = makeLighting(tex(), { w: 4, h: 4 }, tex());
    const m = new MeshBasicNodeMaterial();
    const lit = { rgb: vec3(positionWorld), dv: float(0.5) };
    m.colorNode = vec4(lighting.finish(vec3(0.25, 0.5, 0.75), lit, grey), 1);
    return fragment(B, m);
  };
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the darkvision grey takes the optional grey albedo; without it the albedo itself`, () => {
      const own = finished(B);
      const separate = finished(B, vec3(0.123, 0.456, 0.789));
      expect(own).not.toContain('0.123');
      expect(separate).toContain('0.123');
      // The lit colour still comes from the albedo.
      expect(separate).toContain('0.25');
    });
  }
});

describe('glintAt', () => {
  const tex = (): DataTexture => new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
  const glintCode = (B: Builder): string => {
    const lighting = makeLighting(tex(), { w: 4, h: 4 }, tex());
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(lighting.glintAt(positionWorld, vec3(0, 1, 0), vec3(0, 0.6, 0.8)), 1);
    return fragment(B, m);
  };
  const lit = (B: Builder): string => lightFragment(B);
  // Each uniformArray is one uniform buffer; the caster arrays are the ones the card test reads (`cA`, `cB`, `cR`), the lights' the ones `glintAt` reads.
  const arrays = (code: string): number => new Set(code.match(/\bnodeUniform\w*|\bArray\w*\b/g) ?? []).size;
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: builds a glint`, () => {
      const code = glintCode(B);
      expect(code.length).toBeGreaterThan(0);
      // The two lobes: the sharp and the broad exponent.
      expect(code).toMatch(/\bpow\(/);
      expect(code).toContain(String(GLINT.sharp));
      expect(code).toContain(String(GLINT.broad));
    });

    it(`${B.name}: keeps the glint loops apart`, () => {
      const ls = loops(glintCode(B));
      const names = ls.map((l) => l.name);
      expect(names).toContain('gl');
      expect(names).toContain('gc');
      for (const n of ['li', 'cs', 'ci']) expect(names).not.toContain(n);
      for (const l of ls) expect(l.outer, `loop ${l.name} inside ${l.outer.join(', ')}`).not.toContain(l.name);
      // The wall walk (ws) sits inside the light loop, the crack mask's ray loop (cr) inside the crack loop.
      expect(ls.find((l) => l.name === 'ws')?.outer).toContain('gl');
      expect(ls.find((l) => l.name === 'cr')?.outer).toContain('gc');
    });

    it(`${B.name}: reads no caster for a glint`, () => {
      const glint = glintCode(B);
      // The card test is the only reader of the caster arrays: its loop is `ci`, and the atlas is read there with textureLoad / texelFetch.
      expect(loops(lit(B)).map((l) => l.name)).toContain('ci');
      expect(loops(glint).map((l) => l.name)).not.toContain('ci');
      const loads = (c: string): number => (c.match(/\b(?:textureLoad|texelFetch)\(/g) ?? []).length;
      expect(loads(lit(B))).toBeGreaterThan(loads(glint));
      // Fewer uniform arrays: three declares the three caster arrays only where the card test uses them.
      expect(arrays(glint)).toBeLessThan(arrays(lit(B)));
    });
  }
});
