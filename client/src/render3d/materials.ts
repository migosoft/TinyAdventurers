// Node materials of the 3D view (TSL).
import { AdditiveBlending, CustomBlending, DoubleSide, MaxEquation, MeshBasicNodeMaterial, NodeMaterial, OneFactor, Vector2, Vector3 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { attribute, clamp, mx_noise_float, dot, float, floor, fwidth, fract, int, ivec2, length, max, mix, mod, normalize, positionGeometry, positionWorld, round, screenCoordinate, screenUV, select, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import { FACE_H, FACE_W, FLAG, PAGE, SLOPES } from './stone/format';
import type { Lighting } from './lightNodes';
import type { Sight } from './sightNodes';
import { coverTexel, kindLook, type CoverShared } from './cover/coverRead';
import type { SunLight } from './sunNodes';
import { CARD_GAIN } from './sun';
import { GRASS_FLAT, STONE } from './light';
import { cutPositionNode, cutUniforms, cutWeightNode, type CutUniforms } from './cutNodes';
import { SEE_DEFAULTS, SEE_DEPTH_BIAS, SEE_DEPTH_MARGIN } from './seeThrough';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** 1 where `on` holds, else 0. Picks by `mix` with these weights keep both sides at the top level of the shader (a `select` between colours or texels can become an `if`). */
export const weight = (on: N) => select(on, float(1), float(0));

const RIM = [0.4, 0.34, 0.33] as const;
/** How much of a light a wall top takes although the light hangs below it (0 none, 1 all). */
const TOP_WRAP = 0.5;
const PX = 1 / 16;

/** The demo's depth bias, in tiles toward the camera: cards 0.03 (the world has none). */
export const CARD_BIAS = 0.03;

/**
 * The unit vector from the target toward the camera, set by the view each frame. A vertex moved along it by `b` tiles
 * keeps its screen position (the view is orthographic) and gains `b` of depth on either backend.
 */
export function viewTowardUniform() {
  return uniform(new Vector3(0, 0, 1));
}

/** Tiles of mask texels (1.5) a wall face's sight read point is pushed out along its normal: the bilinear read then touches only texels in front of the face, never the wall tile's own. */
export const FACE_PUSH_TEXELS = 1.5;

/** The 4x4 Bayer threshold (0..15/16) of the output pixel: bits of x ^ y and y, as in `bayer4`. Build it where the sample sits (top level, no branch). */
export function bayerAt() {
  const bx = mod(floor(screenCoordinate.x), 4);
  const by = mod(floor(screenCoordinate.y), 4);
  return mod(bx.add(by), 2).mul(8).add(mod(by, 2).mul(4)).add(mod(floor(bx.div(2)).add(floor(by.div(2))), 2).mul(2)).add(mod(floor(by.div(2)), 2)).div(16);
}
export type ViewToward = ReturnType<typeof viewTowardUniform>;

/** The see-through uniforms every opening surface (walls, plants) reads: `mode` 0 off, 1 soft; `keep` 0..1; `target` and `ray` the camera target and the horizontal unit vector toward the camera (the mask's depth reference). */
export function seeUniforms() {
  return { mode: uniform(1), keep: uniform(SEE_DEFAULTS.keep), target: uniform(new Vector3()), ray: uniform(new Vector3(0, 0, 1)) };
}
/** The uniforms as `seeUniforms` made them (or as `worldMaterial` hands them back); the nodes are untyped. */
export type SeeUniforms = Record<keyof ReturnType<typeof seeUniforms>, N>;

/**
 * Whether a surface point `wp` opens (a bool node) where the see-through mask has a disc and the point is nearer the camera than the thing under it.
 * The mask is sampled linearly at the top level of the shader; its green
 * is a sum weighted by coverage (alpha), so dividing by alpha gives the value back at a disc's soft edge.
 */
export function seeOpenNode(maskTex: Texture, wp: N, see: SeeUniforms): N {
  const mk = texture(maskTex, screenUV);
  const strength = mk.r;
  const thingNear = float(SEE_DEPTH_BIAS).sub(mk.g.div(max(mk.a, 1e-4)));
  const wallNear = wp.sub(see.target).dot(see.ray);
  const inFront = strength.greaterThan(0).and(wallNear.greaterThan(thingNear.add(SEE_DEPTH_MARGIN)));
  const keepAt = float(1).sub(strength.mul(float(1).sub(see.keep)));
  const softOpen = bayerAt().greaterThanEqual(keepAt);
  return inFront.and(select(see.mode.greaterThan(0.5), softOpen, float(0).greaterThan(1)));
}

/** What `worldMaterial` hands back: the material and the handles the view drives. */
export interface WorldMaterial {
  material: MeshBasicNodeMaterial;
  /** 0 or 1: floors and the ground read the linear texture at a sharpened position. */
  smooth: { value: number };
  /** See-through uniforms: `mode` 0 off, 1 soft; `keep` 0..1; `target` and `ray` the camera target and the horizontal unit vector toward the camera (the mask's depth reference). */
  see: { mode: { value: number }; keep: { value: number }; target: { value: Vector3 }; ray: { value: Vector3 } };
  /** The wall cut's uniforms (#347; the torches share them): `on` 0 or 1, `floor`, `stub`, `line`, `ramp` in tiles, `edge` 0..1, `slope` = 1 / tan(pitch). */
  cut: { [K in Exclude<keyof CutUniforms, 'target' | 'env'>]: { value: number } } & { target: { value: Vector3 }; env: unknown };
  /** Points the ground kind at a new image (nearest and linear copies of it) and marks it ready. */
  setGround(nearest: Texture, linear: Texture, w: number, h: number): void;
  /** Points the stone reads at new sheets (the view built new ones: the map's faces changed). */
  setSheets(sheets: SheetTextures): void;
}

/** The two stone sheets as textures (array textures; see `stone/sheets.ts`). */
export interface SheetTextures { ground: Texture; wall: Texture }

export interface FlatTexel {
  /** The surface texel (rgba) of the point: the stone (alpha 1) or the woodland's ground. */
  texel: N;
  /** The relief's slope as a world vector (dimensionless): the surface normal is the vertex normal minus it. Zero on flat texels and on the ground kind. */
  bend: N;
  /** 1 on a ground texel the sheet flags as a joint or crack (`FLAG.groove`), else 0. */
  groove: N;
  /** 0 or 1: floors and the ground read the sheets at a sharpened position. */
  smooth: { value: number };
  /** Points the ground kind at a new image (nearest and linear copies of it) and marks it ready. */
  setGround(nearest: Texture, linear: Texture, w: number, h: number): void;
  setSheets(sheets: SheetTextures): void;
}

/** Where the weights of a sheet read are rounded: the layer attribute is a float, -1 for "none". */
const layerOf = (a: N): N => int(max(a.add(0.5), 0));

/** The slope index (0..6) of a relief byte's three bits as a slope: the table's constants summed by 0/1 weights (a nested `select` would put the relief texel's first use in a branch). */
const slopeOf = (i: N): N => {
  let r: N = float(0);
  for (let k = 0; k < SLOPES.length; k++) if (SLOPES[k] !== 0) r = r.add(weight(i.sub(k).abs().lessThan(0.5)).mul(SLOPES[k]));
  return r;
};

/** The edge (px) beyond a slot's right or bottom edge a fragment may sit by float error: the slot is told from the point, biased this much toward the slot before it. */
// shortcut: a fragment within SLOT_BIAS px of a slot's left or top edge is told to be in the slot before it (its clamp then reads 0.5 px outside), because the slot is derived from the point; pass the slot's corner as an attribute if that ever shows.
const SLOT_BIAS = 0.005;

/**
 * One read of a sheet at the px point `p` of layer `layer` (a float node; -1 gives layer 0 and the caller gives it weight 0), inside the
 * page or slot [lo, hi] (px). The colour is read at the sharpened position (nearest when `smooth` is 0) clamped half a texel inside; the
 * relief (alpha) at the texel's centre, so slopes and flags are never blended. All reads sit at the top level of the fragment code.
 */
function sheetRead(base: N, p: N, layer: N, lo: N, hi: N, smooth: N): { rgb: N; slope: N; groove: N } {
  const fw = max(fwidth(p), vec2(1e-6));
  const seam = floor(p.add(0.5));
  const sharp = seam.add(clamp(p.sub(seam).div(fw), -0.5, 0.5));
  const centre = floor(p).add(0.5);
  const inside = (q: N): N => clamp(q, lo.add(0.5), hi.sub(0.5)).div(PAGE);
  const d = layerOf(layer);
  const colour = base.sample(inside(mix(centre, sharp, smooth))).depth(d);
  const relief = base.sample(inside(centre)).depth(d);
  const a = round(relief.a.mul(255));
  const sx = floor(a.div(8)).sub(floor(a.div(64)).mul(8));
  const sy = a.sub(floor(a.div(8)).mul(8));
  return { rgb: colour.rgb, slope: vec2(slopeOf(sx), slopeOf(sy)), groove: weight(floor(a.div(64)).sub(FLAG.groove).abs().lessThan(0.5)) };
}

/**
 * The texel code of a flat surface, shared by the world and the dip material: the stone sheets (`kind` floor, face or top) or the painted
 * ground (`kind` > 2.5), read nearest or, with `smooth`, linear at a sharpened position. `kind` is the vertex attribute node. Each call makes its own uniforms.
 *
 * The stone: the vertex attribute `sheet` (ground u, v, layer) gives the ground read; with `faces` the attributes `faceA` and `faceB` (wall u, v,
 * layer) give the two wall reads. Weights: the ground by `smoothstep(0.45, 0.75, normal.y)` (always 1 without `faces`), the walls by the squared
 * horizontal normal; a layer of -1 has weight 0 and the rest is renormalised; where that leaves nothing (a block's skirt) every layer the
 * vertex has counts; with no layer at all the colour is `STONE`.
 */
export function flatTexel(sheets: SheetTextures, groundStart: Texture, kind: N, faces: boolean): FlatTexel {
  const isGround = kind.greaterThan(2.5);
  const p0 = uv();
  // Derivatives are taken here, at the top level of the fragment code and outside any branch (WGSL requires uniform control flow).
  const fw = max(fwidth(p0), vec2(1e-6));
  const seam = floor(p0.add(0.5));
  const sharp = seam.add(clamp(p0.sub(seam).div(fw), -0.5, 0.5));
  // The ground image's size in px, a uniform and not a vertex attribute: WebGPU allows 8 vertex buffers and the stone attributes use the rest.
  const size = uniform(new Vector2(1, 1));
  // Keep the linear taps inside the image.
  const p = clamp(sharp, vec2(0.5), size.sub(0.5));
  const smooth = uniform(0);
  const useSmooth = smooth.greaterThan(0.5);
  // Every read sits at the top level and float weights (exactly 0 or 1) pick among them: a `select` between texels can become an `if`, and sampling must stay in uniform control flow.

  // The stone: one base texture node per sheet (the reads are clones that follow its value, so `setSheets` swaps them all).
  const groundSheet = texture(sheets.ground), wallSheet = texture(sheets.wall);
  const sheet = attribute('sheet', 'vec3');
  const whole = { lo: vec2(0, 0), hi: vec2(PAGE, PAGE) };
  const g = sheetRead(groundSheet, sheet.xy, sheet.z, whole.lo, whole.hi, smooth);
  const wGround = faces ? smoothstep(0.45, 0.75, attribute('normal', 'vec3').y) : float(1);
  const availG = weight(sheet.z.greaterThan(-0.5));
  let stone: N, bend: N;
  if (faces) {
    const n = attribute('normal', 'vec3');
    const slot = vec2(FACE_W, FACE_H);
    const slotOf = (q: N): { lo: N; hi: N } => {
      const lo = floor(q.sub(SLOT_BIAS).div(slot)).mul(slot);
      return { lo, hi: lo.add(slot) };
    };
    const fa = attribute('faceA', 'vec3'), fb = attribute('faceB', 'vec3');
    const sa = slotOf(fa.xy), sb = slotOf(fb.xy);
    const a = sheetRead(wallSheet, fa.xy, fa.z, sa.lo, sa.hi, smooth);
    const b = sheetRead(wallSheet, fb.xy, fb.z, sb.lo, sb.hi, smooth);
    const nx2 = n.x.mul(n.x), nz2 = n.z.mul(n.z);
    const across = float(1).sub(wGround);
    const availA = weight(fa.z.greaterThan(-0.5)), availB = weight(fb.z.greaterThan(-0.5));
    const g0 = wGround.mul(availG);
    const a0 = across.mul(nz2.div(max(nx2.add(nz2), 1e-4))).mul(availA);
    const b0 = across.mul(nx2.div(max(nx2.add(nz2), 1e-4))).mul(availB);
    // A skirt faces a way its block has no sheet for (a floor block's side, a wall block's ledge): it takes the texels it has.
    const lost = weight(g0.add(a0).add(b0).lessThan(1e-4));
    const wG = g0.add(lost.mul(availG)), wA = a0.add(lost.mul(availA)), wB = b0.add(lost.mul(availB));
    const total = wG.add(wA).add(wB);
    const none = weight(total.lessThan(1e-4));
    const k = float(1).div(max(total, 1e-4));
    // The sheets' axes in the world: ground (+x, +z); the north/south wall plane (+x, down); the east/west one (+z, down).
    const gradG = vec3(g.slope.x, 0, g.slope.y), gradA = vec3(a.slope.x, a.slope.y.negate(), 0), gradB = vec3(0, b.slope.y.negate(), b.slope.x);
    stone = g.rgb.mul(wG.mul(k)).add(a.rgb.mul(wA.mul(k))).add(b.rgb.mul(wB.mul(k))).add(vec3(...STONE).mul(none));
    bend = gradG.mul(wG.mul(k)).add(gradA.mul(wA.mul(k))).add(gradB.mul(wB.mul(k)));
  } else {
    stone = mix(vec3(...STONE), g.rgb, availG);
    bend = vec3(g.slope.x, 0, g.slope.y).mul(availG);
  }

  const groundReady = uniform(0);
  const groundNear = texture(groundStart, p0.div(size));
  const groundLin = texture(groundStart, p.div(size));
  // Two texture nodes on one texture start are "mergeable" (same uniform hash, so one shared binding): then only one of them would follow `setGround`.
  groundNear.mergeable = false;
  groundLin.mergeable = false;
  const groundTexel = mix(groundNear, groundLin, weight(useSmooth));
  const readyW = weight(groundReady.greaterThan(0.5));
  const ground = vec4(mix(vec3(...GRASS_FLAT), groundTexel.rgb, readyW), mix(float(1), groundTexel.a, readyW));
  const groundW = weight(isGround);
  const bent = bend.mul(float(1).sub(groundW));
  // The relief reads must sit at the top level too. A node is emitted where it is first used, and the bent normal's first use is inside the
  // light loops, so the texel (built first, by the albedo) carries a zero term of it. The shader compiler drops the zero; the reads stay out of the loops.
  const top = bent.x.add(bent.y).add(bent.z).mul(0);
  const texel = vec4(mix(stone, ground.rgb, groundW).add(top), mix(float(1), ground.a, groundW));
  return {
    texel,
    bend: bent,
    groove: g.groove.mul(availG),
    smooth,
    setGround(nearest, linear, w, h) {
      size.value.set(w, h);
      groundNear.value = nearest;
      groundLin.value = linear;
      groundReady.value = 1;
    },
    setSheets(s) {
      groundSheet.value = s.ground;
      wallSheet.value = s.wall;
    },
  };
}

/**
 * Lit world material: the stone sheets for floors, faces and tops (`flatTexel`), a pale rim where a wall top drops to something lower,
 * and (kind `ground`) the painted woodland ground, `GRASS_FLAT` while no image is set. The ground's rect is the whole image in px.
 * `smooth` (0 or 1) switches floor and ground to a sharpened linear read; it is a uniform, so flipping it recompiles nothing.
 * The vertex attribute `push` (tiles, xz) moves the point where the light and the sight mask are read.
 */
export function worldMaterial(lighting: Lighting, groundStart: Texture, maskTex: Texture, sight: Sight, cover: CoverShared, sheets: SheetTextures): WorldMaterial {
  const kind = attribute('kind', 'float');
  const isTop = kind.greaterThan(1.5).and(kind.lessThan(2.5));
  const isFace = kind.greaterThan(0.5).and(kind.lessThan(1.5));
  const { texel, bend, smooth, setGround, setSheets } = flatTexel(sheets, groundStart, kind, true);

  // The unmoved point (the vertex stage lowers the drawn one, #347): paint, light, sight and shadows read this. World chunks sit at the origin.
  const wp = varying(positionGeometry, 'worldPos');
  const cx = floor(wp.x);
  const cz = floor(wp.z);
  const fx = fract(wp.x);
  const fz = fract(wp.z);
  const hh = wp.y.sub(0.1);
  const lower = (dx: number, dz: number) => lighting.cellH(ivec2(int(cx.add(dx)), int(cz.add(dz)))).lessThan(hh);
  const rim = fz.greaterThan(1 - 2 * PX).and(lower(0, 1))
    .or(fz.lessThan(PX).and(lower(0, -1)))
    .or(fx.lessThan(PX).and(lower(-1, 0)))
    .or(fx.greaterThan(1 - PX).and(lower(1, 0)));

  // The texel comes first, by a weight (exactly 0 or 1): a `select` here could hold its first use in a branch.
  const base = mix(texel.rgb, vec3(...RIM), weight(isTop.and(rim)));
  // Ground cover (#330): floor and ground darken where cover stands (the sheets and bushels show on it); with the layer off they show the cover's colour flat.
  const grown = coverTexel(cover, floor(wp.xz.mul(16)));
  const covered = isTop.or(isFace).not().and(grown.h.greaterThan(0.5));
  // Mixed by weights (exactly 0 or 1), with `base` first: the sheet samples and their `fwidth` stay at the top level, outside any `if`.
  const coverW = weight(covered);
  const darkenW = weight(cover.on.greaterThan(0.5));
  const albedo = mix(base, mix(grown.rgb, base.mul(kindLook(grown.id).darken), darkenW), coverW);
  // Wrap: floor and ground 0.35, wall face 0.5, wall top TOP_WRAP. A top takes the point lights without the wall test (`open`):
  // the lights hang below it, and the test would cut ragged wedges into it. So the walls around a lit room show as a stone band,
  // also from behind, where no brick face points at the camera (#342).
  const wrap = select(isTop, float(TOP_WRAP), select(isFace, float(0.5), float(0.35)));
  const vertexNormal = attribute('normal', 'vec3');
  // The relief bends the vertex normal along the sheets' axes (flat texels: not at all); the sight below keeps the vertex normal.
  const normal = normalize(vertexNormal.sub(bend));
  // The light and the sight mask are read at the point moved by `push` (a rock slope reads the light of the open cell beside it).
  const push = attribute('push', 'vec2');
  const wpLight = wp.add(vec3(push.x, 0, push.y));
  // The sun (#306): the shadow map is read a hair off the surface, and the cosine term wraps like the point lights'.
  const sun = lighting.sun;
  const lit = lighting.lightAt(wpLight, normal, wrap, { open: isTop, sun: { Ps: wp.add(normal.mul(0.03)), ndl: mix(max(normal.dot(sun.dir), 0), float(1), wrap) } });
  // Sight (#305): a wall face is seen where the floor at its foot is: its point pushed out along the normal. Floors, ground and tops have an upright normal and read their own point.
  const unseen = sight.unseenAt(wpLight.xz.add(vertexNormal.xz.mul(float(FACE_PUSH_TEXELS).div(sight.res))));

  // See through (#303): wall sides and tops (never floors or ground) open where the mask has a disc and the wall is nearer the camera than the thing under it.
  const see = seeUniforms();
  const onWall = isTop.or(isFace);
  const cut = cutUniforms({ cellH: lighting.cellH, sight });
  // Stubs never open: the mask sample stays at the top level of seeOpenNode.
  const open = onWall.and(cutWeightNode(wp, cut, see).lessThanEqual(0)).and(seeOpenNode(maskTex, wp, see));

  const m = new MeshBasicNodeMaterial();
  m.positionNode = cutPositionNode(positionGeometry, cut, see);
  m.colorNode = vec4(sight.apply(lighting.finish(albedo, lit), wpLight, unseen), select(open, float(0), select(isTop, float(1), texel.a)));
  m.alphaTest = 0.5;
  return {
    material: m,
    see: {
      mode: see.mode, keep: see.keep, target: see.target, ray: see.ray,
    },
    cut,
    smooth,
    setGround,
    setSheets,
  };
}

/**
 * The see-through mask's disc material: red = the disc's strength (1 inside, a smoothstep to 0 at the rim; `edge` is a uniform),
 * green = `SEE_DEPTH_BIAS - near` (the quad's `near` attribute), alpha = 1 as the coverage weight. Blended with MAX (one/one), so the
 * mask holds the strongest opening and the farthest thing under it. Depth test off.
 */
export function maskMaterial(): { material: NodeMaterial; edge: { value: number } } {
  const edge = uniform(SEE_DEFAULTS.edge);
  const t = length(uv());
  const strength = float(1).sub(smoothstep(float(1).sub(edge), 1, t));
  const m = new NodeMaterial();
  // Where the strength is 0 (the square's corners, outside the circle) the fragment writes nothing (green and alpha 0), so a far thing's empty corner cannot win the depth MAX against a nearer thing's disc.
  const on = weight(strength.greaterThan(0));
  m.fragmentNode = vec4(strength, float(SEE_DEPTH_BIAS).sub(attribute('near', 'float')).mul(on), 0, on);
  m.depthTest = false;
  m.depthWrite = false;
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendEquation = MaxEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneFactor;
  m.blendEquationAlpha = MaxEquation;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneFactor;
  m.side = DoubleSide;
  m.forceSinglePass = true;
  return { material: m, edge };
}

/** How far (tiles) a card's sun receiver point is moved toward the light, so the card does not shadow itself. */
export const CARD_SUN_NUDGE = 0.14;

/** `cardSunGain` (sun.ts) in the shader: how strongly the sun lights an upright card. */
const cardGain = (dir: N): N => float(CARD_GAIN.base).add(clamp(dir.z.add(CARD_GAIN.zShift), 0, 1).mul(CARD_GAIN.z)).add(dir.y.mul(CARD_GAIN.y));

/**
 * The point `p` of an upright card (`foot`: its foot's x, z; `right`: the camera's right on the ground) on the same card turned to
 * face the light: across the light's horizontal direction, on the side `right` points to. The sun's pass draws the card there.
 */
export function turnedToLight(sun: SunLight, p: N, foot: N): N {
  const h = sun.dir.xz;
  const hl = length(h);
  const across = select(hl.greaterThan(1e-4), vec2(h.y, h.x.negate()).div(max(hl, 1e-4)), sun.right.xz);
  const perp = select(dot(across, sun.right.xz).lessThan(0), across.negate(), across);
  const xz = foot.add(perp.mul(dot(p.xz.sub(foot), sun.right.xz)));
  return vec3(xz.x, p.y, xz.y);
}

/** What an upright card passes to the light as its sun option: the point `truePos` turned to face the light about `foot`, nudged toward the light, and the card's cosine gain. */
export function cardSunAt(sun: SunLight, truePos: N, foot: N): { Ps: N; ndl: N } {
  return { Ps: turnedToLight(sun, truePos, foot).add(sun.dir.mul(CARD_SUN_NUDGE)), ndl: cardGain(sun.dir) };
}

/**
 * The sun's pass draws the opaque cards with this: each turned to face the light (not stretched), depth only, alpha tested on the
 * atlas texel and stippled like the opaque card by what the hero sees of it (a figure the hero cannot see casts no shadow).
 * Same vertex layout as `cardMaterial` (the pass shares its geometry). Depth only: there is no colour to veil, so no sight step.
 */
export function sunCasterMaterial(atlas: Texture, atlasW: number, atlasH: number, sun: SunLight, sight: Sight): NodeMaterial {
  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));
  const m = new MeshBasicNodeMaterial();
  m.positionNode = turnedToLight(sun, positionGeometry, attribute('cardFoot', 'vec2'));
  const seen = attribute('sight', 'vec3');
  m.colorNode = vec4(0, 0, 0, select(bayerAt().lessThan(sight.shown(seen.x, seen.z)), texel.a, float(0)));
  m.alphaTest = 0.5;
  m.colorWrite = false;
  m.side = DoubleSide;
  return m;
}

