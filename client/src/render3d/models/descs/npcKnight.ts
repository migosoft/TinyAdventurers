// The Knight (#356; the key `knight` is the Paladin's): full plate in turquoise steel over dark mail. A closed helmet with a dark
// T-shaped visor slit and a low comb, pauldrons on the shoulders, a round shield on the left arm; the sword is the pack's knight
// sword in the right hand. Page px (one wolf model px), the front along +x, the feet at y 0, z to the figure's right. The colours
// are the sprite's (npc_knight). The plate is polished steel (`metal`); the dark parts are not, so they stay dark beside the mirror.

import type { Vec3 } from '../desc';
import type { TubeDesc, TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

const STEEL = 0x72d6ce, MAIL = 0x417089, DARK = 0x222222;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): void => { pieces.push(p); };

// ---- the legs: a plate thigh and a greave, a dark knee cop between them and a dark boot ----
const hipY = 7.0, kneeY = 3.7, legZ = 1.4;
const pivots: TubeDesc['pivots'] = { body: [0, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.5, 0], r: 1.25 }, { p: [0.1, kneeY - hipY, 0], r: 1.0 }], opts: { K: 14, N: 8 } }, at: [0, hipY, z], stage: 'legs', bone: upper, line: 0.4, colour: STEEL, metal: true });
  add({ shape: { tube: [{ p: [0.1, 0, 0], r: 1.0 }, { p: [0.05, -1.3, 0], r: 1.05 }, { p: [0, 1.0 - kneeY, 0], r: 0.85 }], opts: { K: 14, N: 8 } }, at: [0, kneeY, z], stage: 'legs', bone: lower, line: 0.4, colour: STEEL, metal: true });
  add({ shape: { ball: [1.1, 0.75, 1.15] }, at: [0.45, kneeY, z], stage: 'legs', bone: lower, line: 0.3, colour: MAIL });
  add({ shape: { ball: [1.7, 0.85, 1.1] }, at: [0.6, 0.85, z], stage: 'legs', bone: lower, line: 0.4, colour: MAIL });
  pivots[upper] = [0, hipY, z]; pivots[lower] = [0.1, kneeY, z];
}

// ---- the torso: the breastplate, narrow at the waist and broad at the chest ----
const T0 = 7.3, T2 = 11.5, chestR = 2.5, chestW = 1.3;
const torso: TubePoint[] = [{ p: [0, T0], r: 2.15, wide: 1.2 }, { p: [0.15, (T0 + T2) / 2], r: 2.15, wide: 1.25 }, { p: [0.4, T2], r: chestR, wide: chestW }];
add({ shape: { tube: torso, opts: { K: 24, N: 18, ref: [0, 0, 1], cap: 0.7 } }, stage: 'body', bone: 'body', line: 0.45, torso: true, colour: STEEL, metal: true });
// The mail skirt under the breastplate, and a dark belt round the waist.
add({ shape: { tube: [{ p: [0, 7.5], r: 2.35, wide: 1.2 }, { p: [0, 5.8], r: 2.7, wide: 1.18 }], opts: { K: 22, N: 6, ref: [0, 0, 1], cap: 0.2 } }, stage: 'body', bone: 'body', line: 0.45, colour: MAIL });
add({ shape: { tube: [{ p: [0, 7.6], r: 2.42, wide: 1.2 }, { p: [0.03, 8.3], r: 2.36, wide: 1.2 }], opts: { K: 22, N: 4, ref: [0, 0, 1], cap: 0.12 } }, stage: 'collar', bone: 'body', line: 0.3, colour: MAIL });

// ---- the arms: mail at the upper arm, a plate vambrace, a dark gauntlet, a pauldron over each shoulder ----
const R = 0.95, armLen = 5.4, shoulderX = 0.3, shoulderY = 11.5, shoulderZ = chestR * chestW + 0.35 * R;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const z = sd * shoulderZ;
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 0.95 }, { p: [0, -armLen * 0.5, 0], r: R * 0.9 }], opts: { K: 12, N: 6 } }, at: [shoulderX, shoulderY, z], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: MAIL });
  add({ shape: { tube: [{ p: [0, -armLen * 0.45, 0], r: R * 1.1 }, { p: [0, -armLen, 0], r: R * 0.95 }], opts: { K: 12, N: 6, cap: 0.4 } }, at: [shoulderX, shoulderY, z], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: STEEL, metal: true });
  add({ shape: { ball: [R * 1.1, R * 1.1, R * 1.1] }, at: [shoulderX, shoulderY - armLen, z], stage: 'arms', bone: `hand${s}`, line: 0.4, colour: MAIL });
  // The pauldron: a flat cap, wider than the arm, that sits on the shoulder and reaches out to the side.
  add({ shape: { ball: [1.7, 1.05, 1.75] }, at: [shoulderX, shoulderY + 0.5, z + sd * 0.2], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: STEEL, metal: true });
  pivots[`arm${s}`] = [shoulderX, shoulderY, z];
}
// The round shield on the left arm, on the outer side: a flat disc with a dark boss.
const shieldZ = -(shoulderZ + R + 0.6);
add({ shape: { ball: [2.7, 2.7, 0.5] }, at: [shoulderX + 0.2, shoulderY - 3.5, shieldZ], stage: 'arms', bone: 'armL', line: 0.45, colour: STEEL, metal: true });
add({ shape: { ball: [0.95, 0.95, 0.45] }, at: [shoulderX + 0.2, shoulderY - 3.5, shieldZ - 0.4], stage: 'arms', bone: 'armL', line: 0, colour: MAIL });

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
// The comb: a low dark ridge over the crown, from above the visor to the nape.
const comb: TubePoint[] = [];
for (let i = 0; i <= 6; i++) { const a = 0.3 - i / 6 * 1.7; comb.push({ p: [helm[0] + hr[0] * Math.sin(a), helm[1] + hr[1] * Math.cos(a), 0], r: 0.4, wide: 0.6 }); }
add({ shape: { tube: comb, opts: { K: 8, N: 18, ref: [0, 0, 1] } }, stage: 'hair', bone: 'head', line: 0.3, colour: MAIL });

export const npcKnight: TubeDesc = {
  name: 'Knight', size: 1, outline: 0x222222, pieces, pivots,
  parents: { head: 'body', leg1: 'leg0', leg3: 'leg2' },
  // Arms of a natural length: they take a third of the lengthening the short-armed figures need in a blow.
  stance: 'two', arms: { length: armLen, radius: R, stretch: 0.3 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [2.3, 3.0],
};
