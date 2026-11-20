// SPIKE (#358), throwaway: the lich as a real 3D figure, to judge its look before the design is written. One mesh rebuilt on the CPU
// every frame: a skull (a dented ball with painted runes), a cloth robe (rings whose centres lag behind the body in world space, so
// the hem drags), a high collar, bell sleeves, bony hands, a staff with a gem, and a floating tome held by ghostly claws.
// It has its own fixed light and ignores the torches. Nothing here is meant to be kept as code.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture, DoubleSide, DynamicDrawUsage, Group, LinearFilter, LinearMipmapLinearFilter, Mesh,
  MeshBasicNodeMaterial, NoColorSpace, PlaneGeometry, RGBAFormat, Vector3, type Scene,
} from 'three/webgpu';
import { attribute, clamp, dot, float, length, mix, normalize, pow, smoothstep, texture, uniform, uv, vec3, vec4 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
type V = [number, number, number];

const PX = 1 / 16;
/** A human of the game is 18 px tall; the lich is drawn 21.2 px tall here and scaled to `size` humans. */
const HUMAN = 18, HEIGHT = 21.2;
export const LICH_DIMS = { height: HEIGHT, staff: 21.2, hem: 11.6 };

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const mad = (a: V, b: V, k: number): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dotv = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mixn = (a: number, b: number, t: number): number => a + (b - a) * t;
const S = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i: number): number => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const hash2 = (x: number, y: number): number => hash(x * 37.3 + y * 91.7);
const vnoise = (x: number, y: number): number => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return mixn(mixn(hash2(xi, yi), hash2(xi + 1, yi), sx), mixn(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), sx), sy);
};
const DEG = Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- colours (display values)
const BONE: V = [0.8, 0.8, 0.72], BONE_DARK: V = [0.5, 0.5, 0.44];
const CLOTH: V = [0.15, 0.15, 0.18], CLOTH_IN: V = [0.2, 0.12, 0.27], TRIM: V = [0.42, 0.38, 0.52];
const WOOD: V = [0.24, 0.17, 0.13], IRON: V = [0.33, 0.33, 0.4];
const GEM: V = [0.72, 0.9, 1.0], EYE: V = [0.93, 0.9, 1.0], GHOST: V = [0.3, 0.42, 0.62];
const RUNE = [175, 95, 255];

// ---------------------------------------------------------------- the painted atlas
// 512 x 256. Alpha: 0 cut away, 100 plain, 255 glowing (runes). Regions (px): white 0..16; skull x 16..272, y 0..128 (longitude, latitude);
// robe x 272..400, y 0..256 (round the body, hem to neck); pages x 400..512, y 0..96; cover x 400..512, y 96..160.
const AW = 512, AH = 256, PLAIN = 100;
const WU = 8 / AW, WV = 8 / AH;
const SOCKET = { lon: 30, lat: -5, rho: 19.5 }, NOSE_LAT = -25;

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

