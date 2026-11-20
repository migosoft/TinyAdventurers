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

const BACK = 0x2c2022, PLATE = 0x261b1d, CLAW = 0x6b6068, FUR = 0x35241f, TOOTH = 0x1c1213;
const WEB_RED = 0x8a1f2a;
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
// The paint has three bands along u: 0 the trunk and the head (strong cracks), 1 the limbs and the tail (few, faint cracks), 2 the horns.
// Round a piece the pattern is not mirrored: it joins up at the seam.
const NU = 5, NR = 5, BANDS = 3, PAINT: readonly [number, number] = [768, 128];
const ROCKS = [0x3a2a2a, 0x4a3330, 0x2f2325, 0x54382f] as const;
const hornPaint = (u: number, v: number): number => {
  // Dark red at the base, black along the length, then quickly dark red and a glowing tip, yellow to nearly white.
  const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 15 + 2.5 * vnoise(u * 6, v * 8, 21, 8)), groove = vnoise(u * 3, v * 24, 23, 24);
  let c = u < 0.42 ? mixC(0x7a1712, 0x0d0a0b, u / 0.42) : 0x0d0a0b;
  c = mixC(c, u < 0.42 ? 0x2a0b0a : 0x241d1f, 0.55 * ridge * (0.5 + 0.5 * groove));
  if (u > 0.955) return mixC(0xffd24a, 0xfff6cf, (u - 0.955) / 0.03) | GLOWS;
  if (u > 0.92) return mixC(0xc3200c, 0xffd24a, (u - 0.92) / 0.035) | GLOWS;
  if (u > 0.86) return mixC(c, 0xa3180c, (u - 0.86) / 0.06);
  return c;
};
const SKIN = (uAll: number, v: number): number => {
  const band = Math.min(BANDS - 1, Math.floor(uAll * BANDS)), u = uAll * BANDS - band;
  if (band === 2) return hornPaint(u, v);
  const faint = band === 1, seed = band * 40;
  const x = u * NU, y = v * NR, ix = Math.floor(x), iy = Math.floor(y), wrapR = (j: number): number => ((j % NR) + NR) % NR;
  let f1 = 9, f2 = 9, id = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const cx = ix + i, cy = iy + j, wy = wrapR(cy), dist = Math.hypot(x - (cx + 0.15 + 0.7 * hash(cx, wy, seed + 1)), y - (cy + 0.15 + 0.7 * hash(cx, wy, seed + 2)));
    if (dist < f1) { f2 = f1; f1 = dist; id = hash(cx, wy, seed + 3); } else if (dist < f2) f2 = dist;
  }
  const edge = f2 - f1, hot = vnoise(x * 0.7 + 3.1, v * 4, seed + 7, 4) - (faint ? 0.64 : 0.5);
  if (hot > 0) {
    if (faint) {
      if (edge < 0.03) return 0xf04a10 | GLOWS;
      if (edge < 0.06) return 0x9a1a0a | GLOWS;
    } else {
      if (edge < 0.035) return 0xffc83a | GLOWS;
      if (edge < 0.08) return 0xff5a14 | GLOWS;
      if (edge < 0.12) return 0xc3200c | GLOWS;
    }
  } else if (edge < (faint ? 0.05 : 0.07)) return 0x140e0f;
  const grain = hash(Math.floor(uAll * PAINT[0]), Math.floor(v * PAINT[1]), 5), fine = vnoise(x * 5, y * 5, 9, NR * 5);
  let c = mixC(ROCKS[Math.floor(id * ROCKS.length) % ROCKS.length], 0x1d1516, 0.55 * Math.max(0, 1 - edge / 0.5) + 0.25 * fine + 0.12 * grain);
  if (hot > 0 && !faint) c = mixC(c, 0x8a1c10, 0.6 * Math.max(0, 1 - (edge - 0.12) / 0.2));
  return c;
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
  add({ shape: { tube: [{ p: [0, 1.2, 0], r: 3.5 }, { p: [0.4, -thigh.len * 0.45, 0], r: 3.5 }, { p: [0, -thigh.len, 0], r: 2.3 }], opts: { K: 16, N: 14 } }, at: [hipX, hipY, z], turn: thigh.turn, stage: 'legs', bone: upper, line: LINE, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0.6, 0], r: 2.2 }, { p: [0.5, -shin.len * 0.4, 0], r: 2.3 }, { p: [0, -shin.len, 0], r: 1.6 }], opts: { K: 14, N: 12 } }, at: [stifle[0], stifle[1], z], turn: shin.turn, stage: 'legs', bone: upper, line: LINE, colour: SKIN });
  // A plate over the knee.
  add({ shape: { drop: { r: 1.3, len: 3.2, sink: 0.8, wide: 0.9, dir: [1, 0.5, 0] } }, at: [stifle[0] + 0.6, stifle[1] + 0.2, z], stage: 'hair', bone: upper, line: 0.35, colour: PLATE });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 1.6 }, { p: [0, -cannon.len * 0.6, 0], r: 1.35 }, { p: [0, -cannon.len, 0], r: 1.5 }], opts: { K: 12, N: 10 } }, at: [hock[0], hock[1], z], turn: cannon.turn, stage: 'legs', bone: lower, line: LINE, colour: SKIN });
  // A spur behind the hock, the foot and its three claws.
  add({ shape: { drop: { r: 0.9, len: 2.8, sink: 0.5, wide: 0.8, dir: [-1, 0.3, 0] } }, at: [hock[0] - 1.0, hock[1], z], stage: 'legs', bone: lower, line: 0.35, colour: PLATE });
  add({ shape: { ball: [2.7, 1.4, 2.3] }, at: [ankle[0] + 1.3, 1.35, z], stage: 'legs', bone: lower, line: LINE, colour: SKIN });
  for (const dz of [-1.4, 0, 1.4]) {
    add({ shape: { drop: { r: 0.75, len: 3.0, sink: 0.6, wide: 0.85, dir: [1, -0.22, dz * 0.25] } }, at: [ankle[0] + 3.2, 0.95, z + dz], stage: 'legs', bone: lower, line: 0.3, colour: CLAW });
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
const R = 2.05, elbow = 6.3, fore = 6.5, shoulderZ = chestR * chestWide + 1.1;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0], shoulder[1], sd * shoulderZ];
  add({ shape: { ball: [R * 1.7, R * 1.6, R * 1.65] }, at: [at[0], at[1] + 0.5, at[2]], stage: 'arms', bone: `arm${s}`, line: LINE, colour: SKIN });
  for (const [dx, dz, len] of [[-0.6, 0.6, 4.0], [1.0, 1.4, 3.0], [-1.8, 1.6, 3.0]] as const) {
    add({ shape: { drop: { r: 1.0, len, sink: 0.6, wide: 0.7, dir: [dx * 0.25, 1, 0.5 * sd] } }, at: [at[0] + dx, at[1] + 2.6, at[2] + dz * sd], stage: 'hair', bone: `arm${s}`, line: 0.35, colour: PLATE });
  }
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 1.15 }, { p: [0.3, -elbow * 0.45, 0], r: R * 1.4 }, { p: [0, -elbow, 0], r: R * 1.0 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `arm${s}`, line: LINE, colour: SKIN });
  add({ shape: { tube: [{ p: [0, -elbow, 0], r: R * 1.0 }, { p: [0, -elbow - fore * 0.35, 0], r: R * 1.25 }, { p: [0, -elbow - fore, 0], r: R * 0.85 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `hand${s}`, line: LINE, colour: SKIN });
  // The right forearm: a crest of jagged plates down its outer side. The left: one spike on the elbow.
  if (s === 'R') {
    for (let i = 0; i < 5; i++) {
      add({ shape: { drop: { r: 1.0, len: 3.8 - i * 0.35, sink: 0.6, wide: 0.6, dir: [-0.7, 0.45, 0.55] } }, at: [at[0] - R * 0.6, at[1] - elbow - 0.2 - i * 1.25, at[2] + R * 0.6], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
    }
  } else add({ shape: { drop: { r: 0.8, len: 2.8, sink: 0.5, wide: 0.85, dir: [-1, 0.2, 0] } }, at: [at[0] - R * 0.7, at[1] - elbow, at[2]], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
  const hand: Vec3 = [at[0], at[1] - elbow - fore, at[2]];
  add({ shape: { ball: [R * 1.3, R * 1.2, R * 1.25] }, at: hand, stage: 'arms', bone: `hand${s}`, line: LINE, colour: SKIN });
  for (const [dx, dz] of [[1.1, 0], [0.6, 1.4], [0.6, -1.4], [-0.5, 0.8 * sd]] as const) {
    add({ shape: { drop: { r: 0.7, len: 4.2, sink: 0.6, wide: 0.85, dir: [dx * 0.6, -1, dz * 0.5] } }, at: [hand[0] + dx, hand[1] - 0.9, hand[2] + dz], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
  }
  pivots[`arm${s}`] = at;
}

// ---- the wings: a bat's (the Imp's construction, much larger). Each is drawn flat in its own plane (`s` along the span from the root
// on the shoulder blade, `h` up in the plane) and stood on the back: out to the side and up, nearly upright, swept back. The lower edge
// is torn: long ragged points between the finger tips. A slow beat. ----
if (WINGS) {
  const WEB = 0.38, WING = 6.0, SPAN = 1.6;
  /** [s, top, bottom] of the wing's outline. */
  const OUTLINE: readonly (readonly [number, number, number])[] = [
    [0, 0.2, -0.9], [0.35, 0.4, -1.5], [0.6, 0.55, -0.8], [0.95, 0.75, -1.9], [1.2, 0.95, -1.05], [1.5, 1.15, -2.2], [1.75, 1.3, -1.5],
    [2.0, 1.45, -2.6], [2.15, 1.55, -2.9], [2.35, 1.65, -1.6], [2.6, 1.7, -2.3], [2.8, 1.68, -1.0], [3.05, 1.63, -1.9], [3.3, 1.56, -0.9],
    [3.55, 1.48, -1.7], [3.9, 1.35, -2.1], [4.1, 1.3, -0.8], [4.35, 1.22, -1.2], [4.6, 1.15, 0.0], [5.0, 1.36, 0.64],
  ];
  const WRIST: readonly [number, number] = [2.4, 1.6];
  const BONES_2D: readonly (readonly (readonly [number, number])[])[] = [
    [[0, -0.05], [1.2, 0.75], WRIST],
    [WRIST, [3.8, 1.3], [5.25, 1.0]],
    [WRIST, [3.3, 0.5], [3.95, -2.2]],
    [WRIST, [2.35, 0.2], [2.15, -3.0]],
  ];
  for (const sd of [1, -1]) {
    const S = unit([-0.4, 0.3, 0.87 * sd]);
    const lean: Vec3 = [-0.2, 0.97, 0], k = lean[0] * S[0] + lean[1] * S[1] + lean[2] * S[2];
    const U = unit([lean[0] - k * S[0], lean[1] - k * S[1], lean[2] - k * S[2]]);
    const face: Vec3 = [S[1] * U[2] - S[2] * U[1], S[2] * U[0] - S[0] * U[2], S[0] * U[1] - S[1] * U[0]];
    const on = (s: number, h: number): [number, number, number] => [(S[0] * s * SPAN + U[0] * h) * WING, (S[1] * s * SPAN + U[1] * h) * WING, (S[2] * s * SPAN + U[2] * h) * WING];
    const root: Vec3 = [shoulder[0] - 3.8, shoulder[1] - 0.6, sd * 2.8];
    const web = add({
      shape: { tube: OUTLINE.map(([s, top, bottom]): TubePoint => { const r = (top - bottom) / 2 * WING; return { p: on(s, (top + bottom) / 2), r, wide: Math.min(1, WEB / r) }; }), opts: { K: 12, N: 120, ref: face, cap: 0.5, pow: 0.4 } },
      at: root, stage: 'hair', bone: 'body', line: 0.4, colour: WEB_RED,
      bend: { sway: 0.3, hinge: 0.3, flutter: { rate: 0.4, angle: 0.14, axis: [sd * U[0], sd * U[1], sd * U[2]] } },
    });
    BONES_2D.forEach((line, i) => {
      const r = i === 0 ? 1.15 : 0.7;
      add({ shape: { tube: line.map(([s, h], j): TubePoint => ({ p: on(s, h), r: j === 2 && i > 0 ? 0.4 : r })), opts: { K: 8, N: 12, cap: 0.6 } }, at: root, stage: 'hair', bone: 'body', line: 0.35, colour: BACK, bend: { with: web } });
    });
    // The torn edge: ragged strips of webbing hanging from the lower edge.
    const bottomAt = (sv: number): number => { let i = 0; while (i < OUTLINE.length - 2 && OUTLINE[i + 1][0] < sv) i++; const a = OUTLINE[i], b = OUTLINE[i + 1], k = (sv - a[0]) / (b[0] - a[0]); return a[2] + (b[2] - a[2]) * k; };
    [[0.45, 5], [0.95, 8], [1.5, 6], [1.85, 9], [2.15, 11], [2.6, 7], [3.05, 9], [3.55, 6], [3.9, 10], [4.35, 5]].forEach(([sv, len], i) => {
      const q = on(sv, bottomAt(sv) + 0.25), tilt = (i % 2 ? 0.25 : -0.2);
      add({ shape: { drop: { r: 1.0 + (i % 3) * 0.25, len, sink: 0.3, wide: 0.3, dir: [-U[0] + tilt * S[0], -U[1] + tilt * S[1], -U[2] + tilt * S[2]] } }, at: [root[0] + q[0], root[1] + q[1], root[2] + q[2]], stage: 'hair', bone: 'body', line: 0.3, colour: WEB_RED, bend: { with: web } });
    });
    const claw = on(WRIST[0], WRIST[1]);
    add({ shape: { drop: { r: 0.9, len: 4.4, sink: 0.4, wide: 0.9, dir: [U[0] + 0.5 * S[0], U[1] + 0.5 * S[1], U[2] + 0.5 * S[2]] } }, at: [root[0] + claw[0], root[1] + claw[1], root[2] + claw[2]], stage: 'hair', bone: 'body', line: 0.3, colour: PLATE, bend: { with: web } });
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
    const u = i / n, r = (1.7 * Math.pow(1 - u, 1.1) + 0.2) * (1 + (i > 0 && i < n ? 0.1 * (i % 2 === 0 ? 1 : -1) : 0));
    horn.push({ p: [-0.8 * u + 5.5 * Math.pow(u, 2), 1.2 * u - 1.3 * Math.sin(Math.PI * u) + 6.0 * Math.pow(u, 3), sd * 8.0 * Math.sin(Math.min(1, u * 1.3) * Math.PI / 2)], r });
  }
  add({ shape: { tube: horn, opts: { K: 14, N: 80, cap: 0.7 } }, at: head(-0.4, 1.3, sd * 1.5), stage: 'spikes', bone: 'hat', line: 0.45, colour: SKIN, band: 2 });
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
