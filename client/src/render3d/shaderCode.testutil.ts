// Shader code as three generates it (GLSL for the WebGL2 fallback, WGSL for WebGPU), built without a GPU (#304, #305).
import { GLSLNodeBuilder, Mesh, OrthographicCamera, PlaneGeometry, Scene, WGSLNodeBuilder, type BufferGeometry, type NodeMaterial } from 'three/webgpu';
import { context } from 'three/tsl';

export type Builder = typeof GLSLNodeBuilder | typeof WGSLNodeBuilder;

/** The fragment shader of material `m` as `B` writes it (`compare`: the backend compares depth textures itself; `geometry`: the mesh's geometry, a plane by default). */
export function fragment(B: Builder, m: NodeMaterial, opts: { compare?: boolean; geometry?: BufferGeometry } = {}): string {
  return built(B, m, opts).fragmentShader as string;
}

/** The vertex shader of material `m`, as `fragment` builds it. */
export function vertex(B: Builder, m: NodeMaterial, opts: { compare?: boolean; geometry?: BufferGeometry } = {}): string {
  return built(B, m, opts).vertexShader as string;
}

/** The textures the fragment shader of material `m` binds, as `fragment` builds it. */
export function fragmentTextures(B: Builder, m: NodeMaterial, opts: { compare?: boolean; geometry?: BufferGeometry } = {}): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (built(B, m, opts).uniforms.fragment as any[]).filter((u) => u.node?.isTextureNode).map((u) => u.node.value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function built(B: Builder, m: NodeMaterial, opts: { compare?: boolean; geometry?: BufferGeometry }): any {
  // Just what the builders read from a renderer to write the code; nothing is drawn.
  const renderer = {
    backend: { isWebGPUBackend: B === WGSLNodeBuilder, capabilities: { getUniformBufferLimit: () => 65536 }, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) } },
    library: { fromMaterial: (x: unknown) => x },
    contextNode: context(),
    lighting: { getNode: () => null },
    nodes: { getCacheKey: () => 0 },
    debug: { diagnostics: { keywords: false } },
    hasFeature: () => false,
    // Whether the backend compares a depth texture itself (WebGL2 does; WebGPU in compatibility mode does not: three then uses a step).
    hasCompatibility: () => opts.compare ?? false,
    getRenderTarget: () => null,
    getOutputRenderTarget: () => null,
    getMRT: () => null,
    coordinateSystem: 2000,
    toneMapping: 0,
    outputColorSpace: 'srgb',
    currentColorSpace: 'srgb',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = new (B as any)(new Mesh(opts.geometry ?? new PlaneGeometry(), m), renderer);
  b.material = m;
  b.camera = new OrthographicCamera();
  b.scene = new Scene();
  b.build();
  return b;
}

/**
 * The lines of generated shader code that sample a texture or take a screen-space derivative (`fwidth`, `dFdx`, `dFdy`, `dpdx`, `dpdy`)
 * inside a data-dependent `if` or `else` block. Out of scope: loop bodies (a read inside any loop is not reported, and the lighting's
 * loops read shadow maps there) and an `if` whose condition compares two literal numbers (the lighting's build-time switches, which the
 * shader compiler folds away). A sample or derivative in a branch that pixels of one quad take differently is undefined (WGSL rejects
 * it).
 */
export function readsInBranches(code: string): string[] {
  const read = /\b(fwidth|dFdx|dFdy|dpdx|dpdy|textureSample\w*|texture)\s*\(/;
  const fixed = /\bif\s*\(\s*\(?\s*-?[\d.]+\s*[<>]=?\s*-?[\d.]+\s*\)?\s*\)/;
  const out: string[] = [];
  const stack: ('if' | 'else' | 'loop' | 'other')[] = [];
  for (const line of code.split('\n')) {
    if (read.test(line) && !stack.includes('loop') && (stack.includes('if') || stack.includes('else'))) out.push(line.trim());
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '{') {
        const before = line.slice(0, i);
        if (/\b(for|loop)\b/.test(before)) stack.push('loop');
        else if (/\bif\b/.test(before)) stack.push(fixed.test(before) ? 'other' : 'if');
        else if (/\belse\b/.test(before)) stack.push('else');
        else stack.push('other');
      } else if (line[i] === '}') stack.pop();
    }
  }
  return out;
}

/** Each `for` loop's index name and the names of the loops around it (by brace depth). */
export function loops(code: string): { name: string; outer: string[] }[] {
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
