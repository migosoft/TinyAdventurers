// The vision mask: black over everything the hero cannot see, with straight
// edges; on a daylight map only a dim (`outside`, #258), so the scenery
// beyond sight still shows (the server still sends no creature from there). A small canvas over the camera window (`canvasRes` px per tile) holds the
// view's visibility polygon (sim/view.ts) and its walls in white (the polygon
// stops at a wall's face, so a wall in sight is added whole); a
// Shader game object just above the darkness draws black where the canvas is
// not white. A game object, not a camera post effect, so what is drawn above
// the darkness (numbers, the lich's drain beams) stays visible. The canvas is
// redrawn only when the view or the window changes.
//
// Haze mode (#278, daylight maps): no Shader. The canvas holds the unseen strength (grey = 1 - strength):
// beyond the hard view `outside`, 0 in the full view, and behind a soft blocker (inside the hard view, outside
// the full one) a wedge that grows from 0 at the blocker to `soft` over `ramp` px and, past the edge of sight,
// follows the fog down to `outside`; UnseenFX (unseenfx.ts) reads it and hazes the world. The sight, its walls
// and the feather are rasterised and blurred in memory and only written to the canvas (#290: no getImageData, which
// waits for the GPU); the wedge and the seen plants are then drawn on the canvas.
import Phaser from 'phaser';
import { TILE, type TileMap } from '../sim/map';
import type { View } from '../sim/view';
import { DEPTH } from './effects';

/** Steps of the wedge's ramp from clear to `soft`. */
const RAMP_LAYERS = 4;

/**
 * Every point of a polygon (flat x, y pairs) moved `d` world px outward along its ray from (px, py). Written into
 * `out` (resized, so a caller can reuse one array and allocate nothing per redraw); `out` may be `points` itself.
 */
export function extendPoints(points: ArrayLike<number>, px: number, py: number, d: number, out: number[] = []): number[] {
  const n = points.length;
  out.length = n;
  for (let i = 0; i < n; i += 2) {
    const dx = points[i] - px, dy = points[i + 1] - py;
    const len = Math.hypot(dx, dy);
    const k = len > 0 ? (len + d) / len : 1;
    out[i] = px + dx * k;
    out[i + 1] = py + dy * k;
  }
  return out;
}

/**
 * The points within 1 px of distance `r` from (px, py) (the rays that reached the radius) moved `ext` px outward; the
 * others stay. A hard wall face that happens to lie within 1 px of `r` is moved too (rare, cosmetic). Written into
 * `out` like `extendPoints`.
 */
export function extendRim(points: ArrayLike<number>, px: number, py: number, r: number, ext: number, out: number[] = []): number[] {
  const n = points.length;
  out.length = n;
  for (let i = 0; i < n; i += 2) {
    const dx = points[i] - px, dy = points[i + 1] - py;
    const len = Math.hypot(dx, dy);
    if (Math.abs(len - r) <= 1 && len > 0) {
      out[i] = px + dx * ((len + ext) / len);
      out[i + 1] = py + dy * ((len + ext) / len);
    } else {
      out[i] = points[i];
      out[i + 1] = points[i + 1];
    }
  }
  return out;
}

/**
 * The wedge's ramp as `n` layers, lightest first: layer k covers everything at least `depth` world px behind the
 * full polygon and darkens it to `grey`, a step `(k + 1) / n` of the way from white to the `soft` grey. With `ramp` 0
 * there is one layer at the full `soft` grey from depth 0 (crisp).
 */
export function rampLayers(soft: number, ramp: number, n: number): { depth: number; grey: number }[] {
  if (ramp <= 0) return [{ depth: 0, grey: soft }];
  return Array.from({ length: n }, (_, k) => ({ depth: (k * ramp) / n, grey: Math.round(255 - (255 - soft) * ((k + 1) / n)) }));
}

/** The canvas grey values (0..255) for the unseen strengths `outside` and `soft` (0..1): strength 1 is black, 0 white. */
export function levels(outside: number, soft: number): { outside: number; soft: number } {
  const g = (v: number) => Math.round(255 * (1 - Math.min(1, Math.max(0, v))));
  return { outside: g(outside), soft: g(soft) };
}

