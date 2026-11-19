// The Knight (#356; the key `knight` is the Paladin's): full plate in turquoise steel with royal blue mail and trim. A closed helmet
// with a dark T-shaped visor slit and a low blue comb, pauldrons on the shoulders, a heater shield on the left arm; the sword is the
// pack's knight sword in the right hand. Page px (one wolf model px), the front along +x, the feet at y 0, z to the figure's right.
// The steel is the sprite's (npc_knight); the accent is not. The plate is polished steel (`metal`); the other parts are not, so they
// stay dark beside the mirror.

import type { Vec3 } from '../desc';
import { HEIGHT_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

/** The Knight's accent: a deep royal blue, dark against the pale steel in work light and in torch light. Not the sprite's (#356, the user's rework). */
export const KNIGHT_ACCENT = 0x1b3aa0;
const STEEL = 0x72d6ce, ACCENT = KNIGHT_ACCENT, DARK = 0x222222;

const pieces: TubePiece[] = [];
/** The Knight's pieces (the Ghost wears its body without the shield and the comb). */
export const KNIGHT_PIECES: readonly TubePiece[] = pieces;
const add = (p: TubePiece): void => { pieces.push(p); };

// ---- the legs: a plate thigh and a greave, a blue knee cop between them and a blue boot ----
const hipY = 7.0, kneeY = 3.7, legZ = 1.4;
const pivots: TubeDesc['pivots'] = { body: [0, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.5, 0], r: 1.25 }, { p: [0.1, kneeY - hipY, 0], r: 1.0 }], opts: { K: 14, N: 8 } }, at: [0, hipY, z], stage: 'legs', bone: upper, line: 0.4, colour: STEEL, metal: true });
  add({ shape: { tube: [{ p: [0.1, 0, 0], r: 1.0 }, { p: [0.05, -1.3, 0], r: 1.05 }, { p: [0, 1.0 - kneeY, 0], r: 0.85 }], opts: { K: 14, N: 8 } }, at: [0, kneeY, z], stage: 'legs', bone: lower, line: 0.4, colour: STEEL, metal: true });
  add({ shape: { ball: [1.1, 0.75, 1.15] }, at: [0.45, kneeY, z], stage: 'legs', bone: lower, line: 0.3, colour: ACCENT });
  add({ shape: { ball: [1.7, 0.85, 1.1] }, at: [0.6, 0.85, z], stage: 'legs', bone: lower, line: 0.4, colour: ACCENT });
  pivots[upper] = [0, hipY, z]; pivots[lower] = [0.1, kneeY, z];
}

// ---- the torso: the breastplate, narrow at the waist and broad at the chest ----
const T0 = 7.3, T2 = 11.5, chestR = 2.5, chestW = 1.3;
const torso: TubePoint[] = [{ p: [0, T0], r: 2.15, wide: 1.2 }, { p: [0.15, (T0 + T2) / 2], r: 2.15, wide: 1.25 }, { p: [0.4, T2], r: chestR, wide: chestW }];
add({ shape: { tube: torso, opts: { K: 24, N: 18, ref: [0, 0, 1], cap: 0.7 } }, stage: 'body', bone: 'body', line: 0.45, torso: true, colour: STEEL, metal: true });
// The mail skirt under the breastplate, and a belt round the waist, both in the accent.
add({ shape: { tube: [{ p: [0, 7.5], r: 2.35, wide: 1.2 }, { p: [0, 5.8], r: 2.7, wide: 1.18 }], opts: { K: 22, N: 6, ref: [0, 0, 1], cap: 0.2 } }, stage: 'body', bone: 'body', line: 0.45, colour: ACCENT });
add({ shape: { tube: [{ p: [0, 7.6], r: 2.42, wide: 1.2 }, { p: [0.03, 8.3], r: 2.36, wide: 1.2 }], opts: { K: 22, N: 4, ref: [0, 0, 1], cap: 0.12 } }, stage: 'collar', bone: 'body', line: 0.3, colour: ACCENT });

