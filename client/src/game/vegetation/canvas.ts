// The drawing surface and the shared palette of the vegetation generator (#279).
// Pure: no Phaser, no DOM, no Node.
type Rgb = [number, number, number];
export interface Rgba { w: number; h: number; data: Uint8ClampedArray }
/** How many of each detail a tree got; filled by the passes that count them (tests read it). */
export type Parts = { pockets: number; vines: number; stems: number; limbs: number };
/** A drawn plant; `foot` (px, inside img) is the trunk foot: the sprite's origin and its depth. */
export interface Drawn { img: Rgba; foot: { x: number; y: number }; parts?: Parts }

export const P: Record<string, Rgb> = { k: [34, 34, 34], 0: [28, 58, 50], 1: [40, 100, 62], 2: [62, 138, 67], 3: [106, 174, 79], 4: [156, 207, 98],
  5: [22, 48, 52], 6: [30, 74, 70], 7: [44, 104, 88], 8: [74, 140, 104], 9: [118, 176, 124],
  a: [58, 35, 40], b: [98, 53, 43], c: [143, 64, 41], d: [176, 112, 74],
  // dead wood: the bark ramp a..d turned greyer and darker (a bare tree's wood, written by its last pass)
  e: [40, 32, 34], f: [64, 50, 47], g: [90, 73, 64], h: [118, 99, 84] };
export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** A unit vector pointing toward the sun, in screen space (y down). */
export interface Light { x: number; y: number }
/** The light the cove tree and the atlas are drawn with: from the top left. */
export const DEFAULT_LIGHT: Light = { x: -0.62, y: -0.78 };

export const isLeaf = (c: string | null) => c !== null && '0123456789'.includes(c);
/** Bark is a..d only: the bare tree's dead-wood e..h is written by its last pass, after every bark pass. */
export const isBark =(c: string | null) => c !== null && 'abcd'.includes(c);

/** Bark colour from the lit amount; `rim` marks the outer ring of a stroke, which turns dark on the shadow side. */
export const barkShade = (lit: number, rim: boolean) => (rim && lit < -0.2 ? 'a' : lit > 0.55 ? 'd' : lit > 0 ? 'c' : lit > -0.5 ? 'b' : 'a');

/** The colour `by` steps along the palette string `pal` (dark to light), clamped to its ends; a colour outside `pal` stays. */
export function step(pal: string, c: string | null, by: number): string | null {
  if (c === null) return null;
  const i = pal.indexOf(c);
  return i < 0 ? c : pal[Math.max(0, Math.min(pal.length - 1, i + by))];
}

/**
 * The pixels, plus `ref`: the same picture shaded with DEFAULT_LIGHT. Every random draw that depends on a pixel's
 * colour looks at `ref`, so the random stream, and with it the shape, is the same whatever the light is; only the
 * shading follows the light. `id` names the lobe or part a pixel belongs to (-1 = none); it does not depend on the light.
 */
export class Canvas {
  px: (string | null)[];
  ref: (string | null)[];
  id: Int16Array;
  /** The box of everything written so far (inclusive); empty while x1 < x0. */
  private x0: number; private y0: number; private x1 = -1; private y1 = -1;
  constructor(public w: number, public h: number) {
    this.px = new Array(w * h).fill(null); this.ref = new Array(w * h).fill(null); this.id = new Int16Array(w * h).fill(-1);
    this.x0 = w; this.y0 = h;
  }
  /** `cRef` is the colour the default light would give; it defaults to `c`. */
  set(x: number, y: number, c: string, cRef = c, id = -1) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) {
      const i = y * this.w + x; this.px[i] = c; this.ref[i] = cRef; this.id[i] = id;
      if (x < this.x0) this.x0 = x; if (x > this.x1) this.x1 = x; if (y < this.y0) this.y0 = y; if (y > this.y1) this.y1 = y;
    }
  }
  /** The box of everything written so far, clamped to the canvas (inclusive); empty (x1 < x0) while nothing is written. */
  box() { return { x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1 }; }
  /** Change the picture's colour of an opaque pixel; nothing on an empty one. */
  recolour(x: number, y: number, c: string) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h && this.px[y * this.w + x] !== null) this.px[y * this.w + x] = c; }
  /** The same for the default-light reference. */
  recolourRef(x: number, y: number, c: string) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h && this.ref[y * this.w + x] !== null) this.ref[y * this.w + x] = c; }
  get(x: number, y: number) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null; }
  getRef(x: number, y: number) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.ref[y * this.w + x] : null; }
  idAt(x: number, y: number) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.id[y * this.w + x] : -1; }
  clear(x: number, y: number) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) { const i = y * this.w + x; this.px[i] = null; this.ref[i] = null; this.id[i] = -1; } }
  /** Outer outline, then crop to the drawing; returns the image and where `foot` lands in it. Works inside the written box only. */
  finish(foot: { x: number; y: number }, parts?: Parts): Drawn {
    const { w, h, px } = this;
    // The outline can only fall on cells next to a written one: the box grown by 1.
    const bx0 = Math.max(0, this.x0 - 1), by0 = Math.max(0, this.y0 - 1), bx1 = Math.min(w - 1, this.x1 + 1), by1 = Math.min(h - 1, this.y1 + 1);
    const edge: number[] = [];
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const i = y * w + x;
      if (px[i] === null && ((x + 1 < w && px[i + 1] !== null) || (x > 0 && px[i - 1] !== null) || (y + 1 < h && px[i + w] !== null) || (y > 0 && px[i - w] !== null))) edge.push(i);
    }
    for (const i of edge) px[i] = 'k';
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (px[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) throw new Error('vegetation: the drawing reaches the canvas edge (scale too large)');
    const iw = x1 - x0 + 1, ih = y1 - y0 + 1;
    const img: Rgba = { w: iw, h: ih, data: new Uint8ClampedArray(iw * ih * 4) };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = px[y * w + x];
      if (c) { const rgb = P[c], o = ((y - y0) * iw + x - x0) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255; }
    }
    const out: Drawn = { img, foot: { x: Math.round(foot.x - x0), y: Math.round(foot.y - y0) } };
    if (parts) out.parts = { ...parts };
    return out;
  }
}
