// Vegetation generator (#203): trees and bushes from shapes, in the cove tree's style (#202).
// Geometry is written in "design units" of the 96 px cove tree (foot of the roots at y 86, x 48)
// and scaled; shapes stretch it (wide, tall). Small sizes drop details that would turn to noise.
// The trees are drawn for this game with Claude Code, in the 0x72 pack's palette and style.
// Pure: no Phaser, no DOM, no Node; the atlas script and the game both import it.
type Rgb = [number, number, number];
export type PlantKind = Shape | 'bush';
/** Index = wire id. */
export const PLANT_KINDS: readonly PlantKind[] = ['round', 'wide', 'tall', 'conifer', 'bush'];
export interface Rgba { w: number; h: number; data: Uint8ClampedArray }
/** A drawn plant; `foot` (px, inside img) is the trunk foot: the sprite's origin and its depth. */
export interface Drawn { img: Rgba; foot: { x: number; y: number } }
const P: Record<string, Rgb> = { k: [34, 34, 34], 0: [28, 58, 50], 1: [40, 100, 62], 2: [62, 138, 67], 3: [106, 174, 79], 4: [156, 207, 98],
  5: [22, 48, 52], 6: [30, 74, 70], 7: [44, 104, 88], 8: [74, 140, 104], 9: [118, 176, 124],
  a: [58, 35, 40], b: [98, 53, 43], c: [143, 64, 41], d: [176, 112, 74] };
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const LX = -0.62, LY = -0.78; // light from the top left
export type Shape = 'round' | 'wide' | 'tall' | 'conifer';

interface TreeOpts { seed: number; scale: number; shape: Shape }
const SHAPES: Record<Exclude<Shape, 'conifer'>, { sx: number; sy: number; rx: number; trunk: number; roots: number; rootLen: number }> = {
  round: { sx: 1, sy: 1, rx: 1, trunk: 1, roots: 6, rootLen: 1 },
  wide: { sx: 1.3, sy: 0.9, rx: 1.15, trunk: 1.1, roots: 6, rootLen: 1.15 },
  tall: { sx: 0.55, sy: 1.3, rx: 0.78, trunk: 0.62, roots: 4, rootLen: 0.6 },
};
const CANOPY = [[0, 14, 21, 13], [17, 9, 9, 6], [-25, 24, 16, 11], [25, 23, 17, 11], [-30, 38, 14, 9], [30, 38, 14, 9], [0, 36, 18, 11], [-13, 45, 9, 6]];

class Canvas {
  px: (string | null)[];
  constructor(public w: number, public h: number) { this.px = new Array(w * h).fill(null); }
  set(x: number, y: number, c: string) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
  get(x: number, y: number) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null; }
  clear(x: number, y: number) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = null; }
  /** Outer outline, then crop to the drawing; returns the image and where `foot` lands in it. */
  finish(foot: { x: number; y: number }): Drawn {
    const { w, h } = this; const solid = this.px.map((c) => c !== null);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!solid[i] && ((x + 1 < w && solid[i + 1]) || (x > 0 && solid[i - 1]) || (y + 1 < h && solid[i + w]) || (y > 0 && solid[i - w]))) this.px[i] = 'k';
    }
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    this.px.forEach((c, i) => { if (c) { const x = i % w, y = Math.floor(i / w); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
    if (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) throw new Error('vegetation: the drawing reaches the canvas edge (scale too large)');
    const img: Rgba = { w: x1 - x0 + 1, h: y1 - y0 + 1, data: new Uint8ClampedArray((x1 - x0 + 1) * (y1 - y0 + 1) * 4) };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = this.px[y * w + x]; if (c) img.data.set([...P[c], 255], ((y - y0) * img.w + x - x0) * 4); }
    return { img, foot: { x: Math.round(foot.x - x0), y: Math.round(foot.y - y0) } };
  }
}
const isLeaf = (c: string | null) => c !== null && '0123456789'.includes(c);

