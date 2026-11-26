// The demon's builder (#379): a pure function from a pose to fixed vertex streams, every frame. The rigid parts (parts.ts) are placed
// by their bones; the tail's skin, the wings' arm and finger bones and the webbing are swept anew. A port of the approved spike's
// shapes (its description `descs/demon.ts`): with every joint at 0 the body is the spike's, point for point.
//
// Model frame: builder units, the front along +x, up +y, the demon's right +z, the feet at y 0 (skeleton.ts).
//
// Cost: `buildDemon` allocates nothing. Which point is which never changes, so `newDemonOut` writes the uvs, colours, looks and
// indices once; a frame writes only the body's positions and normals and the hull's positions.
//
// In this state the wings are built at rest only (the spike's half-folded flat layout); the pose's `WingState`s are not read yet.
import { newBuiltBuf, type BuiltBuf, type V3 } from '../built';
import { STAGES } from '../models/bones';
import { DEMON_PAINT, skinUv, webUv } from './paint';
import { CHEST_AT, EYES_AT, HANDS, LINE_UNIT, MOUTH_AT, PARTS, TAIL, TAIL_AT, WING_BONE, palm } from './parts';
import { restPose, TAIL_LINKS, type DemonPose } from './pose';
import { ARM, BONE, J, PIVOT, RIG, SLOT, SLOTS, hang, mul, placeBones, rotAxis, rotY, rotZ } from './skeleton';

/**
 * `unit`: game px per builder unit (the head's top, 31.7 units, is 54 px). The buffer sizes are the builder's counts plus a quarter.
 * `curl`: rad a finger's knuckle and its second joint turn at `curl` 1.
 * The swept tubes (the tail's skin, a wing's arm bone, a wing's finger bone): `rings` round and along, `cap` how far the rounded ends
 * reach (a share of the end radius), `line` the outline width in the spike's px (`LINE_UNIT`); `capRings`: rings of a rounded end,
 * as `models/tubes.ts`. `tail.band`: the band of the rock skin the tail reads. The ring counts are what the cost is tuned by.
 */
export const DEMON = {
  unit: 54 / 31.7, top: 54, hem: 12, bodyVerts: 39400, bodyIndices: 206900, hullVerts: 34100, hullIndices: 181700, curl: [1.1, 1.3],
  capRings: 5,
  tail: { rings: [14, 40], cap: 0.5, line: 0.45, band: 1 }, wingArm: { rings: [8, 10], cap: 0.6, line: 0.35 }, wingFinger: { rings: [8, 16], cap: 0.6, line: 0.35 },
} as const;

/**
 * A wing laid out flat in its own plane, half folded (the spike's): `s` out along the span from the root, `h` up, in units of `size`.
 * An arm from the root over the elbow to the wrist, four fingers fanning out and down from the wrist (a point each bows through, and
 * its tip), webbing between them and down the back to `backEnd`. `arc`: how deep each panel's edge hangs in between its two bones,
 * as a share of their length. `fold`: how deep each panel hangs behind the wing, like a curtain pushed together.
 */
export const WING_FLAT = {
  size: 6, fold: 0.42, wrist: [1.0, 2.3], elbow: [0.95, 0.9], backEnd: [0.1, -2.4],
  fingers: [[[3.5, 2.95], [6.2, 1.3]], [[3.1, 1.0], [4.7, -1.5]], [[2.3, -0.1], [3.1, -3.2]], [[1.45, -0.5], [1.5, -3.8]]],
  arc: [0.13, 0.12, 0.1, 0.06],
  /** The span's direction and the way the plane's up leans (the right wing; z mirrors), and the root off the shoulders' middle. */
  span: [-0.62, -0.1, 0.78], lean: [-0.2, 0.97, 0], root: [-3.8, -0.6, 2.8],
  /** The bones' radii, root to wrist and wrist to tip; the thumb claw's direction in the plane. */
  arm: [1.15, 0.8], finger: [0.7, 0.3], thumb: [0.25, 1],
  /** Cells of a panel of the webbing: from the wrist out to the edge, and from bone to bone. */
  cells: [14, 10],
  /** The webbing's inner edge: its shares down the arm (wrist to root) and down the back (root to `backEnd`). */
  inner: [0.45, 0.55],
  /** The fold's shape across a panel: one bow, plus this much of a three-fold ripple. */
  ripple: 0.3,
} as const;

export interface DemonOut {
  body: BuiltBuf;
  /** The outlined parts pushed out along their normals. Only `position`, `look` and `index` are filled. */
  hull: BuiltBuf;
  anchors: { hand: V3; mouth: V3; chest: V3; eyes: V3 };
  /** Scratch: the bones' frames, the derived frames (`SLOT`), then the two wings' bones. */
  bones: Float32Array;
}

