// The demon's materials in TSL (#379, #442): the skin drawn with bone matrices in the vertex stage (`skinned`), painted in the shader
// from each point's place on the resting body (paintSkin.ts, paintSheet.ts, paintBlade.ts: the look spike's paint, line for line), and
// lit by the view's own lights. The vertex stage, the light, the sight and the stipple are the lich's and the models' own; one demon per
// material set (its place, look, pose and bones are its own uniforms). No outline hull and no id pass, as the lich.
//
// The spike's page works in linear light and shows a colour through a film curve (three's ACES) and the sRGB curve; the view shows a
// colour as it is. `shown` is that curve, so the spike's numbers stay as they are: an albedo goes through it before the view's light
// multiplies it, and a glow is added as what it changes in the shown colour, times its own brightness where that is above 1 (the bloom).
import { DoubleSide, MeshBasicNodeMaterial, Matrix4, Vector4 } from 'three/webgpu';
import { Fn, abs, attribute, cross, dFdx, dFdy, dot, faceDirection, float, max, mix, normalize, pow, select, sign, step, uniform, uniformArray, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { FIGURE_SHADE, keepOf, type FigureShared } from '../models/nodes';
import { vertexOf, type LichUniforms } from '../lich/nodes';
import { BONES } from './body';
import { fn, type Painted, type PoseUniforms } from './paintNoise';
import { paintSkin } from './paintSkin';
import { paintSheet, pleated } from './paintSheet';
import { paintBlade } from './paintBlade';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
export type UniformArrayNode = ReturnType<typeof uniformArray>;

const LUM = [0.299, 0.587, 0.114] as const;
/** The brightness the bloom's bright pass measures (three's `luminance`): the spike's glow blooms where this is above 1. */
const BLOOM_LUM = [0.2126, 0.7152, 0.0722] as const;
/** The glow, tuned by eye against the spike: `gain` scales every emissive colour; a stone demon's is `stone`. */
export const GLOW = { gain: 1.0, stone: 0 } as const;
/**
 * `albedo`: the light the spike's surfaces stand in, as a factor on the paint's albedo before the film curve (tuned by eye).
 * `thin`: how much of the light behind the webbing comes through it, on the same scale (the spike's three lights are the view's here).
 */
export const PAINT = { albedo: 0.75, thin: 0.15 } as const;

/** The lich's uniforms and the pose's; `levels` = [the glow's phase 0..1, the glow's gain, the face's heat, spare] (the lights of the view read them, not the paint). */
export type DemonUniforms = LichUniforms & { pose: PoseUniforms };

/** The normal bent by a relief whose height steps by `hx`, `hy` to the next pixel right and up (the spike's `bumped`, in the world's frame). Call at the top level: it takes screen derivatives. */
export function bumped(n: N, P: N, hx: N, hy: N): N {
  const sx: N = dFdx(P).toVar(), sy: N = dFdy(P).toVar();
  const r1: N = cross(sy, n), r2: N = cross(n, sx), det: N = dot(sx, r1).mul(faceDirection).toVar();
  const o: N = abs(det).mul(n).sub(sign(det).mul(hx.mul(r1).add(hy.mul(r2)))).toVar();
  return select(dot(o, o).greaterThan(1e-20), normalize(o), n);
}

/** The flat normal of the triangle under the pixel, on the side `side` points to (the spike's `flatShading`). Call at the top level. */
export function faceNormal(P: N, side: N): N {
  const n: N = normalize(cross(dFdx(P) as N, dFdy(P) as N)).toVar();
  return select(dot(n, side).lessThan(0), n.negate(), n);
}

// ---------------------------------------------------------------- how the spike's page shows a colour
const cols = (m: readonly (readonly number[])[], v: N): N => vec3(m[0][0], m[0][1], m[0][2]).mul(v.x).add(vec3(m[1][0], m[1][1], m[1][2]).mul(v.y)).add(vec3(m[2][0], m[2][1], m[2][2]).mul(v.z));
// three's ACESFilmicToneMapping (its two matrices by columns, exposure 1) and the sRGB curve
const ACES_IN = [[0.59719, 0.076, 0.0284], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]] as const;
const ACES_OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]] as const;
export const shown = fn('demonShown', 'vec3', [['c', 'vec3']], ([c]) => {
  const v: N = cols(ACES_IN, max(c, 0).div(0.6)).toVar();
  const fit: N = v.mul(v.add(0.0245786)).sub(0.000090537).div(v.mul(v.mul(0.983729).add(0.432951)).add(0.238081));
  const o: N = cols(ACES_OUT, fit).clamp(0, 1).toVar();
  return mix(o.mul(12.92), pow(o, vec3(1 / 2.4)).mul(1.055).sub(0.055), step(0.0031308, o));
});

