// The Shade (#359 round 2): a creature of smoke. The hard parts are a low head and two thin, bony arms with clawed hands; they float apart
// and nothing solid joins them (no torso, no neck, no shoulders, no legs). Between them hangs a body of smoke, which the effects draw
// from `spectre.smoke` (`fx/smoke.ts`). Page px (one wolf model px), the front along +x, z to the figure's right. Every piece is flat
// near-black and unlit-glowing (`glow`) with no hull. First values for the user's eye.

import type { Vec3 } from '../desc';
import type { Bone } from '../bones';
import { SMOKE_TONES, type SmokeSpec, type TubeDesc, type TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';
import type { TubePoint } from '../tubes';

const BLACK = 0x030205;
/** The drawing's size of the smoke page's try-out (0.84 of a page px); the hump is 17 px of the drawing high, so 14.28 game px. */
const SPIKE_SIZE = 0.84;

const pieces: TubePiece[] = [];
const add = (p: Omit<TubePiece, 'colour' | 'line' | 'glow'>): void => { pieces.push({ ...p, colour: BLACK, glow: true, line: 0 }); };
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

/** The claw: a tube of four points, thick at the base and a fine tip, bending 0.5 rad about [0, 0, -1] after each segment (the curl inward). */
const CLAW_R = [0.42, 0.34, 0.22, 0.03] as const, CLAW_SEGMENTS = [0.4, 0.34, 0.3] as const, CLAW_TURN = 0.5;
const clawPoints = (dir: Vec3, length: number): TubePoint[] => {
  const pts: TubePoint[] = [{ p: [0, 0, 0], r: CLAW_R[0] }];
  let x = 0, y = 0, z = 0, [dx, dy, dz] = dir;
  const c = Math.cos(-CLAW_TURN), s = Math.sin(-CLAW_TURN);   // about the axis [0, 0, -1]: z turned by -0.5
  CLAW_SEGMENTS.forEach((share, i) => {
    x += dx * share * length; y += dy * share * length; z += dz * share * length;
    pts.push({ p: [x, y, z], r: CLAW_R[i + 1] });
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
  });
  return pts;
};

const pivots: TubeDesc['pivots'] = {};

// ---- the head: a low ball and a small jaw; the eyes are the material's ----
pivots.head = [2.9, 14.6, 0];
add({ shape: { ball: [1.45, 1.6, 1.25] }, at: [2.9, 14.6, 0], stage: 'head', bone: 'head' });
add({ shape: { ball: [0.95, 0.85, 0.85] }, at: [3.65, 13.65, 0], stage: 'head', bone: 'head' });

// ---- the arms: a socket, an elbow, a wrist; a hand with four claws and a thumb ----
const CLAWS: readonly (readonly [number, number, number])[] = [[-1, 0.2, 3.4], [-0.33, 0.55, 4.0], [0.33, 0.55, 3.9], [1, 0.25, 3.2]];   // [dz, dx, length]
const THUMB_LENGTH = 2.6;
/** A claw's base lies off the wrist by `CLAW_BASE` (z times the claw's dz); its first direction is `[dx + CLAW_FORWARD, -1, CLAW_SPREAD * dz]`. */
const CLAW_BASE = { x: 0.1, y: -0.1, z: 0.7 } as const, CLAW_FORWARD = 0.25, CLAW_SPREAD = 0.7;
/** The thumb: its base off the wrist in z (times the side), its first direction. */
const THUMB_BASE_Z = 0.35, THUMB_DIR: Vec3 = [0.9, -0.5, -0.9];
/** One arm's joints (page px): the socket the arm bone turns about, the elbow the hand bone turns about, the wrist. `sd` is +1 for the right side, -1 for the left. */
const SOCKET: Vec3 = [0.9, 13.6, 4.2], UPPER_ARM: Vec3 = [-1.0, -3.8, 1.5], FOREARM: Vec3 = [2.4, -3.0, -0.6];
const joints = (sd: 1 | -1): { S: Vec3; E: Vec3; W: Vec3 } => {
  const S: Vec3 = [SOCKET[0], SOCKET[1], SOCKET[2] * sd], E = plus(S, [UPPER_ARM[0], UPPER_ARM[1], UPPER_ARM[2] * sd]);
  return { S, E, W: plus(E, [FOREARM[0], FOREARM[1], FOREARM[2] * sd]) };
};
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
/** The smoke the hard parts carry (a point on a bone, its radius, its share of the wisps and its rise factor): the head's, and per arm the socket, the middle of the upper arm, the elbow, the middle of the forearm and the wrist. */
const carried: SmokeSpec['on'][number][] = [{ bone: 'head', at: [2.3, 15.0, 0], r: 1.5, weight: 2, rise: 1.6 }];
const ARM_SMOKE = { weight: 0.25, rise: 0.8 }, JOINT_R = 0.45, SOCKET_R = 1.5;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const armBone = `arm${s}` as Bone, handBone = `hand${s}` as Bone;
  const { S, E, W } = joints(sd);
  pivots[armBone] = S; pivots[handBone] = E;
  carried.push(
    { bone: armBone, at: S, r: SOCKET_R, ...ARM_SMOKE }, { bone: armBone, at: mid(S, E), r: JOINT_R, ...ARM_SMOKE }, { bone: armBone, at: E, r: JOINT_R, ...ARM_SMOKE },
    { bone: handBone, at: mid(E, W), r: JOINT_R, ...ARM_SMOKE }, { bone: handBone, at: W, r: JOINT_R, ...ARM_SMOKE },
  );
  const rel = (from: Vec3, to: Vec3): Vec3 => minus(to, from);
  add({ shape: { ball: [0.6, 0.6, 0.6] }, at: S, stage: 'arms', bone: armBone });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 0.5 }, { p: rel(S, E), r: 0.42 }], opts: { K: 8, N: 8 } }, at: S, stage: 'arms', bone: armBone });
  add({ shape: { ball: [0.6, 0.6, 0.6] }, at: E, stage: 'arms', bone: handBone });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 0.45 }, { p: rel(E, W), r: 0.4 }], opts: { K: 8, N: 8 } }, at: E, stage: 'arms', bone: handBone });
  add({ shape: { ball: [0.65, 0.55, 0.85] }, at: W, stage: 'arms', bone: handBone });
  for (const [dzR, dx, length] of CLAWS) {
    const dz = dzR * sd;   // the left hand is the right one mirrored in z
    add({ shape: { tube: clawPoints(norm([dx + CLAW_FORWARD, -1, CLAW_SPREAD * dz]), length), opts: { K: 8, N: 12 } }, at: plus(W, [CLAW_BASE.x, CLAW_BASE.y, CLAW_BASE.z * dz]), stage: 'arms', bone: handBone });
  }
  add({ shape: { tube: clawPoints(norm([THUMB_DIR[0], THUMB_DIR[1], THUMB_DIR[2] * sd]), THUMB_LENGTH), opts: { K: 8, N: 12 } }, at: plus(W, [0, 0, -THUMB_BASE_Z * sd]), stage: 'arms', bone: handBone });
}

