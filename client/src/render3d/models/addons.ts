// The add-on shapes of a 3D figure model (#338): hair and beard shells, rings and collars round the base, spikes (cones,
// drops, balls, plumes), the hat's cones, legs, arms and the outline hulls. Positions are in sprite pixels, the front along +x,
// the feet at y 0, like the base parts. The shapes that three.js can make (lathes, spheres, cylinders) are made by it and
// flattened to plain arrays, so this runs in a Web Worker and under node.

import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, LatheGeometry, Path, Quaternion, SphereGeometry, Vector2, Vector3 } from 'three/webgpu';
import type { ArmsDesc, HatDesc, LegsDesc, SpikeDesc, Vec3 } from './desc';
import { FH, PAD, U } from './grid';
import { vertexNormals, type Mesh3, type PartRow } from './part';

const yOf = (Y: number): number => FH - (Y - PAD + 0.5) / U;

/** What `shell` reads of a description (the hair and the shells share it). */
export interface ShellLike {
  thick: number;
  lift?: number;
  from: number;
  to?: number;
  below?: boolean;
  front?: boolean;
  cover: readonly number[];
}

const meshOf = (pos: number[], idx: number[]): Mesh3 => {
  const position = new Float32Array(pos), index = new Uint32Array(idx);
  return { position, normal: vertexNormals(position, index), uv: null, index };
};

/** A three.js geometry as plain arrays; `smooth` works the normals out afresh (three's `computeVertexNormals`), else it keeps its own. */
function flatten(g: BufferGeometry, smooth: boolean): Mesh3 {
  const position = Float32Array.from(g.getAttribute('position').array), index = Uint32Array.from(g.getIndex()!.array);
  const normal = smooth ? vertexNormals(position, index) : Float32Array.from(g.getAttribute('normal').array);
  g.dispose();
  return { position, normal, uv: null, index };
}

/** A piece that lies around a part like hair: the part's rings pushed outwards, each only as far round from the back as told. */
export function shell(rows: readonly PartRow[], cx: number, pow: number, s: ShellLike): Mesh3 {
  const K = 40, pos: number[] = [], idx: number[] = [], used: PartRow[] = [], xOf = (X: number): number => (X - PAD + 0.5) / U - cx;
  for (const r of rows) {
    const at = (r.Y - PAD + 0.5) / U - s.from - 0.5, i = Math.max(0, Math.min(s.cover.length - 1, Math.floor(at))), f0 = s.cover[i], f1 = i + 1 < s.cover.length ? s.cover[i + 1] : 0;
    const f = at <= 0 ? s.cover[0] : f0 + (f1 - f0) * Math.min(1, at - i);
    if (f < 0.04 || (s.below && at < -0.5) || (s.to !== undefined && at + s.from + 0.5 > s.to)) continue;
    used.push(r);
    for (let k = 0; k < K; k++) {
      const th = (s.front ? 0 : Math.PI) - Math.PI * f + 2 * Math.PI * f * k / (K - 1), cs = Math.cos(th), sn = Math.sin(th);
      pos.push(xOf(r.c + (r.rc + s.thick * U) * Math.sign(cs) * Math.pow(Math.abs(cs), pow)), yOf(r.Y) + (s.lift === undefined ? s.thick : s.lift), (r.deep + s.thick) * Math.sign(sn) * Math.pow(Math.abs(sn), pow));
    }
  }
  for (let ri = 0; ri < used.length - 1; ri++) for (let k = 0; k < K; k++) { const a = ri * K + k, b = ri * K + (k + 1) % K, c = a + K, d = b + K; idx.push(a, b, c, b, d, c); }
  const mid = (ri: number): number[] => { let x = 0, z = 0; for (let k = 0; k < K; k++) { x += pos[(ri * K + k) * 3]; z += pos[(ri * K + k) * 3 + 2]; } return [x / K, pos[ri * K * 3 + 1], z / K]; };
  const top = pos.length / 3, last = used.length - 1;
  pos.push(...mid(0), ...mid(last));
  for (let k = 0; k < K; k++) { idx.push(top, (k + 1) % K, k, top + 1, last * K + k, last * K + (k + 1) % K); }
  return meshOf(pos, idx);
}

