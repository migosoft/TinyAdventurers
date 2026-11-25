// The life at a woodland pond (#360), after the pond spike (#348): lily pads floating on the calm water, reed clumps at the shore
// bending in the wind, frogs on the bank and on pads that leap into the water when any figure walks by, and dragonflies by day. Only
// for the look: the server does not know it, nothing blocks or slows, and every client has its own. Everything is a few solid pixel
// rects drawn as cards, like the woodland's bees and butterflies (critters3d.ts). Pure TypeScript apart from the card helpers, and the
// same life for the same seed and the same sequence of steps. (The fish are the water's: fish.ts.)
import { PLANT_KIND } from '../../generated/defs';
import type { PlantInfo } from '../../generated/PlantInfo';
import type { Cam } from '../camera';
import { pushCard, pushFlat, pushShadow, LIE_Y, type CardBuf, type ShadowBuf } from '../cards';
import { PX_FRAME } from '../critters3d';
import { WATER_LEVEL } from '../dips/shape';
import type { Footprint } from '../lights';
import { hiddenAt, type SightMask } from '../sightmask';
import { WIND_DIR, sway } from '../wind';
import type { FrameRects } from '../worldMesh';
import type { PondField } from './pondField';

type Rgb = [number, number, number];
const rgb = (c: number): Rgb => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
/** The colours, by the letters of the pixel grids below. */
const C = {
  // pads: three greens (one per pad), the sheen and the shaded rim of every pad
  pad: [rgb(0x4f9440), rgb(0x5fa548), rgb(0x448838)], padLight: rgb(0x8cc45a), padDark: rgb(0x2f6a34),
  // a flower's petals (white or pink, one per flower), their shaded side and the heart
  petal: [rgb(0xf4e9f0), rgb(0xf0b8d0)], petalShade: [rgb(0xcfc3dc), rgb(0xd088b0)], heart: rgb(0xf2d13c),
  // reeds: three greens and a dry stalk, the cattail's head
  reed: [rgb(0x5a8c38), rgb(0x7aa648), rgb(0x46762f)], reedDry: rgb(0x9a8a4a), head: rgb(0x5a3a22), headLight: rgb(0x7a5230),
  // the frog: lighter than the wet earth and than a pad, so it stands off both by its lightness and not only by its hue
  frog: rgb(0xa8cf4a), frogDark: rgb(0x3f6a26), belly: rgb(0xeef0b4), eye: rgb(0xf7e04a),
  // dragonflies: one body colour each, the head, the wings
  fly: [rgb(0x3aa0d8), rgb(0x2fb89a), rgb(0xd04a3a)], flyHead: rgb(0x1c2a30), wing: rgb(0xe4f1f5),
};
const TILE = 16;

/** A pixel grid as rows of runs: a letter is a colour of the palette handed to the drawing, a dot nothing. */
interface Run { x: number; y: number; w: number; c: string }
interface Sprite { w: number; h: number; runs: Run[] }
function sprite(rows: string[]): Sprite {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      let e = x + 1;
      while (e < row.length && row[e] === row[x]) e++;
      if (row[x] !== '.') runs.push({ x, y, w: e - x, c: row[x] });
      x = e;
    }
  });
  return { w: rows[0].length, h: rows.length, runs };
}

