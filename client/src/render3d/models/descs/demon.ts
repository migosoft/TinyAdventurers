// SPIKE (#379), throwaway: the demon boss as a tube description, to see whether the format of #356/#357 carries a figure three humans
// tall. Second draft, after the user's reference (2026-11-20): a towering, top-heavy demon standing upright. Charred black skin with
// glowing magma cracks down the breastbone and the ribs, a small head between massive ridged ram horns, glowing eyes and mouth, wide
// tattered bat wings with crimson webbing, thick bent legs on three-clawed feet, a long thick tail with a ridge, jagged obsidian
// plates on the shoulders, the right forearm and the hips, fire in the left palm.
// Units: about 31 to the top of the head, the front along +x, the feet at y 0, z to the figure's right.

import type { Vec3 } from '../desc';
import { fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

/** The spike's switches: `VITE_DEMON` holds the parts to leave out ("wings", "fire", "cracks"), and `h<factor>` for the height in humans. */
const OPT: string = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEMON ?? '';
const WINGS = !OPT.includes('wings');
const HUMANS = Number(/h([\d.]+)/.exec(OPT)?.[1] ?? 3);

const BACK = 0x2c2022, PLATE = 0x261b1d, FUR = 0x35241f, TOOTH = 0x1c1213, BLACK = 0x070506;
const WEB_RED = 0xb3202b, WEB_ROOT = 0x2e070c, CHARCOAL = 0x1c181a;
const OUTLINE_C = 0x121013, LINE = 0.55;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): TubePiece => { pieces.push(p); return p; };
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
// ---- the skin: rock. Plates of dark red-brown stone (a cell pattern) with cracks between them; in the hot stretches the cracks glow,
// yellow in the middle and red at the rims. The paint is mirrored round every piece, so the cracks are the same left and right. ----
const GLOWS = 0x1000000;
const hash = (i: number, j: number, k: number): number => { const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
const mixC = (a: number, b: number, k: number): number => {
  const t = Math.max(0, Math.min(1, k)), ch = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
/** Value noise; `wrap`: the period in y (whole cells), so it joins up round a piece. */
const vnoise = (x: number, y: number, k: number, wrap = 1e9): number => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (j: number): number => ((j % wrap) + wrap) % wrap;
  const a = hash(ix, w(iy), k), b = hash(ix + 1, w(iy), k), c = hash(ix, w(iy + 1), k), e = hash(ix + 1, w(iy + 1), k);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
};
// The paint has six bands along u: 0 the trunk and the head (strong cracks), 1 the arms and the tail (few, faint cracks), 2 to 4 the thigh,
// the shin and the foot bone (faint cracks, darkening to black at the foot), 5 the horns and the foot claws.
// Round a piece the pattern is not mirrored: it joins up at the seam.
const NU = 5, NR = 5, BANDS = 6, HORN_BAND = 5, PAINT: readonly [number, number] = [1536, 128];
const ROCKS = [0x3a2a2a, 0x4a3330, 0x2f2325, 0x54382f] as const;
const hornPaint = (u: number, v: number): number => {
  // Dark red at the base, black along the length, then quickly dark red and a glowing tip, yellow to nearly white.
  const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 9 + 2.5 * vnoise(u * 6, v * 8, 21, 8)), groove = vnoise(u * 3, v * 24, 23, 24);
  let c = u < 0.42 ? mixC(0x7a1712, 0x0d0a0b, u / 0.42) : 0x0d0a0b;
  c = mixC(c, u < 0.42 ? 0x2a0b0a : 0x241d1f, 0.3 * ridge * (0.5 + 0.5 * groove));
  if (u > 0.955) return mixC(0xffd24a, 0xfff6cf, (u - 0.955) / 0.03) | GLOWS;
  if (u > 0.92) return mixC(0xc3200c, 0xffd24a, (u - 0.92) / 0.035) | GLOWS;
  if (u > 0.86) return mixC(c, 0xa3180c, (u - 0.86) / 0.06);
  return c;
};
const SKIN = (uAll: number, v: number): number => {
  const band = Math.min(BANDS - 1, Math.floor(uAll * BANDS)), u = uAll * BANDS - band;
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
  const grain = hash(Math.floor(uAll * PAINT[0]), Math.floor(v * PAINT[1]), 5), fine = vnoise(x * 5, y * 5, 9, NR * 5);
  let c = mixC(ROCKS[Math.floor(id * ROCKS.length) % ROCKS.length], 0x1d1516, 0.55 * Math.max(0, 1 - edge / 0.5) + 0.25 * fine + 0.12 * grain);
  if (hot > 0 && !faint) c = mixC(c, 0x8a1c10, 0.6 * Math.max(0, 1 - (edge - 0.12) / 0.2));
  return mixC(c, BLACK, dark);
};