/** The ring row nearest to the sprite row `like` (counted from the top of the grid). */
function rowLike(rows: readonly PartRow[], like: number): PartRow {
  const want = PAD + (like + 0.5) * U;
  let r = rows[0];
  for (const o of rows) if (Math.abs(o.Y - want) < Math.abs(r.Y - want)) r = o;
  return r;
}

/** A ring around a part, like a collar: a tube along the part's outline at one height. */
export function ring(rows: readonly PartRow[], cx: number, pow: number, s: { row: number; like: number; out: number; thick: number; high: number }): Mesh3 {
  const K = 48, M = 10, pos: number[] = [], idx: number[] = [], r = rowLike(rows, s.like);
  const x0 = (r.c - PAD + 0.5) / U - cx, y = FH - s.row;
  for (let k = 0; k < K; k++) {
    const th = 2 * Math.PI * k / K, cs = Math.cos(th), sn = Math.sin(th);
    const px = (r.rc / U + s.out) * Math.sign(cs) * Math.pow(Math.abs(cs), pow), pz = (r.deep + s.out) * Math.sign(sn) * Math.pow(Math.abs(sn), pow), l = Math.hypot(px, pz) || 1;
    for (let m = 0; m < M; m++) { const ph = 2 * Math.PI * m / M, o = s.thick * Math.cos(ph); pos.push(x0 + px + px / l * o, y + s.high * Math.sin(ph), pz + pz / l * o); }
  }
  for (let k = 0; k < K; k++) for (let m = 0; m < M; m++) { const a = k * M + m, b = k * M + (m + 1) % M, c = ((k + 1) % K) * M + m, d = ((k + 1) % K) * M + (m + 1) % M; idx.push(a, b, c, b, d, c); }
  return meshOf(pos, idx);
}

/** A flat collar: a thin band from the neck outwards and down, open at the front, widest at its two points. */
export function band(rows: readonly PartRow[], cx: number, pow: number, s: { row: number; like: number; gap: number; back: number; tip: number; tilt: number; thick: number }): Mesh3 {
  const K = 64, M = 10, pos: number[] = [], idx: number[] = [], g = s.gap * Math.PI / 180, tl = s.tilt * Math.PI / 180, r = rowLike(rows, s.like);
  const x0 = (r.c - PAD + 0.5) / U - cx, y = FH - s.row;
  for (let k = 0; k < K; k++) {
    const th = g + (2 * Math.PI - 2 * g) * k / (K - 1), cs = Math.cos(th), sn = Math.sin(th);
    const px = (r.rc / U + 0.05) * Math.sign(cs) * Math.pow(Math.abs(cs), pow), pz = (r.deep + 0.05) * Math.sign(sn) * Math.pow(Math.abs(sn), pow), l = Math.hypot(px, pz) || 1;
    // The width: from the back it grows towards the points, then falls to nothing at the opening.
    const fromGap = Math.max(0, Math.min(th - g, 2 * Math.PI - g - th)), rise = Math.min(1, fromGap / 0.5), far = Math.min(1, fromGap / 1.6);
    const a = 0.5 * Math.max(0.12, Math.sqrt(rise) * (s.tip + (s.back - s.tip) * far * far * (3 - 2 * far)));
    for (let m = 0; m < M; m++) {
      const ph = 2 * Math.PI * m / M, e1 = a + a * Math.cos(ph), e2 = s.thick * Math.sin(ph);
      const out = e1 * Math.cos(tl) + e2 * Math.sin(tl), up = -e1 * Math.sin(tl) + e2 * Math.cos(tl);
      pos.push(x0 + px + px / l * out, y + up, pz + pz / l * out);
    }
  }
  for (let k = 0; k < K - 1; k++) for (let m = 0; m < M; m++) { const p = k * M + m, b = k * M + (m + 1) % M, c = (k + 1) * M + m, d = (k + 1) * M + (m + 1) % M; idx.push(p, b, c, b, d, c); }
  for (let m = 1; m < M - 1; m++) { idx.push(0, m + 1, m); const o = (K - 1) * M; idx.push(o, o + m, o + m + 1); }
  return meshOf(pos, idx);
}