function paintAtlas(): DataTexture {
  const A = new Atlas();
  // ---- the skull
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

  // ---- the robe: charcoal cloth, worn; a purple and grey band above the hem, a panel down the front, lapels and a clasp
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
    A.put(Math.round(cx) , cy, GREY, null, 0.9);
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

  // ---- the tome's pages (left half, right half) and cover
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

  const t = new DataTexture(A.d, AW, AH, RGBAFormat);
  t.colorSpace = NoColorSpace;
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- buffers
class Buf {
  pos: Float32Array; nor: Float32Array; uv: Float32Array; aux: Float32Array; col: Float32Array; idx: Uint32Array;
  nv = 0; ni = 0;
  constructor(maxV: number, maxI: number) {
    this.pos = new Float32Array(maxV * 3); this.nor = new Float32Array(maxV * 3); this.uv = new Float32Array(maxV * 2);
    this.aux = new Float32Array(maxV * 2); this.col = new Float32Array(maxV * 3); this.idx = new Uint32Array(maxI);
  }
  reset(): void { this.nv = 0; this.ni = 0; }
  /** `unlit`: 0 shaded, 1 its own colour. `ao`: a darkening factor. */
  vert(p: V, n: V, u: number, v: number, unlit: number, ao: number, c: V): number {
    const i = this.nv++;
    this.pos.set(p, i * 3); this.nor.set(n, i * 3); this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.aux[i * 2] = unlit; this.aux[i * 2 + 1] = ao; this.col.set(c, i * 3);
    return i;
  }
  tri(a: number, b: number, c: number): void { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  /** A grid of `rows` x `cols` vertices that starts at `first`. */
  grid(first: number, rows: number, cols: number, flip = false): void {
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
      const a = first + i * cols + j, c = a + cols;
      if (flip) { this.tri(a, a + 1, c); this.tri(a + 1, c + 1, c); } else { this.tri(a, c, a + 1); this.tri(a + 1, c, c + 1); }
    }
  }
  /** Smooth normals for the vertices from `v0` on, from the triangles from `i0` on. */
  normals(v0: number, i0: number): void {
    this.nor.fill(0, v0 * 3, this.nv * 3);
    const p = this.pos, n = this.nor;
    for (let i = i0; i < this.ni; i += 3) {
      const a = this.idx[i] * 3, b = this.idx[i + 1] * 3, c = this.idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
    }
    for (let i = v0 * 3; i < this.nv * 3; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  }
  /** Two columns of a grid share their normals (a seam whose vertices are doubled for the texture). */
  weld(first: number, rows: number, cols: number): void {
    for (let i = 0; i < rows; i++) {
      const a = (first + i * cols) * 3, b = (first + i * cols + cols - 1) * 3, n = this.nor;
      const m = norm([n[a] + n[b], n[a + 1] + n[b + 1], n[a + 2] + n[b + 2]]);
      n.set(m, a); n.set(m, b);
    }
  }
}

interface TubeOpt { seg?: number; side?: V; col: V | ((i: number) => V); caps?: [boolean, boolean]; unlit?: number; droop?: number[]; upright?: boolean }
/** A tube through `pts` with an elliptical cross-section (`rad`: half height, half width); the frames are carried along, so it never twists. */
function tube(b: Buf, pts: V[], rad: ([number, number] | number)[], o: TubeOpt): void {
  const seg = o.seg ?? 8, n = pts.length, first = b.nv, unlit = o.unlit ?? 0;
  let side: V = o.side ?? [0, 0, 1];
  const tans = pts.map((_, i) => norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  const colOf = (i: number): V => (typeof o.col === 'function' ? o.col(i) : o.col);
  for (let i = 0; i < n; i++) {
    const t = tans[i];
    side = norm(mad(side, t, -dotv(side, t)));
    let up = cross(side, t);
    if (o.upright && up[1] < 0) { side = mul(side, -1); up = mul(up, -1); }
    const r = rad[i], ry = Math.max(0.01, typeof r === 'number' ? r : r[0]), rz = Math.max(0.01, typeof r === 'number' ? r : r[1]);
    for (let j = 0; j <= seg; j++) {
      const a = Math.PI / 2 + (j / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), f = sa < 0 ? (o.droop?.[i] ?? 1) : 1;
      b.vert(mad(mad(pts[i], side, rz * ca), up, ry * sa * f), norm(mad(mul(side, ca / rz), up, sa / (ry * f))), WU, WV, unlit, 1, colOf(i));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = first + i * (seg + 1) + j, c = a + seg + 1; b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1); }
  const cap = (at: number, dir: number): void => {
    const r = rad[at], rr = typeof r === 'number' ? r : Math.min(r[0], r[1]);
    const c = b.vert(mad(pts[at], tans[at], dir * 0.5 * rr), mul(tans[at], dir), WU, WV, unlit, 1, colOf(at));
    for (let j = 0; j < seg; j++) b.tri(c, first + at * (seg + 1) + j, first + at * (seg + 1) + j + 1);
  };
  if (o.caps?.[0]) cap(0, -1);
  if (o.caps?.[1]) cap(n - 1, 1);
}

/** Catmull-Rom through rows of numbers, `subdiv` samples per span. */
function spline(ctrl: number[][], subdiv: number): number[][] {
  const out: number[][] = [], n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const a = ctrl[Math.max(0, i - 1)], b = ctrl[i], c = ctrl[i + 1], d = ctrl[Math.min(n - 1, i + 2)];
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      out.push(b.map((_, k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t * t * t)));
    }
  }
  out.push(ctrl[n - 1].slice());
  return out;
}
/** The middle joint of a two-bone limb from `a` to `c`, bent toward `pole`. */
function ik(a: V, c: V, l1: number, l2: number, pole: V): V {
  const d0 = sub(c, a), d = Math.min(len(d0), (l1 + l2) * 0.999), dir = norm(d0);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  return mad(mad(a, dir, x), norm(mad(pole, dir, -dotv(pole, dir))), h);
}

/** A bony hand: four fingers and a thumb from the wrist. `f`: where the fingers point, `pn`: the palm's normal (fingers curl toward it). */
function hand(b: Buf, wrist: V, f0: V, pn0: V, o: { s?: number; spread: number; curl: number; thumb: number; col: V; unlit?: number; fade?: number }): void {
  const s = o.s ?? 1, f = norm(f0), pn = norm(mad(pn0, f, -dotv(pn0, f))), sd = cross(f, pn), unlit = o.unlit ?? 0;
  const finger = (base: V, dir: V, lens: number[], curl0: number, curl: number, r: number): void => {
    const pts: V[] = [base], rad: number[] = [r * 1.15];
    let p = base;
    for (let k = 0; k < lens.length; k++) {
      const th = curl0 + k * curl, d = norm(mad(mul(dir, Math.cos(th)), pn, Math.sin(th))), q = mad(p, d, lens[k]);
      pts.push(lerp(p, q, 0.5), q); rad.push(r * 0.62, k === lens.length - 1 ? r * 0.4 : r);
      p = q;
    }
    tube(b, pts, rad, { seg: 5, col: o.col, unlit, side: sd, caps: [true, true] });
  };
  for (let j = 0; j < 4; j++) {
    const q = j / 3 - 0.5, sg = q * 2 * o.spread, dir = norm(mad(mul(f, Math.cos(sg)), sd, Math.sin(sg)));
    const knuckle = mad(mad(wrist, f, 0.85 * s), sd, q * 0.62 * s);
    tube(b, [mad(wrist, sd, q * 0.2 * s), knuckle], [0.07 * s, 0.075 * s], { seg: 4, col: o.col, unlit, side: sd });
    const lf = [0.9, 1, 0.95, 0.74][j] * s;
    finger(knuckle, dir, [0.56 * lf, 0.42 * lf, 0.32 * lf], o.curl * 0.6, o.curl, 0.09 * s);
  }
  finger(mad(mad(wrist, sd, o.thumb * 0.2 * s), f, 0.12 * s), norm(mad(mul(f, 0.55), sd, o.thumb * 0.83)), [0.5 * s, 0.4 * s, 0.3 * s], o.curl * 0.4, o.curl * 0.7, 0.095 * s);
  tube(b, [mad(wrist, f, -0.12 * s), mad(wrist, f, 0.1 * s)], [[0.11 * s, 0.24 * s], [0.1 * s, 0.22 * s]], { seg: 6, col: o.col, unlit, side: sd, caps: [true, true] });
}

// ---------------------------------------------------------------- the skull (built once, placed every frame)
interface Part { pos: Float32Array; nor: Float32Array; uv: Float32Array; idx: Uint32Array }
const SKULL_R = 1.9;
/** The surface's distance from the skull's centre in the direction (lon, lat), in skull radii. */
function skullR(lonD: number, latD: number): number {
  const lon = lonD * DEG, lat = latD * DEG, al = Math.abs(lonD);
  const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
  let r = 1 / Math.sqrt((dx / 1.04) ** 2 + (dy / 1.04) ** 2 + (dz / 0.94) ** 2);
  // the face narrows below the eyes; the back of the head is undercut
  const low = S(-14, -42, latD);
  r *= 1 - low * (0.5 - 0.36 * Math.max(0, dx) ** 1.5);
  r *= 1 + 0.13 * Math.exp(-((al - 56) ** 2 + (latD + 20) ** 2) / 170); // cheekbones
  r *= 1 + 0.07 * Math.exp(-((latD - 13) ** 2) / 40) * S(62, 40, al); // the brow
  r *= 1 - 0.09 * Math.exp(-((al - 80) ** 2 + (latD + 2) ** 2) / 250); // the temples
  r *= 1 + 0.2 * Math.exp(-((latD + 47) ** 2) / 110) * S(48, 28, al); // the upper jaw stands forward
  r *= 1 - 0.2 * (1 - S(0.5, 1.05, Math.hypot(lonD / 6.5, (latD - NOSE_LAT) / 7))); // the nose
  r *= 1 - 0.44 * (1 - S(SOCKET.rho * 0.68, SOCKET.rho, angDist(al, latD, SOCKET.lon, SOCKET.lat))); // the eye sockets
  r *= 1 - 0.62 * S(-55, -64, latD);
  return r;
}
function buildSkull(): Part {
  const NLON = 72, NLAT = 44, b = new Buf((NLON + 1) * (NLAT + 1), NLON * NLAT * 6);
  for (let i = 0; i <= NLAT; i++) for (let j = 0; j <= NLON; j++) {
    const lonD = -180 + (360 * j) / NLON, latD = -90 + (180 * i) / NLAT, lon = lonD * DEG, lat = latD * DEG;
    const r = skullR(lonD, latD) * SKULL_R;
    b.vert([r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)], [0, 1, 0], (16.5 + (j / NLON) * 255) / AW, (0.5 + (i / NLAT) * 127) / AH, 0, 1, [1, 1, 1]);
  }
  b.grid(0, NLAT + 1, NLON + 1);
  b.normals(0, 0);
  // outward: the crown's normal points up
  const top = (Math.floor(NLAT * 0.8) * (NLON + 1) + NLON / 2) * 3;
  if (b.nor[top] * b.pos[top] + b.nor[top + 1] * b.pos[top + 1] + b.nor[top + 2] * b.pos[top + 2] < 0) {
    for (let i = 0; i < b.ni; i += 3) { const t = b.idx[i + 1]; b.idx[i + 1] = b.idx[i + 2]; b.idx[i + 2] = t; }
    b.normals(0, 0);
  }
  b.weld(0, NLAT + 1, NLON + 1);
  return { pos: b.pos.slice(0, b.nv * 3), nor: b.nor.slice(0, b.nv * 3), uv: b.uv.slice(0, b.nv * 2), idx: b.idx.slice(0, b.ni) };
}
/** Where a point of the skull's surface is, in skull space. */
const skullPoint = (lonD: number, latD: number, depth = 1): V => {
  const r = skullR(lonD, latD) * SKULL_R * depth, lon = lonD * DEG, lat = latD * DEG;
  return [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)];
};
function place(b: Buf, part: Part, o: V, X: V, Y: V, Z: V): void {
  const first = b.nv, n = part.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const px = part.pos[i * 3], py = part.pos[i * 3 + 1], pz = part.pos[i * 3 + 2], nx = part.nor[i * 3], ny = part.nor[i * 3 + 1], nz = part.nor[i * 3 + 2];
    b.vert(
      [o[0] + X[0] * px + Y[0] * py + Z[0] * pz, o[1] + X[1] * px + Y[1] * py + Z[1] * pz, o[2] + X[2] * px + Y[2] * py + Z[2] * pz],
      [X[0] * nx + Y[0] * ny + Z[0] * nz, X[1] * nx + Y[1] * ny + Z[1] * nz, X[2] * nx + Y[2] * ny + Z[2] * nz],
      part.uv[i * 2], part.uv[i * 2 + 1], 0, 1, [1, 1, 1],
    );
  }
  for (let i = 0; i < part.idx.length; i++) b.idx[b.ni++] = first + part.idx[i];
}

