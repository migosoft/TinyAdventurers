import {
  BufferAttribute,
  Box3,
  BufferGeometry,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  NodeMaterial,
  OrthographicCamera,
  QuadMesh,
  RedFormat,
  RGFormat,
  RGBAFormat,
  RenderTarget,
  Scene,
  Sphere,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGPURenderer,
  DepthTexture,
} from 'three/webgpu';
import type { StoneField } from './stone/field';
import { sharpCopyNode } from './sharpCopy';
import { snapGround, viewRay, type Cam } from './camera';
import { WALL_H, cellHeight, heightBytes } from './heights';
import type { TileMap } from '../sim/map';
import type { Dynamic, Quads } from './cards';
import type { SightMask } from './sightmask';
import { cssColour, stoneClear, type Light } from './light';
import type { Crack } from './air/cracks';
import { makeShaftPass, type ShaftPass } from './air/shaftNodes';
import { shaftPlan, type ShaftPlan } from './air/shafts';
import { makeLighting } from './lightNodes';
import { CASTER_CAP, footprint, type ShadowCaster } from './lights';
import { cardSightData, figureSight, fxSightData, glowSightData, shadowSightData, smokeUpload, type SmokeArrays } from './sightAttrs';
import type { FxBuf } from './models/fx';
import type { SmokeBuf } from './fx/smoke';
import { makeSight, SIGHT_OFF, type SightFrame } from './sightNodes';
import { makeCoverShared } from './cover/coverRead';
import { bushelMaterial, coverSheetMaterial } from './cover/coverNodes';
import { CoverLayer, type CoverFrame } from './cover/coverLayer';
import type { CoverResult } from './cover/coverJob';
import { GroundTooLargeError, limitOr } from './groundError';
import { AIR_ORDER, airMaterials } from './air/airNodes';
import { airQuads, hazeQuads, newAirBuffers } from './air/airQuads';
import type { AirParts } from './air/airParts';
import { cardMaterial, fxLitMaterial, fxMaterial, glowMaterial, maskMaterial, shadowMaterial, SMOKE_ORDER, smokeMaterial, sunCasterMaterial, viewTowardUniform, worldMaterial } from './materials';
import type { SunFit, Vec3 } from './sun';
import { sunCamera, sunDepthTexture } from './sunNodes';
import type { TreeFrame } from './trees/forest';
import { TreeLayer } from './trees/treeLayer';
import { treeMaterials } from './trees/treeNodes';
import { makeBrushUniforms, setBrushers } from './windNodes';
import type { Brusher } from './brush';
import type { FigureInst } from './models/instances';
import type { FigureKit } from './models/kit';
import { FigureLayer, figureLooks, imageTexture } from './models/layer';
import { figureMaterials, seeMaterials } from './models/nodes';
import type { BuiltInst } from './built';
import { LichLayer, type BuiltLayer } from './lich/layer';
import { lichMaterials } from './lich/nodes';
import type { RenderPlan } from './quality';
import type { FrameTimer } from '../game/frameTimer';
import type { R3dSystem } from './stats';
import { CHUNK, buildChunk, chunkGrid, chunksOfTile, type FrameRects, type StoneKit, type WorldArrays } from './worldMesh';
import { noMarks, placeMarks, type Marks, type Taken } from './stone/place';
import { layoutMoved, planKeys, planSheets, unplanned, type SheetPlan } from './stone/plan';
import { floorHeight } from './stone/shape';
import { buildCrystalChunk, crystalChunkOf, switchedChunks } from './stone/crystals';
import { crystalMaterial } from './stone/crystalNodes';
import { buildTorchChunk, torchChunkOf } from './torch/torch';
import { FLAME_ORDER, FLAME_REACH, flameMaterial, holderMaterial } from './torch/torchNodes';
import { makeSheets, type Sheets } from './stone/sheets';
import type { StoneJobResult } from './stone/stoneJob';
import { stoneField } from './stone/field';
import { GRATE_DEPTH } from './stone/laidMesh';
import { buildDipChunk, dipClassChanged, type DipChunk } from './dips/dipMesh';
import { dipMaterial } from './dips/dipNodes';
import { BED_RES, LAVA_LEVEL, WATER_LEVEL } from './dips/shape';
import { refreshWaterField, waterField } from './water/waterField';
import { buildWaterChunk } from './water/waterMesh';
import { ceilingMaterial, waterMaterial, type WaterSky } from './water/waterNodes';
import { CEILING_LAYER, WATER_LAYER, mirrorPose, picturePasses, poolInView } from './water/passes';
import { BUBBLE } from './lava/bubbles';
import { buildLavaChunk, buildShimmerChunk, type LavaChunk } from './lava/lavaMesh';
import { lavaMaterial, shimmerMaterial } from './lava/lavaNodes';
import { FIELD_OLD, buildField, fieldMaterial as makeFieldMaterial, fieldUniforms } from './fieldMesh';
import type { Opener } from './figures';
import { SEE_DEFAULTS, discQuads, discTowards, type SeeLook } from './seeThrough';

export interface Assets { image: HTMLImageElement; frames: FrameRects }
/** The world the view draws: `painted` marks a woodland (ground tiles read the ground image) and `stone` is null exactly then; `clear` is the clear colour, 'stone' the lit wall top's. */
export interface WorldInput {
  map: TileMap; painted: boolean; clear: 'stone' | [number, number, number]; stone: StoneField | null;
  /** The level's static lights and the heroes' start: what the stone's marks keep clear (#380). Without it the stone has no marks. */
  taken?: Taken;
  /** A dev page's switch (`?r3d=pond&dry=1`, #360): no water surface is built, so the beds show dry. */
  dry?: boolean;
}
/** The marks of a world (the same for the same world every time): what the view places, and what a stage's moss keeps clear of. */
export const marksOf = (world: WorldInput): Marks => (world.stone && world.taken ? placeMarks(world.map, world.stone, world.taken) : noMarks());
/** The painted ground, RGBA, w x h px. */
export interface GroundImage { w: number; h: number; data: Uint8ClampedArray }
/** The sight step's clip height outside the mirror pass: nothing is clipped (the start value of `Sight.clipBelow`). */
const NO_CLIP = -1e6;
/** How far above `LAVA_LEVEL` a lava chunk's bounds reach (tiles): the room for the biggest bubble's dome, with a little margin. */
const LAVA_DOME_ROOM = BUBBLE.rise * BUBBLE.size[1] * 1.25;
/** Whether the shadow lookup flips v (see the call in `draw`). */
const SUN_FLIP_V = true;

/** The sun of a woodland frame (#306). */
export interface SunFrame {
  /** Toward the light; the colour already includes the moon's fade. */
  dir: Vec3; colour: Vec3;
  fit: SunFit;
  /** The panel's Wall shadows switch also switches the sun's shadows. */
  shadows: boolean;
  clouds: boolean;
  /** The wind in tiles per second, and the seconds the clouds drift by. */
  wind: [number, number]; t: number;
}
/** The 3D figures of a frame (#338): what to draw and the kit that holds their models. */
export interface FigureFrame { insts: readonly FigureInst[]; kit: FigureKit; /** The built figures (#358), drawn by their own layers: required, so a stage that passes models cannot drop them. */ built: readonly BuiltInst[] }

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
  /** The figures that cast shadows, in the shader's slot order (`selectCasters`; the first `CASTER_CAP` are used); a light's `skip` indexes this list. */
  casters: readonly ShadowCaster[];
  /** What the hero cannot see this frame (#305); absent = off: every material looks as without it. */
  sight?: SightFrame;
  /** The sun (#306); absent or null: no sun, no sun pass, the sun's term is 0. */
  sun?: SunFrame | null;
  /** The woodland's grown trees (#329); absent: no trees. */
  trees?: TreeFrame;
  /** The 3D figures (#338); absent: none. */
  models?: FigureFrame;
  /** The effects (#308): blended triangles (unlit) and lit triangles; absent: none. */
  fx?: { tris: FxBuf; lit: FxBuf; /** The smoke quads of the smoke bodies (#359); absent: none. */ smoke?: SmokeBuf };
  /** The force field's life (#308): `age` seconds since it appeared (absent: an old one, no fade-in), `t` the clock. */
  field?: { age: number; t: number };
  /** The ground cover (#330); absent: off (the ground shows the cover flat, or none). */
  cover?: CoverFrame;
  /** The cracks of the Daylight lights near the view (#307; `selectCracks` + `crackOf`); absent = none. */
  cracks?: readonly Crack[];
  /** The light shafts through the cracks (#307); absent = off. The pass also needs at least one crack. */
  shafts?: boolean;
  /** The air (#307): the simulation's parts for this frame and the haze (`on`, `t` seconds for its drift); absent or null = none. */
  air?: { parts: AirParts; haze: { on: boolean; t: number } } | null;
  /** The brushers of this frame (#331): the figures that make bushes and bushels wiggle; absent = none. */
  brush?: readonly Brusher[];
  /** The water (#345): the packed ripples (null: none), its clock in seconds, and whether the mirror pass runs. Absent: no ripples, clock `t`, no mirror. */
  water?: { ripples: Float32Array | null; now: number; reflect: boolean; /** The sky a daylight water mirrors (#360: `waterSky`); absent: as it was. */ sky?: WaterSky };
  /** The lava's surface (#344): the packed bubbles and rings of `Lava3d.step`, its clock, and whether the heat shimmer runs (`shimmers(params)`). Absent: a calm surface, no shimmer. */
  lavaPool?: { bubbles: Float32Array | null; stirs: Float32Array | null; now: number; heat: boolean };
  /** The crystals (#380) and wall torches (#391): a big cluster whose light `off` names is drawn broken, a torch without its flame (the chunk is rebuilt only when a light of it switched); `now` is the clock of the lights' pulse (s), which the gems' glow and the flames follow. Absent: every one as it was, clock `t`. */
  wallLights?: { off: (lightId: number) => boolean; now: number };
}

