// The demon's rigid parts (#379): every piece of the approved spike's description that keeps its shape, built once at load into
// rest-pose arrays and placed each frame by its bone (shape.ts). The shapes and their numbers are the spike's (its tubes, balls and
// drops, made by the shared geometry of `models/tubes.ts`), split by the demon's own bones. The tail's skin, the wings' bones and the
// webbing are not here: shape.ts sweeps them anew each frame.
//
// A towering, top-heavy demon standing upright: thick bent legs on three-clawed feet, a trunk from narrow hips to a very broad chest,
// long arms with flat clawed hands, a small head between swept horns, jagged plates on the shoulders, the right forearm and the hips.
import type { V3 } from '../built';
import { STAGES, type Stage } from '../models/bones';
import type { Mesh3 } from '../models/part';
import { ball, tube, type TubePoint } from '../models/tubes';
import { DEMON_PAINT, skinUv } from './paint';
import { BONE, PIVOT, RIG, SLOT, rotAxis } from './skeleton';

export interface Part {
  /** The frame that places it: a bone, or a derived frame (`SLOT`). */
  bone: number; stage: number; /** Outline width, builder units; 0: none. */ line: number; /** 0 pulsing, 1 steady, 2 face. */ glow: 0 | 1 | 2;
  /** Relative to the frame's pivot in the rest pose. */
  position: Float32Array; normal: Float32Array; uv: Float32Array; colour: Float32Array; index: Uint32Array;
  /** The part bends between two bones: each point is placed by `bone` and by this one and mixed by its weight (1: all this one's). */
  blend?: { bone: number; weight: Float32Array };
}

/**
 * The parts' tuning numbers; the pieces' own places and radii are the spike's description, further down.
 * - `colour`: the flat colours (the rock skin, the horns and the claws read the picture). `wingBone`: the wings' bones, swept in shape.ts.
 * - `line`: the outline widths, in the spike's px (`LINE_UNIT` turns them into builder units): `limb` the legs, the trunk, the hump,
 *   the arms, the feet and the head; `jaw` the jaw, the fur wrap and the horns; `palm` the palms and the flap; `plate` the plates,
 *   the spines and the chest muscles; `claw` the foot and wing claws, the fingers and the tail's plates; `nail` the fingers' claws.
 * - `hornBand`: the band of the picture whose glow is steady (horns and claws).
 * - `bend`: the heights between which the trunk goes over from the hips' frame to the chest's.
 * - `rings`: per kind of piece its points round and its rings along: what the cost is tuned by. A drop with a radius below
 *   `smallDrop` (a tooth, a finger's claw) takes `dropSmall`. The shared drop has 14 round and 18 along; these pieces are a few px
 *   across and there are 54 of them.
 */
export const DEMON_PARTS = {
  colour: { plate: 0x261b1d, fur: 0x35241f, tooth: 0x1c1213, black: 0x070506, eye: 0xffb02e, mouth: 0xff7a1a, wingBone: 0x2c2022 },
  line: { limb: 0.55, jaw: 0.45, palm: 0.4, plate: 0.35, claw: 0.3, nail: 0.25 },
  hornBand: 5,
  bend: [16.5, 24],
  rings: {
    thigh: [16, 14], shin: [14, 12], footBone: [12, 10], footClaw: [8, 8], trunk: [32, 28], wrap: [24, 6], flap: [12, 12], arm: [16, 12], palm: [14, 12], finger: [6, 2],
    wingClaw: [8, 14], grin: [8, 28], horn: [10, 40], eye: [10, 14], brow: [8, 12], drop: [8, 8], dropSmall: [6, 5],
  },
  smallDrop: 0.5,
} as const;
const Q = DEMON_PARTS, C = Q.colour, LN = Q.line, RG = Q.rings;
/** The wings' bones (the sweep in shape.ts paints them). */
export const WING_BONE = C.wingBone;
/** Builder units per unit of the spike's outline widths (they were px at its size 1). */
export const LINE_UNIT = 34.42 / 54;
const ZERO: V3 = [0, 0, 0];
/** A kind's ring counts as the shared tube's options. */
const rings = (r: readonly [number, number]): { K: number; N: number } => ({ K: r[0], N: r[1] });

