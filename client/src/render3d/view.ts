import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  RedFormat,
  Scene,
  Texture,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu';
import { snapGround, viewRay, type Cam } from './camera';
import { heightBytes, type DemoMap } from './demoMap';
import { worldMaterial } from './materials';
import type { RenderPlan } from './quality';
import { buildWorld, type FrameRects } from './worldMesh';

export interface Assets { image: HTMLImageElement; frames: FrameRects }
/** `lights` and `dynamic` arrive with Task 6; `shadows` and `smooth` have no effect yet. */
export interface FrameInput { cam: Cam; plan: RenderPlan; shadows: boolean; smooth: boolean; t: number }
export interface View {
  readonly backend: 'WebGPU' | 'WebGL2 fallback';
  /** Device px. */
  setSize(w: number, h: number): void;
  /** Draws one frame and returns its draw calls. */
  draw(f: FrameInput): number;
  dispose(): void;
}

function pixelTexture(t: Texture): void {
  t.colorSpace = NoColorSpace;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.needsUpdate = true;
}

export async function createView(canvas: HTMLCanvasElement, assets: Assets, map: DemoMap, opts: { forceWebGL: boolean }): Promise<View> {
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL: opts.forceWebGL });
  await renderer.init();
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.setClearColor(new Color(0.012, 0.01, 0.016), 1);

  const atlas = new Texture(assets.image);
  pixelTexture(atlas);
  const heights = new DataTexture(heightBytes(map), map.w, map.h, RedFormat, UnsignedByteType);
  heights.unpackAlignment = 1;
  pixelTexture(heights);

  const w = buildWorld(map, assets.frames);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(w.position, 3));
  geometry.setAttribute('uv', new BufferAttribute(w.uv, 2));
  geometry.setAttribute('normal', new BufferAttribute(w.normal, 3));
  geometry.setAttribute('kind', new BufferAttribute(w.kind, 1));
  geometry.setAttribute('rect', new BufferAttribute(w.rect, 4));
  const material = worldMaterial(atlas, assets.image.naturalWidth, assets.image.naturalHeight, heights, map.w, map.h);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.up.set(0, 1, 0);

  return {
    backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback',
    setSize(pw, ph) {
      renderer.setSize(Math.max(1, pw), Math.max(1, ph), false);
    },
    draw(f) {
      const g = snapGround(f.cam.pitch, f.cam.yaw, f.cam.x, f.cam.z);
      const ray = viewRay(f.cam.pitch, f.cam.yaw);
      camera.left = -f.plan.halfW;
      camera.right = f.plan.halfW;
      camera.top = f.plan.halfH;
      camera.bottom = -f.plan.halfH;
      camera.position.set(g.x + ray[0] * 50, ray[1] * 50, g.z + ray[2] * 50);
      camera.lookAt(g.x, 0, g.z);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      return renderer.info.render.drawCalls;
    },
    dispose() {
      atlas.dispose();
      heights.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
