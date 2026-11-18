// The robes (#356): the Necromancer, the Summoner and the Disciple, one build. A tall, thin robe that reaches the ground (no legs: it
// glides and its hem swings), long bell sleeves, and a hood that is a short tube lying along the line of sight: its open front end is
// the face, a dark hollow with two pale eyes inside the hood's edge, tilted up a little so the game's camera looks into it. The
// Necromancer and the Summoner differ in colour only; the Disciple is shorter and slighter, with a bigger hood for its size that comes
// down to the eyes, no tip, and sleeves that hide the hands. Page px (one wolf model px), the front along +x, the ground at y 0, z to
// the figure's right. The colours are the pack sprite's (necromancer) and the red set of the summoner's recolour.

import type { Vec3 } from '../desc';
import { HEIGHT_FACTOR, HUMAN_HEIGHT, type TubeDesc, type TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';
import type { TubePoint } from '../tubes';

const HOLLOW = 0x2a2a3a, EYE = 0xfdf7ed;
/** The height the measures below are drawn for (the Necromancer's), in game px. */
const FULL = 19;
/** The hood's line of sight: tilted up by this angle (rad), so the face shows under the camera's tilt. */
const TILT = 0.26;

export interface RobedLook {
  name: string;
  /** To the top of the hood (without its tip), game px. */
  height: number;
  /** The robe's colour, and the colour of its hem, its cuffs and the hood's edge. */
  robe: number; edge: number;
  /** 'deep': the whole face is a hollow inside the hood. 'low': the hood comes down to the eyes. */
  hood: 'deep' | 'low';
  /** The hood ends in a point that sways. */
  tip: boolean;
  /** Hands show under the sleeves (a figure that holds a staff). */
  hands: boolean;
}

export function robedDesc(v: RobedLook): TubeDesc {
  const pieces: TubePiece[] = [];
  const add = (p: TubePiece): void => { pieces.push(p); };
  // A shorter figure is slighter, but its hood shrinks less than its body: a small figure with a big hood.
  const k = v.height / FULL, wk = 0.4 + 0.6 * k, hk = 0.55 + 0.45 * k;
  const H = v.height / PAGE_TO_GAME;

  // ---- the hood: a tube along the line of sight `n`, from the narrow back to the open front ----
  const n: Vec3 = [Math.cos(TILT), Math.sin(TILT), 0], up: Vec3 = [-Math.sin(TILT), Math.cos(TILT), 0];
  const HOOD: readonly (readonly [number, number])[] = [[-2.5, 1.2], [-1.4, 2.2], [0, 2.65], [1.5, 2.6]];   // along `n`, the radius
  // The hood's highest point above its middle: the top of the widest ring or of the front ring.
  const top = Math.max(...HOOD.map(([s, r]) => s * n[1] + r * up[1])) * hk;
  const C: Vec3 = [0.5, H - top, 0];
  const hood = (s: number, u = 0, z = 0): Vec3 => [C[0] + (n[0] * s + up[0] * u) * hk, C[1] + (n[1] * s + up[1] * u) * hk, z * hk];
  const S = C[1] - 2.55 * hk;   // the shoulders

  // ---- the robe: flared at the hem, thin at the waist, a little wider at the shoulders. Painted: the hem's band, then the cloth ----
  const waist = 0.56 * S, hemTop = 1.3;
  const robe: TubePoint[] = [
    { p: [0, 0.42], r: 3.15 * wk, wide: 1.05 }, { p: [0, hemTop], r: 3.05 * wk, wide: 1.05 }, { p: [0, 0.3 * S], r: 2.45 * wk, wide: 1.08 },
    { p: [0, waist], r: 1.95 * wk, wide: 1.15 }, { p: [0.1, 0.82 * S], r: 1.85 * wk, wide: 1.25 }, { p: [0.15, S], r: 1.9 * wk, wide: 1.35 },
  ];
  add({
    shape: { tube: robe, opts: { K: 26, N: 30, ref: [0, 0, 1], cap: 0.12 } },
    stage: 'body', bone: 'body', line: 0.45, torso: true, robe: true,
    colour: (u) => (u < 1 / (robe.length - 1) ? v.edge : v.robe),
  });
  // The shoulders: a round cowl that closes the robe's top under the hood.
  add({ shape: { ball: [2.0 * wk, 1.25, 2.75 * wk], pow: 0.85 }, at: [0.15, S - 0.15, 0], stage: 'body', bone: 'body', line: 0.45, colour: v.robe });

  // ---- the sleeves: long, widening to the cuff; a hand under each, or none ----
  const R = 0.95 * wk, armLen = 0.46 * S, shoulderY = S - 0.35, shoulderZ = 1.9 * wk * 1.35 + 0.55 * R;
  const pivots: TubeDesc['pivots'] = { body: [0, waist, 0], head: [0.3, S + 0.3, 0] };
  for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
    const at: Vec3 = [0.15, shoulderY, sd * shoulderZ], end = v.hands ? armLen - 0.75 * R : armLen;
    add({ shape: { ball: [R * 1.15, R * 1.1, R * 1.1] }, at: [at[0], at[1] + 0.1, at[2]], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: v.robe });
    add({ shape: { tube: [{ p: [0, 0, 0], r: R }, { p: [0, -0.55 * end, 0], r: R * 1.1 }, { p: [0, -end, 0], r: R * 1.5 }], opts: { K: 14, N: 12, cap: 0.3 } }, at, stage: 'arms', bone: `arm${s}`, line: 0.4, colour: v.robe });
    add({ shape: { tube: [{ p: [0, 0.55 - end, 0], r: R * 1.55 }, { p: [0, -end, 0], r: R * 1.6 }], opts: { K: 14, N: 3, cap: 0.3 } }, at, stage: 'arms', bone: `arm${s}`, line: 0.3, colour: v.edge });
    if (v.hands) add({ shape: { ball: [R * 0.95, R * 0.95, R * 0.95] }, at: [at[0], at[1] - armLen, at[2]], stage: 'arms', bone: `hand${s}`, line: 0.35, colour: HOLLOW });
    pivots[`arm${s}`] = at;
  }

  // ---- the hood's pieces ----
  add({
    shape: { tube: HOOD.map(([s, r]) => ({ p: hood(s), r: r * hk, wide: 0.95 })), opts: { K: 24, N: 18, ref: [0, 0, 1], cap: 0.15 } },
    stage: 'head', bone: 'head', line: 0.45, colour: v.robe,
  });
  // The opening: the whole front for a deep hood; a low one leaves the part from the eyes down.
  const front = HOOD[HOOD.length - 1][0];
  // `mid`, `high`, `wide`: the opening's middle above the hood's axis and its half measures; `eye`: the eyes' height above the axis,
  // `apart`: their distance from the middle, `size`: their size (in a low slit, big eyes close together read as one eye with a pupil).
  const open = v.hood === 'deep' ? { mid: 0, high: 1.9, wide: 1.85, eye: -0.15, apart: 0.9, size: 1 } : { mid: -0.75, high: 1.2, wide: 1.8, eye: -0.4, apart: 1.05, size: 0.75 };
  // Above a low opening the hood's cloth closes the front: a brow that hangs over the eyes.
  if (v.hood === 'low') add({ shape: { ball: [0.75 * hk, 1.6 * hk, 2.25 * hk], turnZ: TILT }, at: hood(front - 0.05, 1.0), stage: 'collar', bone: 'head', line: 0.35, colour: v.robe });
  add({ shape: { ball: [0.5 * hk, open.high * hk, open.wide * hk], turnZ: TILT }, at: hood(front + 0.1, open.mid), stage: 'collar', bone: 'head', line: 0, colour: HOLLOW });
  // The hood's edge: a ring round the opening, standing a little proud of the hollow.
  const ring: TubePoint[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = i / 16 * 2 * Math.PI;
    ring.push({ p: hood(front + 0.3, open.mid + (open.high + 0.15) * Math.sin(a), (open.wide + 0.15) * Math.cos(a)), r: 0.42 * hk });
  }
  add({ shape: { tube: ring, opts: { K: 8, N: 48, ref: n, cap: 0 } }, stage: 'hair', bone: 'head', line: 0.3, colour: v.edge });
  // Two pale eyes in the hollow, low and wide apart.
  for (const sd of [1, -1]) add({ shape: { ball: [0.22 * hk, 0.5 * hk * open.size, 0.48 * hk * open.size], turnZ: TILT }, at: hood(front + 0.45, open.eye, sd * open.apart), stage: 'spikes', bone: 'head', line: 0, colour: EYE });
  // The point: from the back of the crown, up and back; it sways.
  if (v.tip) add({ shape: { drop: { r: 1.95 * hk, len: 5.8 * hk, sink: 1.3 * hk, wide: 0.85, dir: [-0.3, 0.95, 0] } }, at: hood(-0.4, 1.4), stage: 'hair', bone: 'head', line: 0.4, colour: v.robe, bend: { sway: 1 } });

  return {
    name: v.name, size: 1, outline: 0x222222, pieces, pivots,
    parents: { head: 'body' },
    // Sleeves of a natural length: they take a third of the lengthening the short-armed figures need in a blow.
    stance: 'two', arms: { length: armLen, radius: R, stretch: 0.3 }, robeTop: waist,
    // The staff a little smaller: at the card's size its head stands in front of the hood and hides the face from the side.
    weapon: 0.8,
    legs: [],
    footprint: [3.15 * wk, 3.3 * wk],
  };
}

export const necromancer = robedDesc({ name: 'Necromancer', height: HUMAN_HEIGHT * HEIGHT_FACTOR.robed, robe: 0x5f2d56, edge: 0x9f294e, hood: 'deep', tip: true, hands: true });
export const summoner = robedDesc({ name: 'Summoner', height: HUMAN_HEIGHT * HEIGHT_FACTOR.robed, robe: 0x62232f, edge: 0xda4e38, hood: 'deep', tip: true, hands: true });
// The Disciple's own colours: the red set one step darker than the Summoner's (the cloth is the Summoner's 0x62232f at 85 %, the edge is the pack's dark red).
export const disciple = robedDesc({ name: 'Disciple', height: HUMAN_HEIGHT * HEIGHT_FACTOR.robed, robe: 0x531d28, edge: 0x9f294e, hood: 'low', tip: false, hands: false });
