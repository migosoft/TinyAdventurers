// The stag and the deer (#357): one build, the deer without antlers and with a coat-coloured neck. Page px (one wolf model px),
// the red-brown coat of the try-out page; the front along +x, the feet at y 0.

import type { Vec3 } from '../desc';
import { ANIMAL_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';

const COAT = 0x9a5a34, MANE = 0x6e4028, BELLY = 0xd9b88a, RUMP = 0xf2e6cf, LEG = 0x5a3524, HOOF = 0x2a211e, ANTLER = 0xd9c9a3, MUZZLE = 0xc9a077, NOSE = 0x2a211e, EYE = 0x1c1614;

export interface DeerLook { name: string; size: number; neckLen: number; ear: number; antlers: boolean; darkNeck: boolean }

export function deerDesc(v: DeerLook): TubeDesc {
  const L = 6, U = L * 0.5, Lo = L * 0.5, hy = L + 2.0, th = 25 * Math.PI / 180;
  const pieces: TubePiece[] = [];
  const add = (p: TubePiece): void => { pieces.push(p); };

  // The body: rump to chest. Light underside, white rump.
  add({
    shape: { tube: [{ p: [-5.2, hy + 0.1], r: 2.5, wide: 0.86 }, { p: [-1.2, hy - 0.15], r: 2.7, wide: 0.86 }, { p: [3.5, hy + 0.35], r: 2.9, wide: 0.84 }], opts: { K: 28, N: 20, ref: [0, 0, 1] } },
    stage: 'body', bone: 'body', line: 0.45, torso: true,
    colour: (u, d) => (u < 0.07 ? RUMP : d > 0.66 ? BELLY : COAT),
  });
  // The neck starts inside the chest and bends as a whole about its foot; the same stage as the body, so they share one outline.
  const n0 = [3.2, hy + 0.6] as const, n1 = [4.5, hy + 1.7] as const, n2 = [n1[0] + v.neckLen * Math.sin(th), n1[1] + v.neckLen * Math.cos(th)] as const;
  add({
    shape: { tube: [{ p: n0, r: 2.2, wide: 0.82 }, { p: n1, r: 1.8, wide: 0.84 }, { p: n2, r: 1.4, wide: 0.9 }], opts: { K: 22, N: 22, ref: [0, 0, 1] } },
    stage: 'body', bone: 'body', line: 0.45, colour: v.darkNeck ? MANE : COAT,
    bend: { neck: { origin: n1, from: 0.3, to: 0.9 } },
  });
  // The tail: short, white, loose.
  add({ shape: { drop: { r: 0.95, len: 2.9, sink: 0.7, wide: 0.75, dir: [-0.7, 0.7, 0] } }, at: [-5.2 - 1.45, hy + 1.35, 0], stage: 'hair', bone: 'body', line: 0.35, colour: RUMP, bend: { sway: 1, wag: 1 } });

  // The head hangs on the neck's end.
  const head = (x: number, y: number, z = 0): Vec3 => [n2[0] + 1.0 + x, n2[1] + 0.55 + y, z];
  add({ shape: { ball: [2.1, 1.75, 1.7], pow: 0.85 }, at: head(0, 0), stage: 'head', bone: 'head', line: 0.45, colour: COAT });
  add({ shape: { ball: [1.9, 1.1, 1.1], turnZ: -0.22 }, at: head(2.2, -0.5), stage: 'hair', bone: 'head', line: 0.3, colour: MUZZLE });
  add({ shape: { ball: [0.5, 0.5, 0.62] }, at: head(3.95, -0.95), stage: 'spikes', bone: 'head', line: 0.2, colour: NOSE });
  const er = 0.9 * v.ear, el = 3.1 * v.ear;
  for (const sd of [1, -1]) {
    add({ shape: { ball: [0.42, 0.42, 0.42] }, at: head(0.95, 0.4, sd * 1.45), stage: 'spikes', bone: 'head', line: 0, colour: EYE });
    add({ shape: { drop: { r: er, len: el, sink: 0.6, wide: 0.5, dir: [-0.3, 0.6, 0.75 * sd] } }, at: head(-1.0, 1.1, sd * 1.15), stage: 'hair', bone: 'head', line: 0.35, colour: COAT, bend: { sway: 0.8 } });
    if (v.antlers) {
      const rr = 1, at = head(-0.2, 1.45, sd * 0.75);
      const beam = [[0, 0, 0], [-0.8, 1.8, 1.0], [-1.2, 3.8, 2.0], [-0.4, 5.6, 2.4], [0.9, 6.5, 2.0]].map((p, i) => ({ p: [p[0], p[1], p[2] * sd] as [number, number, number], r: (0.52 - 0.06 * i) * rr }));
      add({ shape: { tube: beam, opts: { K: 10, N: 22 } }, at, stage: 'spikes', bone: 'hat', line: 0.3, colour: ANTLER });
      const tines = [[[-0.4, 0.9, 0.5], [1.8, 1.9, 0.9]], [[-1.2, 3.8, 2.0], [0.6, 5.0, 2.3]], [[-0.4, 5.6, 2.4], [-1.6, 7.0, 2.9]]];
      for (const [a, b] of tines) {
        add({ shape: { tube: [{ p: [a[0], a[1], a[2] * sd], r: 0.4 * rr }, { p: [b[0], b[1], b[2] * sd], r: 0.26 * rr }], opts: { K: 10, N: 6 } }, at, stage: 'spikes', bone: 'hat', line: 0.3, colour: ANTLER });
      }
    }
  }

  // Legs: an upper and a lower piece with a bend between. The hind legs stand angled back (the rest angles are in the geometry).
  const Uh = U * 1.05, hindA = -0.38, hindK = 0.5, hipH = Uh * Math.cos(hindA) + Lo * Math.cos(hindA + hindK);
  const upF = [{ p: [0, 1.0, 0], r: 1.15 }, { p: [0, -U, 0], r: 0.8 }] as const;
  const upH = [{ p: [0, 1.0, 0], r: 1.6 }, { p: [0, -Uh * 0.5, 0], r: 1.15 }, { p: [0, -Uh, 0], r: 0.82 }] as const;
  const low = [{ p: [0, 0, 0], r: 0.8 }, { p: [0, -Lo + 1.0, 0], r: 0.64 }] as const;
  const hoof = [{ p: [0, -Lo + 1.0, 0], r: 0.74 }, { p: [0, -Lo + 0.38, 0], r: 0.82 }] as const;
  const pivots: TubeDesc['pivots'] = {
    body: [0, hy, 0],
    head: [n2[0], n2[1], 0],
    ...(v.antlers ? { hat: [n2[0] + 1.0 - 0.2, n2[1] + 0.55 + 1.45, 0] as Vec3 } : {}),
  };
  const legs: { upper: TubeDesc['legs'][number]['upper']; lower: NonNullable<TubeDesc['legs'][number]['lower']>; front: boolean }[] = [];
  const names = [['armR', 'handR'], ['armL', 'handL'], ['leg0', 'leg1'], ['leg2', 'leg3']] as const;
  let n = 0;
  for (const front of [true, false]) for (const sd of [1, -1]) {
    const [upper, lower] = names[n++], x = front ? 3.2 : -4.3, z = sd * 1.45, hipY = front ? U + Lo : hipH, a = front ? 0 : hindA, ul = front ? U : Uh;
    const knee: Vec3 = [x + ul * Math.sin(a), hipY - ul * Math.cos(a), z];
    add({ shape: { tube: front ? upF : upH, opts: { K: 14, N: front ? 8 : 12 } }, at: [x, hipY, z], turn: a || undefined, stage: 'legs', bone: upper, line: 0.4, colour: COAT });
    add({ shape: { tube: low, opts: { K: 14, N: 8 } }, at: knee, turn: front ? undefined : a + hindK, stage: 'legs', bone: lower, line: 0.4, colour: LEG });
    add({ shape: { tube: hoof, opts: { K: 14, N: 4, cap: 0.45 } }, at: knee, turn: front ? undefined : a + hindK, stage: 'legs', bone: lower, line: 0.4, colour: HOOF });
    pivots[upper] = [x, hipY, z]; pivots[lower] = knee;
    legs.push({ upper, lower, front });
  }

  return {
    name: v.name, size: v.size, outline: 0x222222, pieces, pivots,
    parents: { head: 'body', hat: 'head', handR: 'armR', handL: 'armL', leg1: 'leg0', leg3: 'leg2' },
    legs, footprint: [10.5, 3.6],
  };
}

export const stag = deerDesc({ name: 'Stag', size: 0.95, neckLen: 4, ear: 1, antlers: true, darkNeck: true });
// The deer's shoulder (the chest's top, page y 11.25) is drawn 12.213 game px high at size 1; the factor sets it to 9 px.
export const deer = deerDesc({ name: 'Deer', size: fitSize(ANIMAL_FACTOR.deer, 11.25 * PAGE_TO_GAME), neckLen: 3.8, ear: 1.1, antlers: false, darkNeck: false });
