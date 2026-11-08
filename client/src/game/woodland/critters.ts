// Woodland critters (#203): bees looping around flower patches and butterflies wandering over the grass. Cosmetic and
// client-only. Every position is a pure function of time and seed (no state). Each critter is a few reused pixel
// images, depth-sorted like figures (canopies and trunks cover them), shown only where the viewer sees (seenLit).
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

/** A bee's draw depth: sorted by its own ground point like every figure (bees fly at no height, so that is its drawn y), not by its flower's. */
export function beeDepth(pos: Pt): number {
  return DEPTH.entityBase + pos.y;
}

/** `y` includes the flap lift; `ground` is the height without it (what it is sorted by). */
export interface Butterfly extends Pt { open: boolean; landed: boolean; ground: number }
/** A burst of this many flaps lifts it, then it glides down for GLIDE flap lengths. */
const FLAPS_UP = 7, GLIDE = 3, CYCLE = FLAPS_UP + GLIDE;

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
  const ft = t * q.flapHz + q.flapPh;
  const n = Math.floor(ft), phase = ft - n;
  // Each down-stroke (phase 0..0.3) lifts 1.5 px, then it sinks 0.6 px before the next flap: +0.9 px per flap. After
  // FLAPS_UP flaps it glides back down to the ground height over GLIDE flap lengths. Near a landing the lift fades out.
  const k = ((n % CYCLE) + CYCLE) % CYCLE;
  const peak = 0.9 * FLAPS_UP;
  let air = k < FLAPS_UP ? 0.9 * k + (phase < 0.3 ? 1.5 * (phase / 0.3) : 1.5 - 0.6 * Math.min(1, (phase - 0.3) / 0.7)) : peak * (1 - (k - FLAPS_UP + phase) / GLIDE);
  if (landed) air = 0;
  else {
    const into = s % q.period;
    air *= Math.min(1, (into - q.land) / 0.3, (q.period - into) / 0.3);
  }
  out.x = x;
  out.y = y - air;
  out.ground = y;
  // wings are shut at the bottom of the down-stroke and open on the up-stroke (and in the glide)
  out.open = !landed && (k >= FLAPS_UP || phase >= 0.35);
  out.landed = landed;
  return out;
}

/** Butterfly `i` at time `t` (s) wandering inside `bounds` (px). */
export function butterflyAt(i: number, t: number, seed: number, bounds: Rect): Butterfly {
  return flyPos(flyParams(i, seed, bounds), t, bounds, { x: 0, y: 0, open: false, landed: false, ground: 0 });
}

interface Flyer { bounds: Rect; colour: number; q: FlyParams; left: Phaser.GameObjects.Image; right: Phaser.GameObjects.Image; body: Phaser.GameObjects.Image }
interface Bee { f: Pt; q: BeeParams; body: Phaser.GameObjects.Image; stripe: Phaser.GameObjects.Image }

const PX_TEX = 'critter-px';
type Px = Phaser.GameObjects.Image;

export class Critters {
  /** Whether the bees fly. */
  beesOn = true;
  /** Whether the butterflies fly. */
  butterfliesOn = true;
  private patches: Pt[];
  private flyers: Flyer[] = [];
  private bees: Bee[] = [];
  private pos: Butterfly = { x: 0, y: 0, open: false, landed: false, ground: 0 };

  /** `map`: the walkable tiles (floor and road) decide how many butterflies there are and where they live. */
  constructor(private scene: Phaser.Scene, flowers: Pt[], seed: number, map: TileMap) {
    if (!scene.textures.exists(PX_TEX)) {
      const c = scene.textures.createCanvas(PX_TEX, 1, 1)!;
      c.getContext().fillStyle = '#fff';
      c.getContext().fillRect(0, 0, 1, 1);
      c.refresh();
    }
    this.patches = flowerPatches(flowers);
    this.patches.forEach((f, p) => {
      for (let b = 0; b < BEES_PER_PATCH; b++) this.bees.push({ f, q: beeParams(p * BEES_PER_PATCH + b, seed), body: this.px(BEE_YELLOW), stripe: this.px(BEE_DARK) });
    });
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
      const colour = WING_COLOURS[Math.floor(r() * WING_COLOURS.length)];
      this.flyers.push({ bounds, colour, q: flyParams(i, seed, bounds), left: this.px(colour), right: this.px(colour), body: this.px(BODY) });
    }
  }

  /** A 1x1 white pixel object, tinted and stretched into a shape; created once and reused. */
  private px(tint: number): Px {
    return this.scene.add.image(0, 0, PX_TEX).setOrigin(0).setTint(tint).setVisible(false);
  }

  private seen(seenLit: Uint8Array, mapW: number, x: number, y: number): boolean {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return tx >= 0 && tx < mapW && ty >= 0 && ty * mapW + tx < seenLit.length && seenLit[ty * mapW + tx] === 1;
  }

  private static rect(o: Px, x: number, y: number, w: number, h: number, depth: number): void {
    o.setPosition(x, y).setScale(w, h).setDepth(depth).setVisible(true);
  }

  /** `cam`: when given, critters outside it are skipped. */
  update(t: number, seenLit: Uint8Array, mapW: number, cam?: Phaser.Geom.Rectangle): void {
    const pos = this.pos;
    for (const bee of this.bees) {
      bee.body.setVisible(false);
      bee.stripe.setVisible(false);
      if (!this.beesOn) continue;
      if (cam && (bee.f.x < cam.x - 16 || bee.f.x > cam.right + 16 || bee.f.y < cam.y - 16 || bee.f.y > cam.bottom + 16)) continue;
      beePos(bee.q, t, bee.f, pos);
      if (!this.seen(seenLit, mapW, pos.x, pos.y)) continue;
      const x = Math.round(pos.x), y = Math.round(pos.y), d = beeDepth(pos);
      Critters.rect(bee.body, x - 1, y - 1, 2, 2, d);
      Critters.rect(bee.stripe, x, y - 1, 1, 2, d + 0.01);
    }
    for (const fl of this.flyers) {
      fl.left.setVisible(false);
      fl.right.setVisible(false);
      fl.body.setVisible(false);
      if (!this.butterfliesOn) continue;
      const b = flyPos(fl.q, t, fl.bounds, pos);
      if (cam && (b.x < cam.x - 16 || b.x > cam.right + 16 || b.y < cam.y - 16 || b.y > cam.bottom + 16)) continue;
      if (!this.seen(seenLit, mapW, b.x, b.ground)) continue;
      const x = Math.round(b.x), y = Math.round(b.y), d = DEPTH.entityBase + b.ground;
      if (b.open) { Critters.rect(fl.left, x - 3, y - 2, 2, 3, d); Critters.rect(fl.right, x + 1, y - 2, 2, 3, d); }
      else { Critters.rect(fl.left, x - 1, y - 2, 1, 3, d); Critters.rect(fl.right, x, y - 2, 1, 3, d); }
      Critters.rect(fl.body, x, y - 1, 1, 3, d + 0.01);
    }
  }

  destroy(): void {
    for (const b of this.bees) { b.body.destroy(); b.stripe.destroy(); }
    for (const f of this.flyers) { f.left.destroy(); f.right.destroy(); f.body.destroy(); }
    if (this.scene.textures.exists(PX_TEX)) this.scene.textures.remove(PX_TEX);
  }
}