/** One drawing step of the mask canvas (see `maskSteps`). */
export type MaskStep =
  | { step: 'sight' } // the hard view's polygon in white over the outside grey
  | { step: 'walls' } // the visible hard walls, whole, in white
  | { step: 'feather' } // blur: the soft edge of sight (haze: the in-memory field is blurred and written to the canvas)
  | { step: 'wedge'; grey: number } // behind the full view, up to the soft grey over the ramp, never lightening; crisp sides, runs on into the fog
  | { step: 'seen' }; // the owner's seen-plant silhouettes, in white

/**
 * The drawing steps over the `outside` grey, in order. Haze: only the edge of sight is feathered; the wedge behind
 * trunks is drawn after the blur, so its sides stay crisp, then the seen plants. Otherwise the view in white and its walls.
 */
export function maskSteps(haze: boolean, lv: { outside: number; soft: number }): MaskStep[] {
  return haze
    ? [{ step: 'sight' }, { step: 'walls' }, { step: 'feather' }, { step: 'wedge', grey: lv.soft }, { step: 'seen' }]
    : [{ step: 'sight' }, { step: 'walls' }];
}

/** Sub-scanlines per canvas row of `fillPolygon`: its vertical antialiasing (horizontally the coverage is exact). */
const SUB = 4;
const byValue = (a: number, b: number) => a - b;

/** Work arrays of `fillPolygon`, kept by the caller so a redraw allocates nothing once they have grown. */
export interface RasterScratch { xs: number[][]; row: Float32Array }

/** Adds `wt` × the covered part of each pixel of `row` between x positions `xa` and `xb`. */
function addSpan(row: Float32Array, w: number, xa: number, xb: number, wt: number): void {
  xa = Math.max(0, xa);
  xb = Math.min(w, xb);
  if (xb <= xa) return;
  const ia = Math.floor(xa), ib = Math.floor(xb);
  if (ia === ib) {
    row[ia] += (xb - xa) * wt;
    return;
  }
  row[ia] += (ia + 1 - xa) * wt;
  for (let i = ia + 1; i < ib; i++) row[i] += wt;
  if (ib < w) row[ib] += (xb - ib) * wt;
}

/**
 * Paints a polygon (flat world x, y pairs; even-odd) in white into the grey `field` (`w`×`h`, 0..255) the way a
 * canvas fill would: each pixel moves toward 255 by the share of it the polygon covers. A world point (x, y) lands
 * on canvas px ((x - tx) · s, (y - ty) · s). Scanline fill with `SUB` sub-scanlines per row (#290: the haze mask is
 * built in memory, so it is never read back from the canvas).
 */
export function fillPolygon(field: Float32Array, w: number, h: number, pts: ArrayLike<number>, tx: number, ty: number, s: number, scratch: RasterScratch): void {
  const lines = h * SUB;
  const xs = scratch.xs;
  while (xs.length < lines) xs.push([]);
  for (let l = 0; l < lines; l++) xs[l].length = 0;
  if (scratch.row.length < w) scratch.row = new Float32Array(w);
  const row = scratch.row;
  const n = pts.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const x0 = (pts[i] - tx) * s, y0 = (pts[i + 1] - ty) * s;
    const x1 = (pts[j] - tx) * s, y1 = (pts[j + 1] - ty) * s;
    if (y0 === y1) continue;
    // the sub-scanlines whose centre (l + 0.5) / SUB lies in [min y, max y): each crossing counted once at a shared vertex
    const lo = Math.max(0, Math.ceil(Math.min(y0, y1) * SUB - 0.5));
    const hi = Math.min(lines - 1, Math.ceil(Math.max(y0, y1) * SUB - 0.5) - 1);
    const k = (x1 - x0) / (y1 - y0);
    for (let l = lo; l <= hi; l++) xs[l].push(x0 + ((l + 0.5) / SUB - y0) * k);
  }
  for (let y = 0; y < h; y++) {
    row.fill(0, 0, w);
    let any = false;
    for (let k = 0; k < SUB; k++) {
      const c = xs[y * SUB + k];
      if (c.length < 2) continue;
      c.sort(byValue);
      for (let i = 0; i + 1 < c.length; i += 2) addSpan(row, w, c[i], c[i + 1], 1 / SUB);
      any = true;
    }
    if (!any) continue;
    for (let x = 0, o = y * w; x < w; x++, o++) if (row[x] > 0) field[o] += (255 - field[o]) * Math.min(1, row[x]);
  }
}

