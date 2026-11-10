// The lobed crown with its pockets and vines (leafy trees and bushes) (#279).
import { type Canvas, DEFAULT_LIGHT, type Light, isLeaf, step } from './canvas';

/** A crown lobe in px: centre, radii and the two phases of its scalloped outline. Its draw index is its seam id. */
export interface Lobe { x: number; y: number; rx: number; ry: number; ph: number; ph2: number }
export interface CrownOpts {
  /** The crown's bounding ellipse (px) for the crown-wide gradient. */
  cx: number; cy: number; crx: number; cry: number;
  /** The crown's top row and height (px) for the darkening toward the bottom. */
  topY: number; spanY: number;
  /** The five greens, dark to light. */
  pal: string; light: Light;
  /** Lifts the light toward the top (bushes use 0.3, trees 0). */
  bias: number;
}

const quant = (l: number, pal: string) => (l > 0.6 ? pal[4] : l > 0.2 ? pal[3] : l > -0.3 ? pal[2] : l > -0.75 ? pal[1] : pal[0]);
/** One pixel's green for the light (lx, ly): sphere, crown gradient (gx, gy), height term, noise; a dark rim on the shadow side, a lit one on the sun side. No allocation. */
function lobeGreen(pal: string, ux: number, uy: number, raw: number, gx: number, gy: number, lx: number, ly: number, hh: number, noise: number, edge: boolean): string {
  const dot = ux * lx + uy * ly;
  let l = 0.75 * dot + 0.55 * (gx * lx + gy * ly) - hh + noise + 0.25;
  if (edge) { const nd = raw > 0 ? dot / raw : 0; if (nd < -0.1) return pal[0]; if (nd > 0.3) l += 0.6; }
  return quant(l, pal);
}

/**
 * The lobed crown: `lobes` are drawn in the given order (lowest first), each a scalloped ellipse shaded by its own sphere,
 * the crown's gradient and the height; then dabs (lighter clusters on each lobe's sun side) and seams (a dark line under the
 * lip of every lobe in front). The geometry of a pixel is computed once and only the shading twice (picture and
 * default-light reference). The noise draw is made for every pixel inside a lobe, whatever the light.
 */
export function crown(cv: Canvas, r: () => number, lobes: Lobe[], o: CrownOpts): void {
  const { pal, light, bias } = o, same = light.x === DEFAULT_LIGHT.x && light.y === DEFAULT_LIGHT.y;
  const lx = light.x, ly = light.y - bias, dx = DEFAULT_LIGHT.x, dy = DEFAULT_LIGHT.y - bias;
  const icrx = 1 / o.crx, icry = 1 / o.cry;
  lobes.forEach((b, id) => {
    const irx = 1 / b.rx, iry = 1 / b.ry, edgeT = 1 - 1.4 / Math.min(b.rx, b.ry), safe = 0.86 * edgeT;
    for (let y = Math.floor(b.y - b.ry * 1.15 - 1); y <= Math.ceil(b.y + b.ry * 1.15 + 1); y++) for (let x = Math.floor(b.x - b.rx * 1.15 - 1); x <= Math.ceil(b.x + b.rx * 1.15 + 1); x++) {
      const ux = (x - b.x) * irx, uy = (y - b.y) * iry, raw = Math.sqrt(ux * ux + uy * uy);
      if (raw > 1.14) continue;
      let edge = false;
      if (raw > safe) { // near the outline: the scallops matter
        const ang = Math.atan2(uy, ux), d = raw / (1 + 0.06 * Math.sin(5 * ang + b.ph) + 0.05 * Math.sin(9 * ang + b.ph2) + 0.03 * Math.sin(14 * ang + b.ph * 2));
        if (d > 1) continue;
        edge = d > edgeT;
      }
      const noise = (r() - 0.5) * 0.14, gx = (x - o.cx) * icrx, gy = (y - o.cy) * icry, hh = (0.7 * (y - o.topY)) / o.spanY;
      const c = lobeGreen(pal, ux, uy, raw, gx, gy, lx, ly, hh, noise, edge);
      cv.set(x, y, c, same ? c : lobeGreen(pal, ux, uy, raw, gx, gy, dx, dy, hh, noise, edge), id);
    }
  });
  // dabs: every draw is made first; only the colours of already opaque pixels of the lobe change, at the sun's side for each light
  const aL = Math.atan2(light.y, light.x), aD = Math.atan2(DEFAULT_LIGHT.y, DEFAULT_LIGHT.x);
  lobes.forEach((b, id) => {
    for (let k = 0, n = Math.round((b.rx * b.ry) / 16); k < n; k++) {
      const a = (r() - 0.5) * 2.4, rad = 0.15 + 0.6 * r(), wide = r() < 0.5, extra = r() < 0.5;
      for (let pass = 0; pass < 2; pass++) {
        const ang = (pass ? aD : aL) + a, x = Math.round(b.x + b.rx * rad * Math.cos(ang)), y = Math.round(b.y + b.ry * rad * Math.sin(ang));
        for (let q = 0; q < 4; q++) {
          if (q === 3 && !extra) break;
          const px = x + (q === 0 ? 0 : q === 1 ? 1 : q === 2 && wide ? 2 : q === 2 ? 0 : 1), py = y + (q === 2 && !wide ? -1 : q === 3 ? -1 : 0);
          if (cv.idAt(px, py) !== id) continue;
          if (pass) { const c = cv.getRef(px, py); if (c !== null && c !== pal[0]) cv.recolourRef(px, py, step(pal, c, 1) as string); }
          else { const c = cv.get(px, py); if (c !== null && c !== pal[0]) cv.recolour(px, py, step(pal, c, 1) as string); }
        }
      }
    }
  });
  // seams: a pixel with a pixel of a lobe in front (a higher id) 1 to 2 px above is darkened by three steps; from the ids only
  const { x0, y0, x1, y1 } = cv.box(), w = cv.w;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x, id = cv.id[i];
    if (id < 0 || y < 2 || x < 1 || x + 1 >= w) continue;
    const u = i - w, u2 = i - 2 * w;
    if (cv.id[u] > id || cv.id[u - 1] > id || cv.id[u + 1] > id || cv.id[u2] > id) {
      cv.px[i] = step(pal, cv.px[i], -3) as string; cv.ref[i] = step(pal, cv.ref[i], -3) as string;
    }
  }
}

