import type { FigureDesc } from '../desc';

export const dwarf: FigureDesc = {
  name: 'Barbarian', size: 0.77, outline: 0x222222, centre: 8,
  colours: { s: 0xd8a57d, r: 0xda4e38, a: 0x7b8994, n: 0x775c55 },
  firstRow: 14,
  side: ['...ssssssssss...', '..ssssssssssss..', '..ssssssssssss..', '..ssssssssssss..', '..ssssssssssss..', '..ssssssssssss..', '..ssssssssssss..', '..ssssssssssss..',
    '..aaaaaaaaaaaa..', '..aaaaaaaaaaaa..', '..nnnnnnnnnnnn..'],
  parts: [{ rows: [14, 21] }, { rows: [19, 24], taper: { from: 22, to: 0.75 } }],
  eyes: { rows: [18, 19], width: 1.6, colour: 0x222222, at: 26 },
  hair: { colour: 'r', thick: 0.85, from: 14, cover: [1, 0.8, 0.58, 0.54, 0.47, 0.44, 0.42, 0.36] },
  spikes: [
    { colour: 'r', row: 15.6, x: 0.4, dir: [0.38, 0.92, 0], radius: 4.7, length: 8, sink: 1.5, shape: 'ball', sway: 0.25 },                                                    // the tall mane
    { colour: 'r', row: 20.3, front: { of: 'head', inset: 1.2 }, dir: [0.1, -1, 0], radius: 4.6, length: 5.6, sink: 0.8, shape: 'drop', flat: 0.5, flatAxis: 'x', sway: 0.5 },   // beard
  ],
  shells: [
    { colour: 'r', thick: 0.85, lift: 0, from: 20, below: true, front: true, cover: [0.66, 0.8] },   // the beard along the jaw, back to the hair
    { colour: 'r', thick: 0.55, lift: 0, from: 16.45, to: 17.1, below: true, front: true, cover: [0.4, 0.36], line: 0.25 },   // the one long eyebrow
  ],
  legs: { top: 25, colour: 'n', radius: 1.7, foot: 0.95, apart: 2.4 },
  arms: { row: 21.4, colour: 's', hand: 's', radius: 1.2, length: 3.6 },
};