/** One running-sum box pass (window 2r+1, edge pixels repeated) over `n` values at `stride` apart, `src` into `dst`. */
function boxLine(src: Float32Array, dst: Float32Array, start: number, stride: number, n: number, r: number): void {
  const last = n - 1, first = src[start], end = src[start + last * stride];
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += i < 0 ? first : i > last ? end : src[start + i * stride];
  const div = 2 * r + 1;
  for (let i = 0; i < n; i++) {
    dst[start + i * stride] = sum / div;
    const add = i + r + 1, drop = i - r;
    sum += (add > last ? end : src[start + add * stride]) - (drop < 0 ? first : src[start + drop * stride]);
  }
}

/**
 * Blurs the grey `field` (`w`×`h`) in place: three separable box passes, close to a gaussian. `tmp` holds at least
 * `w`×`h` values. `radius` is in canvas px; 0 changes nothing.
 */
export function blurField(field: Float32Array, w: number, h: number, radius: number, tmp: Float32Array): void {
  const r = Math.floor(radius);
  if (r <= 0) return;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) boxLine(field, tmp, y * w, 1, w, r);
    for (let x = 0; x < w; x++) boxLine(tmp, field, x, w, h, r);
  }
}

/** Writes the grey `field` into opaque RGBA `data` (red = green = blue = the rounded grey). */
export function fieldToRgba(field: Float32Array, data: Uint8ClampedArray, n: number): void {
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const g = Math.round(field[i]);
    data[o] = data[o + 1] = data[o + 2] = g;
    data[o + 3] = 255;
  }
}

/**
 * Canvas pixels per tile: 8 is enough for a straight, antialiased edge. Haze mode uses 4 (#280): its redraw is CPU work
 * (the raster, the blur, putImageData, the upload) on every frame the hero moves, and its edges are blurred anyway.
 */
export function canvasRes(haze: boolean): number {
  return haze ? 4 : 8;
}
/** Tiles of canvas beyond the camera window on each side. */
const BORDER = 2;
const KEY = 'visionmask';

// outTexCoord goes up the quad (0 = its bottom); the canvas rows go down.
const FRAG = `
precision mediump float;
uniform sampler2D iChannel0;
varying vec2 outTexCoord;
void main() {
  float seen = texture2D(iChannel0, vec2(outTexCoord.x, 1.0 - outTexCoord.y)).r;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - seen);
}`;

export class VisionMask {
  private canvas?: Phaser.Textures.CanvasTexture;
  private shader?: Phaser.GameObjects.Shader;
  private cols = 0;
  private rows = 0;
  /** What the canvas shows now: window origin and view version. Empty: redraw. */
  private last = '';
  /** Off: no mask, the old tile edges (?lights E). */
  enabled = true;
  /** How dark (alpha of black) the mask is outside sight: 1 on dark maps. In haze mode: the unseen strength beyond sight. */
  outside = 1;
  /** Haze mode (set before the first update): the canvas feeds UnseenFX and no Shader is made. */
  haze = false;
  /** Haze mode: the unseen strength behind a soft blocker (inside the hard view, outside the full one). */
  soft = 0;
  /** Haze mode: the blur radius of the mask in world px (0: hard edges). */
  feather = 0;
  /** Haze mode: world px behind a soft blocker over which the wedge grows from clear to `soft` (0: full strength at once). */
  ramp = 0;
  /** Haze mode: reused point arrays of the wedge step (the clip polygon, the full polygon with its rim pushed out, one grown layer). */
  private clipPts: number[] = [];
  private rimPts: number[] = [];
  private grownPts: number[] = [];
  /**
   * Haze mode: the mask's sight, walls and feather are built here in memory and written with putImageData, never read
   * back from the canvas (#290: getImageData waits for the GPU). Sized with the canvas.
   */
  private field?: { grey: Float32Array; tmp: Float32Array; img: ImageData; raster: RasterScratch };
  /**
   * Haze mode: scenery that must never be hazed where the hero sees it (a tree's picture reaches over the
   * hazed ground behind it, and UnseenFX works in ground coordinates). `paint` runs after the blur, so the
   * silhouettes stay crisp; `version` changes when what it paints changes. `ox`, `oy`: the canvas origin in tiles;
   * `s`: canvas px per world px; `full`: the full view.
   */
  seen?: { version(): number; paint(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number, full: View): void };