/** Leaf clumps: lumpy ovals, back to front, dark-green rim on the shadow side, lower clumps darker. */
function clumps(cv: Canvas, r: () => number, list: { x: number; y: number; rx: number; ry: number; ph?: number; ph2?: number }[], topY: number, spanY: number, pal = '01234') {
  for (const c0 of list) {
    const c = { ...c0, ph: c0.ph ?? r() * 6, ph2: c0.ph2 ?? r() * 6 };
    for (let y = Math.floor(c.y - c.ry * 1.3 - 2); y <= c.y + c.ry * 1.3 + 2; y++) for (let x = Math.floor(c.x - c.rx * 1.3 - 2); x <= c.x + c.rx * 1.3 + 2; x++) {
      const ang = Math.atan2((y - c.y) / c.ry, (x - c.x) / c.rx);
      const lump = 1 + 0.1 * Math.sin(3 * ang + c.ph) + 0.07 * Math.sin(5 * ang + c.ph2) + 0.04 * Math.sin(8 * ang + c.ph * 2);
      const d = Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry) / lump;
      if (d > 1) continue;
      const shadowSide = (x - c.x) * LX + (y - c.y) * LY < 0;
      if (d > 1 - 1.3 / Math.min(c.rx, c.ry) && shadowSide) { cv.set(x, y, pal[0]); continue; }
      const l = ((x - c.x) / c.rx) * LX + ((y - c.y) / c.ry) * LY + (r() - 0.5) * 0.2 - ((c.y - topY) / spanY) * 0.7;
      cv.set(x, y, l > 0.62 ? pal[4] : l > 0.22 ? pal[3] : l > -0.3 ? pal[2] : l > -0.75 ? pal[1] : pal[0]);
    }
  }
}

export function drawTree(o: TreeOpts): Drawn {
  if (o.shape === 'conifer') return drawConifer(o.seed, o.scale);
  return roundish({ ...o, shape: o.shape });
}

