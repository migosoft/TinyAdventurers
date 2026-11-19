// The treasure chest (#317): a wooden trough with a domed lid on a hinge at the back, gold straps and a lock, hard-edged prisms.
// The Mimic (mimic.ts) shares the shell. Game px (one description px is one game px); x is the front (the lock), y up, z the width.

import type { Vec3 } from '../desc';
import type { TubeDesc, TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';

/** The closed chest in game px: 14 wide (z), 9 deep (x), 9 high (`base` + `rise`); `wall` is the wood's thickness. */
export const CHEST = { w: 14, d: 9, base: 5.5, rise: 3.5, wall: 1 } as const;
/** The lid turns about the hinge: the back edge of the rim. */
export const HINGE: Vec3 = [-4.5, 5.5, 0];

const WOOD = { top: 0xee8e2e, side: 0xc56025, end: 0x8f4029 }, SEAM = 0x38262d, GOLD = 0xfacb3e;
const GEMS = [0xffad3b, 0x97da3f, 0x72d6ce];
const HX = CHEST.d / 2, HZ = CHEST.w / 2, TOP = CHEST.base;
type Pt = readonly [number, number];

/** A band between two half-ellipses about the hinge height: the outer arc from angle `a0` to `a1`, then the inner one back (counter-clockwise). */
function band(outer: Pt, inner: Pt, a0: number, a1: number, steps: number): Pt[] {
  const arc = (r: Pt, t: number): Pt => [r[0] * Math.cos(t), TOP + r[1] * Math.sin(t)];
  const ts = Array.from({ length: steps + 1 }, (_, i) => a0 + (a1 - a0) * i / steps);
  return [...ts.map((t) => arc(outer, t)), ...ts.reverse().map((t) => arc(inner, t))];
}
/** The half-ellipse polygon of radii `r`, front to back over the top. */
const dome = (r: Pt, steps = 8): Pt[] => Array.from({ length: steps + 1 }, (_, i) => [r[0] * Math.cos(Math.PI * i / steps), TOP + r[1] * Math.sin(Math.PI * i / steps)] as Pt);
const rect = (x0: number, x1: number, y0: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** The shell the chest and the Mimic share: wood, gold, seams, lock, and the lining in the colour `inside`. */
export function chestShell(inside: number): TubePiece[] {
  const out: TubePiece[] = [];
  const add = (p: Omit<TubePiece, 'shape'> & { outline: readonly Pt[]; z: readonly [number, number] }): void => {
    const { outline, z, ...rest } = p;
    out.push({ shape: { prism: { outline, z } }, ...rest });
  };
  const base = { stage: 'body', bone: 'body' } as const, lid = { stage: 'head', bone: 'head' } as const, trim = { stage: 'collar', bone: 'head' } as const;
  const proud = 0.25, sunk = 0.05;

  // The base: the trough (a U), the end walls, the lining.
  add({ ...base, outline: [[-HX, 0], [HX, 0], [HX, TOP], [HX - 1, TOP], [HX - 1, 1], [-HX + 1, 1], [-HX + 1, TOP], [-HX, TOP]], z: [-HZ, HZ], colour: WOOD.side, line: 0.4, torso: true });
  for (const [a, b] of [[6, 7], [-7, -6]] as const) add({ ...base, outline: rect(-3.5, 3.5, 1, TOP), z: [a, b], colour: WOOD.end, line: 0.4 });
  add({ ...base, outline: [[-3.5, 1], [3.5, 1], [3.5, 5.3], [3.4, 5.3], [3.4, 1.1], [-3.4, 1.1], [-3.4, 5.3], [-3.5, 5.3]], z: [-6, 6], colour: inside, line: 0 });
  for (const [a, b] of [[5.9, 6], [-6, -5.9]] as const) add({ ...base, outline: rect(-3.4, 3.4, 1.1, 5.3), z: [a, b], colour: inside, line: 0 });
  // Seams, 0.3 high at y 2.8 on the four outer faces.
  for (const sd of [1, -1]) {
    add({ ...base, outline: rect(sd * HX - sunk, sd * HX + sunk, 2.65, 2.95), z: [-HZ, HZ], colour: SEAM, line: 0 });
    add({ ...base, outline: rect(-HX, HX, 2.65, 2.95), z: sd > 0 ? [HZ - sunk, HZ + sunk] : [-HZ - sunk, -HZ + sunk], colour: SEAM, line: 0 });
  }
  // Gold: two straps on the front and the back, the lock with its keyhole.
  for (const sd of [1, -1]) for (const zc of [4.5, -4.5]) {
    add({ ...base, outline: sd > 0 ? rect(HX - sunk, HX + proud, 0, TOP) : rect(-HX - proud, -HX + sunk, 0, TOP), z: [zc - 0.8, zc + 0.8], colour: GOLD, line: 0.4 });
  }
  add({ ...base, outline: rect(HX, 5.3, 3.2, TOP), z: [-1.1, 1.1], colour: GOLD, line: 0.4 });
  out.push({ shape: { ball: [0.35, 0.35, 0.35] }, at: [5.3, 4.3, 0], ...base, colour: SEAM, line: 0 });

  // The lid: the arch, the end plates, the lining.
  add({ ...lid, outline: band([HX, CHEST.rise], [3.5, 2.7], 0, Math.PI, 8), z: [-HZ, HZ], colour: WOOD.top, line: 0.4 });
  for (const [a, b] of [[6, 7], [-7, -6]] as const) add({ ...lid, outline: dome([3.5, 2.7]), z: [a, b], colour: WOOD.side, line: 0.4 });
  add({ ...lid, outline: band([3.5, 2.7], [3.4, 2.6], 0, Math.PI, 8), z: [-6, 6], colour: inside, line: 0 });
  for (const [a, b] of [[5.9, 6], [-6, -5.9]] as const) add({ ...lid, outline: dome([3.4, 2.6]), z: [a, b], colour: inside, line: 0 });
  // Trim, in its own stage: it stands out of the lid, which is what the model's height is measured by.
  for (const t of [Math.PI / 3, 2 * Math.PI / 3]) {
    const speed = Math.hypot(HX * Math.sin(t), CHEST.rise * Math.cos(t)), d = 0.15 / speed;
    add({ ...trim, outline: band([HX + sunk, CHEST.rise + sunk], [HX - sunk, CHEST.rise - sunk], t - d, t + d, 1), z: [-HZ, HZ], colour: SEAM, line: 0 });
  }
  for (const zc of [4.5, -4.5]) add({ ...trim, outline: band([HX + proud, CHEST.rise + proud], [HX, CHEST.rise], 0, Math.PI, 8), z: [zc - 0.8, zc + 0.8], colour: GOLD, line: 0.4 });
  const a = Math.asin(0.8 / CHEST.rise), xo = HX * Math.cos(a);
  add({ ...trim, outline: band([HX + proud, CHEST.rise + proud], [HX, CHEST.rise], 0, a, 2), z: [-HZ, HZ], colour: GOLD, line: 0.4 });
  for (const [z0, z1] of [[HZ - sunk, HZ + proud], [-HZ - proud, -HZ + sunk]] as const) add({ ...trim, outline: [[-HX, TOP], [HX, TOP], [xo, TOP + 0.8], [-xo, TOP + 0.8]], z: [z0, z1], colour: GOLD, line: 0.4 });
  return out;
}

const LOOT: TubePiece[] = [
  { shape: { ball: [2.8, 2.4, 4.8] }, at: [0, 2.4, 0], stage: 'hair', bone: 'hat', colour: GOLD, line: 0.3 },
  ...([[0.6, 4.45, -2.8], [-0.8, 4.75, 1.6], [1.0, 3.95, 3.6]] as const).map((at, i): TubePiece => (
    { shape: { ball: [0.7, 0.7, 0.7] }, at, stage: 'hair', bone: 'hat', colour: GEMS[i], line: 0.2 })),
];

export const chest: TubeDesc = {
  name: 'Chest', size: 1 / PAGE_TO_GAME, outline: 0x222222,
  pieces: [...chestShell(SEAM), ...LOOT],
  pivots: { body: [0, 0, 0], head: HINGE, hat: [0, 1, 0] },
  parents: { head: 'body', hat: 'body' },
  legs: [], footprint: [4.5, 7],
};