// ---------------------------------------------------------------- where each piece lies in the buffers
const CAP = DEMON.capRings;
interface Swept { v0: number; i0: number; h0: number; hi0: number; N: number; K: number; cap: number; line: number }
const NT = WING_FLAT.cells[0], NW = WING_FLAT.cells[1], PANEL = (NT + 1) * (NW + 1), WEB_VERTS = 4 * PANEL, WEB_INDICES = 4 * NT * NW * 6;
let nv = 0, ni = 0, hv = 0, hi = 0;
const PV = new Int32Array(PARTS.length), PI = new Int32Array(PARTS.length), PH = new Int32Array(PARTS.length), PHI = new Int32Array(PARTS.length);
PARTS.forEach((p, i) => {
  PV[i] = nv; PI[i] = ni; PH[i] = p.line > 0 ? hv : -1; PHI[i] = hi;
  nv += p.position.length / 3; ni += p.index.length;
  if (p.line > 0) { hv += p.position.length / 3; hi += p.index.length; }
});
const swept = (o: { rings: readonly [number, number]; cap: number; line: number }): Swept => {
  const K = o.rings[0], N = o.rings[1], cap = o.cap, line = o.line;
  const verts = (N + 1 + 2 * CAP) * (K + 1) + 2, indices = (N + 2 * CAP + 1) * K * 6, T = { v0: nv, i0: ni, h0: hv, hi0: hi, N, K, cap, line: line * LINE_UNIT };
  nv += verts; ni += indices; hv += verts; hi += indices;
  return T;
};
const TAIL_S = swept(DEMON.tail);
const WINGS = [1, -1].map((sd) => {
  const arm = swept(DEMON.wingArm), fingers = [0, 1, 2, 3].map(() => swept(DEMON.wingFinger)), web = nv, webIndex = ni;
  nv += WEB_VERTS; ni += WEB_INDICES;
  return { sd: sd as 1 | -1, arm, fingers, web, webIndex };
});
const VERTS = nv, INDICES = ni, HULL_VERTS = hv, HULL_INDICES = hi;
/** Where the swept pieces lie in the body's buffer (first vertex; a tube's rings are `K + 1` points each, 5 rounded-end rings before and after its `N + 1`). */
export const DEMON_LAYOUT = {
  verts: VERTS, indices: INDICES, hullVerts: HULL_VERTS, hullIndices: HULL_INDICES, capRings: CAP,
  tail: { v0: TAIL_S.v0, N: TAIL_S.N, K: TAIL_S.K },
  /** The right wing, then the left. A webbing is 4 panels of `(cells[0] + 1) x (cells[1] + 1)` points, the rows from the wrist out. */
  wings: WINGS.map((w) => ({ arm: { v0: w.arm.v0, N: w.arm.N, K: w.arm.K }, fingers: w.fingers.map((f) => ({ v0: f.v0, N: f.N, K: f.K })), web: w.web, webVerts: WEB_VERTS })),
} as const;

const STAGE_HAIR = STAGES.indexOf('hair');
const uvOut: [number, number] = [0, 0];

function tubeStatic(b: BuiltBuf, hull: BuiltBuf, T: Swept, glow: number, band: number, flat: number): void {
  const W = T.K + 1, R = T.N + 1 + 2 * CAP, ends = T.v0 + R * W;
  for (let r = 0; r < R; r++) for (let k = 0; k < W; k++) {
    const v = T.v0 + r * W + k, u = Math.max(0, Math.min(1, (r - CAP) / T.N));
    if (band >= 0) skinUv(band, u, k / T.K, uvOut); else { uvOut[0] = (DEMON_PAINT.flat.x + 4) / DEMON_PAINT.w; uvOut[1] = (DEMON_PAINT.flat.y + 4) / DEMON_PAINT.h; }
    b.uv[v * 2] = uvOut[0]; b.uv[v * 2 + 1] = uvOut[1];
  }
  for (let e = 0; e < 2; e++) {
    if (band >= 0) skinUv(band, e, 0.5, uvOut);
    b.uv[(ends + e) * 2] = uvOut[0]; b.uv[(ends + e) * 2 + 1] = uvOut[1];
  }
  for (let v = T.v0, h = T.h0; v < ends + 2; v++, h++) {
    b.colour[v * 3] = (flat >> 16) / 255; b.colour[v * 3 + 1] = ((flat >> 8) & 255) / 255; b.colour[v * 3 + 2] = (flat & 255) / 255;
    b.look[v * 2] = glow; b.look[v * 2 + 1] = STAGE_HAIR; hull.look[h * 2] = glow; hull.look[h * 2 + 1] = STAGE_HAIR;
  }
  let t = T.i0;
  const put = (a: number, c: number, d: number): void => { b.index[t] = T.v0 + a; b.index[t + 1] = T.v0 + c; b.index[t + 2] = T.v0 + d; t += 3; };
  for (let i = 0; i < R - 1; i++) for (let k = 0; k < T.K; k++) { const a = i * W + k, c = a + W; put(a, a + 1, c); put(a + 1, c + 1, c); }
  for (let k = 0; k < T.K; k++) { put(R * W, k + 1, k); put(R * W + 1, (R - 1) * W + k, (R - 1) * W + k + 1); }
  for (let i = T.i0, h = T.hi0; i < t; i++, h++) hull.index[h] = b.index[i] - T.v0 + T.h0;
}

