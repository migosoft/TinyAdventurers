// Shimmering blue force field that seals the boss hall entrance once everyone
// is inside. The pack has no such sprite, so it is a runtime effect: a pulsing
// translucent wall with drifting light bands and glittering sparks.
import Phaser from 'phaser';
import { TILE } from '../sim/map';
import { DEPTH, type Effects } from './effects';

const FILL = 0x3a8cff;
const EDGE = 0x9fd8ff;
const GLITTER = [0xbfe8ff, 0xffffff, 0x7fc4ff];
/** How far the wall rises above its tiles (3/4 view: walls have height). */
const RISE = 12;
const FADE_IN = 0.5;

export class ForceField {
  private g: Phaser.GameObjects.Graphics;
  private glow: Phaser.GameObjects.Graphics;
  private x0: number;
  private y0: number;
  private w: number;
  private h: number;
  private horizontal: boolean;
  /** Seconds since the field appeared. */
  age = 0;

  /** `tiles`: the entrance cells, in one row or one column. */
  constructor(scene: Phaser.Scene, private fx: Effects, tiles: [number, number][], appear: boolean) {
    const xs = tiles.map(([x]) => x);
    const ys = tiles.map(([, y]) => y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    this.horizontal = minY === maxY;
    if (this.horizontal) {
      // A curtain standing on the entrance row.
      this.x0 = minX * TILE;
      this.w = (maxX - minX + 1) * TILE;
      this.y0 = minY * TILE + 6 - RISE;
      this.h = RISE + 8;
    } else {
      // Seen edge-on: a narrow band down the entrance column.
      this.x0 = minX * TILE + 4;
      this.w = TILE - 8;
      this.y0 = minY * TILE - RISE;
      this.h = (maxY - minY + 1) * TILE + RISE;
    }
    // Sorted with the figures by its foot line, so players in front overlap it.
    const depth = DEPTH.entityBase + this.y0 + this.h;
    this.glow = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    this.g = scene.add.graphics().setDepth(depth);
    if (!appear) this.age = FADE_IN;
    else for (let i = 0; i < 40; i++) this.sparkle(true);
  }

  update(dt: number): void {
    this.age += dt;
    const k = Math.min(1, this.age / FADE_IN);
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 3.1);
    const { x0, y0, w, h } = this;
    const g = this.g.clear();
    g.fillStyle(FILL, (0.22 + 0.1 * pulse) * k).fillRect(x0, y0, w, h);
    // Light bands drifting across the field.
    const len = this.horizontal ? h : w;
    for (let i = 0; i < 3; i++) {
      const p = (this.age * (0.6 + i * 0.25) + i / 3) % 1;
      const a = (0.25 + 0.2 * Math.sin(this.age * 5 + i * 2)) * k;
      g.fillStyle(EDGE, a);
      if (this.horizontal) g.fillRect(x0, y0 + p * len, w, 1);
      else g.fillRect(x0 + p * len, y0, 1, h);
    }
    // Bright rims along the field's edges.
    g.fillStyle(EDGE, (0.55 + 0.35 * pulse) * k);
    if (this.horizontal) {
      g.fillRect(x0, y0, w, 1).fillRect(x0, y0 + h - 1, w, 1);
    } else {
      g.fillRect(x0, y0, 1, h).fillRect(x0 + w - 1, y0, 1, h);
    }
    this.glow.clear().fillStyle(FILL, (0.12 + 0.1 * pulse) * k).fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
    // Glitter: a few sparks a frame.
    const n = Math.random() < (w * h) / 2500 ? 2 : 1;
    for (let i = 0; i < n; i++) this.sparkle(false);
  }

  private sparkle(burst: boolean): void {
    const x = this.x0 + Math.random() * this.w;
    const y = this.y0 + Math.random() * this.h;
    const c = GLITTER[Math.floor(Math.random() * GLITTER.length)];
    const vx = burst ? (Math.random() - 0.5) * 40 : 0;
    const vy = burst ? (Math.random() - 0.5) * 40 : -6 - Math.random() * 10;
    this.fx.particle(x, y, vx, vy, 0.4 + Math.random() * 0.5, c, {
      frame: Math.random() < 0.5 ? 'spark' : 'dot',
      shrink: true,
      depth: this.g.depth + 1,
    });
  }

  destroy(): void {
    this.g.destroy();
    this.glow.destroy();
  }
}
