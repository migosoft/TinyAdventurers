// The shape primitives of the tube models (#357): a round tube along a line of points, a ball with three radii and a
// drop (an ear, a tail). Plain typed arrays (no scene objects), so it runs in a Web Worker and under node. Positions
// are in model pixels.

import { CatmullRomCurve3, Quaternion, Vector3 } from 'three/webgpu';
import { vertexNormals, type Mesh3 } from './part';

/** One point of a tube: its place, its radius and how much a ring is squeezed sideways (`wide`, 1 is round). */
export interface TubePoint { p: readonly [number, number, number?]; r: number; wide?: number }
export interface TubeOpts {
  /** Points round a ring. */
  K?: number;
  /** Rings along the tube. */
  N?: number;
  /** How far the rounded ends reach, as a share of the end radius. */
  cap?: number;
  /** Below 1 a ring turns towards a square with round corners. */
  pow?: number;
  /** The direction the ring's first axis is taken against; the ring's squeezed side is the other one. */
  ref?: readonly [number, number, number];
}

const se = (v: number, p: number): number => Math.sign(v) * Math.pow(Math.abs(v), p);

/**
 * A round tube along a line of points, each with a radius; `wide` flattens a ring sideways. Both ends are rounded
 * (5 cap rings). uv: u along the tube 0..1, v round it 0..1 (v 0 and 1 the seam).
 */
export function tube(pts: readonly TubePoint[], o: TubeOpts = {}): Mesh3 {
  const K = o.K || 18, pow = o.pow || 1, capF = o.cap === undefined ? 1 : o.cap, C = 5, n = pts.length;
  const N = o.N || Math.max(6, (n - 1) * 8);
  const P = pts.map((q) => new Vector3(q.p[0], q.p[1], q.p[2] || 0));
  const curve = new CatmullRomCurve3(P, false, 'centripetal');
  const at = (t: number): { r: number; wide: number } => {
    const f = Math.min(n - 1 - 1e-6, t * (n - 1)), i = Math.floor(f), w = f - i, s = w * w * (3 - 2 * w), a = pts[i], b = pts[i + 1];
    return { r: a.r + (b.r - a.r) * s, wide: (a.wide || 1) + ((b.wide || 1) - (a.wide || 1)) * s };
  };
  const span = P[n - 1].clone().sub(P[0]).normalize();
  const ref = o.ref ? new Vector3(o.ref[0], o.ref[1], o.ref[2]) : Math.abs(span.z) < 0.8 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  interface Ring { c: Vector3; tan: Vector3; r: number; wide: number; u: number }
  const rings: Ring[] = [];
  const t0 = curve.getTangent(0).normalize(), a0 = at(0), t1 = curve.getTangent(1).normalize(), a1 = at(1);
  for (let j = 0; j < C; j++) {
    const a = j / C * Math.PI / 2;
    rings.push({ c: P[0].clone().addScaledVector(t0, -a0.r * capF * Math.cos(a)), tan: t0, r: a0.r * Math.max(0.04, Math.sin(a)), wide: a0.wide, u: 0 });
  }
  for (let i = 0; i <= N; i++) {
    const t = i / N, q = at(t);
    rings.push({ c: curve.getPoint(t), tan: curve.getTangent(t).normalize(), r: q.r, wide: q.wide, u: t });
  }
  for (let j = C - 1; j >= 0; j--) {
    const a = j / C * Math.PI / 2;
    rings.push({ c: P[n - 1].clone().addScaledVector(t1, a1.r * capF * Math.cos(a)), tan: t1, r: a1.r * Math.max(0.04, Math.sin(a)), wide: a1.wide, u: 1 });
  }
  const W = K + 1, R = rings.length;
  const position = new Float32Array((R * W + 2) * 3), uv = new Float32Array((R * W + 2) * 2);
  const index = new Uint32Array(((R - 1) * K * 2 + K * 2) * 3);
  const nn = new Vector3(), b = new Vector3();
  let v = 0;
  for (const g of rings) {
    nn.crossVectors(ref, g.tan).normalize();
    b.crossVectors(g.tan, nn).normalize();
    for (let k = 0; k <= K; k++, v++) {
      const ph = 2 * Math.PI * k / K, cs = se(Math.cos(ph), pow) * g.r, sn = se(Math.sin(ph), pow) * g.r * g.wide;
      position[v * 3] = g.c.x + nn.x * cs + b.x * sn;
      position[v * 3 + 1] = g.c.y + nn.y * cs + b.y * sn;
      position[v * 3 + 2] = g.c.z + nn.z * cs + b.z * sn;
      uv[v * 2] = g.u; uv[v * 2 + 1] = k / K;
    }
  }
  let t = 0;
  for (let i = 0; i < R - 1; i++) {
    for (let k = 0; k < K; k++) {
      const a = i * W + k, bb = a + 1, c = a + W, d = c + 1;
      index.set([a, bb, c, bb, d, c], t); t += 6;
    }
  }
  const o0 = R * W;   // the two end centres close the discs
  position.set([rings[0].c.x, rings[0].c.y, rings[0].c.z, rings[R - 1].c.x, rings[R - 1].c.y, rings[R - 1].c.z], o0 * 3);
  uv.set([0, 0.5, 1, 0.5], o0 * 2);
  for (let k = 0; k < K; k++) { index.set([o0, k + 1, k, o0 + 1, (R - 1) * W + k, (R - 1) * W + k + 1], t); t += 6; }
  const normal = vertexNormals(position, index);
  // The seam: the first and last point of a ring are the same place, so they share one normal.
  for (let i = 0; i < R; i++) {
    const a = (i * W) * 3, z = (i * W + K) * 3;
    const x = normal[a] + normal[z], y = normal[a + 1] + normal[z + 1], zz = normal[a + 2] + normal[z + 2], l = Math.hypot(x, y, zz) || 1;
    normal[a] = normal[z] = x / l; normal[a + 1] = normal[z + 1] = y / l; normal[a + 2] = normal[z + 2] = zz / l;
  }
  return { position, normal, uv, index };
}