export const shade: TubeDesc = {
  name: 'Shade', size: SPIKE_SIZE / PAGE_TO_GAME, outline: 0x222222, pieces, pivots,
  parents: { handR: 'armR', handL: 'armL' },
  stance: 'two', legs: [],
  footprint: [2.0, 4.2],
  float: true, apart: true, swipe: true,
  spectre: {
    // Two very small, round, pale white beads; no ring ("dead", not glowing blue).
    eyes: { y: 14.82, z: 0.5, front: 3.6, half: [0.22, 0.22], slant: 0, core: 0xe6ecf2, ring: 0x000000, strength: 1 },
    fog: true,   // goes in R5, when the smoke replaces it
    smoke: {
      line: [[1.0, 17.0, 0.4, 0.6], [0.9, 16.0, 1.5, 2.8], [0.5, 14.2, 2.0, 4.6], [0.3, 12.2, 1.6, 2.8], [0.0, 10.2, 1.25, 1.8], [-0.4, 8.2, 1.15, 1.45],
        [-0.8, 6.2, 0.95, 1.05], [-0.6, 4.4, 0.8, 0.85], [0.2, 2.9, 0.62, 0.65], [0.7, 1.7, 0.42, 0.42], [0.2, 0.8, 0.14, 0.14]],
      tone: SMOKE_TONES.grey,
      on: carried,
    },
    swoosh: { colour: 0x000003, head: 0xb3e6ff },
  },
};
