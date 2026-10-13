// The lich's own frames, drawn for this game as pixel grids in the 0x72 pack's
// style and colors: a crowned skull in a crimson robe with a gold trim strip,
// floating on a ragged hem, plus its bone staff with an orb. 16x28 like the
// heroes (feet row 27), so it renders at scale 1.
//   lich_idle_anim_f0..3, lich_run_anim_f0..3, weapon_lich_staff (8x30)
import type { Image } from './png';

// Pack colors (0x72 sheet).
const PALETTE: Record<string, string> = {
  k: '222222', // outline
  Y: 'facb3e', // gold
  O: 'ee8e2e', // gold shade
  o: '8f4029', // gold dark
  W: 'fdf7ed', // bone light
  B: 'd3bfa9', // bone
  b: 'aa8d7a', // bone shade
  s: '21141b', // eye sockets, inside the hood
  E: '72d6ce', // eye glow
  e: 'cae6f5', // eye glow, bright
  R: '9f294e', // robe light
  r: '62232f', // robe
  d: '38262d', // robe shadow
  p: '5956bd', // jewel / orb
  q: '1f1833', // orb dark
  g: '97da3f', // orb glint
};

// Facing right (the client mirrors it). Rows 0-23: crown, skull, robe; the hem
// rows below come from HEMS so idle and run can move them.
const BODY = [
  '................',
  '.......k........',
  '......kYk.......',
  '.....kkYkk......',
  '....kYkYkYk.....',
  '....kYkOkYk.....',
  '...kOYYYYYOk....',
  '...koOOpOOok....',
  '..krBWWWWWBrk...',
  '.kkrBssWssbrkk..',
  'kYkrBsEBEsbrkYk.',
  'kYkrWBBsBBbrkOk.',
  'kOYkbWbWbWbkYOk.',
  'kOoRRkbbbkrdoOk.',
  'kRRRrrrsrrrdddk.',
  'kRrrrrOpOrrrddk.',
  '..kkRrrYrrdrkBk.',
  '...kRrrYrrdrkbk.',
  '...kRBBYrrdkkk..',
  '...kRbBYrrddk...',
  '...kRrrYrrddk...',
  '...kRrrYrrddk...',
  '..kRRrrOrrrddk..',
  '..kRrrrOrrrddk..',
];
// Ragged hem (rows 24-27); the lich floats, so the last row stays empty.
const HEMS = {
  a: ['.kRrrrrOrrrdddk.', 'kRrdrrdOrdrrddk.', 'kdkdkrdkdkddkdk.', '.k.k.kk.k.kk.k..'],
  b: ['.kRrrrrOrrrdddk.', 'kRdrrdrOrrdrddk.', 'kkdkrdkdkdkdkdk.', '..k.kk.k.k.kk.k.'],
  // Run: the hem trails behind (to the left).
  c: ['.kRrrrrOrrrddk..', 'kRrdrrdOrdrrdk..', 'dkdkrdkdkddkk...', 'k.k.kk.k.k......'],
  d: ['.kRrrrrOrrrddk..', 'kRdrrdrOrrdrdk..', 'kdkrdkdkdkdk....', '.k.kk.k.kk......'],
};

const STAFF = [
  '..kkkk..',
  '.kpeWpk.',
  'kBpgEpBk',
  'kBqppqBk',
  '.kBqqBk.',
  '..kBBk..',
  ...Array.from({ length: 22 }, (_, i) => (i % 7 === 3 ? '..kWBk..' : '..kBbk..')),
  '..kbbk..',
  '...kk...',
];

interface Frame { x: number; y: number; w: number; h: number }

function check(name: string, rows: string[], w: number, h: number) {
  if (rows.length !== h) throw new Error(`lich: ${name} has ${rows.length} rows, want ${h}`);
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`lich: ${name} row ${i} is ${r.length} wide, want ${w}`);
    for (const c of r) if (c !== '.' && !PALETTE[c]) throw new Error(`lich: ${name} row ${i} has unknown color '${c}'`);
  });
}

/** One frame: the body with a hem, lifted `dy` px, eyes brighter if `glow`. */
function figure(hem: keyof typeof HEMS, dy: number, glow: boolean): string[] {
  const rows = [...BODY, ...HEMS[hem]].map((r) => (glow ? r.replace(/E/g, "e") : r));
  return [...rows.slice(dy), ...Array.from({ length: dy }, () => '.'.repeat(16))];
}

const FIGURES: Record<string, string[]> = {
  lich_idle_anim_f0: figure('a', 1, true),
  lich_idle_anim_f1: figure('b', 2, true),
  lich_idle_anim_f2: figure('a', 2, false),
  lich_idle_anim_f3: figure('b', 1, true),
  lich_run_anim_f0: figure('c', 1, true),
  lich_run_anim_f1: figure('d', 2, true),
  lich_run_anim_f2: figure('c', 2, true),
  lich_run_anim_f3: figure('d', 1, true),
  weapon_lich_staff: STAFF,
};

/** Draws the lich frames into one strip `width` px wide. */
export function buildLich(width: number): { img: Image; frames: Record<string, Frame> } {
  check('body', [...BODY, ...HEMS.a], 16, 28);
  for (const [n, h] of Object.entries(HEMS)) check(`hem ${n}`, h, 16, 4);
  check('staff', STAFF, 8, 30);
  const h = 30;
  const img: Image = { w: width, h, data: new Uint8Array(width * h * 4) };
  const frames: Record<string, Frame> = {};
  let x = 0;
  for (const [name, rows] of Object.entries(FIGURES)) {
    const w = rows[0].length;
    rows.forEach((row, y) =>
      [...row].forEach((c, cx) => {
        if (c === '.') return;
        const hex = PALETTE[c];
        img.data.set([0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16)).concat(255), (y * width + x + cx) * 4);
      }),
    );
    frames[name] = { x, y: 0, w, h: rows.length };
    x += w;
  }
  if (x > width) throw new Error('lich: strip wider than the atlas');
  return { img, frames };
}
