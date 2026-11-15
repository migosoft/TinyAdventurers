// The materials of the 3D figures (#338) in TSL. One vertex stage skins every vertex from its instance's row of the rows texture (the
// bend or the robe, the bone, the root: the steps of `skinVertex` in rig.ts, which is the written spec of this file); four fragment
// stages draw it: the piece (lit, painted), the outline hull (flat, not lit), the seal (the hull again, depth only) and the sun's pass.
// The page `figures.html` is the reference for the look; `layer.ts` owns the meshes, the textures and the batches.
import { DoubleSide, FrontSide, MeshBasicNodeMaterial } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { Fn, asin, atan, attribute, cameraWorldMatrix, clamp, cos, cross, dot, float, int, ivec2, max, mix, normalize, reflect, select, sin, step, texture, textureLoad, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import { CARD_SUN_NUDGE, bayerAt } from '../materials';
import type { Sight } from '../sightNodes';
import { ROW } from './instances';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** How much of the light depends on the surface's direction (the page's `shade`): the light's wrap is `1 - FIGURE_SHADE`. First guess, as the page's. */
export const FIGURE_SHADE = 0.55;
/** The render order base of the figures: after every other opaque thing. A batch adds its index, a draw less than 1 on top. */
export const FIGURE_ORDER = 10;
/** The outline colour (sRGB, as every colour here). */
export const OUTLINE = 0x222222;
/** How much the polished steel takes of the sky it mirrors, and how bright that sky is shown (the brief's values). */
const STEEL = { mix: 0.8, gain: 1.3 } as const;

/** The uniforms every figure material of a view shares; the view sets `cosP` each frame (the layer holds them). */
export function makeFigureShared() {
  return { cosP: uniform(1).setName('figCosP') };
}
export type FigureShared = ReturnType<typeof makeFigureShared>;

export interface FigureMaterials {
  /** The lit, painted surface. */
  piece: MeshBasicNodeMaterial;
  /** The outline hull: the outline colour, not lit, no depth written. */
  line: MeshBasicNodeMaterial;
  /** The hulls again after the pieces: depth only. */
  seal: MeshBasicNodeMaterial;
  /** The sun's pass (the pieces, depth only); null without a sun. */
  sun: MeshBasicNodeMaterial | null;
}

const rgbOf = (hex: number): [number, number, number] => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/**
 * The vertex stage. The geometry carries `position`, `normal`, `uv`, `skin` (bone, hull flag, bend index, how far along), `look`, `origin`
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
  return { world, screen, P: varying(world, 'figPos') as N, N: varying(nWorld, 'figNormal') as N, tint: tint as N, seen: seen as N, flags: flags as N };
}
export type FigurePoint = { world: N; screen: N; P: N; N: N; tint: N; seen: N; flags: N };

/** The stipple of a draw: kept where the Bayer threshold is below what is shown (sight and see-through in one: `alpha` times how much the hero sees), and above the ground when the figure is cut. */
function keepOf(p: FigurePoint, sight: Sight, o: { bySight: boolean; alphaMin?: number }): N {
  const shown = sight.shown(p.seen.y, float(0));
  const above = p.flags.y.lessThan(0.5).or(p.P.y.greaterThanEqual(0));
  const stipple = o.bySight ? bayerAt().lessThan(shown.mul(p.seen.x)) : bayerAt().lessThan(shown).and(p.seen.x.greaterThanEqual(o.alphaMin ?? 0.5));
  return stipple.and(above);
}

/**
 * The four materials of one model (`paint` is the model's own). `rows` is the float rows texture the layer fills; `stone` and `sky` are
 * the shared pictures (`stonePaint`, `skyPaint`, uploaded with `figureLooks`). `hasSun` false: `sun` is null and the piece carries
 * no sun code. All four cull the same side (the hull's triangles are wound the other way round, so the hull shows its inside, which is
 * the outline); the sun's pass sees both sides.
 */
export function figureMaterials(o: { lighting: Lighting; sight: Sight; hasSun: boolean; rows: Texture; paint: Texture; stone: Texture; sky: Texture; shared: FigureShared }): FigureMaterials {
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
    const isUnlit = look.w.greaterThan(1.5);
    const base = select(look.x.lessThan(-0.5), painted, flatColour).mul(p.tint.xyz);
    const albedo = select(isStone, stoned, select(isSteel, mix(base, mirrored, STEEL.mix), base));

    // The light at the true point and normal; the sun reads its shadow map a hair off the surface toward the light, like a card.
    const sunDir = lighting.sun.dir;
    const sunAt = hasSun
      ? { Ps: p.P.add(Nn.mul(0.05)).add(sunDir.mul(CARD_SUN_NUDGE)), ndl: mix(float(1), max(dot(Nn, sunDir), 0), FIGURE_SHADE) }
      : undefined;
    const lit0 = lighting.lightAt(p.P, Nn, 1 - FIGURE_SHADE, { self: p.seen.w.add(0.5).floor(), darkOnly: p.flags.x, sun: sunAt });
    const lit = { rgb: lit0.rgb.toVar('figLit'), dv: lit0.dv.toVar('figDv') };
    const colour = select(isUnlit, flatColour, lighting.finish(albedo, lit));
    return vec4(sight.apply(colour, p.P, seenXY), gate(keepOf(p, sight, { bySight: true })));
  })();

  // ---------------------------------------------------------------- the outline and its seal
  const line = make(p.screen);
  // Not lit by the lamps, but dimmed by the ambient light like everything else: in the dark a flat 0x222222 would show as a grey outline on black.
  const outline = lighting.finish(vec3(...rgbOf(OUTLINE)), { rgb: lighting.ambient, dv: float(0) });
  line.colorNode = vec4(sight.apply(outline, p.P, seenXY), gate(keepOf(p, sight, { bySight: true })));
  line.depthWrite = false;

  const seal = make(p.screen);
  seal.colorNode = vec4(0, 0, 0, gate(keepOf(p, sight, { bySight: true })));
  seal.colorWrite = false;

  // ---------------------------------------------------------------- the sun's pass
  let sun: MeshBasicNodeMaterial | null = null;
  if (hasSun) {
    // The true point (no stretch); a figure the hero cannot see casts no shadow (the stipple by sight), and a faint one casts none (alpha under 0.5).
    sun = make(p.world);
    sun.colorNode = vec4(0, 0, 0, gate(keepOf(p, sight, { bySight: false })));
    sun.colorWrite = false;
    sun.side = DoubleSide;
  }
  return { piece, line, seal, sun };
}
