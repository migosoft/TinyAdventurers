// The sway of #306 in TSL: the same formula as `sway` in wind.ts, as a vertex offset.
import { Fn, If, Loop, clamp, float, length, max, min, pow, select, sin, smoothstep, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import { Vector4 } from 'three/webgpu';
import { SWAY_WAVE, WIND_DIR } from './wind';
import { BRUSH, type Brusher } from './brush';

// TSL's node types are too narrow for mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The travelling gust (0..1) at `xz` (x, z) at time `t`: `gust` in wind.ts as a node. */
export function gustNode(xz: N, t: N): N {
  return pow(max(0, sin(xz.x.add(xz.y.mul(0.3)).mul(0.33).sub(t.mul(1.5)))), 6);
}

/** The offset (tiles) of a point `y` up a plant of height `h` whose foot is `foot` (x, z): 0 when `on` < 0.5 or `amp` <= 0. */
export function swayNode(foot: N, y: N, h: N, amp: N, t: N, on: N): N {
  const k = clamp(y.div(max(h, 1e-4)), 0, 1).toVar('swayK');
  const k2 = k.mul(k);
  const g = gustNode(foot, t);
  const wave = sin(t.mul(1.3).add(foot.x.mul(0.9)).add(foot.y.mul(0.4))).mul(SWAY_WAVE.slow)
    .add(sin(t.mul(2.9).add(foot.y)).mul(SWAY_WAVE.fast))
    .add(g.mul(SWAY_WAVE.gust));
  const s = select(on.greaterThanEqual(0.5).and(amp.greaterThan(0)), amp.mul(k2).mul(wave), float(0));
  return vec3(s.mul(WIND_DIR[0]), 0, s.mul(WIND_DIR[1]));
}

/** The brushers of a frame as shader uniforms: `a` (x, z, reach, strength) and `b` (dx, dz, tail, 0) per record, `n` records, time `t`. */
export interface BrushUniforms { a: N; b: N; n: N; t: N }

export function makeBrushUniforms(): BrushUniforms {
  const rows = () => uniformArray(Array.from({ length: BRUSH.cap }, () => new Vector4()), 'vec4');
  return { a: rows(), b: rows(), n: uniform(0, 'int'), t: uniform(0) };
}

/** Writes the first `BRUSH.cap` of `list` and the count. */
export function setBrushers(u: BrushUniforms, list: readonly Brusher[], t: number): void {
  const n = Math.min(list.length, BRUSH.cap);
  for (let i = 0; i < n; i++) {
    const r = list[i];
    (u.a.array[i] as Vector4).set(r.x, r.z, r.reach, r.strength);
    (u.b.array[i] as Vector4).set(r.dx, r.dz, r.tail, 0);
  }
  u.n.value = n;
  u.t.value = t;
}

/** The offset (vec3, y 0) of a vertex at `p` (x, z before any sway) with factor `k` (0..1) of a plant whose foot is `foot`: `brushOffset` as a node. */
export function brushNode(u: BrushUniforms, p: N, k: N, foot: N): N {
  return Fn(() => {
    const out = vec2(0).toVar('brushOut');
    If(k.greaterThan(0), () => {
      const phase = foot.x.mul(7.3).add(foot.y.mul(5.1));
      const wave = float(BRUSH.lean).add(float(1 - BRUSH.lean).mul(sin(u.t.mul(BRUSH.rate * 2 * Math.PI).add(phase))));
      const sum = vec2(0).toVar('brushSum');
      Loop({ start: 0, end: u.n, name: 'bi' } as N, ({ bi: i }: N) => {
        const a: N = u.a.element(i);
        const b: N = u.b.element(i);
        const r = p.sub(a.xy);
        const len = length(r);
        const dir = b.xy;
        const d = min(len, length(p.sub(a.xy.sub(dir.mul(b.z)))));
        const near = float(1).sub(smoothstep(a.z, a.z.add(BRUSH.soft), d));
        const u0 = r.div(max(len, 1e-4)).mul(1 - BRUSH.along).add(dir.mul(BRUSH.along));
        const ul = length(u0);
        const un = select(ul.greaterThan(0), u0.div(max(ul, 1e-6)), dir);
        sum.addAssign(un.mul(near.mul(a.w).mul(wave)));
      });
      const o = sum.mul(k.mul(BRUSH.amp));
      const lim = k.mul(BRUSH.max);
      const l = length(o);
      out.assign(select(l.greaterThan(lim), o.div(max(l, 1e-6)).mul(lim), o));
    });
    return vec3(out.x, 0, out.y);
  })();
}
