// The Chort (#356): a heavy horned demon, about as tall as a human, its bulk in the breadth. It stands crouched and leaning forward:
// goat legs (a thick thigh forward, the shin back to the hock, a thin cannon forward again to a hoof), a narrow waist under a heavy
// chest and round shoulders, the head low and forward between them, large pale horns sweeping out and up, long strong arms bent at
// the elbow with clawed hands, slanted glowing eyes under a heavy brow, two fangs, a tail with a spade.
// Page px (one wolf model px), the front along +x, the feet at y 0, z to the figure's right. The reds, the hoof and the bone colour are
// the pack sprite's (chort); the eyes are the demons' glow.

import type { Vec3 } from '../desc';
import { DEMON_EYE, HEIGHT_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

const SKIN = 0xda4e38, BACK = 0x9f294e, HOOF = 0x5f2d56, BONE = 0xfdf7ed, DARK = 0x222222;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): void => { pieces.push(p); };

// ---- the legs: the rest angles are in the geometry. The upper bone carries the thigh (forward to the stifle) and the shin (back to
// the hock); the joint the walk bends is the hock behind the hip (`knee: -1`: the cannon swings forward and lifts the hoof). The hoof
// stands under the hip. The thigh is thick and the cannon thin, so the zigzag reads standing still. ----
const hipX = 0, hipY = 9.4, legZ = 2.0;
const stifle: [number, number] = [2.7, 7.1], hock: [number, number] = [-2.6, 4.4], ankle: [number, number] = [hipX - 0.5, 0.9];
const down = (a: [number, number], b: [number, number]): { turn: number; len: number } => ({ turn: Math.atan2(b[0] - a[0], a[1] - b[1]), len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
const thigh = down([hipX, hipY], stifle), shin = down(stifle, hock), cannon = down(hock, ankle);
const pivots: TubeDesc['pivots'] = { body: [hipX, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.6, 0], r: 1.8 }, { p: [0, -thigh.len * 0.5, 0], r: 1.6 }, { p: [0, -thigh.len, 0], r: 1.05 }], opts: { K: 12, N: 8 } }, at: [hipX, hipY, z], turn: thigh.turn, stage: 'legs', bone: upper, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0.3, 0], r: 0.9 }, { p: [0, -shin.len * 0.5, 0], r: 0.82 }, { p: [0, -shin.len, 0], r: 0.62 }], opts: { K: 12, N: 8 } }, at: [stifle[0], stifle[1], z], turn: shin.turn, stage: 'legs', bone: upper, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 0.62 }, { p: [0, -cannon.len, 0], r: 0.52 }], opts: { K: 12, N: 8 } }, at: [hock[0], hock[1], z], turn: cannon.turn, stage: 'legs', bone: lower, line: 0.4, colour: SKIN });
  add({ shape: { ball: [1.3, 0.85, 1.0] }, at: [ankle[0] + 0.45, 0.85, z], stage: 'legs', bone: lower, line: 0.4, colour: HOOF });
  pivots[upper] = [hipX, hipY, z]; pivots[lower] = [hock[0], hock[1], z];
}

// ---- the torso: leaning forward from narrow hips and a narrow waist to a heavy chest. Painted: the back darker ----
const shoulder: Vec3 = [2.0, 14.3, 0], chestR = 2.5, chestWide = 1.45;
add({
  shape: { tube: [{ p: [hipX - 0.2, hipY - 0.1], r: 1.9, wide: 1.2 }, { p: [0.6, hipY + 2.1], r: 1.5, wide: 1.15 }, { p: [shoulder[0] - 0.1, shoulder[1] - 0.4], r: chestR, wide: chestWide }], opts: { K: 22, N: 16, ref: [0, 0, 1], cap: 0.75 } },
  stage: 'body', bone: 'body', line: 0.45, torso: true,
  // Round an upright tube `d` runs from the back (0) to the front (1).
  colour: (_u, d) => (d < 0.45 ? BACK : SKIN),
});
// The hump of muscle from the neck out to both shoulders: the head sits in front of it, not on top.
add({ shape: { ball: [1.6, 1.1, 3.0] }, at: [shoulder[0] - 0.6, shoulder[1] + 0.6, 0], stage: 'body', bone: 'body', line: 0.4, colour: BACK });