/** A plume: thin where it is fixed, then thicker, then thinning to a point, along a line that waves in the side view. */
function waveMesh(R: number, L: number, sink: number, wave: number): Mesh3 {
  const N = 22, K = 16, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = Math.max(0.02, R * (t < 0.45 ? 0.3 + 0.7 * Math.sin(Math.PI / 2 * t / 0.45) : Math.pow(Math.max(0, Math.cos(Math.PI / 2 * (t - 0.45) / 0.55)), 0.8)));
    const x = wave * L * Math.sin(2 * Math.PI * 0.8 * t) * Math.sqrt(t), y = L * t - sink;
    for (let k = 0; k < K; k++) { const th = 2 * Math.PI * k / K; pos.push(x + r * Math.cos(th), y, r * Math.sin(th)); }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) { const a = i * K + k, b = i * K + (k + 1) % K, c = a + K, d = b + K; idx.push(a, c, b, b, c, d); }
  for (let k = 1; k < K - 1; k++) { const o = N * K; idx.push(o, o + k + 1, o + k); }
  return meshOf(pos, idx);
}

const profile = (pts: number[][]): Vector2[] => pts.map(([x, y]) => new Vector2(x, y));

/** A cone, a drop (a rounded tuft), a ball or a plume along `dir`, its foot (at the origin) sunk into what it stands on. */
export function spike(s: SpikeDesc, dir: Vec3): Mesh3 {
  const R = s.radius, L = s.length, sink = s.sink === undefined ? 0.8 : s.sink;
  let g: BufferGeometry;
  if (s.shape === 'wave') {
    // The plume is already a flat mesh; it is turned and flattened below like the others.
    const m = waveMesh(R, L, sink, s.wave ?? 0);
    g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(m.position, 3));
    g.setIndex(Array.from(m.index));
  } else if (s.shape === 'drop') {
    g = new LatheGeometry(profile([[0.01, 0], [R * 0.75, L * 0.1], [R, L * 0.3], [R * 0.82, L * 0.6], [R * 0.42, L * 0.87], [0.01, L]]), 20);
    g.translate(0, -sink, 0);
  } else if (s.shape === 'ball') {
    g = new SphereGeometry(R, 22, 16);
    g.scale(1, L / (2 * R), 1);
    g.translate(0, L / 2 - sink, 0);
  } else {
    g = new CylinderGeometry(0, R, L, 14, 1);   // the page's cone
    g.translate(0, L / 2 - sink, 0);
  }
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...dir).normalize()));
  if (s.flat) g.scale(s.flatAxis === 'x' ? s.flat : 1, 1, s.flatAxis === 'z' ? s.flat : 1);
  return flatten(g, true);
}

/** A copy of a mesh moved by (dx, dy, dz). */
function moved(m: Mesh3, dx: number, dy: number, dz: number): Mesh3 {
  const position = m.position.slice();
  for (let i = 0; i < position.length; i += 3) { position[i] += dx; position[i + 1] += dy; position[i + 2] += dz; }
  return { ...m, position };
}

/** A copy of a mesh turned by `a` radians about z (positions and normals). */
function turnedZ(m: Mesh3, a: number): Mesh3 {
  const c = Math.cos(a), s = Math.sin(a), position = m.position.slice(), normal = m.normal.slice();
  for (let i = 0; i < position.length; i += 3) {
    const x = position[i], y = position[i + 1], nx = normal[i], ny = normal[i + 1];
    position[i] = c * x - s * y; position[i + 1] = s * x + c * y;
    normal[i] = c * nx - s * ny; normal[i + 1] = s * nx + c * ny;
  }
  return { ...m, position, normal };
}