// ---- the legs: thick and bent like a beast's. A heavy thigh forward to the knee, the shin back to the hock, a short thick foot bone
// forward again to a broad foot with three claws ----
const hipX = 0, hipY = 15.5, legZ = 4.3;
const stifle: [number, number] = [3.8, 11.0], hock: [number, number] = [-3.2, 6.2], ankle: [number, number] = [-0.2, 1.7];
const down = (a: [number, number], b: [number, number]): { turn: number; len: number } => ({ turn: Math.atan2(b[0] - a[0], a[1] - b[1]), len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
const thigh = down([hipX, hipY], stifle), shin = down(stifle, hock), cannon = down(hock, ankle);
const pivots: TubeDesc['pivots'] = { body: [hipX, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 1.2, 0], r: 3.5 }, { p: [0.4, -thigh.len * 0.45, 0], r: 3.5 }, { p: [0, -thigh.len, 0], r: 2.3 }], opts: { K: 16, N: 14 } }, at: [hipX, hipY, z], turn: thigh.turn, stage: 'legs', bone: upper, line: LINE, colour: SKIN, band: 2 });
  add({ shape: { tube: [{ p: [0, 0.6, 0], r: 2.2 }, { p: [0.5, -shin.len * 0.4, 0], r: 2.3 }, { p: [0, -shin.len, 0], r: 1.6 }], opts: { K: 14, N: 12 } }, at: [stifle[0], stifle[1], z], turn: shin.turn, stage: 'legs', bone: upper, line: LINE, colour: SKIN, band: 3 });
  // A plate over the knee.
  add({ shape: { drop: { r: 1.3, len: 3.2, sink: 0.8, wide: 0.9, dir: [1, 0.5, 0] } }, at: [stifle[0] + 0.6, stifle[1] + 0.2, z], stage: 'hair', bone: upper, line: 0.35, colour: PLATE });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 1.6 }, { p: [0, -cannon.len * 0.6, 0], r: 1.35 }, { p: [0, -cannon.len, 0], r: 1.5 }], opts: { K: 12, N: 10 } }, at: [hock[0], hock[1], z], turn: cannon.turn, stage: 'legs', bone: lower, line: LINE, colour: SKIN, band: 4 });
  // A spur behind the hock, the foot and its three claws.
  add({ shape: { drop: { r: 0.9, len: 2.8, sink: 0.5, wide: 0.8, dir: [-1, 0.3, 0] } }, at: [hock[0] - 1.0, hock[1], z], stage: 'legs', bone: lower, line: 0.35, colour: PLATE });
  add({ shape: { ball: [2.7, 1.4, 2.3] }, at: [ankle[0] + 1.3, 1.35, z], stage: 'legs', bone: lower, line: LINE, colour: BLACK });
  for (const dz of [-1.4, 0, 1.4]) {
    // The claws: painted like the horns (dark red, black, a glowing tip), with a real point.
    const dir: Vec3 = [1, -0.22, dz * 0.25], L = 3.4;
    add({ shape: { tube: [0, 0.35, 0.7, 1].map((k): TubePoint => ({ p: [dir[0] * L * k, dir[1] * L * k - 0.25 * k * k, dir[2] * L * k], r: 0.75 * (1 - k * k * k) + 0.03 })), opts: { K: 10, N: 16, cap: 1 } }, at: [ankle[0] + 2.9, 1.0, z + dz], stage: 'legs', bone: lower, line: 0.3, colour: SKIN, band: 5 });
  }
  pivots[upper] = [hipX, hipY, z]; pivots[lower] = [hock[0], hock[1], z];
}