export function newDemonOut(): DemonOut {
  if (VERTS > DEMON.bodyVerts || INDICES > DEMON.bodyIndices || HULL_VERTS > DEMON.hullVerts || HULL_INDICES > DEMON.hullIndices) throw new Error('demon: the buffers are too small for the parts');
  const body = newBuiltBuf(DEMON.bodyVerts, DEMON.bodyIndices), hull = newBuiltBuf(DEMON.hullVerts, DEMON.hullIndices);
  PARTS.forEach((p, i) => {
    const n = p.position.length / 3;
    body.uv.set(p.uv, PV[i] * 2); body.colour.set(p.colour, PV[i] * 3);
    for (let v = 0; v < n; v++) { body.look[(PV[i] + v) * 2] = p.glow; body.look[(PV[i] + v) * 2 + 1] = p.stage; }
    for (let t = 0; t < p.index.length; t++) body.index[PI[i] + t] = PV[i] + p.index[t];
    if (p.line > 0) {
      for (let v = 0; v < n; v++) { hull.look[(PH[i] + v) * 2] = p.glow; hull.look[(PH[i] + v) * 2 + 1] = p.stage; }
      for (let t = 0; t < p.index.length; t++) hull.index[PHI[i] + t] = PH[i] + p.index[t];
    }
  });
  tubeStatic(body, hull, TAIL_S, 0, DEMON.tail.band, 0xffffff);
  for (const w of WINGS) {
    tubeStatic(body, hull, w.arm, 0, -1, WING_BONE);
    for (const f of w.fingers) tubeStatic(body, hull, f, 0, -1, WING_BONE);
    // the webbing: one sheet, its colours, rips and holes from the picture. The winding makes the side behind the wing the front.
    let t = w.webIndex;
    for (let i = 0; i < 4; i++) {
      const first = w.web + i * PANEL;
      for (let a = 0; a <= NT; a++) for (let c = 0; c <= NW; c++) {
        const v = first + a * (NW + 1) + c;
        webUv(w.sd, (i + c / NW) / 4, a / NT, uvOut);
        body.uv[v * 2] = uvOut[0]; body.uv[v * 2 + 1] = uvOut[1];
        body.colour[v * 3] = body.colour[v * 3 + 1] = body.colour[v * 3 + 2] = 1; body.look[v * 2] = 0; body.look[v * 2 + 1] = STAGE_HAIR;
      }
      for (let a = 0; a < NT; a++) for (let c = 0; c < NW; c++) {
        const c0 = first + a * (NW + 1) + c, c1 = c0 + 1, c2 = c0 + NW + 1, c3 = c2 + 1;
        if (w.sd > 0) { body.index[t++] = c0; body.index[t++] = c1; body.index[t++] = c2; body.index[t++] = c1; body.index[t++] = c3; body.index[t++] = c2; }
        else { body.index[t++] = c0; body.index[t++] = c2; body.index[t++] = c1; body.index[t++] = c1; body.index[t++] = c2; body.index[t++] = c3; }
      }
    }
  }
  body.verts = VERTS; body.indices = INDICES; hull.verts = HULL_VERTS; hull.indices = HULL_INDICES;
  return { body, hull, anchors: { hand: [0, 0, 0], mouth: [0, 0, 0], chest: [0, 0, 0], eyes: [0, 0, 0] }, bones: new Float32Array(SLOTS * 12 + 2 * WF) };
}

// ---------------------------------------------------------------- a wing's bones: 29 points
// 0 the shoulder, 1 the elbow, 2 the wrist, 3.. the four fingers (6 points each, wrist to tip), 27 where the webbing ends on the back,
// 28 the unit normal of the hand's plane (behind the wing).
const W_FINGER = 3, W_BACK = 27, W_NORMAL = 28, WF = 29 * 3;
const unit3 = (v: number[]): number[] => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
/** The flat wing's points relative to the chest's pivot, rest pose. */
function flatWing(sd: number): Float64Array {
  const F = WING_FLAT, S = unit3([F.span[0], F.span[1], F.span[2] * sd]), k = F.lean[0] * S[0] + F.lean[1] * S[1] + F.lean[2] * S[2];
  const U = unit3([F.lean[0] - k * S[0], F.lean[1] - k * S[1], F.lean[2] - k * S[2]]);
  const root = [RIG.shoulder[0] + F.root[0] - RIG.chest[0], RIG.shoulder[1] + F.root[1] - RIG.chest[1], sd * F.root[2]];
  const out = new Float64Array(WF);
  const on = (i: number, s: number, h: number): void => { for (let a = 0; a < 3; a++) out[i * 3 + a] = root[a] + (S[a] * s + U[a] * h) * F.size; };
  on(0, 0, 0); on(1, F.elbow[0], F.elbow[1]); on(2, F.wrist[0], F.wrist[1]); on(W_BACK, F.backEnd[0], F.backEnd[1]);
  F.fingers.forEach(([mid, tip], i) => {
    // a bow through `mid` to `tip`
    const cx = 2 * mid[0] - (F.wrist[0] + tip[0]) / 2, cy = 2 * mid[1] - (F.wrist[1] + tip[1]) / 2;
    for (let j = 0; j < 6; j++) { const t = j / 5, q = 1 - t; on(W_FINGER + i * 6 + j, q * q * F.wrist[0] + 2 * q * t * cx + t * t * tip[0], q * q * F.wrist[1] + 2 * q * t * cy + t * t * tip[1]); }
  });
  out[W_NORMAL * 3] = (S[1] * U[2] - S[2] * U[1]) * sd; out[W_NORMAL * 3 + 1] = (S[2] * U[0] - S[0] * U[2]) * sd; out[W_NORMAL * 3 + 2] = (S[0] * U[1] - S[1] * U[0]) * sd;
  return out;
}
const REST_WING = [flatWing(1), flatWing(-1)];
/** The thumb claw's turn from the forearm's line towards the span, in the wing's plane. */
const THUMB_TURN = Math.atan2(WING_FLAT.thumb[0], WING_FLAT.thumb[1]) - Math.atan2(WING_FLAT.wrist[0] - WING_FLAT.elbow[0], WING_FLAT.wrist[1] - WING_FLAT.elbow[1]);

