// The materials of the 3D figures (#338, #364) in TSL. One vertex stage skins every vertex from its instance's row of the rows texture (the
// bend or the robe, the bone, the root: the steps of `skinVertex` in rig.ts, which is the written spec of this file); four fragment
// stages draw it: the id (owner and stage of a piece, into the id target), the piece (lit, painted), the outline hull (flat, not lit,
// after every piece) and the sun's pass.
// The outline is two rules per pixel: the hull passes the depth test against everything opaque, and it is cut where the nearest piece
// is a piece of its own figure with a stage at or above its own. The id pass writes who that nearest piece is (`id`), the hull reads it
// at its own pixel (`line`), so there is one draw per model and kind however many figures overlap.
// The page `figures.html` is the reference for the look; `layer.ts` owns the meshes and the textures, `view.ts` the id target.
import { DoubleSide, FrontSide, MeshBasicNodeMaterial } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { Fn, abs, asin, screenCoordinate, atan, attribute, cameraWorldMatrix, clamp, cos, cross, dot, float, int, ivec2, length, max, mix, normalize, reflect, select, sin, smoothstep, step, texture, textureLoad, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import { CARD_SUN_NUDGE, bayerAt } from '../materials';
import type { Sight } from '../sightNodes';
import { BONES } from './bones';
import { ROW } from './instances';
import type { EyeSpec } from './tubeDesc';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** How much of the light depends on the surface's direction (the page's `shade`): the light's wrap is `1 - FIGURE_SHADE`. First guess, as the page's. */
export const FIGURE_SHADE = 0.55;
/** The render order of the figures' pieces: after every other opaque thing. */
export const FIGURE_ORDER = 10;
/** The render order of the hulls: after the pieces of every model, so the pieces' depth is complete when a hull is depth-tested. (The id pass is a separate render, finished before the picture whatever the order.) */
export const HULL_ORDER = FIGURE_ORDER + 0.5;
/** The outline colour (sRGB, as every colour here). */
export const OUTLINE = 0x222222;
/** How much the polished steel takes of the sky it mirrors, and how bright that sky is shown (the brief's values). */
const STEEL = { mix: 0.8, gain: 1.3 } as const;

/**
 * The uniforms every figure material of a view shares (the layer holds them). The view sets `cosP` each frame, and `idOn`: 1 while the
 * id target holds this frame's id pass (the picture), 0 for every other camera (the mirror, the shafts' depth), where the hull is a
 * plain depth-tested hull.
 */
export function makeFigureShared() {
  return { cosP: uniform(1).setName('figCosP'), idOn: uniform(0).setName('figIdOn') };
}
export type FigureShared = ReturnType<typeof makeFigureShared>;

export interface FigureMaterials {
  /** The lit, painted surface. */
  piece: MeshBasicNodeMaterial;
  /** The outline hull: the outline colour, not lit, depth written; cut where its own figure's piece of the same or a later stage is nearest (reads the id target). */
  line: MeshBasicNodeMaterial;
  /** The id pass: the piece's own stipple, written as owner (2 bytes) and stage + 1 (1 byte) into the id target. */
  id: MeshBasicNodeMaterial;
  /** The sun's pass (the pieces, depth only); null without a sun. */
  sun: MeshBasicNodeMaterial | null;
}

const rgbOf = (hex: number): [number, number, number] => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/**
 * The vertex stage. The geometry carries `position`, `normal`, `uv`, `skin` (bone, stage, bend index, how far along; the layer's copy
 * holds the vertex's stage in the second float, the model's own `skin[1]` is the hull flag), `look`, `origin`
 * (the vertex's bend's pivot in the rest pose, 0 for any other vertex: the per-model bend constants are baked per vertex, which keeps
 * the material independent of the model) and the instanced `row`: the row of this instance in `rows`. Everything per instance is read
 * from that row (instances.ts `ROW`): the root (3 texels), the bones (3 each), the bends' axes and angles, the robe, the tint, what is
 * seen, the flags. In the vertex stage the steps are those of `skinVertex`:
 *  1. a bend vertex (`skin.z >= 0`) turns about `origin` around the bend's axis by the tip angle times `skin.w`; a robe vertex (`skin.z === -2`)
 *     moves by `skin.w * (dx, dip, dz)`;
 *  2. the bone matrix of `skin.x` (3x4);
 *  3. the root matrix (3x4), which already holds the model's scale, the roll, the yaw, the 1/16 and the place.
 * A normal is turned by the same: the bend's rotation, then the cofactor matrix (inverse transpose without the determinant) of the bone and
 * of the root, normalised, which also holds for the non-uniform scales of a stretched arm or a dash.
 */
