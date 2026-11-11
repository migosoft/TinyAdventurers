import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  NodeMaterial,
  OrthographicCamera,
  QuadMesh,
  RedFormat,
  RenderTarget,
  Scene,
  Texture,
  UnsignedByteType,
  Vector4,
  WebGPURenderer,
} from 'three/webgpu';
import { texture } from 'three/tsl';
import { snapGround, viewRay, type Cam } from './camera';
import { heightBytes, type DemoMap } from './demoMap';
import type { Dynamic } from './cards';
import type { Light } from './light';
import { makeLighting } from './lightNodes';
import { cardMaterial, emissiveMaterial, glowMaterial, worldMaterial } from './materials';
import type { RenderPlan } from './quality';
import type { FrameTimer } from '../game/frameTimer';
import type { R3dSystem } from './stats';
import { buildWorld, type FrameRects } from './worldMesh';

export interface Assets { image: HTMLImageElement; frames: FrameRects }
/** `smooth` has no effect yet. */
export interface FrameInput { cam: Cam; plan: RenderPlan; dynamic: Dynamic; lights: Light[]; shadows: boolean; smooth: boolean; t: number }

/** A mesh whose vertex buffers are refilled every frame; the buffers grow when a frame needs more. */
class DynMesh {
  readonly mesh: Mesh;
  private cap = 0;
  constructor(private readonly attrs: [name: string, size: number][], material: Mesh['material']) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.grow(1536);
  }
  private grow(cap: number): void {
    const old = this.mesh.geometry;
    const g = new BufferGeometry();
    for (const [name, size] of this.attrs) {
      const a = new BufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    this.mesh.geometry = g;
    old.dispose();
    this.cap = cap;
  }
  /** `data` holds one array per attribute name, `count` vertices long. */
  set(data: Record<string, Float32Array>, count: number): void {
    if (count > this.cap) this.grow(Math.max(count, this.cap * 2));
    const g = this.mesh.geometry;
    for (const [name, size] of this.attrs) {
      const a = g.getAttribute(name) as BufferAttribute;
      (a.array as Float32Array).set(data[name].subarray(0, count * size));
      a.needsUpdate = true;
    }
    g.setDrawRange(0, count);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
export interface View {
  readonly backend: 'WebGPU' | 'WebGL2 fallback';
  /** Device px. */
  setSize(w: number, h: number): void;
  /** Draws one frame and returns its draw calls; `timer` gets the laps 'scene' and, with the copy, 'present'. */
  draw(f: FrameInput, timer?: FrameTimer<R3dSystem>): number;
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
  renderer.info.autoReset = false;
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
  const aw = assets.image.naturalWidth, ah = assets.image.naturalHeight;
  const lighting = makeLighting(heights, map);
  const material = worldMaterial(atlas, aw, ah, lighting);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  const card = cardMaterial(atlas, aw, ah, lighting);
  const emissive = emissiveMaterial(atlas, aw, ah, lighting);
  const glow = glowMaterial();
  const cards = new DynMesh([['position', 3], ['uv', 2]], card.material);
  const flames = new DynMesh([['position', 3], ['uv', 2]], emissive);
  const glows = new DynMesh([['position', 3], ['uv', 2], ['glowColor', 3]], glow);
  glows.mesh.renderOrder = 1;

  // The off-screen copy: the quad shows the target's texels as they are (no lighting, no tone mapping, no colour conversion).
  let target: RenderTarget | null = null;
  const copyMaterial = new NodeMaterial();
  copyMaterial.depthTest = false;
  copyMaterial.depthWrite = false;
  const quad = new QuadMesh(copyMaterial);
  const fullViewport = new Vector4();
  function targetFor(w: number, h: number, linear: boolean): RenderTarget {
    const filter = linear ? LinearFilter : NearestFilter;
    if (!target || target.width !== w || target.height !== h) {
      target?.dispose();
      target = new RenderTarget(w, h, { depthBuffer: true, magFilter: filter, minFilter: filter, generateMipmaps: false });
      target.texture.colorSpace = NoColorSpace;
      copyMaterial.fragmentNode = texture(target.texture);
      copyMaterial.needsUpdate = true;
    } else if (target.texture.magFilter !== filter) {
      target.texture.magFilter = filter;
      target.texture.minFilter = filter;
      target.texture.needsUpdate = true;
    }
    return target;
  }

  const scene = new Scene();
  scene.add(mesh, cards.mesh, flames.mesh, glows.mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.up.set(0, 1, 0);

  return {
    backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback',
    setSize(pw, ph) {
      renderer.setSize(Math.max(1, pw), Math.max(1, ph), false);
    },
    draw(f, timer) {
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
      const d = f.dynamic;
      card.cosP.value = Math.cos(f.cam.pitch);
      cards.set({ position: d.cards.position, uv: d.cards.uv }, d.cards.count * 6);
      flames.set({ position: d.emissive.position, uv: d.emissive.uv }, d.emissive.count * 6);
      glows.set({ position: d.glows.position, uv: d.glows.uv, glowColor: d.glows.color }, d.glows.count * 6);
      lighting.setLights(f.lights);
      lighting.setShadows(f.shadows);
      // The counter only accumulates; three resets it in its own animation loop, whose order against ours is not guaranteed.
      renderer.info.reset();
      if (f.plan.direct) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        // High draws straight to the canvas: there is no copy, so 'present' is not booked (it stays 0).
        timer?.lap('scene');
        return renderer.info.render.drawCalls;
      }
      const p = f.plan;
      renderer.setRenderTarget(targetFor(p.targetW, p.targetH, p.linear));
      renderer.render(scene, camera);
      timer?.lap('scene');
      renderer.setRenderTarget(null);
      renderer.getViewport(fullViewport);
      // The viewport origin is the top-left corner of the canvas on both backends.
      renderer.setViewport(p.dstX, p.dstY, p.dstW, p.dstH);
      quad.render(renderer);
      renderer.setViewport(fullViewport);
      timer?.lap('present');
      return renderer.info.render.drawCalls;
    },
    dispose() {
      atlas.dispose();
      heights.dispose();
      geometry.dispose();
      material.dispose();
      for (const m of [card.material, emissive, glow]) m.dispose();
      for (const dm of [cards, flames, glows]) dm.dispose();
      target?.dispose();
      copyMaterial.dispose();
      renderer.dispose();
    },
  };
}