// ---------------------------------------------------------------- the robe's shape (model px: front +x, up +y, the lich's right +z)
/** From the neck to the hem's edge on the floor: [y, half width, half depth, fold depth, how much it lags (0: with the body, 1: the hem)]. */
const ROBE: number[][] = [
  [16.9, 0.8, 0.75, 0, 0],
  [16.55, 1.75, 1.0, 0, 0],
  [16.0, 2.55, 1.25, 0, 0],
  [14.6, 2.25, 1.3, 0.012, 0.02],
  [12.4, 1.7, 1.15, 0.03, 0.06],
  [9.5, 1.85, 1.4, 0.06, 0.15],
  [6.0, 2.3, 1.9, 0.09, 0.3],
  [3.0, 2.8, 2.5, 0.12, 0.5],
  [1.0, 3.4, 3.2, 0.14, 0.7],
  [0.28, 4.1, 4.0, 0.16, 0.86],
  [0.12, 5.0, 5.0, 0.2, 1.0],
  [0.07, 5.8, 5.9, 0.26, 1.0],
];
const RINGS = spline(ROBE, 3), NR = RINGS.length, RSEG = 48;
const RING_V: number[] = (() => {
  const out = [0];
  for (let i = 1; i < NR; i++) out.push(out[i - 1] + Math.hypot(RINGS[i][0] - RINGS[i - 1][0], RINGS[i][1] - RINGS[i - 1][1]));
  return out.map((v) => 1 - v / out[NR - 1]);
})();

