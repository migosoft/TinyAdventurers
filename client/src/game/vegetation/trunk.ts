// Trunk-side helpers shared by the leafy trees and the conifer (#279).
import { type Canvas, DEFAULT_LIGHT, type Light, barkShade, isBark, isLeaf, step } from './canvas';

/** A stroke: discs of half-width `w` along a path. */
export type Seg = { x: number; y: number; w: number }[];

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

export interface Trunk {
  /** The axis at t (0 = foot, 1 = fork): position and half-width in px. */
  at(t: number): { x: number; y: number; w: number };
  seg: Seg;
  topY: number;
  footY: number;
}

/**
 * A bent, tapering trunk from the foot (design y 79) to the fork (design y `forkY`): a bend B·sin(πt) (up to ±5 units times
 * `bend`), a lean of up to ±3 units and a 0.6-unit wobble; half-width 6.0 − 3.2 t units times `tw`, plus a foot flare
 * 1.6·(1 − t/0.2)² in the lowest fifth. `Y` maps design y to px, `sx` stretches x, `tw` is scale times the shape's trunk factor.
 */
export function trunkPath(r: () => number, cx: number, Y: (y: number) => number, s: number, sx: number, tw: number, forkY: number, bend: number): Trunk {
  const B = (r() < 0.5 ? -1 : 1) * (1.5 + r() * 3.5) * bend, lean = (r() - 0.5) * 6, ph = r() * 6;
  const at = (t: number) => ({
    x: cx + (B * Math.sin(Math.PI * t) + lean * t + 0.6 * Math.sin(t * 9 + ph)) * s * sx,
    y: Y(79 + (forkY - 79) * t),
    w: Math.max(1.2, (6.0 - 3.2 * t + (t < 0.2 ? 1.6 * (1 - t / 0.2) ** 2 : 0)) * tw),
  });
  const seg: Seg = []; for (let i = 0; i <= 48; i++) seg.push(at(i / 48));
  return { at, seg, topY: Y(forkY), footY: Y(79) };
}

/**
 * Wavy dashed lines along the trunk (4; 2 below 70 % scale) at fixed fractions of its half-width, one step lighter on the
 * sun side of the axis and one darker on the other. Positions come from the trunk and `r()` only; the light picks colours.
 */
export function barkLines(cv: Canvas, r: () => number, tr: Trunk, light: Light, s: number, tTop = 0.97): void {
  const n = s >= 0.7 ? 4 : 2, len = Math.max(8, Math.ceil((tr.footY - tr.topY) * tTop));
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
    const n = Math.max(8, Math.ceil(Math.hypot(tx - fork.x, tyy - fork.y) * 2));
    const pts: { x: number; y: number; w: number; nx: number; ny: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * fork.x + 2 * u * t * cxp + t * t * tx, y = u * u * fork.y + 2 * u * t * cyp + t * t * tyy;
      const ddx = 2 * u * (cxp - fork.x) + 2 * t * (tx - cxp), ddy = 2 * u * (cyp - fork.y) + 2 * t * (tyy - cyp), m = Math.hypot(ddx, ddy) || 1;
      pts.push({ x, y, w: fork.w * (0.62 - 0.5 * t), nx: -ddy / m, ny: ddx / m });
    }
    paint(pts, false);
    if (!detail) continue;
    for (const p of pts) {
      const keep = r() < 0.75; // drawn first, whatever the light
      if (!keep || p.w < 1.2) continue;
      for (const [L, rec] of [[light, 'picture'], [DEFAULT_LIGHT, 'ref']] as const) {
        const sg = p.nx * L.x + p.ny * L.y > 0 ? -1 : 1, x = p.x + sg * p.nx * (p.w - 0.4), y = p.y + sg * p.ny * (p.w - 0.4);
        if (rec === 'picture') cv.recolour(x, y, 'a'); else cv.recolourRef(x, y, 'a');
      }
    }
  }
}

const ROOT_DIRS: Record<2 | 3 | 4, [number, number, number, number][]> = {
  4: [[-1, 0.2, 11, 2.8], [-0.4, 0.55, 7, 2.4], [0.45, 0.55, 7, 2.4], [1, 0.18, 12, 2.8]],
  3: [[-1, 0.22, 11, 2.8], [0.2, 0.6, 6, 2.2], [1, 0.2, 11, 2.8]],
  2: [[-1, 0.25, 9, 2.6], [1, 0.25, 9, 2.6]],
};

/** A few short humps around the foot: length + r()·4 units times `lenMul`, tapering by (1 − t)^1.1, the rim kept; the lower ones overlap. */
export function roots(_cv: Canvas, r: () => number, paint: (seg: Seg, edge: boolean, maxY?: number) => void, cx: number, footY: number, s: number, tw: number, count: 2 | 3 | 4, lenMul: number): void {
  const list: Seg[] = [];
  for (const [vx, vy, len0, hw] of ROOT_DIRS[count]) {
    const len = (len0 + r() * 4) * s * lenMul, wig = r() * 6, w0 = Math.max(1.2, hw * tw), m = Math.hypot(vx, vy);
    const n = Math.max(6, Math.round(len * 1.5)); let x = cx + (vx / m) * 4 * tw, y = footY + (vy / m) * 2 * s;
    const seg: Seg = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; seg.push({ x: x + Math.sin(t * 8 + wig) * 0.7 * t * s, y, w: w0 * (1 - t) ** 1.1 + 0.5 });
      const fy = vy * (1 - 0.6 * t), mm = Math.hypot(vx, fy); x += (vx / mm) * (len / n); y += (fy / mm) * (len / n);
    }
    list.push(seg);
  }
  list.sort((A, B) => A[A.length - 1].y - B[B.length - 1].y).forEach((sg) => paint(sg, true));
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
