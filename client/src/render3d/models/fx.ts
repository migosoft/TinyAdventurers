// The effect triangles of the figures (#338): flat-coloured triangles the model layer draws with the figures' own pass (`fxMaterial`).
// The shapes that fill the buffer are the swoosh of a melee swing, the clamping fangs of a bite and the swirl round a channelling figure;
// the swoosh and the fangs are ported from the approved try-out page (`makeFx` and `effects`). Nothing is allocated per triangle:
// the numbers go straight into the buffer's arrays.
import type { Cam } from '../camera';

/** Triangles as three corners of x, y, z each in `position` and four numbers r, g, b, a per corner in `rgba`; `n` is the triangle count. */
export interface FxBuf { position: number[]; rgba: number[]; n: number }

export function newFxBuf(): FxBuf {
  return { position: [], rgba: [], n: 0 };
}

const PX = 1 / 16;
const ease = (v: number): number => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
/** The soft white of the swoosh and the fangs. */
export const FX_WHITE = 0xfff8e0;

function vert(b: FxBuf, x: number, y: number, z: number, r: number, g: number, bl: number, a: number): void {
  b.position.push(x, y, z);
  b.rgba.push(r, g, bl, a);
}

/** A quad of corners 0 1 2 3 (in a ring) as two triangles. `c` holds r, g, b; `a` the four alphas. */
function quad(b: FxBuf, p: ArrayLike<number>, c: ArrayLike<number>, a: ArrayLike<number>): void {
  for (const i of [0, 1, 2, 0, 2, 3]) vert(b, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], c[0], c[1], c[2], a[i]);
  b.n += 2;
}

const SWOOSH_SEGMENTS = 28;
const swooshP = new Array<number>(12), swooshA = new Array<number>(4), swooshC = [0, 0, 0];

/**
 * The swoosh of a melee swing: a flat arc at height `y`, `reach` sprite px (the game's damage reach) from the foot (x, z) over `arc`
 * radians, centred on the facing `yaw`. Its bright head runs along the arc from the right to the left and fades behind, then the whole
 * arc fades while the weapon returns. `k` is the seconds into the swing over `MELEE_T` (the sweep is 0 to 1, the return 1 to 2);
 * nothing before the sweep starts and once the arc has faded (k about 1.61: the page's fade, a little after the sweep).
 */
export function swooshTris(b: FxBuf, x: number, z: number, y: number, yaw: number, reach: number, arc: number, colour: number, k: number): void {
  if (k <= 0) return;
  const s = ease(k);
  const u = k <= 1 ? 0.2 + 0.36 * k : 0.56 + 0.44 * (k - 1);   // the page's u (pose3d's `uOf`)
  const fade = 1 - Math.max(0, Math.min(1, (u - 0.58) / 0.25));
  if (fade <= 0) return;
  swooshC[0] = (colour >> 16) / 255; swooshC[1] = ((colour >> 8) & 255) / 255; swooshC[2] = (colour & 255) / 255;
  const R = reach * PX, N = SWOOSH_SEGMENTS;
  let prevA = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N, al = yaw + arc / 2 - arc * t, head = s * 1.15 - t;
    const a = head < 0 ? 0 : Math.max(0, 1 - head / 0.8) * fade * 0.9;
    const ci = Math.cos(al), si = Math.sin(al);
    // The step's quad runs: last inner, last outer, this outer, this inner (the last pair is in slots 0..5).
    if (i > 0 && (a > 0 || prevA > 0)) {
      swooshP[6] = x + ci * R; swooshP[7] = y; swooshP[8] = z + si * R;
      swooshP[9] = x + ci * R * 0.55; swooshP[10] = y; swooshP[11] = z + si * R * 0.55;
      swooshA[0] = 0; swooshA[1] = prevA; swooshA[2] = a; swooshA[3] = 0;
      quad(b, swooshP, swooshC, swooshA);
    }
    prevA = a;
    swooshP[0] = x + ci * R * 0.55; swooshP[1] = y; swooshP[2] = z + si * R * 0.55;
    swooshP[3] = x + ci * R; swooshP[4] = y; swooshP[5] = z + si * R;
  }
}

const JAW_TEETH: ReadonlyArray<readonly [number, number, number]> = [[-4.8, 2.3, 2.6], [-2.4, 2.4, 3.8], [0, 2.3, 3.0], [2.4, 2.4, 3.8], [4.8, 2.3, 2.6]];
const GLOW_X = [-6.8, -5, 5, 6.8], GLOW_A = [0, 0.6, 0.6, 0];
const fangP = new Array<number>(12), fangA = new Array<number>(4), fangC = [0xff / 255, 0xf8 / 255, 0xe0 / 255];

/**
 * One row of the fangs, in the card's plane at `at`: `sign` 1 is the upper row (the teeth hang down from `open`), -1 the lower one
 * (turned over, set off sideways by 1.2). All sizes are sprite px times `S`; `right` and `up` are the card's axes.
 */