// ---------------------------------------------------------------- materials
interface Mats { body: MeshBasicNodeMaterial; glow: MeshBasicNodeMaterial; shadow: MeshBasicNodeMaterial; light: { value: Vector3 }; view: { value: Vector3 }; rune: { value: number } }
function materials(): Mats {
  const L: N = uniform(new Vector3(0, 1, 0)), viewU: N = uniform(new Vector3(0, 0.75, 0.66)), runeU: N = uniform(0.5);
  const n: N = normalize(attribute('normal', 'vec3')), uvA: N = attribute('uv', 'vec2'), aux: N = attribute('aux', 'vec2'), col: N = attribute('color', 'vec3');
  const tex: N = texture(paintAtlas(), uvA);
  const lam: N = clamp(dot(n, L), 0, 1);
  const lit: N = float(0.34).add(n.y.mul(0.5).add(0.5).mul(0.2)).add(lam.mul(0.66));
  const rim: N = pow(float(1).sub((dot(n, viewU) as N).abs()).clamp(0, 1), 2.5).mul(0.1);
  const albedo: N = col.mul(tex.rgb);
  const shaded: N = albedo.mul(lit).mul(aux.y).add(vec3(0.62, 0.56, 0.85).mul(rim));
  const glowing: N = smoothstep(0.55, 0.9, tex.a);
  const withRunes: N = mix(shaded, albedo.mul(runeU), glowing);
  const body = new MeshBasicNodeMaterial();
  body.colorNode = vec4(mix(withRunes, col, aux.x), tex.a);
  body.alphaTest = 0.2;
  body.side = DoubleSide;

  // halos and the ghostly claws: light added to the picture
  const fall: N = float(1).sub(smoothstep(0, 1, (length(uv().sub(0.5)) as N).mul(2)));
  const glow = new MeshBasicNodeMaterial();
  glow.colorNode = vec4(col, fall.mul(fall));
  glow.transparent = true; glow.depthWrite = false; glow.blending = AdditiveBlending; glow.side = DoubleSide;

  const shadow = new MeshBasicNodeMaterial();
  const fade: N = float(1).sub(smoothstep(0.3, 1, (length(uv().sub(0.5)) as N).mul(2))).mul(0.5);
  shadow.colorNode = vec4(vec3(0, 0, 0), fade);
  shadow.transparent = true; shadow.depthWrite = false;
  return { body, glow, shadow, light: L, view: viewU, rune: runeU };
}
function geometry(b: Buf): BufferGeometry {
  const g = new BufferGeometry();
  const dyn = (a: Float32Array, n: number): BufferAttribute => { const at = new BufferAttribute(a, n); at.setUsage(DynamicDrawUsage); return at; };
  g.setAttribute('position', dyn(b.pos, 3)); g.setAttribute('normal', dyn(b.nor, 3)); g.setAttribute('uv', dyn(b.uv, 2));
  g.setAttribute('aux', dyn(b.aux, 2)); g.setAttribute('color', dyn(b.col, 3));
  g.setIndex(new BufferAttribute(b.idx, 1));
  return g;
}

export type LichAction = 'idle' | 'nova' | 'raise' | 'fling' | 'gaze';
export const ACTION_SECS: Record<LichAction, number> = { idle: 0, nova: 2.3, raise: 1.9, fling: 1.2, gaze: 1.7 };
export interface LichPose {
  /** Tiles. */
  x: number; z: number;
  /** Where it faces (radians, 0: east). */
  face: number;
  /** Its height in humans. */
  size: number;
  action: LichAction;
  /** Seconds since the action began. */
  at: number;
  /** The ghostly claws under the tome. */
  claws: boolean;
  /** What the head looks at (tiles), or null. */
  look: { x: number; z: number } | null;
  /** 1 / cos(pitch): heights are stretched so a figure stands its full height on the screen. */
  stretch: number;
  /** The unit vector toward the camera (world). */
  view: V;
}
export interface LichSpike {
  attach(scene: Scene): void;
  step(dt: number, t: number, p: LichPose): void;
  dispose(): void;
}