  /** The canvas texture (haze mode: UnseenFX binds it). */
  get texture(): Phaser.Textures.CanvasTexture | undefined {
    return this.canvas;
  }

  /** World px the canvas covers. */
  get rect(): { x: number; y: number; w: number; h: number } {
    return { x: this.ox * TILE, y: this.oy * TILE, w: this.cols * TILE, h: this.rows * TILE };
  }
  private ox = 0;
  private oy = 0;
  /** Canvas px per tile (fixed by `haze`, which is set before the first update). */
  private get res(): number {
    return canvasRes(this.haze);
  }

  constructor(
    private scene: Phaser.Scene,
    private map: TileMap,
  ) {}

  /** (Re)creates the canvas and the shader for a window of cols×rows tiles. */
  private build(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.shader?.destroy();
    this.shader = undefined;
    if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
    if (this.haze) {
      // A CPU-backed canvas: putImageData is a copy and the plant silhouettes (CPU-backed too) draw into it without a GPU round trip.
      const el = document.createElement('canvas');
      const w = cols * this.res, h = rows * this.res;
      el.width = w;
      el.height = h;
      el.getContext('2d', { willReadFrequently: true });
      this.canvas = this.scene.textures.addCanvas(KEY, el)!;
      this.field = { grey: new Float32Array(w * h), tmp: new Float32Array(w * h), img: new ImageData(w, h), raster: { xs: [], row: new Float32Array(w) } };
    } else this.canvas = this.scene.textures.createCanvas(KEY, cols * this.res, rows * this.res)!;
    this.last = '';
    if (this.haze) return;
    const base = new Phaser.Display.BaseShader(KEY, FRAG);
    this.shader = this.scene.add.shader(base, 0, 0, cols * TILE, rows * TILE).setOrigin(0, 0).setDepth(DEPTH.fog + 0.5);
    // Clamp, not the default repeat: a non-power-of-two texture that repeats is incomplete in WebGL 1 (it would sample black).
    this.shader.setChannel0(KEY, { wrapS: 'clamp_to_edge', wrapT: 'clamp_to_edge', minFilter: 'linear', magFilter: 'linear' });
  }

