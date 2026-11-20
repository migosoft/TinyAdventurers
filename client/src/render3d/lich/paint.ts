// The lich's painted picture (#358): one 512 x 512 RGBA image the built figure's uvs read (skull with runes, staff, robe, tome).
// Plain bytes, no canvas and no three.js, the same bytes on every call. A port of the approved spike's atlas.
//
// Row convention (the spike's, kept): row 0 is v = 0, the BOTTOM of the texture in three's uv space (a DataTexture is not flipped).
// So a uv (u, v) reads pixel x = u * 512, row y = v * 512, and the regions below count y from v = 0 upwards. This differs from
// `PaintImage`'s usual "row 0 on top".
//
// Alpha classes the material distinguishes: plain (100, and anything up to it), staff glow (up to 170, the staff's runes), rune glow
// (above 170, up to 255: the skull's, the robe clasp's and the tome's runes). Alpha 0 is cut away (the robe's ragged hem and slits).
// Antialiased edges carry the blend between two of these values. Everything outside the six regions is the spike's white at alpha 100.

import type { PaintImage } from '../models/paint';

export const LICH_PAINT = { w: 512, h: 512, plain: 100, staffGlow: 170, runeGlow: 255 } as const;

type Rect = { x: number; y: number; w: number; h: number };
/** The pixel rectangles of the picture (y counts from the bottom, see above). */
export const REGION = {
  white: { x: 0, y: 0, w: 16, h: 16 },
  skull: { x: 16, y: 0, w: 256, h: 128 },
  staff: { x: 16, y: 128, w: 256, h: 96 },
  robe: { x: 272, y: 0, w: 128, h: 256 },
  pages: { x: 400, y: 0, w: 112, h: 96 },
  cover: { x: 400, y: 96, w: 112, h: 64 },
} as const satisfies Record<string, Rect>;

const mixn = (a: number, b: number, t: number): number => a + (b - a) * t;
const S = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i: number): number => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const hash2 = (x: number, y: number): number => hash(x * 37.3 + y * 91.7);
const vnoise = (x: number, y: number): number => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return mixn(mixn(hash2(xi, yi), hash2(xi + 1, yi), sx), mixn(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), sx), sy);
};
const DEG = Math.PI / 180;
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const RUNE = [175, 95, 255];
const AW = LICH_PAINT.w, AH = LICH_PAINT.h, PLAIN = LICH_PAINT.plain, STAFF_GLOW = LICH_PAINT.staffGlow;
const SOCKET = { lon: 30, lat: -5, rho: 19.5 }, NOSE_LAT = -25;
const STAFF_LEN = 19.7, STAFF_R = 0.26;

class Atlas {
  d = new Uint8Array(AW * AH * 4);
  constructor() { for (let i = 0; i < AW * AH; i++) { this.d[i * 4] = 255; this.d[i * 4 + 1] = 255; this.d[i * 4 + 2] = 255; this.d[i * 4 + 3] = PLAIN; } }
  put(x: number, y: number, c: number[], a: number | null = null, cov = 1): void {
    if (x < 0 || y < 0 || x >= AW || y >= AH || cov <= 0) return;
    const i = (y * AW + x) * 4, k = Math.min(1, cov);
    for (let q = 0; q < 3; q++) this.d[i + q] = this.d[i + q] + (c[q] - this.d[i + q]) * k;
    if (a !== null) this.d[i + 3] = this.d[i + 3] + (a - this.d[i + 3]) * k;
  }
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: number[], a: number | null = null): void {
    const r = w / 2 + 1, dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1e-6;
    for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++) for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
      const t = Math.min(1, Math.max(0, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / l2));
      const d = Math.hypot(x + 0.5 - x0 - dx * t, y + 0.5 - y0 - dy * t);
      this.put(x, y, c, a, w / 2 + 0.5 - d);
    }
  }
  ring(cx: number, cy: number, rx: number, ry: number, w: number, c: number[], a: number | null = null, from = 0, to = 360): void {
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a0 = (from + ((to - from) * i) / n) * DEG, a1 = (from + ((to - from) * (i + 1)) / n) * DEG;
      this.line(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, w, c, a);
    }
  }
}

