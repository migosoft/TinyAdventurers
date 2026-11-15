// Spike (#348): what lives at the ?r3d=pond page's water. Lily pads floating at the lake's edge, reed clumps swaying in the wind,
// frogs that leap into the water when the knight comes near and climb out again later, dragonflies that hover and dart, and the fish
// (only their places and headings: the water shader draws them). Everything but the fish is a few solid pixel rects drawn as cards,
// like the woodland's bees and butterflies (critters3d.ts), in colours of the pack's greens and browns.
import type { Cam } from '../camera';
import { pushCard, pushFlat, pushShadow, type CardBuf, type ShadowBuf } from '../cards';
import { PX_FRAME } from '../critters3d';
import type { Footprint } from '../lights';
import { hiddenAt, type SightMask } from '../sightmask';
import { sway } from '../wind';
import type { FrameRects } from '../worldMesh';
import { FISH, type PondWater } from './pondWater';
import { POND_H, POND_W, depthAt, inside, inward, lakeInside, streamAt } from './pondShape';

type Rgb = [number, number, number];
const rgb = (c: number): Rgb => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const C = {
  pad: [rgb(0x3f7a3a), rgb(0x4c8c40), rgb(0x356b36)], padLight: rgb(0x6aa84f), petal: [rgb(0xf4e9f0), rgb(0xf0b8d0)], heart: rgb(0xf2d13c),
  reed: [rgb(0x4f7d32), rgb(0x6b9440), rgb(0x3d6a2c)], reedDry: rgb(0x9a8a4a), head: rgb(0x5a3a22),
  frog: rgb(0x4c9a2f), frogDark: rgb(0x2f6a24), eye: rgb(0xe6d84a),
  fly: [rgb(0x3aa0d8), rgb(0x2fb89a), rgb(0xd04a3a)], flyHead: rgb(0x1c2a30), wing: rgb(0xe4f1f5),
};
const OVER = 0.004;
const TILE = 16;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pad { x: number; z: number; size: number; colour: Rgb; flower: Rgb | null; phase: number }
interface Stalk { dx: number; dz: number; h: number; colour: Rgb; head: boolean; lean: number }
interface Clump { x: number; z: number; stalks: Stalk[] }
type FrogState = 'sit' | 'leap' | 'under' | 'peek' | 'back';
interface Frog { hx: number; hz: number; wx: number; wz: number; lift: number; state: FrogState; t: number; wait: number; face: number; blink: number }
interface Fly { hx: number; hz: number; x: number; z: number; y: number; fx: number; fz: number; fy: number; tx: number; tz: number; ty: number; t: number; dur: number; hover: number; colour: Rgb; face: number }
interface Fish { x: number; z: number; a: number; speed: number; turn: number; rise: number; burst: number }

/** How near the knight a sitting frog leaps (tiles), and how far the knight must be before it climbs out again. */
export const FROG = { scare: 2.6, calm: 5, leap: 0.42, reach: 1.5, arc: 0.55 } as const;

export class PondLife {
  readonly pads: Pad[] = [];
  readonly clumps: Clump[] = [];
  readonly frogs: Frog[] = [];
  readonly flies: Fly[] = [];
  readonly fish: Fish[] = [];
  private readonly r: () => number;

