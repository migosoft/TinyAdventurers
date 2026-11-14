// Small noise helpers in TSL shared by the tree and the cover materials.
import { dot, fract, sin, vec3 } from 'three/tsl';

// TSL's node types are too narrow for mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The common `fract(sin(dot(c, k)) * 43758.5453)` hash of a vec3 `c`, 0..1. */
export const hash3 = (c: N): N => fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