/**
 * Upright sprites. The screen shows a card at its full sprite height, so the vertex is stretched by 1 / cos(pitch)
 * (the demo's true tilt); the light uses the true, unstretched position. `cosP` is set by the view each frame.
 */
export function cardMaterial(
  atlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, toward: ViewToward, sight: Sight,
  opts: { flat?: boolean; translucent?: boolean } = {},
): { material: MeshBasicNodeMaterial; cosP: { value: number } } {
  const cosP = uniform(1);
  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));
  const truePos = varying(positionGeometry, 'cardPos');
  // Per card: `tint` is rgb and the mode (0 multiply, 1 fill, 2 grey then multiply); `alpha` is the card's opacity.
  const tint = attribute('tint', 'vec4');
  const mode = tint.w;
  const luma = vec3(texel.rgb.dot(vec3(0.299, 0.587, 0.114)));
  const body = select(mode.greaterThan(1.5), luma.mul(tint.xyz), select(mode.greaterThan(0.5), tint.xyz, texel.rgb.mul(tint.xyz)));
  const m = new MeshBasicNodeMaterial();
  // A flat card (a decal on the floor) keeps its true height: it is not stretched by 1 / cos(pitch).
  const pos = opts.flat ? positionGeometry : vec3(positionGeometry.x, positionGeometry.y.div(cosP), positionGeometry.z);
  m.positionNode = pos.add(toward.mul(CARD_BIAS));
  // `shade`: x = the card's own caster slot (-1: none), y = 1 for "ambient only" (a figure the server marks dark).
  const shade = attribute('shade', 'vec2');
  // Sight (#305): (hard, soft, scenery) of the card's foot, one value for the whole card.
  const seen = attribute('sight', 'vec3');
  // The sun (#306): a card reads the shadow map at its own point turned to face the light, nudged toward the light; a decal lying on the floor reads its own point.
  const sun = lighting.sun;
  const foot = attribute('cardFoot', 'vec2');
  const sunAt = opts.flat
    ? { Ps: truePos.add(vec3(0, 0.03, 0)), ndl: max(sun.dir.y, 0) }
    : cardSunAt(sun, truePos, foot);
  const colour = sight.apply(lighting.finish(body, lighting.lightAt(truePos, vec3(0, 0, 0), 1, { self: shade.x, darkOnly: shade.y, sun: sunAt })), truePos, seen.xy);
  const shown = sight.shown(seen.x, seen.z);
  if (opts.translucent) {
    m.colorNode = vec4(colour, texel.a);
    const alpha = attribute('alpha', 'float').mul(shown);
    m.opacityNode = alpha;
    // The opacity is applied before the test: scale the threshold so that it still discards texel.a < 0.5.
    m.alphaTestNode = alpha.mul(0.5);
    m.transparent = true;
    m.depthWrite = false;
    m.forceSinglePass = true; // a transparent double-sided material would otherwise draw twice
  } else {
    // Opaque: a stipple where the card is partly shown (1 never discards, 0 always).
    m.colorNode = vec4(colour, select(bayerAt().lessThan(shown), texel.a, float(0)));
    m.alphaTest = 0.5;
  }
  m.side = DoubleSide;
  return { material: m, cosP };
}

