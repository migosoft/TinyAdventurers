// The demon's painted picture (#379): one 1536 x 384 RGBA image the built figure's uvs read. Plain bytes, no canvas and no three.js,
// the same bytes on every call. A port of the approved spike's paint (its rock skin, its horn paint and its webbing colours).
//
// Layout, in uv * size units with y counted from v = 0 (the bottom of the uv space; the image has row 0 on top, so image row =
// h - 1 - y, as the lich's picture): the skin (six bands along u, round the piece along v), under the two webbings (across the four
// panels along u, from the wrist out to the hanging edge along v) and two white blocks for the flat-coloured parts.
//
// Alpha is the class, with no blend between classes: 0 a hole (a rip in the webbing), `plain`, `glow` (the cracks, the horn and claw
// tips). Which kind of glow a texel is (pulsing or steady) comes from the vertex, not from the picture.

import type { PaintImage } from '../models/paint';

export const DEMON_PAINT = { w: 1536, h: 384, plain: 100, glow: 255, bands: 6,
  skin: { x: 0, y: 0, w: 1536, h: 128 }, webR: { x: 0, y: 128, w: 512, h: 256 }, webL: { x: 512, y: 128, w: 512, h: 256 },
  /** 8 x 8 px blocks of white: `flat` plain, `hot` glowing. A flat-coloured part points its uv here and carries its colour per vertex. */
  flat: { x: 1024, y: 128 }, hot: { x: 1040, y: 128 } } as const;

const P = DEMON_PAINT, BLOCK = 8;
const BLACK = 0x070506, WEB_RED = 0xb3202b, WEB_ROOT = 0x2e070c, CHARCOAL = 0x1c181a;
/** Bit 24 of a skin colour: the texel glows. */
const GLOWS = 0x1000000;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const hash = (i: number, j: number, k: number): number => { const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
const mixC = (a: number, b: number, k: number): number => {
  const t = clamp01(k), ch = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
/** Value noise; `wrap`: the period in y (whole cells), so it joins up round a piece. */
const vnoise = (x: number, y: number, k: number, wrap = 1e9): number => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (j: number): number => ((j % wrap) + wrap) % wrap;
  const a = hash(ix, w(iy), k), b = hash(ix + 1, w(iy), k), c = hash(ix, w(iy + 1), k), e = hash(ix + 1, w(iy + 1), k);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
};

// ---- the skin: rock. Plates of dark red-brown stone (a cell pattern) with cracks between them; in the hot stretches the cracks glow,
// yellow in the middle and red at the rims. Six bands along u: 0 the trunk and the head (strong cracks), 1 the arms and the tail (few,
// faint cracks), 2 to 4 the thigh, the shin and the foot bone (faint cracks, darkening to black at the foot), 5 the horns and the claws.
// Round a piece the pattern is not mirrored: it joins up at the seam. ----
const NU = 5, NR = 5, HORN_BAND = 5;
const ROCKS = [0x3a2a2a, 0x4a3330, 0x2f2325, 0x54382f] as const;

/** Dark red at the base, black along the length, then quickly dark red and a glowing tip, yellow to nearly white. */
function hornPaint(u: number, v: number): number {
  const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 9 + 2.5 * vnoise(u * 6, v * 8, 21, 8)), groove = vnoise(u * 3, v * 24, 23, 24);
  let c = u < 0.42 ? mixC(0x7a1712, 0x0d0a0b, u / 0.42) : 0x0d0a0b;
  c = mixC(c, u < 0.42 ? 0x2a0b0a : 0x241d1f, 0.3 * ridge * (0.5 + 0.5 * groove));
  if (u > 0.955) return mixC(0xffd24a, 0xfff6cf, (u - 0.955) / 0.03) | GLOWS;
  if (u > 0.92) return mixC(0xc3200c, 0xffd24a, (u - 0.92) / 0.035) | GLOWS;
  if (u > 0.86) return mixC(c, 0xa3180c, (u - 0.86) / 0.06);
  return c;
}