// The frog, facing right: the back slopes from the head down to the folded hind leg. G skin, D dark (a spot on the back, the trailing
// feet), L the pale belly and throat, E the eye (G while it blinks).
const FROG_SIT = sprite([
  '....E.',
  '..GGGG',
  '.GDGLL',
  'GG.GL.',
]);
/** In the air: stretched out, the legs trailing. */
const FROG_LEAP = sprite([
  '....GE.',
  '..GGGLG',
  'DGGLL..',
  'D......',
]);
/** In the water, facing the viewer: the two eyes and the top of the head. */
const FROG_PEEK = sprite([
  'E.E',
  'GGG',
]);
// Lily pads by size (px across), seen from above: P the pad, S its sheen, K the shaded rim, a dot the notch and the corners.
const PADS: Record<number, Sprite> = {
  5: sprite(['.PPP.', 'PSPPP', 'PPP..', 'PPPPK', '.KKK.']),
  6: sprite(['.PPPP.', 'PSPPPP', 'PSPP..', 'PPPPPP', 'PPPPPK', '.KKKK.']),
  7: sprite(['..PPP..', '.PSPPP.', 'PSPPPPP', 'PPPP...', 'PPPPPPP', '.PPPPK.', '..KKK..']),
  8: sprite(['..PPPP..', '.PSSPPP.', 'PSPPPPPP', 'PSPPPPPP', 'PPPPP...', 'PPPPPPPP', '.PPPPPK.', '..KKKK..']),
};
const PAD_SIZES = [5, 8];
/** A flower standing on its pad, small and (on the pads of 7 px and more) large: F petal, H shaded petal, Y the heart. */
const FLOWER = sprite(['.F.', 'FYF', 'HHH']), FLOWER_BIG = sprite(['.F.F.', 'FFYFF', '.HHH.']);

/**
 * The frogs. `scare`: a sitting frog notices a figure this near (tiles). `nerve`: it then waits up to this long (s, its own roll each
 * time) before it leaps, so a party walking by sets them off one after the other; nearer than `panic` it leaps at once.
 * `leap`: the time in the air (s), `arc` its height (tiles), `reach` how far a bank frog jumps into the water (tiles).
 * `under`: it stays under for a time in this range (s). `peek`: it then shows its eyes for a time in this range (s), unless a figure
 * stands within `shy` tiles of that spot. `calm`: it climbs back only when no figure is within this distance of its seat (tiles).
 * The rings it makes (ripple strengths): `splash` where it lands, `stir` when its head comes up, dives or it leaves the water.
 */
export const FROG = { scare: 2.2, nerve: 0.5, panic: 0.9, leap: 0.42, arc: 0.5, reach: 1.3, under: [3, 7], peek: [1.2, 2.6], shy: 1.2, calm: 4, splash: 1, stir: 0.45 } as const;

/**
 * The zones and the counts. A pond rolls how many of each kind it has in `pads`, `clumps`, `frogs` and `flies` (least, most), each
 * kind on its own, so ponds differ. `padShore`: pads lie this far from the drawn shore (tiles into the water). `reedShore` and
 * `reedBank`: reeds stand at most this far into the water and this far onto the bank. `frogBank`: a bank frog sits at most this far
 * outside the drawn shore and this far inside it: the bare wet earth, where the bed is still above the water;
 * `frogBush` and `frogTree`: and at least this far from a bush's and a tree's foot (their leaves and shade would hide it).
 * `calm`: the current's strength (`flowAt`) above which nothing lives (a brook, the water before a mouth). `mouth`: nothing within
 * this many tiles of a mouth.
 */
export const LIFE = {
  pads: [0, 14], clumps: [2, 9], frogs: [2, 7], flies: [0, 4],
  padShore: [0.6, 2.5], reedShore: 0.6, reedBank: 0.3, frogBank: [0.1, 0.08], frogBush: 1.2, frogTree: 1.5, calm: 0.2, mouth: 1,
} as const;

/**
 * A clump holds this many stalks (least, most); a stalk is this tall (px); the share of stalks with a brown head (only the taller
 * carry one) and of dry ones.
 */
const STALKS = [3, 7], STALK_H = [11, 22], HEADS = 0.4, DRY = 0.15;
/** The share of stalks with a leaf beside them: it makes a clump a bushel and not a row of lines. */
const BLADES = 0.9;
/** How far the top of a reed swings in the wind (tiles; the grass has 0.05, a reed is taller and softer). */
const REED_SWAY = 0.2;
/** The share of pads that flower (pads of 5 px and more). */
const FLOWERS = 0.4;
/** A pad drifts this far (tiles) around its place, slowly. */
const DRIFT = 0.03;
/** A dragonfly flies this high over the water (tiles; least, most). */
const FLY_Y = [0.3, 0.8];
/** The soft shadows' strength: under a frog, a reed clump, a dragonfly. */
const SHADE = { frog: 0.32, reeds: 0.22, fly: 0.2 };
/** Things this far outside the view box (tiles) are skipped. */
const MARGIN = 2;
/** A flat pad lies this far over the water's surface (tiles), and what sits on it a hair higher. */
const PAD_OVER = 0.012;