/** round/wide/tall. */
function roundish(o: TreeOpts & { shape: Exclude<Shape, 'conifer'> }): Drawn {
  const r = rng(o.seed), sh = SHAPES[o.shape], s = o.scale;
  const cv = new Canvas(220, 220);
  const cx = 110, base = 190;
  const X = (dx: number) => cx + dx * s * sh.sx, Y = (y: number) => base + (y - 86) * s * sh.sy; // y in design units (0..86)
  type Seg = { x: number; y: number; w: number }[];
  const paint = (seg: Seg, edge: boolean, maxY = Infinity) => {
    for (const p of seg) for (let dy = -Math.ceil(p.w); dy <= Math.ceil(p.w); dy++) for (let dx = -Math.ceil(p.w); dx <= Math.ceil(p.w); dx++) {
      const d = Math.hypot(dx, dy); if (d > p.w) continue; const x = Math.round(p.x + dx), y = Math.round(p.y + dy); if (y > maxY) continue;
      const lit = (dx * LX + dy * LY) / Math.max(p.w, 1);
      cv.set(x, y, edge && d > p.w - 1 && lit < -0.2 ? 'a' : lit > 0.55 ? 'd' : lit > 0 ? 'c' : lit > -0.5 ? 'b' : 'a');
    }
  };
  const tw = s * sh.trunk; // trunk width factor
  const footY = Y(79);
  // trunk and branches
  const trunk: Seg = []; for (let i = 0; i <= 44; i++) { const t = i / 44; trunk.push({ x: cx + Math.sin(t * 3.1) * 2 * s * sh.sx, y: Y(46 + 35 * t), w: Math.max(1.5, (6.5 + 1.5 * t + 4.5 * t ** 3) * tw) }); }
  const branches: Seg[] = [];
  for (const [dx, top] of [[-16, 30], [15, 28], [-2, 22]]) { const seg: Seg = []; for (let i = 0; i <= 24; i++) { const t = i / 24; seg.push({ x: X(dx * t * t + Math.sin(t * 4) * 1.5), y: Y(52 - (52 - top) * t), w: Math.max(0.8, (3.4 - t * 2.2) * tw) }); } branches.push(seg); }
  // roots
  const roots: Seg[] = []; const detail = s >= 0.7;
  const root = (x0: number, y0: number, vx: number, vy: number, len: number, w0: number, wig: number, forks: boolean) => {
    const seg: Seg = []; const n = Math.max(6, Math.round(len * 1.5)); let x = x0, y = y0;
    for (let i = 0; i <= n; i++) { const t = i / n; seg.push({ x: x + Math.sin(t * 8 + wig) * 0.7 * t * s, y, w: w0 * (1 - t) ** 1.2 + 0.5 });
      const fy = vy * (1 - 0.6 * t); const m = Math.hypot(vx, fy); x += (vx / m) * (len / n); y += (fy / m) * (len / n); }
    roots.push(seg);
    if (forks && detail && r() < 0.7) { const k = Math.floor(n * (0.35 + r() * 0.2)); const p = seg[k]; root(p.x, p.y, vx * 0.6 + (r() - 0.5) * 0.4, vy + 0.5, len * 0.45, p.w * 0.75, wig + 2, false); }
  };
  const R6: [number, number, number, number][] = [[-1, 0.15, 22, 3.8], [-0.85, 0.5, 19, 3.6], [-0.3, 0.55, 13, 3.4], [0.35, 0.55, 14, 3.4], [0.85, 0.45, 19, 3.6], [1, 0.12, 23, 3.8]];
  const R = sh.roots === 6 ? R6 : [R6[0], R6[2], R6[3], R6[5]];
  for (const [vx, vy, len, w0] of R) { const m = Math.hypot(vx, vy); root(cx + (vx / m) * 5 * tw, footY + (vy / m) * 2 * s, vx, vy, (len + r() * 4) * s * sh.rootLen, Math.max(1.2, w0 * tw), r() * 6, true); }
  for (const sg of branches) paint(sg, false);
  paint(trunk, false, footY);
  roots.sort((A, B) => A[A.length - 1].y - B[B.length - 1].y).forEach((sg) => paint(sg, true));
  if (detail) for (let k = 0; k < 7; k++) { const x0 = cx + (-6 + r() * 12) * tw, y0 = Y(52 + r() * 22), len = (4 + r() * 8) * s; for (let i = 0; i < len; i++) if (cv.get(x0, y0 + i) !== null) cv.set(x0, y0 + i, 'a'); }
  for (let k = 0; k < 40 * s; k++) { const x = cx + (-26 + r() * 52) * s, y = footY - 4 * s + r() * 8 * s; const c = cv.get(x, y); if (c && 'cd'.includes(c) && cv.get(x, y - 1) !== null) cv.set(x, y, r() < 0.5 ? '2' : '3'); }
  // canopy
  const list = CANOPY.map(([dx, y, rx, ry]) => ({ x: X(dx + (r() - 0.5) * 3), y: Y(y + (r() - 0.5) * 2), rx: (rx + (r() - 0.5) * 2) * s * sh.rx, ry: (ry + (r() - 0.5) * 1.5) * s * sh.rx * Math.min(1.1, sh.sy) }));
  clumps(cv, r, list, Y(13), 45 * s * sh.sy, '01234');
  for (let k = 0; k < 160 * s * s; k++) { const x = Math.floor(r() * cv.w), y = Math.floor(r() * cv.h); const c = cv.get(x, y);
    if (c === '2' && cv.get(x + 1, y) === '2') { cv.set(x, y, '3'); if (r() < 0.5) cv.set(x + 1, y - 1, '3'); }
    if (c === '3' && cv.get(x + 1, y) === '3' && r() < 0.5) cv.set(x, y, '4'); }
  // vines (big trees only)
  if (detail) for (let k = 0, made = 0; k < 60 && made < 8 * s; k++) { const x = Math.round(X(-34 + r() * 68)); let y = Math.round(Y(62)); while (y > Y(20) && !isLeaf(cv.get(x, y))) y--;
    if (y <= Y(20) || isLeaf(cv.get(x - 2, y + 2)) || isLeaf(cv.get(x + 2, y + 2))) continue; const len = (3 + Math.floor(r() * 6)) * s; made++;
    for (let i = 1; i <= len; i++) cv.set(x, y + i, i >= len - 0.5 ? '2' : '1'); }
  // the canopy's shadow on the trunk
  const darker: Record<string, string> = { d: 'c', c: 'b', b: 'a', a: 'a' };
  for (let x = 0; x < cv.w; x++) { let y = 0, seen = false; for (; y < cv.h; y++) { const c = cv.px[y * cv.w + x]; if (isLeaf(c)) seen = true; else if (seen && c && c in darker) break; }
    for (let i = 0; i < 7 * s && y + i < cv.h; i++) { const c = cv.get(x, y + i); if (c && c in darker) cv.set(x, y + i, darker[c]); } }
  return cv.finish({ x: cx, y: footY });
}

