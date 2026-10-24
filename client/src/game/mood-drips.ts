// Water drips for the dungeon air: a drop falls into a pool, leaving two flattened ripple rings and a splash.
import type Phaser from 'phaser';
import { TILE } from '../sim/map';
import { DEPTH } from './effects';
import { DRIP_EVERY, MAX_DRIPS, spawnCount } from './moodmath';

const DRIP_FALL = 0.35;
const DRIP_RING = 1.0;

/** A drop falling onto the tile (y0 → y1), then two ripple rings and a little splash. */
interface Drip {
  drop: Phaser.GameObjects.Image;
  rings: Phaser.GameObjects.Graphics;
  x: number;
  y0: number;
  y1: number;
  t: number;
}

export class Drips {
  private drips: Drip[] = [];
  private freeDrops: Phaser.GameObjects.Image[] = [];
  private freeRings: Phaser.GameObjects.Graphics[] = [];
  private acc = 0;

  /** `own` registers each made object with the owner, which destroys them. */
  constructor(private scene: Phaser.Scene, private own: <T extends { destroy(): void }>(o: T) => T) {}

  get count(): number {
    return this.drips.length;
  }

  /** Drops fall into the `water` tiles in view (about one per tile per `DRIP_EVERY` s), up to `MAX_DRIPS` at once; `on` false: none new, none shown. */
  
  /** Drops falling into water in view, each leaving two ripple rings (flattened for the 3/4 view) and a splash. */
  update(dt: number, water: [number, number][], on: boolean): void {
    let c: number;
    [c, this.acc] = spawnCount(this.acc, dt, water.length, DRIP_EVERY);
    for (; c > 0 && on && this.drips.length < MAX_DRIPS; c--) {
      const [tx, ty] = water[Math.floor(Math.random() * water.length)];
      const x = (tx + 0.2 + Math.random() * 0.6) * TILE;
      const y1 = (ty + 0.25 + Math.random() * 0.6) * TILE;
      const drop = this.freeDrops.pop() ?? this.own(this.scene.add.image(0, 0, 'dot'));
      drop.setScale(0.5, 1).setTint(0xd8ecff).setBlendMode(0).setDepth(DEPTH.airDrips).setVisible(true).setAlpha(0.85);
      const rings = this.freeRings.pop() ?? this.own(this.scene.add.graphics());
      rings.setDepth(DEPTH.airDrips).setVisible(false).clear();
      this.drips.push({ drop, rings, x, y0: y1 - 18, y1, t: 0 });
    }
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.t += dt;
      if (d.t < DRIP_FALL) {
        const k = d.t / DRIP_FALL;
        d.drop.setPosition(d.x, d.y0 + (d.y1 - d.y0) * k * k).setVisible(on);
        continue;
      }
      d.drop.setVisible(false);
      const k = (d.t - DRIP_FALL) / DRIP_RING;
      if (k >= 1) {
        d.rings.setVisible(false).clear();
        this.freeDrops.push(d.drop);
        this.freeRings.push(d.rings);
        this.drips.splice(i, 1);
        continue;
      }
      const g = d.rings.clear().setVisible(on);
      const ring = (kk: number, w: number) => {
        if (kk <= 0 || kk >= 1) return;
        g.lineStyle(1, 0xd8ecff, 0.7 * (1 - kk)).strokeEllipse(d.x, d.y1, 2 + w * kk, (2 + w * kk) * 0.5);
      };
      ring(k, 12);
      ring((k - 0.2) / 0.8, 7);
      // Splash: two droplets hop up and fall back in the first moments.
      if (k < 0.3) {
        const h = Math.sin((k / 0.3) * Math.PI) * 3;
        g.fillStyle(0xd8ecff, 0.8).fillRect(d.x - 2, d.y1 - h - 0.5, 1, 1).fillRect(d.x + 1.5, d.y1 - h * 0.8 - 0.5, 1, 1);
      }
    }
  }
}