/** The palettes of the grids: a pad's by its colour, a flower's by its petal colour, the frog's (and with the eye shut). */
const PAD_PALS: Record<string, Rgb>[] = C.pad.map((P) => ({ P, S: C.padLight, K: C.padDark }));
const FLOWER_PALS: Record<string, Rgb>[] = C.petal.map((F, i) => ({ F, H: C.petalShade[i], Y: C.heart }));
const SKIN: Record<string, Rgb> = { G: C.frog, D: C.frogDark, L: C.belly, E: C.eye };
const SKIN_BLINK: Record<string, Rgb> = { ...SKIN, E: C.frog };
/** Where a pad lies at time `t` (tiles): it drifts a hair around its place. */
const padX = (p: { x: number; phase: number }, t: number): number => p.x + Math.sin(t * 0.5 + p.phase) * DRIFT;
const padZ = (p: { z: number; phase: number }, t: number): number => p.z + Math.cos(t * 0.4 + p.phase) * DRIFT * 0.7;

/** A small seeded generator (mulberry32), 0..1. */
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

/** `flip`: the notch points left. `flower`: the petal colour's index, -1 none. */
export interface Pad { x: number; z: number; size: number; flip: boolean; colour: number; flower: number; phase: number }
/** `blade`: the height (px) of the leaf beside the stalk, 0 none, on the side of its `lean`. */
export interface Stalk { dx: number; dz: number; h: number; colour: Rgb; head: boolean; lean: number; blade: number }
export interface Clump { x: number; z: number; stalks: Stalk[] }
export type FrogState = 'sit' | 'leap' | 'under' | 'peek' | 'back';
/** `hx`, `hz`: its seat (a pad frog's is its pad's place); `wx`, `wz`: where it lands; `alarm`: how long a figure has been near. */
export interface Frog { hx: number; hz: number; wx: number; wz: number; pad: Pad | null; state: FrogState; t: number; wait: number; alarm: number; nerve: number; face: number; blink: number }
export interface Fly { hx: number; hz: number; x: number; z: number; y: number; fx: number; fz: number; fy: number; tx: number; tz: number; ty: number; t: number; dur: number; hover: number; colour: Rgb; face: number }

/** A plant's foot (tiles); `bush`: a bush, else a tree. */
export interface PlantFoot { x: number; z: number; bush: boolean }
/** The feet of a woodland's plants as the server sends them (`PlantInfo`: kind, x and y in px, ...). */
export const plantFeet = (plants: readonly PlantInfo[]): PlantFoot[] => plants.map((p) => ({ x: p[1] / TILE, z: p[2] / TILE, bush: p[0] === PLANT_KIND.Bush }));
export interface LifeOut { cards: CardBuf; shadows: ShadowBuf }
export interface LifeLook {
  /** The sky's day share: the dragonflies fly from 0.5 on. */
  day: number;
  wind: boolean;
  /** The viewer's sight (null: all seen): frogs and dragonflies show only where it sees; pads and reeds are scenery. */
  mask: SightMask | null;
  view: Footprint;
  /** The soft shadows' strength by the hour (`ovalOf`), 1 without a sun. */
  oval?: number;
  /** The ground cover's top (tiles) at a point: a bank frog sits on it. */
  ground?: (x: number, z: number, r: number) => number;
}

export class PondLife {
  readonly pads: Pad[] = [];
  readonly clumps: Clump[] = [];
  readonly frogs: Frog[] = [];
  readonly flies: Fly[] = [];
  private readonly r: () => number;
  /** The rings of the last step: (x, z, strength) triples. */
  private readonly rings: number[] = [];