/**
 * The skin's point and normal in the model frame: each vertex hangs on four bones (`skinIndex`, `skinWeight`), each bone's matrix takes a
 * rest point to the model frame. `rest` is the vertex's own point in the bind pose; `turn` takes a step in the bind pose along.
 */
export function skinned(bones: UniformArrayNode): { P: N; N: N; rest: N; turn(v: N): N } {
  const rest: N = attribute('position', 'vec3'), normal: N = attribute('normal', 'vec3');
  const index: N = attribute('skinIndex', 'uvec4'), raw: N = attribute('skinWeight', 'vec4');
  // the file stores the weights as bytes, so they sum to a little off 1: divide by their sum
  const weight: N = raw.div(raw.x.add(raw.y).add(raw.z).add(raw.w).max(1e-6));
  const by = (v4: N): N => (['x', 'y', 'z', 'w'] as const).reduce((sum: N, k) => sum.add((bones.element(index[k]) as N).mul(v4).xyz.mul(weight[k])), vec3(0));
  return { P: by(vec4(rest, 1)), N: by(vec4(normal, 0)), rest, turn: (v) => by(vec4(v, 0)) };
}

type Part = 'skin' | 'web' | 'cloth' | 'blade' | 'iron';
// the spike's three flat colours (sRGB hex 1c0d09, 1a1210, 241c18) in linear light: the leather grip, the sword's iron, the cuff and chain
const IRON = [[0.0116, 0.004, 0.0027], [0.0103, 0.006, 0.0052], [0.0176, 0.0116, 0.0091]] as const;
const paintIron = (info: N): Painted => ({ albedo: select(info.x.lessThan(0.5), vec3(...IRON[0]), select(info.x.lessThan(1.5), vec3(...IRON[1]), vec3(...IRON[2]))), emit: vec3(0) });

export interface DemonMats {
  /** body, tail and tubes. */
  skin: MeshBasicNodeMaterial; web: MeshBasicNodeMaterial; cloth: MeshBasicNodeMaterial; blade: MeshBasicNodeMaterial; iron: MeshBasicNodeMaterial;
  /** The ice demon's clear parts (not yet). */
  crystal: null;
  bones: UniformArrayNode; kind: 'fire' | 'ice'; u: DemonUniforms; dispose(): void;
}