interface Piece {
  bone: number; stage: Stage; line: number; at?: V3; /** Turned about z by this before it is placed (a leg bone's rest angle). */ turn?: number;
  /** The rock skin's band, or a flat colour, or a flat colour that glows with the face. */
  band?: number; flat?: number; hot?: number;
  /** The frame's pivot when the frame is not a bone (model frame for `at`). */
  origin?: V3;
  /** The trunk's share of the chest, per point by its height, or one share for the whole piece. */
  bend?: 'height' | number;
}

const parts: Part[] = [];
const uvOut: [number, number] = [0, 0];
/** The share of the chest's frame at the height `y` of the trunk; the rest is the hips'. */
const chestShare = (y: number): number => { const t = Math.max(0, Math.min(1, (y - Q.bend[0]) / (Q.bend[1] - Q.bend[0]))); return t * t * (3 - 2 * t); };

function add(m: Mesh3, o: Piece): void {
  const n = m.position.length / 3, c = Math.cos(o.turn ?? 0), s = Math.sin(o.turn ?? 0), at = o.at ?? ZERO;
  const org = o.origin ?? [PIVOT[o.bone * 3], PIVOT[o.bone * 3 + 1], PIVOT[o.bone * 3 + 2]];
  const position = new Float32Array(n * 3), normal = new Float32Array(n * 3), uv = new Float32Array(n * 2), colour = new Float32Array(n * 3);
  const weight = o.bend === undefined ? null : new Float32Array(n);
  const hex = o.flat ?? o.hot ?? 0xffffff, block = o.hot !== undefined ? DEMON_PAINT.hot : DEMON_PAINT.flat;
  for (let i = 0; i < n; i++) {
    const k = i * 3, x = m.position[k], y = m.position[k + 1], nx = m.normal[k], ny = m.normal[k + 1];
    const wy = x * s + y * c + at[1];
    position[k] = x * c - y * s + at[0] - org[0]; position[k + 1] = wy - org[1]; position[k + 2] = m.position[k + 2] + at[2] - org[2];
    normal[k] = nx * c - ny * s; normal[k + 1] = nx * s + ny * c; normal[k + 2] = m.normal[k + 2];
    if (o.band !== undefined) {
      // a tube: along it and round it; a ball (26 x 18 cells, no uv of its own): from pole to pole and round it, as the spike painted it
      if (m.uv) skinUv(o.band, m.uv[i * 2], m.uv[i * 2 + 1], uvOut); else skinUv(o.band, Math.floor(i / 27) / 18, (i % 27) / 26, uvOut);
    } else { uvOut[0] = (block.x + 4) / DEMON_PAINT.w; uvOut[1] = (block.y + 4) / DEMON_PAINT.h; }
    uv[i * 2] = uvOut[0]; uv[i * 2 + 1] = uvOut[1];
    colour[k] = (hex >> 16) / 255; colour[k + 1] = ((hex >> 8) & 255) / 255; colour[k + 2] = (hex & 255) / 255;
    if (weight) weight[i] = o.bend === 'height' ? chestShare(wy) : o.bend!;
  }
  parts.push({
    bone: o.bone, stage: STAGES.indexOf(o.stage), line: o.line * LINE_UNIT, glow: o.hot !== undefined ? 2 : o.band === Q.hornBand ? 1 : 0,
    position, normal, uv, colour, index: m.index, ...(weight ? { blend: { bone: BONE.chest, weight } } : {}),
  });
}
/**
 * A drop (a plate, a spine, a claw, a tooth): the shape of `models/tubes.ts`'s drop, thin where it is fixed, widest a third along, a
 * rounded tip; its foot at the origin, sunk by `sink`, pointing along `dir`. Its ring counts are `DEMON_PARTS.rings.drop` / `dropSmall`.
 */
