// SPIKE (#379), throwaway: the demon boss as a tube description, to see whether the format of #356/#357 carries a figure three humans
// tall. A classic greater demon: goat legs, a narrow waist under a heavy chest and shoulders, the head low and forward between them,
// large horns sweeping out and up, long arms with clawed hands, bat wings, a tail, a burning sword.
// Units: about 30 to the top of the head, the front along +x, the feet at y 0, z to the figure's right.

import type { Vec3 } from '../desc';
import { DEMON_EYE, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

/** The spike's switches: `VITE_DEMON` holds the parts to leave out ("wings", "sword"), and `h<factor>` for the height in humans. */
const OPT: string = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DEMON ?? '';
const WINGS = !OPT.includes('wings'), SWORD = !OPT.includes('sword');
const HUMANS = Number(/h([\d.]+)/.exec(OPT)?.[1] ?? 2.8);

const SKIN = 0xc4402f, BACK = 0x8a2440, SHADE = 0x62232f, FUR = 0x3d2233, HORN = 0x2e2a33, BONE = 0xfdf7ed, DARK = 0x222222, CLOTH = 0x2b2630;
const FIRE = 0xff7a1a, FIRE_CORE = 0xffd21f;
const LINE = 0.55;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): TubePiece => { pieces.push(p); return p; };
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

// ---- the goat legs: a thick thigh forward to the stifle, the shin back to the hock, a thin cannon forward again to a hoof ----
const hipX = 0, hipY = 15.5, legZ = 3.4;
const stifle: [number, number] = [4.6, 11.6], hock: [number, number] = [-4.2, 7.0], ankle: [number, number] = [hipX - 0.7, 1.5];
const down = (a: [number, number], b: [number, number]): { turn: number; len: number } => ({ turn: Math.atan2(b[0] - a[0], a[1] - b[1]), len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
const thigh = down([hipX, hipY], stifle), shin = down(stifle, hock), cannon = down(hock, ankle);
const pivots: TubeDesc['pivots'] = { body: [hipX, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 1.0, 0], r: 3.1 }, { p: [0.3, -thigh.len * 0.45, 0], r: 2.9 }, { p: [0, -thigh.len, 0], r: 1.8 }], opts: { K: 16, N: 14 } }, at: [hipX, hipY, z], turn: thigh.turn, stage: 'legs', bone: upper, line: LINE, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0.5, 0], r: 1.6 }, { p: [0.4, -shin.len * 0.4, 0], r: 1.75 }, { p: [0, -shin.len, 0], r: 1.1 }], opts: { K: 14, N: 12 } }, at: [stifle[0], stifle[1], z], turn: shin.turn, stage: 'legs', bone: upper, line: LINE, colour: FUR });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 1.1 }, { p: [0, -cannon.len * 0.6, 0], r: 0.85 }, { p: [0, -cannon.len, 0], r: 1.0 }], opts: { K: 12, N: 10 } }, at: [hock[0], hock[1], z], turn: cannon.turn, stage: 'legs', bone: lower, line: LINE, colour: FUR });
  // A tuft of fur behind the hock, and the cloven hoof.
  add({ shape: { drop: { r: 0.9, len: 2.6, sink: 0.5, wide: 0.8, dir: [-0.8, -1, 0] } }, at: [hock[0] - 0.4, hock[1] - 0.2, z], stage: 'legs', bone: lower, line: 0.4, colour: FUR });
  add({ shape: { ball: [2.2, 1.45, 1.7] }, at: [ankle[0] + 0.8, 1.4, z], stage: 'legs', bone: lower, line: LINE, colour: HORN });
  pivots[upper] = [hipX, hipY, z]; pivots[lower] = [hock[0], hock[1], z];
}

