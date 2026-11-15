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

/** Plain RGBA bytes of a picture, `w * h` pixels, row 0 on top. */
export interface PaintImage { w: number; h: number; data: Uint8Array }

/**
 * Stone (the page's `stoneTex`, seed 11): one grey with lighter and darker flecks and nine dark cracks, the size of a figure's paint.
 * The page draws it on a canvas; here every pixel is computed by hand from the same random numbers in the same order. The flecks are
 * rectangles with fractional edges (a pixel takes the covered share of its area, as the canvas antialiases them); a crack is the
 * union of round-capped 3 px wide segments (a pixel takes the share the distance to the nearest segment leaves, over one pixel of
 * soft edge). The canvas's own antialiasing differs from that only in the last grey value of an edge pixel. The two corner patches
 * are plain grey: a piece without paint reads the corner of its texture.
 */
export function stonePaint(): PaintImage {
  const w = FW * PS, h = FH * PS, data = new Uint8Array(w * h * 4);
  const base = [0x8f, 0x92, 0x8c], light = [0x9b, 0x9e, 0x98], dark = [0x84, 0x87, 0x7f], crack = [0x4a, 0x4c, 0x48];
  for (let i = 0; i < w * h; i++) data.set([...base, 255], i * 4);
  const blend = (i: number, c: number[], a: number): void => { for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(data[i * 4 + k] * (1 - a) + c[k] * a); };
  let seed = 11;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rect = (x: number, y: number, rw: number, rh: number, c: number[]): void => {
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(h, Math.ceil(y + rh)); py++) {
      const oy = Math.min(py + 1, y + rh) - Math.max(py, y);
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(w, Math.ceil(x + rw)); px++) blend(py * w + px, c, oy * (Math.min(px + 1, x + rw) - Math.max(px, x)));
    }
  };
  for (let i = 0; i < 70; i++) {
    const c = rnd() < 0.5 ? light : dark;
    const x = 4 + rnd() * (w - 10), y = 4 + rnd() * (h - 10), rw = 2 + rnd() * 5, rh = 2 + rnd() * 3;
    rect(x, y, rw, rh, c);
  }
  // The cracks: each path is a list of sub-paths (a branch starts a new one); the line is 3 px wide with round caps and joins.
  const cov = new Float32Array(w * h);
  for (let i = 0; i < 9; i++) {
    let x = 6 + rnd() * (w - 12), y = 8 + (i / 9) * (h - 30) + rnd() * 10, a = rnd() * 6.28;
    const subs: [number, number][][] = [[[x, y]]];
    for (let k = 0; k < 4 + Math.floor(rnd() * 3); k++) {
      a += (rnd() - 0.5) * 1.6; x += Math.cos(a) * (5 + rnd() * 6); y += Math.abs(Math.sin(a)) * (5 + rnd() * 7);
      subs[subs.length - 1].push([x, y]);
      if (k === 1 && rnd() < 0.6) {
        subs[subs.length - 1].push([x + 5 + rnd() * 4, y - 3 - rnd() * 3]);
        subs.push([[x, y]]);
      }
    }
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (const s of subs) for (let j = 0; j < s.length; j++) {
      const [ax, ay] = s[j], [bx, by] = s[Math.min(j + 1, s.length - 1)];
      const px0 = Math.max(0, Math.floor(Math.min(ax, bx) - 2.5)), px1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + 2.5));
      const py0 = Math.max(0, Math.floor(Math.min(ay, by) - 2.5)), py1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + 2.5));
      x0 = Math.min(x0, px0); x1 = Math.max(x1, px1); y0 = Math.min(y0, py0); y1 = Math.max(y1, py1);
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) {
        const qx = px + 0.5 - ax, qy = py + 0.5 - ay, t = len2 > 0 ? Math.max(0, Math.min(1, (qx * dx + qy * dy) / len2)) : 0;
        const d = Math.hypot(qx - t * dx, qy - t * dy), c = Math.max(0, Math.min(1, 2 - d));   // half width 1.5, one pixel of soft edge
        if (c > cov[py * w + px]) cov[py * w + px] = c;
      }
    }
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const j = py * w + px;
      if (cov[j] > 0) { blend(j, crack, cov[j]); cov[j] = 0; }
    }
  }
  for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) { data.set([...base, 255], (py * w + px) * 4); data.set([...base, 255], ((h - 1 - py) * w + px) * 4); }
  return { w, h, data };
}

/**
 * What polished metal mirrors (the page's `envTex`): a 128 x 64 equirectangular picture of a bright sky, a horizon and dark ground, with a white
 * ellipse of sun at (40, 12), 14 by 7. The gradient has the page's stops, read at the centre of each row; the ellipse has an edge one texel soft.
 */
export function skyPaint(): PaintImage {
  const w = 128, h = 64, data = new Uint8Array(w * h * 4);
  const stops: [number, number[]][] = [[0, [0xff, 0xff, 0xff]], [0.3, [0xe3, 0xee, 0xf7]], [0.5, [0xb4, 0xc6, 0xd4]], [0.58, [0x7d, 0x8c, 0x78]], [1, [0x5d, 0x6b, 0x58]]];
  const gradient = (t: number): number[] => {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (t - t0) / (t1 - t0); return c0.map((v, k) => v + (c1[k] - v) * f); }
    }
    return stops[stops.length - 1][1];
  };
  const cx = 40, cy = 12, rx = 14, ry = 7;
  for (let y = 0; y < h; y++) {
    const g = gradient((y + 0.5) / h);
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      // The signed distance to the ellipse, to first order: f / |grad f| with f = (dx/rx)^2 + (dy/ry)^2 - 1.
      const f = (dx / rx) ** 2 + (dy / ry) ** 2 - 1, grad = 2 * Math.hypot(dx / (rx * rx), dy / (ry * ry));
      const a = grad > 0 ? Math.max(0, Math.min(1, 0.5 - f / grad)) : 1;
      for (let k = 0; k < 3; k++) data[(y * w + x) * 4 + k] = Math.round(g[k] + (255 - g[k]) * a);
      data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { w, h, data };
}