// ---------------------------------------------------------------- curves: three's centripetal Catmull-Rom, as `models/tubes.ts` sweeps its tubes
const MAXP = 8;
const CP = new Float64Array(MAXP * 3), RAD = new Float64Array(MAXP), CO = new Float64Array((MAXP - 1) * 12), FC = new Float64Array(4 * 5 * 12);
/** The curve's coefficients through the `n` points of `P`: per segment and axis c0..c3, written to `co` from `o` on. */
function prep(P: Float64Array | Float32Array, p: number, n: number, co: Float64Array, o: number): void {
  for (let s = 0; s < n - 1; s++) {
    const a = p + s * 3;
    let d0 = 0, d1 = 0, d2 = 0;
    for (let k = 0; k < 3; k++) {
      const x1 = P[a + k], x2 = P[a + 3 + k], x0 = s > 0 ? P[a - 3 + k] : 2 * x1 - x2, x3 = s + 2 < n ? P[a + 6 + k] : 2 * x2 - x1;
      d0 += (x1 - x0) * (x1 - x0); d1 += (x2 - x1) * (x2 - x1); d2 += (x3 - x2) * (x3 - x2);
    }
    d0 = Math.sqrt(Math.sqrt(d0)); d1 = Math.sqrt(Math.sqrt(d1)); d2 = Math.sqrt(Math.sqrt(d2));
    if (d1 < 1e-4) d1 = 1; if (d0 < 1e-4) d0 = d1; if (d2 < 1e-4) d2 = d1;
    for (let k = 0; k < 3; k++) {
      const x1 = P[a + k], x2 = P[a + 3 + k], x0 = s > 0 ? P[a - 3 + k] : 2 * x1 - x2, x3 = s + 2 < n ? P[a + 6 + k] : 2 * x2 - x1;
      const t1 = ((x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1) * d1, t2 = ((x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2) * d1;
      const c = o + s * 12 + k * 4;
      co[c] = x1; co[c + 1] = t1; co[c + 2] = -3 * x1 + 3 * x2 - 2 * t1 - t2; co[c + 3] = 2 * x1 - 2 * x2 + t1 + t2;
    }
  }
}
// what `curve` gives: the point and the unit tangent
let CX = 0, CY = 0, CZ = 0, DX = 0, DY = 0, DZ = 0;
function curve(co: Float64Array, o: number, n: number, t: number): void {
  const f = (n - 1) * t, s = Math.min(n - 2, Math.floor(f)), w = f - s, c = o + s * 12;
  CX = co[c] + w * (co[c + 1] + w * (co[c + 2] + w * co[c + 3]));
  CY = co[c + 4] + w * (co[c + 5] + w * (co[c + 6] + w * co[c + 7]));
  CZ = co[c + 8] + w * (co[c + 9] + w * (co[c + 10] + w * co[c + 11]));
  DX = co[c + 1] + w * (2 * co[c + 2] + w * 3 * co[c + 3]); DY = co[c + 5] + w * (2 * co[c + 6] + w * 3 * co[c + 7]); DZ = co[c + 9] + w * (2 * co[c + 10] + w * 3 * co[c + 11]);
  const l = len(DX, DY, DZ) || 1; DX /= l; DY /= l; DZ /= l;
}

// ---------------------------------------------------------------- buffer functions
// Math.hypot is many times slower than this in the per-point loops
const len = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);
/** Smooth normals for the vertices `v0..v1` from the triangles `i0..i1`. */
function normals(b: BuiltBuf, v0: number, v1: number, i0: number, i1: number): void {
  const p = b.position, n = b.normal, ix = b.index;
  n.fill(0, v0 * 3, v1 * 3);
  for (let i = i0; i < i1; i += 3) {
    const a = ix[i] * 3, c = ix[i + 1] * 3, d = ix[i + 2] * 3;
    const ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz; n[d] += nx; n[d + 1] += ny; n[d + 2] += nz;
  }
  for (let i = v0 * 3; i < v1 * 3; i += 3) { const l = len(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
}

const TRIG = new Map<number, Float64Array>();
for (const K of [DEMON.tail.rings[0], DEMON.wingArm.rings[0], DEMON.wingFinger.rings[0]]) { const t = new Float64Array((K + 1) * 2); for (let k = 0; k <= K; k++) { t[k * 2] = Math.cos(2 * Math.PI * k / K); t[k * 2 + 1] = Math.sin(2 * Math.PI * k / K); } TRIG.set(K, t); }
// the ring's first axis, carried from ring to ring so a tube never twists, however it bends
let NX = 0, NY = 0, NZ = 0;
function ring(b: BuiltBuf, v: number, K: number, trig: Float64Array, cx: number, cy: number, cz: number, tx: number, ty: number, tz: number, r: number): void {
  const d = NX * tx + NY * ty + NZ * tz;
  NX -= tx * d; NY -= ty * d; NZ -= tz * d;
  const l = len(NX, NY, NZ) || 1; NX /= l; NY /= l; NZ /= l;
  const bx = ty * NZ - tz * NY, by = tz * NX - tx * NZ, bz = tx * NY - ty * NX, p = b.position;
  for (let k = 0, o = v * 3; k <= K; k++, o += 3) {
    const c = trig[k * 2] * r, s = trig[k * 2 + 1] * r;
    p[o] = cx + NX * c + bx * s; p[o + 1] = cy + NY * c + by * s; p[o + 2] = cz + NZ * c + bz * s;
  }
}
/**
 * A round tube along the curve `co` (through `n` points, their radii in `RAD`), with rounded ends: the shape of `models/tubes.ts`.
 * (rx, ry, rz): what the first ring's first axis is taken against. Writes the body's points and normals and the hull's points.
 */
function sweep(b: BuiltBuf, hull: BuiltBuf, T: Swept, co: Float64Array, o: number, n: number, rx: number, ry: number, rz: number): void {
  const K = T.K, W = K + 1, R = T.N + 1 + 2 * CAP, trig = TRIG.get(K)!, p = b.position;
  let v = T.v0;
  curve(co, o, n, 0);
  NX = ry * DZ - rz * DY; NY = rz * DX - rx * DZ; NZ = rx * DY - ry * DX;
  const sx = CX, sy = CY, sz = CZ, tx = DX, ty = DY, tz = DZ, r0 = RAD[0], r1 = RAD[n - 1];
  for (let j = 0; j < CAP; j++, v += W) {
    const a = j / CAP * Math.PI / 2, back = -r0 * T.cap * Math.cos(a);
    ring(b, v, K, trig, sx + tx * back, sy + ty * back, sz + tz * back, tx, ty, tz, r0 * Math.max(0.04, Math.sin(a)));
  }
  for (let i = 0; i <= T.N; i++, v += W) {
    const t = i / T.N, f = Math.min(n - 1 - 1e-6, t * (n - 1)), s = Math.floor(f), w = f - s;
    curve(co, o, n, t);
    ring(b, v, K, trig, CX, CY, CZ, DX, DY, DZ, RAD[s] + (RAD[s + 1] - RAD[s]) * w * w * (3 - 2 * w));
  }
  const ex = CX, ey = CY, ez = CZ, ux = DX, uy = DY, uz = DZ;
  for (let j = CAP - 1; j >= 0; j--, v += W) {
    const a = j / CAP * Math.PI / 2, on = r1 * T.cap * Math.cos(a);
    ring(b, v, K, trig, ex + ux * on, ey + uy * on, ez + uz * on, ux, uy, uz, r1 * Math.max(0.04, Math.sin(a)));
  }
  // the two end centres close the discs
  const back = -r0 * T.cap, on = r1 * T.cap;
  p[v * 3] = sx + tx * back; p[v * 3 + 1] = sy + ty * back; p[v * 3 + 2] = sz + tz * back;
  p[v * 3 + 3] = ex + ux * on; p[v * 3 + 4] = ey + uy * on; p[v * 3 + 5] = ez + uz * on;
  normals(b, T.v0, v + 2, T.i0, T.i0 + (R * 2) * K * 3);
  // the seam: a ring's first and last point are the same place
  const q = b.normal;
  for (let i = 0; i < R; i++) {
    const a = (T.v0 + i * W) * 3, z = a + K * 3;
    const x = q[a] + q[z], y = q[a + 1] + q[z + 1], zz = q[a + 2] + q[z + 2], l = len(x, y, zz) || 1;
    q[a] = q[z] = x / l; q[a + 1] = q[z + 1] = y / l; q[a + 2] = q[z + 2] = zz / l;
  }
  const h = hull.position, line = T.line;
  for (let a = T.v0 * 3, c = T.h0 * 3, end = (v + 2) * 3; a < end; a++, c++) h[c] = p[a] + q[a] * line;
}

/** The point (x, y, z) of the frame `f` of `M`, into `out` from `o` on. */
function point(M: Float32Array, f: number, x: number, y: number, z: number, out: Float64Array | Float32Array | V3, o: number): void {
  const a = f * 12;
  out[o] = M[a] + M[a + 3] * x + M[a + 6] * y + M[a + 9] * z; out[o + 1] = M[a + 1] + M[a + 4] * x + M[a + 7] * y + M[a + 10] * z; out[o + 2] = M[a + 2] + M[a + 5] * x + M[a + 8] * y + M[a + 11] * z;
}
/** A frame of `M` at (ox, oy, oz) whose x axis is the unit (xx, xy, xz) and whose z axis is as near (zx, zy, zz) as that allows. */
function aim(M: Float32Array, f: number, ox: number, oy: number, oz: number, xx: number, xy: number, xz: number, zx: number, zy: number, zz: number): void {
  const a = f * 12;
  let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const l = Math.hypot(yx, yy, yz) || 1; yx /= l; yy /= l; yz /= l;
  M[a] = ox; M[a + 1] = oy; M[a + 2] = oz; M[a + 3] = xx; M[a + 4] = xy; M[a + 5] = xz; M[a + 6] = yx; M[a + 7] = yy; M[a + 8] = yz;
  M[a + 9] = xy * yz - xz * yy; M[a + 10] = xz * yx - xx * yz; M[a + 11] = xx * yy - xy * yx;
}

// ---------------------------------------------------------------- the webbing
// per column of a panel: how far the edge hangs in between the bones, and how deep the fold behind the wing is there
const ARCW = new Float64Array(NW + 1), HANG = new Float64Array(NW + 1);
for (let c = 0; c <= NW; c++) { const w = c / NW; ARCW[c] = 4 * w * (1 - w); HANG[c] = Math.sin(Math.PI * w) + WING_FLAT.ripple * Math.sin(3 * Math.PI * w); }
let AX = 0, AY = 0, AZ = 0;
/** A point of the webbing's ray `i` at `t`: a finger (0..3, wrist to tip), or the inner edge (4: from the wrist down the arm to the root, then down the back). */
function ray(M: Float32Array, wf: number, i: number, t: number): void {
  if (i < 4) {
    // the finger's curve without its tangent (`curve` spends most of its time on that)
    const f = 5 * t, s = Math.min(4, Math.floor(f)), w = f - s, c = i * 60 + s * 12;
    AX = FC[c] + w * (FC[c + 1] + w * (FC[c + 2] + w * FC[c + 3]));
    AY = FC[c + 4] + w * (FC[c + 5] + w * (FC[c + 6] + w * FC[c + 7]));
    AZ = FC[c + 8] + w * (FC[c + 9] + w * (FC[c + 10] + w * FC[c + 11]));
    return;
  }
  const arm = WING_FLAT.inner[0], a = t < arm ? wf + 6 : wf, c = t < arm ? wf : wf + W_BACK * 3, k = t < arm ? t / arm : (t - arm) / WING_FLAT.inner[1];
  AX = M[a] + (M[c] - M[a]) * k; AY = M[a + 1] + (M[c + 1] - M[a + 1]) * k; AZ = M[a + 2] + (M[c + 2] - M[a + 2]) * k;
}
/**
 * Four panels, each ruled from one bone to the next, from the wrist out to the edge. The edge hangs in an arc between the finger tips;
 * the webbing has more cloth than room, so every panel hangs in a fold behind the wing (`fold` deep).
 */
function web(b: BuiltBuf, M: Float32Array, wf: number, v0: number, i0: number, fold: number): void {
  const p = b.position, nx = M[wf + W_NORMAL * 3], ny = M[wf + W_NORMAL * 3 + 1], nz = M[wf + W_NORMAL * 3 + 2], deep = fold * WING_FLAT.size;
  let o = v0 * 3;
  for (let i = 0; i < 4; i++) for (let a = 0; a <= NT; a++) for (let c = 0; c <= NW; c++, o += 3) {
    const w = c / NW, te = (a / NT) * (1 - WING_FLAT.arc[i] * ARCW[c]), d = deep * te * HANG[c];
    ray(M, wf, i, te);
    const x = AX, y = AY, z = AZ;
    ray(M, wf, i + 1, te);
    p[o] = x + (AX - x) * w + nx * d; p[o + 1] = y + (AY - y) * w + ny * d; p[o + 2] = z + (AZ - z) * w + nz * d;
  }
  normals(b, v0, v0 + WEB_VERTS, i0, i0 + WEB_INDICES);
  // a panel's first row is one place, the wrist; its first point has only a triangle without area, so it takes its neighbour's normal
  const q = b.normal;
  for (let i = 0; i < 4; i++) { const a = (v0 + i * PANEL) * 3; q[a] = q[a + 3]; q[a + 1] = q[a + 4]; q[a + 2] = q[a + 5]; }
}

// ---------------------------------------------------------------- the build
const RA = new Float64Array(9), RB = new Float64Array(9), RL = new Float64Array(9), TL = new Float64Array(3);
const PALM = [palm(1), palm(-1)];

export function buildDemon(pose: DemonPose, out: DemonOut): void {
  const M = out.bones, body = out.body, hull = out.hull, j = pose.joints, P = body.position, Q = body.normal, H = hull.position;
  placeBones(pose, M);

  // the fingers: two joints each, curling about the knuckles' line towards the palm
  for (let side = 0; side < 2; side++) {
    const hand = side === 0 ? BONE.handR : BONE.handL, a = side === 0 ? J.armR : J.armL;
    for (let f = 0; f < 5; f++) {
      const g = HANDS[side][f], curl = j[a + (f < 4 ? ARM.curl : ARM.thumb)], s = SLOT.finger + side * 10 + f * 2;
      hang(M, s, hand, g.knuckle[0], g.knuckle[1], g.knuckle[2], rotAxis(g.axis[0], g.axis[1], g.axis[2], curl * DEMON.curl[0], RA));
      hang(M, s + 1, s, g.joint[0] - g.knuckle[0], g.joint[1] - g.knuckle[1], g.joint[2] - g.knuckle[2], rotAxis(g.axis[0], g.axis[1], g.axis[2], curl * DEMON.curl[1], RA));
    }
  }

  // the tail: each stretch of its line turned by its link, in the hips' frame; the plates ride on its points
  TL[0] = TAIL_AT[0] - PIVOT[0]; TL[1] = TAIL_AT[1] - PIVOT[1]; TL[2] = TAIL_AT[2] - PIVOT[2];
  point(M, BONE.hips, TL[0], TL[1], TL[2], CP, 0);
  for (let i = 0; i < TAIL.length - 1; i++) {
    const l = Math.min(i, TAIL_LINKS - 1) * 2, dx = TAIL[i + 1][0] - TAIL[i][0], dy = TAIL[i + 1][1] - TAIL[i][1], dz = TAIL[i + 1][2] - TAIL[i][2];
    mul(rotY(pose.tail[l], RA), rotZ(-pose.tail[l + 1], RB), RL);
    TL[0] += RL[0] * dx + RL[3] * dy + RL[6] * dz; TL[1] += RL[1] * dx + RL[4] * dy + RL[7] * dz; TL[2] += RL[2] * dx + RL[5] * dy + RL[8] * dz;
    point(M, BONE.hips, TL[0], TL[1], TL[2], CP, (i + 1) * 3);
    if (i < 5) hang(M, SLOT.tailPlate + i, BONE.hips, TL[0], TL[1], TL[2], RL);
    RAD[i + 1] = TAIL[i + 1][3];
  }
  RAD[0] = TAIL[0][3];
  prep(CP, 0, TAIL.length, CO, 0);
  const hz = BONE.hips * 12 + 9;
  sweep(body, hull, TAIL_S, CO, 0, TAIL.length, M[hz], M[hz + 1], M[hz + 2]);

  // the wings: their bones in the chest's frame, the claws on the finger tips and the wrist
  for (let side = 0; side < 2; side++) {
    const wf = SLOTS * 12 + side * WF, rest = REST_WING[side], w = WINGS[side], c = BONE.chest * 12;
    for (let i = 0; i < W_NORMAL; i++) point(M, BONE.chest, rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], M, wf + i * 3);
    const n = wf + W_NORMAL * 3, r = W_NORMAL * 3;
    M[n] = M[c + 3] * rest[r] + M[c + 6] * rest[r + 1] + M[c + 9] * rest[r + 2]; M[n + 1] = M[c + 4] * rest[r] + M[c + 7] * rest[r + 1] + M[c + 10] * rest[r + 2]; M[n + 2] = M[c + 5] * rest[r] + M[c + 8] * rest[r + 1] + M[c + 11] * rest[r + 2];
    RAD[0] = WING_FLAT.arm[0]; RAD[1] = (WING_FLAT.arm[0] + WING_FLAT.arm[1]) / 2; RAD[2] = WING_FLAT.arm[1];
    prep(M, wf, 3, CO, 0);
    sweep(body, hull, w.arm, CO, 0, 3, 0, 0, 1);
    for (let k = 0; k < 6; k++) RAD[k] = WING_FLAT.finger[0] + (WING_FLAT.finger[1] - WING_FLAT.finger[0]) * k / 5;
    for (let i = 0; i < 4; i++) {
      prep(M, wf + (W_FINGER + i * 6) * 3, 6, FC, i * 60);
      sweep(body, hull, w.fingers[i], FC, i * 60, 6, 0, 0, 1);
      curve(FC, i * 60, 6, 1);
      aim(M, SLOT.wingClaw + side * 5 + i, CX, CY, CZ, DX, DY, DZ, M[n], M[n + 1], M[n + 2]);
    }
    // the thumb's claw on the wrist: the forearm's line turned a little towards the span
    let fx = M[wf + 6] - M[wf + 3], fy = M[wf + 7] - M[wf + 4], fz = M[wf + 8] - M[wf + 5];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const t = wf + (W_FINGER + 5) * 3;
    let gx = M[t] - M[wf + 6], gy = M[t + 1] - M[wf + 7], gz = M[t + 2] - M[wf + 8];
    const d = gx * fx + gy * fy + gz * fz; gx -= fx * d; gy -= fy * d; gz -= fz * d;
    const gl = Math.hypot(gx, gy, gz) || 1, ct = Math.cos(THUMB_TURN), st = Math.sin(THUMB_TURN) / gl;
    aim(M, SLOT.wingClaw + side * 5 + 4, M[wf + 6], M[wf + 7], M[wf + 8], fx * ct + gx * st, fy * ct + gy * st, fz * ct + gz * st, M[n], M[n + 1], M[n + 2]);
    web(body, M, wf, w.web, w.webIndex, WING_FLAT.fold);
  }

  // the rigid parts, each by its frame
  for (let i = 0; i < PARTS.length; i++) {
    const part = PARTS[i], a = part.bone * 12, p = part.position, q = part.normal, n = p.length;
    const ox = M[a], oy = M[a + 1], oz = M[a + 2], xx = M[a + 3], xy = M[a + 4], xz = M[a + 5], yx = M[a + 6], yy = M[a + 7], yz = M[a + 8], zx = M[a + 9], zy = M[a + 10], zz = M[a + 11];
    let o = PV[i] * 3;
    if (part.blend) {
      // between two frames: the point of each, mixed by the weight
      const c = part.blend.bone * 12, wt = part.blend.weight;
      const ex = PIVOT[part.bone * 3] - PIVOT[part.blend.bone * 3], ey = PIVOT[part.bone * 3 + 1] - PIVOT[part.blend.bone * 3 + 1], ez = PIVOT[part.bone * 3 + 2] - PIVOT[part.blend.bone * 3 + 2];
      for (let k = 0; k < n; k += 3, o += 3) {
        const x = p[k], y = p[k + 1], z = p[k + 2], nx = q[k], ny = q[k + 1], nz = q[k + 2], w = wt[k / 3], u = 1 - w, x2 = x + ex, y2 = y + ey, z2 = z + ez;
        P[o] = u * (ox + xx * x + yx * y + zx * z) + w * (M[c] + M[c + 3] * x2 + M[c + 6] * y2 + M[c + 9] * z2);
        P[o + 1] = u * (oy + xy * x + yy * y + zy * z) + w * (M[c + 1] + M[c + 4] * x2 + M[c + 7] * y2 + M[c + 10] * z2);
        P[o + 2] = u * (oz + xz * x + yz * y + zz * z) + w * (M[c + 2] + M[c + 5] * x2 + M[c + 8] * y2 + M[c + 11] * z2);
        const mx = u * (xx * nx + yx * ny + zx * nz) + w * (M[c + 3] * nx + M[c + 6] * ny + M[c + 9] * nz);
        const my = u * (xy * nx + yy * ny + zy * nz) + w * (M[c + 4] * nx + M[c + 7] * ny + M[c + 10] * nz);
        const mz = u * (xz * nx + yz * ny + zz * nz) + w * (M[c + 5] * nx + M[c + 8] * ny + M[c + 11] * nz), l = len(mx, my, mz) || 1;
        Q[o] = mx / l; Q[o + 1] = my / l; Q[o + 2] = mz / l;
      }
    } else {
      for (let k = 0; k < n; k += 3, o += 3) {
        const x = p[k], y = p[k + 1], z = p[k + 2], nx = q[k], ny = q[k + 1], nz = q[k + 2];
        P[o] = ox + xx * x + yx * y + zx * z; P[o + 1] = oy + xy * x + yy * y + zy * z; P[o + 2] = oz + xz * x + yz * y + zz * z;
        Q[o] = xx * nx + yx * ny + zx * nz; Q[o + 1] = xy * nx + yy * ny + zy * nz; Q[o + 2] = xz * nx + yz * ny + zz * nz;
      }
    }
    if (PH[i] >= 0) {
      const line = part.line;
      for (let s = PV[i] * 3, h = PH[i] * 3, end = s + n; s < end; s++, h++) H[h] = P[s] + Q[s] * line;
    }
  }

  const A = out.anchors, cast = pose.caster > 0 ? 0 : 1;
  point(M, cast === 0 ? BONE.handR : BONE.handL, PALM[cast][0], PALM[cast][1], PALM[cast][2], A.hand, 0);
  point(M, BONE.head, MOUTH_AT[0] - RIG.head[0], MOUTH_AT[1] - RIG.head[1], MOUTH_AT[2], A.mouth, 0);
  point(M, BONE.jaw, MOUTH_AT[0] - RIG.jaw[0], MOUTH_AT[1] - RIG.jaw[1], MOUTH_AT[2], TL, 0);
  A.mouth[0] = (A.mouth[0] + TL[0]) / 2; A.mouth[1] = (A.mouth[1] + TL[1]) / 2; A.mouth[2] = (A.mouth[2] + TL[2]) / 2;
  point(M, BONE.chest, CHEST_AT[0] - RIG.chest[0], CHEST_AT[1] - RIG.chest[1], CHEST_AT[2], A.chest, 0);
  point(M, BONE.head, EYES_AT[0] - RIG.head[0], EYES_AT[1] - RIG.head[1], EYES_AT[2], A.eyes, 0);
  body.verts = VERTS; body.indices = INDICES; hull.verts = HULL_VERTS; hull.indices = HULL_INDICES;
}

/** The standing demon. */
export function demonRest(): DemonOut {
  const out = newDemonOut();
  buildDemon(restPose(), out);
  return out;
}
