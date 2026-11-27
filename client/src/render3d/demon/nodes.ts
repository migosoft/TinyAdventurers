// The demon's material in TSL (#379, #442): the skin drawn with bone matrices in the vertex stage (`skinned`), lit in a plain colour for now
// (the paint comes with task 10). The vertex stage, the light, the sight and the stipple are the lich's and the models' own; one demon per
// material (its place, look and bones are its own uniforms). No outline hull and no id pass, as the lich.
import { DoubleSide, MeshBasicNodeMaterial, Matrix4, Vector4 } from 'three/webgpu';
import { Fn, attribute, dot, faceDirection, float, mix, normalize, select, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { FIGURE_SHADE, keepOf, type FigureShared } from '../models/nodes';
import { vertexOf, type LichUniforms } from '../lich/nodes';
import { BONES } from './body';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
export type UniformArrayNode = ReturnType<typeof uniformArray>;

const LUM = [0.299, 0.587, 0.114] as const;
/** The plain colour of the skin (linear-ish, as the lich's `col`), and what the horns and the dark parts do to it. */
const PLAIN = [0.34, 0.27, 0.23] as const, HORN = [0.62, 0.55, 0.45] as const;

/** The lich's uniforms; `levels` = [the glow's phase 0..1, the glow's gain, the face's heat, spare]. */
export type DemonUniforms = LichUniforms;

/**
 * The skin's point and normal in the model frame: each vertex hangs on four bones (`skinIndex`, `skinWeight`), each bone's matrix takes a
 * rest point to the model frame. `rest` is the vertex's own point in the bind pose.
 */
export function skinned(bones: UniformArrayNode): { P: N; N: N; rest: N } {
  const rest: N = attribute('position', 'vec3'), normal: N = attribute('normal', 'vec3');
  const index: N = attribute('skinIndex', 'uvec4'), weight: N = attribute('skinWeight', 'vec4');
  const p4: N = vec4(rest, 1), n4: N = vec4(normal, 0);
  let P: N = vec3(0), Nn: N = vec3(0);
  for (const k of ['x', 'y', 'z', 'w'] as const) {
    const m: N = bones.element(index[k]);
    P = P.add(m.mul(p4).xyz.mul(weight[k]));
    Nn = Nn.add(m.mul(n4).xyz.mul(weight[k]));
  }
  return { P, N: Nn, rest };
}

export interface DemonMats { mat: MeshBasicNodeMaterial; bones: UniformArrayNode; kind: 'fire' | 'ice'; u: DemonUniforms; dispose(): void }

export function demonMaterials(o: { lighting: Lighting; sight: Sight; shared: FigureShared; kind: 'fire' | 'ice' }): DemonMats {
  const { lighting, sight } = o;
  const root = uniform(new Vector4()), scale = uniform(1), tint = uniform(new Vector4(1, 1, 1, 0)), seen = uniform(new Vector4(1, 0, 0, -1)), flags = uniform(new Vector4()), levels = uniform(new Vector4(0, 1, 1, 0));
  const un = { root, scale, tint, seen, flags };
  const seenXY = vec2(seen.y, seen.z);
  const bones = uniformArray(Array.from({ length: BONES }, () => new Matrix4()), 'mat4');

  const mat = new MeshBasicNodeMaterial();
  mat.side = DoubleSide;   // the webbing and the cloth are seen from both sides
  const sk = skinned(bones);
  const p = vertexOf(o.shared, un, mat, true, sk);
  const info: N = attribute('info', 'vec4');
  const isStone: N = tint.w.greaterThan(0.5);
  mat.colorNode = Fn(() => {
    // the light once, at the top level; the selects below pick between plain values
    const Nn: N = normalize(p.N).mul(faceDirection);
    const lit0 = lighting.lightAt(p.P, Nn, 1 - FIGURE_SHADE, { self: seen.w.add(0.5).floor(), darkOnly: flags.x });
    const lit = { rgb: lit0.rgb.toVar('figLit'), dv: lit0.dv.toVar('figDv') };
    // the horns lighter, the dark parts darker: just enough to tell the parts apart
    const plain: N = mix(vec3(...PLAIN), vec3(...HORN), info.y.clamp(0, 1)).mul(float(1).sub(info.w.clamp(0, 1).mul(0.5)));
    const albedo: N = select(isStone, vec3(dot(plain, vec3(...LUM))), plain.mul(tint.xyz));
    const colour: N = lighting.finish(albedo, lit);
    const keep: N = keepOf(p, sight, { bySight: true });
    return vec4(sight.apply(colour, p.P, seenXY), select(keep, float(1), float(0)));
  })();
  mat.alphaTest = 0.5;

  return { mat, bones, kind: o.kind, u: { root, scale, tint, seen, flags, levels } as DemonUniforms, dispose: () => { mat.dispose(); } };
}
