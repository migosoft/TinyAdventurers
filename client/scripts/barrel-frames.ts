// The barrel frames: pixel grids redrawn at 16x22 (about the pack crate's size)
// from an AI-generated barrel made for this game with ChatGPT
// (client/assets-src/barrel/barrel_source.png, a 20x27 grid), in pack colors.
//   barrel        plain wood (a blocking obstacle; not used in the game yet)
//   barrel_explosive  the same barrel with a red wood lid and a red band
import type { Image } from './png';

// Pack colors (0x72 sheet).
const PALETTE: Record<string, string> = {
  k: '222222', // outline
  L: 'ee8e2e', // wood light
  l: 'c56025', // wood
  m: '8f4029', // wood shade
  d: '62232f', // wood dark
  D: '38262d', // seams, gaps
  W: 'fdf7ed', // hoop glint
  H: 'b6cbcf', // hoop light
  h: '7b8994', // hoop
  g: '414859', // hoop dark
  R: 'da4e38', // red wood light
  r: '9f294e', // red wood
  q: '5f2d56', // red wood dark
  Q: '38262d', // red seams
};

// Rows 0-5 the lid, 6-7 its front edge, then the body with two curved hoops.
const BARREL = [
  '.....kkkkkk.....',
  '...kkLLLLLLkk...',
  '..kLddddddddLk..',
  '.kLdllllllmddLk.',
  '.kldlmmmdlllldk.',
  '.kLLkllllllkLLk.',
  'kgmLLkDDDDkLLmgk',
  'kghmLdLLLLdLmhgk',
  'kghhkDmmmmDkhhgk',
  'kkhWhkDDDDkhhhkk',
  'kdkhHHHHhhhhhkdk',
  'kldkkgghhgggkkdk',
  'klldmkkkkkkmlmdk',
  'kmldlDlmmmDlldmk',
  '.kdlmDlmmmDllmk.',
  '.kghkDlmmmDdkhk.',
  '..kghkdddddkhk..',
  '..kghHHHhhhhgk..',
  '...kgghhhgggk...',
  '...kmkkkkkkmk...',
  '....kmDmmmdk....',
  '.....kkkkkk.....',
];

const redden = (s: string) => s.replace(/[Ll]/g, 'R').replace(/m/g, 'r').replace(/d/g, 'q').replace(/D/g, 'Q');
// Red lid (rows 0-5 and the front edge between the hoop ends) and a red band (rows 13-14).
const EXPLOSIVE = BARREL.map((r, y) =>
  y <= 5 ? redden(r) : y <= 7 ? r.slice(0, 3) + redden(r.slice(3, 13)) + r.slice(13) : y === 13 || y === 14 ? r.slice(0, 1) + redden(r.slice(1, 15)) + r.slice(15) : r,
);

interface Frame { x: number; y: number; w: number; h: number }

const FIGURES: Record<string, string[]> = { barrel: BARREL, barrel_explosive: EXPLOSIVE };

/** Draws the barrel frames into one strip `width` px wide. */
export function buildBarrels(width: number): { img: Image; frames: Record<string, Frame> } {
  const h = BARREL.length;
  const img: Image = { w: width, h, data: new Uint8Array(width * h * 4) };
  const frames: Record<string, Frame> = {};
  let x = 0;
  for (const [name, rows] of Object.entries(FIGURES)) {
    rows.forEach((row, y) => {
      if (row.length !== 16) throw new Error(`barrel: ${name} row ${y} is ${row.length} wide, want 16`);
      [...row].forEach((c, cx) => {
        if (c === '.') return;
        const hex = PALETTE[c];
        if (!hex) throw new Error(`barrel: ${name} row ${y} has unknown color '${c}'`);
        img.data.set([0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16)).concat(255), (y * width + x + cx) * 4);
      });
    });
    frames[name] = { x, y: 0, w: 16, h };
    x += 16;
  }
  return { img, frames };
}
