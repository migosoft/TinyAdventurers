// The Shade's looks that are not a sprite (#170): a lingering dark haze that trails it, the flat silhouette
// that warns of an ambush, and the cloud it dies in. The maths is pure (tested); `ShadeHaze` only draws it.
import type Phaser from 'phaser';

/** Server wind-up of the ambush (`AMBUSH_WARNING` in run/ambush.rs). */
export const AMBUSH_WARNING = 0.5;
/** The flat fill of the silhouette during the wind-up. */
export const SILHOUETTE_FILL = 0x120c18;
const SILHOUETTE_ALPHA_FROM = 0.2;
const SILHOUETTE_ALPHA_TO = 0.9;

/** The silhouette's alpha `t` seconds into the ambush wind-up: 0.2 rising to 0.9 over `AMBUSH_WARNING`. */
export function silhouetteAlpha(t: number): number {
  const k = Math.min(Math.max(t / AMBUSH_WARNING, 0), 1);
  return SILHOUETTE_ALPHA_FROM + (SILHOUETTE_ALPHA_TO - SILHOUETTE_ALPHA_FROM) * k;
}

/** Haze and cloud colour: dark grey with a hint of violet, light enough to read on a dark floor. */
export const HAZE_COLOR = 0x2a2433;
const HAZE_MIN = 10;
const HAZE_MAX = 14;
/** The haze circles within this many px of the Shade. */
const ORBIT_MIN = 3;
const ORBIT_MAX = 8;
/** Seconds a particle takes to ease most of the way (1/e) toward its spot beside the Shade. */
const TAU_MIN = 0.15;
const TAU_MAX = 0.35;
/** Squash of the orbit: a ring seen from a little above. */
const ORBIT_FLAT = 0.75;

export interface HazePoint {
  x: number;
  y: number;
  alpha: number;
  /** Display scale of the soft blob. */
  size: number;
}

interface Mote extends HazePoint {
  angle: number;
  /** rad/s, either way round. */
  spin: number;
  radius: number;
  tau: number;
}

type Rng = () => number;

/** The haze's state: 10 to 14 motes circling the Shade, each easing toward it at its own rate so a move leaves a short trail. */
export class HazeCloud {
  private motes: Mote[] = [];

  constructor(private rnd: Rng = Math.random) {}

  /** Where the motes are now; empty while there is nothing to follow. */
  get points(): readonly HazePoint[] {
    return this.motes;
  }

  /** Moves the haze `dt` seconds on. A null target (invisible, culled) clears it, so none is left behind. */
  step(target: { x: number; y: number } | null, dt: number): void {
    if (!target) {
      this.motes = [];
      return;
    }
    const r = this.rnd;
    if (this.motes.length === 0) {
      const n = HAZE_MIN + Math.floor(r() * (HAZE_MAX - HAZE_MIN + 1));
      for (let i = 0; i < n; i++) {
        this.motes.push({
          x: target.x,
          y: target.y,
          alpha: 0.35 + r() * 0.15,
          size: 1.5 + r() * 0.9,
          angle: r() * Math.PI * 2,
          spin: (0.6 + r() * 1.0) * (r() < 0.5 ? -1 : 1),
          radius: ORBIT_MIN + r() * (ORBIT_MAX - ORBIT_MIN),
          tau: TAU_MIN + r() * (TAU_MAX - TAU_MIN),
        });
      }
    }
    for (const m of this.motes) {
      m.angle += m.spin * dt;
      const gx = target.x + Math.cos(m.angle) * m.radius;
      const gy = target.y + Math.sin(m.angle) * m.radius * ORBIT_FLAT;
      const k = 1 - Math.exp(-dt / m.tau);
      m.x += (gx - m.x) * k;
      m.y += (gy - m.y) * k;
    }
  }
}

const CLOUD_COUNT = 20;
const CLOUD_SPREAD = 18;
const CLOUD_LIFE = 0.8;

/** The dark cloud a Shade dies in: about 20 particles (velocities in px/s) that spread to at most 18 px and fade over 0.8 s. */
export function deathCloud(rnd: Rng = Math.random): { life: number; particles: { vx: number; vy: number; scale: number }[] } {
  const particles = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const a = rnd() * Math.PI * 2;
    const speed = (CLOUD_SPREAD / CLOUD_LIFE) * (0.3 + rnd() * 0.7);
    particles.push({ vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * ORBIT_FLAT, scale: 1.6 + rnd() * 0.9 });
  }
  return { life: CLOUD_LIFE, particles };
}

/** Draws a `HazeCloud` as soft dark blobs in the world, just under the figure; they stay where the Shade left them while they ease. */
export class ShadeHaze {
  private cloud = new HazeCloud();
  private imgs: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {}

  /** Follows `target` (the Shade's centre), or clears the haze when it is null. */
  update(target: { x: number; y: number } | null, depth: number, dt: number): void {
    this.cloud.step(target, dt);
    const pts = this.cloud.points;
    while (this.imgs.length < pts.length) this.imgs.push(this.scene.add.image(0, 0, 'glow').setTint(HAZE_COLOR));
    this.imgs.forEach((img, i) => {
      const p = pts[i];
      if (!p) return img.setVisible(false);
      img.setVisible(true).setPosition(p.x, p.y).setAlpha(p.alpha).setScale(p.size).setDepth(depth);
    });
  }

  destroy(): void {
    for (const img of this.imgs) img.destroy();
    this.imgs = [];
  }
}
