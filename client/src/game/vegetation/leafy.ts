// The leafy trees (round, wide, tall): trunk, branches, roots and a crown of clumps (#279).
import type { Shape } from '../vegetation';
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, barkShade, isLeaf, rng } from './canvas';
import { clumps } from './crown';
import { canopyShadow, rootMoss } from './trunk';

export interface LeafyOpts { seed: number; scale: number; shape: Exclude<Shape, 'conifer'>; light: Light }
const SHAPES: Record<Exclude<Shape, 'conifer'>, { sx: number; sy: number; rx: number; trunk: number; roots: number; rootLen: number }> = {
  round: { sx: 1, sy: 1, rx: 1, trunk: 1, roots: 6, rootLen: 1 },
  wide: { sx: 1.3, sy: 0.9, rx: 1.15, trunk: 1.1, roots: 6, rootLen: 1.15 },
  tall: { sx: 0.55, sy: 1.3, rx: 0.78, trunk: 0.62, roots: 4, rootLen: 0.6 },
};
const CANOPY = [[0, 14, 21, 13], [17, 9, 9, 6], [-25, 24, 16, 11], [25, 23, 17, 11], [-30, 38, 14, 9], [30, 38, 14, 9], [0, 36, 18, 11], [-13, 45, 9, 6]];

/** round/wide/tall. */
export function drawLeafy(o: LeafyOpts): Drawn {
  const r = rng(o.seed), sh = SHAPES[o.shape], s = o.scale, light = o.light;
  const cv = new Canvas(220, 220);
  const cx = 110, base = 190;
  const X = (dx: number) => cx + dx * s * sh.sx, Y = (y: number) => base + (y - 86) * s * sh.sy; // y in design units (0..86)
  type Seg = { x: number; y: number; w: number }[];
  const paint = (seg: Seg, edge: boolean, maxY = Infinity) => {
    for (const p of seg) for (let dy = -Math.ceil(p.w); dy <= Math.ceil(p.w); dy++) for (let dx = -Math.ceil(p.w); dx <= Math.ceil(p.w); dx++) {
      const d = Math.hypot(dx, dy); if (d > p.w) continue; const x = Math.round(p.x + dx), y = Math.round(p.y + dy); if (y > maxY) continue;
      const lit = (dx * light.x + dy * light.y) / Math.max(p.w, 1), litRef = (dx * DEFAULT_LIGHT.x + dy * DEFAULT_LIGHT.y) / Math.max(p.w, 1);
      cv.set(x, y, barkShade(lit, edge && d > p.w - 1), barkShade(litRef, edge && d > p.w - 1));
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
  rootMoss(cv, r, cx, footY, s);
  // canopy
  const list = CANOPY.map(([dx, y, rx, ry]) => ({ x: X(dx + (r() - 0.5) * 3), y: Y(y + (r() - 0.5) * 2), rx: (rx + (r() - 0.5) * 2) * s * sh.rx, ry: (ry + (r() - 0.5) * 1.5) * s * sh.rx * Math.min(1.1, sh.sy) }));
  clumps(cv, r, list, Y(13), 45 * s * sh.sy, '01234', light);
  for (let k = 0; k < 160 * s * s; k++) { const x = Math.floor(r() * cv.w), y = Math.floor(r() * cv.h); const c = cv.getRef(x, y);
    if (c === '2' && cv.getRef(x + 1, y) === '2') { cv.set(x, y, '3'); if (r() < 0.5) cv.set(x + 1, y - 1, '3'); }
    if (c === '3' && cv.getRef(x + 1, y) === '3' && r() < 0.5) cv.set(x, y, '4'); }
  // vines (big trees only)
  if (detail) for (let k = 0, made = 0; k < 60 && made < 8 * s; k++) { const x = Math.round(X(-34 + r() * 68)); let y = Math.round(Y(62)); while (y > Y(20) && !isLeaf(cv.get(x, y))) y--;
    if (y <= Y(20) || isLeaf(cv.get(x - 2, y + 2)) || isLeaf(cv.get(x + 2, y + 2))) continue; const len = (3 + Math.floor(r() * 6)) * s; made++;
    for (let i = 1; i <= len; i++) cv.set(x, y + i, i >= len - 0.5 ? '2' : '1'); }
  canopyShadow(cv, 7 * s);
  return cv.finish({ x: cx, y: footY });
}