/** The skin's colour at `uAll` 0..1 over all six bands and `v` 0..1 round the piece; bit 24 marks a glowing texel. */
function skinPaint(uAll: number, v: number): number {
  const band = Math.min(P.bands - 1, Math.floor(uAll * P.bands)), u = uAll * P.bands - band;
  if (band === HORN_BAND) return hornPaint(u, v);
  const faint = band >= 1, seed = band * 40;
  const dark = band === 2 ? 0.35 * u : band === 3 ? 0.35 + 0.4 * u : band === 4 ? 0.75 + 0.25 * u : 0;
  const x = u * NU, y = v * NR, ix = Math.floor(x), iy = Math.floor(y), wrapR = (j: number): number => ((j % NR) + NR) % NR;
  let f1 = 9, f2 = 9, id = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const cx = ix + i, cy = iy + j, wy = wrapR(cy), dist = Math.hypot(x - (cx + 0.15 + 0.7 * hash(cx, wy, seed + 1)), y - (cy + 0.15 + 0.7 * hash(cx, wy, seed + 2)));
    if (dist < f1) { f2 = f1; f1 = dist; id = hash(cx, wy, seed + 3); } else if (dist < f2) f2 = dist;
  }
  const edge = f2 - f1, hot = vnoise(x * 0.7 + 3.1, v * 4, seed + 7, 4) - (faint ? 0.64 : 0.5);
  if (hot > 0 && dark < 0.45) {
    if (faint) {
      if (edge < 0.03) return 0xf04a10 | GLOWS;
      if (edge < 0.06) return 0x9a1a0a | GLOWS;
    } else {
      if (edge < 0.035) return 0xffc83a | GLOWS;
      if (edge < 0.08) return 0xff5a14 | GLOWS;
      if (edge < 0.12) return 0xc3200c | GLOWS;
    }
  } else if (edge < (faint ? 0.05 : 0.07)) return mixC(0x140e0f, BLACK, dark);
  const grain = hash(Math.floor(uAll * P.skin.w), Math.floor(v * P.skin.h), 5), fine = vnoise(x * 5, y * 5, 9, NR * 5);
  let c = mixC(ROCKS[Math.floor(id * ROCKS.length) % ROCKS.length], 0x1d1516, 0.55 * Math.max(0, 1 - edge / 0.5) + 0.25 * fine + 0.12 * grain);
  if (hot > 0 && !faint) c = mixC(c, 0x8a1c10, 0.6 * Math.max(0, 1 - (edge - 0.12) / 0.2));
  return mixC(c, BLACK, dark);
}

// ---- the webbing: four panels (`i`), each from the wrist (`t` 0) to the hanging edge (1) and from one bone (`w` 0) to the next (1) ----

/**
 * The outer parts are torn: two rips into each panel from its edge (a notch that widens to the edge) and a hole or two.
 * Above 0 inside a tear, falling to below 0 away from it. The two wings are torn differently.
 */
function torn(side: 1 | -1, i: number, t: number, w: number): number {
  let best = -9;
  const seed = i * 10 + (side > 0 ? 0 : 100);
  for (let r = 0; r < 2; r++) {
    const w0 = 0.18 + 0.3 * r + 0.34 * hash(seed, r, 41), t0 = 0.68 + 0.22 * hash(seed, r, 42), hw = 0.022 + 0.03 * hash(seed, r, 43);
    if (t > t0) best = Math.max(best, 1 - Math.abs(w - w0 - 0.03 * Math.sin((t - t0) * 24)) / (hw * (t - t0) / (1 - t0) + 1e-6));
  }
  for (let r = 0; r < 2; r++) {
    if (hash(seed, r, 44) < 0.25) continue;
    const tc = 0.55 + 0.3 * hash(seed, r, 45), wc = 0.2 + 0.6 * hash(seed, r, 46), rt = 0.02 + 0.02 * hash(seed, r, 47), rw = 0.035 + 0.03 * hash(seed, r, 48);
    best = Math.max(best, 1 - Math.hypot((t - tc) / rt, (w - wc) / rw));
  }
  return best;
}