/** A conifer (fir/spruce): straight tapering trunk, stacked drooping tiers of leaf clumps narrowing to a spire, blue-green palette 5..9. */
function drawConifer(seed: number, s: number): Drawn {
  const r = rng(seed), cv = new Canvas(220, 220), cx = 110, base = 190, detail = s >= 0.7;
  const bare = r() * 0.25 * 82; // bare trunk below the lowest tier, uniform 0-25 % of the height (design units)
  const X = (dx: number) => cx + dx * s, Y = (y: number) => base + (y - 86) * s;
  const footY = Y(82);
  const paint = (px: number, py: number, w: number, edge: boolean, maxY = Infinity) => {
    for (let dy = -Math.ceil(w); dy <= Math.ceil(w); dy++) for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
      const d = Math.hypot(dx, dy); if (d > w) continue; const x = Math.round(px + dx), y = Math.round(py + dy); if (y > maxY) continue;
      const lit = (dx * LX + dy * LY) / Math.max(w, 1);
      cv.set(x, y, edge && d > w - 1 && lit < -0.2 ? 'a' : lit > 0.55 ? 'd' : lit > 0 ? 'c' : lit > -0.5 ? 'b' : 'a');
    }
  };
  // straight trunk, mostly hidden
  for (let i = 0; i <= 40; i++) { const t = i / 40; paint(cx, Y(50 + 32 * t), Math.max(1.5, (3.2 + 1.3 * t + 2.5 * t ** 4) * s), false, footY); }
  // 3-4 short roots
  const R: [number, number][] = detail ? [[-1, 0.2], [-0.35, 0.6], [0.4, 0.55], [1, 0.2]] : [[-1, 0.25], [0, 0.6], [1, 0.25]];
  for (const [vx, vy] of R) { const len = (8 + r() * 3) * s, m = Math.hypot(vx, vy); const n = Math.max(6, Math.round(len * 1.5)); let x = cx + (vx / m) * 3 * s, y = footY - 1;
    for (let i = 0; i <= n; i++) { const t = i / n; paint(x, y, 2.6 * s * (1 - t) ** 1.2 + 0.5, true); const fy = vy * (1 - 0.6 * t), mm = Math.hypot(vx, fy); x += (vx / mm) * (len / n); y += (fy / mm) * (len / n); } }
  // tiers, bottom first so higher ones overlap; each is a centre clump, two side clumps and two drooping tips
  const span = 82 - bare - 29, nominal = s < 0.7 ? 10.5 : 8.4; // tier spacing stays near nominal: longer trunk, fewer tiers
  const n = Math.max(3, Math.round(span / nominal) + 1), step = span / (n - 1), NW = 0.67; // NW slims the silhouette
  const tier = (list: { x: number; y: number; rx: number; ry: number }[], under: boolean) => {
    const before = cv.px.slice(); clumps(cv, r, list, Y(4), 64 * s, '56789');
    if (!under) return;
    const mine = (x: number, y: number) => cv.px[y * cv.w + x] !== before[y * cv.w + x];
    for (let y = 0; y < cv.h - 1; y++) for (let x = 0; x < cv.w; x++) if (mine(x, y) && !mine(x, y + 1)) { cv.px[y * cv.w + x] = '5'; if (y > 0 && mine(x, y - 1) && cv.px[(y - 1) * cv.w + x] !== '5') cv.px[(y - 1) * cv.w + x] = '6'; }
  };
  for (let i = n - 1; i >= 0; i--) {
    const t = i / (n - 1), yc = 17 + i * step, w = (5.5 + t * 19.5 + (r() - 0.5) * 2) * NW;
    const j = () => (r() - 0.5) * 1.5;
    tier([
      { x: X(j()), y: Y(yc + j()), rx: w * 0.6 * s, ry: 6.2 * s },
      ...[-1, 1].map((sg) => ({ x: X(sg * w * 0.6 + j()), y: Y(yc + 4 + j()), rx: w * 0.45 * s, ry: 5.2 * s })),
      ...[-1, 1].map((sg) => ({ x: X(sg * w * 0.98 + j()), y: Y(yc + 8 + j()), rx: w * 0.26 * s, ry: 3.8 * s })),
    ], true);
  }
  tier([{ x: X(0), y: Y(5), rx: 2 * s, ry: 5.5 * s }, { x: X(0), y: Y(10), rx: 3.2 * s, ry: 5 * s }], false); // pointed top
  for (let k = 0; k < 160 * s * s; k++) { const x = Math.floor(r() * cv.w), y = Math.floor(r() * cv.h); const c = cv.get(x, y);
    if (c === '7' && cv.get(x + 1, y) === '7') { cv.set(x, y, '8'); if (r() < 0.5) cv.set(x + 1, y - 1, '8'); }
    if (c === '8' && cv.get(x + 1, y) === '8' && r() < 0.5) cv.set(x, y, '9'); }
  // the lowest tier's shadow on the trunk
  const darker: Record<string, string> = { d: 'c', c: 'b', b: 'a', a: 'a' };
  for (let x = 0; x < cv.w; x++) { let y = 0, seen = false; for (; y < cv.h; y++) { const c = cv.px[y * cv.w + x]; if (isLeaf(c)) seen = true; else if (seen && c && c in darker) break; }
    for (let i = 0; i < 5 * s && y + i < cv.h; i++) { const c = cv.get(x, y + i); if (c && c in darker) cv.set(x, y + i, darker[c]); } }
  return cv.finish({ x: cx, y: footY });
}

