// Woodland critters (#203): bees looping around flower patches and butterflies wandering over the grass. Cosmetic and
// client-only. Every position is a pure function of time and seed (no state), and the shapes are drawn into one
// reused Graphics, only for the critters the viewer can see (seenLit) and the camera window shows.
import type Phaser from 'phaser';
import { TILE_ID } from '../../generated/defs';
import { TILE, type TileMap } from '../../sim/map';
import { rng } from '../covemath';
import { DEPTH } from '../effects';

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

const BEES_PER_PATCH = 3;
const MAX_PATCHES = 40;
/** A flower patch is the flowers within one cell of this many px. */
const PATCH_CELL = 48;
/** One butterfly per this many walkable tiles. */
const TILES_PER_BUTTERFLY = 120;
/** A butterfly's wander box (tiles) around its home. */
const WANDER_TILES = 12;
const TAU = Math.PI * 2;

/** The butterflies' wing colours: white, yellow, light blue, orange. */
export const WING_COLOURS = [0xfdf7ed, 0xfacb3e, 0xcae6f5, 0xe8883a];
const BEE_YELLOW = 0xf5c518, BEE_DARK = 0x2a2218, BODY = 0x2a2218;

const seedOf = (seed: number, i: number, salt: number) => (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;

/** Patches of flowers (grid cells with at least 2 flowers; else any), the biggest first, at most `max`; each at its flowers' centre. */
export function flowerPatches(spots: Pt[], max = MAX_PATCHES): Pt[] {
  const cells = new Map<number, { n: number; x: number; y: number }>();
  for (const s of spots) {
    const k = Math.floor(s.y / PATCH_CELL) * 100000 + Math.floor(s.x / PATCH_CELL);
    const c = cells.get(k);
    if (c) { c.n++; c.x += s.x; c.y += s.y; } else cells.set(k, { n: 1, x: s.x, y: s.y });
  }
  const all = [...cells.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]);
  return all.slice(0, max).map(([, c]) => ({ x: c.x / c.n, y: c.y / c.n }));
}

interface BeeParams { radius: number; w: number; p: number; p2: number }
function beeParams(i: number, seed: number): BeeParams {
  const r = rng(seedOf(seed, i, 1));
  return { radius: 4 + r() * 5, w: TAU / (1 + r()), p: r() * TAU, p2: r() * TAU };
}
/** Writes bee position at `t` into `out` (no allocation). */
function beePos(q: BeeParams, t: number, flower: Pt, out: Pt): Pt {
  const wob = 0.1 * q.radius * Math.sin(q.w * 2.3 * t + q.p2);
  out.x = flower.x + (q.radius + wob) * Math.cos(q.w * t + q.p);
  out.y = flower.y + (q.radius * 0.8 + wob) * Math.sin(q.w * t + q.p);
  return out;
}

/** Bee `i` at time `t` (s): a small wobbling loop of radius 4-9 px (period 1-2 s) around `flower`; at most 10 px away. */
export function beeAt(i: number, t: number, flower: Pt, seed: number): Pt {
  return beePos(beeParams(i, seed), t, flower, { x: 0, y: 0 });
}

export interface Butterfly extends Pt { open: boolean; landed: boolean }

interface FlyParams { flapHz: number; flapPh: number; wx: number; wy: number; p1: number; p2: number; p3: number; p4: number; period: number; land: number; lph: number }
function flyParams(i: number, seed: number, bounds: Rect): FlyParams {
  const r = rng(seedOf(seed, i, 2));
  const flapHz = 5 + r() * 2, flapPh = r();
  const speed = 8 + r() * 6;
  // a slowly turning heading: two sines per axis; the peak speed on each axis is about `speed`
  const wx = speed / Math.max(bounds.w / 2, 1) / 1.3, wy = speed / Math.max(bounds.h / 2, 1) / 1.3;
  const p1 = r() * TAU, p2 = r() * TAU, p3 = r() * TAU, p4 = r() * TAU;
  // lands for 1-3 s every 8-20 s
  const period = 8 + r() * 12, land = 1 + r() * 2, lph = r() * period;
  return { flapHz, flapPh, wx, wy, p1, p2, p3, p4, period, land, lph };
}
/** Time spent landed in [0, s]. */
const landedBy = (q: FlyParams, s: number) => Math.floor(s / q.period) * q.land + Math.min(s % q.period, q.land);

