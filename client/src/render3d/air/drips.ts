// Water drips (#307): a port of game/mood-drips.ts into world tiles. A drop falls into a pool, leaving two ripple rings (real circles
// on the water, no 3/4 flattening) and two splash pixels.
import { DRIP_EVERY, MAX_DRIPS, spawnCount } from '../../game/moodmath';
import { WATER_LEVEL } from '../dips/shape';
import { PX } from './airCtx';
import type { AirParts } from './airParts';

/** Seconds a drop falls, and the rings last (as the 2D). */
export const DRIP_FALL = 0.35;
export const DRIP_RING = 1.0;
/** Where a drop starts: above the wall tops (first guess), tiles. */
export const DRIP_TOP = 3;
/** The rings and splash lie this far above the water's surface (tiles; the surface is at WATER_LEVEL, below the floor). */
export const WATER_Y = WATER_LEVEL + 0.01;
/** The drop's width in tiles (1 art px); the splash pixels are the same. */
export const DROP_SIZE = PX;
/** The drops' and splash pixels' colour (the 2D 0xd8ecff); the renderer tints them with it. */
export const DROP_RGB = 0xd8ecff;
export const DROP_ALPHA = 0.85;
export const SPLASH_ALPHA = 0.8;
export const RING_ALPHA = 0.7;
/** The splash lasts this share of the rings' time, and hops this high (px; 2D). */
const SPLASH_SHARE = 0.3;
const SPLASH_HOP = 3;

interface Drip {
  x: number;
  z: number;
  t: number;
}

/** The water drips of the air; `Air3d` calls `step` every frame with the water tiles in view. */
export class Drips {
  private drips: Drip[] = [];
  private n = 0;
  private acc = 0;
  /** Drips started since the start (for tests). */
  spawned = 0;

  constructor(private rng: () => number) {}

  /** Drips in progress (falling or rippling). */
  get count(): number {
    return this.n;
  }

  /**
   * Drops fall into the `water` tiles in view (about one per tile per `DRIP_EVERY` s), up to `MAX_DRIPS` at once; `on` false:
   * none new, none shown. Writes the drops and rings of `parts`.
   */
  step(dt: number, water: readonly (readonly [number, number])[], on: boolean, parts: AirParts): void {
    let c: number;
    [c, this.acc] = spawnCount(this.acc, dt, water.length, DRIP_EVERY);
    for (; c > 0 && on && this.n < MAX_DRIPS; c--) {
      const [tx, tz] = water[Math.floor(this.rng() * water.length)];
      const d = (this.drips[this.n] ??= { x: 0, z: 0, t: 0 });
      d.x = tx + 0.2 + this.rng() * 0.6;
      d.z = tz + 0.25 + this.rng() * 0.6;
      d.t = 0;
      this.n++;
      this.spawned++;
    }
    const drops = parts.drops;
    const rings = parts.rings;
    drops.count = 0;
    rings.count = 0;
    const drop = (x: number, y: number, z: number, a: number, splash: number) => {
      const i = drops.count++;
      drops.pos[i * 3] = x;
      drops.pos[i * 3 + 1] = y;
      drops.pos[i * 3 + 2] = z;
      drops.size[i] = DROP_SIZE;
      drops.alpha[i] = a;
      drops.splash[i] = splash;
    };
    const ring = (x: number, z: number, kk: number, w: number) => {
      if (kk <= 0 || kk >= 1) return;
      const i = rings.count++;
      rings.pos[i * 3] = x;
      rings.pos[i * 3 + 1] = WATER_Y;
      rings.pos[i * 3 + 2] = z;
      rings.radius[i] = ((2 + w * kk) / 2) * PX;
      rings.alpha[i] = RING_ALPHA * (1 - kk);
    };
    for (let i = this.n - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.t += dt;
      if (d.t < DRIP_FALL) {
        if (on) {
          const k = d.t / DRIP_FALL;
          drop(d.x, WATER_Y + (DRIP_TOP - WATER_Y) * (1 - k * k), d.z, DROP_ALPHA, 0);
        }
        continue;
      }
      const k = (d.t - DRIP_FALL) / DRIP_RING;
      if (k >= 1) {
        this.drips[i] = this.drips[this.n - 1];
        this.drips[this.n - 1] = d;
        this.n--;
        continue;
      }
      if (!on) continue;
      ring(d.x, d.z, k, 12);
      ring(d.x, d.z, (k - 0.2) / 0.8, 7);
      // Splash: two droplets hop up and fall back in the first moments.
      if (k < SPLASH_SHARE) {
        const h = Math.sin((k / SPLASH_SHARE) * Math.PI) * SPLASH_HOP * PX;
        drop(d.x - 1.5 * PX, WATER_Y + h, d.z, SPLASH_ALPHA, 1);
        drop(d.x + 2 * PX, WATER_Y + h * 0.8, d.z, SPLASH_ALPHA, 1);
      }
    }
  }
}