// ---- the arms: long and strong, a round shoulder on each. The upper arm hangs to the elbow; the forearm (on the hand bone, which
// turns about the elbow) is held forward by the pose (`arms.free`), the hand open with three long claws, so the claws are ready in
// front of the body and the arms do not hang over the legs. No weapon: the Chort claws and throws a bolt. ----
const R = 1.0, elbow = 3.1, fore = 3.3, shoulderZ = chestR * chestWide + 0.35;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0], shoulder[1], sd * shoulderZ];
  add({ shape: { ball: [R * 1.6, R * 1.5, R * 1.55] }, at: [at[0], at[1] + 0.3, at[2]], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 1.1 }, { p: [0.15, -elbow * 0.45, 0], r: R * 1.3 }, { p: [0, -elbow, 0], r: R * 0.95 }], opts: { K: 12, N: 8 } }, at, stage: 'arms', bone: `arm${s}`, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, -elbow, 0], r: R * 0.95 }, { p: [0, -elbow - fore * 0.35, 0], r: R * 1.12 }, { p: [0, -elbow - fore, 0], r: R * 0.75 }], opts: { K: 12, N: 8 } }, at, stage: 'arms', bone: `hand${s}`, line: 0.4, colour: SKIN });
  const hand: Vec3 = [at[0], at[1] - elbow - fore, at[2]];
  add({ shape: { ball: [R * 1.2, R * 1.1, R * 1.15] }, at: hand, stage: 'arms', bone: `hand${s}`, line: 0.4, colour: SKIN });
  for (const [dx, dz] of [[0.55, 0], [0.15, 0.7], [0.15, -0.7]] as const) {
    add({ shape: { drop: { r: 0.5, len: 2.5, sink: 0.4, wide: 0.9, dir: [dx * 0.7, -1, dz * 0.6] } }, at: [hand[0] + dx, hand[1] - 0.35, hand[2] + dz], stage: 'hair', bone: `hand${s}`, line: 0.3, colour: BONE });
  }
  pivots[`arm${s}`] = at;
}

// ---- the tail: out of the back of the hips, hanging in a short bow behind the legs and curling up to a flat spade; it wags.
// Short and low, because the camera looks down: a long tail stands over the head between the horns from the front, and hangs below
// the hooves like a third leg from behind. ----
add({
  shape: { tube: [
    { p: [0, 0, 0], r: 0.75 }, { p: [-1.2, -1.8, 0], r: 0.62 }, { p: [-2.2, -3.4, 0], r: 0.52 }, { p: [-3.3, -3.9, 0], r: 0.46 }, { p: [-4.1, -3.0, 0], r: 0.42 }, { p: [-4.3, -1.8, 0], r: 0.42 },
    { p: [-4.3, -1.3, 0], r: 1.2, wide: 0.6 }, { p: [-4.2, -0.4, 0], r: 0.7, wide: 0.8 }, { p: [-4.1, 0.5, 0], r: 0.36, wide: 1 },
  ], opts: { K: 10, N: 44, cap: 0.5 } },
  at: [hipX - 1.5, hipY + 0.2, 0], stage: 'hair', bone: 'body', line: 0.3, colour: SKIN, bend: { sway: 1, wag: 1 },
});

