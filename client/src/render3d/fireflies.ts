// The woodland's fireflies at night (#306): a swarm of small additive glows drifting around the viewer, wrapped into a box so there are
// always some near. Seeded and cosmetic: the same seed drifts the same way. A runtime effect shape, no art.
import { rng } from '../game/covemath';
import type { Cam } from './camera';
import { pushGlow, type GlowBuf } from './cards';
import { footSight, thingHard, type SightMask } from './sightmask';

/** The box (tiles) the swarm is wrapped into around the centre. */
const BOX_W = 32, BOX_Z = 20;
/** A glow's half-size (tiles) and colour (before night and the blink). */
const SIZE = 0.18;
const COLOUR: [number, number, number] = [0.8, 1.0, 0.4];
const TAU = Math.PI * 2;
/** Height above the ground (tiles): a seeded base and a slow bob. */
const HEIGHT = { min: 0.3, span: 0.8, bob: 0.12 };

export class Fireflies {
  readonly x: Float32Array;
  readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vz: Float32Array;
  private readonly wob: Float32Array;
  private readonly rate: Float32Array;
  private readonly phase: Float32Array;
  private readonly high: Float32Array;
  private time = 0;
  readonly count: number;

  constructor(seed: number, count = 70) {
    this.count = count;
    const r = rng(seed * 2654435761 + 97);
    const arr = (): Float32Array => new Float32Array(count);
    this.x = arr(); this.z = arr(); this.vx = arr(); this.vz = arr(); this.wob = arr(); this.rate = arr(); this.phase = arr(); this.high = arr();
    for (let i = 0; i < count; i++) {
      this.x[i] = (r() - 0.5) * BOX_W;
      this.z[i] = (r() - 0.5) * BOX_Z;
      const a = r() * TAU, v = 0.15 + r() * 0.3; // tiles per second
      this.vx[i] = Math.cos(a) * v;
      this.vz[i] = Math.sin(a) * v;
      this.wob[i] = 0.2 + r() * 0.3;
      this.rate[i] = 0.5 + r() * 1.2;
      this.phase[i] = r() * TAU;
      this.high[i] = HEIGHT.min + r() * HEIGHT.span;
    }
  }

  /** Drifts them by `dt` s and wraps each into the box around `centre`. */
  step(dt: number, centre: { x: number; z: number }): void {
    this.time += dt;
    const wrap = (v: number, c: number, size: number): number => c + ((((v - c + size / 2) % size) + size) % size) - size / 2;
    for (let i = 0; i < this.count; i++) {
      const w = Math.sin(this.time * this.rate[i] + this.phase[i]) * this.wob[i];
      // the drift turns slowly: the heading wanders by `w` across the direction of travel
      this.x[i] = wrap(this.x[i] + (this.vx[i] - this.vz[i] * w) * dt, centre.x, BOX_W);
      this.z[i] = wrap(this.z[i] + (this.vz[i] + this.vx[i] * w) * dt, centre.z, BOX_Z);
    }
  }

  /** Pushes the glows, bright at night and blinking slowly; returns how many. Nothing at night 0 or on an unseen texel (`mask` null: all seen). */
  push(glows: GlowBuf, cam: Cam, night: number, mask: SightMask | null): number {
    if (night <= 0) return 0;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * this.rate[i] * 2.1 + this.phase[i] * 1.7));
      const k = night * blink;
      if (k <= 0.01) continue;
      if (mask && thingHard(mask, footSight(mask, this.x[i], this.z[i], 0).hard) <= 0) continue;
      const y = this.high[i] + HEIGHT.bob * Math.sin(this.time * this.rate[i] + this.phase[i] * 0.5);
      pushGlow(glows, this.x[i], y, this.z[i], SIZE, [COLOUR[0] * k, COLOUR[1] * k, COLOUR[2] * k], cam);
      n++;
    }
    return n;
  }
}