/**
 * The webbing's colour: a very dark red where it is attached (round the wrist, along the bones, down the back), soon a bright red
 * over most of it, and a thin ragged rim of charcoal along the hanging edge and round every tear, as if burnt.
 */
function webTint(i: number, t: number, w: number, tear: number): number {
  const held = Math.max(1 - t / 0.22, 0.75 * (1 - Math.min(w, 1 - w) / 0.1), i === 3 ? 1 - (1 - w) / 0.3 : 0);
  let c = mixC(WEB_RED, WEB_ROOT, Math.pow(clamp01(held), 0.8));
  c = mixC(c, 0x5a1218, 0.3 * vnoise((i + w) * 5, t * 6, 33));
  const burnt = (t - (0.9 - 0.07 * vnoise((i + w) * 9, 0.5, 31))) / 0.06;
  return mixC(c, CHARCOAL, clamp01(Math.max(burnt, (tear + 0.6) / 0.5)));
}

/** The picture, RGBA bytes, `DEMON_PAINT.w * DEMON_PAINT.h` pixels, row 0 on top (see the top of the file). */
export function paintDemon(): PaintImage {
  const W = P.w, H = P.h, data = new Uint8Array(W * H * 4).fill(255);
  for (let i = 3; i < data.length; i += 4) data[i] = P.plain;
  const put = (x: number, y: number, k: number, a: number): void => {
    const o = ((H - 1 - y) * W + x) * 4;
    data[o] = (k >> 16) & 255; data[o + 1] = (k >> 8) & 255; data[o + 2] = k & 255; data[o + 3] = a;
  };
  for (let y = 0; y < P.skin.h; y++) for (let x = 0; x < P.skin.w; x++) {
    const k = skinPaint((x + 0.5) / P.skin.w, (y + 0.5) / P.skin.h);
    put(P.skin.x + x, P.skin.y + y, k, k & GLOWS ? P.glow : P.plain);
  }
  for (const side of [1, -1] as const) {
    const r = side > 0 ? P.webR : P.webL;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const across = ((x + 0.5) / r.w) * 4, i = Math.min(3, Math.floor(across)), w = across - i, t = (y + 0.5) / r.h, tear = torn(side, i, t, w);
      // a rip keeps its burnt colour under alpha 0, so a filtered rim never reads a foreign colour
      put(r.x + x, r.y + y, webTint(i, t, w, tear), tear > 0 ? 0 : P.plain);
    }
  }
  for (let y = 0; y < BLOCK; y++) for (let x = 0; x < BLOCK; x++) put(P.hot.x + x, P.hot.y + y, 0xffffff, P.glow);
  return { w: W, h: H, data };
}

/** uv of a skin point: `band` 0..5, `u` 0..1 along the band, `v` 0..1 round the piece. */
export function skinUv(band: number, u: number, v: number, out: [number, number]): [number, number] {
  // kept a texel off the band's ends and half a texel off the strip's rows, so a filtered read never takes a neighbour's colour
  out[0] = (P.skin.x + ((band + Math.max(0.004, Math.min(0.996, u))) / P.bands) * P.skin.w) / P.w;
  out[1] = (P.skin.y + 0.5 + clamp01(v) * (P.skin.h - 1)) / P.h;
  return out;
}

/** uv of a webbing point: `side` 1 the right wing, `across` 0..1 over the four panels (panel + share, over 4), `out01` 0 at the wrist, 1 at the edge. */
export function webUv(side: 1 | -1, across: number, out01: number, out: [number, number]): [number, number] {
  const r = side > 0 ? P.webR : P.webL;
  out[0] = (r.x + 0.5 + clamp01(across) * (r.w - 1)) / P.w;
  out[1] = (r.y + 0.5 + clamp01(out01) * (r.h - 1)) / P.h;
  return out;
}
