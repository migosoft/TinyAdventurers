import type { FigureDesc } from '../desc';

const S10 = '...ssssssssss...';

export const wizard: FigureDesc = {
  name: 'Wizard', outline: 0x222222, centre: 8,
  colours: { p: 0x5956bd, b: 0x5698cc, s: 0xb58057, w: 0xfdf7ed },
  firstRow: 15,
  side: ['....ssssssss....', S10, S10, S10, S10, S10,
    '...bbbbbbbbbb...', '...bbbbbbbbbb...', '...bbbbbbbbbb...', '...bbbbbbbbbb...', '...bbbbbbbbbb...', '...pppppppppp...', '...pppppppppp...'],
  // The robe is the body: it reaches the ground, widens downwards and has a flat lower end.
  parts: [{ rows: [15, 20] }, { rows: [19, 27], taper: { from: 21, to: 1.22 }, open: true }],
  eyes: { rows: [18, 19], width: 1.5, colour: 0x222222, at: 27 },
  hair: { colour: 'w', thick: 0.6, from: 18, below: true, cover: [0.7, 0.7, 0.72] },   // only below the hat
  shells: [{ colour: 'w', thick: 0.6, lift: 0, from: 20, below: true, front: true, cover: [0.55, 0.6] }],   // the beard along the jaw, up to the hair
  hat: { colour: 'p', band: 'b', row: 16.6, brim: 6.9, radius: 5.2, height: 9.5, lean: -2.2, tilt: 0.14, sway: 0.3 },   // tilt: pushed back, so the brim does not hide the face
  spikes: [
    { colour: 'w', row: 19.6, front: { of: 'head', inset: 1.0 }, dir: [0.27, -1, 0], radius: 4.3, length: 8.6, sink: 0.6, shape: 'drop', flat: 0.5, flatAxis: 'x', sway: 0.7 },   // beard
    { colour: 'w', row: 17.2, x: 4.35, side: { of: 'head', inset: 2.7 }, dir: [-0.15, -0.2, 1], radius: 0.48, length: 2.4, sink: 1.2, shape: 'ball', line: 0.2 },   // eyebrows
  ],
  arms: { row: 21.0, colour: 'b', hand: 's', radius: 1.0, length: 4.3 },
};
