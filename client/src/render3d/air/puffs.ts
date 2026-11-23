// Smoke and embers (#307): simulated in world tiles with height. Torch smoke in gusts,
// lava smoke and sparks, fire trails and blast bursts; rising speeds, sway, wind share, life and fade are in tiles.
import { LIGHT_KIND } from '../../generated/defs';
import { LAVA_LEVEL } from '../dips/shape';
import { BurstOnce, LAVA_EMBER_EVERY, LAVA_SMOKE_EVERY, MAX_EMBERS, MAX_SMOKE, spawnCount } from '../../game/moodmath';
import { SHOT_LIFT } from '../camera';
import { EMBER_COLOURS, EMBER_WIND, PX, SMOKE_WIND, airAt, clamp, hidden, inView, rnd, type AirCtx } from './airCtx';
import type { AirParts } from './airParts';
import type { AirShot } from '../../game/airTypes';
import { flameTip } from '../torch/torch';

/** Lava smoke and sparks rise from the pool's surface, this high (tiles; first guess). */
export const LAVA_Y = LAVA_LEVEL + 0.02;
/** An ember is this wide at birth and at the end of its life (tiles): 1 art px going to 0.6. */
export const EMBER_SIZE0 = PX;
export const EMBER_SIZE1 = 0.6 * PX;
/** A blast's burst starts this high (tiles; first guess). */
export const BLAST_Y = 0.5;
/** A blast's embers leap up at BLAST_LEAP0 + up to BLAST_LEAP tiles/s (first guess). */
const BLAST_LEAP0 = 10 * PX;
const BLAST_LEAP = 25 * PX;
/** Torch smoke starts up to this far above the flame's top (tiles; 1.5 px). */
const SMOKE_JITTER_Y = 1.5 * PX;
// Torch smoke is a thin wisp now and then (#391); every number here is a first guess until the user has judged it.
/** A gust lasts this long (s, least and most): a handful of puffs that rise as one streak. */
export const GUST_S = [0.5, 1.2] as const;
/** The quiet gap between two gusts (s, least and most); a torch new in view starts somewhere inside one. */
export const GAP_S = [4, 10] as const;
/** In a gust a puff starts every so many seconds (least and most). */
const PUFF_EVERY = [0.05, 0.11] as const;
/** In a gap a stray puff may start every so many seconds (least and most), with the chance STRAY each time. */
const STRAY_EVERY = [0.6, 1.4] as const;
const STRAY = 0.1;
/** A torch puff's radius in tiles (`puff()` doubles it to the drawn width) at birth, about the flame's tip, and at the end of its life, grey and soot (least and most). */
const WISP_S0 = 0.07;
const WISP_S1 = [0.14, 0.24] as const;
const WISP_SOOT_S1 = [0.18, 0.28] as const;
/** A torch puff's opacity at its fullest, grey and soot: few puffs make a wisp, so each is denser than a cloud's. */
const WISP_A = 0.6;
const WISP_SOOT_A = 0.65;
/** A blast throws this many embers, once. */
const BLAST_EMBERS = 18;
/** Seconds between a fire shot's embers. */
const TRAIL_EVERY = 0.04;
/** The air carries an ember sideways this much slower; smoke slows by this much per second as it rises. */
const RISE_DRAG = 0.25;
const SOOT = 0x2e2824;
const SMOKE_GREY = 0xb09a86;
const LAVA_SMOKE = 0x4a3c38;

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a: number;
  sway: number;
  rgb: number;
  /** Torch smoke: the floor tile whose sight it needs and the air it takes (tx < 0: none), and how visible it is now (0..1, eases). */
  tx: number;
  tz: number;
  /** The torch's wall normal (the axis toward the wall is the one clamped when sampling). */
  nx: number;
  nz: number;
  vis: number;
}