// ---- the torso: leaning forward from narrow hips to a heavy chest. Painted: the back darker, the belly's muscles as dark lines ----
const shoulder: Vec3 = [3.4, 25.0, 0], chestR = 4.4, chestWide = 1.5;
add({
  shape: { tube: [{ p: [hipX - 0.3, hipY - 0.2], r: 3.1, wide: 1.2 }, { p: [1.0, hipY + 3.7], r: 2.6, wide: 1.15 }, { p: [shoulder[0], shoulder[1] - 0.4], r: chestR, wide: chestWide }], opts: { K: 32, N: 28, ref: [0, 0, 1], cap: 0.75 } },
  stage: 'body', bone: 'body', line: LINE, torso: true,
  colour: (u, d) => {
    if (d < 0.42) return BACK;
    // The belly: three cross lines and the middle line, only at the front.
    if (d > 0.78 && u > 0.18 && u < 0.62) {
      if (d > 0.975) return SHADE;
      const f = ((u - 0.18) / 0.11) % 1;
      if (f < 0.16) return SHADE;
    }
    return SKIN;
  },
});
// The chest muscles: two slabs on the front of the chest.
for (const sd of [1, -1]) add({ shape: { ball: [1.9, 2.3, 3.0] }, at: [shoulder[0] + chestR * 0.72, shoulder[1] - 0.6, sd * 2.7], stage: 'body', bone: 'body', line: 0.35, colour: SKIN });
// The hump of muscle from the neck out to both shoulders: the head sits in front of it, not on top.
add({ shape: { ball: [2.9, 2.1, 5.6] }, at: [shoulder[0] - 1.0, shoulder[1] + 1.3, 0], stage: 'body', bone: 'body', line: LINE, colour: BACK });
// A row of spines down the back.
for (let i = 0; i < 4; i++) {
  const u = i / 3, x = shoulder[0] - 3.6 - (1 - u) * 0 + u * 1.2 - 1.0, y = shoulder[1] + 0.6 - u * 6.5;
  add({ shape: { drop: { r: 0.7, len: 2.6 - u * 0.8, sink: 0.6, wide: 0.8, dir: [-1, 0.45, 0] } }, at: [x, y, 0], stage: 'hair', bone: 'body', line: 0.35, colour: HORN });
}
// The loincloth: a dark wrap round the hips, a flap hanging in front and behind.
add({ shape: { tube: [{ p: [hipX - 0.3, hipY - 1.6], r: 3.5, wide: 1.25 }, { p: [hipX, hipY + 1.2], r: 3.3, wide: 1.2 }], opts: { K: 24, N: 6, ref: [0, 0, 1], cap: 0.3 } }, stage: 'collar', bone: 'body', line: 0.45, colour: CLOTH });
add({ shape: { tube: [{ p: [0, 0, 0], r: 2.0, wide: 0.3 }, { p: [0.3, -4.6, 0], r: 1.5, wide: 0.3 }], opts: { K: 12, N: 8, ref: [1, 0, 0], cap: 0.4 } }, at: [hipX + 3.2, hipY - 0.6, 0], stage: 'collar', bone: 'body', line: 0.4, colour: CLOTH });
add({ shape: { tube: [{ p: [0, 0, 0], r: 2.0, wide: 0.3 }, { p: [-0.3, -4.0, 0], r: 1.5, wide: 0.3 }], opts: { K: 12, N: 8, ref: [1, 0, 0], cap: 0.4 } }, at: [hipX - 3.4, hipY - 0.6, 0], stage: 'collar', bone: 'body', line: 0.4, colour: CLOTH });

