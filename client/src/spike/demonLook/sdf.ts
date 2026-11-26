// SPIKE (#379, the demon's smooth look): a body as a blend of rounded shapes (a distance field), turned into one skin with
// surface nets. Each shape names its bone, so the skin gets its weights from the shapes it grew out of.
export type V = [number, number, number];

/** tag: glow (lava cracks), horn (keratin, not rock skin), tip (ember at a point), dark (fades to black). */
export type Tag = [number, number, number, number];

export interface Prim {
  /** Round cone from `a` (radius `ra`) to `b` (radius `rb`), or an ellipsoid at `a` with radii `r`. */
  a: V; b?: V; ra: number; rb: number; r?: V;
  /** How softly it melts into what is already there. */
  k: number; bone: number; tag: Tag; sub?: boolean;
  c: V; br: number;
}

export function cone(a: V, b: V, ra: number, rb: number, bone: number, tag: Tag, k = 0.06): Prim {
  const c: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return { a, b, ra, rb, k, bone, tag, c, br: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2 + Math.max(ra, rb) };
}
export function ball(a: V, r: V, bone: number, tag: Tag, k = 0.06): Prim {
  return { a, r, ra: 0, rb: 0, k, bone, tag, c: a, br: Math.max(r[0], r[1], r[2]) };
}

function dist(p: Prim, x: number, y: number, z: number): number {
  const ax = x - p.a[0], ay = y - p.a[1], az = z - p.a[2];
  if (p.r) {
    const r = p.r;
    const k0 = Math.hypot(ax / r[0], ay / r[1], az / r[2]);
    const k1 = Math.hypot(ax / (r[0] * r[0]), ay / (r[1] * r[1]), az / (r[2] * r[2]));
    return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
  }
  const b = p.b!;
  const bx = b[0] - p.a[0], by = b[1] - p.a[1], bz = b[2] - p.a[2];
  const l2 = bx * bx + by * by + bz * bz, rr = p.ra - p.rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  const y1 = ax * bx + ay * by + az * bz, z1 = y1 - l2;
  const qx = ax * l2 - bx * y1, qy = ay * l2 - by * y1, qz = az * l2 - bz * y1;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y1 * y1 * l2, z2 = z1 * z1 * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z1) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - p.rb;
  if (Math.sign(y1) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - p.ra;
  return (Math.sqrt(x2 * a2 * il2) + y1 * rr) * il2 - p.ra;
}

function field(prims: Prim[], x: number, y: number, z: number): number {
  let d = 1e3;
  for (const p of prims) {
    if (p.sub) continue;
    const di = dist(p, x, y, z), h = Math.max(p.k - Math.abs(d - di), 0) / p.k;
    d = Math.min(d, di) - h * h * p.k * 0.25;
  }
  for (const p of prims) {
    if (!p.sub) continue;
    const di = -dist(p, x, y, z), h = Math.max(p.k - Math.abs(d - di), 0) / p.k;
    d = Math.max(d, di) + h * h * p.k * 0.25;
  }
  return d;
}

export interface Skin {
  position: Float32Array; index: Uint32Array; info: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array;
}

