// Leaf clumps: the crown pass shared by the leafy trees, the conifer and the bush (#279).
import { type Canvas, DEFAULT_LIGHT, type Light } from './canvas';

/** Leaf clumps: lumpy ovals, back to front, dark-green rim on the shadow side, lower clumps darker. */
export function clumps(cv: Canvas, r: () => number, list: { x: number; y: number; rx: number; ry: number; ph?: number; ph2?: number }[], topY: number, spanY: number, pal: string, light: Light) {
  for (const c0 of list) {
    const c = { ...c0, ph: c0.ph ?? r() * 6, ph2: c0.ph2 ?? r() * 6 };
    for (let y = Math.floor(c.y - c.ry * 1.3 - 2); y <= c.y + c.ry * 1.3 + 2; y++) for (let x = Math.floor(c.x - c.rx * 1.3 - 2); x <= c.x + c.rx * 1.3 + 2; x++) {
      const ang = Math.atan2((y - c.y) / c.ry, (x - c.x) / c.rx);
      const lump = 1 + 0.1 * Math.sin(3 * ang + c.ph) + 0.07 * Math.sin(5 * ang + c.ph2) + 0.04 * Math.sin(8 * ang + c.ph * 2);
      const d = Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry) / lump;
      if (d > 1) continue;
      // The random draw is made exactly where the default light would make it, so the stream does not depend on the light.
      const edge = d > 1 - 1.3 / Math.min(c.rx, c.ry);
      const rimRef = edge && (x - c.x) * DEFAULT_LIGHT.x + (y - c.y) * DEFAULT_LIGHT.y < 0;
      const noise = rimRef ? 0 : (r() - 0.5) * 0.2;
      const shade = (lt: Light) => {
        if (edge && (x - c.x) * lt.x + (y - c.y) * lt.y < 0) return pal[0];
        const l = ((x - c.x) / c.rx) * lt.x + ((y - c.y) / c.ry) * lt.y + noise - ((c.y - topY) / spanY) * 0.7;
        return l > 0.62 ? pal[4] : l > 0.22 ? pal[3] : l > -0.3 ? pal[2] : l > -0.75 ? pal[1] : pal[0];
      };
      cv.set(x, y, shade(light), rimRef ? pal[0] : shade(DEFAULT_LIGHT));
    }
  }
}