  /** `plants`: the feet of the level's trees and bushes (tiles): no bank frog sits under one, where it would not be seen. */
  constructor(private readonly field: PondField, seed: number, plants: readonly PlantFoot[] = []) {
    const r = this.r = rng(seed ^ 0x51f3a7);
    const b = field.box;
    const roll = (range: readonly number[]): number => range[0] + Math.floor(r() * (range[1] - range[0] + 1));
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
    const somewhere = (ok: (x: number, z: number) => boolean): [number, number] | null => {
      for (let i = 0; i < 300; i++) {
        const x = b.x0 + r() * (b.x1 - b.x0), z = b.z0 + r() * (b.z1 - b.z0);
        if (ok(x, z)) return [x, z];
      }
      return null;
    };
    const padOk = (x: number, z: number): boolean => {
      // the pad's rim keeps to the zone too
      const s = field.shoreAt(x, z);
      return s >= LIFE.padShore[0] + 0.25 && s <= LIFE.padShore[1] - 0.25 && this.free(x, z, 0.3);
    };
    // The four counts first, each its own roll: what a pond has does not depend on what fitted before.
    const nPads = roll(LIFE.pads), nClumps = roll(LIFE.clumps), nFrogs = roll(LIFE.frogs), nFlies = roll(LIFE.flies);

    // Lily pads in a few loose groups.
    const groups: [number, number][] = [];
    for (let g = 0; g < 1 + Math.floor(nPads / 5); g++) {
      const at = somewhere((x, z) => padOk(x, z) && !groups.some((q) => Math.hypot(q[0] - x, q[1] - z) < 2));
      if (at) groups.push(at);
    }
    for (let i = 0; groups.length > 0 && i < nPads * 30 && this.pads.length < nPads; i++) {
      const g = pick(groups);
      const x = g[0] + (r() - 0.5) * 2.6, z = g[1] + (r() - 0.5) * 2;
      const size = roll(PAD_SIZES);
      const flower = size >= 6 && r() < FLOWERS ? Math.floor(r() * C.petal.length) : -1;
      const p: Pad = { x, z, size, flip: r() < 0.5, colour: Math.floor(r() * C.pad.length), flower, phase: r() * 6.28 };
      if (padOk(x, z) && !this.pads.some((q) => Math.hypot(q.x - x, q.z - z) < (q.size + size) / 2 / TILE + 0.08)) this.pads.push(p);
    }

    // Reed clumps on the waterline.
    const reedOk = (x: number, z: number): boolean => field.shoreAt(x, z) <= LIFE.reedShore && field.bankAt(x, z) <= LIFE.reedBank && this.free(x, z, 0);
    for (let c = 0; c < nClumps; c++) {
      const at = somewhere((x, z) => field.shoreAt(x, z) <= LIFE.reedShore - 0.2 && field.bankAt(x, z) <= 0.1 && this.free(x, z, 0.3) && !this.clumps.some((k) => Math.hypot(k.x - x, k.z - z) < 1.2));
      if (!at) continue;
      const stalks: Stalk[] = [];
      const n = roll(STALKS);
      for (let i = 0; i < n * 4 && stalks.length < n; i++) {
        const dx = (r() - 0.5) * 0.7, dz = (r() - 0.5) * 0.4;
        // The first stalk is a tall one with a head: every clump reads as reeds.
        const first = stalks.length === 0, h = first ? STALK_H[1] - Math.floor(r() * 4) : roll(STALK_H);
        const s: Stalk = { dx, dz, h, colour: r() < DRY ? C.reedDry : pick(C.reed), head: first || (h >= 13 && r() < HEADS), lean: r() - 0.5, blade: r() < BLADES ? Math.round(h * (0.45 + r() * 0.3)) : 0 };
        if (reedOk(at[0] + dx, at[1] + dz) && !stalks.some((q) => Math.abs(q.dx - dx) < 1.5 / TILE)) stalks.push(s);
      }
      if (stalks.length >= STALKS[0]) this.clumps.push({ x: at[0], z: at[1], stalks });
    }

    // Frogs: some on the larger pads, the others on the bank's bare earth, clear of the reeds, where they are seen.
    const apart = (x: number, z: number, d: number): boolean => !this.frogs.some((f) => Math.hypot(f.hx - x, f.hz - z) < d);
    const frog = (hx: number, hz: number, w: [number, number], pad: Pad | null): void => {
      this.frogs.push({ hx, hz, wx: w[0], wz: w[1], pad, state: 'sit', t: 0, wait: 0, alarm: 0, nerve: r() * FROG.nerve, face: w[0] >= hx ? 1 : -1, blink: r() * 5 });
    };
    for (const p of this.pads) {
      if (this.frogs.length >= Math.ceil(nFrogs / 2) || p.size < 7 || p.flower >= 0 || r() > 0.5 || !apart(p.x, p.z, 1)) continue;
      const w = this.landing(p.x, p.z, r() * 6.28, 0.9);
      if (w) frog(p.x, p.z, w, p);
    }
    for (let i = this.frogs.length; i < nFrogs; i++) {
      const at = somewhere((x, z) => {
        return field.bankAt(x, z) <= LIFE.frogBank[0] && field.shoreAt(x, z) <= LIFE.frogBank[1] && field.bodyAt(x, z) > 0.2 && this.free(x, z, 0.3) && apart(x, z, 1.2)
          && !this.clumps.some((c) => Math.hypot(c.x - x, c.z - z) < 1) && !plants.some((p) => Math.hypot(p.x - x, p.z - z) < (p.bush ? LIFE.frogBush : LIFE.frogTree));
      });
      if (!at) continue;
      // Into the water: up the slope of the shore distance.
      const e = 0.3, wet = (x: number, z: number): number => field.shoreAt(x, z) - field.bankAt(x, z);
      const w = this.landing(at[0], at[1], Math.atan2(wet(at[0], at[1] + e) - wet(at[0], at[1] - e), wet(at[0] + e, at[1]) - wet(at[0] - e, at[1])), FROG.reach);
      if (w) frog(at[0], at[1], w, null);
    }

    // Dragonflies over the water and the reeds.
    for (let i = 0; i < nFlies; i++) {
      const at = somewhere((x, z) => this.flyOk(x, z));
      if (!at) continue;
      const y = FLY_Y[0] + r() * (FLY_Y[1] - FLY_Y[0]);
      this.flies.push({ hx: at[0], hz: at[1], x: at[0], z: at[1], y, fx: at[0], fz: at[1], fy: y, tx: at[0], tz: at[1], ty: y, t: 0, dur: 0.3, hover: r() * 1.5, colour: C.fly[i % C.fly.length], face: r() < 0.5 ? 1 : -1 });
    }
  }