/** `lo`, `hi`: the box; `h`: the cell. `reach`: how far a shape's bone still pulls on the skin beside it. */
export function skin(prims: Prim[], lo: V, hi: V, h: number, reach = 0.09): Skin {
  const B = 8, SLACK = 0.14;
  const nx = Math.ceil((hi[0] - lo[0]) / h / B) * B + 1, ny = Math.ceil((hi[1] - lo[1]) / h / B) * B + 1, nz = Math.ceil((hi[2] - lo[2]) / h / B) * B + 1;
  const vals = new Float32Array(nx * ny * nz).fill(1e3);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const R = (h * B * Math.sqrt(3)) / 2;
  const active: number[] = [], lists: Prim[][] = [];
  for (let bk = 0; bk < (nz - 1) / B; bk++) for (let bj = 0; bj < (ny - 1) / B; bj++) for (let bi = 0; bi < (nx - 1) / B; bi++) {
    const cx = lo[0] + (bi + 0.5) * B * h, cy = lo[1] + (bj + 0.5) * B * h, cz = lo[2] + (bk + 0.5) * B * h;
    const near = prims.filter((p) => Math.hypot(cx - p.c[0], cy - p.c[1], cz - p.c[2]) - p.br < R + SLACK);
    if (!near.length) continue;
    const dc = field(near, cx, cy, cz);
    if (Math.abs(dc) > R + SLACK) {
      if (dc < 0) for (let k = 0; k <= B; k++) for (let j = 0; j <= B; j++) for (let i = 0; i <= B; i++) vals[at(bi * B + i, bj * B + j, bk * B + k)] = -1e3;
      continue;
    }
    active.push(bi, bj, bk); lists.push(near);
  }
  for (let n = 0; n < lists.length; n++) {
    const bi = active[n * 3], bj = active[n * 3 + 1], bk = active[n * 3 + 2], near = lists[n];
    for (let k = 0; k <= B; k++) for (let j = 0; j <= B; j++) for (let i = 0; i <= B; i++) {
      const I = bi * B + i, J = bj * B + j, K = bk * B + k;
      vals[at(I, J, K)] = field(near, lo[0] + I * h, lo[1] + J * h, lo[2] + K * h);
    }
  }

  // Surface nets: one point per cell the surface crosses, at the mean of its edge crossings.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cat = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let n = 0; n < lists.length; n++) {
    const bi = active[n * 3], bj = active[n * 3 + 1], bk = active[n * 3 + 2];
    for (let k = bk * B; k < bk * B + B; k++) for (let j = bj * B; j < bj * B + B; j++) for (let i = bi * B; i < bi * B + B; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { corner[c] = vals[at(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; if (corner[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const [e0, e1] of EDGES) {
        const v0 = corner[e0], v1 = corner[e1];
        if ((v0 < 0) === (v1 < 0)) continue;
        const t = v0 / (v0 - v1);
        sx += (e0 & 1) + t * ((e1 & 1) - (e0 & 1));
        sy += ((e0 >> 1) & 1) + t * (((e1 >> 1) & 1) - ((e0 >> 1) & 1));
        sz += (e0 >> 2) + t * ((e1 >> 2) - (e0 >> 2));
        cnt++;
      }
      cellVert[cat(i, j, k)] = pos.length / 3;
      pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
    }
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let n = 0; n < lists.length; n++) {
    const bi = active[n * 3], bj = active[n * 3 + 1], bk = active[n * 3 + 2];
    for (let k = Math.max(1, bk * B); k < bk * B + B; k++) for (let j = Math.max(1, bj * B); j < bj * B + B; j++) for (let i = Math.max(1, bi * B); i < bi * B + B; i++) {
      const v0 = vals[at(i, j, k)] < 0;
      if (v0 !== vals[at(i + 1, j, k)] < 0) quad(cellVert[cat(i, j, k)], cellVert[cat(i, j - 1, k)], cellVert[cat(i, j - 1, k - 1)], cellVert[cat(i, j, k - 1)], !v0);
      if (v0 !== vals[at(i, j + 1, k)] < 0) quad(cellVert[cat(i, j, k)], cellVert[cat(i, j, k - 1)], cellVert[cat(i - 1, j, k - 1)], cellVert[cat(i - 1, j, k)], !v0);
      if (v0 !== vals[at(i, j, k + 1)] < 0) quad(cellVert[cat(i, j, k)], cellVert[cat(i - 1, j, k)], cellVert[cat(i - 1, j - 1, k)], cellVert[cat(i, j - 1, k)], !v0);
    }
  }

  // What each point of the skin is made of: the shapes near it give its bones and its tag.
  const nv = pos.length / 3;
  const info = new Float32Array(nv * 4), skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4);
  const solid = prims.filter((p) => !p.sub);
  const ds = new Float32Array(solid.length);
  const byBone = new Map<number, number>();
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let dmin = 1e3;
    for (let n = 0; n < solid.length; n++) {
      const p = solid[n];
      ds[n] = Math.hypot(x - p.c[0], y - p.c[1], z - p.c[2]) - p.br > reach + 0.1 ? 1e3 : dist(p, x, y, z);
      if (ds[n] < dmin) dmin = ds[n];
    }
    byBone.clear();
    let tw = 0;
    const tg = [0, 0, 0, 0];
    for (let n = 0; n < solid.length; n++) {
      const w = Math.max(0, 1 - (ds[n] - dmin) / reach) ** 2;
      if (w > 0) byBone.set(solid[n].bone, (byBone.get(solid[n].bone) ?? 0) + w);
      const t = Math.max(0, 1 - (ds[n] - dmin) / 0.025) ** 2;
      if (t > 0) { tw += t; for (let c = 0; c < 4; c++) tg[c] += t * solid[n].tag[c]; }
    }
    const top = [...byBone].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0);
    for (let c = 0; c < 4; c++) {
      skinIndex[v * 4 + c] = top[c]?.[0] ?? 0;
      skinWeight[v * 4 + c] = (top[c]?.[1] ?? 0) / sum;
      info[v * 4 + c] = tg[c] / tw;
    }
  }
  return { position: new Float32Array(pos), index: new Uint32Array(idx), info, skinIndex, skinWeight };
}