/** A rune: a stem and two or three strokes between the points of a 3 x 5 lattice. */
function glyph(r: () => number, w: number, h: number, draw: (x0: number, y0: number, x1: number, y1: number) => void): void {
  const xs = [-w / 2, 0, w / 2], ys = [-h / 2, -h / 4, 0, h / 4, h / 2], sx = xs[Math.floor(r() * 3)];
  draw(sx, -h / 2, sx, h / 2);
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(r() * 5);
    let b = a + (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2));
    b = Math.min(4, Math.max(0, b));
    const xa = xs[Math.floor(r() * 3)], xb = xs[Math.floor(r() * 3)];
    if (a !== b || xa !== xb) draw(xa, ys[a], xb, ys[b]);
  }
}
const angDist = (lon: number, lat: number, lon0: number, lat0: number): number => {
  const c = Math.sin(lat * DEG) * Math.sin(lat0 * DEG) + Math.cos(lat * DEG) * Math.cos(lat0 * DEG) * Math.cos((lon - lon0) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
};

function paintSkull(A: Atlas): void {
  for (let py = 0; py < 128; py++) for (let px = 0; px < 256; px++) {
    const lon = ((px + 0.5) / 256) * 360 - 180, lat = ((py + 0.5) / 128) * 180 - 90, al = Math.abs(lon);
    const mott = 0.8 + 0.2 * vnoise(px * 0.11, py * 0.11) - 0.1 * vnoise(px * 0.4 + 9, py * 0.4);
    let c = [196 * mott, 197 * mott, 176 * mott];
    const dark = (k: number, to = [6, 4, 9]): void => { c = c.map((v, i) => v + (to[i] - v) * Math.min(1, Math.max(0, k))); };
    // the lower face is greyer, the cheeks hollow
    dark(0.28 * S(-10, -60, lat));
    dark(0.3 * Math.exp(-((al - 60) ** 2 + (lat + 40) ** 2) / 120), [70, 66, 60]);
    // teeth: a row above and a row below one dark line
    if (lat < -38 && lat > -54 && al < 42) {
      const f = lon / 7.5 + 0.5, gap = Math.abs(f - Math.floor(f) - 0.5) > 0.39;
      c = gap ? [44, 38, 34] : [218, 212, 184].map((v) => v * (0.82 + 0.18 * Math.cos((f - Math.floor(f) - 0.5) * 3)));
      if (lat > -39.2) c = [34, 28, 30];
    }
    // the nose: a dark hollow, wider at the bottom
    const nd = Math.hypot(lon / (lat < NOSE_LAT ? 6.5 : 6.5 - 0.5 * (lat - NOSE_LAT)), (lat - NOSE_LAT) / 6.5);
    dark(1 - S(0.7, 1.05, nd));
    // the eye sockets: black from their depth, a shaded rim
    const sd = angDist(al, lat, SOCKET.lon, SOCKET.lat);
    dark(0.14 * (1 - S(SOCKET.rho, SOCKET.rho * 1.3, sd)), [60, 54, 60]);
    dark(1 - S(SOCKET.rho * 0.84, SOCKET.rho * 1.0, sd));
    if (lat < -54) dark(S(-54, -58, lat), [22, 18, 20]);
    if (al > 62 && lat < -22) dark(0.6 * S(62, 80, al) * S(-22, -36, lat), [40, 36, 36]);
    A.put(16 + px, py, c);
  }
  const SX = (lon: number): number => 16 + ((lon + 180) / 360) * 256, SY = (lat: number): number => ((lat + 90) / 180) * 128;
  const r = rng(7);
  // a few fine cracks
  for (let i = 0; i < 7; i++) {
    let lon = -150 + r() * 300, lat = 5 + r() * 70;
    for (let k = 0; k < 5; k++) { const l2 = lon + (r() - 0.5) * 16, t2 = lat + (r() - 0.3) * 9; A.line(SX(lon), SY(lat), SX(l2), SY(t2), 0.7, [96, 92, 84]); lon = l2; lat = t2; }
  }
  // the runes: cut dark, then filled with the glow
  const rune = (lon0: number, lat0: number, lon1: number, lat1: number, w = 1.7): void => {
    A.line(SX(lon0), SY(lat0), SX(lon1), SY(lat1), w + 1.6, [70, 60, 78]);
    A.line(SX(lon0), SY(lat0), SX(lon1), SY(lat1), w, RUNE, 255);
  };
  const at = (lonC: number, lat: number, dx: number): number => lonC + dx / Math.max(0.3, Math.cos(lat * DEG));
  // a band round the brow: two lines with glyphs between them
  for (let lon = -118; lon < 118; lon += 6) { rune(lon, 27, lon + 6, 27, 1.5); rune(lon, 43, lon + 6, 43, 1.5); }
  for (let lon = -108; lon <= 108; lon += 13.5) glyph(r, 6.5, 10, (x0, y0, x1, y1) => rune(at(lon, 35, x0), 35 + y0, at(lon, 35, x1), 35 + y1));
  // a band over the crown, from the brow band to the back of the head
  for (const side of [-1, 1]) for (let lat = 43; lat < 88; lat += 5) rune(at(0, lat, side * 6.5), lat, at(0, lat + 5, side * 6.5), Math.min(88, lat + 5), 1.5);
  for (const side of [-1, 1]) for (let lat = 43; lat < 88; lat += 5) rune(at(180, lat, side * 6.5), lat, at(180, lat + 5, side * 6.5), Math.min(88, lat + 5), 1.5);
  for (const lonC of [0, 180]) for (const lat of [51, 62, 73]) glyph(r, 7, 7.5, (x0, y0, x1, y1) => rune(at(lonC, lat + y0, x0), lat + y0, at(lonC, lat + y1, x1), lat + y1));
  // the mark on the forehead
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2, a1 = ((i + 1) / 14) * Math.PI * 2;
    rune(Math.cos(a0) * 7, 17.5 + Math.sin(a0) * 6, Math.cos(a1) * 7, 17.5 + Math.sin(a1) * 6, 1.4);
  }
  rune(0, 13.5, 0, 21.5); rune(-3.5, 19.5, 0, 15.5); rune(3.5, 19.5, 0, 15.5);
  // marks on the temples and under the eyes
  for (const s of [-1, 1]) {
    for (const lon of [62, 75, 88]) glyph(r, 6, 9, (x0, y0, x1, y1) => rune(s * (lon + x0), 8 + y0, s * (lon + x1), 8 + y1, 1.5));
    for (let i = 0; i < 3; i++) rune(s * (56 + i * 5), -8, s * (58 + i * 5), -17, 1.4);
  }
}

