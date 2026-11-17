// The boar (#357): heavy in front, a dark bristle ridge along the back, tusks on the head. Page px (one wolf model px), the red-brown
// set of the try-out page; the front along +x, the feet at y 0. The page's numbers at the approved values (size 0.9, legLen 3.4,
// bodyThick 1.25, tusks 1).

import type { Vec3 } from '../desc';
import type { TubeDesc, TubePiece } from '../tubeDesc';

const COAT = 0x9a5a34, MANE = 0x6e4028, RUMP = 0xf2e6cf, LEG = 0x5a3524, HOOF = 0x2a211e, MUZZLE = 0xc9a077, NOSE = 0x2a211e, EYE = 0x1c1614;

function boarDesc(): TubeDesc {
  const L = 3.4, U = L * 0.55, Lo = L * 0.45, bt = 1.25, k = 1.2, hy = L + 2.5 * bt;
  const pieces: TubePiece[] = [];
  const add = (p: TubePiece): void => { pieces.push(p); };

  // Heavy in front: the body grows towards the shoulders. A dark ridge along the back, a lighter underside.
  add({
    shape: { tube: [{ p: [-4.4, hy - 0.2], r: 2.7 * bt, wide: 0.9 }, { p: [-0.4, hy + 0.25], r: 3.2 * bt, wide: 0.9 }, { p: [3.2, hy + 0.5], r: 3.5 * bt, wide: 0.88 }], opts: { K: 28, N: 20, ref: [0, 0, 1] } },
    stage: 'body', bone: 'body', line: 0.45, torso: true,
    colour: (u, d) => (d < 0.17 && u > 0.1 ? LEG : d > 0.78 ? COAT : MANE),
  });
  // The tail: short, dark, loose.
  add({ shape: { drop: { r: 0.5, len: 2.6, sink: 0.6, wide: 1, dir: [-0.8, 0.45, 0] } }, at: [-4.4 - 2.3 * bt, hy + 0.9 * bt, 0], stage: 'hair', bone: 'body', line: 0.3, colour: LEG, bend: { sway: 1, wag: 1 } });

  // The head sits low on the shoulders, with no neck to speak of.
  const hx = 4.3 + 1.2 * bt, hyh = hy - 0.5 * bt;
  const head = (x: number, y: number, z = 0): Vec3 => [hx + x, hyh + y, z];
  add({ shape: { ball: [2.7, 2.5, 2.5], pow: 0.85 }, at: head(1.0, 0.2), stage: 'head', bone: 'head', line: 0.45, colour: MANE });
  add({ shape: { tube: [{ p: [2.2, -0.5, 0], r: 1.75 }, { p: [4.6, -1.1, 0], r: 1.3 }], opts: { K: 18, N: 8, cap: 0.35 } }, at: head(0, 0), stage: 'hair', bone: 'head', line: 0.3, colour: MUZZLE });
  add({ shape: { ball: [0.4, 1.0, 1.1] }, at: head(5.0, -1.2), stage: 'spikes', bone: 'head', line: 0.2, colour: NOSE });
  for (const sd of [1, -1]) {
    add({ shape: { ball: [0.38, 0.38, 0.38] }, at: head(2.1, 0.95, sd * 2.1), stage: 'spikes', bone: 'head', line: 0, colour: EYE });
    add({ shape: { drop: { r: 0.85, len: 2.1, sink: 0.6, wide: 0.55, dir: [-0.25, 0.7, 0.65 * sd] } }, at: head(0.2, 2.0, sd * 1.5), stage: 'hair', bone: 'head', line: 0.35, colour: MANE, bend: { sway: 0.8 } });
    // Tusks, on the hat bone so a butt can toss them.
    add({ shape: { drop: { r: 0.45, len: 2.0, sink: 0.5, wide: 1, dir: [0.45, 1, 0.3 * sd] } }, at: head(3.6, -1.5, sd * 1.15), stage: 'spikes', bone: 'hat', line: 0.25, colour: RUMP });
  }

  // Legs: an upper and a lower piece with a bend between. The hind legs stand angled back (the rest angles are in the geometry).
  const hindA = -0.22, hindK = 0.3, hipH = U * Math.cos(hindA) + Lo * Math.cos(hindA + hindK);
  const up = [{ p: [0, 1, 0], r: 1.35 * k }, { p: [0, -U, 0], r: 0.98 * k }] as const;
  const low = [{ p: [0, 0, 0], r: 0.98 * k }, { p: [0, -Lo + 0.9, 0], r: 0.8 * k }] as const;
  const hoof = [{ p: [0, -Lo + 0.9, 0], r: 0.88 * k }, { p: [0, -Lo + 0.4, 0], r: 0.95 * k }] as const;
  const pivots: TubeDesc['pivots'] = { body: [0, hy, 0], head: [hx, hyh, 0], hat: head(3.6, -1.5, 0) };
  const legs: { upper: TubeDesc['legs'][number]['upper']; lower: NonNullable<TubeDesc['legs'][number]['lower']>; front: boolean }[] = [];
  const names = [['armR', 'handR'], ['armL', 'handL'], ['leg0', 'leg1'], ['leg2', 'leg3']] as const;
  let n = 0;
  for (const front of [true, false]) for (const sd of [1, -1]) {
    const [upper, lower] = names[n++], x = front ? 2.9 : -3.6, z = sd * 1.9 * bt, hipY = front ? L : hipH, a = front ? 0 : hindA;
    const knee: Vec3 = [x + U * Math.sin(a), hipY - U * Math.cos(a), z];
    add({ shape: { tube: up, opts: { K: 14, N: 8 } }, at: [x, hipY, z], turn: a || undefined, stage: 'legs', bone: upper, line: 0.4, colour: MANE });
    add({ shape: { tube: low, opts: { K: 14, N: 6 } }, at: knee, turn: front ? undefined : a + hindK, stage: 'legs', bone: lower, line: 0.4, colour: LEG });
    add({ shape: { tube: hoof, opts: { K: 14, N: 4, cap: 0.4 } }, at: knee, turn: front ? undefined : a + hindK, stage: 'legs', bone: lower, line: 0.4, colour: HOOF });
    pivots[upper] = [x, hipY, z]; pivots[lower] = knee;
    legs.push({ upper, lower, front });
  }

  return {
    name: 'Boar', size: 0.9, outline: 0x222222, pieces, pivots,
    parents: { head: 'body', hat: 'head', handR: 'armR', handL: 'armL', leg1: 'leg0', leg3: 'leg2' },
    legs, footprint: [9.3, 4.32],
  };
}

export const boar = boarDesc();