/** A pointed hat's cone between two heights (0 = its foot, 1 = its tip); the tip leans over. */
export function hatCone(R: number, H: number, lean: number, t0: number, t1: number, grow: number): Mesh3 {
  const N = 16, K = 30, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + (t1 - t0) * i / N, r = Math.max(0.03, R * (1 - t) * (1 - 0.25 * t) + grow), x = lean * t * t, y = H * t;
    for (let k = 0; k < K; k++) { const th = 2 * Math.PI * k / K; pos.push(x + r * Math.cos(th), y, r * Math.sin(th)); }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) { const a = i * K + k, b = i * K + (k + 1) % K, c = a + K, d = b + K; idx.push(a, c, b, b, c, d); }
  for (let k = 1; k < K - 1; k++) { idx.push(0, k, k + 1); const o = N * K; idx.push(o, o + k + 1, o + k); }
  return meshOf(pos, idx);
}

/** The hat's three pieces: brim, cone and the band round the cone's foot, turned about a point at the back of the head. */
export function hatParts(H: HatDesc): { brim: Mesh3; cone: Mesh3; band: Mesh3 } {
  const y = FH - H.row;
  const brim: Mesh3 = flatten(new CylinderGeometry(H.brim * 0.97, H.brim, 0.6, 40).translate(0, y, 0), false);
  const cone = moved(hatCone(H.radius, H.height, H.lean, 0, 1, 0), 0, y + 0.2, 0);
  const bandM = moved(hatCone(H.radius, H.height, H.lean, 0.02, 0.2, 0.28), 0, y + 0.2, 0);
  const tilt = (m: Mesh3): Mesh3 => moved(turnedZ(moved(m, 3.5, -y, 0), H.tilt || 0), -3.5, y, 0);   // turned about a point at the back of the head
  return { brim: tilt(brim), cone: tilt(cone), band: tilt(bandM) };
}

/** A leg that hangs from the hip (the origin), `len` long. */
export function legMesh(L: LegsDesc, len: number): Mesh3 {
  const g = new LatheGeometry(profile([[0.01, 0], [L.foot * 0.75, 0.08], [L.foot, 0.5], [L.radius, len]]), 18);
  g.translate(0, -len, 0);
  return flatten(g, true);
}

/** An arm that hangs from the shoulder (the origin), and its hand at the lower end. */
export function armMesh(A: ArmsDesc): { arm: Mesh3; hand: Mesh3 } {
  // The page's capsule (three 0.160) is a lathe of two quarter arcs with a straight piece between, six steps to the arc
  // (twelve points, since an ellipse arc takes twice the divisions); three 0.187's own CapsuleGeometry has half the rings.
  const len = A.length - 2 * A.radius, path = new Path();
  path.absarc(0, -len / 2, A.radius, Math.PI * 1.5, 0);
  path.absarc(0, len / 2, A.radius, 0, Math.PI * 0.5);
  const arm = new LatheGeometry(path.getPoints(6), 14);
  arm.translate(0, -A.length / 2 + A.radius, 0);
  const hand = new SphereGeometry(A.radius * 1.05, 14, 10);
  hand.translate(0, -A.length + A.radius * 0.8, 0);
  return { arm: flatten(arm, false), hand: flatten(hand, false) };
}

/** The dark outline of a piece: its points pushed out along their normals by `w`, the winding reversed so that one cull mode serves hull and piece. */
export function hull(m: Mesh3, w: number): Mesh3 {
  const position = new Float32Array(m.position.length), index = new Uint32Array(m.index.length);
  for (let i = 0; i < position.length; i++) position[i] = m.position[i] + m.normal[i] * w;
  for (let t = 0; t < index.length; t += 3) { index[t] = m.index[t]; index[t + 1] = m.index[t + 2]; index[t + 2] = m.index[t + 1]; }
  return { position, normal: m.normal, uv: null, index };
}