// `kind`: the ice demon wears the fire paint until its own variant of the paint functions comes (compile-time by `kind`, as the spike does).
export function demonMaterials(o: { lighting: Lighting; sight: Sight; shared: FigureShared; kind: 'fire' | 'ice' }): DemonMats {
  const { lighting, sight } = o;
  const root = uniform(new Vector4()), scale = uniform(1), tint = uniform(new Vector4(1, 1, 1, 0)), seen = uniform(new Vector4(1, 0, 0, -1)), flags = uniform(new Vector4()), levels = uniform(new Vector4(0, 1, 1, 0));
  const pose = { life: uniform(new Vector4()), beat: uniform(new Vector4(0, 1, 0, 0)), gaze: uniform(new Vector4()) };
  const un = { root, scale, tint, seen, flags };
  const seenXY = vec2(seen.y, seen.z);
  const bones = uniformArray(Array.from({ length: BONES }, () => new Matrix4()), 'mat4');
  const isStone: N = tint.w.greaterThan(0.5);
  const lum = (c: N): N => dot(c, vec3(...LUM));

  const make = (part: Part): MeshBasicNodeMaterial => {
    const mat = new MeshBasicNodeMaterial();
    mat.side = DoubleSide;   // the webbing and the cloth are seen from both sides
    const sk = skinned(bones);
    const p = vertexOf(o.shared, un, mat, true, part === 'web' ? pleated(sk, pose) : sk);
    mat.colorNode = Fn(() => {
      // Everything that takes a screen derivative (the relief's two steps, the face normal, the bend) and the light stand here at the top
      // level; the paint's own branches hold none.
      const info: N = attribute('info', 'vec4');
      const side: N = normalize(p.N).mul(faceDirection).toVar();
      const flat: N = part === 'web' || part === 'blade' ? faceNormal(p.P, side) : side;
      const s: Painted = part === 'skin' ? paintSkin(attribute('position', 'vec3'), info, uv(), pose) : part === 'blade' ? paintBlade(uv(), pose) : part === 'iron' ? paintIron(info) : paintSheet(uv(), part === 'web');
      const Nn: N = (s.hx ? bumped(flat, p.P, s.hx, s.hy) : flat).toVar('demonNormal');
      const opts = { self: seen.w.add(0.5).floor(), darkOnly: flags.x };
      const lit0 = lighting.lightAt(p.P, Nn, 1 - FIGURE_SHADE, opts);
      const lit = { rgb: lit0.rgb.toVar('figLit'), dv: lit0.dv.toVar('figDv') };
      // light from behind comes through the thin skin: the view's lights seen from the other side
      const back: N = s.thin ? pow(max(lighting.lightAt(p.P, Nn.negate(), 0, opts).rgb, 0), vec3(2.2)).toVar('demonBack') : null;
      const linear: N = s.albedo.mul(PAINT.albedo).toVar();
      const painted: N = shown(linear).toVar();
      // as the models: the tint multiplies the albedo, a stone albedo is its luminance and untinted
      const finished: N = lighting.finish(select(isStone, vec3(lum(painted)), painted.mul(tint.xyz)), lit);
      const glow: N = select(isStone, float(GLOW.stone), float(GLOW.gain)).toVar('demonGlow');
      const emit: N = (back ? s.emit.add(s.thin.mul(back).mul(PAINT.thin)) : s.emit).mul(glow).toVar();
      // what the glow adds to the colour the spike would show there, kept above 1 where the glow itself is (that is what blooms)
      const under: N = linear.mul(pow(max(lit.rgb, 0), vec3(2.2))).toVar();
      const colour: N = finished.add(shown(under.add(emit)).sub(shown(under)).max(0).mul(max(1, dot(emit, vec3(...BLOOM_LUM)))));
      // one invalid pixel (a NaN) is smeared by the bloom into a big black box: never let one out (a NaN compares false)
      const safe: N = select(dot(colour, colour).lessThan(1e8), colour, vec3(0)).toVar('demonSafe');
      const keep: N = s.keep ? keepOf(p, sight, { bySight: true }).and(s.keep) : keepOf(p, sight, { bySight: true });
      return vec4(sight.apply(safe, p.P, seenXY), select(keep, float(1), float(0)));
    })();
    mat.alphaTest = 0.5;
    return mat;
  };

  const skin = make('skin'), web = make('web'), cloth = make('cloth'), blade = make('blade'), iron = make('iron');
  return {
    skin, web, cloth, blade, iron, crystal: null, bones, kind: o.kind, u: { root, scale, tint, seen, flags, levels, pose } as DemonUniforms,
    dispose: () => { for (const m of [skin, web, cloth, blade, iron]) m.dispose(); },
  };
}