export { GroundTooLargeError };

/**
 * The layer of everything the shaft pass's depth pre-pass must not draw (#307): translucent or additive things (shadows, decals, ghosts,
 * glows, the force field, later the air). The pre-pass camera has layer 0 only; the picture's camera has both. A layer does not reach a
 * mesh's children, so each mesh is set on its own.
 */
export const AIR_SKIP_LAYER = 1;

/** A second layer of the torch flames (#391), which only the water's mirror camera adds: the pool reflects a torch with its flame, and none of the other translucent things. */
const FLAME_MIRROR_LAYER = 4;

/** Puts `mesh` on the skip layer only (it is drawn by the picture's camera, not by the pre-pass). */
export function skipInAirPrepass<T extends Mesh>(mesh: T): T {
  mesh.layers.set(AIR_SKIP_LAYER);
  return mesh;
}

/** A mesh whose vertex buffers are refilled every frame; the buffers grow when a frame needs more. */
class DynMesh {
  readonly mesh: Mesh;
  private cap = 0;
  private readonly twins: Mesh[] = [];
  constructor(private readonly attrs: [name: string, size: number][], material: Mesh['material']) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.grow(1536);
  }
  private grow(cap: number): void {
    const old = this.mesh.geometry;
    const g = new BufferGeometry();
    for (const [name, size] of this.attrs) {
      // No DynamicDrawUsage: three re-uploads such an attribute in every render() of a frame, ignoring its version.
      g.setAttribute(name, new BufferAttribute(new Float32Array(cap * size), size));
    }
    this.mesh.geometry = g;
    for (const t of this.twins) t.geometry = g;
    old.dispose();
    this.cap = cap;
  }
  /** Another mesh over the same geometry (it follows when the buffers grow), drawn with `material` in another scene. */
  twin(material: Mesh['material']): Mesh {
    const t = new Mesh(this.mesh.geometry, material);
    t.frustumCulled = false;
    this.twins.push(t);
    return t;
  }
  /** `data` holds one array per attribute name, `count` vertices long. */
  set(data: Record<string, Float32Array>, count: number): void {
    if (count > this.cap) this.grow(Math.max(count, this.cap * 2));
    const g = this.mesh.geometry;
    g.setDrawRange(0, count);
    // An empty range would upload the whole array on WebGL (bufferSubData length 0 means "to the end").
    if (count === 0) return;
    for (const [name, size] of this.attrs) {
      const a = g.getAttribute(name) as BufferAttribute;
      (a.array as Float32Array).set(data[name].subarray(0, count * size));
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * size); // only the used part goes to the GPU
      a.needsUpdate = true;
    }
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
  /** The device's largest texture side (px): the sun's map is fitted at no more than this. */
  readonly maxTexture: number;
  /** Debug: makes the device or context fail on purpose. False when the backend offers no way or the view is lost or disposed. */
  forceLoss(): boolean;
  /** Debug: draws the last frame's scene again into an off-screen target and reads it back (RGBA bytes, `readRenderTargetPixelsAsync` order); null when lost, disposed or nothing was drawn yet. A canvas capture of WebGPU comes back black on some machines. */
  readback(): Promise<{ w: number; h: number; data: Uint8Array } | null>;
  /** Frees everything; later calls to `draw` do nothing and a late loss report is ignored. */
  dispose(): void;
  /** A tile of `world.map` changed: rebuilds its chunks (worldMesh.chunksOfTile), one height texel and the field. */
  tileChanged(x: number, z: number): void;
  /** Uploads the painted ground; throws GroundTooLargeError when it exceeds the device's texture limit. */
  setGround(img: GroundImage): void;
  /** The stone sheets' plan, the sheets themselves and the marks placed for that plan (#380); null on the woodland. A tile change that moves a face replaces all three (a new object each), which the paint job notices by identity. */
  readonly stone: { readonly plan: SheetPlan; readonly sheets: Sheets; readonly marks: Marks } | null;
  /** Writes the pages and faces the stone job finished into the sheets (one layer each is marked for upload). */
  setStonePages(r: StoneJobResult): void;
  /** Builds the ground cover's meshes and uploads its image (#330); throws GroundTooLargeError above the device's texture limit. */
  setCover(r: CoverResult): void;
  /** Chunk meshes (world, dips, water, lava and its shimmer): all of them, and those three drew in the last frame. */
  readonly chunks: { total: number; drawn: number };
  /** Scene objects, for the F3 panel. */
  readonly meshes: number;
  /** What the 3D figure layer drew in the last frame: instances and the id, piece and hull draws (#338, #364; for `window.__r3d.models`). */
  readonly figuresDrawn?: Readonly<{ figures: number; draws: number }>;
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