export function createLichSpike(): LichSpike {
  const mats = materials(), skull = buildSkull();
  const b = new Buf(20000, 110000), g = new Buf(5000, 26000);
  const group = new Group();
  const bGeo = geometry(b), gGeo = geometry(g);
  const bMesh = new Mesh(bGeo, mats.body), gMesh = new Mesh(gGeo, mats.glow);
  bMesh.frustumCulled = false; gMesh.frustumCulled = false; gMesh.renderOrder = 2;
  group.add(bMesh, gMesh);
  const shadow = new Mesh(new PlaneGeometry(1, 1), mats.shadow);
  shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1; shadow.frustumCulled = false;
  // the cloth: where each ring's centre is, as an offset from the lich in world directions (model px), and its turn
  const rx = new Float32Array(NR), rz = new Float32Array(NR), rt = new Float32Array(NR);
  let tomeX = 0, tomeZ = 0;
  let started = false, lastX = 0, lastZ = 0, mv = 0, vx = 0, vz = 0, yaw = 0;

  return {
    attach(scene) { scene.add(shadow, group); started = false; },
    dispose() { group.removeFromParent(); shadow.removeFromParent(); bGeo.dispose(); gGeo.dispose(); },
    step(dt, t, p) {
      const k = (PX * p.size * HUMAN) / HEIGHT, cf = Math.cos(p.face), sf = Math.sin(p.face);
      const ease = (cur: number, to: number, rate: number): number => (started ? cur + (to - cur) * (1 - Math.exp(-dt * rate)) : to);
      const toLocal = (wx: number, wz: number): [number, number] => [wx * cf + wz * sf, -wx * sf + wz * cf];
      const toWorld = (lx: number, lz: number): [number, number] => [lx * cf - lz * sf, lx * sf + lz * cf];
      // how far it moved since the last frame (model px, world directions)
      const mx = started ? (p.x - lastX) / k : 0, mz = started ? (p.z - lastZ) / k : 0;
      lastX = p.x; lastZ = p.z;
      vx = ease(vx, mx / Math.max(dt, 1e-4), 8); vz = ease(vz, mz / Math.max(dt, 1e-4), 8);
      mv = ease(mv, Math.min(1, Math.hypot(vx, vz) / 22), 5);
      group.position.set(p.x, 0, p.z);
      group.rotation.set(0, -p.face, 0);
      group.scale.set(k, k * p.stretch, k);
      shadow.position.set(p.x, 0.02, p.z); shadow.scale.set(13 * k, 13 * k, 1);
      const lw = norm([-0.45, 0.8, 0.55]);
      mats.light.value.set(lw[0] * cf + lw[2] * sf, lw[1], -lw[0] * sf + lw[2] * cf);
      const view: V = [p.view[0] * cf + p.view[2] * sf, p.view[1], -p.view[0] * sf + p.view[2] * cf];
      mats.view.value.set(view[0], view[1], view[2]);

      // ---- what the action asks of each part (0..1 weights)
      const a = p.at, is = (n: LichAction): number => (p.action === n ? 1 : 0);
      const novaUp = is('nova') * S(0, 0.5, a) * (1 - S(1.25, 1.33, a)), novaHit = is('nova') * (a > 1.33 ? Math.exp(-(a - 1.33) * 3.2) : 0);
      const novaChest = is('nova') * S(0, 0.4, a) * (1 - S(1.5, 2.2, a));
      const raiseUp = is('raise') * S(0, 0.32, a) * (1 - S(0.42, 0.5, a)), raiseHit = is('raise') * (a > 0.5 ? Math.exp(-(a - 0.5) * 4) : 0);
      const raiseLow = is('raise') * S(0.1, 0.5, a) * (1 - S(0.6, 1.25, a)), raiseLift = is('raise') * S(0.6, 1.25, a) * (1 - S(1.45, 1.9, a));
      const flingBack = is('fling') * S(0, 0.28, a) * (1 - S(0.3, 0.44, a)), flingOut = is('fling') * S(0.3, 0.46, a) * (1 - S(0.72, 1.2, a));
      const gaze = is('gaze') * S(0, 0.3, a) * (1 - S(1.3, 1.7, a));
      const casting = Math.max(raiseLow, raiseLift, flingBack, flingOut);
      const flare = Math.max(novaUp * S(0, 1.25, a), novaHit, raiseLift * 0.8, raiseHit * 0.7);
      mats.rune.value = 0.42 + 0.2 * Math.sin(t * 1.7) + 1.25 * flare + 0.35 * gaze;

      b.reset(); g.reset();
      const halo = (c: V, r: number, col: V): void => {
        const right = norm(cross([0, 1, 0], view)), up = cross(view, right), o = mad(c, view, 0.45), first = g.nv;
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) g.vert(mad(mad(o, right, (u - 0.5) * 2 * r), up, (v - 0.5) * 2 * r), view, u, v, 1, 1, col);
        g.tri(first, first + 1, first + 2); g.tri(first, first + 2, first + 3);
      };

      // ---- the body's line: a slight stoop, leaning on the staff; it sinks a little when it leans forward to stare
      const bob = 0.1 * Math.sin(t * 1.4);
      const stoop = (y: number): number => (y > 11 ? 0.04 * (y - 11) ** 1.5 * (1 + 0.5 * gaze + 0.3 * mv) : 0);
      const side = (y: number): number => (y > 8 ? 0.022 * (y - 8) * (1 - mv * 0.6) : 0);
      const lift = (y: number): number => (y > 4 ? bob * S(4, 12, y) : 0);
      const at = (q: V): V => [q[0] + stoop(q[1]), q[1] + lift(q[1]), q[2] + side(q[1])];

      // ---- the robe: every ring's centre follows the body in world space, the lower the slower, and is never left far behind
      const first = b.nv, vl = toLocal(vx, vz), back = Math.atan2(-vl[1], -vl[0]);
      for (let i = 0; i < NR; i++) {
        const R = RINGS[i], lag = Math.min(1, Math.max(0, R[4]));
        const T = toWorld(stoop(R[0]), side(R[0]));
        if (!started || lag === 0) { rx[i] = T[0]; rz[i] = T[1]; rt[i] = p.face; } else {
          rx[i] -= mx; rz[i] -= mz;
          const f = 1 - Math.exp(-dt * mixn(30, 3.4, lag)), maxLag = 4.4 * lag ** 1.3;
          rx[i] += (T[0] - rx[i]) * f; rz[i] += (T[1] - rz[i]) * f;
          const ox = rx[i] - T[0], oz = rz[i] - T[1], ol = Math.hypot(ox, oz);
          if (ol > maxLag) { rx[i] = T[0] + (ox / ol) * maxLag; rz[i] = T[1] + (oz / ol) * maxLag; }
          let d = wrap(p.face - rt[i]);
          d -= d * (1 - Math.exp(-dt * mixn(30, 2.6, lag)));
          d = Math.min(0.75 * lag, Math.max(-0.75 * lag, d));
          rt[i] = p.face - d;
        }
        const c = toLocal(rx[i], rz[i]), tw = -wrap(p.face - rt[i]), ct = Math.cos(tw), st = Math.sin(tw);
        const y = R[0] + lift(R[0]), ph = 0.25 * Math.sin(t * 0.9 + i * 0.3) + i * 0.05;
        for (let j = 0; j <= RSEG; j++) {
          const an = Math.PI + (j / RSEG) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
          const fold = 0.8 * Math.cos(9 * an + 1.3 * Math.sin(2 * an) + ph) + 0.2 * Math.cos(4 * an + 1);
          const toBack = Math.cos(an - back);
          let m = 1 + R[3] * fold + mv * lag * 0.05 * Math.sin(11 * an - t * 9);
          m *= 1 + 0.3 * lag * lag * Math.max(0, -ca) ** 2; // a short train behind
          m *= 1 + mv * lag * lag * (0.42 * Math.max(0, toBack) ** 2 - 0.2 * Math.max(0, -toBack));
          const ex = R[2] * m * ca, ez = R[1] * m * sa;
          b.vert([c[0] + ex * ct - ez * st, Math.max(0.05, y + (lag > 0.95 ? 0.05 * fold : 0)), c[1] + ex * st + ez * ct], [0, 1, 0], (272.5 + (j / RSEG) * 127) / AW, (0.5 + RING_V[i] * 255) / AH, 0, 1, [1, 1, 1]);
        }
      }
      const i0 = b.ni;
      b.grid(first, NR, RSEG + 1, true);
      b.normals(first, i0);
      b.weld(first, NR, RSEG + 1);

      // ---- the head
      const head = at([1.05, 19.6, 0]);
      let want = 0;
      if (p.look) { const l = toLocal((p.look.x - p.x) / k, (p.look.z - p.z) / k); want = Math.min(0.45, Math.max(-0.45, 0.6 * Math.atan2(l[1], l[0]))); }
      yaw = ease(yaw, want, 3.5);
      const pitch = -0.46 + 0.16 * gaze + 0.05 * Math.sin(t * 0.7) - 0.22 * novaUp - 0.1 * flingOut;
      head[0] += 0.5 * gaze;
      const HX: V = [Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)], HZ: V = [-Math.sin(yaw), 0, Math.cos(yaw)], HY = cross(HZ, HX);
      place(b, skull, head, HX, HY, HZ);
      const inHead = (q: V): V => mad(mad(mad(head, HX, q[0]), HY, q[1]), HZ, q[2]);
      // the lower jaw: its own bone, hinged below the ears; it drops open when a spell is spoken
      const jawA = 0.02 + 0.03 * Math.sin(t * 0.8) + 0.3 * flingOut + 0.4 * novaHit + 0.22 * raiseLift + 0.16 * gaze, cj = Math.cos(jawA), sj = Math.sin(jawA);
      const jaw = (q: V): V => { const x = q[0] + 0.35, y = q[1] + 0.95; return inHead([-0.35 + x * cj + y * sj, -0.95 - x * sj + y * cj, q[2]]); };
      const JAW: V[] = [[-0.35, -0.95, 1.38], [-0.3, -1.55, 1.26], [0.38, -1.8, 1.04], [0.98, -1.84, 0.58], [1.22, -1.84, 0]];
      const jawLine = [...JAW, ...JAW.slice(0, -1).reverse().map((q): V => [q[0], q[1], -q[2]])];
      tube(b, jawLine.map(jaw), jawLine.map((_, i) => { const m = 1 - Math.abs(i - 4) / 4; return [0.24 + 0.07 * m, 0.15 + 0.05 * m] as [number, number]; }), { seg: 7, col: (i) => mul(BONE, 0.8 + 0.1 * (1 - Math.abs(i - 4) / 4)), side: [0, 0, 1], caps: [true, true] });
      for (let q = -4; q <= 4; q++) {
        const a2 = (q / 4.6) * 1.15, tx = 0.46 + 0.7 * Math.cos(a2), tz = 0.74 * Math.sin(a2);
        tube(b, [jaw([tx, -1.7, tz]), jaw([tx + 0.02, -1.3, tz])], [0.085, 0.07], { seg: 4, col: [0.86, 0.84, 0.72], caps: [false, true] });
      }
      tube(b, [at([0.5, 16.3, 0]), inHead([-0.35, -1.5, 0])], [0.42, 0.36], { seg: 6, col: BONE_DARK });
      // the eyes: two small lights that float in the middle of the hollow sockets
      const eyeGlow = 0.85 + 0.15 * Math.sin(t * 5.1) * Math.sin(t * 1.3) + 1.6 * gaze + 0.5 * flare;
      for (const s of [-1, 1]) {
        const e = inHead(skullPoint(s * SOCKET.lon, SOCKET.lat, 1.42));
        const r = 0.16 + 0.05 * gaze, pts: V[] = [mad(e, HX, -r), e, mad(e, HX, r)];
        tube(b, pts, [r * 0.55, r, r * 0.55], { seg: 6, col: mul(EYE, Math.min(1.3, eyeGlow)), unlit: 1, caps: [true, true] });
        halo(e, 0.5 + 0.35 * gaze, mul([0.75, 0.66, 1.0], 0.5 * eyeGlow));
      }

      // ---- the collar: high behind the head, open in front, a purple lining
      for (const inner of [0, 1]) {
        const c0 = b.nv, j0 = b.ni, COLS = 27, ROWS = 7;
        for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
          const s = i / (ROWS - 1), an = (-132 + (264 * j) / (COLS - 1)) * DEG, h = 1.1 + 4.4 * Math.max(0, Math.cos(an / 2)) ** 1.7 + 0.9 * Math.exp(-((an / (22 * DEG)) ** 2));
          const rxc = mixn(1.2, 2.25, s ** 0.8) - inner * 0.07, rzc = mixn(2.3, 2.75, s) - inner * 0.07;
          const q = at([0.3 - Math.cos(an) * rxc, 16.2 - 0.5 * (1 - Math.cos(an)) * (1 - s) + h * s, Math.sin(an) * rzc]);
          const edge = S(0.82, 1, s) + S(0.9, 1, Math.abs(an) / (132 * DEG)) * 0.8;
          b.vert(q, [0, 1, 0], WU, WV, 0, 1, lerp(inner ? CLOTH_IN : CLOTH, TRIM, Math.min(1, edge) * (inner ? 0.5 : 1)));
        }
        b.grid(c0, ROWS, COLS, inner === 1);
        b.normals(c0, j0);
      }

      // ---- the staff: planted at rest, lifted and tilted back in motion, raised for the Nova, struck down for Nova and Raise Dead
      const strike = raiseHit > 0 || novaHit > 0 ? 0.25 * Math.max(raiseHit, novaHit) * Math.abs(Math.sin((raiseHit > 0 ? a - 0.5 : a - 1.33) * 30)) : 0;
      const sBase: V = [2.3 - 0.7 * mv + 0.7 * novaUp + 0.3 * raiseUp, 0.9 * mv * (1 - novaUp) + 7.2 * novaUp + 2.8 * raiseUp + strike, 5.4 - 1.9 * novaUp];
      const sAxis = norm([-0.03 + 0.17 * mv - 0.05 * novaUp, 1, -0.1 + 0.09 * novaUp + 0.02 * Math.sin(t * 0.8) * (1 - mv)]);
      const sSide = norm(cross(sAxis, [0, 0, 1])), sUp = cross(sSide, sAxis), SL = LICH_DIMS.staff - 1.5;
      const onStaff = (h: number, sx = 0, sz = 0): V => mad(mad(mad(sBase, sAxis, h), sSide, sx), sUp, sz);
      const shaft: V[] = [], shaftR: number[] = [];
      for (let i = 0; i <= 12; i++) { const h = (i / 12) * SL; shaft.push(onStaff(h, 0.14 * Math.sin(h * 0.7 + 1), 0.1 * Math.sin(h * 1.1))); shaftR.push(i === 0 ? 0.2 : mixn(0.3, 0.24, i / 12) + 0.04 * Math.sin(h * 2.3)); }
      tube(b, shaft, shaftR, { seg: 7, col: (i) => (i < 2 ? IRON : mul(WOOD, 0.85 + 0.3 * hash(i))), caps: [true, false] });
      // three claws at the top hold the gem
      const gemPulse = 0.72 + 0.28 * Math.sin(t * 2.3) + 1.1 * Math.max(novaUp * S(0, 1.25, a), novaHit, raiseHit);
      const gemC = onStaff(SL + 0.85);
      for (let q = 0; q < 3; q++) {
        const an = (q / 3) * Math.PI * 2 + 0.4, cx = Math.cos(an), cz = Math.sin(an);
        tube(b, [onStaff(SL - 0.2, 0.1 * cx, 0.1 * cz), onStaff(SL + 0.3, 0.52 * cx, 0.52 * cz), onStaff(SL + 0.9, 0.6 * cx, 0.6 * cz), onStaff(SL + 1.4, 0.3 * cx, 0.3 * cz)], [0.17, 0.13, 0.1, 0.04], { seg: 5, col: BONE_DARK, caps: [false, true] });
      }
      tube(b, [mad(gemC, sAxis, -0.55), mad(gemC, sAxis, -0.2), gemC, mad(gemC, sAxis, 0.25), mad(gemC, sAxis, 0.6)], [0.03, 0.3, 0.4, 0.28, 0.03], { seg: 6, col: mul(GEM, Math.min(1.25, 0.65 + 0.4 * gemPulse)), unlit: 1 });
      halo(gemC, 1.1 + 0.7 * gemPulse, mul([0.45, 0.72, 1.0], 0.34 * gemPulse));

      // ---- the arms: a sleeve to the wrist, the bones of the forearm, a hand
      const sleeve = (sh: V, wrist: V, pole: V): void => {
        const el = ik(sh, wrist, 3.7, 3.7, pole), cuff = lerp(el, wrist, 0.72);
        const drop: V = [0, -0.25, 0];
        tube(b, [sh, lerp(sh, el, 0.5), el, lerp(el, cuff, 0.55), cuff, mad(add(cuff, drop), norm(sub(wrist, el)), 0.5)], [[0.95, 0.9], [0.85, 0.8], [0.8, 0.75], [0.95, 0.85], [1.2, 1.0], [1.3, 1.1]],
          { seg: 12, col: (i) => (i === 5 ? TRIM : CLOTH), droop: [1, 1, 1.15, 1.6, 2.3, 2.6], upright: true, side: norm(cross(sub(wrist, sh), [0, 1, 0])) });
        tube(b, [el, wrist], [0.2, 0.15], { seg: 5, col: BONE_DARK });
      };
      // the right hand grips the staff
      const grip = onStaff(SL * 0.6 - 4.2 * novaUp - 1.2 * raiseUp), shR = at([0.3, 15.9, 2.25]);
      const inward = norm([shR[0] - grip[0], 0, shR[2] - grip[2]]), wristR = mad(mad(grip, inward, 0.55), sAxis, -0.1);
      sleeve(shR, wristR, [-0.7, -0.4, 0.6]);
      let fR = cross(sAxis, mul(inward, -1));
      if (fR[0] < 0) fR = mul(fR, -1);
      hand(b, mad(wristR, fR, -0.75), fR, mul(inward, -1), { spread: 0.08, curl: 1.15, thumb: -1, col: BONE });
      // the left hand is the one that casts
      const shL = at([0.3, 15.9, -2.25]);
      let hp: V = [3.3, 12.3 + 0.15 * Math.sin(t * 1.1), -1.9], hf: V = [0.9, -0.3, 0.2], hn: V = [-0.2, -1, 0], spread = 0.24, curl = 0.3;
      const pull = (w: number, q: V, f: V, n: V, sp: number, cu: number): void => { hp = lerp(hp, q, w); hf = lerp(hf, f, w); hn = lerp(hn, n, w); spread = mixn(spread, sp, w); curl = mixn(curl, cu, w); };
      pull(novaChest, [1.9, 13.8, -0.5], [0.3, 0.9, 0.3], [0.9, 0, 0.3], 0.1, 0.55);
      pull(raiseLow, [3.6, 8.6, -2.6], [1, -0.1, 0], [0, -1, 0], 0.4, 0.15);
      pull(raiseLift, [3.6, 15.2, -2.6], [0.8, 0.5, 0], [-0.3, 0.9, 0], 0.3, 0.75);
      pull(flingBack, [0.4, 15.2, -3.4], [-0.2, 0.9, -0.3], [0.9, 0.2, 0], 0.2, 0.6);
      pull(flingOut, [6.2, 14.2, -0.8], [1, 0.05, 0.1], [0.2, -0.9, 0], 0.42, 0.08);
      sleeve(shL, hp, [-0.7, -0.4, -0.6]);
      hand(b, mad(hp, norm(hf), -0.3), hf, hn, { spread, curl, thumb: 1, col: BONE });

      // ---- the tome: floats in front at hip height, bobs, follows with a small lag; its pages turn when a spell is spoken
      const tT = toWorld(5.6, -0.35);
      if (!started) { tomeX = tT[0]; tomeZ = tT[1]; } else {
        tomeX -= mx; tomeZ -= mz;
        const f = 1 - Math.exp(-dt * 7);
        tomeX += (tT[0] - tomeX) * f; tomeZ += (tT[1] - tomeZ) * f;
        const ox = tomeX - tT[0], oz = tomeZ - tT[1], ol = Math.hypot(ox, oz);
        if (ol > 1.6) { tomeX = tT[0] + (ox / ol) * 1.6; tomeZ = tT[1] + (oz / ol) * 1.6; }
      }
      const tl = toLocal(tomeX, tomeZ), tilt = 0.2 + 0.05 * Math.sin(t * 0.9 + 1), roll = 0.06 * Math.sin(t * 0.7);
      const Bc: V = [tl[0], 9.6 + 0.38 * Math.sin(t * 1.3), tl[1]];
      const Bu: V = [Math.cos(tilt), Math.sin(tilt), 0];
      const Br = norm([0, Math.sin(roll), Math.cos(roll)]), Bn = norm(cross(Br, Bu)), Bu2 = cross(Bn, Br);
      const PWd = 3.1, PHt = 4.3;
      /** A page that lies at the angle `phi` round the spine (0: flat to the right, pi: flat to the left). `half`: which half of the painting. */
      const page = (phi: number, half: number, liftN: number, curve: number, cover: boolean): void => {
        const p0 = b.nv, j0 = b.ni, QN = 7, SN = 2, w = cover ? PWd + 0.2 : PWd, hgt = cover ? PHt + 0.3 : PHt;
        const ax = mad(mul(Br, Math.cos(phi)), Bn, Math.sin(phi)), pn = mad(mul(Br, -Math.sin(phi)), Bn, Math.cos(phi));
        for (let i = 0; i < SN; i++) for (let j = 0; j < QN; j++) {
          const q = j / (QN - 1), s = i / (SN - 1), bend = curve * Math.sin(Math.PI * q) ** 0.7 * (1 - 0.45 * q);
          const pt = mad(mad(mad(mad(Bc, Bu2, (s - 0.5) * hgt), ax, q * w), pn, bend), Bn, liftN);
          const u = cover ? (400.5 + (half ? 56 + q * 55 : 55 - q * 55)) / AW : (400.5 + (half ? 56 + q * 55 : 55 - q * 55)) / AW;
          b.vert(pt, [0, 1, 0], u, cover ? (96.5 + s * 63) / AH : (0.5 + s * 95) / AH, 0, 1, [1, 1, 1]);
        }
        b.grid(p0, SN, QN, Math.cos(phi) < 0);
        b.normals(p0, j0);
      };
      page(0.05, 1, -0.25, 0, true); page(Math.PI - 0.05, 0, -0.25, 0, true);
      page(0.16, 1, 0, 0.32, false); page(Math.PI - 0.16, 0, 0, 0.32, false);
      tube(b, [mad(mad(Bc, Bu2, -PHt / 2 - 0.15), Bn, -0.22), mad(mad(Bc, Bu2, PHt / 2 + 0.15), Bn, -0.22)], [0.2, 0.2], { seg: 6, col: [0.2, 0.13, 0.22], caps: [true, true] });
      // a turning page: one slow turn every seven seconds at rest, a quick riffle while casting
      const slow = (t % 7) / 1.3, quick = (t * 2.4) % 1;
      const turn = casting > 0.05 ? quick : slow < 1 ? slow : -1;
      if (turn >= 0) page(mixn(0.16, Math.PI - 0.16, S(0, 1, turn)), turn < 0.5 ? 1 : 0, 0.02, 0.3 + 0.5 * Math.sin(Math.PI * turn), false);
      halo(mad(Bc, Bn, 0.3), 2.6, mul([0.5, 0.3, 0.85], 0.1 + 0.16 * casting + 0.1 * flare));
      // the ghostly claws: two hands of pale light that hook over the tome's outer edges, their arms fading away below
      const solid0 = g.nv;
      if (p.claws) for (const s of [-1, 1]) {
        const phi = s > 0 ? 0.05 : Math.PI - 0.05, ax = mad(mul(Br, Math.cos(phi)), Bn, Math.sin(phi));
        const edge = mad(mad(Bc, ax, PWd + 0.2), Bu2, -0.2 * s), wrist = mad(mad(edge, Br, s * 0.7), Bn, -1.5);
        const pal = 0.85 + 0.15 * Math.sin(t * 2 + s);
        hand(g, wrist, mad(mul(Bn, 1), Br, -s * 0.1), mul(Br, -s), { s: 1.25, spread: 0.3, curl: 0.62, thumb: s, col: mul(GHOST, 0.8 * pal), unlit: 1 });
        const arm: V[] = [wrist, mad(mad(wrist, Bn, -1.3), Br, s * 0.4), mad(mad(wrist, Bn, -2.4), Br, s * 0.8), mad(mad(wrist, Bn, -3.3), Br, s * 1.0)];
        tube(g, arm, [0.2, 0.19, 0.17, 0.1], { seg: 6, col: (i) => mul(GHOST, 0.7 * pal * [1, 0.55, 0.2, 0][i]), unlit: 1 });
      }

      for (let i = solid0; i < g.nv; i++) { g.uv[i * 2] = 0.5; g.uv[i * 2 + 1] = 0.5; } // solid shapes of light: no falloff
      for (const [buf, geo] of [[b, bGeo], [g, gGeo]] as [Buf, BufferGeometry][]) {
        for (const name of ['position', 'normal', 'uv', 'aux', 'color']) (geo.getAttribute(name) as BufferAttribute).needsUpdate = true;
        (geo.index as BufferAttribute).needsUpdate = true;
        geo.setDrawRange(0, buf.ni);
      }
      started = true;
    },
  };
}
