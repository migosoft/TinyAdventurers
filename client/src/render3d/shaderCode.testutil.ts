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