  /** `view`: the camera's world view; `sight`: what the viewer sees (LightView's View, computed this frame; in haze mode the hard view); `all`: the full view, required in haze mode. */
  update(view: Phaser.Geom.Rectangle, sight: View, all?: () => View): void {
    const cols = Math.ceil(view.width / TILE) + 2 * BORDER + 1;
    const rows = Math.ceil(view.height / TILE) + 2 * BORDER + 1;
    // Grow only, so a shrinking window does not rebuild every frame.
    if (cols > this.cols || rows > this.rows) this.build(Math.max(cols, this.cols), Math.max(rows, this.rows));
    const shader = this.shader;
    shader?.setVisible(this.enabled);
    if (!this.enabled) return;
    const ox = Math.floor(view.x / TILE) - BORDER;
    const oy = Math.floor(view.y / TILE) - BORDER;
    this.ox = ox;
    this.oy = oy;
    shader?.setPosition(ox * TILE, oy * TILE);
    const full = this.haze ? all!() : undefined;
    const key = `${ox},${oy},${sight.version},${this.outside},${this.soft}${full ? `,${full.version},${this.feather},${this.ramp},${this.seen?.version() ?? 0}` : ''}`;
    if (key === this.last) return;
    this.last = key;

    const canvas = this.canvas!;
    const ctx = canvas.getContext();
    const RES = this.res;
    const s = RES / TILE;
    // the shader draws black at 1 - red: grey outside sight gives a dim of `outside`
    const lv = levels(this.outside, this.soft);
    const W = this.cols * RES, H = this.rows * RES;
    // haze: sight, walls and feather go into the field (written to the canvas by 'feather'), the rest onto the canvas
    const fld = full ? this.field! : undefined;
    if (fld) fld.grey.fill(lv.outside, 0, W * H);
    else {
      ctx.fillStyle = `rgb(${lv.outside},${lv.outside},${lv.outside})`;
      ctx.fillRect(0, 0, W, H);
    }
    const addPoints = (poly: ArrayLike<number>) => {
      ctx.moveTo((poly[0] - ox * TILE) * s, (poly[1] - oy * TILE) * s);
      for (let i = 2; i < poly.length; i += 2) ctx.lineTo((poly[i] - ox * TILE) * s, (poly[i + 1] - oy * TILE) * s);
      ctx.closePath();
    };
    const fillTiles = (want: (x: number, y: number) => boolean) => {
      ctx.fillStyle = '#fff';
      for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) if (want(ox + x, oy + y)) ctx.fillRect(x * RES, y * RES, RES, RES);
    };
    for (const st of maskSteps(!!full, lv)) {
      switch (st.step) {
        case 'sight':
          if (fld) fillPolygon(fld.grey, W, H, sight.polygon.points, ox * TILE, oy * TILE, s, fld.raster);
          else {
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            addPoints(sight.polygon.points);
            ctx.fill();
          }
          break;
        case 'walls':
          if (fld) {
            for (let y = 0; y < this.rows; y++)
              for (let x = 0; x < this.cols; x++) {
                if (!this.map.hardOpaque(ox + x, oy + y) || !sight.isVisible(ox + x, oy + y)) continue;
                for (let r = 0; r < RES; r++) fld.grey.fill(255, (y * RES + r) * W + x * RES, (y * RES + r) * W + (x + 1) * RES);
              }
          } else fillTiles((x, y) => this.map.hardOpaque(x, y) && sight.isVisible(x, y));
          break;
        case 'feather':
          if (this.feather > 0) blurField(fld!.grey, W, H, Math.max(1, Math.round(this.feather * s)), fld!.tmp);
          fieldToRgba(fld!.grey, fld!.img.data, W * H);
          ctx.putImageData(fld!.img, 0, 0);
          break;
        case 'wedge':
          // Clipped to the hard polygon, its rim rays pushed out past the blur's whole transition. Each layer fills what
          // lies at least `depth` behind the full polygon (even-odd: the canvas rectangle minus the grown polygon);
          // darken keeps the lighter layers and the blur's values from lightening what is darker, so the wedge
          // ramps up behind the blocker and, beyond the rim, min(fog, soft grey) follows the fog down without a step.
          if (st.grey < 255) {
            const ext = Math.max(TILE, 3 * this.feather);
            ctx.save();
            ctx.beginPath();
            addPoints(extendRim(sight.polygon.points, sight.px, sight.py, sight.r, ext, this.clipPts));
            ctx.clip();
            // The full polygon's own rim points (unblocked rays) go beyond the clip BEFORE it is grown by a depth,
            // else the complement of each grown polygon would cover the band r + depth .. r + ext inside the clip
            // and darken the fog there (a step ring). Both views come from the same vision, so full.r === sight.r.
            const fullRim = extendRim(full!.polygon.points, full!.px, full!.py, full!.r, ext, this.rimPts);
            ctx.globalCompositeOperation = 'darken';
            for (const layer of rampLayers(st.grey, this.ramp, RAMP_LAYERS)) {
              ctx.fillStyle = `rgb(${layer.grey},${layer.grey},${layer.grey})`;
              ctx.beginPath();
              ctx.rect(0, 0, this.cols * RES, this.rows * RES);
              addPoints(extendPoints(fullRim, full!.px, full!.py, layer.depth, this.grownPts));
              ctx.fill('evenodd');
            }
            ctx.restore();
          }
          break;
        case 'seen':
          this.seen?.paint(ctx, ox, oy, s, full!);
          break;
      }
    }
    canvas.refresh();
    // refresh() resets the filter to NEAREST (pixelArt).
    canvas.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  /** A tile changed (a door): redraw on the next update. */
  mapChanged(): void {
    this.last = '';
  }
}