function drop(r: number, len: number, sink: number, wide: number, dir: V3): Mesh3 {
  const m = tube([{ p: [0, -sink, 0], r: r * 0.4, wide }, { p: [0, len * 0.3 - sink, 0], r, wide }, { p: [0, len * 0.62 - sink, 0], r: r * 0.8, wide }, { p: [0, len * 0.9 - sink, 0], r: r * 0.3, wide }],
    { ...rings(r < Q.smallDrop ? RG.dropSmall : RG.drop), ref: [1, 0, 0], cap: 0.6 });
  // turned from straight up to `dir`
  const d = unit(dir), ax = d[2], az = -d[0], l = Math.hypot(ax, az);
  const T = l < 1e-9 ? rotAxis(0, 0, 1, d[1] > 0 ? 0 : Math.PI, new Float64Array(9)) : rotAxis(ax / l, 0, az / l, Math.acos(d[1]), new Float64Array(9));
  for (const arr of [m.position, m.normal]) for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2];
    arr[i] = T[0] * x + T[3] * y + T[6] * z; arr[i + 1] = T[1] * x + T[4] * y + T[7] * z; arr[i + 2] = T[2] * x + T[5] * y + T[8] * z;
  }
  return m;
}
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---- the legs: thick and bent like a beast's. A heavy thigh forward to the knee, the shin back to the hock, a short thick foot bone
// forward again to a broad foot with three claws ----
const hipX = RIG.hip[0], hipY = RIG.hip[1], legZ = RIG.legZ, stifle = RIG.stifle, hock = RIG.hock, ankle = [-0.2, 1.7] as const;
const down = (a: readonly [number, number], b: readonly [number, number]): { turn: number; len: number } => ({ turn: Math.atan2(b[0] - a[0], a[1] - b[1]), len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
const thigh = down(RIG.hip, stifle), shin = down(stifle, hock), cannon = down(hock, ankle);
for (const [sd, upper, lower, foot] of [[1, BONE.thighR, BONE.shinR, BONE.footR], [-1, BONE.thighL, BONE.shinL, BONE.footL]] as const) {
  const z = sd * legZ;
  add(tube([{ p: [0, 1.2, 0], r: 3.5 }, { p: [0.4, -thigh.len * 0.45, 0], r: 3.5 }, { p: [0, -thigh.len, 0], r: 2.3 }], rings(RG.thigh)), { at: [hipX, hipY, z], turn: thigh.turn, stage: 'legs', bone: upper, line: LN.limb, band: 2 });
  add(tube([{ p: [0, 0.6, 0], r: 2.2 }, { p: [0.5, -shin.len * 0.4, 0], r: 2.3 }, { p: [0, -shin.len, 0], r: 1.6 }], rings(RG.shin)), { at: [stifle[0], stifle[1], z], turn: shin.turn, stage: 'legs', bone: lower, line: LN.limb, band: 3 });
  // A plate over the knee.
  add(drop(1.3, 3.2, 0.8, 0.9, [1, 0.5, 0]), { at: [stifle[0] + 0.6, stifle[1] + 0.2, z], stage: 'hair', bone: upper, line: LN.plate, flat: C.plate });
  add(tube([{ p: [0, 0, 0], r: 1.6 }, { p: [0, -cannon.len * 0.6, 0], r: 1.35 }, { p: [0, -cannon.len, 0], r: 1.5 }], rings(RG.footBone)), { at: [hock[0], hock[1], z], turn: cannon.turn, stage: 'legs', bone: foot, line: LN.limb, band: 4 });
  // A spur behind the hock, the foot and its three claws.
  add(drop(0.9, 2.8, 0.5, 0.8, [-1, 0.3, 0]), { at: [hock[0] - 1.0, hock[1], z], stage: 'legs', bone: foot, line: LN.plate, flat: C.plate });
  add(ball(2.7, 1.4, 2.3), { at: [ankle[0] + 1.3, 1.35, z], stage: 'legs', bone: foot, line: LN.limb, flat: C.black });
  for (const dz of [-1.4, 0, 1.4]) {
    // The claws: painted like the horns (dark red, black, a glowing tip), with a real point.
    const dir: V3 = [1, -0.22, dz * 0.25], L = 3.4;
    add(tube([0, 0.35, 0.7, 1].map((k): TubePoint => ({ p: [dir[0] * L * k, dir[1] * L * k - 0.25 * k * k, dir[2] * L * k], r: 0.75 * (1 - k * k * k) + 0.03 })), { ...rings(RG.footClaw), cap: 1 }),
      { at: [ankle[0] + 2.9, 1.0, z + dz], stage: 'legs', bone: foot, line: LN.claw, band: Q.hornBand });
  }
}

// ---- the trunk: upright, from narrow hips to a very broad chest. It bends between the hips and the chest ----
const RINGS: readonly (readonly [number, number, number, number])[] = [[hipX - 0.2, hipY - 0.2, 3.3, 1.25], [0.6, hipY + 4.0, 3.0, 1.2], [1.6, 25.4, 4.9, 1.55]];
/** A point of the trunk's surface at height `y`, `turn` rad round from the front towards the side `sd`. */
const onTorso = (y: number, turn: number, sd: number, out = 0.1): V3 => {
  const i = y < RINGS[1][1] ? 0 : 1, a = RINGS[i], b = RINGS[i + 1], k = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1])));
  const cx = a[0] + (b[0] - a[0]) * k, r = a[2] + (b[2] - a[2]) * k + out, w = a[3] + (b[3] - a[3]) * k;
  return [cx + r * Math.cos(turn), y, sd * r * w * Math.sin(turn)];
};
const shoulder: V3 = [RIG.shoulder[0], RIG.shoulder[1], 0], chestR = RINGS[2][2];
add(tube(RINGS.map(([x, y, r, wide]): TubePoint => ({ p: [x, y], r, wide })), { ...rings(RG.trunk), ref: [0, 0, 1], cap: 0.75 }), { stage: 'body', bone: BONE.hips, line: LN.limb, band: 0, bend: 'height' });
// The chest muscles: two slabs on the front of the chest.
for (const sd of [1, -1]) add(ball(2.0, 2.4, 3.3), { at: [shoulder[0] + chestR * 0.7, shoulder[1] - 1.0, sd * 2.9], stage: 'body', bone: BONE.chest, line: LN.plate, band: 0 });
// The hump of muscle from the neck out to both shoulders.
add(ball(3.0, 2.3, 6.0), { at: [shoulder[0] - 1.0, shoulder[1] + 1.4, 0], stage: 'body', bone: BONE.chest, line: LN.limb, band: 0 });
// A row of spines down the back.
for (let i = 0; i < 5; i++) {
  const u = i / 4, y = shoulder[1] + 1.2 - u * 9, p = onTorso(Math.min(y, 25.4), Math.PI, 1, -0.3);
  add(drop(0.8, 3.0 - u * 1.0, 0.6, 0.8, [-1, 0.5, 0]), { at: [i === 0 ? shoulder[0] - 3.6 : p[0], y, 0], stage: 'hair', bone: BONE.hips, line: LN.plate, flat: C.plate, bend: chestShare(y) });
}
// The hips: a wrap of dark fur with a long flap in front, and jagged plates standing out round it.
add(tube([{ p: [hipX - 0.3, hipY - 1.8], r: 3.8, wide: 1.3 }, { p: [hipX, hipY + 1.4], r: 3.5, wide: 1.25 }], { ...rings(RG.wrap), ref: [0, 0, 1], cap: 0.3 }), { stage: 'collar', bone: BONE.hips, line: LN.jaw, flat: C.fur });
add(tube([{ p: [0, 0, 0], r: 2.2, wide: 0.3 }, { p: [0.4, -4.0, 0], r: 1.7, wide: 0.3 }, { p: [0.5, -8.0, 0], r: 0.7, wide: 0.5 }], { ...rings(RG.flap), ref: [1, 0, 0], cap: 0.4 }), { at: [hipX + 3.5, hipY - 0.4, 0], stage: 'collar', bone: BONE.hips, line: LN.palm, flat: C.fur });
for (const [turn, sd] of [[0.75, 1], [0.75, -1], [1.6, 1], [1.6, -1], [2.5, 1], [2.5, -1]] as const) {
  const c = Math.cos(turn), s = Math.sin(turn);
  add(drop(1.1, 3.6, 0.7, 0.6, [c * 0.8, -0.75, sd * s * 0.8]), { at: [hipX + 3.6 * c, hipY + 0.4, sd * 4.6 * s], stage: 'hair', bone: BONE.hips, line: LN.plate, flat: C.plate });
}

