// The dust (dungeon) and pollen (woodland) of the air (#307): a port of the dust half of game/mood.ts into world tiles with
// height. Loose clouds of motes wander, ride the air, are stirred apart by movers, fade and respawn. A speck has no colour of its
// own: the shader lights it (the scene minus ambient), so the light share of the 2D alpha is not computed here, only where a
// cloud may spawn (`airLightAt`).
import { DUST_ALPHA, MAX_CLOUDS, cloudCount, dustTint } from '../../game/moodmath';
import type { Light } from '../light';
import { PX, STIR_SPEED, airAt, clamp, hidden, rnd, type AirCtx } from './airCtx';
import { airLightAt } from './airLight';
import { CLOUD_MOTES, type AirParts } from './airParts';
import type { Crack } from './cracks';

/** A speck is this wide, in tiles: one art pixel (the user: smaller than the demo's; first guess). */
export const SPECK = PX;
/** A cloud's height when it spawns: DUST_Y0 + DUST_YSPAN * rng, tiles (first guess; the demo's specks reach 2.6, kept lower so they stay in the room). */
export const DUST_Y0 = 0.2;
export const DUST_YSPAN = 1.6;
/** Clouds drift no higher than this (tiles; first guess). */
export const DUST_TOP = 2.4;
/** A cloud's spread radius (2D: 6..16 px), tiles. */
const CLOUD_R0 = 6 * PX;
const CLOUD_R1 = 16 * PX;
/** Motes are spread this share of the radius up and down (first guess). */
const MOTE_Y = 0.4;
/** Seconds a cloud lives. */
const LIFE0 = 6;
const LIFE1 = 12;
/** Floating up, tiles/s^2 (2D: 0.3 px/s^2). */
const FLOAT = 0.3 * PX;
/** With the wind off a cloud's height wanders by this much speed per second (tiles/s^2) within +-DUST_WANDER_Y (first guess). */
const DUST_WANDER_Y = 2 * PX;
/** Loose motes sink no lower than this (tiles; first guess). */
const MOTE_FLOOR = 0.05;
/** How fast (1/s) a drifting cloud and a loose mote follow the air, and the drag on a loose mote (1/s). */
const CLOUD_FOLLOW = 2;
const MOTE_FOLLOW = 6;
const MOTE_DRAG = 0.6;
/** Brightness a spawn spot needs (kept with chance b^2 above it). */
const SPAWN_MIN = 0.05;
const SPAWN_TRIES = 8;
/** Seconds before a cloud that found no lit spot tries again. */
const RETRY = 0.3;

interface Mote {
  /** Offset from the cloud's centre, and its own slow wander. */
  ox: number; oy: number; oz: number;
  vx: number; vy: number; vz: number;
  phase: number;
  /** Once the cloud is stirred: world position, seconds of fade left and in all, and the alpha it had. */
  wx: number; wy: number; wz: number;
  left: number;
  total: number;
  a0: number;
  a: number;
}

interface Cloud {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  max: number;
  /** Spread radius (tiles). */
  r: number;
  /** Has a place (false: waiting to retry, shows nothing). */
  live: boolean;
  motes: Mote[];
  /** Stirred apart: its motes follow the air on their own, then fade; `wait` s of hiding remain after the last is gone. */
  stirred: boolean;
  wait: number;
}

/** What the dust needs of a frame. */
export interface DustInput {
  lights: readonly Light[];
  cracks: readonly Crack[];
  drift: readonly [number, number] | null;
  pollen: boolean;
  respawn: number;
}

export class Dust {
  /** Clouds in use this frame, and of them stirred apart. */
  active = 0;
  stirred = 0;
  private clouds: Cloud[] = [];

