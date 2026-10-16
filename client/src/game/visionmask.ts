// The vision mask: black over everything the hero cannot see, with straight
// edges. A small canvas over the camera window (RES px per tile) holds the
// view's visibility polygon (sim/view.ts) and its walls in white (the polygon
// stops at a wall's face, so a wall in sight is added whole); a
// Shader game object just above the darkness draws black where the canvas is
// not white. A game object, not a camera post effect, so what is drawn above
// the darkness (numbers, the lich's drain beams) stays visible. The canvas is
// redrawn only when the view or the window changes.
import Phaser from 'phaser';
import { TILE, type TileMap } from '../sim/map';
import type { View } from '../sim/view';
import { DEPTH } from './effects';

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

  constructor(
    private scene: Phaser.Scene,
    private map: TileMap,
  ) {}

  /** (Re)creates the canvas and the shader for a window of cols×rows tiles. */
  private build(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.shader?.destroy();
    if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
    this.canvas = this.scene.textures.createCanvas(KEY, cols * RES, rows * RES)!;
    const base = new Phaser.Display.BaseShader(KEY, FRAG);
    this.shader = this.scene.add.shader(base, 0, 0, cols * TILE, rows * TILE).setOrigin(0, 0).setDepth(DEPTH.fog + 0.5);
    // Clamp, not the default repeat: a non-power-of-two texture that repeats is incomplete in WebGL 1 (it would sample black).
    this.shader.setChannel0(KEY, { wrapS: 'clamp_to_edge', wrapT: 'clamp_to_edge', minFilter: 'linear', magFilter: 'linear' });
    this.last = '';
  }

  /** `view`: the camera's world view; `sight`: what the viewer sees (LightView's View, computed this frame). */
  update(view: Phaser.Geom.Rectangle, sight: View): void {
    const cols = Math.ceil(view.width / TILE) + 2 * BORDER + 1;
    const rows = Math.ceil(view.height / TILE) + 2 * BORDER + 1;
    // Grow only, so a shrinking window does not rebuild every frame.
    if (cols > this.cols || rows > this.rows) this.build(Math.max(cols, this.cols), Math.max(rows, this.rows));
    const shader = this.shader!;
    shader.setVisible(this.enabled);
    if (!this.enabled) return;
    const ox = Math.floor(view.x / TILE) - BORDER;
    const oy = Math.floor(view.y / TILE) - BORDER;
    shader.setPosition(ox * TILE, oy * TILE);
    const key = `${ox},${oy},${sight.version}`;
    if (key === this.last) return;
    this.last = key;

    const canvas = this.canvas!;
    const ctx = canvas.getContext();
    const s = RES / TILE;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.cols * RES, this.rows * RES);
    ctx.fillStyle = '#fff';
    const poly = sight.polygon.points;
    ctx.beginPath();
    for (let i = 0; i < poly.length; i += 2) ctx.lineTo((poly[i] - ox * TILE) * s, (poly[i + 1] - oy * TILE) * s);
    ctx.closePath();
    ctx.fill();
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) if (this.map.opaque(ox + x, oy + y) && sight.isVisible(ox + x, oy + y)) ctx.fillRect(x * RES, y * RES, RES, RES);
    canvas.refresh();
    // refresh() resets the filter to NEAREST (pixelArt).
    canvas.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  /** A tile changed (a door): redraw on the next update. */
  mapChanged(): void {
    this.last = '';
  }
}