// ---- the arms: long and thick, a shoulder crowned with jagged plates, clawed hands ----
/** A finger's two joints: the knuckle and the second joint (relative to the wrist, rest pose) and the axis both curl about (towards the palm). */
export interface FingerRig { knuckle: V3; joint: V3; axis: V3 }
/** Per hand (0 the right, 1 the left) the four fingers from front to back, then the thumb. */
export const HANDS: FingerRig[][] = [[], []];
const R = 1.55, elbow = RIG.elbow, fore = RIG.fore;
for (const [sd, arm, forearm, handBone, side] of [[1, BONE.armR, BONE.foreR, BONE.handR, 0], [-1, BONE.armL, BONE.foreL, BONE.handL, 1]] as const) {
  const at: V3 = [shoulder[0], shoulder[1], sd * RIG.shoulderZ];
  add(ball(R * 1.7, R * 1.6, R * 1.65), { at: [at[0], at[1] + 0.5, at[2]], stage: 'arms', bone: arm, line: LN.limb, band: 1 });
  for (const [dx, dz, len] of [[-0.6, 0.6, 4.0], [1.0, 1.4, 3.0], [-1.8, 1.6, 3.0]] as const) {
    add(drop(1.0, len, 0.6, 0.7, [dx * 0.25, 1, 0.5 * sd]), { at: [at[0] + dx, at[1] + 2.6, at[2] + dz * sd], stage: 'hair', bone: arm, line: LN.plate, flat: C.plate });
  }
  add(tube([{ p: [0, 0, 0], r: R * 1.15 }, { p: [0.3, -elbow * 0.45, 0], r: R * 1.3 }, { p: [0, -elbow, 0], r: R * 1.0 }], rings(RG.arm)), { at, stage: 'arms', bone: arm, line: LN.limb, band: 1 });
  add(tube([{ p: [0, -elbow, 0], r: R * 1.0 }, { p: [0, -elbow - fore * 0.35, 0], r: R * 1.15 }, { p: [0, -elbow - fore, 0], r: R * 0.7 }], rings(RG.arm)), { at, stage: 'arms', bone: forearm, line: LN.limb, band: 1 });
  // The right forearm: a crest of jagged plates down its outer side. The left: one spike on the elbow.
  if (sd > 0) {
    for (let i = 0; i < 5; i++) add(drop(1.0, 3.8 - i * 0.35, 0.6, 0.6, [-0.7, 0.45, 0.55]), { at: [at[0] - R * 0.6, at[1] - elbow - 0.2 - i * 1.25, at[2] + R * 0.6], stage: 'hair', bone: forearm, line: LN.plate, flat: C.plate });
  } else add(drop(0.8, 2.8, 0.5, 0.85, [-1, 0.2, 0]), { at: [at[0] - R * 0.7, at[1] - elbow, at[2]], stage: 'hair', bone: forearm, line: LN.plate, flat: C.plate });
  // The hand: a flat palm turned in towards the body and a little back, four fingers of two joints in a row from front to back, each
  // curling towards the palm's side and ending in a claw, and a thumb in front. Each joint is its own rigid piece, so the fingers curl.
  const hand: V3 = [at[0], at[1] - elbow - fore, at[2]];
  const TURN = RIG.palmTurn, row: V3 = [Math.cos(TURN), 0, -sd * Math.sin(TURN)], inw: V3 = [-Math.sin(TURN), 0, -sd * Math.cos(TURN)];
  const off = (a: number, y: number, c: number): V3 => [row[0] * a + inw[0] * c, y, row[2] * a + inw[2] * c];
  add(tube([{ p: off(0, 0.9, 0), r: 1.1, wide: 0.75 }, { p: off(0.1, -1.0, 0), r: 1.55, wide: 0.48 }, { p: off(0.1, -2.5, 0.1), r: 1.5, wide: 0.42 }], { ...rings(RG.palm), ref: inw, cap: 0.4 }), { at: hand, stage: 'arms', bone: handBone, line: LN.palm, band: 1 });
  const finger = (f: number, p0: V3, p1: V3, p2: V3, r: readonly [number, number, number], claw: { r: number; len: number; dir: V3 }): void => {
    const a = SLOT.finger + side * 10 + f * 2;
    add(tube([{ p: p0, r: r[0] }, { p: p1, r: r[1] }], { ...rings(RG.finger), cap: 0.6 }), { origin: p0, stage: 'arms', bone: a, line: LN.claw, band: 1 });
    add(tube([{ p: p1, r: r[1] }, { p: p2, r: r[2] }], { ...rings(RG.finger), cap: 0.6 }), { origin: p1, stage: 'arms', bone: a + 1, line: LN.claw, band: 1 });
    add(drop(claw.r, claw.len, 0.4, 0.9, claw.dir), { at: p2, origin: p1, stage: 'hair', bone: a + 1, line: LN.nail, flat: C.tooth });
    HANDS[side].push({ knuckle: p0, joint: p1, axis: unit(cross([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], inw)) });
  };
  ([[1.1, 0.92, 0], [0.37, 1.08, 0.05], [-0.37, 1.0, 0.05], [-1.08, 0.8, 0]] as const).forEach(([a, k, c0], f) => {
    finger(f, off(a, -2.5, 0.1 + c0), off(a * 1.08, -2.5 - 1.7 * k, 0.3 + c0), off(a * 1.1, -2.5 - 3.0 * k, 0.95 + c0), [0.46, 0.42, 0.33], { r: 0.3, len: 1.5, dir: [inw[0] * 0.6, -1, inw[2] * 0.6] });
  });
  finger(4, off(1.35, -0.6, 0.1), off(2.2, -1.6, 0.45), off(2.45, -2.7, 0.9), [0.55, 0.46, 0.36], { r: 0.32, len: 1.4, dir: [row[0] * 0.2 + inw[0] * 0.6, -1, row[2] * 0.2 + inw[2] * 0.6] });
}
/** The middle of a palm's inner side, relative to the wrist (the `hand` anchor). */
export const palm = (sd: number): V3 => [0.1 * Math.cos(RIG.palmTurn) - 0.75 * Math.sin(RIG.palmTurn), -1.0, -sd * (0.1 * Math.sin(RIG.palmTurn) + 0.75 * Math.cos(RIG.palmTurn))];