// ---- the arms: mail at the upper arm, a plate vambrace, a blue gauntlet, a pauldron over each shoulder ----
// The mail reaches to the elbow; the vambrace and the gauntlet hang on the hand bone, which turns there.
const R = 0.95, armLen = 5.4, elbow = 2.55, shoulderX = 0.3, shoulderY = 11.5, shoulderZ = chestR * chestW + 0.35 * R;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const z = sd * shoulderZ;
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 0.95 }, { p: [0, -elbow, 0], r: R * 0.9 }], opts: { K: 12, N: 6 } }, at: [shoulderX, shoulderY, z], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: ACCENT });
  add({ shape: { tube: [{ p: [0, -elbow + 0.1, 0], r: R * 1.1 }, { p: [0, -armLen, 0], r: R * 0.95 }], opts: { K: 12, N: 6, cap: 0.4 } }, at: [shoulderX, shoulderY, z], stage: 'arms', bone: `hand${s}`, line: 0.4, colour: STEEL, metal: true });
  add({ shape: { ball: [R * 1.1, R * 1.1, R * 1.1] }, at: [shoulderX, shoulderY - armLen, z], stage: 'arms', bone: `hand${s}`, line: 0.4, colour: ACCENT });
  // The pauldron: a flat cap, wider than the arm, that sits on the shoulder and reaches out to the side.
  add({ shape: { ball: [1.7, 1.05, 1.75] }, at: [shoulderX, shoulderY + 0.5, z + sd * 0.2], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: STEEL, metal: true });
  pivots[`arm${s}`] = [shoulderX, shoulderY, z];
}
// ---- the heater shield on the left arm, from the shoulder to the hip: a nearly flat top with a slight point in the middle, sides
// that run straight down the upper third and then curve in to the point at the bottom. It hangs on the arm bone, so it follows the arm
// in every pose. Its face looks out to the left and a little to the front (`SHIELD_TURN`), so the camera sees the field from the side it
// is carried on and a slanted face, not an edge, from the front and the back.
const SHIELD_TURN = 0.5;                              // rad: how far the face is turned from straight left towards the front
const SHIELD_TOP = shoulderY - 0.1, SHIELD_H = 5.6;   // the top edge at the corners, and the height down to the point
const SHIELD_W = 2.45, SHIELD_T = 0.5;                // half the width, and half the thickness in the middle of the dome
const SHIELD_PEAK = 0.3;                              // how far the top's middle stands over its corners
const SHIELD_MID: Vec3 = [shoulderX + 0.75, 0, -(shoulderZ + R + 1.05)];   // the centre line's x and z
const shieldN: Vec3 = [Math.sin(SHIELD_TURN), 0, -Math.cos(SHIELD_TURN)];   // the face's normal
const shieldU: Vec3 = [Math.cos(SHIELD_TURN), 0, Math.sin(SHIELD_TURN)];    // across the face, towards the front edge
/** Half the shield's width `v` of the way down (0 the top corners, 1 the point). */
const shieldHalf = (v: number): number => SHIELD_W * (v < 0.3 ? 1 : 1 - ((v - 0.3) / 0.7) ** 1.9);
/** A point of the shield's plane: `u` px across from the centre line (the front edge is +), `v` of the way down, `out` px off the face. */
const onShield = (u: number, v: number, out = 0): [number, number, number] => [
  SHIELD_MID[0] + shieldU[0] * u + shieldN[0] * out, SHIELD_TOP - v * SHIELD_H, SHIELD_MID[2] + shieldU[2] * u + shieldN[2] * out,
];
// The field: one tube down the middle whose radius is the half width, flattened to a lens (a slightly domed face on both sides). Its
// rounded top end is the slight point; it ends a little above the point, where the rim closes the outline.
const FIELD_END = 0.93;
const field: TubePoint[] = [];
for (let i = 0; i <= 10; i++) { const v = i / 10 * FIELD_END, r = shieldHalf(v); field.push({ p: onShield(0, v), r, wide: Math.min(1, SHIELD_T / r) }); }
const shieldFace: TubePiece = { shape: { tube: field, opts: { K: 20, N: 40, ref: shieldN, cap: SHIELD_PEAK / SHIELD_W } }, stage: 'arms', bone: 'armL', line: 0.45, colour: ACCENT };
// The raised rim: a round steel tube along the outline, from the top's middle down the rear side, round the point and back up.
const RIM = 0.42;
const half: [number, number][] = [[0, -SHIELD_PEAK / SHIELD_H], [0.5, -SHIELD_PEAK * 0.55 / SHIELD_H], [0.93, -0.01], [1, 0.03]];   // [u / half width, v]: the top edge
for (let i = 1; i <= 12; i++) { const v = 0.08 + i / 12 * 0.92; half.push([shieldHalf(v) / SHIELD_W, v]); }
const loop: TubePoint[] = [
  ...half.map(([u, v]): TubePoint => ({ p: onShield(-u * SHIELD_W, v), r: RIM })),
  ...half.slice(0, -1).reverse().map(([u, v]): TubePoint => ({ p: onShield(u * SHIELD_W, v), r: RIM })),
];
const shieldRim: TubePiece = { shape: { tube: loop, opts: { K: 8, N: 96, ref: shieldN, cap: 0.3 } }, stage: 'arms', bone: 'armL', line: 0.4, colour: STEEL, metal: true };
// No rivets: eight dark ones of 0.3 px were tried on the rim and broke it into specks at game zoom.
add(shieldFace); add(shieldRim);
/** The shield's pieces and the way its face looks (tests). */
export const KNIGHT_SHIELD = { face: shieldFace, rim: shieldRim, normal: shieldN };

