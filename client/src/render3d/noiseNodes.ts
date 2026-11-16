// Small noise helpers in TSL shared by the tree, the cover and the dip materials.
import { dot, fract, mix, sin, vec2, vec3 } from 'three/tsl';

// TSL's node types are too narrow for mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The common `fract(sin(dot(c, k)) * 43758.5453)` hash of a vec3 `c`, 0..1. */
export const hash3 = (c: N): N => fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));

/** Dave Hoskins' hash without sine: vec2 -> 0..1. */
export const hash21 = (p: N): N => {
  // No assignment: `assign` needs a shader stack, which does not exist while a material is being built.
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const q = p3.add(dot(p3, p3.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
};

/** Value noise of a vec2 on `hash21`, smoothstep-interpolated, 0..1. */
export const vnoise2 = (p: N): N => {
  const i = p.floor();
  const f = fract(p);
  const u: N = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

/** Four octaves of `vnoise2` (lacunarity 2.03, offset 1.7, gain 0.5), 0..~0.94. */
export const fbm2 = (p: N): N => {
  let q = p;
  let amp = 0.5;
  let sum: N = vnoise2(q).mul(amp);
  for (let o = 1; o < 4; o++) {
    q = q.mul(2.03).add(1.7);
    amp *= 0.5;
    sum = sum.add(vnoise2(q).mul(amp));
  }
  return sum;
};
