// The leafy trees (round, wide, tall): trunk, branches, roots and a crown of clumps (#279).
import type { Shape } from '../vegetation';
import { Canvas, type Drawn, type Light, isLeaf, rng } from './canvas';
import { clumps } from './crown';
import { barkLines, canopyShadow, limbs, painter, rootMoss, roots, trunkPath } from './trunk';

export interface LeafyOpts { seed: number; scale: number; shape: Exclude<Shape, 'conifer'>; light: Light }
const SHAPES: Record<Exclude<Shape, 'conifer'>, { sx: number; sy: number; rx: number; trunk: number; roots: 2 | 3 | 4; rootLen: number; bend: number }> = {
  round: { sx: 1, sy: 1, rx: 1, trunk: 1, roots: 3, rootLen: 1, bend: 1 },
  wide: { sx: 1.3, sy: 0.9, rx: 1.15, trunk: 1.1, roots: 4, rootLen: 1.15, bend: 1.2 },
  tall: { sx: 0.55, sy: 1.3, rx: 0.78, trunk: 0.65, roots: 2, rootLen: 0.6, bend: 0.6 },
};
const CANOPY = [[0, 14, 21, 13], [17, 9, 9, 6], [-25, 24, 16, 11], [25, 23, 17, 11], [-30, 38, 14, 9], [30, 38, 14, 9], [0, 36, 18, 11], [-13, 45, 9, 6]];

/** round/wide/tall. */
export function drawLeafy(o: LeafyOpts): Drawn {
  const r = rng(o.seed), sh = SHAPES[o.shape], s = o.scale, light = o.light;
  const cv = new Canvas(220, 220);
  const cx = 110, base = 190;
  const X = (dx: number) => cx + dx * s * sh.sx, Y = (y: number) => base + (y - 86) * s * sh.sy; // y in design units (0..86)
  const tw = s * sh.trunk; // trunk width factor
  const detail = s >= 0.7, footY = Y(79);
  const paint = painter(cv, light);
  // trunk and limbs: the limbs go first, so the trunk's fork shows below the crown
  const tr = trunkPath(r, cx, Y, s, sh.sx, tw, 54 + (r() - 0.5) * 6, sh.bend);
  const targets: [number, number][] = [[-(17 + r() * 6), 33], [15 + r() * 6, 32], [(r() < 0.5 ? -4 : 4) + (r() - 0.5), 27]];
  limbs(cv, r, light, tr.at(1), o.shape === 'tall' ? targets.slice(0, 2) : targets, X, Y, detail);
  paint(tr.seg, false, footY);
  roots(cv, r, paint, cx, footY, s, tw, sh.roots, sh.rootLen);
  barkLines(cv, r, tr, light, s);
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