/**
 * Dark openings in the crown's lower part: up to `n` scalloped ellipses (2.5-5 by 1.5-3 units) in the two darkest greens, only
 * where leaf surrounds them. On large trees (`twig`) 70 % show a short diagonal bark line, dark above and mid brown below.
 * Every draw of an attempt comes first; the tests read presence only. Returns how many were made.
 */
export function pockets(cv: Canvas, r: () => number, o: { cx: number; y0: number; y1: number; halfW: number; s: number; pal: string; n: number; twig: boolean }): number {
  const done: { x: number; y: number; rx: number }[] = [];
  for (let k = 0; k < 40 && done.length < o.n; k++) {
    const x = o.cx + (r() * 2 - 1) * o.halfW, y = o.y0 + r() * (o.y1 - o.y0), rx = (2.5 + r() * 2.5) * o.s, ry = (1.5 + r() * 1.5) * o.s, ph = r() * 6, tw = r() < 0.7, dir = r() < 0.5 ? 1 : -1;
    if (done.some((p) => Math.hypot(p.x - x, p.y - y) < p.rx + rx + 2)) continue;
    let ok = isLeaf(cv.get(x, y)) && cv.idAt(x, y) >= 0;
    for (let q = 0; ok && q < 8; q++) { const a = (q * Math.PI) / 4, px = x + Math.cos(a) * (rx * 1.15 + 1.5), py = y + Math.sin(a) * (ry * 1.15 + 1.5); ok = isLeaf(cv.get(px, py)) && cv.idAt(px, py) >= 0; }
    if (!ok) continue;
    done.push({ x, y, rx });
    for (let yy = Math.floor(y - ry * 1.2); yy <= Math.ceil(y + ry * 1.2); yy++) for (let xx = Math.floor(x - rx * 1.2); xx <= Math.ceil(x + rx * 1.2); xx++) {
      const ux = (xx - x) / rx, uy = (yy - y) / ry, d = Math.hypot(ux, uy) / (1 + 0.15 * Math.sin(5 * Math.atan2(uy, ux) + ph));
      if (d > 1 || cv.idAt(xx, yy) < 0) continue;
      const c = d > 0.7 ? o.pal[1] : o.pal[0];
      cv.set(xx, yy, c, c, cv.idAt(xx, yy));
    }
    if (!o.twig || !tw) continue;
    const len = Math.max(2, Math.ceil(rx * 1.2));
    for (let i = 0; i < len; i++) {
      const px = Math.round(x - dir * rx * 0.6 + dir * i), py = Math.round(y - ry * 0.5 + (i * ry) / len);
      for (const [yy, c] of [[py, 'a'], [py + 1, 'b']] as const) { const g = cv.getRef(px, yy); if (g === o.pal[0] || g === o.pal[1]) cv.set(px, yy, c, c, cv.idAt(px, yy)); }
    }
  }
  return done.length;
}

/**
 * Vines: 1-px lines (dark green, a mid-green tip) hanging from the crown's lower edge into open air, at most `max`. `X`/`Y` map
 * design units to px. Positions come from `r()` and the picture's presence only. Returns how many were made.
 */
export function vines(cv: Canvas, r: () => number, o: { X: (dx: number) => number; Y: (y: number) => number; s: number; max: number }): number {
  let made = 0;
  for (let k = 0; k < 60 && made < o.max; k++) {
    const x = Math.round(o.X(-34 + r() * 68)); let y = Math.round(o.Y(62));
    while (y > o.Y(20) && !isLeaf(cv.get(x, y))) y--;
    if (y <= o.Y(20) || cv.get(x, y + 1) !== null || isLeaf(cv.get(x - 2, y + 2)) || isLeaf(cv.get(x + 2, y + 2))) continue;
    const len = (3 + Math.floor(r() * 6)) * o.s; made++;
    for (let i = 1; i <= len && cv.get(x, y + i) === null; i++) { const c = i >= len - 0.5 ? '2' : '1'; cv.set(x, y + i, c, c); }
  }
  return made;
}
