// The paint of a figure's head or body (#338): the flat colours of its side view stretched round the part, with the
// eyes and the visor set on the front. Plain bytes (no canvas), so it runs in a Web Worker and under node.

import type { FigureDesc } from './desc';
import { blur, FH, FW, PS } from './grid';

export interface Paint {
  w: number;
  h: number;
  /** RGBA bytes, `w * h` pixels, row 0 on top. */
  data: Uint8Array;
  /** How far a "raised" material (hair) stands out at a texture coordinate. */
  raise(u: number, v: number): number;
}

const setKey = (a: Uint8ClampedArray, i: number, k: number): void => {
  a[i * 4] = k >> 16; a[i * 4 + 1] = (k >> 8) & 255; a[i * 4 + 2] = k & 255; a[i * 4 + 3] = 255;
};

/**
 * The paint and the raised height, PS times enlarged. Every row of the side view is stretched to the full width
 * (0 = back, 1 = front); colour borders are rounded; the eyes are set on the front.
 */
export function paintOf(d: FigureDesc, grid: Int32Array, alpha: Uint8Array, pow: number): Paint {
  const w = FW * PS, h = FH * PS, big = new Int32Array(w * h).fill(-1), up = new Float32Array(w * h);
  const rows: ({ from: number; span: number } | null)[] = [];
  for (let y = 0; y < FH; y++) {
    let best: [number, number] | null = null, s = -1;
    for (let x = 0; x <= FW; x++) {
      const on = x < FW && alpha[y * FW + x];
      if (on && s < 0) s = x;
      if (!on && s >= 0) { if (!best || x - s > best[1]) best = [s, x - s]; s = -1; }
    }
    rows.push(best ? { from: best[0] + 0.25, span: best[1] - 0.5 } : null);
  }
  for (let y = 0; y < FH; y++) {
    let src = y;
    for (let k = 0; k < FH && !rows[src]; k++) { if (rows[y + k]) src = y + k; else if (rows[y - k]) src = y - k; }
    const r = rows[src];
    if (!r) continue;
    for (let Y = y * PS; Y < (y + 1) * PS; Y++) for (let X = 0; X < w; X++) big[Y * w + X] = grid[src * FW + Math.min(FW - 1, Math.floor(r.from + r.span * (X + 0.5) / w))];
  }
  const out = new Uint8ClampedArray(w * h * 4), best = new Float32Array(w * h), lab = new Int32Array(w * h);
  for (const k of new Set(big)) {
    const m = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) if (big[i] === k) m[i] = 1;
    blur(m, w, h, 2);
    for (let i = 0; i < w * h; i++) if (m[i] > best[i]) { best[i] = m[i]; lab[i] = k; }
  }
  const raisedBy = new Map(Object.entries(d.raised ?? {}).map(([c, v]) => [d.colours[c], v]));
  for (let i = 0; i < w * h; i++) { setKey(out, i, lab[i]); up[i] = raisedBy.get(lab[i]) || 0; }
  blur(up, w, h, 1);
  const e = d.eyes, r = e && rows[Math.floor(e.rows[0])];   // an eye's rows may be fractions of a sprite row
  if (e && r) {
    // The eye's place is given as seen from the front: its distance from the middle of the face. On the squarer shape
    // the same distance lies at a smaller angle, so the angle is worked out from the distance.
    const side = Math.sin(e.at * Math.PI / 180), hw = e.width * 0.8 / r.span;
    const tOf = (l: number): number => 1 - Math.asin(Math.pow(Math.max(0, Math.min(1, l)), 1 / pow)) / Math.PI;
    const y0 = Math.round(e.rows[0] * PS), y1 = Math.round((e.rows[1] + 1) * PS), x0 = tOf(side + hw) * w, x1 = tOf(side - hw) * w, rad = Math.min(PS * 0.55, (x1 - x0) / 2);
    for (let Y = y0; Y < y1; Y++) for (let X = Math.floor(x0); X < Math.ceil(x1); X++) {
      const dx = Math.max(x0 + rad - X - 0.5, X + 0.5 - (x1 - rad), 0), dy = Math.max(y0 + rad - Y - 0.5, Y + 0.5 - (y1 - rad), 0);
      if (dx * dx + dy * dy <= rad * rad && X >= 0 && X < w) setKey(out, Y * w + X, e.colour);
    }
  }
  // A visor painted on the front: a dark frame reaching `half` degrees to each side, with evenly spaced slits inside.
  // It is drawn here and not in the side view, because a sprite column is too coarse for it (one column is 19 degrees).
  const V = d.visor;
  if (V) {
    const col = w / 9.5, y0 = V.rows[0] * PS, y1 = (V.rows[1] + 1) * PS, x0 = Math.round(w * (1 - V.half / 180));
    const ty = Math.max(2, Math.round(V.line * PS)), tx = Math.max(2, Math.round(V.line * col)), hw = V.slitWide * col / 2, each = V.half / (V.slits + 1) * 2;
    for (let Y = y0; Y < y1; Y++) for (let X = x0; X < w; X++) {
      if (Y < y0 + ty || Y >= y1 - ty || X < x0 + tx) { setKey(out, Y * w + X, V.frame); continue; }
      if (Y < y0 + ty + 2 || Y >= y1 - ty - 2) continue;
      // Every slit is the same whole number of paint pixels wide; the middle one is half here and half in the mirror.
      const n = Math.max(1, Math.round(hw));
      for (let k = 0; k * each < V.half - each / 2; k++) { const a = k ? Math.round(w * (1 - k * each / 180)) - n : w - n; if (X >= a && X < a + 2 * n) setKey(out, Y * w + X, V.slit); }
    }
  }
  const raise = (u: number, v: number): number => up[Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h))) * w + Math.min(w - 1, Math.floor(u * w))];
  return { w, h, data: new Uint8Array(out.buffer), raise };
}
