// The orc (#356): the Orc Warrior and the Orc Archer wear this one model; what they hold (a cleaver, a bow) is the kind's own weapon.
// Broad shoulders on a narrow waist, a short neck, a heavy lower jaw with two tusks under a brow ridge, thick arms that hang to the
// thighs, a brown wrap with a dark belt. Page px (one wolf model px), the front along +x, the feet at y 0, z to the figure's right.
// The colours are the pack sprite's (orc_warrior).

import type { Vec3 } from '../desc';
import { HEIGHT_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

const SKIN = 0x3d734f, WRAP = 0x8f4029, BELT = 0x62232f, BONE = 0xfdf7ed, DARK = 0x222222;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): void => { pieces.push(p); };

// ---- the legs: thigh and shin with a knee, a dark foot ----
const hipY = 7.6, kneeY = 4.0, legZ = 1.55;
const pivots: TubeDesc['pivots'] = { body: [0, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.6, 0], r: 1.5 }, { p: [0.1, kneeY - hipY, 0], r: 1.2 }], opts: { K: 14, N: 8 } }, at: [0, hipY, z], stage: 'legs', bone: upper, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0.1, 0, 0], r: 1.2 }, { p: [0, -1.4, 0], r: 1.25 }, { p: [0, 1.0 - kneeY, 0], r: 0.95 }], opts: { K: 14, N: 8 } }, at: [0, kneeY, z], stage: 'legs', bone: lower, line: 0.4, colour: SKIN });
  add({ shape: { ball: [1.75, 0.85, 1.2] }, at: [0.65, 0.85, z], stage: 'legs', bone: lower, line: 0.4, colour: BELT });
  pivots[upper] = [0, hipY, z]; pivots[lower] = [0.1, kneeY, z];
}

// ---- the torso: narrow at the waist, broad at the chest; its dome is the bull neck. Painted: the belt's band, then the skin ----
const T0 = 7.8, T2 = 12.3;
const torso: TubePoint[] = [{ p: [0, T0], r: 2.6, wide: 1.2 }, { p: [0.15, (T0 + T2) / 2], r: 2.4, wide: 1.25 }, { p: [0.45, T2], r: 3.0, wide: 1.38 }];
add({
  shape: { tube: torso, opts: { K: 24, N: 18, ref: [0, 0, 1], cap: 0.85 } },
  stage: 'body', bone: 'body', line: 0.45, torso: true,
  colour: (u) => (u < 0.2 ? BELT : SKIN),
});
// The wrap hangs from the belt over the hips and the tops of the thighs; the belt is a band round its top.
add({ shape: { tube: [{ p: [0, 7.7], r: 2.8, wide: 1.2 }, { p: [0, 5.6], r: 3.2, wide: 1.18 }], opts: { K: 22, N: 6, ref: [0, 0, 1], cap: 0.2 } }, stage: 'body', bone: 'body', line: 0.45, colour: WRAP });
add({ shape: { tube: [{ p: [0, 7.9], r: 2.9, wide: 1.2 }, { p: [0.03, 8.6], r: 2.75, wide: 1.2 }], opts: { K: 22, N: 4, ref: [0, 0, 1], cap: 0.12 } }, stage: 'collar', bone: 'body', line: 0.3, colour: BELT });

// ---- the arms: thick, hanging to the thighs, a round shoulder on each; the upper arm to the elbow, the forearm and the fist on the hand bone ----
const R = 1.25, armLen = 6.2, elbow = 2.9, shoulderY = 12.2, shoulderZ = 3.0 * 1.38 + 0.35 * R;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const z = sd * shoulderZ;
  add({ shape: { ball: [R * 1.25, R * 1.1, R * 1.2] }, at: [0.3, shoulderY + 0.15, z], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: R * 1.1 }, { p: [0, -elbow, 0], r: R * 1.05 }], opts: { K: 12, N: 6 } }, at: [0.3, shoulderY, z], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, -elbow, 0], r: R * 1.05 }, { p: [0, -armLen, 0], r: R * 0.95 }], opts: { K: 12, N: 6 } }, at: [0.3, shoulderY, z], stage: 'arms', bone: `hand${s}`, line: 0.4, colour: SKIN });
  add({ shape: { ball: [R * 1.05, R * 1.05, R * 1.05] }, at: [0.3, shoulderY - armLen, z], stage: 'arms', bone: `hand${s}`, line: 0.4, colour: SKIN });
  pivots[`arm${s}`] = [0.3, shoulderY, z];
}

// ---- the head: set forward on the short neck ----
const head = (x: number, y: number, z = 0): Vec3 => [1.0 + x, 15.3 + y, z];
pivots.head = [0.5, 13.6, 0];
add({ shape: { ball: [2.25, 2.2, 2.35], pow: 0.8 }, at: head(0, 0), stage: 'head', bone: 'head', line: 0.45, colour: SKIN });
for (const sd of [1, -1]) {
  // Small pointed ears, stiff.
  add({ shape: { drop: { r: 0.7, len: 2.0, sink: 0.5, wide: 0.5, dir: [-0.45, 0.35, sd] } }, at: head(-0.3, 0.2, sd * 2.05), stage: 'hair', bone: 'head', line: 0.3, colour: SKIN });
}
// The heavy lower jaw: wider than the head and jutting out under the face; a tusk stands at each corner, beside the cheek.
add({ shape: { ball: [2.0, 1.15, 2.6], pow: 0.8 }, at: head(1.15, -1.4), stage: 'hair', bone: 'head', line: 0.35, colour: SKIN });
// The brow ridge: one bar over both eyes.
add({ shape: { tube: [{ p: [-0.4, 0, -1.8], r: 0.45 }, { p: [0, 0, 0], r: 0.5 }, { p: [-0.4, 0, 1.8], r: 0.45 }], opts: { K: 8, N: 10, ref: [0, 1, 0] } }, at: head(1.9, 1.1), stage: 'hair', bone: 'head', line: 0.3, colour: SKIN });
for (const sd of [1, -1]) {
  add({ shape: { ball: [0.45, 0.55, 0.6] }, at: head(2.0, 0.3, sd * 1.0), stage: 'spikes', bone: 'head', line: 0, colour: DARK });
  add({ shape: { drop: { r: 0.42, len: 2.0, sink: 0.4, wide: 1, dir: [0.25, 1, 0.3 * sd] } }, at: head(2.8, -1.2, sd * 1.9), stage: 'spikes', bone: 'head', line: 0.25, colour: BONE });
}

export const orc: TubeDesc = {
  name: 'Orc', size: fitSize(HEIGHT_FACTOR.orc, 18.998), outline: 0x222222, pieces, pivots,
  parents: { head: 'body', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: armLen, radius: R, elbow },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [2.4, 3.2],
};
