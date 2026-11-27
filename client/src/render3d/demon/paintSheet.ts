// The paint of the demon's thin skins (#442): the wings' webbing (torn, with holes and burnt rims, hanging in pleats, letting light
// through) and the loincloth. The look spike's `sheetMaterial` (materials.ts there) in TSL, line for line with its numbers, in the calm
// webbing the user chose. `uv`: x the panel's number plus the place across it, y from the bone (0) to the free rim (1).
import { abs, dFdx, dFdy, float, floor, fract, max, min, mix, pow, sin, smoothstep, sqrt, step, uv, vec3 } from 'three/tsl';
import { fbm, sstep, voro, type Painted, type PoseUniforms } from './paintNoise';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const one = (x: N): N => float(1).sub(x);
const PI = 3.14159;

/**
 * The webbing's point: it really hangs in pleats between the fingers, deeper as they close, stirred by the air, bellied by a wing beat.
 * As in the spike the step is taken on the rest point (along the skinned normal, and back for the beat) and goes through the bones.
 */
export function pleated(sk: { P: N; N: N; turn(v: N): N }, pose: PoseUniforms): { P: N; N: N } {
  const st: N = uv(), life: N = pose.life;
  const s: N = fract(st.x), t: N = st.y, span: N = sin(s.mul(PI)), free: N = step(st.x, 3.999);
  const pleat: N = sin(s.mul(PI * 5)).mul(sqrt(max(span, 0))).mul(t).mul(life.y.mul(0.1).add(0.022)).mul(mix(0.3, 1, free));
  const wave: N = sin(life.x.mul(1.4).add(st.x.mul(5)).add(t.mul(4))).mul(0.02).mul(t).mul(span);
  const step3: N = sk.N.mul(pleat.add(wave)).add(vec3(0, 0, life.z.mul(-0.2).mul(span).mul(t))).toVar('demonPleat');
  return { P: sk.P.add(sk.turn(step3)), N: sk.N };
}

/** A sheet's paint at `st`. Call at the top level: the relief's steps are screen derivatives. */
export function paintSheet(st: N, wing: boolean): Painted {
  const s: N = fract(st.x), t: N = st.y, u: N = st.x, free: N = step(u, 3.999);
  const rag: N = pow(fbm(vec3(u.mul(7), 0.3, 2)), 1.5).mul(0.16).add(0.015).add(pow(abs(sin(u.mul(17).add(sin(u.mul(7)).mul(2)))), 4).mul(0.06)).mul(free);
  const edge: N = t.sub(one(rag)).toVar();
  const hole: N = wing ? free.mul(smoothstep(0.25, 0.5, t)).mul(fbm(vec3(u.mul(3), t.mul(4), floor(st.x).mul(1.7)).mul(vec3(1.3, 0.8, 1)).add(11))).toVar() : float(0);
  const keep: N = edge.greaterThan(0).and(free.greaterThan(0.5)).or(hole.greaterThan(0.66)).not();
  const burn: N = max(smoothstep(-0.09, 0, edge).mul(free), smoothstep(0.56, 0.66, hole)).toVar();
  const vein: N = one(smoothstep(0, 0.06, voro(vec3(u.mul(5), t.mul(7), 1), float(1)).x));
  const h0: N = vein.mul(0.0012).toVar();
  const hx: N = dFdx(h0).toVar(), hy: N = dFdy(h0).toVar();
  const burnt: N = vec3(0.02, 0.015, 0.015);
  if (!wing) {
    const fine: N = fbm(vec3(u.mul(40), t.mul(14), 3));
    const hide: N = mix(vec3(0.16, 0.07, 0.045), vec3(0.07, 0.035, 0.03), fine).mul(one(t.mul(0.5)));
    return { albedo: mix(hide, burnt, burn), emit: vec3(0), hx, hy, keep };
  }
  const bone: N = sstep(0.12, 0, min(s, one(s)));
  const mid: N = pow(max(sin(s.mul(PI)), 0), 0.7).mul(smoothstep(0, 0.22, t)).mul(one(smoothstep(0.68, 1, t))).toVar();
  const web: N = mix(vec3(0.06, 0.008, 0.01), vec3(0.3, 0.03, 0.026), mid);
  // how much light gets through: less beside the bones and where it is burnt
  const thin: N = vec3(1, 0.13, 0.05).mul(one(burn)).mul(one(bone.mul(0.8))).mul(mid.mul(0.6).add(0.4));
  return { albedo: mix(web, burnt, burn), emit: vec3(0), thin, hx, hy, keep };
}
