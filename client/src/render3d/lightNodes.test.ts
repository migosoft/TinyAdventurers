// The lighting's shader code as three generates it (GLSL for the WebGL2 fallback, WGSL for WebGPU), built without a GPU (#304).
import { describe, expect, it } from 'vitest';
import {
  DataTexture, FloatType, GLSLNodeBuilder, Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, WGSLNodeBuilder,
} from 'three/webgpu';
import { context, float, positionWorld, vec3, vec4 } from 'three/tsl';
import { makeLighting } from './lightNodes';

type Builder = typeof GLSLNodeBuilder | typeof WGSLNodeBuilder;

/** The fragment shader of a material lit by `lightAt` (a card's options: its own slot, the dark flag), as `B` writes it. */
function fragment(B: Builder): string {
  const tex = (): DataTexture => new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
  const lighting = makeLighting(tex(), { w: 4, h: 4 }, tex());
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(lighting.lightAt(positionWorld, vec3(0, 1, 0), float(0.5), { self: float(0), darkOnly: float(0) }).rgb, 1);
  // Just what the builders read from a renderer to write the code; nothing is drawn.
  const renderer = {
    backend: { isWebGPUBackend: B === WGSLNodeBuilder, capabilities: { getUniformBufferLimit: () => 65536 }, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) } },
    library: { fromMaterial: (x: unknown) => x },
    contextNode: context(),
    lighting: { getNode: () => null },
    nodes: { getCacheKey: () => 0 },
    debug: { diagnostics: { keywords: false } },
    hasFeature: () => false,
    getRenderTarget: () => null,
    getOutputRenderTarget: () => null,
    getMRT: () => null,
    coordinateSystem: 2000,
    toneMapping: 0,
    outputColorSpace: 'srgb',
    currentColorSpace: 'srgb',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = new (B as any)(new Mesh(new PlaneGeometry(), m), renderer);
  b.material = m;
  b.camera = new OrthographicCamera();
  b.scene = new Scene();
  b.build();
  return b.fragmentShader as string;
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
      const ls = loops(fragment(B));
      expect(ls.some((l) => l.outer.length >= 1)).toBe(true); // the light loop holds the shadow loops
      for (const l of ls) expect(l.outer, `loop ${l.name} inside ${l.outer.join(', ')}`).not.toContain(l.name);
    });
  }
});