/** Soft ground shadows: black, alpha times a smooth fall-off over the ellipse (uv -1..1), depth tested but not written. */
export function shadowMaterial(sight: Sight): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  const fall = float(1).sub(smoothstep(0, 1, length(uv())));
  m.colorNode = vec4(0, 0, 0, float(attribute('alpha', 'float').mul(fall).mul(sight.shown(attribute('sight', 'vec2').x, 0)) as unknown as number));
  m.transparent = true;
  m.depthWrite = false;
  m.forceSinglePass = true;
  m.side = DoubleSide;
  return m;
}

/**
 * The figures' effect triangles (#338: swoosh, fangs, swirl): their vertex colours (`rgba`), unlit, translucent, depth tested but not
 * written, hidden by the picture's sight like a glow. Drawn by the view after the glows.
 */
export function fxMaterial(sight: Sight): MeshBasicNodeMaterial {
  const c: N = attribute('rgba', 'vec4');
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(c.xyz, c.w.mul(sight.shown(attribute('sight', 'vec2').x, 0)));
  m.transparent = true;
  m.depthWrite = false;
  m.forceSinglePass = true;
  m.side = DoubleSide;
  return m;
}

/** The smoke mesh's render order: after the glows (4), before the effect triangles (5), so swooshes and status marks draw over the smoke. */
export const SMOKE_ORDER = 4.9;