  /** Nothing lives here: on a bridge's deck (within `rad` tiles of one), near a mouth, or where the water runs. */
  private free(x: number, z: number, rad: number): boolean {
    const f = this.field;
    if (f.deckAt(x, z) !== null) return false;
    if (rad > 0 && (f.deckAt(x - rad, z) !== null || f.deckAt(x + rad, z) !== null || f.deckAt(x, z - rad) !== null || f.deckAt(x, z + rad) !== null)) return false;
    for (const m of f.mouths) if (Math.hypot(m.x - x, m.z - z) < LIFE.mouth + rad) return false;
    return f.flowAt(x, z).s <= LIFE.calm;
  }

  /** Where a dragonfly may hover: over the drawn water or the first steps of its bank, not over a deck. */
  private flyOk(x: number, z: number): boolean {
    return this.field.bankAt(x, z) <= 0.4 && this.field.shoreAt(x, z) <= 3 && this.free(x, z, 0);
  }

  /** A frog's landing: `reach` tiles from (x, z) along angle `a`, or the nearest other direction that ends in open, calm water. */
  private landing(x: number, z: number, a: number, reach: number): [number, number] | null {
    for (let i = 0; i < 8; i++) {
      const b = a + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 0.5;
      const wx = x + Math.cos(b) * reach, wz = z + Math.sin(b) * reach;
      if (this.field.shoreAt(wx, wz) >= 0.45 && this.free(wx, wz, 0.2)) return [wx, wz];
    }
    return null;
  }