// ---- the arms: long and heavy, a round shoulder with a spike, the forearm held forward, the hand open with long claws ----
const R = 1.75, elbow = 5.6, fore = 5.8, shoulderZ = chestR * chestWide + 0.9;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0], shoulder[1], sd * shoulderZ];
  add({ shape: { ball: [R * 1.65, R * 1.55, R * 1.6] }, at: [at[0], at[1] + 0.5, at[2]], stage: 'arms', bone: `arm${s}`, line: LINE, colour: SKIN });
  add({ shape: { drop: { r: 0.8, len: 3.0, sink: 0.5, wide: 0.85, dir: [-0.2, 1, 0.55 * sd] } }, at: [at[0] - 0.2, at[1] + 2.4, at[2] + 0.9 * sd], stage: 'hair', bone: `arm${s}`, line: 0.35, colour: HORN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 1.1 }, { p: [0.3, -elbow * 0.45, 0], r: R * 1.35 }, { p: [0, -elbow, 0], r: R * 0.95 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `arm${s}`, line: LINE, colour: SKIN });
  add({ shape: { tube: [{ p: [0, -elbow, 0], r: R * 0.95 }, { p: [0, -elbow - fore * 0.35, 0], r: R * 1.2 }, { p: [0, -elbow - fore, 0], r: R * 0.8 }], opts: { K: 16, N: 12 } }, at, stage: 'arms', bone: `hand${s}`, line: LINE, colour: SKIN });
  // A spike on the elbow, pointing back.
  add({ shape: { drop: { r: 0.7, len: 2.4, sink: 0.5, wide: 0.85, dir: [-1, 0.2, 0] } }, at: [at[0] - R * 0.7, at[1] - elbow, at[2]], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: HORN });
  const hand: Vec3 = [at[0], at[1] - elbow - fore, at[2]];
  add({ shape: { ball: [R * 1.25, R * 1.15, R * 1.2] }, at: hand, stage: 'arms', bone: `hand${s}`, line: LINE, colour: SKIN });
  if (!(SWORD && s === 'R')) {
    for (const [dx, dz] of [[1.0, 0], [0.5, 1.2], [0.5, -1.2], [-0.4, 0.6 * sd]] as const) {
      add({ shape: { drop: { r: 0.6, len: 3.6, sink: 0.6, wide: 0.85, dir: [dx * 0.6, -1, dz * 0.5] } }, at: [hand[0] + dx, hand[1] - 0.8, hand[2] + dz], stage: 'hair', bone: `hand${s}`, line: 0.35, colour: HORN });
    }
  }
  pivots[`arm${s}`] = at;
}

// ---- the burning sword in the right hand: a dark grip and guard, a broad glowing blade. At rest it points forward and a little
// down; the pose holds the forearm forward (`arms.free`), which raises it. The flames themselves would be an effect, not the model. ----
if (SWORD) {
  const hand: Vec3 = [shoulder[0], shoulder[1] - elbow - fore, shoulderZ], a = -0.3, d: Vec3 = [Math.cos(a), Math.sin(a), 0], n: Vec3 = [-d[1], d[0], 0];
  const on = (along: number, up = 0): [number, number, number] => [d[0] * along + n[0] * up, d[1] * along + n[1] * up, 0];
  add({ shape: { tube: [{ p: on(-2.6), r: 0.75 }, { p: on(2.4), r: 0.65 }], opts: { K: 10, N: 6 } }, at: hand, stage: 'weapon', bone: 'handR', line: 0.4, colour: DARK });
  add({ shape: { ball: [0.95, 0.95, 0.95] }, at: [hand[0] + on(-3.0)[0], hand[1] + on(-3.0)[1], hand[2]], stage: 'weapon', bone: 'handR', line: 0.4, colour: HORN });
  add({ shape: { tube: [{ p: on(2.8, -3.0), r: 0.5 }, { p: on(2.5, 0), r: 0.85 }, { p: on(2.8, 3.0), r: 0.5 }], opts: { K: 10, N: 10 } }, at: hand, stage: 'weapon', bone: 'handR', line: 0.4, colour: HORN });
  // The blade: flat (thin across z), widening a little toward the last third, then a point.
  const blade: TubePoint[] = [{ p: on(3.0), r: 1.3, wide: 0.24 }, { p: on(9), r: 1.45, wide: 0.22 }, { p: on(16), r: 1.75, wide: 0.2 }, { p: on(20), r: 1.2, wide: 0.22 }, { p: on(22.5), r: 0.3, wide: 0.6 }];
  add({ shape: { tube: blade, opts: { K: 14, N: 30, ref: [0, 0, 1], cap: 0.4 } }, at: hand, stage: 'weapon', bone: 'handR', line: 0, colour: FIRE, glow: true });
  const core: TubePoint[] = [{ p: on(3.4), r: 0.5, wide: 0.9 }, { p: on(12), r: 0.55, wide: 0.9 }, { p: on(19.5), r: 0.35, wide: 0.9 }];
  add({ shape: { tube: core, opts: { K: 10, N: 16, ref: [0, 0, 1], cap: 0.6 } }, at: hand, stage: 'weapon', bone: 'handR', line: 0, colour: FIRE_CORE, glow: true });
}