/** The shape of one smoke quad (#359): the outline's bend, the streaks of the torn alpha. Per axis scales, seed offsets and clock rates of the two noises. */
const SMOKE_SHAPE = {
  warp: { scale: [1.3, 0.7], seed: 31, clock: 0.35, clockSeed: 9, bend: 0.55 },
  streak: { scale: [2.6, 0.9], seed: 17, clock: 0.5, clockSeed: 5, body: 0.6, base: 0.85 },
  edge: [0.05, 0.6],
} as const;

/**
 * The smoke quads of a body of smoke (#359): camera-facing quads with a corner coordinate. Per corner `rgba` (colour, alpha) and `c`
 * (cx, cy, seed, clock), and the picture's `sight`. The alpha is the quad's outline (a falloff bent by slow noise, so it is never a
 * disc) torn into upright streaks by a second noise. Unlit, translucent, depth tested but not written; the colour is `rgba.rgb`.
 */
export function smokeMaterial(sight: Sight): MeshBasicNodeMaterial {
  const c: N = attribute('rgba', 'vec4'), k: N = attribute('c', 'vec4');
  const q = k.xy, seed = k.z, t = k.w, W = SMOKE_SHAPE.warp, S = SMOKE_SHAPE.streak;
  const warp: N = mx_noise_float(vec3(q.mul(vec2(W.scale[0], W.scale[1])).add(seed.mul(W.seed)), t.mul(W.clock).add(seed.mul(W.clockSeed))));
  const edge: N = clamp(length(q).add(warp.mul(W.bend)), 0, 1);
  const inv: N = float(1).sub(edge.mul(edge));
  const g: N = inv.mul(inv);
  const n: N = mx_noise_float(vec3(q.mul(vec2(S.scale[0], S.scale[1])).add(seed.mul(S.seed)), t.mul(S.clock).add(seed.mul(S.clockSeed))));
  const alpha: N = smoothstep(SMOKE_SHAPE.edge[0], SMOKE_SHAPE.edge[1], g.mul(n.mul(S.body).add(S.base)));
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(c.xyz, alpha.mul(c.w).mul(sight.shown(attribute('sight', 'vec2').x, 0)));
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.forceSinglePass = true;
  m.side = DoubleSide;
  return m;
}

