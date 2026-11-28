// The cove's plants, drawn for this game with Claude Code in the pack's
// style and colors: pixel grids (the tree is a 3D willow now, #333).
//   cove_bush_a (16x12), cove_bush_b (12x10),
//   cove_tuft_a (7x8), cove_tuft_b (7x8), cove_fern (11x8)
import type { Image } from './png';

type Rgb = [number, number, number];
// k outline, 0-4 greens dark to light (shared with the grass), a-d wood dark to light.
const P: Record<string, Rgb> = { k: [34, 34, 34], 0: [28, 58, 50], 1: [40, 100, 62], 2: [62, 138, 67], 3: [106, 174, 79], 4: [156, 207, 98],
  a: [58, 35, 40], b: [98, 53, 43], c: [143, 64, 41], d: [176, 112, 74] };

const STRIP_H = 12;

const PLANTS: Record<string, string[]> = {
  cove_bush_a: [
    '.....kkk..kkk...',
    '...kk343kk343k..',
    '..k3343432342k..',
    '.k33432332332k..',
    '.k3432233223321k',
    'k34322332222221k',
    'k32322223222121k',
    'k22222122221211k',
    'k12121112111110k',
    '.k111101110100k.',
    '..kk00k000k0kk..',
    '....kk.kkk.k....',
  ],
  cove_bush_b: [
    '....kkkk....',
    '..kk3343kk..',
    '.k33433432k.',
    'k3343323321k',
    'k3322322221k',
    'k2221222211k',
    'k1211211110k',
    '.k11010100k.',
    '..kkk0k0kk..',
    '.....k.k....',
  ],
  cove_tuft_a: [
    '..4....',
    '.43..4.',
    '.3.4.3.',
    '4.43.3.',
    '3.3234.',
    '.32323.',
    '.21212.',
    '..101..',
  ],
  cove_tuft_b: [
    '....4..',
    '.4..3.4',
    '.3.43.3',
    '..33.3.',
    '4.3323.',
    '3.2322.',
    '.21221.',
    '..1011.',
  ],
  cove_fern: [
    '.....4.....',
    '.4...3...4.',
    '..3..3..3..',
    '4..3.3.3..4',
    '.33.323.33.',
    '...33233...',
    '..1.212.1..',
    '...01110...',
  ],
};

interface Frame { x: number; y: number; w: number; h: number }

/** Draws the plants into one strip `width` px wide. */
export function buildCove(width: number): { img: Image; frames: Record<string, Frame> } {
  const h = STRIP_H;
  const img: Image = { w: width, h, data: new Uint8Array(width * h * 4) };
  const frames: Record<string, Frame> = {};
  let x = 0;
  for (const [name, rows] of Object.entries(PLANTS)) {
    const w = rows[0].length;
    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error(`cove: ${name} row ${y} is ${row.length} wide, want ${w}`);
      [...row].forEach((c, cx) => {
        if (c === '.') return;
        if (!P[c]) throw new Error(`cove: ${name} row ${y} has unknown color '${c}'`);
        img.data.set([...P[c], 255], (y * width + x + cx) * 4);
      });
    });
    frames[name] = { x, y: 0, w, h: rows.length };
    x += w;
  }
  if (x > width) throw new Error('cove: strip wider than the atlas');
  return { img, frames };
}