function jawRow(b: FxBuf, at: readonly [number, number, number], right: readonly [number, number, number], up: readonly [number, number, number], S: number, open: number, sign: number, jaw: number): void {
  const pt = (lx: number, ly: number, o: number): void => {
    const X = (lx + (sign < 0 ? 1.2 : 0)) * S * PX, Y = (open * sign + ly * sign) * S * PX;
    fangP[o] = at[0] + right[0] * X + up[0] * Y; fangP[o + 1] = at[1] + right[1] * X + up[1] * Y; fangP[o + 2] = at[2] + right[2] * X + up[2] * Y;
  };
  for (const [x, wd, ln] of JAW_TEETH) {
    pt(x - wd / 2, 0, 0); pt(x + wd / 2, 0, 3); pt(x, -ln, 6);
    fangA[0] = 0.6 * jaw; fangA[1] = 0.6 * jaw; fangA[2] = jaw;
    for (let i = 0; i < 3; i++) vert(b, fangP[i * 3], fangP[i * 3 + 1], fangP[i * 3 + 2], fangC[0], fangC[1], fangC[2], fangA[i]);
    b.n++;
  }
  for (let i = 0; i < 3; i++) {
    pt(GLOW_X[i], 0, 0); pt(GLOW_X[i + 1], 0, 3); pt(GLOW_X[i + 1], 1.8, 6); pt(GLOW_X[i], 1.8, 9);
    fangA[0] = GLOW_A[i] * jaw; fangA[1] = GLOW_A[i + 1] * jaw; fangA[2] = 0; fangA[3] = 0;
    quad(b, fangP, fangC, fangA);
  }
}

/**
 * The bite's sign: two rows of fangs in the card's plane (facing the camera) at `at` (tiles), which appear open, clamp shut and fade.
 * `k` is the bite's `u` (the page's): visible from 0.16, shut between 0.30 and 0.46, gone by 0.92.
 */
export function fangTris(b: FxBuf, at: readonly [number, number, number], cam: Cam, k: number): void {
  const jaw = ease((k - 0.16) / 0.1) * (1 - ease((k - 0.62) / 0.3));
  if (jaw <= 0.01) return;
  let s = ease((k - 0.3) / 0.16);
  s *= s;
  const open = 6.6 - 4.6 * s, S = 0.62 * (1.15 - 0.15 * s);
  const c = Math.cos(cam.yaw), sn = Math.sin(cam.yaw), sp = Math.sin(cam.pitch);
  FANG_RIGHT[0] = c; FANG_RIGHT[2] = sn;
  FANG_UP[0] = sn * sp; FANG_UP[1] = Math.cos(cam.pitch); FANG_UP[2] = -c * sp;
  jawRow(b, at, FANG_RIGHT, FANG_UP, S, open, 1, jaw);
  jawRow(b, at, FANG_RIGHT, FANG_UP, S, open, -1, jaw);
}
const FANG_RIGHT: [number, number, number] = [1, 0, 0], FANG_UP: [number, number, number] = [0, 1, 0];

const SWIRL_ARCS = [0.28, 0.55, 0.82], SWIRL_STEPS = 8, SWIRL_SPAN = 1.3, SWIRL_RATE = 3.2, SWIRL_BAND = 0.05, SWIRL_RISE = 0.035;
const swirlP = new Array<number>(12), swirlA = new Array<number>(4), swirlC = [0, 0, 0];

/**
 * The swirl of a channelling figure: three short arcs circling it at three heights (fractions of `height`, tiles), `radius` tiles from the
 * foot (x, z), each a thin slanted ribbon whose bright head leads and fades behind. `t` is the clock in seconds.
 */
export function swirlTris(b: FxBuf, x: number, z: number, t: number, colour: number, height = 1, radius = 0.45): void {
  swirlC[0] = (colour >> 16) / 255; swirlC[1] = ((colour >> 8) & 255) / 255; swirlC[2] = (colour & 255) / 255;
  for (let a = 0; a < SWIRL_ARCS.length; a++) {
    const y = SWIRL_ARCS[a] * height, head = t * SWIRL_RATE * (a % 2 ? -1 : 1) + a * 2.1;
    const dir = a % 2 ? -1 : 1;
    for (let i = 0; i < SWIRL_STEPS; i++) {
      // from the tail (i = 0) to the head; the head is `head`
      const a0 = head - dir * SWIRL_SPAN * (1 - i / SWIRL_STEPS), a1 = head - dir * SWIRL_SPAN * (1 - (i + 1) / SWIRL_STEPS);
      const f0 = i / SWIRL_STEPS, f1 = (i + 1) / SWIRL_STEPS;
      // A band slanting across the ring (the inner edge low, the outer one high): seen from above and from the side.
      const ri = radius - SWIRL_BAND, ro = radius + SWIRL_BAND;
      swirlP[0] = x + Math.cos(a0) * ri; swirlP[1] = y - SWIRL_RISE; swirlP[2] = z + Math.sin(a0) * ri;
      swirlP[3] = x + Math.cos(a1) * ri; swirlP[4] = y - SWIRL_RISE; swirlP[5] = z + Math.sin(a1) * ri;
      swirlP[6] = x + Math.cos(a1) * ro; swirlP[7] = y + SWIRL_RISE; swirlP[8] = z + Math.sin(a1) * ro;
      swirlP[9] = x + Math.cos(a0) * ro; swirlP[10] = y + SWIRL_RISE; swirlP[11] = z + Math.sin(a0) * ro;
      swirlA[0] = f0; swirlA[1] = f1; swirlA[2] = f1; swirlA[3] = f0;
      quad(b, swirlP, swirlC, swirlA);
    }
  }
}
