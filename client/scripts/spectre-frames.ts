// The Ghost's and the Shade's frames, 16x16 like the pack monsters (#200). The design is
// an AI-generated ghost (ChatGPT, supplied by the user), redrawn by hand on this grid
// with Claude Code; the Shade is the same body in its own colours. Feet (the hem) on the
// bottom row, so it renders at scale 1.
//   ghost_idle_anim_f0..3, ghost_run_anim_f0..3, shade_idle_anim_f0..3, shade_run_anim_f0..3
import type { Image } from './png';

interface Frame { x: number; y: number; w: number; h: number }

export const SPECTRE_SIZE = 16;

// K outline, W body, L body shade, S hem shadow, E eyes.
export const PALETTES: Record<string, Record<string, string>> = {
  ghost: { K: '222030', W: 'f0f3fa', L: 'ced8ee', S: '96a6ce', E: '343a60' },
  shade: { K: '000000', W: '2a2136', L: '1f1829', S: '140f1c', E: 'd65cff' },
};

// Facing right (the client mirrors it). Head and body; the hem rows below come from
// HEMS and RUN so idle and run can move them.
const BODY = [
  '......KKKK......',
  '....KKWWWWKK....',
  '...KWWWWWWWWK...',
  '...KWWWWWWWWK...',
  '...KLWWEWWEWK...',
  '...KLWWEWWEWK...',
  '...KLWWWWWWWK...',
  '...KLWWWWWWWK...',
];
// Idle: the hem sways between two shapes.
const HEMS = {
  a: ['..KLLWWWWWWWLK..', '..KSLWWLWWLWSK..', '...KSKSLKLSKK...', '....K.KK.KK.....'],
  b: ['..KLLWWWWWWWLK..', '..KSLWLWWLWLSK..', '..KKSKLSKSLKK...', '...K..KK.KK.....'],
};
// Run: the hem trails behind (to the left) with a small wisp.
const RUN = [
  ['.KKLLWWWWWWWLK..', 'KSSLLWLWWLLSK...', 'KK.KSKSLKLSKK...', '....KK.KK.......'],
  ['..KLLWWWWWWWLK..', 'KKSLLWLWWLWSK...', '.KSSKLSKLSKK....', 'KK..K.KK........'],
  ['.KKLLWWWWWWWLK..', 'KSSLWLWWLWLSK...', 'KKKSKLSKSLKK....', '...K.KK.KK......'],
  ['..KLLWWWWWWWLK..', 'KKSLLWLWWLLSK...', 'KSSKSKSLKLKK....', '.KK.K.KK........'],
];

function check(name: string, rows: string[]) {
  rows.forEach((r, i) => {
    if (r.length !== SPECTRE_SIZE) throw new Error(`spectre: ${name} row ${i} is ${r.length} wide, want ${SPECTRE_SIZE}`);
    for (const c of r) if (c !== '.' && !PALETTES.ghost[c]) throw new Error(`spectre: ${name} row ${i} has unknown color '${c}'`);
  });
}

/** One 16x16 frame: the rows placed on the bottom row, then moved `dy` down and `dx` right (clipped). */
function place(rows: string[], dy = 0, dx = 0): string[] {
  const grid = Array.from({ length: SPECTRE_SIZE }, () => [...'.'.repeat(SPECTRE_SIZE)]);
  const top = SPECTRE_SIZE - rows.length + dy;
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      const [X, Y] = [x + dx, y + top];
      if (c !== '.' && X >= 0 && X < SPECTRE_SIZE && Y >= 0 && Y < SPECTRE_SIZE) grid[Y][X] = c;
    }),
  );
  return grid.map((r) => r.join(''));
}

/** The 8 frames of one creature as grids: idle bobs (up on f1, down on f3, which clips the last wisp row), run leans 1 px forward. */
export function spectreGrids(): string[][] {
  return [
    place([...BODY, ...HEMS.a]),
    place([...BODY, ...HEMS.b], -1),
    place([...BODY, ...HEMS.a]),
    place([...BODY, ...HEMS.b], 1),
    ...RUN.map((hem) => place([...BODY, ...hem], 0, 1)),
  ];
}

/** Draws the 16 frames into one strip `width` px wide (16 px tall). */
export function buildSpectres(width: number): { img: Image; frames: Record<string, Frame> } {
  check('body', BODY);
  for (const [n, h] of Object.entries(HEMS)) check(`hem ${n}`, h);
  RUN.forEach((h, i) => check(`run hem ${i}`, h));
  const grids = spectreGrids();
  if (Object.keys(PALETTES).length * grids.length * SPECTRE_SIZE > width) throw new Error('spectre: strip wider than the atlas');
  const img: Image = { w: width, h: SPECTRE_SIZE, data: new Uint8Array(width * SPECTRE_SIZE * 4) };
  const frames: Record<string, Frame> = {};
  let x = 0;
  for (const [creature, pal] of Object.entries(PALETTES))
    grids.forEach((rows, k) => {
      rows.forEach((row, y) =>
        [...row].forEach((c, cx) => {
          if (c === '.') return;
          img.data.set([0, 2, 4].map((i) => parseInt(pal[c].slice(i, i + 2), 16)).concat(255), (y * width + x + cx) * 4);
        }),
      );
      frames[`${creature}_${k < 4 ? 'idle' : 'run'}_anim_f${k & 3}`] = { x, y: 0, w: SPECTRE_SIZE, h: SPECTRE_SIZE };
      x += SPECTRE_SIZE;
    });
  return { img, frames };
}
