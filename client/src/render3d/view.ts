import {
  Color,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Texture,
  WebGPURenderer,
} from 'three/webgpu';
import type { Atlas } from '../ui/atlas';

export interface View {
  readonly backend: 'WebGPU' | 'WebGL2 fallback';
  /** Draws one frame. */
  render(): void;
  dispose(): void;
}

/** The renderer, a clear colour and one atlas quad (a first proof that textures work). */
export async function createView(canvas: HTMLCanvasElement, opts: { forceWebGL: boolean }, atlas: Atlas): Promise<View> {
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL: opts.forceWebGL });
  await renderer.init();
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setPixelRatio(1);
  const size = () => {
    const r = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setSize(Math.max(1, Math.round(window.innerWidth * r)), Math.max(1, Math.round(window.innerHeight * r)), false);
  };
  size();
  window.addEventListener('resize', size);
  renderer.setClearColor(new Color(0.012, 0.01, 0.016), 1);

  const f = atlas.frames['floor_1'].frame;
  const tex = new Texture(atlas.img);
  tex.colorSpace = NoColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  const aw = atlas.img.naturalWidth;
  const ah = atlas.img.naturalHeight;
  tex.repeat.set(f.w / aw, f.h / ah);
  tex.offset.set(f.x / aw, f.y / ah);
  tex.needsUpdate = true;

  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: tex }));
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 5;

  return {
    backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback',
    render() {
      const a = renderer.domElement.width / Math.max(1, renderer.domElement.height);
      camera.left = -a;
      camera.right = a;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', size);
      tex.dispose();
      quad.geometry.dispose();
      (quad.material as MeshBasicMaterial).dispose();
      renderer.dispose();
    },
  };
}