export function figurePoint(rows: Texture, shared: FigureShared): FigurePoint {
  const rowI = int(attribute('row', 'float').add(0.5));
  // The texel `c` (a float node or number) of this instance's row.
  const T = (c: N): N => textureLoad(rows, ivec2(int(float(c)), rowI));
  const position = attribute('position', 'vec3'), normal = attribute('normal', 'vec3'), skin = attribute('skin', 'vec4'), origin = attribute('origin', 'vec3');

  // 1. The bend and the robe.
  const bendAt = T(max(skin.z, 0).add(0.5).floor().add(ROW.bends));
  const axis = bendAt.xyz, ang = bendAt.w.mul(skin.w);
  const ca = cos(ang), sa = sin(ang);
  const turn = (v: N): N => v.mul(ca).add(cross(axis, v).mul(sa)).add(axis.mul(dot(axis, v).mul(float(1).sub(ca))));
  const isBend = skin.z.greaterThan(-0.5), isRobe = skin.z.lessThan(-1.5);
  const robe = T(ROW.robe).xyz;
  const bent: N = select(isBend, origin.add(turn(position.sub(origin))), select(isRobe, position.add(vec3(robe.x, robe.z, robe.y).mul(skin.w)), position));
  const nBent: N = select(isBend, turn(normal), normal);

  // 2. The bone, 3. the root: a point takes the matrix, a normal its cofactor matrix.
  const first = skin.x.add(0.5).floor().mul(3).add(ROW.bones);
  const at = (a: N, b: N, c: N, v: N): N => vec3(dot(a.xyz, v).add(a.w), dot(b.xyz, v).add(b.w), dot(c.xyz, v).add(c.w));
  const cof = (a: N, b: N, c: N, n: N): N => vec3(dot(cross(b.xyz, c.xyz), n), dot(cross(c.xyz, a.xyz), n), dot(cross(a.xyz, b.xyz), n));
  const ba = T(first), bb = T(first.add(1)), bc = T(first.add(2));
  const ra = T(ROW.root), rb = T(ROW.root + 1), rc = T(ROW.root + 2);
  const world: N = at(ra, rb, rc, at(ba, bb, bc, bent));
  const nWorld: N = normalize(cof(ra, rb, rc, cof(ba, bb, bc, nBent)));

  // The camera passes stretch y by 1 / cos(pitch) (the figure is as tall as its sprite); the light, the sight and the sun's pass use the true point.
  const screen: N = vec3(world.x, world.y.div(shared.cosP), world.z);
  // The row's per-instance values go to the fragment stage flat: one value for the whole instance.
  const flat = (node: N, name: string): N => varying(node, name).setInterpolation('flat');
  const tint = flat(T(ROW.tint), 'figTint'), seen = flat(T(ROW.seen), 'figSeen'), flags = flat(T(ROW.flags), 'figFlags');
  // The extra texel (flare, eye) is only a node here: nothing is emitted unless a material reads it (the painted eyes).
  const extra = flat(T(ROW.extra), 'figExtra');
  return { world, screen, P: varying(world, 'figPos') as N, N: varying(nWorld, 'figNormal') as N, tint: tint as N, seen: seen as N, flags: flags as N, extra: extra as N };
}
export type FigurePoint = { world: N; screen: N; P: N; N: N; tint: N; seen: N; flags: N; extra: N };

/**
 * The painted eyes of a spectre (#359): two ovals mirrored in z on the front of the head, from the vertex's rest position `q` (model
 * px) and its bone (only the head and the hat carry them). `extra` is the row's extra texel (x: flare, y: eye). `core` is the bright
 * oval, `halo` the wider glow round it; both are 0 off the head. A flare widens and brightens the eyes; `eye` 0 closes them.
 */
export function eyeMask(spec: EyeSpec, extra: N): { core: N; halo: N } {
  const q: N = varying(attribute('position', 'vec3'), 'figRest');
  const bone: N = varying(attribute('skin', 'vec4').x, 'figBone').setInterpolation('flat');
  const headBone = step(float(BONES.indexOf('head') - 0.5), bone).mul(step(bone, float(BONES.indexOf('hat') + 0.5)));
  const flare: N = extra.x, eye: N = extra.y;
  const px = abs(q.z).sub(spec.z), py = q.y.sub(spec.y);
  const c = Math.cos(spec.slant), s = Math.sin(spec.slant);
  const xr = px.mul(c).add(py.mul(s)).div(flare.mul(0.6).add(1).mul(spec.half[0]));
  const yr = py.mul(c).sub(px.mul(s)).div(flare.mul(0.9).add(1).mul(spec.half[1]));
  const d = length(vec2(xr, yr));
  const on = step(float(spec.front), q.x).mul(headBone).mul(spec.strength).mul(eye);
  return { core: float(1).sub(smoothstep(0.75, 1.05, d)).mul(on), halo: float(1).sub(smoothstep(0.9, 2.6, d)).mul(on) };
}

