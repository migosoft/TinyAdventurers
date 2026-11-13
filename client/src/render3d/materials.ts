// Node materials of the 3D view (TSL).
import { AdditiveBlending, CustomBlending, DoubleSide, MaxEquation, MeshBasicNodeMaterial, NodeMaterial, OneFactor, Vector3 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { attribute, clamp, dot, float, floor, fwidth, fract, int, ivec2, length, max, mix, mod, positionGeometry, positionWorld, screenCoordinate, screenUV, select, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from './lightNodes';
import type { Sight } from './sightNodes';
import type { SunLight } from './sunNodes';
import { CARD_GAIN } from './sun';
import { GRASS_FLAT, STONE } from './light';
import { SEE_DEFAULTS, SEE_DEPTH_BIAS, SEE_DEPTH_MARGIN } from './seeThrough';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const RIM = [0.4, 0.34, 0.33] as const;
const PX = 1 / 16;

/** The demo's depth bias, in tiles toward the camera: cards 0.03, flames and glows 0.05 (the world has none). */
export const CARD_BIAS = 0.03;
export const FLAME_BIAS = 0.05;

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

/** The see-through uniforms every opening surface (walls, plants) reads: `mode` 0 off, 1 soft, 2 lattice; `keep` 0..1; `target` and `ray` the camera target and the horizontal unit vector toward the camera (the mask's depth reference). */
export function seeUniforms() {
  return { mode: uniform(1), keep: uniform(SEE_DEFAULTS.keep), target: uniform(new Vector3()), ray: uniform(new Vector3(0, 0, 1)) };
}
/** The uniforms as `seeUniforms` made them (or as `worldMaterial` hands them back); the nodes are untyped. */
export type SeeUniforms = Record<keyof ReturnType<typeof seeUniforms>, N>;

/**
 * Whether a surface point `wp` opens (a bool node) where the see-through mask has a disc and the point is nearer the camera than the thing under it.
 * `uvPx` is the texel position of the surface (the lattice mode's checker). The mask is sampled linearly at the top level of the shader; its green
 * is a sum weighted by coverage (alpha), so dividing by alpha gives the value back at a disc's soft edge.
 */
export function seeOpenNode(maskTex: Texture, wp: N, uvPx: N, see: SeeUniforms): N {
  const mk = texture(maskTex, screenUV);
  const strength = mk.r;
  const thingNear = float(SEE_DEPTH_BIAS).sub(mk.g.div(max(mk.a, 1e-4)));
  const wallNear = wp.sub(see.target).dot(see.ray);
  const inFront = strength.greaterThan(0).and(wallNear.greaterThan(thingNear.add(SEE_DEPTH_MARGIN)));
  const keepAt = float(1).sub(strength.mul(float(1).sub(see.keep)));
  const softOpen = bayerAt().greaterThanEqual(keepAt);
  const latticeOpen = strength.greaterThan(0.5).and(mod(floor(uvPx.x).add(floor(uvPx.y)), 2).lessThan(0.5));
  return inFront.and(select(see.mode.greaterThan(1.5), latticeOpen, select(see.mode.greaterThan(0.5), softOpen, float(0).greaterThan(1))));
}

/** What `worldMaterial` hands back: the material and the handles the view drives. */
export interface WorldMaterial {
  material: MeshBasicNodeMaterial;
  /** 0 or 1: floors and the ground read the linear texture at a sharpened position. */
  smooth: { value: number };
  /** See-through uniforms: `mode` 0 off, 1 soft, 2 lattice; `keep` 0..1; `target` and `ray` the camera target and the horizontal unit vector toward the camera (the mask's depth reference). */
  see: { mode: { value: number }; keep: { value: number }; target: { value: Vector3 }; ray: { value: Vector3 } };
  /** Points the ground kind at a new image (nearest and linear copies of it) and marks it ready. */
  setGround(nearest: Texture, linear: Texture): void;
}

/**
 * Lit world material: atlas texels for floor and faces, a generated stone top with a pale rim where a wall drops to something lower,
 * and (kind `ground`) the painted woodland ground, `GRASS_FLAT` while no image is set. The ground's rect is the whole image in px.
 * `smooth` (0 or 1) switches floor and ground to the linear texture at a sharpened position; it is a uniform, so flipping it recompiles nothing.
 */
export function worldMaterial(atlas: Texture, linearAtlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, groundStart: Texture, maskTex: Texture, sight: Sight): WorldMaterial {
  const kind = attribute('kind', 'float');
  const isTop = kind.greaterThan(1.5).and(kind.lessThan(2.5));
  const isGround = kind.greaterThan(2.5);
  const isFace = kind.greaterThan(0.5).and(kind.lessThan(1.5));

  const size = vec2(atlasW, atlasH);
  const p0 = uv();
  // Derivatives are taken here, at the top level of the fragment code and outside any branch (WGSL requires uniform control flow).
  const fw = max(fwidth(p0), vec2(1e-6));
  const seam = floor(p0.add(0.5));
  const sharp = seam.add(clamp(p0.sub(seam).div(fw), -0.5, 0.5));
  const rect = attribute('rect', 'vec4');
  // The atlas has no padding: keep the linear taps inside the frame.
  const p = clamp(sharp, rect.xy.add(0.5), rect.xy.add(rect.zw).sub(0.5));
  const smooth = uniform(0);
  const useSmooth = smooth.greaterThan(0.5);
  // Both reads sit in the shader and a select picks one; sampling stays in uniform control flow.
  const atlasTexel = select(useSmooth.and(kind.lessThan(0.5)), texture(linearAtlas, p.div(size)), texture(atlas, p0.div(size)));

  const groundReady = uniform(0);
  const groundNear = texture(groundStart, p0.div(max(rect.zw, vec2(1))));
  const groundLin = texture(groundStart, p.div(max(rect.zw, vec2(1))));
  // Two texture nodes on one texture start are "mergeable" (same uniform hash, so one shared binding): then only one of them would follow `setGround`.
  groundNear.mergeable = false;
  groundLin.mergeable = false;
  const groundTexel = select(useSmooth, groundLin, groundNear);
  const ground = vec4(select(groundReady.greaterThan(0.5), groundTexel.rgb, vec3(...GRASS_FLAT)), select(groundReady.greaterThan(0.5), groundTexel.a, 1));
  const texel = select(isGround, ground, atlasTexel);

  const wp = positionWorld;
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

  const top = select(rim, vec3(...RIM), vec3(...STONE));
  const albedo = select(isTop, top, texel.rgb);
  // Wrap: floor and ground 0.35, wall face 0.5, wall top 0.15.
  const wrap = select(isTop, float(0.15), select(isFace, float(0.5), float(0.35)));
  const normal = attribute('normal', 'vec3');
  // The sun (#306): the shadow map is read a hair off the surface, and the cosine term wraps like the point lights'.
  const sun = lighting.sun;
  const lit = lighting.lightAt(wp, normal, wrap, { sun: { Ps: wp.add(normal.mul(0.03)), ndl: mix(max(normal.dot(sun.dir), 0), float(1), wrap) } });
  // Sight (#305): a wall face is seen where the floor at its foot is: its point pushed out along the normal. Floors, ground and tops have an upright normal and read their own point.
  const unseen = sight.unseenAt(wp.xz.add(normal.xz.mul(float(FACE_PUSH_TEXELS).div(sight.res))));

  // See through (#303): wall sides and tops (never floors or ground) open where the mask has a disc and the wall is nearer the camera than the thing under it.
  const see = seeUniforms();
  const onWall = isTop.or(isFace);
  const open = onWall.and(seeOpenNode(maskTex, wp, p0, see));

  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(lighting.finish(albedo, lit), wp, unseen), select(open, float(0), select(isTop, float(1), texel.a)));
  m.alphaTest = 0.5;
  return {
    material: m,
    see: {
      mode: see.mode, keep: see.keep, target: see.target, ray: see.ray,
    },
    smooth,
    setGround(nearest, linear) {
      groundNear.value = nearest;
      groundLin.value = linear;
      groundReady.value = 1;
    },
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
  const on = select(strength.greaterThan(0), float(1), float(0));
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

/** Torch flames: the atlas texel, self-lit. */
export function emissiveMaterial(atlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, toward: ViewToward, sight: Sight): MeshBasicNodeMaterial {
  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));
  const m = new MeshBasicNodeMaterial();
  m.positionNode = positionGeometry.add(toward.mul(FLAME_BIAS));
  // Sight (#305): self-lit, so no `apply`: gone on unseen ground (a stipple, as the opaque cards), dimmed behind a trunk on dark maps.
  const seen = attribute('sight', 'vec3');
  const shown = sight.shown(seen.x, 0);
  m.colorNode = vec4(sight.dim(lighting.shoulder(texel.rgb.mul(1.15)), seen.y), select(bayerAt().lessThan(shown), texel.a, float(0)));
  m.alphaTest = 0.5;
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
