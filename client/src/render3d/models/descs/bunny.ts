// The bunny (#357): a round body, long ears, a white tail; it hops. Page px (one wolf model px), the red-brown set of the try-out
// page; the front along +x, the feet at y 0. The page's numbers at the approved values (size 0.75, legLen 1.9).

import type { Vec3 } from '../desc';
import { ANIMAL_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';

const COAT = 0x9a5a34, BELLY = 0xd9b88a, RUMP = 0xf2e6cf, NOSE = 0x2a211e, EYE = 0x1c1614;

function bunnyDesc(): TubeDesc {
  const L = 1.9, hy = 2.9;
  const pieces: TubePiece[] = [];
  const add = (p: TubePiece): void => { pieces.push(p); };

  // A round body, bigger behind, sitting low. Light underside.
  add({
    shape: { tube: [{ p: [-2.0, 2.75], r: 2.6, wide: 0.95 }, { p: [1.5, 3.4], r: 2.0, wide: 0.95 }], opts: { K: 26, N: 12, ref: [0, 0, 1] } },
    stage: 'body', bone: 'body', line: 0.45, torso: true,
    colour: (_u, d) => (d > 0.7 ? BELLY : COAT),
  });
  // The tail is a fixed white ball.
  add({ shape: { ball: [1.05, 1.05, 1.05] }, at: [-2.0 - 2.3, 3.1, 0], stage: 'hair', bone: 'body', line: 0.35, colour: RUMP });

  const hx = 2.3, hyh = 4.9;
  const head = (x: number, y: number, z = 0): Vec3 => [hx + x, hyh + y, z];
  add({ shape: { ball: [2.0, 1.85, 1.9] }, at: head(0.8, 0.5), stage: 'head', bone: 'head', line: 0.45, colour: COAT });
  add({ shape: { ball: [0.95, 0.8, 1.05] }, at: head(2.5, 0.0), stage: 'hair', bone: 'head', line: 0.3, colour: BELLY });
  add({ shape: { ball: [0.3, 0.3, 0.4] }, at: head(3.3, 0.2), stage: 'spikes', bone: 'head', line: 0.2, colour: NOSE });
  for (const sd of [1, -1]) {
    add({ shape: { ball: [0.42, 0.42, 0.42] }, at: head(1.6, 0.85, sd * 1.7), stage: 'spikes', bone: 'head', line: 0, colour: EYE });
    add({ shape: { drop: { r: 0.78, len: 4.3, sink: 0.7, wide: 0.5, dir: [-0.25, 1, 0.2 * sd] } }, at: head(0.4, 1.9, sd * 0.8), stage: 'hair', bone: 'head', line: 0.35, colour: COAT, bend: { sway: 0.8 } });
  }

  // Short front legs; behind, a round thigh and a long foot that swing together on one bone.
  const fl = [{ p: [0, 0.8, 0], r: 0.75 }, { p: [0, -L + 0.55, 0], r: 0.62 }] as const;
  const foot = [{ p: [-0.4, -1.2, 0], r: 0.55 }, { p: [2.0, -1.25, 0], r: 0.5 }] as const;
  const pivots: TubeDesc['pivots'] = { body: [0, hy, 0], head: [hx, hyh, 0] };
  const legs: { upper: TubeDesc['legs'][number]['upper']; front: boolean }[] = [];
  const names = [['armR', true, 1], ['armL', true, -1], ['leg0', false, 1], ['leg2', false, -1]] as const;
  for (const [upper, front, sd] of names) {
    if (front) {
      const at: Vec3 = [1.4, L, sd * 0.95];
      add({ shape: { tube: fl, opts: { K: 12, N: 6, cap: 0.8 } }, at, stage: 'legs', bone: upper, line: 0.4, colour: COAT });
      pivots[upper] = at;
    } else {
      const at: Vec3 = [-1.7, 1.25 + 0.55, sd * 1.75];
      add({ shape: { ball: [1.55, 1.45, 1.05] }, at, stage: 'legs', bone: upper, line: 0.4, colour: COAT });
      add({ shape: { tube: foot, opts: { K: 12, N: 6 } }, at, stage: 'legs', bone: upper, line: 0.4, colour: COAT });
      pivots[upper] = at;
    }
    legs.push({ upper, front });
  }

  return {
    // The ears' base (page y 6.8) is drawn 7.382 game px high at size 1; the factor sets it to 3.5 px.
    name: 'Bunny', size: fitSize(ANIMAL_FACTOR.bunny, 6.8 * 1.0856), outline: 0x222222, pieces, pivots,
    parents: { head: 'body' },
    legs, footprint: [5.1, 3.72], hop: 1.3,
  };
}

export const bunny = bunnyDesc();