/** The stipple of a draw: kept where the Bayer threshold is below what is shown (sight and see-through in one: `alpha` times how much the hero sees), and above the ground when the figure is cut. */
function keepOf(p: FigurePoint, sight: Sight, o: { bySight: boolean; alphaMin?: number }): N {
  const shown = sight.shown(p.seen.y, float(0));
  const above = p.flags.y.lessThan(0.5).or(p.P.y.greaterThanEqual(0));
  const stipple = o.bySight ? bayerAt().lessThan(shown.mul(p.seen.x)) : bayerAt().lessThan(shown).and(p.seen.x.greaterThanEqual(o.alphaMin ?? 0.5));
  return stipple.and(above);
}

/**
 * The four materials of one model (`paint` is the model's own). `rows` is the float rows texture the layer fills; `stone` and `sky` are
 * the shared pictures (`stonePaint`, `skyPaint`, uploaded with `figureLooks`); `idTex` is the id target's texture, which the hull reads
 * and which always has the size of the target the picture is drawn into. `hasSun` false: `sun` is null and the piece carries
 * no sun code. All four cull the same side (the hull's triangles are wound the other way round, so the hull shows its inside, which is
 * the outline); the sun's pass sees both sides.
 */
export function figureMaterials(o: { lighting: Lighting; sight: Sight; hasSun: boolean; rows: Texture; paint: Texture; stone: Texture; sky: Texture; shared: FigureShared; idTex: Texture; eyes?: EyeSpec | null }): FigureMaterials {
  const { lighting, sight, hasSun, paint, stone, sky } = o;
  const p = figurePoint(o.rows, o.shared);
  const look = attribute('look', 'vec4');
  const seenXY = vec2(p.seen.y, p.seen.z);
  const make = (position: N): MeshBasicNodeMaterial => {
    const m = new MeshBasicNodeMaterial();
    m.positionNode = position;
    m.alphaTest = 0.5;
    m.side = FrontSide;
    return m;
  };
  // The light of what no lamp lights (the outline, the unlit seams): the ambient alone.
  const ambientOnly = { rgb: lighting.ambient, dv: float(0) };
  const gate = (keep: N): N => select(keep, float(1), float(0));

  // ---------------------------------------------------------------- the piece
  const piece = make(p.screen);
  piece.colorNode = Fn(() => {
    // The textures are read first, at the top level of the shader (sampling needs uniform control flow), and a select picks.
    const uvIn = uv();
    // A model that brings two paints (the head's above the body's) has twice the stone's height: its stone reads each half whole.
    const heightOf = (t: Texture): number => (t.image as { height?: number } | null)?.height ?? 0;
    const doubled = heightOf(paint) > heightOf(stone) && heightOf(stone) > 0;
    const stoneUv = doubled ? vec2(uvIn.x, uvIn.y.mul(2).sub(step(0.5, uvIn.y))) : uvIn;
    const painted = texture(paint, uvIn).rgb.toVar('figPaint');
    const stoned = texture(stone, stoneUv).rgb.toVar('figStone');
    const Nn: N = normalize(p.N);
    // Steel mirrors the sky along the camera's ray reflected at the surface (an equirectangular lookup).
    const ray = cameraWorldMatrix.mul(vec4(0, 0, -1, 0)).xyz;
    const r = reflect(ray, Nn);
    const mirrored = texture(sky, vec2(atan(r.z, r.x).div(2 * Math.PI).add(0.5), asin(clamp(r.y, -1, 1)).div(Math.PI).add(0.5))).rgb.mul(STEEL.gain).toVar('figSky');

    const flatColour = look.xyz;
    const isStone = p.tint.w.greaterThan(0.5);
    const isSteel = look.w.greaterThan(0.5).and(look.w.lessThan(1.5)).and(isStone.not());
    const isUnlit = look.w.greaterThan(1.5).and(look.w.lessThan(2.5));
    // A glowing piece (look 3: eyes) shows its own colour whatever light falls on it; a stone figure's does not glow.
    const isGlow = look.w.greaterThan(2.5).and(isStone.not());
    const base = select(look.x.lessThan(-0.5), painted, flatColour).mul(p.tint.xyz);
    const albedo = select(isStone, stoned, select(isSteel, mix(base, mirrored, STEEL.mix), base));

    // The light at the true point and normal; the sun reads its shadow map a hair off the surface toward the light, like a card.
    const sunDir = lighting.sun.dir;
    const sunAt = hasSun
      ? { Ps: p.P.add(Nn.mul(0.05)).add(sunDir.mul(CARD_SUN_NUDGE)), ndl: mix(float(1), max(dot(Nn, sunDir), 0), FIGURE_SHADE) }
      : undefined;
    const lit0 = lighting.lightAt(p.P, Nn, 1 - FIGURE_SHADE, { self: p.seen.w.add(0.5).floor(), darkOnly: p.flags.x, sun: sunAt });
    const lit = { rgb: lit0.rgb.toVar('figLit'), dv: lit0.dv.toVar('figDv') };
    const colour0 = select(isGlow, base, select(isUnlit, lighting.finish(flatColour, ambientOnly), lighting.finish(albedo, lit)));
    // Painted eyes (only a material built with `eyes` has this code): a glow round them and the bright oval, before the sight; a stone figure shows none.
    let colour = colour0;
    if (o.eyes) {
      const { core, halo } = eyeMask(o.eyes, p.extra);
      const ring = vec3(...rgbOf(o.eyes.ring)), coreColour = vec3(...rgbOf(o.eyes.core));
      const flare: N = p.extra.x;
      const eyed = mix(colour0.add(ring.mul(halo.mul(halo)).mul(flare.mul(0.8).add(0.55))), coreColour, core);
      colour = select(isStone, colour0, eyed);
    }
    return vec4(sight.apply(colour, p.P, seenXY), gate(keepOf(p, sight, { bySight: true })));
  })();

  // ---------------------------------------------------------------- the id pass and the outline
  // The vertex's stage (the layer's copy of `skin.y`) and the owner's number (`flags.z`), both the same over a triangle.
  const stage: N = varying(attribute('skin', 'vec4').y, 'figStage').setInterpolation('flat');
  const owner: N = p.flags.z.add(0.5).floor();
  const ownerLo: N = owner.mod(256), ownerHi: N = owner.div(256).floor();
  const keep = keepOf(p, sight, { bySight: true });

  // The piece's own vertex stage, front side, stipple, sight and `cut`: the id target matches the picture's piece pixels. Not lit, no paint.
  const id = make(p.screen);
  // The id pass has no world: a piece the world hides in the picture (below the floor, below the lava surface) must not cover the hull
  // there, or the outline round a figure's feet would be cut away. The row says below which height the world hides this figure
  // (`groundY`, the flags' fourth float: 0 on the floor, very low where the figure is seen below 0, in water or a chasm).
  id.colorNode = vec4(ownerLo.div(255), ownerHi.div(255), stage.add(1).div(255), gate(keep.and(p.P.y.greaterThanEqual(p.flags.w))));

  const line = make(p.screen);
  // Not lit by the lamps, but dimmed by the ambient light like everything else: in the dark a flat 0x222222 would show as a grey outline on black.
  const outline = lighting.finish(vec3(...rgbOf(OUTLINE)), ambientOnly);
  // The id texel at this fragment's own pixel; bytes recovered exactly. Third byte 0: no figure there.
  const texel: N = textureLoad(o.idTex, ivec2(screenCoordinate.xy));
  const bytes: N = texel.mul(255).add(0.5).floor();
  const own = bytes.x.equal(ownerLo).and(bytes.y.equal(ownerHi)).and(bytes.z.greaterThan(0.5));
  // Rule 2: covered where the nearest piece is its own figure's with a stage at or above the hull's.
  const covered = o.shared.idOn.greaterThan(0.5).and(own).and(bytes.z.sub(1).greaterThanEqual(stage));
  line.colorNode = vec4(sight.apply(outline, p.P, seenXY), gate(keep.and(covered.not())));

  // ---------------------------------------------------------------- the sun's pass
  let sun: MeshBasicNodeMaterial | null = null;
  if (hasSun) {
    // The true point (no stretch); a figure the hero cannot see casts no shadow (the stipple by sight), and a faint one casts none (alpha under 0.5).
    sun = make(p.world);
    sun.colorNode = vec4(0, 0, 0, gate(keepOf(p, sight, { bySight: false })));
    sun.colorWrite = false;
    sun.side = DoubleSide;
  }
  return { piece, line, id, sun };
}