  /**
   * One step of everything that moves. `near`: every drawn figure (heroes, enemies, animals; tiles): any of them scares a frog.
   * Returns the rings the frogs made in this step as (x, z, strength) triples for the water (the same array every call); with
   * `mask` (the viewer's sight) none where the viewer does not see.
   */
  step(dt: number, near: readonly { x: number; z: number }[], mask: SightMask | null = null): number[] {
    const r = this.r;
    this.rings.length = 0;
    const rings = { push: (x: number, z: number, s: number): void => { if (!mask || !hiddenAt(mask, x, z)) this.rings.push(x, z, s); } };
    const nearest = (x: number, z: number): number => {
      let d = Infinity;
      for (let i = 0; i < near.length; i++) d = Math.min(d, Math.hypot(near[i].x - x, near[i].z - z));
      return d;
    };
    const span = (q: readonly number[]): number => q[0] + r() * (q[1] - q[0]);
    for (const f of this.frogs) {
      f.t += dt;
      f.blink -= dt;
      if (f.blink < -0.15) f.blink = 2 + r() * 5;
      if (f.state === 'sit') {
        const d = nearest(f.hx, f.hz);
        f.alarm = d < FROG.scare ? f.alarm + dt : 0;
        if (d < FROG.panic || (d < FROG.scare && f.alarm >= f.nerve)) { f.state = 'leap'; f.t = 0; f.face = f.wx >= f.hx ? 1 : -1; }
      } else if (f.state === 'leap' && f.t >= FROG.leap) {
        f.state = 'under'; f.t = 0; f.wait = span(FROG.under);
        rings.push(f.wx, f.wz, FROG.splash);
      } else if (f.state === 'under' && f.t >= f.wait && nearest(f.wx, f.wz) > FROG.shy) {
        f.state = 'peek'; f.t = 0; f.wait = span(FROG.peek);
        rings.push(f.wx, f.wz, FROG.stir);
      } else if (f.state === 'peek' && (nearest(f.wx, f.wz) < FROG.shy || (f.t >= f.wait && nearest(f.hx, f.hz) < FROG.calm))) {
        // it dives again: something came close, or it is not quiet yet at its seat
        f.state = 'under'; f.t = 0; f.wait = span(FROG.under);
        rings.push(f.wx, f.wz, FROG.stir);
      } else if (f.state === 'peek' && f.t >= f.wait) {
        f.state = 'back'; f.t = 0; f.face = f.hx >= f.wx ? 1 : -1;
        rings.push(f.wx, f.wz, FROG.stir);
      } else if (f.state === 'back' && f.t >= FROG.leap) {
        f.state = 'sit'; f.t = 0; f.alarm = 0; f.nerve = r() * FROG.nerve; f.face = f.wx >= f.hx ? 1 : -1;
      }
    }
    for (const d of this.flies) {
      d.t += dt;
      if (d.t < d.dur) {
        const k = d.t / d.dur, e = k * k * (3 - 2 * k);
        d.x = d.fx + (d.tx - d.fx) * e; d.z = d.fz + (d.tz - d.fz) * e; d.y = d.fy + (d.ty - d.fy) * e;
      } else {
        d.x = d.tx; d.z = d.tz; d.y = d.ty;
        if (d.t >= d.dur + d.hover) {
          // A dart to a new point near its home.
          for (let i = 0; i < 8; i++) {
            const nx = d.hx + (r() - 0.5) * 7, nz = d.hz + (r() - 0.5) * 5;
            if (!this.flyOk(nx, nz)) continue;
            d.fx = d.x; d.fz = d.z; d.fy = d.y; d.tx = nx; d.tz = nz; d.ty = FLY_Y[0] + r() * (FLY_Y[1] - FLY_Y[0]);
            d.dur = 0.18 + Math.hypot(nx - d.x, nz - d.z) * 0.07; d.hover = 0.4 + r() * 1.8; d.t = 0;
            if (Math.abs(nx - d.x) > 0.2) d.face = nx > d.x ? 1 : -1;
            break;
          }
        }
      }
    }
    return this.rings;
  }