// ---- the wings' claws: one on each finger tip and the thumb's on the wrist, in the horns' colours. Each lies along +x of its frame ----
for (let side = 0; side < 2; side++) for (let i = 0; i < 5; i++) {
  const len = (i < 4 ? 0.55 : 0.6) * 6, r = i < 4 ? 0.36 : 0.42;
  add(tube([0, 0.4, 0.75, 1].map((u): TubePoint => ({ p: [len * u, 0, 0], r: r * (1 - u * u * u) + 0.03 })), { ...rings(RG.wingClaw), cap: 1 }), { origin: ZERO, stage: 'hair', bone: SLOT.wingClaw + side * 5 + i, line: LN.claw, band: Q.hornBand });
}

// ---- the tail: its line (x, y, z off its root, radius) and the plates that ride on it ----
export const TAIL: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 2.3], [-3.0, -4.0, 0.2, 2.0], [-6.5, -8.4, 1.2, 1.7], [-10.5, -11.4, 3.2, 1.35], [-15.0, -12.4, 5.6, 1.05], [-19.0, -11.4, 7.2, 0.8], [-21.2, -9.0, 6.6, 0.55], [-21.4, -6.6, 5.0, 0.28],
];
/** The tail's root, model frame. */
export const TAIL_AT: V3 = [hipX - 2.8, hipY + 0.4, 0];
for (let i = 1; i < 6; i++) add(drop(0.75, 2.6 - i * 0.25, 0.6, 0.7, [-0.5, 1, 0]), { at: [0, TAIL[i][3] * 0.7, 0], origin: ZERO, stage: 'hair', bone: SLOT.tailPlate + i - 1, line: LN.claw, flat: C.plate });

