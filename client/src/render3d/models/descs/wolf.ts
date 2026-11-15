import type { FigureDesc } from '../desc';

export const wolf: FigureDesc = {
  name: 'Dire Wolf', quad: true, outline: 0x222222, centre: 8,
  colours: { c: 0x483b3a, b: 0x775c55, n: 0x62232f },
  firstRow: 0, side: [],
  // The head stands, as on every figure. The body lies (`lie`): its side view is drawn as the sprite shows it, the front on
  // the right, and is turned about its length: the top row is the back, the lowest row the belly.
  parts: [
    { rows: [16, 21], firstRow: 16, pow: 0.8, side: ['.....ccbbbb.....', '....cccbbbbb....', '....cccbbbbb....', '....cccbbbbb....', '....cccbbbbb....', '.....ccbbbb.....'] },
    { lie: true, firstRow: 19, side: ['.cccccccccccccc.', '.cccccccccccccc.', '.cccccccccccccc.', '.bbbbbbbbbbbbbb.', '.bbbbbbbbbbbbbb.', '.bbbbbbbbbbbbbb.'] },
  ],
  headAt: 8, neck: [5, 20],   // how far in front of the body's middle the head sits; where it turns (sprite pixels forward, sprite row)
  eyes: { rows: [17.1, 17.1], width: 2.5, colour: 0x9f294e, at: 29 },
  spikes: [
    { colour: 'c', row: 17.3, x: 0.2, side: { of: 'head', inset: 1.5 }, dir: [-0.05, 1, 0.16], radius: 1.7, length: 4.8, sink: 1.3, shape: 'drop', flat: 0.65, flatAxis: 'x', sway: 0.8 },                       // ears
    { colour: 'b', row: 19.1, front: { of: 'head', inset: 1.3 }, dir: [1, -0.05, 0], radius: 2.25, length: 5, sink: 0.6, shape: 'ball', line: 0.3 },      // snout
    { colour: 'n', row: 18.6, front: { of: 'head', inset: -3.1 }, dir: [1, 0, 0], radius: 0.85, length: 1.5, sink: 0.75, shape: 'ball', line: 0.2 },      // nose
    { on: 'body', colour: 'c', row: 20.4, x: -6.2, dir: [-0.45, 1, 0], radius: 1.45, length: 9.5, sink: 1.6, shape: 'ball', sway: 1, wag: 1 },               // tail
  ],
  legs: { top: 25, colour: 'c', radius: 1.25, foot: 0.95, apart: 1.75, at: [4.6, -4.6] },   // two pairs: in front of and behind the body's middle
};