/** A ball with three radii; `pow` below 1 makes it squarish seen from above; `turnZ` turns it about z (radians). */
export function ball(rx: number, ry: number, rz: number, pow?: number, turnZ?: number): Mesh3 {
  const WS = 26, HS = 18, count = (WS + 1) * (HS + 1);
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
  const idx: number[] = [];
  const cz = Math.cos(turnZ || 0), sz = Math.sin(turnZ || 0);
  let v = 0;
  for (let iy = 0; iy <= HS; iy++) {
    const th = iy / HS * Math.PI;
    for (let ix = 0; ix <= WS; ix++, v++) {
      const ph = ix / WS * Math.PI * 2;
      let x = -Math.cos(ph) * Math.sin(th), y = Math.cos(th), z = Math.sin(ph) * Math.sin(th);
      const nx = x / rx, ny = y / ry, nz = z / rz, l = Math.hypot(nx, ny, nz) || 1;
      if (pow && pow !== 1) {
        const h = Math.hypot(x, z);
        if (h > 1e-6) { const cs = x / h, sn = z / h; x = h * se(cs, pow); z = h * se(sn, pow); }
      }
      x *= rx; y *= ry; z *= rz;
      position[v * 3] = x * cz - y * sz; position[v * 3 + 1] = x * sz + y * cz; position[v * 3 + 2] = z;
      const gx = nx / l, gy = ny / l;
      normal[v * 3] = gx * cz - gy * sz; normal[v * 3 + 1] = gx * sz + gy * cz; normal[v * 3 + 2] = nz / l;
    }
  }
  for (let iy = 0; iy < HS; iy++) {
    for (let ix = 0; ix < WS; ix++) {
      const a = iy * (WS + 1) + ix + 1, b = iy * (WS + 1) + ix, c = (iy + 1) * (WS + 1) + ix, d = (iy + 1) * (WS + 1) + ix + 1;
      if (iy !== 0) idx.push(a, b, d);
      if (iy !== HS - 1) idx.push(b, c, d);
    }
  }
  return { position, normal, uv: null, index: Uint32Array.from(idx) };
}

/** A drop (an ear, a tail): thin where it is fixed, widest a third along, a rounded tip. Its foot is at the origin, sunk by `sink`, and it points along `dir`. */
export function drop(r: number, len: number, sink: number, wide: number, dir: readonly [number, number, number]): Mesh3 {
  const m = tube([
    { p: [0, -sink, 0], r: r * 0.4, wide },
    { p: [0, len * 0.3 - sink, 0], r, wide },
    { p: [0, len * 0.62 - sink, 0], r: r * 0.8, wide },
    { p: [0, len * 0.9 - sink, 0], r: r * 0.3, wide },
  ], { K: 14, N: 18, ref: [1, 0, 0], cap: 0.6 });
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dir[0], dir[1], dir[2]).normalize());
  const p = new Vector3();
  for (const arr of [m.position, m.normal]) {
    for (let i = 0; i < arr.length; i += 3) { p.set(arr[i], arr[i + 1], arr[i + 2]).applyQuaternion(q); arr[i] = p.x; arr[i + 1] = p.y; arr[i + 2] = p.z; }
  }
  return m;
}
