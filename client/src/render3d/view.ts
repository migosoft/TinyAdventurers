import {
  BufferAttribute,
  Box3,
  BufferGeometry,
  Color,
  MeshBasicNodeMaterial,
  DoubleSide,
  DataTexture,
  DynamicDrawUsage,
  HalfFloatType,
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
  RGBAFormat,
  RenderTarget,
  Scene,
  Sphere,
  Texture,
  UnsignedByteType,
  Vector3,
  Vector4,
  WebGPURenderer,
} from 'three/webgpu';
import { texture } from 'three/tsl';
import { snapGround, viewRay, type Cam } from './camera';
import { WALL_H, cellHeight, heightBytes } from './heights';
import type { TileMap } from '../sim/map';
import type { Dynamic, Quads } from './cards';
import { cssColour, stoneClear, type Light } from './light';
import { makeLighting } from './lightNodes';
import type { ShadowCaster } from './lights';
import { cardMaterial, emissiveMaterial, glowMaterial, maskMaterial, shadowMaterial, viewTowardUniform, worldMaterial } from './materials';
import type { RenderPlan } from './quality';
import type { FrameTimer } from '../game/frameTimer';
import type { R3dSystem } from './stats';
import { CHUNK, buildChunk, chunkGrid, chunksOfTile, type FrameRects, type WorldArrays } from './worldMesh';
import { buildTerrainChunk, stepTerrainUv, type TerrainChunk } from './terrainMesh';
import { FIELD_ALPHA, FIELD_COLOUR, buildField } from './fieldMesh';
import type { Opener } from './figures';
import { SEE_DEFAULTS, discQuads, discTowards, type SeeLook } from './seeThrough';

export interface Assets { image: HTMLImageElement; frames: FrameRects }
/** The world the view draws: `painted` marks a woodland (ground tiles read the ground image); `clear` is the clear colour, 'stone' the lit wall top's. */
export interface WorldInput { map: TileMap; painted: boolean; clear: 'stone' | [number, number, number] }
/** The painted ground, RGBA, w x h px. */
export interface GroundImage { w: number; h: number; data: Uint8ClampedArray }
/** `smooth`: floors and the ground read the linear texture at a sharpened position (a uniform; no recompile). `ambient`: the ambient light. */
export interface FrameInput {
  cam: Cam; plan: RenderPlan; dynamic: Dynamic; lights: Light[]; ambient: [number, number, number];
  shadows: boolean; smooth: boolean; t: number;
  /** What opens the walls this frame (the seen openers) and how; none given = no openers (the mode still applies). */
  see?: { openers: readonly Opener[]; look: SeeLook };
  /**
   * The lava lights as one rgba texel per tile (`map.w * map.h * 4`); null: no lava, the texture is cleared.
   * Uploaded only when the array object or `lavaVersion` changes: a caller that refills one array in place must bump `lavaVersion`.
   */
  lava: Float32Array | null;
  lavaVersion: number;
  /** The followed figure's darkvision: its centre (tiles) and reach (tiles); null: none. */
  darkvision: { x: number; z: number; reach: number } | null;
  /** The figures that cast shadows (empty until the shadow task). */
  casters: readonly ShadowCaster[];
}

/** The ground image is larger than the device's texture limit. */
export class GroundTooLargeError extends Error {
  constructor(w: number, h: number, limit: number) {
    super(`The ground image (${w} x ${h} px) is larger than this device's texture limit (${limit} px).`);
    this.name = 'GroundTooLargeError';
  }
}

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
  /** Draws one frame and returns its draw calls; `timer` gets the laps 'upload' (buffers and lights), 'scene' and, with the copy, 'present'. */
  draw(f: FrameInput, timer?: FrameTimer<R3dSystem>): number;
  /** Whether the backend has a way to fail on purpose (unlike `forceLoss`, true also after the view was lost). */
  readonly canForceLoss: boolean;
  /** Debug: makes the device or context fail on purpose. False when the backend offers no way or the view is lost or disposed. */
  forceLoss(): boolean;
  /** Frees everything; later calls to `draw` do nothing and a late loss report is ignored. */
  dispose(): void;
  /** A tile of `world.map` changed: rebuilds its chunks (worldMesh.chunksOfTile), one height texel and the field. */
  tileChanged(x: number, z: number): void;
  /** Uploads the painted ground; throws GroundTooLargeError when it exceeds the device's texture limit. */
  setGround(img: GroundImage): void;
  /** Chunk meshes (world and terrain): all of them, and those three drew in the last frame. */
  readonly chunks: { total: number; drawn: number };
  /** Scene objects, for the F3 panel. */
  readonly meshes: number;
}

