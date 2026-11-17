// The cracks in TSL (#307): the shader twin of `crackMask` (cracks.ts), reading the packed uniform arrays. The mask is the dungeon
// 3D demo's `sunMask` with the variety of rays, the faint main beam and widening; `lightAt` adds it as a light term, Task 5's
// shaft march reads it again. Only If/Loop control flow and no texture read, so it may sit inside any branch.
import { Vector4 } from 'three/webgpu';
import { Break, Fn, If, Loop, atan, cos, float, int, length, max, mix, sin, smoothstep, uniform, uniformArray, vec2 } from 'three/tsl';
import { CHASM_BED } from '../dips/shape';
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
  /**
   * The one packed uniform array of vec4: a, b, c, d (`CRACK_CAP` entries each, at `OFF_A`..`OFF_D`) then e (`CRACK_CAP * RAY_CAP`, at `OFF_E`),
   * each as `packCracks` writes it.
   */
  readonly data: N;
}

/** Where each of `packCracks`'s arrays starts in the one uniform array (in vec4s). */
export const OFF_A = 0;
export const OFF_B = CRACK_CAP;
export const OFF_C = 2 * CRACK_CAP;
export const OFF_D = 3 * CRACK_CAP;
export const OFF_E = 4 * CRACK_CAP;
export const DATA_LEN = CRACK_CAP * (4 + RAY_CAP);

const vec4s =(n: number): Vector4[] => Array.from({ length: n }, () => new Vector4());

export function makeCracks(): Cracks {
  // One uniform buffer for all of it: WebGPU allows 12 per fragment stage and the world material is near that (five arrays made 13).
  const data = uniformArray(vec4s(DATA_LEN), 'vec4');
  const count = uniform(0);

  const mask = (Q: N, s: N): N => Fn(() => {
    const si = int(s);
    const A: N = data.element(si.add(OFF_A));
    const B: N = data.element(si.add(OFF_B));
    const C: N = data.element(si.add(OFF_C));
    const D: N = data.element(si.add(OFF_D));
    const out = float(0).toVar();
    const y = Q.y;
    // A point below the floor (a dip, #324) is lit too: the patch follows the beam's direction down (k keeps the sign of y) but
    // keeps its floor-level size and ray pattern (`yh`, y clamped at the floor).
    const yh = max(y, 0);
    If(y.greaterThanEqual(-(CHASM_BED + 1)).and(y.lessThan(A.z)), () => {
      const k = y.div(B.y);
      const p = vec2(Q.x.sub(B.x.mul(k)).sub(A.x), Q.z.sub(B.z.mul(k)).sub(A.y));
      const cs = cos(D.z);
      const sn = sin(D.z);
      const sc = float(1).add(A.w.sub(1).mul(yh.div(A.z)));
      const ex = p.x.mul(cs).add(p.y.mul(sn)).div(D.x.mul(sc));
      const ey = p.y.mul(cs).sub(p.x.mul(sn)).div(D.y.mul(sc));
      const ang = atan(ey, ex);
      const r = length(vec2(ex, ey)).mul(float(1).add(sin(ang.mul(3).add(B.w)).mul(0.13)).add(sin(ang.mul(7).add(1.3)).mul(0.07)));
      const rim = float(1).sub(smoothstep(RIM_LO, RIM_HI, r));
      If(rim.greaterThan(0), () => {
        const h = yh.div(A.z);
        const bands = float(0).toVar();
        // Only the slot's own rays count: an unused zero ray would still pass 0.25 through its soft edges.
        Loop(named('cr', RAY_CAP), ({ cr: j }: N) => {
          If(float(j).greaterThanEqual(D.w), () => {
            Break();
          });
          const ray: N = data.element(si.mul(RAY_CAP).add(j).add(OFF_E));
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

  const packed = packCracks([]);
  return {
    mask,
    count,
    at(s) {
      const si = int(s);
      const B: N = data.element(si.add(OFF_B));
      const C: N = data.element(si.add(OFF_C));
      const A: N = data.element(si.add(OFF_A));
      return { dir: B.xyz, rgb: C.xyz, ceil: A.z };
    },
    data,
    set(cracks) {
      // Nothing to draw and nothing drawn last time: the uniforms are as they were.
      if (cracks.length === 0 && count.value === 0) return;
      const p = packCracks(cracks, packed);
      const arr = data.array as Vector4[];
      const fill = (at: number, src: Float32Array): void => {
        for (let i = 0; i * 4 < src.length; i++) arr[at + i].set(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3]);
      };
      fill(OFF_A, p.a);
      fill(OFF_B, p.b);
      fill(OFF_C, p.c);
      fill(OFF_D, p.d);
      fill(OFF_E, p.e);
      count.value = p.count;
    },
  };
}

/** A loop from 0 to `end` whose index is called `name` (as `named` in lightNodes.ts). */
function named(name: string, end: number): N {
  return { start: 0, end, name };
}