/** RGBA rows in reverse order. */
function flipRows(data: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(data.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(data.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  return out;
}

/** three's `dispose` is async: a failure on a lost renderer is a rejected promise, so it is caught here, not by the caller. */
function disposeRenderer(renderer: WebGPURenderer): void {
  Promise.resolve()
    .then(() => renderer.dispose())
    // three loses the GL context only of a canvas it made itself; ours is passed in, so the fallback's context is released here (the 16-context cap).
    .then(() => (renderer.backend as { gl?: WebGL2RenderingContext }).gl?.getExtension('WEBGL_lose_context')?.loseContext())
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
  // The stone sheets (#380): one plan and one pair of array textures per map layout. A woodland has none (its stone cells read layer -1: the flat stone colour).
  const deviceLimits = (): { size: number; layers: number } => {
    const b = renderer.backend as { isWebGPUBackend?: boolean; device?: { limits?: { maxTextureDimension2D: number; maxTextureArrayLayers: number } }; gl?: WebGL2RenderingContext };
    if (b.isWebGPUBackend) return { size: limitOr(b.device?.limits?.maxTextureDimension2D, 8192), layers: limitOr(b.device?.limits?.maxTextureArrayLayers, 256) };
    return { size: limitOr(b.gl?.getParameter(b.gl.MAX_TEXTURE_SIZE), 4096), layers: limitOr(b.gl?.getParameter(b.gl.MAX_ARRAY_TEXTURE_LAYERS), 256) };
  };
  /** New sheets for a plan, uploaded in full at once: a later `setPage` then marks only its layer (a layer update before the first upload would upload only that layer). */
  const newSheets = (p: SheetPlan): Sheets => {
    const s = makeSheets(p, deviceLimits());
    renderer.initTexture(s.ground);
    renderer.initTexture(s.wall);
    return s;
  };
  let plan: SheetPlan = world.stone ? planSheets(map) : unplanned();
  let sheets = newSheets(plan);
  const field = world.stone ?? stoneField(map);
  /** The marks of the map as it is now: one object for the mesh and the paint job, placed again with every new plan. */
  const marksNow = (): Marks => marksOf(world);
  const kit: StoneKit = { field, plan, marks: marksNow() };
  const heights = new DataTexture(heightBytes(map), map.w, map.h, RedFormat, UnsignedByteType);
  heights.unpackAlignment = 1;
  pixelTexture(heights);

  const groundStart = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
  pixelTexture(groundStart);
  const aw = assets.image.naturalWidth, ah = assets.image.naturalHeight;
  const lighting = makeLighting(heights, map, atlas, { sun: world.painted });
  // The see-through mask: a quarter of the scene's size, half floats (red: opening strength, green: depth, alpha: coverage), linear so the
  // discs' soft edges stay soft; resized in place (`setSize` keeps the texture object the wall shader holds).
  const mask = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, format: RGBAFormat, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false });
  mask.texture.colorSpace = NoColorSpace;
  const mm = maskMaterial();
  const maskDiscs = new DynMesh([['position', 3], ['uv', 2], ['near', 1]], mm.material);
  const maskScene = new Scene();
  maskScene.add(maskDiscs.mesh);
  const sight = makeSight();
  // The ground cover (#330): a 1x1 stand-in with the layer off until `setCover` uploads the image.
  const cover = makeCoverShared(new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType));
  const wm = worldMaterial(lighting, groundStart, mask.texture, sight, cover, sheets);
  const material = wm.material;
  const dm = dipMaterial(lighting, groundStart, sight, cover, sheets);
  // The water (#345). The field: the bed's height and the water's outline mask, half floats, filtered linearly (the lava light
  // texture is read the same way), kept up to date by `tileChanged`. A puddle's bed (#380) is the rock floor the stone mesh draws.
  const floorAt = (x: number, z: number): number => floorHeight(field, map, kit.marks, x, z);
  const wField = waterField(map, kit.marks.puddles, floorAt);
  const fieldTex = new DataTexture(new Uint16Array(wField.data.length), wField.w, wField.h, RGFormat, HalfFloatType);
  fieldTex.colorSpace = NoColorSpace;
  fieldTex.magFilter = LinearFilter;
  fieldTex.minFilter = LinearFilter;
  fieldTex.generateMipmaps = false;
  fieldTex.flipY = false;
  /** Converts the field's rows j0..j1 (inclusive) to half floats and marks the texture for upload. */
  const uploadField = (j0: number, j1: number): void => {
    const out = fieldTex.image.data as Uint16Array;
    for (let i = j0 * wField.w * 2, end = (j1 + 1) * wField.w * 2; i < end; i++) out[i] = DataUtils.toHalfFloat(wField.data[i]);
    fieldTex.needsUpdate = true;
  };
  uploadField(0, wField.h - 1);
  // Cards, flames and glows are pushed toward the camera along the view ray (the demo's depth bias); set each frame. The water reads it as its view vector.
  const toward = viewTowardUniform();
  const water = waterMaterial(lighting, sight, fieldTex, map, toward, { daylight: world.painted });
  // The copy of the opaque scene the water sees through, and the mirror picture: resized in place (the water's nodes keep the texture objects).
  const sceneCopy = new RenderTarget(1, 1, { depthBuffer: false, magFilter: NearestFilter, minFilter: NearestFilter, generateMipmaps: false });
  sceneCopy.texture.colorSpace = NoColorSpace;
  const mirrorTarget = new RenderTarget(1, 1, { depthBuffer: true, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false });
  mirrorTarget.texture.colorSpace = NoColorSpace;
  water.setScene(sceneCopy.texture);
  // The lava (#344): its glowing surface, and the hot air over it, which shows the same copy a little off.
  const lava = lavaMaterial(sight);
  const crystal = crystalMaterial(lighting, sight);
  /** The crystal lights that are off: their clusters are built broken. */
  const crystalsOff = new Set<number>();
  // The wall torches (#391): the holder lit by the room, the flame by itself.
  const holder = holderMaterial(lighting, sight);
  const flame = flameMaterial(sight, toward);
  /** The torch lights that are off: their torches are built without a flame. */
  const torchesOff = new Set<number>();
  const shimmer = shimmerMaterial(sight, lighting.lavaTexture, map, toward);
  shimmer.setScene(sceneCopy.texture);
  const mirrorCam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  mirrorCam.up.set(0, -1, 0);
  mirrorCam.layers.set(0);
  mirrorCam.layers.enable(CEILING_LAYER);
  mirrorCam.layers.enable(FLAME_MIRROR_LAYER);
  const mirrorMatrix = new Matrix4();

  const scene = new Scene();
  const { nx, nz } = chunkGrid(map);
  /** One mesh per chunk: static geometry, culled by its bounds. */
  interface ChunkMesh { mesh: Mesh }
  const counters = { drawn: 0 };
  /** True while the shaft pass's depth pre-pass renders the scene. */
  let inPrepass = false;
  const worldChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const dipChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const waterChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const lavaChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const shimmerChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const crystalChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const torchChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  const flameChunks: (ChunkMesh | null)[] = new Array(nx * nz).fill(null);
  type GroundBox = { x0: number; z0: number; x1: number; z1: number };
  /** The ground each water chunk's quads cover (tiles), for `poolInView`; null: rebuilt from the chunks at the next frame. */
  let waterBoxes: GroundBox[] | null = null;
  /** The same for the lava chunks' cells. */
  let lavaBoxes: GroundBox[] | null = null;
  /** Whether the frame draws the shimmer: only a frame that makes the scene copy may (the sheets show the copy). */
  let shimmerOn = false;
  const makeChunkMesh = (a: WorldArrays, cx: number, cz: number, top: number): ChunkMesh => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(a.position, 3));
    g.setAttribute('uv', new BufferAttribute(a.uv, 2));
    g.setAttribute('normal', new BufferAttribute(a.normal, 3));
    g.setAttribute('kind', new BufferAttribute(a.kind, 1));
    g.setAttribute('sheet', new BufferAttribute(a.sheet, 3));
    g.setAttribute('faceA', new BufferAttribute(a.faceA, 3));
    g.setAttribute('faceB', new BufferAttribute(a.faceB, 3));
    g.setAttribute('push', new BufferAttribute(a.push, 2));
    g.setIndex(new BufferAttribute(a.index, 1));
    const box = new Box3(
      new Vector3(cx * CHUNK, -GRATE_DEPTH, cz * CHUNK), // laid floors lie at or below 0, a grate's shaft deepest
      new Vector3(Math.min(map.w, cx * CHUNK + CHUNK), top, Math.min(map.h, cz * CHUNK + CHUNK)),
    );
    return finishMesh(g, box, material);
  };
  /** The dip ground of a chunk: seven attributes (position, normal, uv, kind, sheet, dip, marks) and an index; bounds from the chunk's real extent (it reaches down to the chasm bed). */
  const makeDipMesh = (d: DipChunk): ChunkMesh => {
    const a = d.arrays;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(a.position, 3));
    g.setAttribute('normal', new BufferAttribute(a.normal, 3));
    g.setAttribute('uv', new BufferAttribute(a.uv, 2));
    g.setAttribute('kind', new BufferAttribute(a.kind, 1));
    g.setAttribute('sheet', new BufferAttribute(a.sheet, 3));
    g.setAttribute('dip', new BufferAttribute(a.dip, 1));
    g.setAttribute('marks', new BufferAttribute(a.marks, 3));
    g.setIndex(new BufferAttribute(a.index, 1));
    const box = new Box3(new Vector3(...d.min), new Vector3(...d.max));
    return finishMesh(g, box, dm.material);
  };
  /** The water's surface in a chunk: its quads at `WATER_LEVEL`, on the water's own layer (drawn after the scene copy). */
  const makeWaterMesh = (position: Float32Array): ChunkMesh => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.computeBoundingBox();
    const cm = finishMesh(g, g.boundingBox!, water.material);
    cm.mesh.layers.set(WATER_LAYER);
    return cm;
  };
  /**
   * The lava's surface in a chunk (#344): an opaque sheet at `LAVA_LEVEL` in the opaque scene (layer 0). Its bounds reach a little
   * above the level for the bubbles' domes. The mesh stays at the origin: the material's vertex stage reads its positions as the world's.
   */
  const makeLavaMesh = (c: LavaChunk): ChunkMesh => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(c.position, 3));
    g.setAttribute('shore', new BufferAttribute(c.shore, 2));
    g.setIndex(new BufferAttribute(c.index, 1));
    const box = new Box3(new Vector3(c.box.x0, LAVA_LEVEL, c.box.z0), new Vector3(c.box.x1, LAVA_LEVEL + LAVA_DOME_ROOM, c.box.z1));
    return finishMesh(g, box, lava.material);
  };
  /**
   * The hot air over a chunk's lava: sheets on the water's layer (drawn after the scene copy, which they show), hidden on every frame
   * without the copy. `renderOrder` 0: the shadows, the decals and everything after them draw over it.
   */
  const makeShimmerMesh = (position: Float32Array): ChunkMesh => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.computeBoundingBox();
    const cm = finishMesh(g, g.boundingBox!, shimmer.material);
    cm.mesh.layers.set(WATER_LAYER);
    cm.mesh.renderOrder = 0;
    cm.mesh.visible = shimmerOn;
    return cm;
  };
  /** The crystal clusters of a chunk (#380), whole or broken by `crystalsOff`: an opaque mesh of its own layout in the opaque scene. */
  const buildCrystals = (cx: number, cz: number): void => {
    const i = cz * nx + cx;
    dropChunk(crystalChunks, i);
    const a = buildCrystalChunk(kit.marks, (id) => crystalsOff.has(id), cx, cz);
    if (!a) return;
    crystalChunks[i] = wallMesh(a, [['normal', 3], ['gem', 3]], crystal.material, 0);
  };
  /** The mesh of a chunk's crystals or torches: its `position`, `foot` and index, and the attributes named. `grow`: the box is this much wider on every side (tiles), for what its material moves. */
  const wallMesh = <A extends { position: Float32Array; foot: Float32Array; index: Uint32Array }>(a: A, attrs: [keyof A & string, number][], mat: NodeMaterial, grow: number): ChunkMesh => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(a.position, 3));
    g.setAttribute('foot', new BufferAttribute(a.foot, 2));
    for (const [name, size] of attrs) g.setAttribute(name, new BufferAttribute(a[name] as Float32Array, size));
    g.setIndex(new BufferAttribute(a.index, 1));
    g.computeBoundingBox();
    return finishMesh(g, g.boundingBox!.expandByScalar(grow), mat);
  };
  /**
   * The wall torches of a chunk (#391): the holders, an opaque mesh in the opaque scene, and the flames of those whose light is not in
   * `torchesOff`: see-through, their light added to the picture, so with the translucent things (not in the shafts' depth pre-pass,
   * after the scene copy the water reads) at `FLAME_ORDER`. Added light needs no sorting among the flames.
   */
  const buildTorchesAt = (cx: number, cz: number): void => {
    const i = cz * nx + cx;
    dropChunk(torchChunks, i);
    dropChunk(flameChunks, i);
    const a = buildTorchChunk(kit.marks.torches, (id) => torchesOff.has(id), cx, cz);
    if (a.holder) torchChunks[i] = wallMesh(a.holder, [['normal', 3], ['colour', 3], ['warm', 1]], holder, 0);
    if (!a.flame) return;
    const fm = (flameChunks[i] = wallMesh(a.flame, [['flame', 4], ['reach', 2]], flame.material, FLAME_REACH)).mesh;
    skipInAirPrepass(fm).renderOrder = FLAME_ORDER;
    fm.layers.enable(FLAME_MIRROR_LAYER);
  };
  const finishMesh = (g: BufferGeometry, box: Box3, mat: NodeMaterial): ChunkMesh => {
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new Sphere());
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = true;
    mesh.onBeforeRender = () => {
      // The shaft pass's depth pre-pass draws the chunks again; the readout counts the picture's draw.
      if (inPrepass) return;
      counters.drawn++;
    };
    scene.add(mesh);
    return { mesh };
  };
  const dropChunk = (list: (ChunkMesh | null)[], i: number): void => {
    const c = list[i];
    if (!c) return;
    scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    list[i] = null;
  };
  /** The tile of every cell as the chunks were built from it: `tileChanged` rebuilds the chunks only when the cell's class changed. */
  const builtTiles = Uint8Array.from(map.tiles);
  const buildAt = (cx: number, cz: number): void => {
    const i = cz * nx + cx;
    dropChunk(worldChunks, i);
    const c = buildChunk(map, world.painted, cx, cz, kit);
    if (c.world.count > 0) worldChunks[i] = makeChunkMesh(c.world, cx, cz, WALL_H);
    dropChunk(dipChunks, i);
    const d = buildDipChunk(map, world.painted, cx, cz, kit.plan);
    if (d) dipChunks[i] = makeDipMesh(d);
    dropChunk(waterChunks, i);
    const w = world.dry ? null : buildWaterChunk(map, cx, cz, kit.marks.puddles);
    if (w) waterChunks[i] = makeWaterMesh(w.position);
    waterBoxes = null;
    dropChunk(lavaChunks, i);
    dropChunk(shimmerChunks, i);
    const l = buildLavaChunk(map, cx, cz);
    if (l) lavaChunks[i] = makeLavaMesh(l);
    const s = buildShimmerChunk(map, cx, cz);
    if (s) shimmerChunks[i] = makeShimmerMesh(s.position);
    lavaBoxes = null;
    buildCrystals(cx, cz);
    buildTorchesAt(cx, cz);
  };
  /** What the sheets' plan was made from (per chunk); `tileChanged` compares it (`layoutMoved`). Empty on the woodland. */
  let keys: string[] = world.stone ? planKeys(map) : [];
  /** Plans and uploads new sheets for the map as it is now (a face appeared or went, or a chunk gained or lost its ground page); every chunk's layers move, so the caller rebuilds every chunk. Throws StoneTooLargeError before changing anything when the device cannot hold them. */
  const replan = (): void => {
    const p = planSheets(map);
    const next = newSheets(p);
    const old = sheets;
    plan = p;
    sheets = next;
    kit.plan = p;
    kit.marks = marksNow();
    wm.setSheets(next);
    dm.setSheets(next);
    old.dispose();
    keys = planKeys(map);
  };
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) buildAt(cx, cz);
  const allChunks = [worldChunks, dipChunks, waterChunks, lavaChunks, shimmerChunks, crystalChunks, torchChunks, flameChunks];
  const chunkTotal = (): number => allChunks.reduce((n, list) => n + list.filter(Boolean).length, 0);
  const boxesOf = (list: (ChunkMesh | null)[]): GroundBox[] => {
    const out: GroundBox[] = [];
    for (const c of list) {
      const b = c?.mesh.geometry.boundingBox;
      if (b) out.push({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z });
    }
    return out;
  };
  const boxesOfWater = (): GroundBox[] => (waterBoxes ??= boxesOf(waterChunks));
  const boxesOfLava = (): GroundBox[] => (lavaBoxes ??= boxesOf(lavaChunks));
  // The ceiling only the mirror pass draws (#345): one quad over the map at the walls' height, facing down. A painted map has none: its water (#360) mirrors the sky where the mirror pass drew nothing.
  const ceilingMat = world.painted ? null : ceilingMaterial(lighting, sight);
  let ceiling: Mesh | null = null;
  if (ceilingMat) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, WALL_H, 0, map.w, WALL_H, 0, map.w, WALL_H, map.h, 0, WALL_H, 0, map.w, WALL_H, map.h, 0, WALL_H, map.h]), 3));
    ceiling = new Mesh(g, ceilingMat);
    ceiling.frustumCulled = false;
    ceiling.layers.set(CEILING_LAYER);
    scene.add(ceiling);
  }
  const chunks = { total: chunkTotal(), drawn: 0 };

  // The force field: one unlit, translucent mesh over every closed door cell.
  const fieldU = fieldUniforms();
  const fieldMaterial = makeFieldMaterial(sight, fieldU);
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
    g.setAttribute('edge', new BufferAttribute(f.edge, 1));
    g.setAttribute('y01', new BufferAttribute(f.y01, 1));
    fieldMesh = new Mesh(g, fieldMaterial);
    fieldMesh.frustumCulled = false;
    fieldMesh.renderOrder = 2;
    skipInAirPrepass(fieldMesh);
    scene.add(fieldMesh);
  };
  rebuildField();

  // Cards share one vertex layout in three materials: opaque upright, translucent upright (sorted back to front by the caller) and translucent flat (floor decals).
  const card = cardMaterial(atlas, aw, ah, lighting, toward, sight);
  const ghost = cardMaterial(atlas, aw, ah, lighting, toward, sight, { translucent: true });
  // Translucent too: a sleeping incorporeal figure and the skulls (0.85) have an alpha. No depth write, drawn after the shadows.
  const decal = cardMaterial(atlas, aw, ah, lighting, toward, sight, { flat: true, translucent: true });
  const glow = glowMaterial(sight);
  const shadow = shadowMaterial(sight);
  const cardAttrs: [string, number][] = [['position', 3], ['uv', 2], ['tint', 4], ['alpha', 1], ['shade', 2], ['sight', 3], ['cardFoot', 2]];
  const cards = new DynMesh(cardAttrs, card.material);
  // The sun's pass (#306): the opaque cards again, each turned to face the light, into a depth map. Made when the first sun frame comes.
  const sunLight = lighting.sun;
  // Only a world with a sun (the painted woodland) has the pass; the others never build it.
  const hasSun = world.painted;
  const casterMaterial = hasSun ? sunCasterMaterial(atlas, aw, ah, sunLight, sight) : null;
  const sunScene = new Scene();
  if (casterMaterial) sunScene.add(cards.twin(casterMaterial));
  let sunCam: OrthographicCamera | null = null;
  let sunTarget: RenderTarget | null = null;
  let sunDepth: DepthTexture | null = null;
  const sunStandIn = sunDepthTexture(1);
  const sunTargetFor = (size: number): DepthTexture => {
    if (!sunTarget || sunTarget.width !== size) {
      sunTarget?.dispose();
      sunDepth?.dispose();
      sunDepth = sunDepthTexture(size);
      sunTarget = new RenderTarget(size, size, { depthBuffer: true, depthTexture: sunDepth, format: RedFormat, generateMipmaps: false });
    }
    return sunDepth!;
  };
  // The grown trees (#329): the layer holds the meshes of the forest's chunks in the scene and the sun's scene.
  // The brushers (#331): one set of uniforms for the bushes and the bushels, written every frame.
  const brush = makeBrushUniforms();
  const trees = new TreeLayer(scene, hasSun ? sunScene : null, (palette, shared) => treeMaterials({ lighting, sight, see: wm.see, mask: mask.texture, palette, shared, hasSun, cover, brush }));
  // The 3D figures (#338): the shared stone and sky pictures are made when the first model is drawn.
  let figureTex: ReturnType<typeof figureLooks> | null = null;
  // The id pass (#364): the pieces of the model figures drawn into an id target of the picture's size; the hulls read it (nodes.ts).
  const idScene = new Scene();
  const idTarget = new RenderTarget(1, 1, { depthBuffer: true, type: UnsignedByteType, format: RGBAFormat, magFilter: NearestFilter, minFilter: NearestFilter, generateMipmaps: false });
  idTarget.texture.colorSpace = NoColorSpace;
  const idSize = new Vector2();
  // `eyes: null` for a see-through model: its see-through material draws its eyes, and a petrified one shows none.
  const figures: FigureLayer = new FigureLayer(scene, hasSun ? sunScene : null, idScene, (rows, paint, model) => figureMaterials({ lighting, sight, hasSun, rows, paint, eyes: model.spectre?.seeThrough ? null : model.spectre?.eyes, idTex: idTarget.texture, ...(figureTex ??= figureLooks()), shared: figures.shared }), {
    // The see-through draws (the Ghost): on the layer of the translucent things, so the mirror and the shafts' depth pre-pass skip them and a pool's scene copy is taken without them.
    make: (rows, model) => seeMaterials({ sight, rows, shared: figures.shared, stands: model.stands!, peak: model.spectre!.seeThrough!.peak, eyes: model.spectre!.eyes }),
    layer: AIR_SKIP_LAYER,
  });
  // The built figures (#358): one layer per built key, made when the first instance of the key arrives (and its picture is ready). A new
  // key (#377, #379) is one more entry here. A view built after a lost device makes its own layers and pictures from the kit.
  const builtFactories: Record<string, (paint: Texture) => BuiltLayer> = {
    lich: (paint) => new LichLayer(scene, () => lichMaterials({ lighting, sight, shared: figures.shared, paint }), AIR_SKIP_LAYER),
  };
  const builtLayers = new Map<string, { layer: BuiltLayer; paint: Texture }>();
  const builtByKey = new Map<string, BuiltInst[]>();
  const noLayer = new Set<string>();
  const builtFrame = (f: FigureFrame | undefined): void => {
    for (const l of builtByKey.values()) l.length = 0;
    if (f) for (const i of f.built) { let l = builtByKey.get(i.key); if (!l) builtByKey.set(i.key, l = []); l.push(i); }
    for (const [key, list] of builtByKey) {
      if (list.length > 0 && !builtFactories[key] && !noLayer.has(key)) { noLayer.add(key); console.warn(`built figure ${key}: no layer factory in view.ts, nothing is drawn`); }
      let e = builtLayers.get(key);
      if (!e && list.length > 0 && f && builtFactories[key]) {
        const img = f.kit.picture(key);
        if (img) { const paint = imageTexture(img, { mips: true }); builtLayers.set(key, e = { layer: builtFactories[key](paint), paint }); }
      }
      e?.layer.frame(list, (id) => slotOf.get(id) ?? -1);
    }
  };
  // The ground cover (#330): the sheets and bushels share the `cover` uniforms and image with the ground and the trees.
  const coverLayer = new CoverLayer(scene, cover, { sheet: coverSheetMaterial({ lighting, sight, shared: cover }), bushel: bushelMaterial({ lighting, sight, toward, shared: cover, brush }) });
  const ghosts = new DynMesh(cardAttrs, ghost.material);
  const decals = new DynMesh(cardAttrs, decal.material);
  const shadows = new DynMesh([['position', 3], ['uv', 2], ['alpha', 1], ['sight', 2]], shadow);
  const glows = new DynMesh([['position', 3], ['uv', 2], ['glowColor', 3], ['sight', 2]], glow);
  // The effects (#308): flat-coloured triangles, blended (`fxMat`) and lit (`fxLitMat`), each with its own growing upload arrays.
  const fxMat = fxMaterial(sight);
  const fxLitMat = fxLitMaterial(sight, lighting);
  const fxAttrs: [string, number][] = [['position', 3], ['rgba', 4], ['sight', 2]];
  const fxDyn = new DynMesh(fxAttrs, fxMat);
  const fxLitDyn = new DynMesh(fxAttrs, fxLitMat);
  // The smoke of the smoke bodies (#359): quads with a corner coordinate, drawn after the glows and before the effect triangles.
  const smokeMat = smokeMaterial(sight);
  const smokeDyn = new DynMesh([['position', 3], ['rgba', 4], ['c', 4], ['sight', 2]], smokeMat);
  const smokeArrays: SmokeArrays = { pos: new Float32Array(0), rgba: new Float32Array(0), c: new Float32Array(0), sight: new Float32Array(0) };
  const smokeData: Record<string, Float32Array> = {};   // `smokeArrays` under the attribute names, for `DynMesh.set`
  const fxArrays = new Map<DynMesh, { pos: Float32Array; rgba: Float32Array; sight: Float32Array }>();
  const fxUpload = (dyn: DynMesh, buf: FxBuf | undefined, mask: SightMask | null): void => {
    let a = fxArrays.get(dyn);
    if (!a) fxArrays.set(dyn, (a = { pos: new Float32Array(0), rgba: new Float32Array(0), sight: new Float32Array(0) }));
    const n = (buf?.n ?? 0) * 3;
    if (buf && a.pos.length < n * 3) { a.pos = new Float32Array(n * 6); a.rgba = new Float32Array(n * 8); a.sight = new Float32Array(n * 4); }
    if (buf) { a.pos.set(buf.position); a.rgba.set(buf.rgba); }
    dyn.set({ position: a.pos, rgba: a.rgba, sight: buf ? fxSightData(buf, mask, a.sight) : a.sight }, n);
  };
  shadows.mesh.renderOrder = 1;
  decals.mesh.renderOrder = 2;
  ghosts.mesh.renderOrder = 3;
  glows.mesh.renderOrder = 4;
  fxDyn.mesh.renderOrder = 5;
  fxLitDyn.mesh.renderOrder = 5;
  smokeDyn.mesh.renderOrder = SMOKE_ORDER;
  // The air (#307): specks and embers (additive), smoke and drops (blended) as camera-facing quads, and the haze sheets.
  const air = airMaterials(lighting, sight, { sun: world.painted, toward });
  const airBuf = newAirBuffers();
  const airAttrs: [string, number][] = [['position', 3], ['corner', 2], ['size', 2], ['rgba', 4], ['kind', 1], ['sightXZ', 2]];
  const airAdd = new DynMesh(airAttrs, air.add);
  const airBlend = new DynMesh(airAttrs, air.blend);
  const hazeDyn = new DynMesh([['position', 3], ['sheet', 4]], air.haze);
  const hazePos = new Float32Array(12 * 3), hazeSheet = new Float32Array(12 * 4);
  airBlend.mesh.renderOrder = AIR_ORDER.blend;
  airAdd.mesh.renderOrder = AIR_ORDER.add;
  hazeDyn.mesh.renderOrder = AIR_ORDER.haze;
  for (const d of [airAdd, airBlend, hazeDyn]) { skipInAirPrepass(d.mesh); d.mesh.visible = false; }
  // `look` is 5 floats per vertex (r, g, b, mode, alpha); a vertex attribute has at most 4 components, so it goes up as `tint` (r, g, b, mode) and `alpha`.
  let tintBuf = new Float32Array(0), alphaBuf = new Float32Array(0), shadeBuf = new Float32Array(0), sightBuf = new Float32Array(0), pairBuf = new Float32Array(0), footBuf = new Float32Array(0);
  /** The sight mask of this frame (null: off); set before the meshes go up. */
  let frameMask: SightMask | null = null;
  /** The caster slot of every entity id in this frame's list (set each frame before the cards go up). */
  const slotOf = new Map<number, number>();
  /** Scratch for the shadows' and glows' (hard, soft) pairs (each set copies out of it at once). */
  const pairScratch = (count: number): Float32Array => (pairBuf.length < count * 12 ? (pairBuf = new Float32Array(count * 12)) : pairBuf);
  const cardData = (q: Quads): Record<string, Float32Array> => {
    const n = q.count * 6;
    if (alphaBuf.length < n) { tintBuf = new Float32Array(n * 4); alphaBuf = new Float32Array(n); shadeBuf = new Float32Array(n * 2); }
    if (sightBuf.length < n * 3) sightBuf = new Float32Array(n * 3);
    if (footBuf.length < n * 2) footBuf = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      // The card's foot (x, z): the sun turns the card around it. Every quad of these passes has foot, owner and dark data (the arrays may be longer than `count` says).
      footBuf[i * 2] = q.foot[i * 4];
      footBuf[i * 2 + 1] = q.foot[i * 4 + 1];
      tintBuf[i * 4] = q.look[i * 5]; tintBuf[i * 4 + 1] = q.look[i * 5 + 1]; tintBuf[i * 4 + 2] = q.look[i * 5 + 2]; tintBuf[i * 4 + 3] = q.look[i * 5 + 3];
      alphaBuf[i] = q.look[i * 5 + 4];
      // shade: x = the slot of the card's owner in the caster list (-1 none: a shot, an image, a card whose owner casts nothing), y = dark flag.
      const owner = q.owner[i];
      shadeBuf[i * 2] = owner >= 0 ? (slotOf.get(owner) ?? -1) : -1;
      shadeBuf[i * 2 + 1] = q.dark[i];
    }
    return { position: q.position, uv: q.uv, tint: tintBuf, alpha: alphaBuf, shade: shadeBuf, sight: cardSightData(q, frameMask, sightBuf), cardFoot: footBuf };
  };

  // The off-screen copy: the quad shows the target's texels as they are (no lighting, no tone mapping, no colour conversion).
  let target: RenderTarget | null = null;
  const copyMaterial = new NodeMaterial();
  copyMaterial.depthTest = false;
  copyMaterial.depthWrite = false;
  const quad = new QuadMesh(copyMaterial);
  const fullViewport = new Vector4();
  // The copy samples the target linearly at sharpened positions (sharpCopy.ts), so the target is always LinearFilter.
  let copy: ReturnType<typeof sharpCopyNode> | null = null;
  function targetFor(w: number, h: number): RenderTarget {
    if (!target || target.width !== w || target.height !== h) {
      target?.dispose();
      target = new RenderTarget(w, h, { depthBuffer: true, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false });
      target.texture.colorSpace = NoColorSpace;
      if (!copy) {
        // Built once: the shader stays, a new target only swaps the sampled texture.
        copy = sharpCopyNode(target.texture);
        copyMaterial.fragmentNode = copy.node;
        copyMaterial.needsUpdate = true;
      } else copy.node.value = target.texture;
    }
    return target;
  }

  for (const d of [shadows, decals, ghosts, glows, smokeDyn, fxDyn, fxLitDyn]) skipInAirPrepass(d.mesh);
  scene.add(shadows.mesh, decals.mesh, cards.mesh, ghosts.mesh, glows.mesh, smokeDyn.mesh, fxDyn.mesh, fxLitDyn.mesh, airBlend.mesh, airAdd.mesh, hazeDyn.mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.up.set(0, 1, 0);
  camera.layers.enable(AIR_SKIP_LAYER);
  camera.layers.enable(WATER_LAYER);
  /** The picture's layers: the opaque scene (0), the translucent things and the water. */
  const pictureLayers = (): void => {
    camera.layers.set(0);
    camera.layers.enable(AIR_SKIP_LAYER);
    camera.layers.enable(WATER_LAYER);
  };
  /** Whether the last frame's picture was drawn with the scene copy (a pool in view), for `readback`. */
  let lastCopy = false;
  /**
   * The picture with a pool in view, into `target`: the opaque scene (layer 0), a copy of its colour, then the water and everything
   * translucent over it with the depth kept. The water reads the copy: what lies behind its surface.
   */
  const splitPicture = (rt: RenderTarget): void => {
    const auto = renderer.autoClear;
    try {
      camera.layers.set(0);
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      if (sceneCopy.width !== rt.width || sceneCopy.height !== rt.height) sceneCopy.setSize(rt.width, rt.height);
      renderer.setRenderTarget(sceneCopy);
      quad.render(renderer); // `quad` shows `target`, which `rt` is
      camera.layers.set(AIR_SKIP_LAYER);
      camera.layers.enable(WATER_LAYER);
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
    } finally {
      renderer.autoClear = auto;
      pictureLayers();
    }
  };

  // The light shafts (#307), made when the first frame with cracks and shafts on comes: a depth pre-pass of the opaque scene (layer 0
  // only, at the art size), the march into a small half-float target, and the additive composite over the picture. A lost device
  // rebuilds the whole view, these included; `dispose` frees them.
  interface ShaftKit {
    pass: ShaftPass; marchQuad: QuadMesh; compositeQuad: QuadMesh;
    /** The pre-pass camera: the picture's camera on layer 0 only, with the art-size frustum. */
    cam: OrthographicCamera;
    w: number; h: number; depthTex: DepthTexture; depth: RenderTarget; shaft: RenderTarget;
  }
  let shafts: ShaftKit | null = null;
  const makeShaftTargets = (sp: ShaftPlan): Pick<ShaftKit, 'w' | 'h' | 'depthTex' | 'depth' | 'shaft'> => {
    const depthTex = new DepthTexture(sp.artW, sp.artH);
    depthTex.minFilter = NearestFilter;
    depthTex.magFilter = NearestFilter;
    const depth = new RenderTarget(sp.artW, sp.artH, { depthBuffer: true, depthTexture: depthTex, magFilter: NearestFilter, minFilter: NearestFilter, generateMipmaps: false });
    depth.texture.colorSpace = NoColorSpace;
    const shaft = new RenderTarget(sp.artW, sp.artH, { depthBuffer: false, type: HalfFloatType, format: RGBAFormat, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false });
    shaft.texture.colorSpace = NoColorSpace;
    return { w: sp.artW, h: sp.artH, depthTex, depth, shaft };
  };
  const freeShaftTargets = (s: Pick<ShaftKit, 'depthTex' | 'depth' | 'shaft'>): void => {
    s.depth.dispose();
    s.shaft.dispose();
    s.depthTex.dispose();
  };
  /** The shaft plan of the last frame drawn (null: none ran), so `readback` can lay the shafts over its picture. */
  let lastShafts: ShaftPlan | null = null;
  const shaftToward = new Vector3();
  const shaftUvScale = new Vector2();
  const shaftTexel = new Vector2();
  /** The kit for this frame's plan: made at the first use, its targets rebuilt when the art size changes. */
  const shaftsFor = (sp: ShaftPlan): ShaftKit => {
    if (!shafts) {
      const pass = makeShaftPass(lighting, sight);
      shafts = { pass, marchQuad: new QuadMesh(pass.march), compositeQuad: new QuadMesh(pass.composite), cam: new OrthographicCamera(-1, 1, 1, -1, 0.1, 200), ...makeShaftTargets(sp) };
    } else if (shafts.w !== sp.artW || shafts.h !== sp.artH) {
      freeShaftTargets(shafts);
      Object.assign(shafts, makeShaftTargets(sp));
    }
    return shafts;
  };
  /** The composite lays the march over what is bound now (no clear). */
  const compositeShafts = (s: ShaftKit): void => {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    s.compositeQuad.render(renderer);
    renderer.autoClear = auto;
  };

  const be = renderer.backend as { isWebGPUBackend?: boolean; device?: { destroy(): void; limits?: { maxTextureDimension2D: number } }; gl?: WebGL2RenderingContext };
  // Fixed at creation: whether the backend has a way to fail on purpose, whatever the view's state later.
  const canForceLoss = be.isWebGPUBackend ? !!be.device : !!be.gl?.getExtension('WEBGL_lose_context');

  const clearColour = new Color();
  /** The last frame's scene size, for `readback`. */
  let lastSize: [number, number] | null = null;
  let canvasBg = '';
  let groundTex: Texture[] = [];
  const rawLimit = (): unknown => (be.isWebGPUBackend ? be.device?.limits?.maxTextureDimension2D : be.gl?.getParameter(be.gl.MAX_TEXTURE_SIZE));
  /** The texture limit for sizing (a safe default when the backend gives none) and for the ground checks (`Infinity`: unknown, try; #353). */
  const textureLimit = (): number => limitOr(rawLimit(), be.isWebGPUBackend ? 8192 : 4096);
  const groundLimit = (): number => limitOr(rawLimit(), Infinity);

  return {
    chunks,
    get meshes() {
      return scene.children.length;
    },
    get figuresDrawn() {
      return figures.drawn;
    },
    tileChanged(x, z) {
      if (disposed || lost || x < 0 || z < 0 || x >= map.w || z >= map.h) return;
      const cell = z * map.w + x, was = builtTiles[cell];
      // The sheets' layout first (#380): a move (a face appeared or went; a door opening or closing is none) re-plans, and a StoneTooLargeError leaves the view as it was.
      const moved = world.stone !== null && layoutMoved(map, x, z, was, keys);
      const hadPuddles = kit.marks.puddles.length > 0;
      if (moved) {
        replan();
        coverLayer.rebuild(); // the cover stands on the new marks' floor
      }
      (heights.image.data as Uint8Array)[cell] = Math.round(cellHeight(map.tiles[cell]) * 100);
      heights.needsUpdate = true;
      builtTiles[cell] = map.tiles[cell];
      const dips = dipClassChanged(was, map.tiles[cell]);
      // The water's field around the cell (the rows `refreshWaterField` can change), only when the dip class changed (its kind, height
      // or deep/shallow): a door opening must not cost an upload.
      // New marks (a replan placed them again) may have moved the puddles: the whole field then, only if the old or the new marks have any.
      if (moved && (hadPuddles || kit.marks.puddles.length > 0)) {
        wField.data.set(waterField(map, kit.marks.puddles, floorAt).data);
        uploadField(0, wField.h - 1);
      } else if (dips) {
        refreshWaterField(wField, map, x, z, kit.marks.puddles, floorAt);
        uploadField(Math.max(0, (z - 1) * BED_RES), Math.min(wField.h - 1, (z + 2) * BED_RES));
      }
      // The chunks are built from each cell's height, dip kind and ground kind (`dipClassChanged` names all three), the world chunk's
      // stone too: a door opening or closing changes none of them and rebuilds nothing.
      if (moved) {
        for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) buildAt(cx, cz);
      } else if (dips) for (const [cx, cz] of chunksOfTile(map, x, z)) buildAt(cx, cz);
      rebuildField();
      chunks.total = chunkTotal();
    },
    setGround(img) {
      if (disposed || lost) return;
      const limit = groundLimit();
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
      wm.setGround(next[0], next[1], img.w, img.h);
      dm.setGround(next[0], next[1], img.w, img.h);
      for (const t of groundTex) t.dispose();
      groundTex = next;
    },
    setCover(r) {
      if (disposed || lost) return;
      coverLayer.set(r, groundLimit(), world.stone ? floorAt : undefined);
    },
    get stone() {
      return world.stone ? { plan, sheets, marks: kit.marks } : null;
    },
    setStonePages(r) {
      if (disposed || lost || !world.stone) return;
      for (const p of r.pages) sheets.setPage('ground', p.layer, p.px);
      for (const f of r.faces) sheets.setFace(f.slot, f.px);
    },
    backend: be.isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback',
    get maxTexture() {
      return textureLimit();
    },
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
    async readback() {
      if (disposed || lost || !lastSize) return null;
      const [w, h] = lastSize;
      const rt = new RenderTarget(w, h, { depthBuffer: true, type: UnsignedByteType, format: RGBAFormat, generateMipmaps: false });
      // The hulls read the id target: only valid when it has the size of this redraw's target.
      const idWas = figures.shared.idOn.value;
      figures.shared.idOn.value = idWas > 0.5 && idTarget.width === w && idTarget.height === h ? 1 : 0;
      try {
        // The shafts of the last frame (the march target still holds them) over the picture, as `draw` does. The composite keeps the last
        // frame's `uvScale`, so this is right only when the readback target matches the picture's plan (its crop of the art-size frustum).
        if (lastCopy && target && target.width === w && target.height === h) {
          // A pool was in view: the same split picture as `draw` (the water's uniforms and the mirror picture are the last frame's), then copied over.
          splitPicture(target);
          if (lastShafts && shafts) compositeShafts(shafts);
          renderer.setRenderTarget(rt);
          quad.render(renderer);
        } else {
          renderer.setRenderTarget(rt);
          renderer.render(scene, camera);
          if (lastShafts && shafts) compositeShafts(shafts);
        }
        renderer.setRenderTarget(null);
        const data = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h)) as Uint8Array;
        // WebGL2 reads the bottom row first, WebGPU the top row first (seen with the same scene on both): make it top first.
        return { w, h, data: be.isWebGPUBackend ? data : flipRows(data, w, h) };
      } finally {
        figures.shared.idOn.value = idWas;
        rt.dispose();
      }
    },
    draw(f, timer) {
      if (disposed || lost) return 0;
      lastSize = [f.plan.targetW, f.plan.targetH];
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
      trees.shared.cosP.value = Math.cos(f.cam.pitch);
      figures.shared.cosP.value = Math.cos(f.cam.pitch);
      figures.shared.idOn.value = 0;   // the shafts' depth pass and the mirror run before the id pass
      setBrushers(brush, f.brush ?? [], f.t);
      coverLayer.frame(f.cover ?? { on: false, gh: 1, wind: false, t: f.t }, Math.cos(f.cam.pitch));
      toward.value.set(ray[0], ray[1], ray[2]);
      wm.smooth.value = f.smooth ? 1 : 0;
      dm.smooth.value = wm.smooth.value;
      dm.time.value = f.t;
      water.time.value = f.water?.now ?? f.t;
      water.setRipples(f.water?.ripples ?? null);
      if (f.water?.sky) water.setSky(f.water.sky);
      lava.time.value = shimmer.time.value = f.lavaPool?.now ?? f.t;
      crystal.time.value = flame.time.value = f.wallLights?.now ?? f.t;
      if (f.wallLights) {
        // A light that switched: its chunk's clusters are built again, broken or whole; its chunk's torches, with or without their flame.
        const dirty = switchedChunks(kit.marks.shards, f.wallLights.off, crystalsOff, crystalChunkOf);
        for (const [cx, cz] of dirty) buildCrystals(cx, cz);
        const relit = switchedChunks(kit.marks.torches, f.wallLights.off, torchesOff, torchChunkOf);
        for (const [cx, cz] of relit) buildTorchesAt(cx, cz);
        if (dirty.length || relit.length) chunks.total = chunkTotal();
      }
      lava.setBubbles(f.lavaPool?.bubbles ?? null);
      lava.setStirs(f.lavaPool?.stirs ?? null);
      fieldU.age.value = f.field ? f.field.age : FIELD_OLD;
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
      // Sight (#305): once per frame, before the meshes go up.
      const sf = f.sight ?? SIGHT_OFF;
      sight.set(sf);
      frameMask = sf.mode === 'off' ? null : sf.mask;
      lighting.setAmbient(f.ambient);
      const casters = f.casters.length > CASTER_CAP ? f.casters.slice(0, CASTER_CAP) : f.casters;
      slotOf.clear();
      casters.forEach((c, i) => { if (!slotOf.has(c.id)) slotOf.set(c.id, i); });
      lighting.setCasters(casters, f.cam.yaw);
      // One buffer per pass: the card scratch arrays are refilled between the sets (each set copies out of them at once).
      cards.set(cardData(d.cards), d.cards.count * 6);
      ghosts.set(cardData(d.ghosts), d.ghosts.count * 6);
      decals.set(cardData(d.decals), d.decals.count * 6);
      shadows.set({ position: d.shadows.position, uv: d.shadows.uv, alpha: d.shadows.alpha, sight: shadowSightData(d.shadows, frameMask, pairScratch(d.shadows.count)) }, d.shadows.count * 6);
      glows.set({ position: d.glows.position, uv: d.glows.uv, glowColor: d.glows.color, sight: glowSightData(d.glows, frameMask, pairScratch(d.glows.count)) }, d.glows.count * 6);
      fxUpload(fxDyn, f.fx?.tris, frameMask);   // the effects (#308): blended, then lit
      fxUpload(fxLitDyn, f.fx?.lit, frameMask);
      const smokeCorners = smokeUpload(f.fx?.smoke, frameMask, smokeArrays);   // the smoke (#359): a count of 0 draws nothing
      smokeData.position = smokeArrays.pos; smokeData.rgba = smokeArrays.rgba; smokeData.c = smokeArrays.c; smokeData.sight = smokeArrays.sight;
      smokeDyn.set(smokeData, smokeCorners);
      // The air (#307): the camera's right and up spread the quads; no air frame hides the meshes.
      const ca = Math.cos(f.cam.yaw), sa = Math.sin(f.cam.yaw), spa = Math.sin(f.cam.pitch);
      air.right.value.set(ca, 0, sa);
      air.up.value.set(sa * spa, Math.cos(f.cam.pitch), -ca * spa);
      const fa = f.air ?? null;
      if (fa) {
        const n = airQuads(fa.parts, airBuf);
        airAdd.set(airBuf.add as unknown as Record<string, Float32Array>, n.add);
        airBlend.set(airBuf.blend as unknown as Record<string, Float32Array>, n.blend);
        air.time.value = fa.haze.t;
        if (fa.haze.on) {
          hazeQuads(footprint(f.cam, f.plan.halfW, f.plan.halfH), hazePos, hazeSheet);
          hazeDyn.set({ position: hazePos, sheet: hazeSheet }, 12);
        }
      }
      airAdd.mesh.visible = fa !== null && airAdd.mesh.geometry.drawRange.count > 0;
      airBlend.mesh.visible = fa !== null && airBlend.mesh.geometry.drawRange.count > 0;
      hazeDyn.mesh.visible = fa !== null && fa.haze.on;
      if (f.trees) { trees.sync(f.trees); void trees.warm(renderer, camera); }
      else if (trees.meshCount > 0) trees.clear();
      timer?.lap('upload');
      if (f.models) figureSight(f.models.insts, frameMask);
      if (f.models?.built) figureSight(f.models.built, frameMask);
      figures.frame(f.models, (id) => slotOf.get(id) ?? -1);
      builtFrame(f.models);
      timer?.lap('models');
      lighting.setLights(f.lights);
      lighting.cracks.set(f.cracks ?? []);
      lighting.setShadows(f.shadows);
      lighting.setLava(f.lava, f.lavaVersion);
      lighting.setDarkvision(f.darkvision);
      // The sun (#306): the camera's right on the ground turns the cards (as the lights' `uRight`), the lookup follows the frame's sun.
      const sf2 = hasSun ? f.sun ?? null : null;
      (sunLight.right.value as Vector3).set(Math.cos(f.cam.yaw), 0, Math.sin(f.cam.yaw));
      // With the shadows switched off the pass is skipped: no target is made or drawn into (the shaders bind the last map or the stand-in; their shadow term is 0).
      const sunPass = sf2 !== null && sf2.shadows;
      const sunMap = sunPass ? sunTargetFor(sf2.fit.size) : null;
      // v is flipped on both backends: three's TSL texture lookup takes v = 0 at the top of a render target's image (it flips the
      // coordinate itself for WebGL's bottom-left origin), and the sun camera's NDC y = +1 is the top. Checked on WebGL2 (without the
      // flip every shadow vanished); WebGPU follows from three's source and awaits a look on a real screen.
      sunLight.set(sf2, sunMap ?? sunDepth ?? sunStandIn, SUN_FLIP_V);
      // See through: the camera target (not snapped: the mask's depths use the same one) and the look; the mask pass runs unless off.
      const look = f.see?.look ?? SEE_DEFAULTS;
      wm.see.target.value.set(f.cam.x, 0, f.cam.z);
      const toward2 = discTowards(f.cam);
      wm.see.ray.value.set(toward2.x, 0, toward2.z); // horizontal: height does not make a wall nearer
      wm.see.mode.value = look.mode === 'off' ? 0 : 1;
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
      if (sunPass && sunTarget) {
        renderer.setRenderTarget(sunTarget);
        sunCam = sunCamera(sf2.fit, sunCam ?? undefined);
        renderer.render(sunScene, sunCam);
        timer?.lap('sun');
      }
      // The light shafts (#307): the depth of the opaque scene at the art size, then the march into the shaft target. The composite comes after the picture.
      const sp = shaftPlan(f);
      const sh = sp ? shaftsFor(sp) : null;
      lastShafts = sp;
      if (sp && sh) {
        // The art-size frustum, whatever the picture's: straight to the canvas the picture is a crop of it (the composite's uvScale).
        sh.cam.copy(camera, false);
        sh.cam.layers.set(0);
        sh.cam.left = -sp.artW / 32;
        sh.cam.right = sp.artW / 32;
        sh.cam.top = sp.artH / 32;
        sh.cam.bottom = -sp.artH / 32;
        sh.cam.updateProjectionMatrix();
        inPrepass = true;
        try {
          renderer.setRenderTarget(sh.depth);
          renderer.render(scene, sh.cam);
        } finally {
          inPrepass = false;
        }
        // After the render: the renderer sets the camera's clip space (WebGL's or WebGPU's) on its first use.
        shaftToward.set(ray[0], ray[1], ray[2]);
        shaftUvScale.set(sp.uvScale[0], sp.uvScale[1]);
        shaftTexel.set(sp.texel[0], sp.texel[1]);
        sh.pass.set({ depth: sh.depthTex, shaft: sh.shaft.texture, projInv: sh.cam.projectionMatrixInverse, camWorld: sh.cam.matrixWorld, toward: shaftToward, top: sp.top, uvScale: shaftUvScale, texel: shaftTexel });
        renderer.setRenderTarget(sh.shaft);
        sh.marchQuad.render(renderer);
        timer?.lap('shafts');
      }
      // The water (#345): with a pool in view the picture is split around a copy of the opaque scene, and (reflections on) the scene
      // above the water is drawn first from a camera mirrored in the water plane. Without a pool nothing extra runs. Lava in view
      // (#344) asks for the copy only for its heat shimmer, whose sheets are drawn on no other frame.
      const p = f.plan;
      const fp = footprint(f.cam, p.halfW, p.halfH);
      const wp = picturePasses({ water: poolInView(boxesOfWater(), fp), lava: poolInView(boxesOfLava(), fp), reflect: f.water?.reflect ?? false, heat: f.lavaPool?.heat ?? false }, p.targetW, p.targetH);
      lastCopy = wp.copy;
      if (wp.shimmer !== shimmerOn) {
        shimmerOn = wp.shimmer;
        for (const c of shimmerChunks) if (c) c.mesh.visible = shimmerOn;
      }
      if (wp.mirror) {
        if (mirrorTarget.width !== wp.mirror.w || mirrorTarget.height !== wp.mirror.h) mirrorTarget.setSize(wp.mirror.w, wp.mirror.h);
        const pose = mirrorPose([camera.position.x, camera.position.y, camera.position.z], [g.x, 0, g.z], WATER_LEVEL);
        mirrorCam.left = camera.left;
        mirrorCam.right = camera.right;
        mirrorCam.top = camera.top;
        mirrorCam.bottom = camera.bottom;
        mirrorCam.far = camera.far;
        mirrorCam.position.set(...pose.pos);
        mirrorCam.lookAt(...pose.target);
        mirrorCam.updateMatrixWorld(true);
        mirrorCam.updateProjectionMatrix();
        // For this pass only: everything below the water is clipped by the sight step, the walls stay closed (their openings read the
        // picture's screen), and the chunk counters rest as in the shafts' pre-pass.
        const seeMode = wm.see.mode.value;
        sight.clipBelow.value = WATER_LEVEL;
        wm.see.mode.value = 0;
        inPrepass = true;
        // Under a sky the mirror's picture is clear (alpha 0) where nothing stands: the water puts the sky there.
        if (world.painted) renderer.setClearColor(0x000000, 0);
        try {
          renderer.setRenderTarget(mirrorTarget);
          renderer.render(scene, mirrorCam);
        } finally {
          if (world.painted) renderer.setClearColor(clearColour, 1);
          inPrepass = false;
          wm.see.mode.value = seeMode;
          sight.clipBelow.value = NO_CLIP;
        }
        // After the render: the renderer sets the camera's clip space (WebGL's or WebGPU's) on its first use.
        mirrorMatrix.multiplyMatrices(mirrorCam.projectionMatrix, mirrorCam.matrixWorldInverse);
        water.setMirror({ picture: mirrorTarget.texture, matrix: mirrorMatrix });
        timer?.lap('mirror');
      } else water.setMirror(null);
      if (figures.drawn.figures > 0) {
        // The id pass: the size of the target the picture is drawn into, so the hull's texel fetch hits its own pixel on both backends.
        let iw = p.targetW, ih = p.targetH;
        if (p.direct && !wp.copy) {
          const sz = renderer.getDrawingBufferSize(idSize);
          iw = sz.x;
          ih = sz.y;
        }
        if (idTarget.width !== iw || idTarget.height !== ih) idTarget.setSize(iw, ih);
        renderer.setRenderTarget(idTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.render(idScene, camera);
        renderer.setClearColor(clearColour, 1);
        figures.shared.idOn.value = 1;
        timer?.lap('models');
      }
      if (p.direct && !wp.copy) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        // High draws straight to the canvas: there is no copy, so 'present' is not booked (it stays 0).
        timer?.lap('scene');
        if (sh) {
          compositeShafts(sh);
          timer?.lap('shafts');
        }
        return renderer.info.render.drawCalls;
      }
      // Into the picture's target; with a pool in view also on High, where the target has the canvas's size.
      const rt = targetFor(p.targetW, p.targetH);
      copy!.size.value.set(p.targetW, p.targetH);
      copy!.scale.value.set(p.scaleX, p.scaleY);
      if (wp.copy) splitPicture(rt);
      else {
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
      }
      timer?.lap('scene');
      if (sh) {
        compositeShafts(sh);
        timer?.lap('shafts');
      }
      renderer.setRenderTarget(null);
      if (p.direct) quad.render(renderer); // the whole canvas
      else {
        renderer.getViewport(fullViewport);
        // The viewport origin is the top-left corner of the canvas on both backends.
        renderer.setViewport(p.dstX, p.dstY, p.dstW, p.dstH);
        quad.render(renderer);
        renderer.setViewport(fullViewport);
      }
      timer?.lap('present');
      return renderer.info.render.drawCalls;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        atlas.dispose();
        sheets.dispose();
        heights.dispose();
        groundStart.dispose();
        for (const t of groundTex) t.dispose();
        for (const list of allChunks) for (const c of list) c?.mesh.geometry.dispose();
        fieldTex.dispose();
        water.material.dispose();
        lava.material.dispose();
        crystal.material.dispose();
        holder.dispose();
        flame.material.dispose();
        shimmer.material.dispose();
        sceneCopy.dispose();
        mirrorTarget.dispose();
        idTarget.dispose();
        ceiling?.geometry.dispose();
        ceilingMat?.dispose();
        fieldMesh?.geometry.dispose();
        fieldMaterial.dispose();
        material.dispose();
        dm.material.dispose();
        sight.dispose();
        for (const m of [card.material, ghost.material, decal.material, glow, shadow, smokeMat, fxMat, fxLitMat, air.add, air.blend, air.haze]) m.dispose();
        for (const dm of [cards, ghosts, decals, shadows, glows, smokeDyn, fxDyn, fxLitDyn, airAdd, airBlend, hazeDyn]) dm.dispose();
        target?.dispose();
        if (shafts) {
          freeShaftTargets(shafts);
          shafts.pass.dispose();
          shafts = null;
        }
        copyMaterial.dispose();
        mask.dispose();
        sunTarget?.dispose();
        sunDepth?.dispose();
        sunStandIn.dispose();
        casterMaterial?.dispose();
        trees.dispose();
        figures.dispose();
        for (const e of builtLayers.values()) { e.layer.dispose(); e.paint.dispose(); }
        builtLayers.clear();
        figureTex?.dispose();
        coverLayer.dispose();
        mm.material.dispose();
        maskDiscs.dispose();
      } finally {
        disposeRenderer(renderer);
      }
    },
  };
}