/** How much wider a bush is drawn than the width its clump layout is sized for (measured over many seeds and sizes). */
const BUSH_SPREAD = 1.28;

/** A bush: 3-6 leaf clumps on the ground, no trunk; `width` is the drawn width in px (about, to a few px). */
export function drawBush(o: { seed: number; width: number }): Drawn {
  const { seed } = o;
  const width = o.width / BUSH_SPREAD; // the clump layout below is sized by its centre spacing; the drawn bush spreads wider
  const r = rng(seed); const cv = new Canvas(120, 100); const cx = 60, ground = 85;
  const s = width / 32, n = o.width < 28 ? 3 : o.width < 40 ? 4 : 5; // clump count by the drawn size
  const list: { x: number; y: number; rx: number; ry: number }[] = [];
  list.push({ x: cx + (r() - 0.5) * 3 * s, y: ground - 13 * s, rx: (10 + r() * 2) * s, ry: (7 + r()) * s }); // back top
  for (let i = 0; i < n - 1; i++) { const t = i / (n - 2); list.push({ x: cx + (t - 0.5) * 20 * s + (r() - 0.5) * 3 * s, y: ground - (6 + r() * 2) * s, rx: (8 + r() * 3) * s, ry: (6 + r() * 1.5) * s }); }
  clumps(cv, r, list, ground - 20 * s, 18 * s);
  for (let k = 0; k < 40 * s * s; k++) { const x = Math.floor(r() * cv.w), y = Math.floor(r() * cv.h); if (cv.get(x, y) === '2' && cv.get(x + 1, y) === '2') { cv.set(x, y, '3'); if (r() < 0.5) cv.set(x + 1, y - 1, '3'); } }
  // flat dark underside where the bush meets the ground
  for (let x = 0; x < cv.w; x++) for (let y = ground; y < cv.h; y++) cv.clear(x, y);
  for (let x = 0; x < cv.w; x++) if (isLeaf(cv.get(x, ground - 1))) { cv.set(x, ground - 1, '0'); if (isLeaf(cv.get(x, ground - 2))) cv.set(x, ground - 2, '1'); }
  return cv.finish({ x: cx, y: ground });
}

/** One plant by wire id kind; trees scale by `scalePct` / 100, a bush is 32 px wide at 100. */
export function drawPlant(kind: PlantKind, seed: number, scalePct: number): Drawn {
  if (kind === 'bush') return drawBush({ seed, width: (32 * scalePct) / 100 });
  return drawTree({ seed, scale: scalePct / 100, shape: kind });
}

/** The trunk foot inside the cove tree's frame (px): the sprite's origin and its depth. */
export const COVE_TREE_FOOT = { x: 48, y: 80 };

/** The atlas frame cove_tree (96x100): seed 11, round, scale 1, its foot at COVE_TREE_FOOT. */
export function coveTree(): Rgba {
  const { img, foot } = drawTree({ seed: 11, scale: 1, shape: 'round' });
  const W = 96, H = 100, ox = COVE_TREE_FOOT.x - foot.x, oy = COVE_TREE_FOOT.y - foot.y;
  if (ox < 0 || oy < 0 || ox + img.w > W || oy + img.h > H) throw new Error(`vegetation: the cove tree (${img.w}x${img.h}, foot ${foot.x},${foot.y}) does not fit its 96x100 frame`);
  const out: Rgba = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < img.h; y++) out.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((oy + y) * W + ox) * 4);
  return out;
}
