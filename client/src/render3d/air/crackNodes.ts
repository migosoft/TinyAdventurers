// The cracks in TSL (#307): the shader twin of `crackMask` (cracks.ts), reading the packed uniform arrays. The mask is the dungeon
// 3D demo's `sunMask` with the 2D variety (rays, the faint main beam, widening); `lightAt` adds it as a light term, Task 5's
// shaft march reads it again. Only If/Loop control flow and no texture read, so it may sit inside any branch.
import { Vector4 } from 'three/webgpu';
import { Break, Fn, If, Loop, atan, cos, float, int, length, max, mix, sin, smoothstep, uniform, uniformArray, vec2 } from 'three/tsl';
import { CRACK_CAP, RAY_CAP, RIM_HI, RIM_LO, packCracks, type Crack } from './cracks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The soft edge of a ray across the opening (shares of the -1..1 span); `crackMask`'s RAY_EDGE. */
const RAY_EDGE = 0.08;

export interface Cracks {
  /** The light share (0..1, more where rays overlap) of crack slot `s` (an int node) at the world point `Q` (a vec3 node). */
  mask(Q: N, s: N): N;
  /** The number of cracks in use (a uniform). */
  readonly count: N;
  /** Slot `s`'s sun direction (unit, toward the sun), colour (rgb, already scaled by the cloud) and ceiling height. */
  at(s: N): { dir: N; rgb: N; ceil: N };
  /** Fills the slots (at most `CRACK_CAP`); the rest are zeroed. */
  set(cracks: readonly Crack[]): void;
  /** The packed uniform arrays: a, b, c, d (`CRACK_CAP` vec4 each) and e (`CRACK_CAP * RAY_CAP`), as `packCracks` writes them. */
  readonly arrays: { a: N; b: N; c: N; d: N; e: N };
}

const vec4s = (n: number): Vector4[] => Array.from({ length: n }, () => new Vector4());

export function makeCracks(): Cracks {
  const a = uniformArray(vec4s(CRACK_CAP), 'vec4');
  const b = uniformArray(vec4s(CRACK_CAP), 'vec4');
  const c = uniformArray(vec4s(CRACK_CAP), 'vec4');
  const d = uniformArray(vec4s(CRACK_CAP), 'vec4');
  const e = uniformArray(vec4s(CRACK_CAP * RAY_CAP), 'vec4');
  const count = uniform(0);

  const mask = (Q: N, s: N): N => Fn(() => {
    const si = int(s);
    const A: N = a.element(si);
    const B: N = b.element(si);
    const C: N = c.element(si);
    const D: N = d.element(si);
    const out = float(0).toVar();
    const y = Q.y;
    If(y.greaterThanEqual(0).and(y.lessThan(A.z)), () => {
      const k = y.div(B.y);
      const p = vec2(Q.x.sub(B.x.mul(k)).sub(A.x), Q.z.sub(B.z.mul(k)).sub(A.y));
      const cs = cos(D.z);
      const sn = sin(D.z);
      const sc = float(1).add(A.w.sub(1).mul(y.div(A.z)));
      const ex = p.x.mul(cs).add(p.y.mul(sn)).div(D.x.mul(sc));
      const ey = p.y.mul(cs).sub(p.x.mul(sn)).div(D.y.mul(sc));
      const ang = atan(ey, ex);
      const r = length(vec2(ex, ey)).mul(float(1).add(sin(ang.mul(3).add(B.w)).mul(0.13)).add(sin(ang.mul(7).add(1.3)).mul(0.07)));
      const rim = float(1).sub(smoothstep(RIM_LO, RIM_HI, r));
      If(rim.greaterThan(0), () => {
        const h = y.div(A.z);
        const bands = float(0).toVar();
        // Only the slot's own rays count: an unused zero ray would still pass 0.25 through its soft edges.
        Loop(named('cr', RAY_CAP), ({ cr: j }: N) => {
          If(float(j).greaterThanEqual(D.w), () => {
            Break();
          });
          const ray: N = e.element(si.mul(RAY_CAP).add(j));
          const lo = mix(ray.x, ray.z, h);
          const hi = mix(ray.y, ray.w, h);
          bands.addAssign(smoothstep(lo.sub(RAY_EDGE / 2), lo.add(RAY_EDGE / 2), ex).mul(float(1).sub(smoothstep(hi.sub(RAY_EDGE / 2), hi.add(RAY_EDGE / 2), ex))));
        });
        const shade = max(C.w, bands.div(max(D.w, 1).sqrt()));
        const wave = sin(ex.mul(7.5).add(B.w.mul(0.8)).add(sin(ey.mul(3)).mul(0.6)));
        const streak = float(0.62).add(smoothstep(-0.2, 0.6, wave).mul(0.38));
        out.assign(rim.mul(shade).mul(streak));
      });
    });
    return out;
  })();

  return {
    mask,
    count,
    at(s) {
      const si = int(s);
      const B: N = b.element(si);
      const C: N = c.element(si);
      const A: N = a.element(si);
      return { dir: B.xyz, rgb: C.xyz, ceil: A.z };
    },
    arrays: { a, b, c, d, e },
    set(cracks) {
      const p = packCracks(cracks);
      const fill = (u: N, src: Float32Array): void => {
        const arr = u.array as Vector4[];
        for (let i = 0; i < arr.length; i++) arr[i].set(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3]);
      };
      fill(a, p.a);
      fill(b, p.b);
      fill(c, p.c);
      fill(d, p.d);
      fill(e, p.e);
      count.value = p.count;
    },
  };
}

/** A loop from 0 to `end` whose index is called `name` (as `named` in lightNodes.ts). */
function named(name: string, end: number): N {
  return { start: 0, end, name };
}
