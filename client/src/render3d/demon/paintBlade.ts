// The paint of the burning scimitar's blade (#442): the look spike's `bladeMaterial` (sword.ts there) in TSL, line for line with its
// numbers. The whole blade glows, orange at the back, white-hot at the edge and the point, and the glow crawls like melt.
// `uv`: x along the blade (0 grip, 1 point), y from the back (0) to the edge (1).
import { clamp, dot, floor, fract, mix, pow, sin, smoothstep, vec2, vec3 } from 'three/tsl';
import { fn, type Painted, type PoseUniforms } from './paintNoise';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const bh = fn('demonBladeHash', 'float', [['p', 'vec2']], ([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const bn = fn('demonBladeNoise', 'float', [['p', 'vec2']], ([p]) => {
  const i: N = floor(p).toVar(), f0: N = fract(p), f: N = f0.mul(f0).mul(f0.mul(-2).add(3)).toVar();
  return mix(mix(bh(i), bh(i.add(vec2(1, 0))), f.x), mix(bh(i.add(vec2(0, 1))), bh(i.add(vec2(1, 1))), f.x), f.y);
});
// the spike's dark metal (sRGB hex 0c0908) in linear light
const METAL = [0.0037, 0.0027, 0.0024] as const;

export function paintBlade(st: N, pose: PoseUniforms): Painted {
  const time: N = (pose.life as N).x;
  const flow: N = bn(vec2(st.x.mul(9).sub(time.mul(0.7)), st.y.mul(3).add(time.mul(0.25)))).mul(0.6).add(bn(vec2(st.x.mul(23).sub(time.mul(1.3)), st.y.mul(7))).mul(0.4));
  const heat: N = clamp(pow(st.y, 1.3).mul(0.3).add(0.6).add(st.x.mul(0.2)).add(flow.sub(0.5).mul(0.4)), 0, 1).toVar();
  let hot: N = mix(vec3(0.25, 0.012, 0), vec3(1, 0.22, 0.02), smoothstep(0.2, 0.5, heat));
  hot = mix(hot, vec3(1, 0.72, 0.3), smoothstep(0.5, 0.75, heat));
  hot = mix(hot, vec3(1, 0.97, 0.88), smoothstep(0.75, 0.97, heat));
  return { albedo: vec3(...METAL).mul(heat.mul(-0.7).add(1)), emit: hot.mul(heat.mul(heat).mul(1.7).add(0.12)).mul(smoothstep(0.08, 0.3, heat)) };
}