// ---- the wings: a bat's (the Imp's construction, larger). Each is drawn flat in its own plane (`s` along the span from the root on
// the shoulder blade, `h` up in the plane) and stood on the back: out to the side and up, the top leaning back. Half folded at rest;
// a slow beat. ----
if (WINGS) {
  const WEB = 0.38, WING = 4.4;
  const OUTLINE: readonly (readonly [number, number, number])[] = [
    [0, 0.2, -0.9], [0.7, 0.6, -0.65], [1.4, 1.05, -1.1], [1.9, 1.4, -1.75], [2.15, 1.55, -2.05], [2.45, 1.7, -1.3], [2.95, 1.65, -0.5],
    [3.5, 1.5, -0.8], [3.9, 1.35, -1.45], [4.15, 1.3, -0.6], [4.6, 1.15, 0.3], [5.0, 1.36, 0.64],
  ];
  const WRIST: readonly [number, number] = [2.4, 1.6];
  const BONES_2D: readonly (readonly (readonly [number, number])[])[] = [
    [[0, -0.05], [1.2, 0.75], WRIST],
    [WRIST, [3.8, 1.3], [5.25, 1.0]],
    [WRIST, [3.3, 0.5], [3.95, -1.6]],
    [WRIST, [2.35, 0.2], [2.15, -2.2]],
  ];
  for (const sd of [1, -1]) {
    const S = unit([-0.6, 0.35, 0.72 * sd]);
    const lean: Vec3 = [-0.2, 0.97, 0], k = lean[0] * S[0] + lean[1] * S[1] + lean[2] * S[2];
    const U = unit([lean[0] - k * S[0], lean[1] - k * S[1], lean[2] - k * S[2]]);
    const face: Vec3 = [S[1] * U[2] - S[2] * U[1], S[2] * U[0] - S[0] * U[2], S[0] * U[1] - S[1] * U[0]];
    const on = (s: number, h: number): [number, number, number] => [(S[0] * s + U[0] * h) * WING, (S[1] * s + U[1] * h) * WING, (S[2] * s + U[2] * h) * WING];
    const root: Vec3 = [shoulder[0] - 3.4, shoulder[1] - 0.4, sd * 2.6];
    const web = add({
      shape: { tube: OUTLINE.map(([s, top, bottom]): TubePoint => { const r = (top - bottom) / 2 * WING; return { p: on(s, (top + bottom) / 2), r, wide: Math.min(1, WEB / r) }; }), opts: { K: 12, N: 66, ref: face, cap: 0.5, pow: 0.4 } },
      at: root, stage: 'hair', bone: 'body', line: 0.4, colour: SHADE,
      bend: { sway: 0.3, hinge: 0.3, flutter: { rate: 0.45, angle: 0.16, axis: [sd * U[0], sd * U[1], sd * U[2]] } },
    });
    BONES_2D.forEach((line, i) => {
      const r = i === 0 ? 0.95 : 0.6;
      add({ shape: { tube: line.map(([s, h], j): TubePoint => ({ p: on(s, h), r: j === 2 && i > 0 ? 0.4 : r })), opts: { K: 8, N: 12, cap: 0.6 } }, at: root, stage: 'hair', bone: 'body', line: 0.35, colour: BACK, bend: { with: web } });
    });
    const claw = on(WRIST[0], WRIST[1]);
    add({ shape: { drop: { r: 0.7, len: 3.2, sink: 0.4, wide: 0.9, dir: [U[0] + 0.3 * S[0], U[1] + 0.3 * S[1], U[2] + 0.3 * S[2]] } }, at: [root[0] + claw[0], root[1] + claw[1], root[2] + claw[2]], stage: 'hair', bone: 'body', line: 0.3, colour: HORN, bend: { with: web } });
  }
}

