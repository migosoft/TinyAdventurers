// Water drips (#307): a port of game/mood-drips.ts into world tiles. A drop falls into a pool, leaving two splash pixels and, the frame it
// lands, a report in `AirParts.landed` for the water's ripple.
import { DRIP_EVERY, MAX_DRIPS, spawnCount } from '../../game/moodmath';
import { WATER_LEVEL } from '../dips/shape';
import { PX } from './airCtx';
import type { AirParts } from './airParts';

/** Seconds a drop falls, and the drip lasts after landing (as the 2D). */
export const DRIP_FALL = 0.35;
export const DRIP_RING = 1.0;
/** Where a drop starts: above the wall tops (first guess), tiles. */
export const DRIP_TOP = 3;
/** The height the drop falls to and the splash starts from (tiles, absolute): just above the water's surface, which is at WATER_LEVEL, below the floor. */
export const WATER_Y = WATER_LEVEL + 0.01;
/** The drop's width in tiles (1 art px); the splash pixels are the same. */
export const DROP_SIZE = PX;
/** The drops' and splash pixels' colour (the 2D 0xd8ecff); the renderer tints them with it. */
export const DROP_RGB = 0xd8ecff;
export const DROP_ALPHA = 0.85;
export const SPLASH_ALPHA = 0.8;
/** The splash lasts this share of the drip's time after landing, and hops this high (px; 2D). */
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
   * none new, none shown. Writes the drops and the landings of `parts`.
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
    const landed = parts.landed;
    drops.count = 0;
    landed.count = 0;
    const drop = (x: number, y: number, z: number, a: number, splash: number) => {
      const i = drops.count++;
      drops.pos[i * 3] = x;
      drops.pos[i * 3 + 1] = y;
      drops.pos[i * 3 + 2] = z;
      drops.size[i] = DROP_SIZE;
      drops.alpha[i] = a;
      drops.splash[i] = splash;
    };
    for (let i = this.n - 1; i >= 0; i--) {
      const d = this.drips[i];
      const before = d.t;
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
      // The frame the drop reaches the water: once, for the water's ripple.
      if (before < DRIP_FALL) {
        const j = landed.count++;
        landed.pos[j * 2] = d.x;
        landed.pos[j * 2 + 1] = d.z;
      }
      // Splash: two droplets hop up and fall back in the first moments.
      if (k < SPLASH_SHARE) {
        const h = Math.sin((k / SPLASH_SHARE) * Math.PI) * SPLASH_HOP * PX;
        drop(d.x - 1.5 * PX, WATER_Y + h, d.z, SPLASH_ALPHA, 1);
        drop(d.x + 2 * PX, WATER_Y + h * 0.8, d.z, SPLASH_ALPHA, 1);
      }
    }
  }
}
