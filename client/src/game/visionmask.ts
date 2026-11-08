// The vision mask: black over everything the hero cannot see, with straight
// edges; on a daylight map only a dim (`outside`, #258), so the scenery
// beyond sight still shows (the server still sends no creature from there). A small canvas over the camera window (RES px per tile) holds the
// view's visibility polygon (sim/view.ts) and its walls in white (the polygon
// stops at a wall's face, so a wall in sight is added whole); a
// Shader game object just above the darkness draws black where the canvas is
// not white. A game object, not a camera post effect, so what is drawn above
// the darkness (numbers, the lich's drain beams) stays visible. The canvas is
// redrawn only when the view or the window changes.
//
// Haze mode (#278, daylight maps): no Shader. The canvas holds the unseen strength (grey = 1 - strength)
// in three levels: beyond the hard view `outside`, behind a soft blocker (inside the hard view, outside
// the full one) `soft`, and 0 in the full view; UnseenFX (unseenfx.ts) reads it and hazes the world.
import Phaser from 'phaser';
import { TILE, type TileMap } from '../sim/map';
import type { View } from '../sim/view';
import { DEPTH } from './effects';

/** How dark what lies outside sight is on a daylight map (#258): dimmed, not black (alpha of black). */
export const DAYLIGHT_OUTSIDE = 0.3;
/** The canvas grey values (0..255) for the unseen strengths `outside` and `soft` (0..1): strength 1 is black, 0 white. */
export function levels(outside: number, soft: number): { outside: number; soft: number } {
  const g = (v: number) => Math.round(255 * (1 - Math.min(1, Math.max(0, v))));
  return { outside: g(outside), soft: g(soft) };
}

/** Canvas pixels per tile: enough for a straight, antialiased edge. */
const RES = 8;
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
  /** How dark (alpha of black) the mask is outside sight: 1 on dark maps, DAYLIGHT_OUTSIDE on daylight maps. In haze mode: the unseen strength beyond sight. */
  outside = 1;
  /** Haze mode (set before the first update): the canvas feeds UnseenFX and no Shader is made. */
  haze = false;
  /** Haze mode: the unseen strength behind a soft blocker (inside the hard view, outside the full one). */
  soft = 0;

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
    this.canvas = this.scene.textures.createCanvas(KEY, cols * RES, rows * RES)!;
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
    const key = `${ox},${oy},${sight.version},${this.outside},${this.soft}${full ? `,${full.version}` : ''}`;
    if (key === this.last) return;
    this.last = key;

    const canvas = this.canvas!;
    const ctx = canvas.getContext();
    const s = RES / TILE;
    // the shader draws black at 1 - red: grey outside sight gives a dim of `outside`
    const lv = levels(this.outside, this.soft);
    ctx.fillStyle = `rgb(${lv.outside},${lv.outside},${lv.outside})`;
    ctx.fillRect(0, 0, this.cols * RES, this.rows * RES);
    const fillPoly = (v: View, style: string) => {
      ctx.fillStyle = style;
      const poly = v.polygon.points;
      ctx.beginPath();
      for (let i = 0; i < poly.length; i += 2) ctx.lineTo((poly[i] - ox * TILE) * s, (poly[i + 1] - oy * TILE) * s);
      ctx.closePath();
      ctx.fill();
    };
    if (full) {
      // haze: the hard view at the soft level, the full view (inside it) in white
      if (this.soft > 0) fillPoly(sight, `rgb(${lv.soft},${lv.soft},${lv.soft})`);
      fillPoly(full, '#fff');
    } else fillPoly(sight, '#fff');
    ctx.fillStyle = '#fff';
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) if (this.map.hardOpaque(ox + x, oy + y) && sight.isVisible(ox + x, oy + y)) ctx.fillRect(x * RES, y * RES, RES, RES);
    canvas.refresh();
    // refresh() resets the filter to NEAREST (pixelArt).
    canvas.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  /** A tile changed (a door): redraw on the next update. */
  mapChanged(): void {
    this.last = '';
  }
}