// ---- the head: low and forward between the shoulders, a heavy jaw under it ----
const HEAD: Vec3 = [2.0, 1.9, 1.95], HEAD_POW = 0.85;
const head = (x: number, y: number, z = 0): Vec3 => [4.2 + x, 15.4 + y, z];
/** A point of the head's surface: `turn` rad round from the front towards the side `sd`, `y` px above the head's middle, moved out by the share `out` (negative: sunk). */
const onHead = (turn: number, y: number, sd: number, out = 0): Vec3 => {
  const h = Math.sqrt(Math.max(0, 1 - (y / HEAD[1]) ** 2)) * (1 + out), pw = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), HEAD_POW);
  return head(HEAD[0] * h * pw(Math.cos(turn)), y * (1 + out), sd * HEAD[2] * h * pw(Math.sin(turn)));
};
pivots.head = [2.6, 14.7, 0];
add({ shape: { ball: [HEAD[0], HEAD[1], HEAD[2]], pow: HEAD_POW }, at: head(0, 0), stage: 'head', bone: 'head', line: 0.45, colour: SKIN });
const jaw = { x: 1.15, y: -0.9, rx: 1.5, rz: 1.6 };
add({ shape: { ball: [jaw.rx, 0.95, jaw.rz], pow: 0.85 }, at: head(jaw.x, jaw.y), stage: 'hair', bone: 'head', line: 0.35, colour: SKIN });
// The mouth: a dark line round the front of the jaw, its corners drawn down, and a fang standing up from each corner.
const mouth = (a: number, out: number): Vec3 => head(jaw.x + (jaw.rx + out) * Math.cos(a), jaw.y + 0.2 - 0.18 * (a * a), (jaw.rz + out) * Math.sin(a));
add({
  shape: { tube: [-1.1, -0.55, 0, 0.55, 1.1].map((a): TubePoint => { const q = mouth(a, -0.22); return { p: [q[0], q[1], q[2]], r: 0.36 }; }), opts: { K: 8, N: 16, ref: [0, 1, 0], cap: 0.5 } },
  stage: 'spikes', bone: 'head', line: 0, colour: DARK,
});
// The horns stand on the hat bone, so the crest varies them about their foot: out of the back of the temples to the sides, then
// sweeping up and back, clear of the face in a side view.
pivots.hat = head(-0.9, 1.0);
for (const sd of [1, -1]) {
  add({
    shape: { tube: [
      { p: [0, 0, 0], r: 0.95 }, { p: [-0.3, 0.5, 1.5 * sd], r: 0.88 }, { p: [-0.8, 1.4, 2.8 * sd], r: 0.74 }, { p: [-1.4, 2.8, 3.5 * sd], r: 0.58 },
      { p: [-1.9, 4.1, 3.5 * sd], r: 0.45 }, { p: [-2.0, 5.1, 3.1 * sd], r: 0.36 },
    ], opts: { K: 10, N: 26, cap: 0.7 } },
    at: head(-0.9, 1.0, sd * 1.1), stage: 'spikes', bone: 'hat', line: 0.3, colour: BONE,
  });
  add({ shape: { drop: { r: 0.4, len: 1.5, sink: 0.3, wide: 0.9, dir: [0.1, 1, -0.1 * sd] } }, at: mouth(sd * 0.75, -0.05), stage: 'spikes', bone: 'head', line: 0.2, colour: BONE });
  // The eyes: glowing slits without pupils, slanted (low by the nose, high at the temple), sunk into the head so only a narrow strip shows.
  // High on the head: the camera looks down on it.
  const eye = [onHead(0.2, 0.35, sd, -0.15), onHead(0.58, 0.7, sd, -0.15), onHead(0.98, 1.1, sd, -0.15)];
  add({ shape: { tube: eye.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.52 : 0.38 })), opts: { K: 10, N: 12, cap: 0.8 } }, stage: 'spikes', bone: 'head', line: 0, colour: DEMON_EYE, glow: true });
  // The brow: a dark ridge over each eye, slanting down to the middle.
  const brow = [onHead(0.1, 0.8, sd, -0.08), onHead(0.55, 1.15, sd, -0.08), onHead(1.0, 1.45, sd, -0.08)];
  add({ shape: { tube: brow.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.42 : 0.36 })), opts: { K: 8, N: 10, cap: 0.7 } }, stage: 'spikes', bone: 'head', line: 0, colour: BACK });
}

export const chort: TubeDesc = {
  name: 'Chort', size: fitSize(HEIGHT_FACTOR.chort, 18.781), outline: 0x222222, pieces, pivots,
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: elbow + fore, radius: R, elbow, free: 0.8 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false, knee: -1 }, { upper: 'leg2', lower: 'leg3', front: false, knee: -1 }],
  footprint: [2.6, 2.6],
};