/** A growing pool of puffs; swap-removal keeps the used ones first. */
class Pool {
  items: Puff[] = [];
  n = 0;
  add(): Puff {
    return (this.items[this.n++] ??= { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0, s1: 0, a: 0, sway: 0, rgb: 0, tx: -1, tz: -1, nx: 0, nz: 0, vis: 1 });
  }
  remove(i: number): void {
    const p = this.items[i];
    this.items[i] = this.items[this.n - 1];
    this.items[this.n - 1] = p;
    this.n--;
  }
}

/** Per torch: in a gust or a quiet gap, time left in it, time to the next puff, and the gust's soot share. */
interface Gust {
  burst: boolean;
  left: number;
  next: number;
  soot: number;
  stamp: number;
}

/** What the puffs need of a frame. */
export interface PuffInput {
  torches: readonly { x: number; z: number; nx: number; nz: number; lit: boolean; tx: number; tz: number }[];
  shots: readonly AirShot[];
}

export class Puffs {
  private smoke = new Pool();
  private embers = new Pool();
  private gusts = new Map<number, Gust>();
  private blasts = new BurstOnce();
  private hadBlasts = false;
  private blastNow: AirShot[] = [];
  private smokeAcc = 0;
  private emberAcc = 0;
  private fireClock = 0;
  private stamp = 0;

  constructor(private c: AirCtx) {}

  get smokeCount(): number {
    return this.smoke.n;
  }
  get emberCount(): number {
    return this.embers.n;
  }

  /** Starts new puffs and embers (`lava` are the lava tiles in view and seen). A blast also kicks the wind, so call this before the wind steps. */
  emit(dt: number, i: PuffInput, lava: readonly (readonly [number, number])[]): void {
    this.updateFire(dt, i.shots);
    this.updateTorches(dt, i.torches);
    this.updateLava(dt, lava);
  }

  /** Moves and fades everything (after the wind stepped) and writes the puffs and embers of `out`. */
  step(dt: number, out: AirParts): void {
    this.advance(dt, this.smoke, SMOKE_WIND, out);
    this.advance(dt, this.embers, EMBER_WIND, out);
  }

