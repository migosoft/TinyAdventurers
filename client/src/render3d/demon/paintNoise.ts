// What the demon's paint files share (#442): the look spike's noise (`NOISE` in its materials.ts) as shader functions, and the types
// the paint hands to nodes.ts. Its own file because the paint files build their functions when they load, before nodes.ts has.
import type { Vector4 } from 'three/webgpu';
import { Fn, If, Loop, dot, float, floor, fract, mix, sin, smoothstep, sqrt, vec3 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** What a part's paint hands to the light: linear colours as the spike has them. `hx`, `hy`: the relief's steps to the next pixel. */
export interface Painted { albedo: N; emit: N; hx?: N; hy?: N; /** The colour of the light that comes through from behind. */ thin?: N; /** False where the part is cut away. */ keep?: N }
/** `life`: clock s, fold, billow, breath; `beat`: heart beats, the charge's place, the charge's strength, rune; `gaze`: x, y, squint. */
export interface PoseUniforms { life: { value: Vector4 }; beat: { value: Vector4 }; gaze: { value: Vector4 } }

/** A function the shader holds once and calls (a plain `Fn` is pasted at every call). */
export const fn = (name: string, type: string, inputs: [string, string][], f: (a: N[]) => N): ((...a: N[]) => N) =>
  (Fn(f as never) as N).setLayout({ name, type, inputs: inputs.map(([n, t]) => ({ name: n, type: t })) });

/** GLSL's smoothstep, also with the edges the wrong way round (WGSL leaves that open). */
export const sstep = (a: number, b: number, x: N): N => (a < b ? smoothstep(a, b, x) : float(1).sub(smoothstep(b, a, x)));

export const hash3 = fn('demonHash3', 'vec3', [['p', 'vec3']], ([p]) =>
  fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))).mul(43758.5453123)));
export const hash1 = fn('demonHash1', 'float', [['p', 'vec3']], ([p]) => fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))).mul(43758.5453)));
export const vnoise = fn('demonVnoise', 'float', [['p', 'vec3']], ([p]) => {
  const i: N = floor(p).toVar(), f0: N = fract(p), f: N = f0.mul(f0).mul(f0.mul(-2).add(3)).toVar();
  const h = (x: number, y: number, z: number): N => hash1(i.add(vec3(x, y, z)));
  return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y), mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y), f.z);
});
export const fbm = fn('demonFbm', 'float', [['p', 'vec3']], ([p]) =>
  vnoise(p).mul(0.5).add(vnoise(p.mul(2.03).add(3.1)).mul(0.25)).add(vnoise(p.mul(4.01).add(7.7)).mul(0.125)).add(vnoise(p.mul(8.1).add(1.3)).mul(0.0625)));
/**
 * Cells whose seeds sit in staggered rows (as laid scales); `jit` 1 scatters them freely, less keeps the rows.
 * x: how far from the nearest groove, y: a random number of the cell, z: the cell's tilt at the point (the spike reads its cell vector
 * and cell id from globals only for that: dot(cellR, hash3(cellId + 5) - 0.5)).
 */
export const voro = fn('demonVoro', 'vec3', [['x', 'vec3'], ['jit', 'float']], ([x, jit]) => {
  const n: N = floor(x).toVar(), f: N = fract(x).toVar();
  const d1: N = float(8).toVar(), d2: N = float(8).toVar(), cr: N = vec3(0).toVar(), ci: N = vec3(0).toVar();
  const loop = (name: string, start: number, body: (i: N) => void): void => { (Loop as N)({ start, end: 1, type: 'int', condition: '<=', name }, (v: N) => body(v[name])); };
  loop('vk', -1, (k) => loop('vj', -1, (j) => loop('vi', -2, (i) => {
    const g: N = vec3(float(i), float(j), float(k)).toVar(), c: N = n.add(g).toVar();
    const o: N = hash3(c).sub(0.5).mul(jit).add(0.5).toVar();
    // GLSL's mod(c.y, 2.), which is never below 0
    o.x.addAssign(c.y.sub(floor(c.y.mul(0.5)).mul(2)).mul(0.5));
    const r: N = g.add(o).sub(f).toVar(), d: N = dot(r, r).toVar();
    If(d.lessThan(d1), () => { d2.assign(d1); d1.assign(d); cr.assign(r); ci.assign(c); }).ElseIf(d.lessThan(d2), () => { d2.assign(d); });
  })));
  return vec3(sqrt(d2).sub(sqrt(d1)), hash1(ci), dot(cr, hash3(ci.add(5)).sub(0.5)));
});