/** The staff: dark purple metal, and a band of runes that winds down it (x 16..272: along, two rows of 48 at y 128 and 176: round). */
function paintStaff(A: Atlas): void {
  const SC = 2 * Math.PI * STAFF_R, PITCH = 4.6, LL = Math.hypot(PITCH, SC), CELL = 0.6;
  const rs = rng(23), cells: number[][][] = [];
  for (let i = 0; i < 60; i++) { const segs: number[][] = []; glyph(rs, 0.3, 0.44, (x0, y0, x1, y1) => segs.push([x0, y0, x1, y1])); cells.push(segs); }
  for (let py = 0; py < 96; py++) for (let px = 0; px < 256; px++) {
    const row = py < 48 ? 0 : 1, sA = (((px + 0.5) / 256 + row) * STAFF_LEN) / 2, cA = (((py % 48) + 0.5) / 48) * SC;
    const m = 0.82 + 0.3 * vnoise(px * 0.45, (py % 48) * 0.1 + row * 7);
    let c = [44 * m, 26 * m, 70 * m], al = PLAIN;
    let w = (((cA - (SC * sA) / PITCH) % SC) + SC) % SC;
    if (w > SC / 2) w -= SC;
    const d = (w * PITCH) / LL, a = (sA * LL) / PITCH + (w * SC) / LL, ci = Math.floor(a / CELL), la = a - (ci + 0.5) * CELL;
    let dist = Math.abs(Math.abs(d) - 0.36);
    for (const g of cells[Math.max(0, Math.min(59, ci))]) {
      const dx = g[2] - g[0], dy = g[3] - g[1], t = Math.min(1, Math.max(0, ((la - g[0]) * dx + (d - g[1]) * dy) / (dx * dx + dy * dy || 1e-6)));
      dist = Math.min(dist, Math.hypot(la - g[0] - dx * t, d - g[1] - dy * t));
    }
    const ends = S(1.5, 2.3, sA) * S(STAFF_LEN - 0.8, STAFF_LEN - 1.6, sA);
    const cut = (1 - S(0.06, 0.13, dist)) * ends, cov = (1 - S(0.03, 0.065, dist)) * ends;
    c = c.map((v) => v * (1 - 0.6 * cut));
    c = c.map((v, i) => v + ([165, 215, 255][i] - v) * cov);
    al = PLAIN + (STAFF_GLOW - PLAIN) * cov;
    A.put(16 + px, 128 + py, c, al);
  }
}

