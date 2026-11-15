import type { FigureDesc } from '../desc';

const S10 = '...ssssssssss...';

export const elf: FigureDesc = {
  name: 'Elven Ranger', size: 0.87, outline: 0x222222, centre: 8,
  colours: { h: 0xfacb3e, s: 0xfccba3, g: 0x4ba747, k: 0x314152, d: 0x3d734f },
  firstRow: 11,
  side: ['....ssssssss....', S10, S10, S10, S10, S10, S10, S10,
    '...gggkgggggg...', '...ggggkggggg...', '...gggggkgggg...', '...ggggggkggg...', '...gggggggkgg...', '...dddddddddd...'],
  parts: [{ rows: [11, 19] }, { rows: [17, 24], taper: { from: 20, to: 0.68 } }],   // head, body; they overlap at the neck
  raised: { k: 0.2 },
  eyes: { rows: [15, 16], width: 1.6, colour: 0x5698cc, at: 25 },   // degrees to each side of straight ahead
  // Hair lies around the head: per sprite row from `from`, how far it reaches from the back towards the front (1 = all round).
  hair: { colour: 'h', thick: 0.65, from: 11, cover: [1, 1, 0.8, 0.52, 0.42, 0.4, 0.36, 0.24] },
  spikes: [
    { colour: 'h', row: 11.9, front: { of: 'hair', inset: 0.9 }, dir: [0.62, 0.78, 0], radius: 1.7, length: 4.8, sink: 1.2, sway: 1.2 },                 // quiff
    { colour: 's', row: 14.8, x: -0.6, side: { of: 'head', inset: 0.5 }, dir: [-0.55, 0.45, 0.7], radius: 1.2, length: 4.4, sink: 0.8 },    // ears
  ],
  // A turned-up collar: it starts on the shirt (row), is open at the front by `gap` degrees to each side.
  collar: { colour: 'g', row: 19.9, like: 19.8, gap: 48, back: 1.7, tip: 2.3, tilt: -50, thick: 0.22 },
  seams: [{ row: 19.35, like: 19.8 }],
  legs: { top: 25, colour: 'd', radius: 1.55, foot: 0.8, apart: 1.9 },
  arms: { row: 19.6, colour: 'g', hand: 's', radius: 0.95, length: 4.2 },
};