// ---- the tail: out of the back of the hips, a low bow behind the legs, curling up to a barbed spade; it wags ----
add({
  shape: { tube: [
    { p: [0, 0, 0], r: 1.5 }, { p: [-2.4, -3.2, 0], r: 1.2 }, { p: [-4.6, -6.2, 0], r: 0.95 }, { p: [-7.2, -7.4, 0], r: 0.8 }, { p: [-9.4, -6.0, 0], r: 0.7 }, { p: [-10.0, -3.6, 0], r: 0.65 },
    { p: [-10.0, -2.6, 0], r: 2.0, wide: 0.5 }, { p: [-9.8, -1.0, 0], r: 1.2, wide: 0.7 }, { p: [-9.6, 0.8, 0], r: 0.5, wide: 1 },
  ], opts: { K: 12, N: 56, cap: 0.5 } },
  at: [hipX - 2.6, hipY + 0.4, 0], stage: 'hair', bone: 'body', line: 0.45, colour: SKIN, bend: { sway: 1, wag: 0.6 },
});

// ---- the head: low and forward between the shoulders, a long heavy jaw ----
const HEAD: Vec3 = [3.3, 3.1, 3.1], HEAD_POW = 0.85;
const head = (x: number, y: number, z = 0): Vec3 => [7.4 + x, 26.4 + y, z];
/** A point of the head's surface: `turn` rad round from the front towards the side `sd`, `y` above the head's middle, moved out by the share `out` (negative: sunk). */
const onHead = (turn: number, y: number, sd: number, out = 0): Vec3 => {
  const h = Math.sqrt(Math.max(0, 1 - (y / HEAD[1]) ** 2)) * (1 + out), pw = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), HEAD_POW);
  return head(HEAD[0] * h * pw(Math.cos(turn)), y * (1 + out), sd * HEAD[2] * h * pw(Math.sin(turn)));
};
pivots.head = [4.6, 25.2, 0];
add({ shape: { ball: [HEAD[0], HEAD[1], HEAD[2]], pow: HEAD_POW }, at: head(0, 0), stage: 'head', bone: 'head', line: LINE, colour: SKIN });
// The muzzle and the lower jaw.
add({ shape: { ball: [2.4, 1.5, 2.1], pow: 0.85 }, at: head(2.3, -0.6), stage: 'hair', bone: 'head', line: 0.45, colour: SKIN });
const jaw = { x: 1.9, y: -2.0, rx: 2.6, rz: 2.5 };
add({ shape: { ball: [jaw.rx, 1.5, jaw.rz], pow: 0.85 }, at: head(jaw.x, jaw.y), stage: 'hair', bone: 'head', line: 0.45, colour: SKIN });
// A pointed beard of dark fur under the chin.
add({ shape: { drop: { r: 0.9, len: 3.2, sink: 0.6, wide: 0.7, dir: [0.25, -1, 0] } }, at: head(jaw.x + 1.4, jaw.y - 0.9), stage: 'hair', bone: 'head', line: 0.35, colour: FUR });
// The mouth: a dark line round the front of the jaw, and two rows of fangs.
const mouth = (a: number, out: number): Vec3 => head(jaw.x + (jaw.rx + out) * Math.cos(a), jaw.y + 0.5 - 0.3 * (a * a), (jaw.rz + out) * Math.sin(a));
add({
  shape: { tube: [-1.2, -0.6, 0, 0.6, 1.2].map((a): TubePoint => { const q = mouth(a, -0.3); return { p: [q[0], q[1], q[2]], r: 0.55 }; }), opts: { K: 8, N: 20, ref: [0, 1, 0], cap: 0.5 } },
  stage: 'spikes', bone: 'head', line: 0, colour: DARK,
});
pivots.hat = head(-1.4, 1.6);
for (const sd of [1, -1]) {
  // The horns: out of the temples to the sides, then sweeping up, the tips turning forward and in.
  add({
    shape: { tube: [
      { p: [0, 0, 0], r: 1.3 }, { p: [-0.4, 0.5, 2.8 * sd], r: 1.4 }, { p: [-1.0, 1.6, 5.4 * sd], r: 1.3 }, { p: [-1.4, 3.6, 7.2 * sd], r: 1.1 },
      { p: [-1.0, 5.8, 7.6 * sd], r: 0.8 }, { p: [0.2, 7.4, 6.8 * sd], r: 0.5 }, { p: [1.6, 8.2, 5.8 * sd], r: 0.25 },
    ], opts: { K: 14, N: 40, cap: 0.7 } },
    at: head(-1.7, 2.1, sd * 1.9), stage: 'spikes', bone: 'hat', line: 0.45, colour: HORN,
  });
  // Pointed ears below the horns.
  add({ shape: { drop: { r: 0.8, len: 3.0, sink: 0.6, wide: 0.5, dir: [-0.7, 0.25, sd] } }, at: head(-1.0, -0.3, sd * 2.7), stage: 'hair', bone: 'head', line: 0.35, colour: SKIN });
  // Fangs: a long lower one at each corner, a small upper one inside it.
  add({ shape: { drop: { r: 0.6, len: 2.4, sink: 0.4, wide: 0.9, dir: [0.1, 1, -0.1 * sd] } }, at: mouth(sd * 0.85, -0.05), stage: 'spikes', bone: 'head', line: 0.25, colour: BONE });
  add({ shape: { drop: { r: 0.45, len: 1.5, sink: 0.3, wide: 0.9, dir: [0.1, -1, 0] } }, at: mouth(sd * 0.35, 0.05), stage: 'spikes', bone: 'head', line: 0.2, colour: BONE });
  // The eyes: glowing slits without pupils, slanted, sunk into the head; a dark brow ridge over each.
  const eye = [onHead(0.25, 0.5, sd, -0.13), onHead(0.62, 1.0, sd, -0.13), onHead(1.0, 1.55, sd, -0.13)];
  add({ shape: { tube: eye.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.8 : 0.55 })), opts: { K: 10, N: 14, cap: 0.8 } }, stage: 'spikes', bone: 'head', line: 0, colour: DEMON_EYE, glow: true });
  const brow = [onHead(0.12, 1.2, sd, -0.05), onHead(0.6, 1.75, sd, -0.05), onHead(1.05, 2.2, sd, -0.05)];
  add({ shape: { tube: brow.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.7 : 0.55 })), opts: { K: 8, N: 12, cap: 0.7 } }, stage: 'spikes', bone: 'head', line: 0, colour: BACK });
}

export const demon: TubeDesc = {
  // The head's top is at y 29.5 (32.03 game px at size 1).
  name: 'Demon', size: fitSize(HUMANS, 32.03), outline: 0x222222, pieces, pivots,
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: elbow + fore, radius: R, elbow, free: 0.8 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false, knee: -1 }, { upper: 'leg2', lower: 'leg3', front: false, knee: -1 }],
  footprint: [5.0, 5.0],
};