/** The renderer could not be created or initialised: neither WebGPU nor WebGL2 is available. Any other error from `createView` is something else. */
export class RendererInitError extends Error {
  constructor(cause: unknown) {
    super(String(cause instanceof Error ? cause.message : cause));
    this.name = 'RendererInitError';
  }
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

/** three's `dispose` is async: a failure on a lost renderer is a rejected promise, so it is caught here, not by the caller. */
function disposeRenderer(renderer: WebGPURenderer): void {
  Promise.resolve()
    .then(() => renderer.dispose())
    .catch((e) => console.warn('Disposing the renderer failed:', e));
}

/** `onLost` is called once per loss of this view's device or context, never after `dispose`. A failed creation disposes its renderer. */
export async function createView(
  canvas: HTMLCanvasElement,
  assets: Assets,
  world: WorldInput,
  opts: { forceWebGL: boolean },
  onLost: (message: string) => void,
): Promise<View> {
  let renderer: WebGPURenderer;
  try {
    renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL: opts.forceWebGL });
  } catch (e) {
    throw new RendererInitError(e);
  }
  try {
    return await buildView(renderer, assets, world, onLost);
  } catch (e) {
    disposeRenderer(renderer);
    throw e;
  }
}

async function buildView(renderer: WebGPURenderer, assets: Assets, world: WorldInput, onLost: (message: string) => void): Promise<View> {
  const map = world.map;
  let lost = false;
  let disposed = false;
  const reportLoss = (message: string): void => {
    if (disposed || lost) return;
    lost = true;
    onLost(message);
  };
  // three reports a loss and then stops; it restores nothing.
  renderer.onDeviceLost = (info) => reportLoss(info.message);
  try {
    await renderer.init();
  } catch (e) {
    throw new RendererInitError(e);
  }
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.info.autoReset = false;

  const atlas = new Texture(assets.image);
  pixelTexture(atlas);
  // The same image, filtered linearly, for the smoothed ground.
  const atlasLinear = new Texture(assets.image);
  pixelTexture(atlasLinear);
  atlasLinear.magFilter = LinearFilter;
  atlasLinear.minFilter = LinearFilter;
  const heights = new DataTexture(heightBytes(map), map.w, map.h, RedFormat, UnsignedByteType);
  heights.unpackAlignment = 1;
  pixelTexture(heights);

  const groundStart = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
  pixelTexture(groundStart);
  const aw = assets.image.naturalWidth, ah = assets.image.naturalHeight;
  const lighting = makeLighting(heights, map);
  // The see-through mask: a quarter of the scene's size, half floats (red: opening strength, green: depth, alpha: coverage), linear so the
  // discs' soft edges stay soft; resized in place (`setSize` keeps the texture object the wall shader holds).
  const mask = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, format: RGBAFormat, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false });
  mask.texture.colorSpace = NoColorSpace;
  const mm = maskMaterial();
  const maskDiscs = new DynMesh([['position', 3], ['uv', 2], ['near', 1]], mm.material);
  const maskScene = new Scene();
  maskScene.add(maskDiscs.mesh);
  const wm = worldMaterial(atlas, atlasLinear, aw, ah, lighting, groundStart, mask.texture);
  const material = wm.material;

  const scene = new Scene();
  const { nx, nz } = chunkGrid(map);
  /** One mesh per chunk: static geometry, culled by its bounds. `terrain`: the uv and rect buffers are rewritten (terrain animation). */
  interface ChunkMesh { mesh: Mesh; terrain: TerrainChunk | null; seen: boolean }
  const counters = { drawn: 0 };
  const worldChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const terrainChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  let clock = 0;
  const makeChunkMesh = (a: WorldArrays, cx: number, cz: number, top: number, terrain: TerrainChunk | null): ChunkMesh => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(a.position, 3));
    const uvA = new BufferAttribute(a.uv, 2), rectA = new BufferAttribute(a.rect, 4);
    if (terrain) { uvA.setUsage(DynamicDrawUsage); rectA.setUsage(DynamicDrawUsage); }
    g.setAttribute('uv', uvA);
    g.setAttribute('normal', new BufferAttribute(a.normal, 3));
    g.setAttribute('kind', new BufferAttribute(a.kind, 1));
    g.setAttribute('rect', rectA);
    const box = new Box3(
      new Vector3(cx * CHUNK, 0, cz * CHUNK),
      new Vector3(Math.min(map.w, cx * CHUNK + CHUNK), top, Math.min(map.h, cz * CHUNK + CHUNK)),
    );
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new Sphere());
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = true;
    const cm: ChunkMesh = { mesh, terrain, seen: false };
    mesh.onBeforeRender = () => {
      counters.drawn++;
      cm.seen = true;
    };
    scene.add(mesh);
    return cm;
  };
  const dropChunk = (list: (ChunkMesh | null)[], i: number): void => {
    const c = list[i];
    if (!c) return;
    scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    list[i] = null;
  };
  const buildAt = (cx: number, cz: number): void => {
    const i = cz * nx + cx;
    dropChunk(worldChunks, i);
    dropChunk(terrainChunks, i);
    const c = buildChunk(map, world.painted, cx, cz, assets.frames);
    if (c.world.count > 0) worldChunks[i] = makeChunkMesh(c.world, cx, cz, WALL_H, null);
    const t = buildTerrainChunk(map, cx, cz, assets.frames, clock);
    if (t) terrainChunks[i] = makeChunkMesh(t.arrays, cx, cz, 0.1, t);
  };
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) buildAt(cx, cz);
  const chunkTotal = (): number => worldChunks.filter(Boolean).length + terrainChunks.filter(Boolean).length;
  const chunks = { total: chunkTotal(), drawn: 0 };

  // The force field: one unlit, translucent mesh over every closed door cell.
  const fieldMaterial = new MeshBasicNodeMaterial();
  fieldMaterial.color.setRGB(FIELD_COLOUR[0], FIELD_COLOUR[1], FIELD_COLOUR[2]);
  fieldMaterial.opacity = FIELD_ALPHA;
  fieldMaterial.transparent = true;
  fieldMaterial.depthWrite = false;
  fieldMaterial.side = DoubleSide;
  let fieldMesh: Mesh | null = null;
  const rebuildField = (): void => {
    if (fieldMesh) {
      scene.remove(fieldMesh);
      fieldMesh.geometry.dispose();
      fieldMesh = null;
    }
    const f = buildField(map);
    if (f.count === 0) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(f.position, 3));
    fieldMesh = new Mesh(g, fieldMaterial);
    fieldMesh.frustumCulled = false;
    fieldMesh.renderOrder = 2;
    scene.add(fieldMesh);
  };
  rebuildField();

  // Cards, flames and glows are pushed toward the camera along the view ray (the demo's depth bias); set each frame.
  const toward = viewTowardUniform();
  // Cards share one vertex layout in four materials: opaque upright, translucent upright (sorted back to front by the caller), translucent flat (floor decals), and emissive (torch flames).
  const card = cardMaterial(atlas, aw, ah, lighting, toward);
  const ghost = cardMaterial(atlas, aw, ah, lighting, toward, { translucent: true });
  // Translucent too: a sleeping incorporeal figure and the skulls (0.85) have an alpha. No depth write, drawn after the shadows.
  const decal = cardMaterial(atlas, aw, ah, lighting, toward, { flat: true, translucent: true });
  const emissive = emissiveMaterial(atlas, aw, ah, lighting, toward);
  const glow = glowMaterial();
  const shadow = shadowMaterial();
  const cardAttrs: [string, number][] = [['position', 3], ['uv', 2], ['tint', 4], ['alpha', 1], ['shade', 2]];
  const cards = new DynMesh(cardAttrs, card.material);
  const ghosts = new DynMesh(cardAttrs, ghost.material);
  const decals = new DynMesh(cardAttrs, decal.material);
  const shadows = new DynMesh([['position', 3], ['uv', 2], ['alpha', 1]], shadow);
  const flames = new DynMesh([['position', 3], ['uv', 2]], emissive);
  const glows = new DynMesh([['position', 3], ['uv', 2], ['glowColor', 3]], glow);
  shadows.mesh.renderOrder = 1;
  decals.mesh.renderOrder = 2;
  ghosts.mesh.renderOrder = 3;
  glows.mesh.renderOrder = 4;
  // `look` is 5 floats per vertex (r, g, b, mode, alpha); a vertex attribute has at most 4 components, so it goes up as `tint` (r, g, b, mode) and `alpha`.
  let tintBuf = new Float32Array(0), alphaBuf = new Float32Array(0), shadeBuf = new Float32Array(0);
  const cardData = (q: Quads): Record<string, Float32Array> => {
    const n = q.count * 6;
    if (alphaBuf.length < n) { tintBuf = new Float32Array(n * 4); alphaBuf = new Float32Array(n); }
    for (let i = 0; i < n; i++) {
      tintBuf[i * 4] = q.look[i * 5]; tintBuf[i * 4 + 1] = q.look[i * 5 + 1]; tintBuf[i * 4 + 2] = q.look[i * 5 + 2]; tintBuf[i * 4 + 3] = q.look[i * 5 + 3];
      alphaBuf[i] = q.look[i * 5 + 4];
    }
    if (shadeBuf.length < n * 2) {
      // (-1, 0): no caster slot, not dark. The figure shadows (own slot) and the dark flag fill it in later tasks.
      shadeBuf = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) shadeBuf[i * 2] = -1;
    }
    return { position: q.position, uv: q.uv, tint: tintBuf, alpha: alphaBuf, shade: shadeBuf };
  };

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

  scene.add(shadows.mesh, decals.mesh, cards.mesh, ghosts.mesh, flames.mesh, glows.mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.up.set(0, 1, 0);

  const be = renderer.backend as { isWebGPUBackend?: boolean; device?: { destroy(): void; limits?: { maxTextureDimension2D: number } }; gl?: WebGL2RenderingContext };
  // Fixed at creation: whether the backend has a way to fail on purpose, whatever the view's state later.
  const canForceLoss = be.isWebGPUBackend ? !!be.device : !!be.gl?.getExtension('WEBGL_lose_context');

  const clearColour = new Color();
  let canvasBg = '';
  let groundTex: Texture[] = [];
  const textureLimit = (): number => {
    if (be.isWebGPUBackend) return be.device?.limits?.maxTextureDimension2D ?? 8192;
    return be.gl ? (be.gl.getParameter(be.gl.MAX_TEXTURE_SIZE) as number) : 4096;
  };

  return {
    chunks,
    get meshes() {
      return scene.children.length;
    },
    tileChanged(x, z) {
      if (disposed || lost || x < 0 || z < 0 || x >= map.w || z >= map.h) return;
      (heights.image.data as Uint8Array)[z * map.w + x] = Math.round(cellHeight(map.tiles[z * map.w + x]) * 100);
      heights.needsUpdate = true;
      for (const [cx, cz] of chunksOfTile(map, x, z)) buildAt(cx, cz);
      rebuildField();
      chunks.total = chunkTotal();
    },
    setGround(img) {
      if (disposed || lost) return;
      const limit = textureLimit();
      if (img.w > limit || img.h > limit) throw new GroundTooLargeError(img.w, img.h, limit);
      const data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
      const mk = (filter: typeof NearestFilter | typeof LinearFilter): Texture => {
        const t = new DataTexture(data, img.w, img.h, RGBAFormat, UnsignedByteType);
        pixelTexture(t);
        t.magFilter = filter;
        t.minFilter = filter;
        return t;
      };
      const next = [mk(NearestFilter), mk(LinearFilter)];
      wm.setGround(next[0], next[1]);
      for (const t of groundTex) t.dispose();
      groundTex = next;
    },
    backend: be.isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback',
    setSize(pw, ph) {
      renderer.setSize(Math.max(1, pw), Math.max(1, ph), false);
    },
    canForceLoss,
    forceLoss() {
      if (disposed || lost) return false;
      if (be.isWebGPUBackend && be.device) {
        be.device.destroy();
        reportLoss('forced'); // three ignores a loss whose reason is "destroyed"
        return true;
      }
      const ext = be.gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext(); // the webglcontextlost event reaches onDeviceLost
      return true;
    },
    draw(f, timer) {
      if (disposed || lost) return 0;
      const g = snapGround(f.cam.pitch, f.cam.yaw, f.cam.x, f.cam.z);
      const ray = viewRay(f.cam.pitch, f.cam.yaw);
      camera.left = -f.plan.halfW;
      camera.right = f.plan.halfW;
      camera.top = f.plan.halfH;
      camera.bottom = -f.plan.halfH;
      // Far enough back that the bottom of the frame (halfH / tan(pitch) behind the target) stays in front of the near plane.
      const dist = 50 + f.plan.halfH / Math.tan(f.cam.pitch);
      camera.far = 2 * dist + 100;
      camera.position.set(g.x + ray[0] * dist, ray[1] * dist, g.z + ray[2] * dist);
      camera.lookAt(g.x, 0, g.z);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const d = f.dynamic;
      card.cosP.value = ghost.cosP.value = Math.cos(f.cam.pitch); // the decal pass is flat and has no stretch
      toward.value.set(ray[0], ray[1], ray[2]);
      wm.smooth.value = f.smooth ? 1 : 0;
      clock = f.t;
      // A terrain chunk animates only if the last frame drew it; the others catch up when they come into view.
      for (const c of terrainChunks) {
        if (!c) continue;
        const seen = c.seen;
        c.seen = false;
        if (!seen || !c.terrain) continue;
        if (stepTerrainUv(c.terrain, assets.frames, f.t)) {
          (c.mesh.geometry.getAttribute('uv') as BufferAttribute).needsUpdate = true;
          (c.mesh.geometry.getAttribute('rect') as BufferAttribute).needsUpdate = true;
        }
      }
      chunks.drawn = counters.drawn;
      counters.drawn = 0;
      const cc = world.clear === 'stone' ? stoneClear(f.ambient) : world.clear;
      clearColour.setRGB(cc[0], cc[1], cc[2]);
      renderer.setClearColor(clearColour, 1);
      // Off-screen (zoomed) frames are copied into the middle of the canvas and three never clears the rest (it stays transparent), so the canvas's own background carries the clear colour: the rock goes on beyond the picture.
      const bg = cssColour(cc);
      if (bg !== canvasBg) {
        canvasBg = bg;
        renderer.domElement.style.backgroundColor = bg;
      }
      lighting.setAmbient(f.ambient);
      // One buffer per pass: the card scratch arrays are refilled between the sets (each set copies out of them at once).
      cards.set(cardData(d.cards), d.cards.count * 6);
      ghosts.set(cardData(d.ghosts), d.ghosts.count * 6);
      decals.set(cardData(d.decals), d.decals.count * 6);
      shadows.set({ position: d.shadows.position, uv: d.shadows.uv, alpha: d.shadows.alpha }, d.shadows.count * 6);
      flames.set({ position: d.emissive.position, uv: d.emissive.uv }, d.emissive.count * 6);
      glows.set({ position: d.glows.position, uv: d.glows.uv, glowColor: d.glows.color }, d.glows.count * 6);
      lighting.setLights(f.lights);
      lighting.setShadows(f.shadows);
      lighting.setLava(f.lava, f.lavaVersion);
      lighting.setDarkvision(f.darkvision);
      // See through: the camera target (not snapped: the mask's depths use the same one) and the look; the mask pass runs unless off.
      const look = f.see?.look ?? SEE_DEFAULTS;
      wm.see.target.value.set(f.cam.x, 0, f.cam.z);
      const toward2 = discTowards(f.cam);
      wm.see.ray.value.set(toward2.x, 0, toward2.z); // horizontal: height does not make a wall nearer
      wm.see.mode.value = look.mode === 'off' ? 0 : look.mode === 'soft' ? 1 : 2;
      wm.see.keep.value = look.keep;
      mm.edge.value = look.edge;
      if (look.mode !== 'off') {
        const dq = discQuads(f.see?.openers ?? [], f.cam, look);
        maskDiscs.set({ position: dq.position, uv: dq.uv, near: dq.near }, dq.count * 6);
        const mw = Math.max(1, Math.ceil(f.plan.targetW / 4)), mh = Math.max(1, Math.ceil(f.plan.targetH / 4));
        if (mask.width !== mw || mask.height !== mh) mask.setSize(mw, mh);
        renderer.setRenderTarget(mask);
        renderer.setClearColor(0x000000, 0);
        renderer.render(maskScene, camera);
        renderer.setClearColor(clearColour, 1);
      }
      // The counter only accumulates; three resets it in its own animation loop, whose order against ours is not guaranteed.
      renderer.info.reset();
      timer?.lap('upload');
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
      if (disposed) return;
      disposed = true;
      try {
        atlas.dispose();
        atlasLinear.dispose();
        heights.dispose();
        groundStart.dispose();
        for (const t of groundTex) t.dispose();
        for (const c of [...worldChunks, ...terrainChunks]) c?.mesh.geometry.dispose();
        fieldMesh?.geometry.dispose();
        fieldMaterial.dispose();
        material.dispose();
        for (const m of [card.material, ghost.material, decal.material, emissive, glow, shadow]) m.dispose();
        for (const dm of [cards, ghosts, decals, shadows, flames, glows]) dm.dispose();
        target?.dispose();
        copyMaterial.dispose();
        mask.dispose();
        mm.material.dispose();
        maskDiscs.dispose();
      } finally {
        disposeRenderer(renderer);
      }
    },
  };
}