  constructor(private c: AirCtx) {
    const rng = c.rng;
    for (let n = 0; n < MAX_CLOUDS; n++) {
      const motes: Mote[] = [];
      for (let i = 0; i < CLOUD_MOTES; i++) motes.push({ ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, phase: rng() * 10, wx: 0, wy: 0, wz: 0, left: 0, total: 1, a0: 0, a: 0 });
      // Staggered first lives, so the clouds do not all appear and vanish together.
      this.clouds.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: rng() * 2, max: 1, r: 10 * PX, live: false, motes, stirred: false, wait: 0 });
    }
  }

  /** Advances the clouds by `dt` s and writes the specks of `out`. `on` false: the clouds go on, nothing is written. */
  step(dt: number, i: DustInput, out: AirParts['specks']): void {
    const c = this.c;
    out.count = 0;
    this.active = cloudCount((c.fp.x1 - c.fp.x0) / PX, (c.fp.z1 - c.fp.z0) / PX);
    this.stirred = 0;
    for (let n = 0; n < this.clouds.length; n++) {
      const cl = this.clouds[n];
      if (n >= this.active) {
        cl.live = false;
        cl.stirred = false;
        cl.wait = 0;
        cl.life = c.rng() * 2; // starts staggered when it is needed again
        continue;
      }
      if (cl.stirred) {
        this.stirred++;
        this.stirredStep(dt, cl, i, out);
        continue;
      }
      cl.life -= dt;
      if (cl.life <= 0) this.spawn(cl, i);
      if (!cl.live) continue;
      const dx = i.drift ? i.drift[0] : 0;
      const dz = i.drift ? i.drift[1] : 0;
      if (c.windOn) {
        // The cloud rides the air at its centre, with a slight float upwards.
        const w = airAt(c, cl.x, cl.z);
        const k = Math.min(1, CLOUD_FOLLOW * dt);
        cl.vx += (w[0] - cl.vx) * k;
        cl.vz += (w[1] - cl.vz) * k;
        cl.vy += -cl.vy * k + FLOAT * dt;
      } else {
        cl.vx = clamp(cl.vx + (c.rng() - 0.5) * 4 * PX * dt, -2.5 * PX, 2.5 * PX);
        cl.vz = clamp(cl.vz + (c.rng() - 0.5) * 4 * PX * dt, -2.5 * PX, 2.5 * PX);
        cl.vy = clamp(cl.vy + (c.rng() - 0.5) * DUST_WANDER_Y * dt + FLOAT * dt, -2.5 * PX, 2 * PX);
      }
      cl.x += (cl.vx + dx) * dt;
      cl.y = clamp(cl.y + cl.vy * dt, DUST_Y0, DUST_TOP);
      cl.z += (cl.vz + dz) * dt;
      if (c.on.stir && this.stirs(cl)) {
        this.stir(cl);
        this.stirred++;
        this.stirredStep(dt, cl, i, out);
        continue;
      }
      const fade = Math.min(1, (cl.max - cl.life) / 1.5, cl.life / 1.5);
      for (const m of cl.motes) {
        m.vx = clamp(m.vx + (c.rng() - 0.5) * 3 * PX * dt, -1.5 * PX, 1.5 * PX);
        m.vy = clamp(m.vy + (c.rng() - 0.5) * 3 * PX * dt, -1.5 * PX, 1.5 * PX);
        m.vz = clamp(m.vz + (c.rng() - 0.5) * 3 * PX * dt, -1.5 * PX, 1.5 * PX);
        m.ox += m.vx * dt;
        m.oy += m.vy * dt;
        m.oz += m.vz * dt;
        // Pulled back gently when it strays past the cloud's edge.
        if (Math.hypot(m.ox, m.oz) > cl.r) {
          m.ox *= 1 - 0.5 * dt;
          m.oz *= 1 - 0.5 * dt;
        }
        if (Math.abs(m.oy) > MOTE_Y * cl.r) m.oy *= 1 - 0.5 * dt;
        const twinkle = 0.6 + 0.4 * Math.sin(c.t * 2.3 + m.phase);
        m.a = DUST_ALPHA * fade * twinkle;
        this.put(out, cl.x + m.ox, cl.y + m.oy, cl.z + m.oz, m.a);
      }
    }
    if (!c.on.dust) out.count = 0;
  }

  private put(out: AirParts['specks'], x: number, y: number, z: number, a: number): void {
    const k = out.count++;
    out.pos[k * 3] = x;
    out.pos[k * 3 + 1] = y;
    out.pos[k * 3 + 2] = z;
    out.alpha[k] = a;
  }

  /** True when the air at (x, z) is faster than STIR_SPEED. */
  private stirredAt(x: number, z: number): boolean {
    const w = airAt(this.c, x, z);
    return w[0] * w[0] + w[1] * w[1] > STIR_SPEED * STIR_SPEED;
  }

  /** True when any mote of the cloud sits in air faster than STIR_SPEED. */
  private stirs(cl: Cloud): boolean {
    for (const m of cl.motes) if (this.stirredAt(cl.x + m.ox, cl.z + m.oz)) return true;
    return false;
  }

  private spawn(cl: Cloud, i: DustInput): void {
    const c = this.c;
    // Denser where it is bright: try a few spots, keep one with a chance by its brightness. Pollen is lit by the sun, which the
    // shader knows: any seen spot will do.
    for (let k = 0; k < SPAWN_TRIES; k++) {
      const x = c.fp.x0 + c.rng() * (c.fp.x1 - c.fp.x0);
      const z = c.fp.z0 + c.rng() * (c.fp.z1 - c.fp.z0);
      const y = DUST_Y0 + DUST_YSPAN * c.rng();
      if (hidden(c, x, z) || c.map.hardOpaque(Math.floor(x), Math.floor(z)) || this.stirredAt(x, z)) continue;
      if (!i.pollen) {
        const [r, g, b] = airLightAt(x, y, z, i.lights, i.cracks);
        const [br] = dustTint(r * 255, g * 255, b * 255);
        if (!(br > SPAWN_MIN && c.rng() < br * br)) continue;
      }
      cl.stirred = false;
      cl.live = true;
      cl.x = x;
      cl.y = y;
      cl.z = z;
      cl.vx = (c.rng() - 0.5) * 4 * PX;
      cl.vz = (c.rng() - 0.5) * 3 * PX;
      cl.vy = 0;
      cl.max = cl.life = rnd(c, LIFE0, LIFE1);
      cl.r = rnd(c, CLOUD_R0, CLOUD_R1);
      for (const m of cl.motes) {
        const a = c.rng() * Math.PI * 2;
        const d = cl.r * Math.sqrt(c.rng());
        m.ox = Math.cos(a) * d;
        m.oz = Math.sin(a) * d;
        m.oy = (c.rng() * 2 - 1) * MOTE_Y * cl.r;
        m.vx = (c.rng() - 0.5) * 1.5 * PX;
        m.vy = (c.rng() - 0.5) * 1.5 * PX;
        m.vz = (c.rng() - 0.5) * 1.5 * PX;
        m.a = 0;
      }
      return;
    }
    cl.stirred = false;
    cl.live = false;
    cl.life = cl.max = RETRY; // nothing lit found: try again soon
  }

  /** The cloud falls apart: each mote keeps its place and the cloud's velocity, and will fade out in 1 to 2 s. */
  private stir(cl: Cloud): void {
    cl.stirred = true;
    cl.wait = 0;
    for (const m of cl.motes) {
      m.wx = cl.x + m.ox;
      m.wy = cl.y + m.oy;
      m.wz = cl.z + m.oz;
      m.vx = cl.vx;
      m.vy = cl.vy;
      m.vz = cl.vz;
      m.a0 = m.a;
      m.left = m.total = rnd(this.c, 1, 2);
    }
  }

  /** Loose motes follow the air, slow down and fade; once all are gone the cloud waits `respawn` s, then respawns. */
  private stirredStep(dt: number, cl: Cloud, i: DustInput, out: AirParts['specks']): void {
    const c = this.c;
    const dx = i.drift ? i.drift[0] : 0;
    const dz = i.drift ? i.drift[1] : 0;
    let alive = false;
    for (const m of cl.motes) {
      if (m.left <= 0) continue;
      m.left -= dt;
      if (m.left <= 0) continue;
      alive = true;
      const w = airAt(c, m.wx, m.wz);
      const k = Math.min(1, MOTE_FOLLOW * dt);
      const drag = Math.max(0, 1 - MOTE_DRAG * dt);
      m.vx = (m.vx + (w[0] - m.vx) * k) * drag;
      m.vz = (m.vz + (w[1] - m.vz) * k) * drag;
      m.vy *= drag;
      m.wx += (m.vx + dx) * dt;
      m.wy = clamp(m.wy + m.vy * dt, MOTE_FLOOR, DUST_TOP);
      m.wz += (m.vz + dz) * dt;
      this.put(out, m.wx, m.wy, m.wz, m.a0 * (m.left / m.total));
    }
    if (alive) return;
    if (cl.wait > 0) cl.wait -= dt;
    else cl.wait = i.respawn;
    if (cl.wait > 0) return;
    cl.wait = 0;
    this.spawn(cl, i);
  }
}
