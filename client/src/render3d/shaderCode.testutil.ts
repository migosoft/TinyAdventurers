// Shader code as three generates it (GLSL for the WebGL2 fallback, WGSL for WebGPU), built without a GPU (#304, #305).
import { GLSLNodeBuilder, Mesh, OrthographicCamera, PlaneGeometry, Scene, WGSLNodeBuilder, type NodeMaterial } from 'three/webgpu';
import { context } from 'three/tsl';

export type Builder = typeof GLSLNodeBuilder | typeof WGSLNodeBuilder;

/** The fragment shader of material `m` as `B` writes it. */
export function fragment(B: Builder, m: NodeMaterial): string {
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
