// The soft shadow behind trunks and thickets (#203). The hard view (walls only) is what the hero
// sees; the full view (the server's) also stops at trunks. The ground between the two polygons is
// only dimmed, never blacked out: the scenery (canopies, bushes, flowers) is drawn above it and the
// creatures the server holds back stay hidden by the server. A small canvas over the camera window
// (RES px per tile) holds the hard polygon in translucent black with the full polygon cut out; an
// Image at DEPTH.shade (over the ground, under figures and canopies) draws it. The layer costs
// nothing when no soft tile lies in the window, and the canvas is redrawn only when a view or the
// window changes.
import type Phaser from 'phaser';
import { TILE, type TileMap } from '../sim/map';
import { inside } from '../sim/vispoly';
import type { View } from '../sim/view';
import { DEPTH } from './effects';

/** How dark the soft shadow is (alpha of black). */
export const SHADE = 0.3;
/** Canvas pixels per tile. */
const RES = 8;
/** Tiles of canvas beyond the camera window on each side. */
const BORDER = 2;
const KEY = 'shademask';
/** Phaser's FilterMode.LINEAR as a number: a value import of Phaser needs a browser and the pure functions here are unit-tested. */
const LINEAR = 0;

/** Is the point (world px) in the soft shadow: inside the hard polygon and outside the full one? */
export function shadeCovers(hard: View, all: View, x: number, y: number): boolean {
  return inside(hard.polygon, hard.px, hard.py, x, y) && !inside(all.polygon, all.px, all.py, x, y);
}

export class ShadeMask {
  private canvas?: Phaser.Textures.CanvasTexture;
  private image?: Phaser.GameObjects.Image;
  private cols = 0;
  private rows = 0;
  /** What the canvas shows now: window origin and both view versions. Empty: redraw. */
  private last = '';
  /** Soft (opaque but not hard) tiles per map row. */
  private rowSoft: Uint32Array;
  /** Off: no shade (?cove button). */
  on = true;

  constructor(
    private scene: Phaser.Scene,
    private map: TileMap,
  ) {
    this.rowSoft = new Uint32Array(map.h);
    this.mapChanged();
  }

  /** A tile changed: count the soft tiles again and redraw on the next update. */
  mapChanged(): void {
    const { w, h } = this.map;
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (this.map.opaque(x, y) && !this.map.hardOpaque(x, y)) n++;
      this.rowSoft[y] = n;
    }
    this.last = '';
  }

  private build(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.image?.destroy();
    if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
    this.canvas = this.scene.textures.createCanvas(KEY, cols * RES, rows * RES)!;
    this.image = this.scene.add.image(0, 0, KEY).setOrigin(0, 0).setScale(TILE / RES).setDepth(DEPTH.shade);
    this.last = '';
  }

  /** `view`: the camera's world view; `hard`: the view that stops at walls only; `all`: the server's view. */
  update(view: Phaser.Geom.Rectangle, hard: View, all: View): void {
    const y0 = Math.max(0, Math.floor(view.y / TILE) - BORDER);
    const y1 = Math.min(this.map.h, Math.ceil(view.bottom / TILE) + BORDER + 1);
    let soft = this.on;
    if (soft) {
      soft = false;
      for (let y = y0; y < y1; y++) if (this.rowSoft[y] > 0) { soft = true; break; }
    }
    if (!soft) {
      this.image?.setVisible(false);
      return;
    }
    const cols = Math.ceil(view.width / TILE) + 2 * BORDER + 1;
    const rows = Math.ceil(view.height / TILE) + 2 * BORDER + 1;
    // Grow only, so a shrinking window does not rebuild every frame.
    if (cols > this.cols || rows > this.rows) this.build(Math.max(cols, this.cols), Math.max(rows, this.rows));
    const image = this.image!;
    image.setVisible(true);
    const ox = Math.floor(view.x / TILE) - BORDER;
    const oy = Math.floor(view.y / TILE) - BORDER;
    image.setPosition(ox * TILE, oy * TILE);
    const key = `${ox},${oy},${hard.version},${all.version}`;
    if (key === this.last) return;
    this.last = key;

    const canvas = this.canvas!;
    const ctx = canvas.getContext();
    const s = RES / TILE;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.cols * RES, this.rows * RES);
    const trace = (v: View) => {
      const p = v.polygon.points;
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) ctx.lineTo((p[i] - ox * TILE) * s, (p[i + 1] - oy * TILE) * s);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = `rgba(0,0,0,${SHADE})`;
    trace(hard);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    trace(all);
    ctx.globalCompositeOperation = 'source-over';
    canvas.refresh();
    // refresh() resets the filter to NEAREST (pixelArt).
    canvas.setFilter(LINEAR);
  }

  destroy(): void {
    this.image?.destroy();
    this.image = undefined;
    if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
  }
}