// ---- the torso: upright, from narrow hips to a very broad chest. Painted: the back darker, the front a warm dark red-brown ----
const RINGS: readonly (readonly [number, number, number, number])[] = [[hipX - 0.2, hipY - 0.2, 3.3, 1.25], [0.6, hipY + 4.0, 3.0, 1.2], [1.6, 25.4, 4.9, 1.55]];
/** A point of the torso's surface at height `y`, `turn` rad round from the front towards the side `sd`. */
const onTorso = (y: number, turn: number, sd: number, out = 0.1): Vec3 => {
  const i = y < RINGS[1][1] ? 0 : 1, a = RINGS[i], b = RINGS[i + 1], k = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1])));
  const cx = a[0] + (b[0] - a[0]) * k, r = a[2] + (b[2] - a[2]) * k + out, w = a[3] + (b[3] - a[3]) * k;
  return [cx + r * Math.cos(turn), y, sd * r * w * Math.sin(turn)];
};
const shoulder: Vec3 = [1.8, 26.0, 0], chestR = RINGS[2][2], chestWide = RINGS[2][3];
add({
  shape: { tube: RINGS.map(([x, y, r, wide]): TubePoint => ({ p: [x, y], r, wide })), opts: { K: 32, N: 28, ref: [0, 0, 1], cap: 0.75 } },
  stage: 'body', bone: 'body', line: LINE, torso: true,
  colour: SKIN,
});
// The chest muscles: two slabs on the front of the chest.
const PEC: Vec3 = [2.0, 2.4, 3.3], pecAt = (sd: number): Vec3 => [shoulder[0] + chestR * 0.7, shoulder[1] - 1.0, sd * 2.9];
for (const sd of [1, -1]) add({ shape: { ball: [PEC[0], PEC[1], PEC[2]] }, at: pecAt(sd), stage: 'body', bone: 'body', line: 0.35, colour: SKIN });
// The hump of muscle from the neck out to both shoulders.
add({ shape: { ball: [3.0, 2.3, 6.0] }, at: [shoulder[0] - 1.0, shoulder[1] + 1.4, 0], stage: 'body', bone: 'body', line: LINE, colour: SKIN });
// A row of spines down the back.
for (let i = 0; i < 5; i++) {
  const u = i / 4, y = shoulder[1] + 1.2 - u * 9, p = onTorso(Math.min(y, 25.4), Math.PI, 1, -0.3);
  add({ shape: { drop: { r: 0.8, len: 3.0 - u * 1.0, sink: 0.6, wide: 0.8, dir: [-1, 0.5, 0] } }, at: [i === 0 ? shoulder[0] - 3.6 : p[0], y, 0], stage: 'hair', bone: 'body', line: 0.35, colour: PLATE });
}
// The hips: a wrap of dark fur with a long flap in front, and jagged plates standing out round it.
add({ shape: { tube: [{ p: [hipX - 0.3, hipY - 1.8], r: 3.8, wide: 1.3 }, { p: [hipX, hipY + 1.4], r: 3.5, wide: 1.25 }], opts: { K: 24, N: 6, ref: [0, 0, 1], cap: 0.3 } }, stage: 'collar', bone: 'body', line: 0.45, colour: FUR });
add({ shape: { tube: [{ p: [0, 0, 0], r: 2.2, wide: 0.3 }, { p: [0.4, -4.0, 0], r: 1.7, wide: 0.3 }, { p: [0.5, -8.0, 0], r: 0.7, wide: 0.5 }], opts: { K: 12, N: 12, ref: [1, 0, 0], cap: 0.4 } }, at: [hipX + 3.5, hipY - 0.4, 0], stage: 'collar', bone: 'body', line: 0.4, colour: FUR });
for (const [turn, sd] of [[0.75, 1], [0.75, -1], [1.6, 1], [1.6, -1], [2.5, 1], [2.5, -1]] as const) {
  const c = Math.cos(turn), s = Math.sin(turn);
  add({ shape: { drop: { r: 1.1, len: 3.6, sink: 0.7, wide: 0.6, dir: [c * 0.8, -0.75, sd * s * 0.8] } }, at: [hipX + 3.6 * c, hipY + 0.4, sd * 4.6 * s], stage: 'hair', bone: 'body', line: 0.35, colour: PLATE });
}