/**
 * The lit effect triangles (#308: stone chips, dust, smoke, floor marks): the vertex colour lit like a card (the game's lights and
 * ambient; no card shade and no sun term), its alpha times the picture's sight; translucent, depth tested, not written.
 */
export function fxLitMaterial(sight: Sight, lighting: Lighting): MeshBasicNodeMaterial {
  const c: N = attribute('rgba', 'vec4');
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(lighting.finish(c.xyz, lighting.lightAt(positionWorld, vec3(0, 0, 0), 1, { self: float(-1), darkOnly: float(0) })), c.w.mul(sight.shown(attribute('sight', 'vec2').x, 0)));
  m.transparent = true;
  m.depthWrite = false;
  m.forceSinglePass = true;
  m.side = DoubleSide;
  return m;
}

/** Camera-facing glow quads (already moved toward the camera by `buildDynamic`, so no bias here): colour times max(0, 1 - |uv|)^3, added to the picture, depth tested but not written. */
export function glowMaterial(sight: Sight): MeshBasicNodeMaterial {
  const g = max(float(1).sub(length(uv())), 0);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(attribute('glowColor', 'vec3').mul(g.mul(g).mul(g)).mul(sight.shown(attribute('sight', 'vec2').x, 0)), 1);
  m.transparent = true;
  m.blending = AdditiveBlending;
  m.depthWrite = false;
  m.forceSinglePass = true;
  m.side = DoubleSide;
  return m;
}