  constructor(seed: number) {
    const r = this.r = rng(seed);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
    const somewhere = (ok: (x: number, z: number) => boolean): [number, number] | null => {
      for (let i = 0; i < 400; i++) {
        const x = 1 + r() * (POND_W - 2), z = 3 + r() * (POND_H - 5);
        if (ok(x, z)) return [x, z];
      }
      return null;
    };
    const padOk = (x: number, z: number): boolean => { const l = lakeInside(x, z); return l > 0.3 && l < 1.7 && streamAt(x, z).inside < -0.6; };
    // Lily pads in clusters along the lake's edge.
    for (let c = 0; c < 11; c++) {
      const at = somewhere(padOk);
      if (!at) continue;
      const n = 3 + Math.floor(r() * 6);
      for (let i = 0; i < n * 4 && this.pads.filter((p) => Math.hypot(p.x - at[0], p.z - at[1]) < 1.6).length < n; i++) {
        const x = at[0] + (r() - 0.5) * 2.4, z = at[1] + (r() - 0.5) * 2.4;
        if (!padOk(x, z) || this.pads.some((p) => Math.hypot(p.x - x, p.z - z) < 0.36)) continue;
        this.pads.push({ x, z, size: 3 + Math.floor(r() * 3), colour: pick(C.pad), flower: r() < 0.22 ? pick(C.petal) : null, phase: r() * 6.28 });
      }
    }
    // Reed clumps on the waterline; fewer on the shore that faces the camera, so the water stays in view from the road.
    for (let c = 0; c < 46; c++) {
      const at = somewhere((x, z) => { const s = inside(x, z); return s > -0.3 && s < 0.45; });
      if (!at) continue;
      const [, iz] = inward(at[0], at[1]);
      if (iz < -0.4 && r() < 0.7) continue;
      if (this.clumps.some((k) => Math.hypot(k.x - at[0], k.z - at[1]) < 0.9)) continue;
      const stalks: Stalk[] = [];
      const n = 4 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const dry = r() < 0.15;
        stalks.push({ dx: (r() - 0.5) * 0.7, dz: (r() - 0.5) * 0.5, h: 9 + Math.floor(r() * 9), colour: dry ? C.reedDry : pick(C.reed), head: r() < 0.4, lean: r() - 0.5 });
      }
      this.clumps.push({ x: at[0], z: at[1], stalks });
    }
    // Frogs: most on the bank just outside the water, a few on lily pads.
    const frogAt = (hx: number, hz: number, lift: number): void => {
      const [ix, iz] = inward(hx, hz);
      let wx = hx + ix * FROG.reach, wz = hz + iz * FROG.reach;
      for (let i = 0; i < 6 && depthAt(wx, wz) < 0.25; i++) { wx += ix * 0.3; wz += iz * 0.3; }
      this.frogs.push({ hx, hz, wx, wz, lift, state: 'sit', t: 0, wait: 0, face: ix >= 0 ? 1 : -1, blink: r() * 5 });
    };
    for (let i = 0; i < 9; i++) {
      const at = somewhere((x, z) => { const l = lakeInside(x, z); return l > -0.45 && l < -0.12 && !this.frogs.some((f) => Math.hypot(f.hx - x, f.hz - z) < 1.5); });
      if (at) frogAt(at[0], at[1], 0);
    }
    for (const p of this.pads.filter((q) => q.size >= 4).slice(0, 40).filter((_, i) => i % 9 === 2).slice(0, 4)) frogAt(p.x + 0.12, p.z + 0.1, 0.02);
    // Dragonflies over the water and its banks.
    for (let i = 0; i < 7; i++) {
      const at = somewhere((x, z) => inside(x, z) > -0.3 && inside(x, z) < 2.5);
      if (!at) continue;
      const y = 0.45 + r() * 0.5;
      this.flies.push({ hx: at[0], hz: at[1], x: at[0], z: at[1], y, fx: at[0], fz: at[1], fy: y, tx: at[0], tz: at[1], ty: y, t: 0, dur: 0.3, hover: r() * 1.5, colour: C.fly[i % C.fly.length], face: 1 });
    }
    // Fish in the lake's deeper water.
    for (let i = 0; i < FISH; i++) {
      const at = somewhere((x, z) => depthAt(x, z) > 0.7) ?? [20, 13];
      this.fish.push({ x: at[0], z: at[1], a: r() * 6.28, speed: 0.35 + r() * 0.4, turn: 0, rise: 4 + r() * 20, burst: 0 });
    }
  }

  /** One step of everything that moves. `knight.wading`: it stands in water (the fish flee it). */
  step(dt: number, knight: { x: number; z: number; wading: boolean }, water: PondWater | null): void {
    const r = this.r;
    for (const f of this.frogs) {
      const near = Math.hypot(knight.x - f.hx, knight.z - f.hz);
      f.t += dt;
      f.blink -= dt;
      if (f.blink < -0.15) f.blink = 2 + r() * 5;
      if (f.state === 'sit' && near < FROG.scare) { f.state = 'leap'; f.t = 0; f.face = f.wx >= f.hx ? 1 : -1; }
      else if (f.state === 'leap' && f.t >= FROG.leap) { f.state = 'under'; f.t = 0; f.wait = 4 + r() * 5; water?.ripple(f.wx, f.wz, 1); }
      else if (f.state === 'under' && f.t >= f.wait && near > FROG.calm) { f.state = 'peek'; f.t = 0; f.wait = 0.9 + r() * 1.2; f.face = f.hx >= f.wx ? 1 : -1; water?.ripple(f.wx, f.wz, 0.5); }
      else if (f.state === 'peek' && near < FROG.scare) { f.state = 'under'; f.t = 0; f.wait = 4 + r() * 5; water?.ripple(f.wx, f.wz, 0.6); }
      else if (f.state === 'peek' && f.t >= f.wait) { f.state = 'back'; f.t = 0; water?.ripple(f.wx, f.wz, 0.5); }
      else if (f.state === 'back' && f.t >= FROG.leap) { f.state = 'sit'; f.t = 0; }
    }
    for (const d of this.flies) {
      d.t += dt;
      if (d.t < d.dur) {
        const k = d.t / d.dur, e = k * k * (3 - 2 * k);
        d.x = d.fx + (d.tx - d.fx) * e; d.z = d.fz + (d.tz - d.fz) * e; d.y = d.fy + (d.ty - d.fy) * e;
      } else if (d.t >= d.dur + d.hover) {
        // A new point near its home, over water or bank.
        for (let i = 0; i < 8; i++) {
          const nx = d.hx + (r() - 0.5) * 9, nz = d.hz + (r() - 0.5) * 6;
          if (inside(nx, nz) < -0.6 || nx < 1 || nz < 3 || nx > POND_W - 1 || nz > POND_H - 3) continue;
          d.fx = d.x; d.fz = d.z; d.fy = d.y; d.tx = nx; d.tz = nz; d.ty = 0.35 + r() * 0.6;
          d.dur = 0.18 + Math.hypot(nx - d.x, nz - d.z) * 0.07; d.hover = 0.4 + r() * 1.8; d.t = 0;
          if (Math.abs(nx - d.x) > 0.2) d.face = nx > d.x ? 1 : -1;
          break;
        }
      } else { d.x = d.tx; d.z = d.tz; d.y = d.ty; }
    }
    this.fish.forEach((f, i) => {
      // Wander; turn toward deeper water near the shallows; dash away from a wading knight.
      f.turn += (r() - 0.5) * 3 * dt;
      f.turn = Math.max(-1.2, Math.min(1.2, f.turn * (1 - 0.6 * dt)));
      let want = f.turn;
      const ahead = depthAt(f.x + Math.cos(f.a) * 0.9, f.z + Math.sin(f.a) * 0.9);
      if (ahead < 0.75) {
        const [ix, iz] = inward(f.x, f.z);
        const cross = Math.cos(f.a) * iz - Math.sin(f.a) * ix;
        want = (cross >= 0 ? 1 : -1) * 3.2;
      }
      const kd = Math.hypot(knight.x - f.x, knight.z - f.z);
      if (knight.wading && kd < 2.2 && f.burst <= 0) { f.a = Math.atan2(f.z - knight.z, f.x - knight.x) + (r() - 0.5) * 0.6; f.burst = 0.8; }
      f.burst = Math.max(0, f.burst - dt);
      f.a += want * dt;
      const v = f.speed * (1 + f.burst * 5);
      f.x += Math.cos(f.a) * v * dt;
      f.z += Math.sin(f.a) * v * dt;
      f.rise -= dt;
      if (f.rise <= 0) { f.rise = 9 + r() * 22; water?.ripple(f.x, f.z, 0.35); }
      water?.fish(i, f.x, f.z, f.a);
    });
  }

  /** Pushes the pads into `decals` (flat), the reeds, frogs and dragonflies into `cards`, small shadows into `shadows`. */
  push(out: { cards: CardBuf; decals: CardBuf; shadows: ShadowBuf }, frames: FrameRects, cam: Cam, t: number, o: { day: number; wind: boolean; mask: SightMask | null; view: Footprint; /** The ground cover's top (tiles) at a point: a bank frog sits on the grass, not in it. */ ground?: (x: number, z: number, r: number) => number }): void {
    const M = 2;
    const inView = (x: number, z: number): boolean => x >= o.view.x0 - M && x <= o.view.x1 + M && z >= o.view.z0 - M && z <= o.view.z1 + M;
    const seen = (x: number, z: number): boolean => !o.mask || !hiddenAt(o.mask, x, z);
    const up = (x: number, z: number, lift: number, ox: number, oy: number, w: number, h: number, tint: Rgb, bias = 0, scenery = false): void => {
      pushCard(out.cards, { frame: PX_FRAME, crop: { x: 0, y: 0, w, h }, x, z, lift, flip: false, originX: 0, footY: 0, scale: 1, offset: [ox, oy], tint, mode: 1, alpha: 1, bias, scenery }, frames, cam);
    };
    const flat = (x: number, z: number, ox: number, oy: number, w: number, h: number, tint: Rgb, base = 0): void => {
      pushFlat(out.decals, { frame: PX_FRAME, crop: { x: 0, y: 0, w, h }, x, z, lift: 0, flip: false, originX: 0, footY: 0, scale: 1, offset: [ox, oy], tint, mode: 1, alpha: 1, base, scenery: true }, frames, cam);
    };

    for (const p of this.pads) {
      if (!inView(p.x, p.z)) continue;
      // A pad drifts a hair on the waves; two crossed rects make its round shape, a lighter px its sheen.
      const x = p.x + Math.sin(t * 0.5 + p.phase) * 0.03, z = p.z + Math.cos(t * 0.4 + p.phase) * 0.02;
      const s = p.size, a = -Math.floor(s / 2);
      flat(x, z, a, a + 1, s, s - 2, p.colour);
      flat(x, z, a + 1, a, s - 2, s, p.colour);
      flat(x, z, a + 1, a + 1, 1, 1, C.padLight, 0.001);
      if (p.flower) {
        flat(x, z, a + s - 3, a + 1, 2, 2, p.flower, 0.002);
        flat(x, z, a + s - 2, a + 1, 1, 1, C.heart, 0.003);
      }
    }

    for (const c of this.clumps) {
      if (!inView(c.x, c.z)) continue;
      for (const s of c.stalks) {
        const x = c.x + s.dx, z = c.z + s.dz;
        // Three pieces, each shifted by the wind's sway at its height (whole px), so the stalk bends.
        const bend = (y: number): number => Math.round((o.wind ? sway(x, z, y, s.h, 0.2, t) * TILE : 0) + s.lean * (y / s.h) * 2);
        const cuts = [0, Math.round(s.h * 0.4), Math.round(s.h * 0.72), s.h];
        for (let i = 0; i < 3; i++) up(x, z, 0, bend(cuts[i + 1]), -cuts[i + 1], 1, cuts[i + 1] - cuts[i], s.colour, 0, true);
        if (s.head) up(x, z, 0, bend(s.h) - (s.lean > 0 ? 0 : 1), -s.h + 1, 2, 4, C.head, OVER, true);
      }
    }

    for (const f of this.frogs) {
      if (f.state === 'under') continue;
      const leaping = f.state === 'leap' || f.state === 'back';
      const k = leaping ? Math.min(1, f.t / FROG.leap) : 0;
      const [ax, az, bx, bz] = f.state === 'back' ? [f.wx, f.wz, f.hx, f.hz] : [f.hx, f.hz, f.wx, f.wz];
      const x = f.state === 'peek' ? f.wx : ax + (bx - ax) * k, z = f.state === 'peek' ? f.wz : az + (bz - az) * k;
      if (!inView(x, z) || !seen(x, z)) continue;
      const d = f.face;
      if (f.state === 'peek') { // only the head shows above the water
        up(x, z, 0, -1, -1, 3, 1, C.frog);
        up(x, z, 0, d > 0 ? 1 : -1, -2, 1, 1, C.eye, OVER);
        continue;
      }
      const home = f.lift + (o.ground ? o.ground(f.hx, f.hz, 0) : 0);
      const lift = (f.state === 'back' ? home * k : home * (1 - k)) + Math.sin(Math.PI * k) * FROG.arc;
      pushShadow(out.shadows, cam, x, z, 0.16, 0.08, 0.3 * (1 - 0.6 * Math.sin(Math.PI * k)));
      up(x, z, lift, -2, -2, 4, 2, C.frog);
      up(x, z, lift, d > 0 ? 0 : -2, -3, 2, 1, C.frog);
      if (f.blink > 0) up(x, z, lift, d > 0 ? 1 : -2, -3, 1, 1, C.eye, OVER);
      up(x, z, lift, d > 0 ? -2 : 1, -1, 1, 1, C.frogDark, OVER);
      if (leaping) up(x, z, lift, d > 0 ? -4 : 2, -1, 2, 1, C.frogDark); // the legs trail in the leap
    }

    if (o.day >= 0.5) {
      for (const d of this.flies) {
        if (!inView(d.x, d.z) || !seen(d.x, d.z)) continue;
        const hov = d.t >= d.dur ? Math.sin(t * 7 + d.hx) * 0.02 : 0;
        const lift = d.y + hov;
        const beat = Math.floor(t * 24) % 2 === 0;
        pushShadow(out.shadows, cam, d.x, d.z, 0.14, 0.05, 0.18);
        up(d.x, d.z, lift, -2, -1, 4, 1, d.colour);
        up(d.x, d.z, lift, d.face > 0 ? 2 : -3, -1, 1, 1, C.flyHead);
        // Two pairs of long wings across the body, one of each pair on either side; they shorten on every other beat.
        const len = beat ? 3 : 2;
        for (const wx of d.face > 0 ? [0, -2] : [-1, 1]) {
          up(d.x, d.z, lift, wx, -1 - len, 1, len, C.wing, OVER);
          up(d.x, d.z, lift, wx, 0, 1, len, C.wing, OVER);
        }
      }
    }
  }
}
