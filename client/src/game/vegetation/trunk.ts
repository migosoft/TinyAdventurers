// Trunk-side helpers shared by the leafy trees and the conifer (#279).
import { type Seg, type Trunk, barkLineCount, limbSteps, rootPaths } from '../../render3d/trees/recipe';
import { type Canvas, DEFAULT_LIGHT, type Light, barkShade, isBark, isLeaf, step } from './canvas';

/** A bark stroke painter for `cv`: writes the picture's colour and the default-light reference's, rim dark on the shadow side. */
export function painter(cv: Canvas, light: Light): (seg: Seg, edge: boolean, maxY?: number) => void {
  return (seg, edge, maxY = Infinity) => {
    for (const p of seg) for (let dy = -Math.ceil(p.w); dy <= Math.ceil(p.w); dy++) for (let dx = -Math.ceil(p.w); dx <= Math.ceil(p.w); dx++) {
      const d = Math.hypot(dx, dy); if (d > p.w) continue; const x = Math.round(p.x + dx), y = Math.round(p.y + dy); if (y > maxY) continue;
      const lit = (dx * light.x + dy * light.y) / Math.max(p.w, 1), litRef = (dx * DEFAULT_LIGHT.x + dy * DEFAULT_LIGHT.y) / Math.max(p.w, 1);
      cv.set(x, y, barkShade(lit, edge && d > p.w - 1), barkShade(litRef, edge && d > p.w - 1));
    }
  };
}

/**
 * Wavy dashed lines along the trunk (4; 2 below 70 % scale) at fixed fractions of its half-width, one step lighter on the
 * sun side of the axis and one darker on the other. Positions come from the trunk and `r()` only; the light picks colours.
 */
export function barkLines(cv: Canvas, r: () => number, tr: Trunk, light: Light, s: number, tTop = 0.97): void {
  const { n, len } = barkLineCount(tr, s, tTop);
  for (let i = 0; i < n; i++) {
    const f = n === 2 ? (i ? 0.75 : -0.75) : -0.75 + (1.5 * i) / (n - 1), ph = r() * 6;
    let on = true;
    for (let k = 0; k <= len; k++) {
      const t = 0.1 + (tTop - 0.1) * (k / len);
      if (r() < 0.12) on = !on;
      if (!on) continue;
      const a = tr.at(t), x = a.x + (f + 0.06 * Math.sin(t * 9 + ph)) * a.w;
      const c = cv.get(x, a.y), cRef = cv.getRef(x, a.y); if (c === null || !isBark(cRef)) continue;
      cv.recolour(x, a.y, step('abcd', c, f * light.x > 0 ? 1 : -1) as string);
      cv.recolourRef(x, a.y, step('abcd', cRef, f * DEFAULT_LIGHT.x > 0 ? 1 : -1) as string);
    }
  }
}

/**
 * Limbs from the fork: quadratic curves to `targets` (design units, mapped with X and Y), half-width 0.62 to 0.12 of the
 * fork's. Painted before the trunk and the crown. Large trees (`detail`) get a dark 1-px line on each limb's shadow side;
 * its random keep draw comes first and both lights' positions are written with recolours.
 */
export function limbs(cv: Canvas, r: () => number, light: Light, fork: { x: number; y: number; w: number }, targets: [number, number][], X: (dx: number) => number, Y: (y: number) => number, detail: boolean): void {
  const paint = painter(cv, light);
  for (const [dx, ty] of targets) {
    const tx = X(dx), tyy = Y(ty), cxp = fork.x + (tx - fork.x) * 0.15, cyp = fork.y + (tyy - fork.y) * 0.75;
    const n = limbSteps(fork, tx, tyy);
    const pts: NormalPt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * fork.x + 2 * u * t * cxp + t * t * tx, y = u * u * fork.y + 2 * u * t * cyp + t * t * tyy;
      const ddx = 2 * u * (cxp - fork.x) + 2 * t * (tx - cxp), ddy = 2 * u * (cyp - fork.y) + 2 * t * (tyy - cyp), m = Math.hypot(ddx, ddy) || 1;
      pts.push({ x, y, w: fork.w * (0.62 - 0.5 * t), nx: -ddy / m, ny: ddx / m });
    }
    paint(pts, false);
    if (detail) shadowLine(cv, r, light, pts);
  }
}

/** A path point with its half-width and unit normal. */
export type NormalPt = { x: number; y: number; w: number; nx: number; ny: number };

/**
 * A dark 1-px line on the shadow side of a stroke (points at least 1.2 px wide, three in four kept). The keep draw comes
 * first, whatever the light; both lights' positions are written with recolours, so no pixel becomes opaque.
 */
export function shadowLine(cv: Canvas, r: () => number, light: Light, pts: NormalPt[]): void {
  for (const p of pts) {
    const keep = r() < 0.75; // drawn first, whatever the light
    if (!keep || p.w < 1.2) continue;
    for (const [L, rec] of [[light, 'picture'], [DEFAULT_LIGHT, 'ref']] as const) {
      const sg = p.nx * L.x + p.ny * L.y > 0 ? -1 : 1, x = p.x + sg * p.nx * (p.w - 0.4), y = p.y + sg * p.ny * (p.w - 0.4);
      if (rec === 'picture') cv.recolour(x, y, 'a'); else cv.recolourRef(x, y, 'a');
    }
  }
}

/** The roots around the foot (`rootPaths`), painted with their rim kept; the lower ones overlap. */
export function roots(r: () => number, paint: (seg: Seg, edge: boolean, maxY?: number) => void, cx: number, footY: number, s: number, tw: number, count: 2 | 3 | 4, lenMul: number): Seg[] {
  const list = rootPaths(r, cx, footY, s, tw, count, lenMul);
  list.forEach((sg) => paint(sg, true));
  return list;
}

/** Moss on the lit root pixels around the foot (leafy greens '2'/'3'), shared by the leafy trees and the conifer. */
export function rootMoss(cv: Canvas, r: () => number, cx: number, footY: number, s: number): void {
  for (let k = 0; k < 40 * s; k++) { const x = cx + (-26 + r() * 52) * s, y = footY - 4 * s + r() * 8 * s; const c = cv.getRef(x, y); if (c && 'cd'.includes(c) && cv.get(x, y - 1) !== null) cv.set(x, y, r() < 0.5 ? '2' : '3'); }
}

/** The crown's shadow on the trunk: the first bark pixels below the leaves in each column, `depth` px deep, one step darker. */
export function canopyShadow(cv: Canvas, depth: number): void {
  const darker: Record<string, string> = { d: 'c', c: 'b', b: 'a', a: 'a' };
  const { x0, y0, x1, y1 } = cv.box();
  for (let x = x0; x <= x1; x++) { let y = y0, seen = false; for (; y <= y1; y++) { const c = cv.px[y * cv.w + x]; if (isLeaf(c)) seen = true; else if (seen && c && c in darker && cv.id[y * cv.w + x] < 0) break; } // a pocket's twig (a lobe id) is not the trunk
    for (let i = 0; i < depth && y + i < cv.h; i++) { const c = cv.get(x, y + i), cRef = cv.getRef(x, y + i); if (c && c in darker && cRef !== null) cv.set(x, y + i, darker[c], darker[cRef] ?? cRef, cv.idAt(x, y + i)); } }
}
