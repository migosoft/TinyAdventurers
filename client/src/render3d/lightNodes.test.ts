// The lighting's shader code as three generates it (GLSL for the WebGL2 fallback, WGSL for WebGPU), built without a GPU (#304).
import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, GLSLNodeBuilder, MeshBasicNodeMaterial, RGBAFormat, WGSLNodeBuilder } from 'three/webgpu';
import { float, positionWorld, vec3, vec4 } from 'three/tsl';
import { makeLighting } from './lightNodes';
import { fragment, type Builder } from './shaderCode.testutil';

/** The fragment shader of a material lit by `lightAt` (a card's options: its own slot, the dark flag). */
function lightFragment(B: Builder, withSun = false, compare = false): string {
  const tex = (): DataTexture => new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
  const lighting = makeLighting(tex(), { w: 4, h: 4 }, tex(), { sun: withSun });
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(lighting.lightAt(positionWorld, vec3(0, 1, 0), float(0.5), { self: float(0), darkOnly: float(0), ...(withSun ? { sun: { Ps: positionWorld, ndl: float(1) } } : {}) }).rgb, 1);
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
