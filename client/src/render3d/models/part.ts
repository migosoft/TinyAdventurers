// The base parts of a 3D figure model (#338): the head and the body, each a stack of rings turned from the side view
// of the description. Positions are in sprite pixels, the front along +x, the feet at y 0. Plain typed arrays (no
// three.js), so it runs in a Web Worker and under node.

import type { FigureDesc } from './desc';
import { FH, FW, GH, GW, PAD, U, field, inflate } from './grid';
import { paintOf, type Paint } from './paint';

export interface Mesh3 {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array | null;
  index: Uint32Array;
}

/** One ring of a part: sprite grid row `Y`, columns `a` to `b`, its middle `c`, half width `rc` and half depth `deep` (grid cells). */
export interface PartRow {
  Y: number;
  a: number;
  b: number;
  c: number;
  rc: number;
  deep: number;
}

/** Smooth vertex normals, each triangle's (area-weighted) normal added to its three corners, like three's `computeVertexNormals`. */
export function vertexNormals(position: Float32Array, index: ArrayLike<number>): Float32Array {
  const nor = new Float32Array(position.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const cbx = position[c] - position[b], cby = position[c + 1] - position[b + 1], cbz = position[c + 2] - position[b + 2];
    const abx = position[a] - position[b], aby = position[a + 1] - position[b + 1], abz = position[a + 2] - position[b + 2];
    const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
    for (const v of [a, b, c]) { nor[v] += nx; nor[v + 1] += ny; nor[v + 2] += nz; }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
  return nor;
}

const yOf = (Y: number): number => FH - (Y - PAD + 0.5) / U;

interface Sheet {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  rows: PartRow[];
}

function sheet(inside: Uint8Array, cx: number, raise: (u: number, v: number) => number, pow: number, taper: { from: number; to: number } | undefined, paintFrom: number | undefined, open: boolean | undefined): Sheet {
  const yMax = paintFrom === undefined ? FH : FH - paintFrom - 0.4;   // a part that reaches up into another takes its colours from its own rows
  const xOf = (X: number): number => (X - PAD + 0.5) / U - cx;
  // Rings around the part, one per row, so the front and the back are as finely modelled as the sides.
  const { hgt } = inflate(inside), SEG = 56, rows: PartRow[] = [], pos: number[] = [], us: number[] = [], idx: number[] = [];
  for (let Y = 1; Y < GH - 1; Y++) {
    let best: [number, number] | null = null, s = -1;
    for (let X = 1; X < GW; X++) {
      const on = X < GW - 1 && inside[Y * GW + X];
      if (on && s < 0) s = X;
      if (!on && s >= 0) { if (!best || X - s > best[1] - best[0]) best = [s, X]; s = -1; }
    }
    if (best) rows.push({ Y, a: best[0], b: best[1], c: 0, rc: 0, deep: 0 });
  }
  rows.forEach((r, ri) => {
    const c = (r.a + r.b) / 2 - 0.5;
    let rc = (r.b - r.a) / 2;
    let deep = 0;
    for (let i = r.a; i < r.b; i++) deep = Math.max(deep, hgt[r.Y * GW + i]);
    deep = open && ri > rows.length / 2 ? rc / U : Math.min(deep, rc / U);   // an open part (a robe) keeps its full depth down to its flat end
    if (taper) {
      const y0 = PAD + taper.from * U, e = Math.max(0, Math.min(1, (r.Y - y0) / (rows[rows.length - 1].Y - y0))), f = 1 - (1 - taper.to) * e * e * (3 - 2 * e);
      rc *= f; deep *= f;
    }
    r.c = c; r.rc = rc; r.deep = deep;
    for (let j = 0; j < SEG; j++) {
      // pow 1 is a circle; below 1 the ring turns towards a square with round corners. The row's depth is its width,
      // less where the inflation caps it (the rounded top and bottom of a part).
      const th = Math.PI * 2 * j / SEG, cs = Math.cos(th), sn = Math.sin(th);
      const X = c + rc * Math.sign(cs) * Math.pow(Math.abs(cs), pow);
      pos.push(xOf(X), yOf(r.Y), Math.abs(sn) < 1e-6 ? 0 : deep * Math.sign(sn) * Math.pow(Math.abs(sn), pow));
      us.push(1 - (th <= Math.PI ? th : 2 * Math.PI - th) / Math.PI);
    }
  });
  for (let ri = 0; ri < rows.length - 1; ri++) for (let j = 0; j < SEG; j++) {
    const a = ri * SEG + j, b = ri * SEG + (j + 1) % SEG, c = a + SEG, d = b + SEG;
    idx.push(a, b, c, b, d, c);
  }
  const top = pos.length / 3, r0 = rows[0], r1 = rows[rows.length - 1];
  pos.push(xOf((r0.a + r0.b) / 2 - 0.5), yOf(r0.Y), 0); us.push(0.5);
  pos.push(xOf((r1.a + r1.b) / 2 - 0.5), yOf(r1.Y), 0); us.push(0.5);
  for (let j = 0; j < SEG; j++) { idx.push(top, (j + 1) % SEG, j); const o = (rows.length - 1) * SEG; idx.push(top + 1, o + j, o + (j + 1) % SEG); }
  const p = new Float32Array(pos), index = new Uint32Array(idx);
  let nr = vertexNormals(p, index);
  // The colour is read a little below a surface that faces up, so a top takes the part's pixels and not the row above it.
  const uv = new Float32Array(us.length * 2);
  for (let i = 0; i < us.length; i++) { uv[i * 2] = Math.min(0.999, Math.max(0.001, us[i])); uv[i * 2 + 1] = Math.min(0.999, Math.max(0.001, Math.min(yMax, p[i * 3 + 1] - 0.7 * nr[i * 3 + 1]) / FH)); }
  // Raised materials (hair) stand out along the surface's normal.
  for (let i = 0; i < us.length; i++) {
    const h = raise(uv[i * 2], uv[i * 2 + 1]);
    if (h) { p[i * 3] += nr[i * 3] * h; p[i * 3 + 1] += nr[i * 3 + 1] * h; p[i * 3 + 2] += nr[i * 3 + 2] * h; }
  }
  nr = vertexNormals(p, index);
  return { position: p, normal: nr, uv, index, rows };
}

/**
 * The head (`i` 0) or the body (`i` 1) of a description, with its rings, its paint and, for a part that lies (a
 * quadruped's body), the turn that was applied to it (`lie`: where it was moved to after it was laid down).
 */
export function buildPart(desc: FigureDesc, i: 0 | 1): { mesh: Mesh3; rows: PartRow[]; paint: Paint; lie: [number, number] | null } {
  const d = desc, cx = d.centre;
  const grid = new Int32Array(FW * FH).fill(-1), alpha = new Uint8Array(FW * FH);
  d.side.forEach((line, k) => {
    for (let x = 0; x < FW; x++) {
      const c = line[x];
      if (c !== '.') { grid[(d.firstRow + k) * FW + x] = d.colours[c]; alpha[(d.firstRow + k) * FW + x] = 1; }
    }
  });
  const bpow = 1, pow = d.parts[0].pow || 1;   // the head may be squarer than the body
  const p = d.parts[i];
  // A part may bring its own side view (`side`, `firstRow`): it then has its own paint and may share rows with the other part.
  let al = alpha, pt: Paint | null = null, lie: [number, number] | null = null, rows = p.rows;
  if (p.side) {
    const g2 = new Int32Array(FW * FH).fill(-1);
    al = new Uint8Array(FW * FH);
    if (p.lie) {
      // A lying part is built standing on its rear end (its front end up, its belly as the front) and then laid down.
      const H = p.side.length;
      let a0 = FW, a1 = -1;
      for (const line of p.side) for (let x = 0; x < FW; x++) if (line[x] !== '.') { a0 = Math.min(a0, x); a1 = Math.max(a1, x); }
      const c0 = Math.floor(cx - H / 2), R0 = FH - (a1 - a0 + 1);
      p.side.forEach((line, k) => {
        for (let x = a0; x <= a1; x++) {
          const c = line[x];
          if (c !== '.') { const j = (R0 + a1 - x) * FW + c0 + k; g2[j] = d.colours[c]; al[j] = 1; }
        }
      });
      lie = [a0 - cx, FH - (p.firstRow ?? 0) - H / 2 + (c0 + H / 2 - cx)];
      rows = [R0, FH - 1];
    } else {
      p.side.forEach((line, k) => {
        for (let x = 0; x < FW; x++) {
          const c = line[x];
          if (c !== '.') { g2[((p.firstRow ?? 0) + k) * FW + x] = d.colours[c]; al[((p.firstRow ?? 0) + k) * FW + x] = 1; }
        }
      });
    }
    pt = paintOf(i ? { ...d, eyes: undefined, visor: undefined } : d, g2, al, i ? bpow : pow);
  }
  if (!pt) pt = paintOf(d, grid, alpha, pow);
  if (!rows) throw new Error(`${d.name}: part ${i} has no rows`);
  const f = field(al, rows[0], rows[1]), inside = new Uint8Array(GW * GH);
  for (let k = 0; k < f.length; k++) if (f[k] > 0.5) inside[k] = 1;
  const s = sheet(inside, cx, pt.raise, i ? bpow : pow, p.taper, p.paintFrom, p.open);
  let { position, normal } = s;
  if (lie) {
    // rotateZ(-90 degrees) for positions and normals (x, y) -> (y, -x), then the move.
    position = position.slice(); normal = normal.slice();
    for (let k = 0; k < position.length; k += 3) {
      const x = position[k], y = position[k + 1];
      position[k] = y + lie[0]; position[k + 1] = -x + lie[1];
      const nx = normal[k], ny = normal[k + 1];
      normal[k] = ny; normal[k + 1] = -nx;
    }
  }
  return { mesh: { position, normal, uv: s.uv, index: s.index }, rows: s.rows, paint: pt, lie };
}