  /** How far (px across the screen) a stalk's point `y` px up is bent: its own lean, and the wind's sway times `wind` (0: no wind). */
  private bend(s: Stalk, x: number, z: number, y: number, wind: number, t: number): number {
    return Math.round((wind !== 0 ? sway(x, z, y, s.h, REED_SWAY, t) * wind : 0) + s.lean * (y / s.h) * 2);
  }

  /** The height (tiles, <= 0) of what one sees at a point of the shore: the ground, the sloping bed while it is dry, then the water's surface. */
  private floorAt(x: number, z: number): number {
    return Math.max(WATER_LEVEL, -this.field.depthAt(x, z));
  }

  /** Where a pad lies at time `t`: it drifts a hair around its place. */
  padAt(p: Pad, t: number): [number, number] {
    return [padX(p, t), padZ(p, t)];
  }

  /** Pushes the pads, reeds, frogs and dragonflies into `out.cards` and their soft shadows into `out.shadows`. Returns how many dragonflies it drew. */
  push(out: LifeOut, frames: FrameRects, cam: Cam, t: number, o: LifeLook): number {
    const inView = (x: number, z: number): boolean => x >= o.view.x0 - MARGIN && x <= o.view.x1 + MARGIN && z >= o.view.z0 - MARGIN && z <= o.view.z1 + MARGIN;
    const seen = (x: number, z: number): boolean => !o.mask || !hiddenAt(o.mask, x, z);
    const oval = o.oval ?? 1;
    const up = (x: number, z: number, lift: number, ox: number, oy: number, w: number, h: number, tint: Rgb, scenery = false): void => {
      pushCard(out.cards, { frame: PX_FRAME, crop: { x: 0, y: 0, w, h }, x, z, lift, flip: false, originX: 0, footY: 0, scale: 1, offset: [ox, oy], tint, mode: 1, alpha: 1, scenery }, frames, cam);
    };
    /** A grid standing on (x, z): its bottom row on `lift`, column `ax` on the point, mirrored when `face` < 0. */
    const stand = (s: Sprite, pal: Record<string, Rgb>, x: number, z: number, lift: number, ax: number, face: number): void => {
      for (const q of s.runs) up(x, z, lift, face > 0 ? q.x - ax : ax - q.x - q.w, q.y - s.h, q.w, 1, pal[q.c]);
    };

    for (const p of this.pads) {
      if (!inView(p.x, p.z)) continue;
      const x = padX(p, t), z = padZ(p, t);
      const s = PADS[p.size], pal = PAD_PALS[p.colour];
      // Flat on the water, in the opaque pass: the water's surface is drawn after it and stays under it.
      for (const q of s.runs) {
        pushFlat(out.cards, { frame: PX_FRAME, crop: { x: 0, y: 0, w: q.w, h: 1 }, x, z, lift: 0, flip: false, originX: 0, footY: 0, scale: 1, offset: [(p.flip ? s.w - q.x - q.w : q.x) - s.w / 2, q.y - s.h / 2], tint: pal[q.c], mode: 1, alpha: 1, base: WATER_LEVEL + PAD_OVER - LIE_Y, scenery: true }, frames, cam);
      }
      if (p.flower >= 0) {
        const fp = FLOWER_PALS[p.flower];
        const fl = p.size >= 7 ? FLOWER_BIG : FLOWER;
        for (const q of fl.runs) up(x, z, WATER_LEVEL + PAD_OVER, q.x - (fl.w >> 1) - (p.flip ? 0 : 1), q.y - fl.h, q.w, 1, fp[q.c], true);
      }
    }

    // The wind's sway runs along WIND_DIR on the ground: what of it shows across the screen.
    const wind = o.wind ? (WIND_DIR[0] * Math.cos(cam.yaw) + WIND_DIR[1] * Math.sin(cam.yaw)) * TILE : 0;
    for (const c of this.clumps) {
      if (!inView(c.x, c.z)) continue;
      pushShadow(out.shadows, cam, c.x, c.z, 0.34, 0.14, SHADE.reeds * oval, this.floorAt(c.x, c.z));
      for (const s of c.stalks) {
        const x = c.x + s.dx, z = c.z + s.dz;
        const lift = this.floorAt(x, z);
        // Three pieces, each shifted by the wind's sway at its height (whole px), so the stalk bends.
        const c1 = Math.round(s.h * 0.4), c2 = Math.round(s.h * 0.72), top = this.bend(s, x, z, s.h, wind, t);
        up(x, z, lift, this.bend(s, x, z, c1, wind, t), -c1, 1, c1, s.colour, true);
        up(x, z, lift, this.bend(s, x, z, c2, wind, t), -c2, 1, c2 - c1, s.colour, true);
        up(x, z, lift, top, -s.h, 1, s.h - c2, s.colour, true);
        if (s.blade > 0) {
          // The leaf: beside the stalk's foot, its upper part a px further out.
          const side = s.lean >= 0 ? 1 : -1, low = Math.round(s.blade * 0.6);
          up(x, z, lift, side, -low, 1, low, s.colour, true);
          up(x, z, lift, side * 2 + this.bend(s, x, z, s.blade, wind, t), -s.blade, 1, s.blade - low, s.colour, true);
        }
        if (s.head) {
          // The cattail: a brown head two px thick below the stalk's tip, its lit side lighter.
          const hx = top;
          up(x, z, lift, hx, -s.h + 2, 1, 4, C.headLight, true);
          up(x, z, lift, hx + 1, -s.h + 2, 1, 4, C.head, true);
        }
      }
    }

    for (const f of this.frogs) {
      if (f.state === 'under') continue;
      const hx = f.pad ? padX(f.pad, t) : f.hx, hz = f.pad ? padZ(f.pad, t) : f.hz;
      const home = f.pad ? WATER_LEVEL + PAD_OVER * 2 : this.floorAt(hx, hz) + (o.ground ? o.ground(hx, hz, 0) : 0);
      if (f.state === 'peek') {
        if (!inView(f.wx, f.wz) || !seen(f.wx, f.wz)) continue;
        stand(FROG_PEEK, f.blink > 0 ? SKIN : SKIN_BLINK, f.wx, f.wz, WATER_LEVEL, 1, 1);
        continue;
      }
      const leaping = f.state !== 'sit';
      // `k`: how far it is from its seat to the water (a leap back runs the other way).
      const part = leaping ? Math.min(1, f.t / FROG.leap) : 0, k = f.state === 'back' ? 1 - part : part;
      const x = hx + (f.wx - hx) * k, z = hz + (f.wz - hz) * k;
      if (!inView(x, z) || !seen(x, z)) continue;
      const rise = Math.sin(Math.PI * k);
      const base = home + (WATER_LEVEL - home) * k;
      pushShadow(out.shadows, cam, x, z, 0.2, 0.09, SHADE.frog * oval * (1 - 0.6 * rise), Math.min(base, 0));
      stand(leaping ? FROG_LEAP : FROG_SIT, f.blink > 0 || leaping ? SKIN : SKIN_BLINK, x, z, base + rise * FROG.arc, 3, f.face);
    }

    let n = 0;
    if (o.day >= 0.5) {
      for (const d of this.flies) {
        if (!inView(d.x, d.z) || !seen(d.x, d.z)) continue;
        const hov = d.t >= d.dur ? Math.sin(t * 7 + d.hx) * 0.02 : 0;
        const lift = d.y + hov;
        pushShadow(out.shadows, cam, d.x, d.z, 0.14, 0.05, SHADE.fly * oval, this.floorAt(d.x, d.z));
        // The body with its head in front; two pairs of long wings across it, one of each pair on either side, shorter on every other beat.
        up(d.x, d.z, lift, -3, -1, 5, 1, d.colour);
        up(d.x, d.z, lift, d.face > 0 ? 2 : -4, -1, 1, 1, C.flyHead);
        const len = Math.floor(t * 24) % 2 === 0 ? 3 : 2;
        for (let wx = -2; wx <= 0; wx += 2) {
          up(d.x, d.z, lift, wx, -1 - len, 1, len, C.wing);
          up(d.x, d.z, lift, wx, 0, 1, len, C.wing);
        }
        n++;
      }
    }
    return n;
  }
}