// ---- the head: a closed, rounded helmet; the camera looks down on it, so the visor sits on the upper half of the face ----
const helm: Vec3 = [0.5, 14.25, 0], hr: Vec3 = [2.3, 2.35, 2.3];
pivots.head = [0.4, 12.4, 0];
add({ shape: { ball: [hr[0], hr[1], hr[2]] }, at: helm, stage: 'head', bone: 'head', line: 0.45, colour: STEEL, metal: true });
/** A point on the helmet (pushed out by `out`): `dy` above its middle, `a` rad round from the front. */
const onHelm = (dy: number, a: number, out: number): [number, number, number] => {
  const s = Math.sqrt(1 - (dy / hr[1]) ** 2);
  return [helm[0] + (hr[0] * s + out) * Math.cos(a), helm[1] + dy, (hr[2] * s + out) * Math.sin(a)];
};
// The visor slit: a dark T, a bar at the eyes round to the temples and a slit down from it to the chin.
const bar: TubePoint[] = [], down: TubePoint[] = [];
for (let i = 0; i <= 8; i++) bar.push({ p: onHelm(0.8, (i / 8 - 0.5) * 2.3, -0.2), r: 0.5 });
for (let i = 0; i <= 4; i++) down.push({ p: onHelm(0.8 - i / 4 * 2.2, 0, -0.2), r: 0.42 });
add({ shape: { tube: bar, opts: { K: 8, N: 24, ref: [0, 1, 0] } }, stage: 'spikes', bone: 'head', line: 0, colour: DARK });
add({ shape: { tube: down, opts: { K: 8, N: 12, ref: [0, 0, 1] } }, stage: 'spikes', bone: 'head', line: 0, colour: DARK });
// The comb: a low ridge in the accent over the crown, from above the visor to the nape.
const comb: TubePoint[] = [];
for (let i = 0; i <= 6; i++) { const a = 0.3 - i / 6 * 1.7; comb.push({ p: [helm[0] + hr[0] * Math.sin(a), helm[1] + hr[1] * Math.cos(a), 0], r: 0.4, wide: 0.9 }); }
add({ shape: { tube: comb, opts: { K: 8, N: 18, ref: [0, 0, 1] } }, stage: 'hair', bone: 'head', line: 0.3, colour: ACCENT });

export const npcKnight: TubeDesc = {
  name: 'Knight', size: fitSize(HEIGHT_FACTOR.knight, 18.021), outline: 0x222222, pieces, pivots,
  parents: { head: 'body', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: armLen, radius: R, elbow },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [2.3, 2.5],
};
