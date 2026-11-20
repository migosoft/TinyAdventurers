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
const WINGS = !OPT.includes('wings'), FIRE_ON = !OPT.includes('fire'), CRACKS = !OPT.includes('cracks');
const HUMANS = Number(/h([\d.]+)/.exec(OPT)?.[1] ?? 3);

const CHAR = 0x3b3538, BACK = 0x29252a, WARM = 0x50302c, PLATE = 0x1b1920, HORN = 0x48424a, CLAW = 0x6b6068, FUR = 0x35241f, BONE = 0xfdf7ed;
const WEB_RED = 0x8a1f2a, MAGMA = 0xff5a1a, MAGMA_CORE = 0xffb02e;
const OUTLINE_C = 0x121013, LINE = 0.55;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): TubePiece => { pieces.push(p); return p; };
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
/** A glowing crack: a thin tube lying in the surface it is given points of. */
const crack = (pts: readonly Vec3[], bone: TubePiece['bone'], r = 0.5, at?: Vec3, turn?: number): void => {
  if (!CRACKS) return;
  add({ shape: { tube: pts.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 0 || i === pts.length - 1 ? r * 0.6 : r })), opts: { K: 8, N: pts.length * 5, cap: 0.6 } }, ...(at ? { at } : {}), ...(turn !== undefined ? { turn } : {}), stage: 'spikes', bone, line: 0, colour: MAGMA, glow: true });
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
  add({ shape: { tube: [{ p: [0, 1.2, 0], r: 3.5 }, { p: [0.4, -thigh.len * 0.45, 0], r: 3.5 }, { p: [0, -thigh.len, 0], r: 2.3 }], opts: { K: 16, N: 14 } }, at: [hipX, hipY, z], turn: thigh.turn, stage: 'legs', bone: upper, line: LINE, colour: CHAR });
  crack([[3.2, -1.2, 0.9 * sd], [3.55, -2.8, 0.2 * sd], [3.3, -4.2, 1.1 * sd], [2.7, -5.4, 0.5 * sd]], upper, 0.42, [hipX, hipY, z], thigh.turn);
  add({ shape: { tube: [{ p: [0, 0.6, 0], r: 2.2 }, { p: [0.5, -shin.len * 0.4, 0], r: 2.3 }, { p: [0, -shin.len, 0], r: 1.6 }], opts: { K: 14, N: 12 } }, at: [stifle[0], stifle[1], z], turn: shin.turn, stage: 'legs', bone: upper, line: LINE, colour: CHAR });
  // A plate over the knee.
  add({ shape: { drop: { r: 1.3, len: 3.2, sink: 0.8, wide: 0.9, dir: [1, 0.5, 0] } }, at: [stifle[0] + 0.6, stifle[1] + 0.2, z], stage: 'hair', bone: upper, line: 0.35, colour: PLATE });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 1.6 }, { p: [0, -cannon.len * 0.6, 0], r: 1.35 }, { p: [0, -cannon.len, 0], r: 1.5 }], opts: { K: 12, N: 10 } }, at: [hock[0], hock[1], z], turn: cannon.turn, stage: 'legs', bone: lower, line: LINE, colour: CHAR });
  // A spur behind the hock, the foot and its three claws.
  add({ shape: { drop: { r: 0.9, len: 2.8, sink: 0.5, wide: 0.8, dir: [-1, 0.3, 0] } }, at: [hock[0] - 1.0, hock[1], z], stage: 'legs', bone: lower, line: 0.35, colour: PLATE });
  add({ shape: { ball: [2.7, 1.4, 2.3] }, at: [ankle[0] + 1.3, 1.35, z], stage: 'legs', bone: lower, line: LINE, colour: CHAR });
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
  colour: (_u, d) => (d < 0.4 ? BACK : d < 0.62 ? CHAR : WARM),
});
// The chest muscles: two slabs on the front of the chest.
const PEC: Vec3 = [2.0, 2.4, 3.3], pecAt = (sd: number): Vec3 => [shoulder[0] + chestR * 0.7, shoulder[1] - 1.0, sd * 2.9];
/** A point of a chest slab's surface: `up` and `side` shares of its radii (the side away from the middle). */
const onPec = (up: number, side: number, sd: number): Vec3 => {
  const c = pecAt(sd), f = Math.sqrt(Math.max(0, 1 - up * up - side * side));
  return [c[0] + PEC[0] * f + 0.1, c[1] + PEC[1] * up, c[2] + sd * PEC[2] * side];
};
for (const sd of [1, -1]) add({ shape: { ball: [PEC[0], PEC[1], PEC[2]] }, at: pecAt(sd), stage: 'body', bone: 'body', line: 0.35, colour: WARM });
// The hump of muscle from the neck out to both shoulders.
add({ shape: { ball: [3.0, 2.3, 6.0] }, at: [shoulder[0] - 1.0, shoulder[1] + 1.4, 0], stage: 'body', bone: 'body', line: LINE, colour: BACK });
// The magma: a crack down the breastbone to the belly, branches over each chest slab and along two ribs.
crack([[shoulder[0] + chestR * 0.78, shoulder[1] + 1.6, 0], [onPec(0.1, -0.86, 1)[0] + 0.2, 25.2, 0], onTorso(22.8, 0, 1, 0.2), onTorso(20.4, 0, 1), onTorso(18.4, 0, 1), onTorso(16.8, 0, 1)], 'body', 0.6);
if (CRACKS) add({ shape: { tube: [onTorso(24.6, 0, 1, 0.75), onTorso(22.8, 0, 1, 0.5), onTorso(21.0, 0, 1, 0.35)].map((p): TubePoint => ({ p: [p[0], p[1], p[2]], r: 0.3 })), opts: { K: 8, N: 10, cap: 0.6 } }, stage: 'spikes', bone: 'body', line: 0, colour: MAGMA_CORE, glow: true });
for (const sd of [1, -1]) {
  crack([onPec(0.25, -0.8, sd), onPec(0.45, -0.35, sd), onPec(0.4, 0.15, sd), onPec(0.6, 0.5, sd)], 'body', 0.45);
  crack([onPec(0.4, 0.15, sd), onPec(0.05, 0.4, sd), onPec(-0.25, 0.75, sd)], 'body', 0.4);
  crack([onTorso(22.4, 0.05, sd), onTorso(22.0, 0.45, sd), onTorso(21.0, 0.85, sd), onTorso(20.6, 1.2, sd)], 'body', 0.42);
  crack([onTorso(20.0, 0.05, sd), onTorso(19.5, 0.5, sd), onTorso(18.6, 0.95, sd)], 'body', 0.4);
}
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
  add({ shape: { ball: [R * 1.7, R * 1.6, R * 1.65] }, at: [at[0], at[1] + 0.5, at[2]], stage: 'arms', bone: `arm${s}`, line: LINE, colour: CHAR });
  for (const [dx, dz, len] of [[-0.6, 0.6, 4.0], [1.0, 1.4, 3.0], [-1.8, 1.6, 3.0]] as const) {
    add({ shape: { drop: { r: 1.0, len, sink: 0.6, wide: 0.7, dir: [dx * 0.25, 1, 0.5 * sd] } }, at: [at[0] + dx, at[1] + 2.6, at[2] + dz * sd], stage: 'hair', bone: `arm${s}`, line: 0.35, colour: PLATE });
  }
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 1.15 }, { p: [0.3, -elbow * 0.45, 0], r: R * 1.4 }, { p: [0, -elbow, 0], r: R * 1.0 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `arm${s}`, line: LINE, colour: CHAR });
  crack([[R * 1.25, -1.4, 0.4 * sd], [R * 1.42, -2.8, -0.2 * sd], [R * 1.2, -4.2, 0.5 * sd]], `arm${s}`, 0.38, at);
  add({ shape: { tube: [{ p: [0, -elbow, 0], r: R * 1.0 }, { p: [0, -elbow - fore * 0.35, 0], r: R * 1.25 }, { p: [0, -elbow - fore, 0], r: R * 0.85 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `hand${s}`, line: LINE, colour: CHAR });
  // The right forearm: a crest of jagged plates down its outer side. The left: one spike on the elbow.
  if (s === 'R') {
    for (let i = 0; i < 5; i++) {
      add({ shape: { drop: { r: 1.0, len: 3.8 - i * 0.35, sink: 0.6, wide: 0.6, dir: [-0.7, 0.45, 0.55] } }, at: [at[0] - R * 0.6, at[1] - elbow - 0.2 - i * 1.25, at[2] + R * 0.6], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
    }
  } else add({ shape: { drop: { r: 0.8, len: 2.8, sink: 0.5, wide: 0.85, dir: [-1, 0.2, 0] } }, at: [at[0] - R * 0.7, at[1] - elbow, at[2]], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
  const hand: Vec3 = [at[0], at[1] - elbow - fore, at[2]];
  add({ shape: { ball: [R * 1.3, R * 1.2, R * 1.25] }, at: hand, stage: 'arms', bone: `hand${s}`, line: LINE, colour: CHAR });
  for (const [dx, dz] of [[1.1, 0], [0.6, 1.4], [0.6, -1.4], [-0.5, 0.8 * sd]] as const) {
    add({ shape: { drop: { r: 0.7, len: 4.2, sink: 0.6, wide: 0.85, dir: [dx * 0.6, -1, dz * 0.5] } }, at: [hand[0] + dx, hand[1] - 0.9, hand[2] + dz], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: PLATE });
  }
  // The fire in the left palm: glowing tongues. At rest they lean forward, so they stand upright once the pose holds the forearm forward.
  if (FIRE_ON && s === 'L') {
    const f: Vec3 = [hand[0] + 2.4, hand[1] + 0.4, hand[2]], up: Vec3 = [0.5, 0.87, 0];
    add({ shape: { drop: { r: 1.5, len: 6.0, sink: 0.8, wide: 0.9, dir: up } }, at: f, stage: 'weapon', bone: `hand${s}`, line: 0, colour: MAGMA, glow: true });
    add({ shape: { drop: { r: 1.0, len: 4.0, sink: 0.6, wide: 0.9, dir: [0.75, 0.66, 0.3] } }, at: [f[0] + 0.5, f[1] - 0.2, f[2] + 0.9], stage: 'weapon', bone: `hand${s}`, line: 0, colour: MAGMA, glow: true });
    add({ shape: { drop: { r: 0.9, len: 3.4, sink: 0.6, wide: 0.9, dir: [0.2, 0.95, -0.3] } }, at: [f[0] - 0.4, f[1], f[2] - 0.9], stage: 'weapon', bone: `hand${s}`, line: 0, colour: MAGMA, glow: true });
    add({ shape: { drop: { r: 0.95, len: 3.6, sink: 0.5, wide: 1, dir: up } }, at: [f[0] + 0.25, f[1] + 0.3, f[2]], stage: 'weapon', bone: `hand${s}`, line: 0, colour: MAGMA_CORE, glow: true });
  }
  pivots[`arm${s}`] = at;
}

// ---- the wings: a bat's (the Imp's construction, much larger). Each is drawn flat in its own plane (`s` along the span from the root
// on the shoulder blade, `h` up in the plane) and stood on the back: out to the side and up, nearly upright, swept back. The lower edge
// is torn: long ragged points between the finger tips. A slow beat. ----
if (WINGS) {
  const WEB = 0.38, WING = 5.6;
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
    const S = unit([-0.5, 0.42, 0.76 * sd]);
    const lean: Vec3 = [-0.2, 0.97, 0], k = lean[0] * S[0] + lean[1] * S[1] + lean[2] * S[2];
    const U = unit([lean[0] - k * S[0], lean[1] - k * S[1], lean[2] - k * S[2]]);
    const face: Vec3 = [S[1] * U[2] - S[2] * U[1], S[2] * U[0] - S[0] * U[2], S[0] * U[1] - S[1] * U[0]];
    const on = (s: number, h: number): [number, number, number] => [(S[0] * s + U[0] * h) * WING, (S[1] * s + U[1] * h) * WING, (S[2] * s + U[2] * h) * WING];
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
  at: tailAt, stage: 'hair', bone: 'body', line: 0.45, colour: CHAR, bend: { sway: 0.6, wag: 0.35 },
});
for (let i = 1; i < 6; i++) {
  const [x, y, z, r] = TAIL[i];
  add({ shape: { drop: { r: 0.75, len: 2.6 - i * 0.25, sink: 0.6, wide: 0.7, dir: [-0.5, 1, 0] } }, at: [tailAt[0] + x, tailAt[1] + y + r * 0.7, tailAt[2] + z], stage: 'hair', bone: 'body', line: 0.3, colour: PLATE, bend: { with: tail } });
}

// ---- the head: small against the body, set between the shoulders; a heavy jaw; the eyes and the mouth glow ----
const HEAD: Vec3 = [2.4, 2.5, 2.3], HEAD_POW = 0.85;
const head = (x: number, y: number, z = 0): Vec3 => [4.4 + x, 28.9 + y, z];
/** A point of the head's surface: `turn` rad round from the front towards the side `sd`, `y` above the head's middle, moved out by the share `out` (negative: sunk). */
const onHead = (turn: number, y: number, sd: number, out = 0): Vec3 => {
  const h = Math.sqrt(Math.max(0, 1 - (y / HEAD[1]) ** 2)) * (1 + out), pw = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), HEAD_POW);
  return head(HEAD[0] * h * pw(Math.cos(turn)), y * (1 + out), sd * HEAD[2] * h * pw(Math.sin(turn)));
};
pivots.head = [2.8, 27.2, 0];
add({ shape: { ball: [HEAD[0], HEAD[1], HEAD[2]], pow: HEAD_POW }, at: head(0, 0), stage: 'head', bone: 'head', line: LINE, colour: CHAR });
const jaw = { x: 1.2, y: -1.7, rx: 2.0, rz: 1.9 };
add({ shape: { ball: [jaw.rx, 1.3, jaw.rz], pow: 0.85 }, at: head(jaw.x, jaw.y), stage: 'hair', bone: 'head', line: 0.45, colour: CHAR });
// The mouth: a glowing line round the front of the jaw, fangs over it.
const mouth = (a: number, out: number): Vec3 => head(jaw.x + (jaw.rx + out) * Math.cos(a), jaw.y + 0.45 - 0.3 * (a * a), (jaw.rz + out) * Math.sin(a));
add({
  shape: { tube: [-1.2, -0.6, 0, 0.6, 1.2].map((a): TubePoint => { const q = mouth(a, -0.25); return { p: [q[0], q[1], q[2]], r: 0.5 }; }), opts: { K: 8, N: 20, ref: [0, 1, 0], cap: 0.5 } },
  stage: 'spikes', bone: 'head', line: 0, colour: MAGMA, glow: true,
});
pivots.hat = head(-0.6, 1.4);
for (const sd of [1, -1]) {
  // The ram's horns: thick and ridged, out of the temples, up and back in a wide curl, down behind the head and forward again to a
  // point beside the jaw, spreading outward all the way.
  const T = 1.55 * Math.PI, n = 18, rho0 = 3.6;
  const horn: TubePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, t = u * T, rho = rho0 * (1 - 0.22 * u);
    const r = (1.3 * (1 - u) + 0.22) * (1 + (i > 0 && i < n ? 0.1 * (i % 2 === 0 ? 1 : -1) : 0));
    horn.push({ p: [-rho0 + rho * Math.cos(t) - 0.6 * u, rho * Math.sin(t), sd * (0.8 + 7.2 * Math.pow(u, 0.75))], r });
  }
  add({ shape: { tube: horn, opts: { K: 14, N: 90, cap: 0.7 } }, at: head(-0.5, 1.5, sd * 1.7), stage: 'spikes', bone: 'hat', line: 0.45, colour: HORN });
  // Fangs: a long lower one at each corner.
  add({ shape: { drop: { r: 0.5, len: 1.9, sink: 0.4, wide: 0.9, dir: [0.1, 1, -0.1 * sd] } }, at: mouth(sd * 0.8, -0.05), stage: 'spikes', bone: 'head', line: 0.2, colour: BONE });
  // The eyes: glowing slits without pupils, slanted, sunk into the head; a dark brow ridge over each.
  const eye = [onHead(0.25, 0.3, sd, -0.13), onHead(0.62, 0.75, sd, -0.13), onHead(1.0, 1.25, sd, -0.13)];
  add({ shape: { tube: eye.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.7 : 0.5 })), opts: { K: 10, N: 14, cap: 0.8 } }, stage: 'spikes', bone: 'head', line: 0, colour: MAGMA, glow: true });
  const brow = [onHead(0.12, 1.0, sd, -0.04), onHead(0.6, 1.5, sd, -0.04), onHead(1.05, 1.9, sd, -0.04)];
  add({ shape: { tube: brow.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.6 : 0.5 })), opts: { K: 8, N: 12, cap: 0.7 } }, stage: 'spikes', bone: 'head', line: 0, colour: PLATE });
}

export const demon: TubeDesc = {
  // The head's top is at y 31.4 (34.09 game px at size 1).
  name: 'Demon', size: fitSize(HUMANS, 34.09), outline: OUTLINE_C, pieces, pivots,
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: elbow + fore, radius: R, elbow, free: 0.5 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false, knee: -1 }, { upper: 'leg2', lower: 'leg3', front: false, knee: -1 }],
  footprint: [6.0, 6.0],
};
