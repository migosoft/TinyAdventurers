import type { FigureDesc } from '../desc';

export const ogre: FigureDesc = {
  name: 'Ogre', size: 0.87,outline: 0x222222, centre: 8,
  colours: { g: 0x3d734f, f: 0x8f4029, d: 0x62232f, e: 0xfdf7ed, k: 0x222222 },
  firstRow: 0, side: [],
  // Each part has its own side view. The head is a squarish ball set to the front of the body; the body is a cylinder
  // with a domed upper end that rises behind the head as the hump back. Its back is bare skin, its front and lower part the brown wrap.
  parts: [
    { rows: [12, 18], firstRow: 12, pow: 0.72, side: ['.......gggggggg.', '.......gggggggg.', '.......gggggggg.', '.......gggggggg.', '.......gggggggg.', '.......gggggggg.', '.......gggggggg.'] },
    { rows: [14, 25], firstRow: 14, side: ['...gggggggg.....', '.gggggggggggg...', '.ggggggggggff...', '.ggggggggffff...', '.ggggggffffff...', '.gggggfffffff...', '.ggggffffffff...', '.gggfffffffff...', '.ggffffffffff...', '.ffffffffffff...', '.ffffffffffff...', '.dddddddddddd...'] },
  ],
  eyes: { rows: [14, 15], width: 1.4, colour: 0x222222, at: 20 },
  spikes: [
    // The tusks stand at the corners of the mouth, further apart than the eyes and below them, as in the sprite.
    { colour: 'e', row: 17.2, front: { of: 'head', inset: 0.75 }, side: { of: 'head', inset: 1.15 }, dir: [0.3, 1, 0.12], radius: 0.55, length: 1.8, sink: 0.25, line: 0.25 },
  ],
  shells: [
    { colour: 'g', thick: 0.3, lift: 0, from: 12.9, to: 13.6, below: true, front: true, cover: [0.34, 0.32], line: 0.25 },   // the brow
    { colour: 'k', thick: 0.06, lift: 0, from: 17.0, to: 17.45, below: true, front: true, cover: [0.2, 0.2], line: 0.05 },   // the mouth, a dark line between the tusks
  ],
  legs: { top: 26, colour: 'd', radius: 2.1, foot: 1.4, apart: 2.8 },
  arms: { row: 18.4, colour: 'g', hand: 'g', radius: 1.5, length: 4.6 },
};
