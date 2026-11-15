import type { FigureDesc } from '../desc';

export const knight: FigureDesc = {
  name: 'Paladin', size: 0.87, outline: 0x222222, centre: 8, metal: true,
  visor: { rows: [15, 18], half: 50, line: 0.6, slits: 3, slitWide: 0.8, frame: 0x2b3a4c, slit: 0x1a222c },   // the visor's painted lines, narrower than a sprite pixel
  colours: { m: 0xdfe6ec, v: 0x2b3a4c, x: 0x1a222c, r: 0xda4e38, l: 0x417089 },   // v: the visor's frame and the belt; x: the slits
  firstRow: 13,
  side: ['....mmmmmmmm....', '...mmmmmmmmmm...', '...mmmmmmmmmm...', '...mmmmmmmmmm...', '...mmmmmmmmmm...', '...mmmmmmmmmm...', '...mmmmmmmmmm...', '...mmmmmmmmmm...',
    '...mmmmmmmmmm...', '...vvvvvvvvvv...', '...mmmmmmmmmm...', '...mmmmmmmmmm...'],
  parts: [{ rows: [13, 20] }, { rows: [19, 24], taper: { from: 21, to: 0.78 } }],
  spikes: [
    { colour: 'r', row: 13.6, x: -1.2, dir: [-0.8, 0.6, 0], radius: 1.9, length: 7.5, sink: 1.2, shape: 'wave', wave: 0.23, flat: 0.6, flatAxis: 'z', sway: 1 },   // plume
  ],
  seams: [{ row: 20.7, like: 21 }],
  legs: { top: 25, colour: 'l', radius: 1.55, foot: 0.85, apart: 2.0 },
  arms: { row: 21.3, colour: 'm', hand: 'm', radius: 1.05, length: 3.7, metal: true },
};