// ---- the arms: long and very thick, a shoulder crowned with jagged plates, the forearm held a little forward, clawed hands ----
const R = 1.55, elbow = 6.3, fore = 6.5, shoulderZ = chestR * chestWide + 1.1;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0], shoulder[1], sd * shoulderZ];
  add({ shape: { ball: [R * 1.7, R * 1.6, R * 1.65] }, at: [at[0], at[1] + 0.5, at[2]], stage: 'arms', bone: `arm${s}`, line: LINE, colour: SKIN });
  for (const [dx, dz, len] of [[-0.6, 0.6, 4.0], [1.0, 1.4, 3.0], [-1.8, 1.6, 3.0]] as const) {
    add({ shape: { drop: { r: 1.0, len, sink: 0.6, wide: 0.7, dir: [dx * 0.25, 1, 0.5 * sd] } }, at: [at[0] + dx, at[1] + 2.6, at[2] + dz * sd], stage: 'hair', bone: `arm${s}`, line: 0.35, colour: PLATE });
  }
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 1.15 }, { p: [0.3, -elbow * 0.45, 0], r: R * 1.3 }, { p: [0, -elbow, 0], r: R * 1.0 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `arm${s}`, line: LINE, colour: SKIN });
  add({ shape: { tube: [{ p: [0, -elbow, 0], r: R * 1.0 }, { p: [0, -elbow - fore * 0.35, 0], r: R * 1.15 }, { p: [0, -elbow - fore, 0], r: R * 0.7 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `hand${s}`, line: LINE, colour: SKIN });
  // The right forearm: a crest of jagged plates down its outer side. The left: one spike on the elbow.
  if (s === 'R') {
    for (let i = 0; i < 5; i++) {
      add({ shape: { drop: { r: 1.0, len: 3.8 - i * 0.35, sink: 0.6, wide: 0.6, dir: [-0.7, 0.45, 0.55] } }, at: [at[0] - R * 0.6, at[1] - elbow - 0.2 - i * 1.25, at[2] + R * 0.6], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
    }
  } else add({ shape: { drop: { r: 0.8, len: 2.8, sink: 0.5, wide: 0.85, dir: [-1, 0.2, 0] } }, at: [at[0] - R * 0.7, at[1] - elbow, at[2]], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
  // The hand: a flat palm turned in towards the body and a little back, four fingers of two joints in a row from front to back, each
  // curling towards the palm's side and ending in a claw, and a thumb in front.
  const hand: Vec3 = [at[0], at[1] - elbow - fore, at[2]];
  const TURN = 0.5, row: Vec3 = [Math.cos(TURN), 0, -sd * Math.sin(TURN)], inw: Vec3 = [-Math.sin(TURN), 0, -sd * Math.cos(TURN)];
  const off = (a: number, y: number, c: number): [number, number, number] => [row[0] * a + inw[0] * c, y, row[2] * a + inw[2] * c];
  add({ shape: { tube: [{ p: off(0, 0.9, 0), r: 1.1, wide: 0.75 }, { p: off(0.1, -1.0, 0), r: 1.55, wide: 0.48 }, { p: off(0.1, -2.5, 0.1), r: 1.5, wide: 0.42 }], opts: { K: 14, N: 12, ref: inw, cap: 0.4 } }, at: hand, stage: 'arms', bone: `hand${s}`, line: 0.4, colour: SKIN });
  ([[1.1, 0.92, 0], [0.37, 1.08, 0.05], [-0.37, 1.0, 0.05], [-1.08, 0.8, 0]] as const).forEach(([a, k, c0]) => {
    const p0 = off(a, -2.5, 0.1 + c0), p1 = off(a * 1.08, -2.5 - 1.7 * k, 0.3 + c0), p2 = off(a * 1.1, -2.5 - 3.0 * k, 0.95 + c0);
    add({ shape: { tube: [{ p: p0, r: 0.46 }, { p: p1, r: 0.42 }, { p: p2, r: 0.33 }], opts: { K: 8, N: 10, cap: 0.6 } }, at: hand, stage: 'arms', bone: `hand${s}`, line: 0.3, colour: SKIN });
    add({ shape: { drop: { r: 0.3, len: 1.5, sink: 0.4, wide: 0.9, dir: [inw[0] * 0.6, -1, inw[2] * 0.6] } }, at: [hand[0] + p2[0], hand[1] + p2[1], hand[2] + p2[2]], stage: 'hair', bone: `hand${s}`, line: 0.25, colour: TOOTH });
  });
  const t0 = off(1.35, -0.6, 0.1), t1 = off(2.2, -1.6, 0.45), t2 = off(2.45, -2.7, 0.9);
  add({ shape: { tube: [{ p: t0, r: 0.55 }, { p: t1, r: 0.46 }, { p: t2, r: 0.36 }], opts: { K: 8, N: 10, cap: 0.6 } }, at: hand, stage: 'arms', bone: `hand${s}`, line: 0.3, colour: SKIN });
  add({ shape: { drop: { r: 0.32, len: 1.4, sink: 0.4, wide: 0.9, dir: [row[0] * 0.2 + inw[0] * 0.6, -1, row[2] * 0.2 + inw[2] * 0.6] } }, at: [hand[0] + t2[0], hand[1] + t2[1], hand[2] + t2[2]], stage: 'hair', bone: `hand${s}`, line: 0.25, colour: TOOTH });
  pivots[`arm${s}`] = at;
}

// ---- the wings: a bat's, half folded. An arm from the shoulder blade up to the wrist, four long fingers fanning out and down from
// the wrist, and the webbing between them, between the last finger and the back. The webbing's edge hangs in an arc between the finger
// tips. Folded, the webbing has more cloth than room: every panel hangs in a fold behind the wing, like a curtain pushed together.
// Each wing is laid out flat in its own plane (`s` out along the span from the root, `h` up) and stood on the back. ----
if (WINGS) {
  const WING = 6.0, THICK = 0.1, FOLD = 0.42, NT = 30, NW = 24;
  type P2 = readonly [number, number];
  const WRIST: P2 = [1.0, 2.3], ELBOW: P2 = [0.95, 0.9], BACK_END: P2 = [0.1, -2.4];
  /** The four fingers from the wrist: a point each bows through, and its tip. */
  const FINGERS: readonly (readonly [P2, P2])[] = [[[3.5, 2.95], [6.2, 1.3]], [[3.1, 1.0], [4.7, -1.5]], [[2.3, -0.1], [3.1, -3.2]], [[1.45, -0.5], [1.5, -3.8]]];
  const finger = (i: number, t: number): [number, number] => {
    const [mid, tip] = FINGERS[i], cx = 2 * mid[0] - (WRIST[0] + tip[0]) / 2, cy = 2 * mid[1] - (WRIST[1] + tip[1]) / 2, k = 1 - t;
    return [k * k * WRIST[0] + 2 * k * t * cx + t * t * tip[0], k * k * WRIST[1] + 2 * k * t * cy + t * t * tip[1]];
  };
  /** The webbing's inner edge: from the wrist down the arm to the root, then down the back. */
  const inner = (t: number): [number, number] => (t < 0.45 ? [WRIST[0] * (1 - t / 0.45), WRIST[1] * (1 - t / 0.45)] : [BACK_END[0] * (t - 0.45) / 0.55, BACK_END[1] * (t - 0.45) / 0.55]);
  const ray = (i: number, t: number): [number, number] => (i < 4 ? finger(i, t) : inner(t));
  /** How deep the edge of each panel hangs in between its two bones, as a share of the bones' length. */
  const ARC = [0.13, 0.12, 0.1, 0.06];
  for (const sd of [1, -1]) {
    const S = unit([-0.62, -0.1, 0.78 * sd]);
    const lean: Vec3 = [-0.2, 0.97, 0], k = lean[0] * S[0] + lean[1] * S[1] + lean[2] * S[2];
    const U = unit([lean[0] - k * S[0], lean[1] - k * S[1], lean[2] - k * S[2]]);
    // Behind the wing.
    const back: Vec3 = [(S[1] * U[2] - S[2] * U[1]) * sd, (S[2] * U[0] - S[0] * U[2]) * sd, (S[0] * U[1] - S[1] * U[0]) * sd];
    const on = (s: number, h: number, off = 0): [number, number, number] => [(S[0] * s + U[0] * h + back[0] * off) * WING, (S[1] * s + U[1] * h + back[1] * off) * WING, (S[2] * s + U[2] * h + back[2] * off) * WING];
    const root: Vec3 = [shoulder[0] - 3.8, shoulder[1] - 0.6, sd * 2.8];

    // The webbing: four panels, each a grid from the wrist (`t` 0) to the edge (1) and from one bone (`w` 0) to the next (1), two
    // sheets back to back. What each vertex is (panel, t, w) is kept by its place, for the colour and the bulge.
    const pos: number[] = [], nor: number[] = [], idx: number[] = [], what = new Map<string, readonly [number, number, number]>();
    const keyOf = (x: number, y: number, z: number): string => `${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;
    const at3 = (i: number, t: number, w: number): [number, number, number] => {
      const te = t * (1 - ARC[i] * 4 * w * (1 - w)), a = ray(i, te), b = ray(i + 1, te);
      return on(a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, FOLD * te * (Math.sin(Math.PI * w) + 0.3 * Math.sin(3 * Math.PI * w)));
    };
    // The outer parts are torn: two rips into each panel from its edge (a notch that widens to the edge) and a hole or two.
    // Above 0 inside a tear, falling to below 0 away from it. The two wings are torn differently.
    const torn = (i: number, t: number, w: number): number => {
      let best = -9;
      const seed = i * 10 + (sd > 0 ? 0 : 100);
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
    };
    for (let i = 0; i < 4; i++) for (const side of [1, -1]) {
      const v0 = pos.length / 3;
      for (let a = 0; a <= NT; a++) for (let b = 0; b <= NW; b++) {
        const t = a / NT, w = b / NW, e = 0.01, p = at3(i, t, w);
        const ta = at3(i, Math.min(1, t + e), w), tb = at3(i, Math.max(0, t - e), w), wa = at3(i, t, Math.min(1, w + e)), wb = at3(i, t, Math.max(0, w - e));
        const dt = [ta[0] - tb[0], ta[1] - tb[1], ta[2] - tb[2]], dw = [wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]];
        let n = unit([dt[1] * dw[2] - dt[2] * dw[1] || 0, dt[2] * dw[0] - dt[0] * dw[2] || 0, dt[0] * dw[1] - dt[1] * dw[0] || 1e-6]);
        if (n[0] * back[0] + n[1] * back[1] + n[2] * back[2] < 0) n = [-n[0], -n[1], -n[2]];
        const q: Vec3 = side > 0 ? p : [p[0] - n[0] * THICK, p[1] - n[1] * THICK, p[2] - n[2] * THICK];
        pos.push(q[0], q[1], q[2]); nor.push(n[0] * side, n[1] * side, n[2] * side);
        what.set(keyOf(q[0], q[1], q[2]), [i, t, w]);
      }
      for (let a = 0; a < NT; a++) for (let b = 0; b < NW; b++) {
        if (torn(i, (a + 0.5) / NT, (b + 0.5) / NW) > 0) continue;
        const c0 = v0 + a * (NW + 1) + b, c1 = c0 + 1, c2 = c0 + NW + 1, c3 = c2 + 1;
        for (const tri of [[c0, c1, c2], [c1, c3, c2]]) {
          const [A, B, C] = tri.map((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
          const g = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
          const facing = g[0] * nor[tri[0] * 3] + g[1] * nor[tri[0] * 3 + 1] + g[2] * nor[tri[0] * 3 + 2];
          if (facing >= 0) idx.push(tri[0], tri[1], tri[2]); else idx.push(tri[0], tri[2], tri[1]);
        }
      }
    }
    const whatAt = (q: Vec3): readonly [number, number, number] => what.get(keyOf(q[0], q[1], q[2])) ?? [0, 0, 0];
    // Elastic: between its bones the webbing goes further with every bend than the bones do.
    const bulge = (q: Vec3): number => { const [, t, w] = whatAt(q); return 1 + 0.7 * t * Math.sin(Math.PI * w); };
    // The colour: a very dark red where the webbing is attached (round the wrist, along the bones, down the back), soon a bright red
    // over most of it, and a thin ragged rim of charcoal along the hanging edge, as if burnt.
    const webTint = (q: Vec3): number => {
      const [i, t, w] = whatAt(q);
      const held = Math.max(1 - t / 0.22, 0.75 * (1 - Math.min(w, 1 - w) / 0.1), i === 3 ? 1 - (1 - w) / 0.3 : 0);
      let c = mixC(WEB_RED, WEB_ROOT, Math.pow(Math.max(0, Math.min(1, held)), 0.8));
      c = mixC(c, 0x5a1218, 0.3 * vnoise((i + w) * 5, t * 6, 33));
      const burnt = (t - (0.9 - 0.07 * vnoise((i + w) * 9, 0.5, 31))) / 0.06;
      return mixC(c, CHARCOAL, Math.max(0, Math.min(1, Math.max(burnt, (torn(i, t, w) + 0.6) / 0.5))));
    };
    const web = add({
      shape: { mesh: { position: Float32Array.from(pos), normal: Float32Array.from(nor), uv: null, index: Uint32Array.from(idx) }, axis: { dir: [S[0], S[1], S[2]], len: 6.2 * WING } },
      at: root, stage: 'hair', bone: 'body', line: 0, colour: WEB_RED, tint: webTint, bulge,
      bend: { sway: 0.2, hinge: 0.65, flutter: { rate: 0.4, angle: 0.12, axis: [sd * U[0], sd * U[1], sd * U[2]] } },
    });
    // The bones: the arm, and the four fingers, thinning to their tips; a claw on each tip and the thumb's on the wrist, in the horns' colours.
    const bone = (pts: readonly P2[], r0: number, r1: number): void => {
      add({ shape: { tube: pts.map(([s, h], j): TubePoint => ({ p: on(s, h), r: r0 + (r1 - r0) * j / (pts.length - 1) })), opts: { K: 8, N: pts.length * 5, cap: 0.6 } }, at: root, stage: 'hair', bone: 'body', line: 0.35, colour: BACK, bend: { with: web } });
    };
    const claw = (from: P2, dir: P2, len: number, r: number): void => {
      const l = Math.hypot(dir[0], dir[1]);
      add({ shape: { tube: [0, 0.4, 0.75, 1].map((u): TubePoint => ({ p: on(from[0] + dir[0] / l * len * u, from[1] + dir[1] / l * len * u), r: r * (1 - u * u * u) + 0.03 })), opts: { K: 8, N: 14, cap: 1 } }, at: root, stage: 'hair', bone: 'body', line: 0.3, colour: SKIN, band: HORN_BAND, bend: { with: web } });
    };
    bone([[0, 0], ELBOW, WRIST], 1.15, 0.8);
    for (let i = 0; i < 4; i++) {
      bone([0, 0.25, 0.5, 0.75, 1].map((t) => finger(i, t)), 0.7, 0.3);
      const tip = finger(i, 1), before = finger(i, 0.92);
      claw(tip, [tip[0] - before[0], tip[1] - before[1]], 0.55, 0.36);
    }
    claw(WRIST, [0.25, 1], 0.6, 0.42);
  }
}

// ---- the tail: long and thick like a reptile's, out of the back of the hips, down in a bow and away to one side, the tip curling
// up; a ridge of plates along its top; it sways ----
const TAIL: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 2.3], [-3.0, -4.0, 0.2, 2.0], [-6.5, -8.4, 1.2, 1.7], [-10.5, -11.4, 3.2, 1.35], [-15.0, -12.4, 5.6, 1.05], [-19.0, -11.4, 7.2, 0.8], [-21.2, -9.0, 6.6, 0.55], [-21.4, -6.6, 5.0, 0.28],
];
const tailAt: Vec3 = [hipX - 2.8, hipY + 0.4, 0];
const tail = add({
  shape: { tube: TAIL.map(([x, y, z, r]): TubePoint => ({ p: [x, y, z], r })), opts: { K: 14, N: 64, cap: 0.5 } },
  at: tailAt, stage: 'hair', bone: 'body', line: 0.45, colour: SKIN, bend: { sway: 0.6, wag: 0.35 },
});
for (let i = 1; i < 6; i++) {
  const [x, y, z, r] = TAIL[i];
  add({ shape: { drop: { r: 0.75, len: 2.6 - i * 0.25, sink: 0.6, wide: 0.7, dir: [-0.5, 1, 0] } }, at: [tailAt[0] + x, tailAt[1] + y + r * 0.7, tailAt[2] + z], stage: 'hair', bone: 'body', line: 0.3, colour: PLATE, bend: { with: tail } });
}

// ---- the head: small against the body, set between the shoulders; a heavy jaw; the eyes and the mouth glow ----
const HEAD: Vec3 = [2.7, 2.8, 2.6], HEAD_POW = 0.85;
const head = (x: number, y: number, z = 0): Vec3 => [4.4 + x, 28.9 + y, z];
/** A point of the head's surface: `turn` rad round from the front towards the side `sd`, `y` above the head's middle, moved out by the share `out` (negative: sunk). */
const onHead = (turn: number, y: number, sd: number, out = 0): Vec3 => {
  const h = Math.sqrt(Math.max(0, 1 - (y / HEAD[1]) ** 2)) * (1 + out), pw = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), HEAD_POW);
  return head(HEAD[0] * h * pw(Math.cos(turn)), y * (1 + out), sd * HEAD[2] * h * pw(Math.sin(turn)));
};
pivots.head = [2.8, 27.2, 0];
add({ shape: { ball: [HEAD[0], HEAD[1], HEAD[2]], pow: HEAD_POW }, at: head(0, 0), stage: 'head', bone: 'head', line: LINE, colour: SKIN });
const jaw = { x: 1.3, y: -1.9, rx: 2.3, rz: 2.3 };
add({ shape: { ball: [jaw.rx, 1.4, jaw.rz], pow: 0.85 }, at: head(jaw.x, jaw.y), stage: 'hair', bone: 'head', line: 0.45, colour: SKIN });
// A pointed chin.
add({ shape: { drop: { r: 1.0, len: 2.4, sink: 0.6, wide: 0.9, dir: [0.35, -1, 0] } }, at: head(jaw.x + 1.0, jaw.y - 0.8), stage: 'hair', bone: 'head', line: 0.35, colour: PLATE });
// The mouth: a wide glowing grin round the front of the jaw, its corners drawn up, jagged dark teeth across it from above and below.
const mouth = (a: number, out: number, dy = 0): Vec3 => head(jaw.x + (jaw.rx + out) * Math.cos(a), jaw.y + 0.35 + 0.42 * (a * a) + dy, (jaw.rz + out) * Math.sin(a));
add({
  shape: { tube: [-1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35].map((a): TubePoint => { const q = mouth(a, -0.3); return { p: [q[0], q[1], q[2]], r: 0.2 + 0.2 * Math.cos(a * 0.9) }; }), opts: { K: 8, N: 28, ref: [0, 1, 0], cap: 0.5 } },
  stage: 'spikes', bone: 'head', line: 0, colour: 0xff7a1a, glow: true,
});
for (let i = -5; i <= 5; i++) {
  const a = i * 0.24, upper = (i & 1) === 0, q = mouth(a, 0.02, upper ? 0.6 : -0.6);
  add({ shape: { drop: { r: 0.3, len: 1.05, sink: 0.3, wide: 0.8, dir: [0, upper ? -1 : 1, 0] } }, at: q, stage: 'spikes', bone: 'head', line: 0, colour: TOOTH });
}
pivots.hat = head(-0.6, 1.4);
for (const sd of [1, -1]) {
  // The horns: massive and ridged, out of the sides of the head, sweeping wide outward, then bent forward, the tips turning up.
  const n = 16, horn: TubePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, r = 1.15 * (1 - u * u * u) + 0.03;
    horn.push({ p: [-0.6 * u + 9.5 * Math.pow(u, 1.7), 0.8 * u - 1.2 * Math.sin(Math.PI * u) + 4.0 * Math.pow(u, 3), sd * 6.5 * Math.sin(Math.min(1, u * 1.5) * Math.PI / 2)], r });
  }
  add({ shape: { tube: horn, opts: { K: 14, N: 80, cap: 1 } }, at: head(-0.4, 1.3, sd * 1.5), stage: 'spikes', bone: 'hat', line: 0.45, colour: SKIN, band: HORN_BAND });
  // The eyes: glowing slits without pupils, slanted, sunk into the head; a heavy dark brow ridge over each, low over the nose.
  const eye = [onHead(0.22, 0.25, sd, -0.1), onHead(0.6, 0.8, sd, -0.1), onHead(1.0, 1.35, sd, -0.1)];
  add({ shape: { tube: eye.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.75 : 0.45 })), opts: { K: 10, N: 14, cap: 0.8 } }, stage: 'spikes', bone: 'head', line: 0, colour: 0xffb02e, glow: true });
  const brow = [onHead(0.08, 0.85, sd, 0.02), onHead(0.6, 1.6, sd, 0.02), onHead(1.1, 2.1, sd, 0.02)];
  add({ shape: { tube: brow.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.75 : 0.55 })), opts: { K: 8, N: 12, cap: 0.7 } }, stage: 'spikes', bone: 'head', line: 0, colour: PLATE });
}

// The limbs and the tail read the faint band.
for (const p of pieces) if (p.colour === SKIN && p.band === undefined && (p.stage === 'legs' || p.stage === 'arms' || p === tail)) p.band = 1;

export const demon: TubeDesc = {
  // The head's top is at y 31.7 (34.42 game px at size 1).
  name: 'Demon', size: fitSize(HUMANS, 34.42), outline: OUTLINE_C, pieces, pivots, paintSize: PAINT, paintBands: BANDS, paintRound: true,
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: elbow + fore, radius: R, elbow, free: 0.5 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false, knee: -1 }, { upper: 'leg2', lower: 'leg3', front: false, knee: -1 }],
  footprint: [6.0, 6.0],
};