function flyPos(q: FlyParams, t: number, bounds: Rect, out: Butterfly): Butterfly {
  const s = t + q.lph;
  const landed = s % q.period < q.land;
  // the time spent landed does not advance the path, so it never jumps
  const tau = t - (landedBy(q, s) - landedBy(q, q.lph));
  const ax = bounds.w / 2, ay = bounds.h / 2;
  const x = bounds.x + ax + ax * (0.7 * Math.sin(q.wx * tau + q.p1) + 0.3 * Math.sin(q.wx * 1.9 * tau + q.p2));
  const y = bounds.y + ay + ay * (0.7 * Math.sin(q.wy * tau + q.p3) + 0.3 * Math.sin(q.wy * 1.9 * tau + q.p4));
  let phase = (t * q.flapHz + q.flapPh) % 1;
  if (phase < 0) phase += 1;
  // down-stroke 0..0.3 lifts 1.5 px, then it sinks 0.6 px gliding and settles the rest before the next flap
  const lift = landed ? 0 : phase < 0.3 ? -1.5 * (phase / 0.3) : phase < 0.7 ? -1.5 + 0.6 * ((phase - 0.3) / 0.4) : -0.9 + 0.9 * ((phase - 0.7) / 0.3);
  out.x = x;
  out.y = y + lift;
  out.open = !landed && phase < 0.5;
  out.landed = landed;
  return out;
}

/** Butterfly `i` at time `t` (s) wandering inside `bounds` (px). */
export function butterflyAt(i: number, t: number, seed: number, bounds: Rect): Butterfly {
  return flyPos(flyParams(i, seed, bounds), t, bounds, { x: 0, y: 0, open: false, landed: false });
}

interface Flyer { bounds: Rect; colour: number; q: FlyParams }
interface Bee { f: Pt; q: BeeParams }

export class Critters {
  private g: Phaser.GameObjects.Graphics;
  private patches: Pt[];
  private flyers: Flyer[] = [];
  private bees: Bee[] = [];
  private pos: Butterfly = { x: 0, y: 0, open: false, landed: false };

  /** `map`: the walkable tiles (floor and road) decide how many butterflies there are and where they live. */
  constructor(scene: Phaser.Scene, flowers: Pt[], seed: number, map: TileMap) {
    this.g = scene.add.graphics().setDepth(DEPTH.fx);
    this.patches = flowerPatches(flowers);
    this.patches.forEach((f, p) => { for (let b = 0; b < BEES_PER_PATCH; b++) this.bees.push({ f, q: beeParams(p * BEES_PER_PATCH + b, seed) }); });
    const walk: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_ID.Floor || map.tiles[i] === TILE_ID.Road) walk.push(i);
    const n = Math.floor(walk.length / TILES_PER_BUTTERFLY);
    const r = rng(seed * 31 + 7);
    const side = WANDER_TILES * TILE;
    for (let i = 0; i < n; i++) {
      const tile = walk[Math.floor(r() * walk.length)];
      const cx = (tile % map.w + 0.5) * TILE, cy = (Math.floor(tile / map.w) + 0.5) * TILE;
      const x = Math.max(0, Math.min(map.w * TILE - side, cx - side / 2)), y = Math.max(0, Math.min(map.h * TILE - side, cy - side / 2));
      const bounds = { x, y, w: Math.min(side, map.w * TILE), h: Math.min(side, map.h * TILE) };
      this.flyers.push({ bounds, colour: WING_COLOURS[Math.floor(r() * WING_COLOURS.length)], q: flyParams(i, seed, bounds) });
    }
  }

  private seen(seenLit: Uint8Array, mapW: number, x: number, y: number): boolean {
    return seenLit[Math.floor(y / TILE) * mapW + Math.floor(x / TILE)] === 1;
  }

  /** `cam`: when given, critters outside it are skipped. */
  update(t: number, seenLit: Uint8Array, mapW: number, cam?: Phaser.Geom.Rectangle): void {
    const g = this.g;
    g.clear();
    const inCam = (x: number, y: number) => !cam || (x > cam.x - 8 && x < cam.right + 8 && y > cam.y - 8 && y < cam.bottom + 8);
    const pos = this.pos;
    for (const bee of this.bees) {
      if (!inCam(bee.f.x, bee.f.y)) continue;
      beePos(bee.q, t, bee.f, pos);
      if (!this.seen(seenLit, mapW, pos.x, pos.y)) continue;
      const x = Math.round(pos.x), y = Math.round(pos.y);
      g.fillStyle(BEE_YELLOW, 1).fillRect(x - 1, y - 1, 2, 2);
      g.fillStyle(BEE_DARK, 1).fillRect(x, y - 1, 1, 2);
    }
    for (const fl of this.flyers) {
      const b = flyPos(fl.q, t, fl.bounds, pos);
      if (!inCam(b.x, b.y) || !this.seen(seenLit, mapW, b.x, b.y)) continue;
      const x = Math.round(b.x), y = Math.round(b.y);
      g.fillStyle(fl.colour, 1);
      if (b.open) { g.fillRect(x - 3, y - 2, 2, 3); g.fillRect(x + 1, y - 2, 2, 3); } else { g.fillRect(x - 1, y - 2, 1, 3); g.fillRect(x, y - 2, 1, 3); }
      g.fillStyle(BODY, 1).fillRect(x, y - 1, 1, 3);
    }
  }

  destroy(): void {
    this.g.destroy();
  }
}