/** The robe: charcoal cloth, worn; a purple and grey band above the hem, a panel down the front, lapels and a clasp. */
function paintRobe(A: Atlas): void {
  const RX = 272, RW = 128, RH = 256;
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    const streak = 0.78 + 0.3 * vnoise(x * 0.55, y * 0.035) + 0.12 * vnoise(x * 1.7 + 5, y * 0.4);
    const worn = S(0.62, 0.9, vnoise(x * 0.09 + 20, y * 0.05)) * (0.25 + 0.75 * S(170, 20, y));
    const base = [38, 38, 46].map((v, i) => v * streak + worn * [34, 32, 34][i]);
    // frayed: the hem's edge is ragged
    const fray = 2 + 7 * vnoise(x * 0.9, 3) * vnoise(x * 0.23, 8);
    A.put(RX + x, y, base, y < fray ? 0 : PLAIN);
  }
  const rr = rng(21);
  for (let i = 0; i < 9; i++) { // slits up from the hem and a few small holes
    const x = RX + 6 + rr() * (RW - 12), h = 8 + rr() * 16;
    A.line(x, 0, x + (rr() - 0.5) * 3, h, 1.3 + rr() * 1.6, [20, 20, 24], 0);
  }
  for (let i = 0; i < 5; i++) { const x = RX + 8 + rr() * (RW - 16), y = 14 + rr() * 50, s = 1.2 + rr() * 1.6; A.line(x, y, x + rr() * 2, y + rr() * 3, s * 2, [20, 20, 24], 0); }
  const PURPLE = [104, 62, 150], GREY = [112, 112, 124], SILVER = [176, 176, 192];
  // the hem band
  A.line(RX, 20, RX + RW, 20, 1.6, GREY); A.line(RX, 38, RX + RW, 38, 1.6, GREY);
  for (let x = 4; x < RW; x += 8) {
    const cx = RX + x, cy = 29;
    A.line(cx - 3, cy, cx, cy + 5, 1.3, PURPLE); A.line(cx, cy + 5, cx + 3, cy, 1.3, PURPLE); A.line(cx + 3, cy, cx, cy - 5, 1.3, PURPLE); A.line(cx, cy - 5, cx - 3, cy, 1.3, PURPLE);
    A.put(Math.round(cx), cy, GREY, null, 0.9);
  }
  // the front panel with runes down it (the front is the middle of the strip)
  const FX = RX + RW / 2;
  for (let y = 40; y < 196; y++) for (let x = -4; x <= 4; x++) A.put(FX + x, y, [50, 38, 66], null, 0.75);
  A.line(FX - 5, 40, FX - 5, 198, 1.3, GREY); A.line(FX + 5, 40, FX + 5, 198, 1.3, GREY);
  for (let y = 52; y < 186; y += 15) glyph(rr, 5, 9, (x0, y0, x1, y1) => A.line(FX + x0, y + y0, FX + x1, y + y1, 1.1, PURPLE));
  // the lapels and the clasp
  for (const s of [-1, 1]) {
    A.line(FX + s * 5, 196, FX + s * 22, 250, 1.6, GREY); A.line(FX + s * 8, 196, FX + s * 25, 250, 1.2, PURPLE);
    A.ring(FX + s * 5, 204, 5, 6, 1.6, SILVER, null, s > 0 ? -90 : 90, s > 0 ? 90 : 270);
    A.ring(FX + s * 4, 190, 4, 5, 1.4, SILVER, null, s > 0 ? -90 : 90, s > 0 ? 90 : 270);
  }
  A.ring(FX, 180, 5, 5, 1.6, SILVER, null, 180, 360);
  A.line(FX, 197, FX, 197.5, 3.4, RUNE, 255);
  // the sleeves' and shoulders' share of the strip stays plain
}