// ---- the head: small against the body, set between the shoulders; a heavy jaw that opens; the eyes and the mouth glow ----
const HEAD: V3 = [2.7, 2.8, 2.6], HEAD_POW = 0.85;
const head = (x: number, y: number, z = 0): V3 => [4.4 + x, 28.9 + y, z];
/** A point of the head's surface: `turn` rad round from the front towards the side `sd`, `y` above the head's middle, moved out by the share `out` (negative: sunk). */
const onHead = (turn: number, y: number, sd: number, out = 0): V3 => {
  const h = Math.sqrt(Math.max(0, 1 - (y / HEAD[1]) ** 2)) * (1 + out), pw = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), HEAD_POW);
  return head(HEAD[0] * h * pw(Math.cos(turn)), y * (1 + out), sd * HEAD[2] * h * pw(Math.sin(turn)));
};
add(ball(HEAD[0], HEAD[1], HEAD[2], HEAD_POW), { at: head(0, 0), stage: 'head', bone: BONE.head, line: LN.limb, band: 0 });
const jaw = { x: 1.3, y: -1.9, rx: 2.3, rz: 2.3 };
add(ball(jaw.rx, 1.4, jaw.rz, 0.85), { at: head(jaw.x, jaw.y), stage: 'hair', bone: BONE.jaw, line: LN.jaw, band: 0 });
// A pointed chin.
add(drop(1.0, 2.4, 0.6, 0.9, [0.35, -1, 0]), { at: head(jaw.x + 1.0, jaw.y - 0.8), stage: 'hair', bone: BONE.jaw, line: LN.plate, flat: C.plate });
// The mouth: a wide glowing grin round the front of the jaw, its corners drawn up, jagged dark teeth across it from above and below.
// The grin's upper half and the upper teeth stay on the head, the lower half and the lower teeth go with the jaw.
const mouth = (a: number, out: number, dy = 0): V3 => head(jaw.x + (jaw.rx + out) * Math.cos(a), jaw.y + 0.35 + 0.42 * (a * a) + dy, (jaw.rz + out) * Math.sin(a));
/** Between the jaws at the front, model frame (the `mouth` anchor). */
export const MOUTH_AT: V3 = mouth(0, 0);
/** Between the eyes on the head's front, and the breastbone, model frame (the `eyes` and `chest` anchors). */
export const EYES_AT: V3 = onHead(0, 0.8, 1), CHEST_AT: V3 = onTorso(24, 0, 1);
{
  const K = RG.grin[0], W = K + 1, grin = tube([-1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35].map((a): TubePoint => { const q = mouth(a, -0.3); return { p: [q[0], q[1], q[2]], r: 0.2 + 0.2 * Math.cos(a * 0.9) }; }), { ...rings(RG.grin), ref: [0, 1, 0], cap: 0.5 });
  const ringVerts = grin.position.length / 3 - 2;
  // a ring starts at the mouth's line and goes over the top first (`ref` is up): the first half of its cells is the upper lip
  const half = (upper: boolean): Uint32Array => {
    const keep: number[] = [];
    for (let t = 0; t < grin.index.length; t += 3) {
      let k: number = K;
      for (let e = 0; e < 3; e++) if (grin.index[t + e] < ringVerts) k = Math.min(k, grin.index[t + e] % W);
      if ((k < K / 2) === upper) keep.push(grin.index[t], grin.index[t + 1], grin.index[t + 2]);
    }
    return Uint32Array.from(keep);
  };
  add({ ...grin, index: half(true) }, { stage: 'spikes', bone: BONE.head, line: 0, hot: C.mouth });
  add({ ...grin, index: half(false) }, { stage: 'spikes', bone: BONE.jaw, line: 0, hot: C.mouth });
}
for (let i = -5; i <= 5; i++) {
  const a = i * 0.24, upper = (i & 1) === 0, q = mouth(a, 0.02, upper ? 0.6 : -0.6);
  add(drop(0.3, 1.05, 0.3, 0.8, [0, upper ? -1 : 1, 0]), { at: q, stage: 'spikes', bone: upper ? BONE.head : BONE.jaw, line: 0, flat: C.tooth });
}
for (const sd of [1, -1]) {
  // The horns: out of the sides of the head, sweeping wide outward, then bent forward, the tips turning up.
  const n = 16, horn: TubePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, r = 1.15 * (1 - u * u * u) + 0.03;
    horn.push({ p: [-0.6 * u + 9.5 * Math.pow(u, 1.7), 0.8 * u - 1.2 * Math.sin(Math.PI * u) + 4.0 * Math.pow(u, 3), sd * 6.5 * Math.sin(Math.min(1, u * 1.5) * Math.PI / 2)], r });
  }
  add(tube(horn, { ...rings(RG.horn), cap: 1 }), { at: head(-0.4, 1.3, sd * 1.5), stage: 'spikes', bone: BONE.head, line: LN.jaw, band: Q.hornBand });
  // The eyes: glowing slits without pupils, slanted, sunk into the head; a heavy dark brow ridge over each, low over the nose.
  const eye = [onHead(0.22, 0.25, sd, -0.1), onHead(0.6, 0.8, sd, -0.1), onHead(1.0, 1.35, sd, -0.1)];
  add(tube(eye.map((p, i): TubePoint => ({ p, r: i === 1 ? 0.75 : 0.45 })), { ...rings(RG.eye), cap: 0.8 }), { stage: 'spikes', bone: BONE.head, line: 0, hot: C.eye });
  const brow = [onHead(0.08, 0.85, sd, 0.02), onHead(0.6, 1.6, sd, 0.02), onHead(1.1, 2.1, sd, 0.02)];
  add(tube(brow.map((p, i): TubePoint => ({ p, r: i === 1 ? 0.75 : 0.55 })), { ...rings(RG.brow), cap: 0.7 }), { stage: 'spikes', bone: BONE.head, line: 0, flat: C.plate });
}

export const PARTS: readonly Part[] = parts;