  private ember(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const c = this.c;
    if (!c.on.embers || this.embers.n >= MAX_EMBERS) return;
    const p = this.embers.add();
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.max = life;
    p.s0 = EMBER_SIZE0; p.s1 = EMBER_SIZE1; p.a = 1; p.sway = 6 * PX;
    p.rgb = EMBER_COLOURS[c.rng() < 0.5 ? 0 : 1];
    p.tx = p.tz = -1;
    p.vis = 1;
  }

  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, max: number, s1: number, a: number, sway: number, rgb: number, s0: number, tx = -1, tz = -1, nx = 0, nz = 0): void {
    const p = this.smoke.add();
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.max = max;
    // The blob texture is 32 px: a scale `s` is a diameter of 2 s tiles.
    p.s0 = 2 * s0; p.s1 = 2 * s1; p.a = a; p.sway = sway; p.rgb = rgb;
    p.tx = tx; p.tz = tz; p.nx = nx; p.nz = nz; p.vis = 1;
  }

  /** Fire shots trail embers; a blast throws a burst once, when it first shows. */
  private updateFire(dt: number, shots: readonly AirShot[]): void {
    const c = this.c;
    this.fireClock += dt;
    const trail = this.fireClock > TRAIL_EVERY;
    if (trail) this.fireClock = 0;
    const blasts = this.blastNow;
    blasts.length = 0;
    for (const m of shots) {
      const x = m.x * PX, z = m.y * PX;
      if (!inView(c, x, z)) continue;
      // The server sends lights without line of sight: only shots on a seen tile make air.
      if (hidden(c, x, z)) continue;
      if (m.kind === LIGHT_KIND.Fire && trail) {
        this.ember(x + (c.rng() - 0.5) * 6 * PX, SHOT_LIFT, z + (c.rng() - 0.5) * 6 * PX, (c.rng() - 0.5) * 16 * PX, rnd(c, 6, 20) * PX, (c.rng() - 0.5) * 16 * PX, rnd(c, 0.35, 0.8));
      }
      if (m.kind === LIGHT_KIND.Blast) blasts.push(m);
    }
    if (blasts.length === 0 && !this.hadBlasts) return;
    this.hadBlasts = blasts.length > 0;
    const keys = blasts.map((m) => `${Math.round(m.x / 8)},${Math.round(m.y / 8)}`);
    const fresh = new Set(this.blasts.fresh(keys));
    for (let n = 0; n < blasts.length; n++) {
      const m = blasts[n];
      if (!fresh.has(keys[n])) continue;
      fresh.delete(keys[n]); // two blasts on one key burst once
      if (c.on.stir) c.wind.blast(m.x, m.y);
      for (let k = 0; k < BLAST_EMBERS; k++) {
        const a = c.rng() * Math.PI * 2;
        const v = rnd(c, 20, 50) * PX;
        // The burst is a ring on the floor that also leaps up (first guess).
        this.ember(m.x * PX, BLAST_Y, m.y * PX, Math.cos(a) * v, BLAST_LEAP0 + rnd(c, 0, BLAST_LEAP), Math.sin(a) * v, rnd(c, 0.6, 1.4));
      }
    }
  }

  /** Smoke from lit torches in sight, from the tip of the flame, in uneven gusts with quiet gaps; some gusts gutter into dark soot. */
  private updateTorches(dt: number, torches: PuffInput['torches']): void {
    const c = this.c;
    const stamp = ++this.stamp;
    for (const tr of torches) {
      if (!inView(c, tr.x, tr.z)) continue;
      // Keyed by the flame's position: two torches on one floor tile (a corner) keep their own gusts.
      const key = Math.round(tr.x / PX) * 65536 + Math.round(tr.z / PX);
      let g = this.gusts.get(key);
      if (!g) this.gusts.set(key, (g = { burst: false, left: c.rng() * GAP_S[1], next: 0, soot: 0, stamp }));
      g.stamp = stamp;
      g.left -= dt;
      if (g.left <= 0) {
        g.burst = !g.burst;
        g.left = g.burst ? rnd(c, GUST_S[0], GUST_S[1]) : rnd(c, GAP_S[0], GAP_S[1]);
        g.soot = c.rng() < 0.3 ? 0.65 : 0.12;
        if (g.burst) g.next = 0; // a gust starts with a puff, whatever the stray timer had left
      }
      g.next -= dt;
      if (g.next > 0) continue;
      g.next = g.burst ? rnd(c, PUFF_EVERY[0], PUFF_EVERY[1]) : rnd(c, STRAY_EVERY[0], STRAY_EVERY[1]);
      if (!c.on.smoke || !tr.lit || this.smoke.n >= MAX_SMOKE) continue;
      if (!g.burst && c.rng() >= STRAY) continue; // only a stray wisp now and then between gusts
      // The torch's floor tile must be seen: its smoke is drawn over the darkness (it rises into the dark wall top).
      if (tr.tx < 0 || tr.tz < 0 || tr.tx >= c.map.w || tr.tz >= c.map.h) continue;
      if (hidden(c, tr.tx + 0.5, tr.tz + 0.5)) continue;
      const soot = c.rng() < g.soot;
      const [fx, fy, fz] = flameTip(tr);
      this.puff(
        fx + (c.rng() - 0.5) * 2 * PX, fy + c.rng() * SMOKE_JITTER_Y, fz,
        (c.rng() - 0.5) * 3 * PX, rnd(c, 8, 15) * PX, (c.rng() - 0.5) * 3 * PX,
        rnd(c, 2.4, 4), soot ? rnd(c, WISP_SOOT_S1[0], WISP_SOOT_S1[1]) : rnd(c, WISP_S1[0], WISP_S1[1]), soot ? WISP_SOOT_A : WISP_A, rnd(c, 3, 6) * PX, soot ? SOOT : SMOKE_GREY, WISP_S0, tr.tx, tr.tz, tr.nx, tr.nz,
      );
    }
    for (const [k, g] of this.gusts) if (g.stamp !== stamp) this.gusts.delete(k);
  }

  /** Heavier, darker smoke and tiny rising sparks off the lava tiles in view and seen. */
  private updateLava(dt: number, lava: readonly (readonly [number, number])[]): void {
    const c = this.c;
    const n = lava.length;
    let k: number;
    [k, this.smokeAcc] = spawnCount(this.smokeAcc, dt, n, LAVA_SMOKE_EVERY);
    for (; k > 0 && c.on.smoke && this.smoke.n < MAX_SMOKE; k--) {
      const [lx, lz] = lava[Math.floor(c.rng() * n)];
      this.puff(lx + c.rng(), LAVA_Y, lz + c.rng(), (c.rng() - 0.5) * 3 * PX, rnd(c, 6, 10) * PX, (c.rng() - 0.5) * 3 * PX, rnd(c, 3.5, 5), rnd(c, 1.4, 1.9), 0.28, 4 * PX, LAVA_SMOKE, 0.4);
    }
    [k, this.emberAcc] = spawnCount(this.emberAcc, dt, n, LAVA_EMBER_EVERY);
    for (; k > 0; k--) {
      const [lx, lz] = lava[Math.floor(c.rng() * n)];
      this.ember(lx + c.rng(), LAVA_Y, lz + c.rng(), (c.rng() - 0.5) * 6 * PX, rnd(c, 14, 28) * PX, (c.rng() - 0.5) * 6 * PX, rnd(c, 1, 2.4));
    }
  }

  /** Moves, fades and recycles one pool, and writes it to `out`. */
  private advance(dt: number, pool: Pool, share: number, out: AirParts): void {
    const c = this.c;
    const isSmoke = pool === this.smoke;
    const o = isSmoke ? out.puffs : out.embers;
    o.count = 0;
    for (let i = pool.n - 1; i >= 0; i--) {
      const p = pool.items[i];
      p.life -= dt;
      if (p.life <= 0) {
        pool.remove(i);
        continue;
      }
      const k = 1 - p.life / p.max;
      p.x += (p.vx + Math.sin(c.t * 1.7 + p.max * 9) * p.sway * k) * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (c.windOn) {
        // A wall-face torch's flame sits on the wall's edge, where the air is 0: sample inside its floor tile.
        // Only the wall-ward axis is clamped; the sample follows the puff along the wall.
        const sx = p.tx >= 0 && p.nx !== 0 ? clamp(p.x, p.tx + 0.01, p.tx + 0.99) : p.x;
        const sz = p.tz >= 0 && p.nz !== 0 ? clamp(p.z, p.tz + 0.01, p.tz + 0.99) : p.z;
        const w = airAt(c, sx, sz);
        p.x += w[0] * share * dt;
        p.z += w[1] * share * dt;
      }
      p.vy *= 1 - RISE_DRAG * dt; // smoke slows as it rises and spreads
      // Torch smoke fades out within about 0.25 s once its torch tile leaves the view.
      if (p.tx >= 0) p.vis = clamp(p.vis + (hidden(c, p.tx + 0.5, p.tz + 0.5) ? -4 : 4) * dt, 0, 1);
      const alpha = p.a * Math.min(1, k / (p.tx >= 0 ? 0.05 : 0.15)) * (1 - k) * p.vis;
      if (isSmoke ? !c.on.smoke : !c.on.embers) continue;
      const n = o.count++;
      o.pos[n * 3] = p.x;
      o.pos[n * 3 + 1] = p.y;
      o.pos[n * 3 + 2] = p.z;
      o.size[n] = p.s0 + (p.s1 - p.s0) * k;
      o.rgba[n * 4] = ((p.rgb >> 16) & 255) / 255;
      o.rgba[n * 4 + 1] = ((p.rgb >> 8) & 255) / 255;
      o.rgba[n * 4 + 2] = (p.rgb & 255) / 255;
      o.rgba[n * 4 + 3] = alpha;
      if (isSmoke) {
        const s = out.puffs.sight;
        s[n * 2] = p.tx >= 0 ? p.tx + 0.5 : p.x;
        s[n * 2 + 1] = p.tx >= 0 ? p.tz + 0.5 : p.z;
      }
    }
  }
}
