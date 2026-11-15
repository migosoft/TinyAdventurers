import type { FigureDesc } from '../desc';

export const skelet: FigureDesc = {
  name: 'Skeleton', outline: 0x222222, centre: 8,
  colours: { c: 0xfdf7ed, k: 0x3a3a3a },
  firstRow: 16,
  side: ['.....cccccc.....', '....cccccccc....', '....cccccccc....', '....cccccccc....', '....cccccccc....', '.....cccccc.....',
    '.......cc.......', '.......cc.......', '.......cc.......', '.......cc.......', '.......cc.......'],
  parts: [{ rows: [16, 21] }, { rows: [21, 26] }],   // the skull; the spine
  // Ribs: thin bone rings around the spine, the lowest one smaller.
  rings: [
    { colour: 'c', row: 22.6, like: 23, out: 1.05, thick: 0.28, high: 0.28, line: 0.22 },
    { colour: 'c', row: 23.6, like: 23, out: 1.05, thick: 0.28, high: 0.28, line: 0.22 },
    { colour: 'c', row: 24.6, like: 23, out: 0.75, thick: 0.28, high: 0.28, line: 0.22 },
  ],
  eyes: { rows: [18, 19], width: 2.1, colour: 0x222222, at: 30 },   // the eye sockets
  legs: { top: 26, colour: 'c', radius: 0.75, foot: 0.7, apart: 1.2 },
  arms: { row: 22.3, colour: 'c', hand: 'c', radius: 0.6, length: 3.6, out: 1.1 },
};
