// The cove's tree and plants, drawn for this game with Claude Code in the pack's
// style and colors. The tree is generated from shapes (leaf clumps lit from the
// top left, a tapered trunk, curved roots, hanging vines) by drawTree(seed), so
// other trees can be made with other seeds; the bushes, tufts and fern are pixel
// grids.
//   cove_tree (96x100), cove_bush_a (16x12), cove_bush_b (12x10),
//   cove_tuft_a (7x8), cove_tuft_b (7x8), cove_fern (11x8)
import type { Image } from './png';

type Rgb = [number, number, number];
// k outline, 0-4 greens dark to light (shared with the grass), a-d wood dark to light.
const P: Record<string, Rgb> = { k: [34, 34, 34], 0: [28, 58, 50], 1: [40, 100, 62], 2: [62, 138, 67], 3: [106, 174, 79], 4: [156, 207, 98],
  a: [58, 35, 40], b: [98, 53, 43], c: [143, 64, 41], d: [176, 112, 74] };

/** The trunk foot inside cove_tree (px): the origin of the sprite and its depth. */
export const COVE_TREE_FOOT = { x: 48, y: 79 };

const TREE_W = 96, TREE_H = 100;

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** A 96x100 tree; the seed varies the clumps, roots, bark and vines. */
export function drawTree(seed: number): Image {
  const r = rng(seed);
  const W = TREE_W, H = TREE_H;
  const px: (string | null)[] = new Array(W * H).fill(null);
  const set = (x: number, y: number, c: string) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c; };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? px[y * W + x] : null);
  const LX = -0.62, LY = -0.78; // light from the top left

  // ---- roots and trunk (drawn first; the canopy covers the trunk top) ----
  const cx = 48, base = 86, trunkTop = 46;
  type Seg = { x: number; y: number; w: number }[];
  // trunk: slight S curve, flaring out towards the foot
  const trunk: Seg = []; for (let i = 0; i <= 44; i++) { const t = i / 44; trunk.push({ x: cx + Math.sin(t * 3.1) * 2, y: trunkTop + (base - 5 - trunkTop) * t, w: 6.5 + 1.5 * t + 4.5 * t ** 3 }); }
  // branches up into the canopy
  const branches: Seg[] = [];
  for (const [dx, top] of [[-16, 30], [15, 28], [-2, 22]]) { const seg: Seg = []; for (let i = 0; i <= 24; i++) { const t = i / 24; seg.push({ x: cx + dx * t * t + Math.sin(t * 4) * 1.5, y: trunkTop + 6 - (trunkTop + 6 - top) * t, w: 3.4 - t * 2.2 }); } branches.push(seg); }
  // roots: thick where they leave the trunk foot, spreading sideways and towards the viewer (down on screen),
  // bending flatter as they go, tapering to a point; the bigger ones may fork
  const roots: Seg[] = [];
  const root = (x0: number, y0: number, vx: number, vy: number, len: number, w0: number, wig: number, forks: boolean) => {
    const seg: Seg = []; const n = Math.max(10, Math.round(len * 1.5)); let x = x0, y = y0;
    for (let i = 0; i <= n; i++) { const t = i / n;
      seg.push({ x: x + Math.sin(t * 8 + wig) * 0.7 * t, y, w: w0 * (1 - t) ** 1.2 + 0.5 });
      const fy = vy * (1 - 0.6 * t); const m = Math.hypot(vx, fy); x += (vx / m) * (len / n); y += (fy / m) * (len / n); }
    roots.push(seg);
    if (forks && r() < 0.7) { const k = Math.floor(n * (0.35 + r() * 0.2)); const p = seg[k];
      root(p.x, p.y, vx * 0.6 + (r() - 0.5) * 0.4, vy + 0.5, len * 0.45, p.w * 0.75, wig + 2, false); }
  };
  const R0: [number, number, number, number][] = [[-1, 0.15, 22, 3.8], [-0.85, 0.5, 19, 3.6], [-0.3, 0.55, 13, 3.4], [0.35, 0.55, 14, 3.4], [0.85, 0.45, 19, 3.6], [1, 0.12, 23, 3.8]];
  for (const [vx, vy, len, w0] of R0) { const m = Math.hypot(vx, vy); root(cx + (vx / m) * 5, base - 7 + (vy / m) * 2, vx, vy, len + r() * 4, w0, r() * 6, true); }
  // paint wood: no per-part outline; each part's shadow side gets a dark-brown edge, so parts stay apart
  const paint = (seg: Seg, edge: boolean, maxY = Infinity) => {
    for (const p of seg) for (let dy = -Math.ceil(p.w); dy <= Math.ceil(p.w); dy++) for (let dx = -Math.ceil(p.w); dx <= Math.ceil(p.w); dx++) {
      const d = Math.hypot(dx, dy); if (d > p.w) continue; const x = Math.round(p.x + dx), y = Math.round(p.y + dy);
      if (y > maxY) continue;
      const lit = (dx * LX + dy * LY) / Math.max(p.w, 1);
      set(x, y, edge && d > p.w - 1 && lit < -0.2 ? 'a' : lit > 0.55 ? 'd' : lit > 0 ? 'c' : lit > -0.5 ? 'b' : 'a');
    }
  };
  // branches first, then the trunk, then the roots on top
  for (const sg of branches) paint(sg, false);
  paint(trunk, false, base - 7);
  // roots after the trunk, the ones reaching lowest (closest to the viewer) last
  roots.sort((A, B) => A[A.length - 1].y - B[B.length - 1].y).forEach((sg) => paint(sg, true));
  // bark: a few dark vertical grooves on the trunk
  for (let k = 0; k < 7; k++) { const x0 = cx - 6 + r() * 12, y0 = trunkTop + 6 + r() * 26, len = 4 + r() * 8; for (let i = 0; i < len; i++) if (get(x0 + Math.sin(i * 0.4) * 0.6, y0 + i) !== null) set(x0 + Math.sin(i * 0.4) * 0.6, y0 + i, 'a'); }
  // moss on roots and trunk foot
  for (let k = 0; k < 40; k++) { const x = cx - 26 + r() * 52, y = base - 14 + r() * 10; const c = get(x, y); if (c && 'cd'.includes(c) && get(x, y - 1) !== null) set(x, y, r() < 0.5 ? '2' : '3'); }

  // ---- canopy: clumps in a dome, back (top) first, each with its own outline ring ----
  const clumps: { x: number; y: number; rx: number; ry: number; ph: number; ph2: number }[] = [
    [0, 14, 21, 13], [17, 9, 9, 6], [-25, 24, 16, 11], [25, 23, 17, 11], [-30, 38, 14, 9], [30, 38, 14, 9], [0, 36, 18, 11], [-13, 45, 9, 6],
  ].map(([dx, y, rx, ry]) => ({ x: cx + dx + (r() - 0.5) * 3, y: y + (r() - 0.5) * 2, rx: rx + (r() - 0.5) * 2, ry: ry + (r() - 0.5) * 1.5, ph: r() * 6, ph2: r() * 6 }));
  type Clump = (typeof clumps)[number];
  const leaf = (x: number, y: number, c: Clump) => {
    const nx = (x - c.x) / c.rx, ny = (y - c.y) / c.ry; const l = nx * LX + ny * LY + (r() - 0.5) * 0.2 - (c.y - 13) / 45;
    return l > 0.62 ? '4' : l > 0.22 ? '3' : l > -0.3 ? '2' : l > -0.75 ? '1' : '0';
  };
  for (const c of clumps) {
    for (let y = Math.floor(c.y - c.ry * 1.3 - 2); y <= c.y + c.ry * 1.3 + 2; y++) for (let x = Math.floor(c.x - c.rx * 1.3 - 2); x <= c.x + c.rx * 1.3 + 2; x++) {
      const ang = Math.atan2((y - c.y) / c.ry, (x - c.x) / c.rx);
      const lump = 1 + 0.1 * Math.sin(3 * ang + c.ph) + 0.07 * Math.sin(5 * ang + c.ph2) + 0.04 * Math.sin(8 * ang + c.ph * 2);
      const d = Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry) / lump; // < 1 inside the lumpy oval
      if (d > 1) continue;
      const shadowSide = ((x - c.x) * LX + (y - c.y) * LY) < 0;
      set(x, y, d > 1 - 1.3 / Math.min(c.rx, c.ry) && shadowSide ? '0' : leaf(x, y, c));
    }
  }
  // leaf texture: little highlight pairs like the bushes, and a dark underside
  for (let k = 0; k < 160; k++) { const x = Math.floor(r() * W), y = Math.floor(r() * 62); const c = get(x, y);
    if (c === '2' && get(x + 1, y) === '2') { set(x, y, '3'); if (r() < 0.5) set(x + 1, y - 1, '3'); }
    if (c === '3' && get(x + 1, y) === '3' && r() < 0.5) set(x, y, '4'); }
  for (let y = 0; y < 64; y++) for (let x = 0; x < W; x++) if (get(x, y) !== null && get(x, y) !== 'k' && '1234'.includes(get(x, y)!) && (get(x, y + 1) === 'k' || get(x, y + 1) === null) && get(x, y + 2) !== null) set(x, y, '0');
  // hanging vines from the canopy underside
  const isLeaf = (c: string | null) => c !== null && '01234'.includes(c);
  for (let k = 0, made = 0; k < 60 && made < 8; k++) { const x = Math.round(cx - 34 + r() * 68); let y = 62; while (y > 20 && !isLeaf(get(x, y))) y--;
    if (y <= 20 || isLeaf(get(x - 2, y + 2)) || isLeaf(get(x + 2, y + 2))) continue;
    const len = 3 + Math.floor(r() * 6); made++;
    for (let i = 1; i <= len; i++) { set(x, y + i, i === len ? '2' : '1'); if (i === len - 1 && r() < 0.6) set(x + (r() < 0.5 ? -1 : 1), y + i, '2'); } }
  // the canopy's shadow on the trunk and branches: one shade darker just under the leaves
  const darker: Record<string, string> = { d: 'c', c: 'b', b: 'a', a: 'a' };
  for (let x = 0; x < W; x++) { let y = 0, seenLeaf = false; for (; y < H; y++) { const c = get(x, y); if (isLeaf(c)) seenLeaf = true; else if (seenLeaf && c && c in darker) break; }
    for (let i = 0; i < 7 && y + i < H; i++) { const c = get(x, y + i); if (c && c in darker) set(x, y + i, darker[c]); } }
  // ---- outer outline for the whole silhouette ----
  const solid = px.map((c) => c !== null);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!solid[y * W + x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => solid[(y + dy) * W + x + dx] && x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H)) px[y * W + x] = 'k';

  const img: Image = { w: W, h: H, data: new Uint8Array(W * H * 4) };
  px.forEach((c, i) => { if (c) img.data.set([...P[c], 255], i * 4); });
  return img;
}

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

/** Draws the tree (seed 11) and the plants into one strip `width` px wide. */
export function buildCove(width: number): { img: Image; frames: Record<string, Frame> } {
  const tree = drawTree(11);
  const h = TREE_H;
  const img: Image = { w: width, h, data: new Uint8Array(width * h * 4) };
  const frames: Record<string, Frame> = {};
  let x = 0;
  for (let y = 0; y < tree.h; y++) img.data.set(tree.data.subarray(y * tree.w * 4, (y + 1) * tree.w * 4), (y * width + x) * 4);
  frames.cove_tree = { x, y: 0, w: tree.w, h: tree.h };
  x += tree.w;
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