/** The tome's pages (left half, right half) and its cover. */
function paintTome(A: Atlas): void {
  const PXo = 400, PW = 112, PH = 96;
  const pr = rng(5);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const m = 0.86 + 0.14 * vnoise(x * 0.2, y * 0.2) - 0.22 * S(0.7, 0.95, vnoise(x * 0.06 + 3, y * 0.06 + 7));
    const gut = 1 - 0.35 * Math.exp(-Math.abs(x - PW / 2) / 5), edge = 1 - 0.25 * S(4, 0, Math.min(x, PW - 1 - x, y, PH - 1 - y));
    A.put(PXo + x, y, [205, 190, 158].map((v) => v * m * gut * edge));
  }
  const INK = [44, 26, 58];
  for (const half of [0, 1]) {
    const x0 = PXo + half * 56 + 8;
    for (let row = 0; row < 7; row++) {
      const y = 84 - row * 11;
      if (half === 1 && row < 3) continue;
      for (let q = 0; q < 6; q++) {
        const hot = pr() < 0.16;
        glyph(pr, 4, 7, (a, b, c, d) => A.line(x0 + 3 + q * 7 + a, y + b, x0 + 3 + q * 7 + c, y + d, 1, hot ? RUNE : INK, hot ? 255 : null));
      }
    }
  }
  // a circle of power on the right page
  const cxp = PXo + 84, cyp = 74;
  A.ring(cxp, cyp, 15, 15, 1.2, INK); A.ring(cxp, cyp, 11, 11, 1, INK);
  for (let i = 0; i < 5; i++) { const a0 = (90 + i * 144) * DEG, a1 = (90 + (i + 1) * 144) * DEG; A.line(cxp + Math.cos(a0) * 11, cyp + Math.sin(a0) * 11, cxp + Math.cos(a1) * 11, cyp + Math.sin(a1) * 11, 1.2, RUNE, 255); }
  for (let y = 96; y < 160; y++) for (let x = 0; x < PW; x++) {
    const m = 0.8 + 0.3 * vnoise(x * 0.3, y * 0.3);
    A.put(PXo + x, y, [58, 36, 60].map((v) => v * m));
  }
  for (const [x, y] of [[4, 100], [PW - 5, 100], [4, 155], [PW - 5, 155]]) A.line(PXo + x, y, PXo + x, y, 9, [130, 130, 146]);
  A.ring(PXo + 28, 128, 10, 12, 1.5, [130, 130, 146]); A.ring(PXo + 84, 128, 10, 12, 1.5, [130, 130, 146]);
}

/** The picture, RGBA bytes, `LICH_PAINT.w * LICH_PAINT.h` pixels. Row 0 is v = 0 (the bottom), see the top of the file. */
export function paintLich(): PaintImage {
  const A = new Atlas();
  paintSkull(A);
  paintStaff(A);
  paintRobe(A);
  paintTome(A);
  return { w: AW, h: AH, data: A.d };
}
