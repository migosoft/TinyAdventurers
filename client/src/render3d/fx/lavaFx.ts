// The sparks and embers of the lava in 3D (#344): a figure entering, a bubble popping, the spray of a dash and the embers of a burning hero.
// Speeds are art pixels per second as in waterFx.ts. The cues come from `Lava3d`
// (`frame.lava`); a cue of an id the sight hides makes no record. Everything glows (`out.tris`), nothing is lit.
import { LAVA_Y } from '../air/puffs';
import { FX_KIND, registerFrameFx, registerFx, type Effects3d, type FxFrame, type FxRec } from './effects3d';
import { hash3 } from './rand';
import { burst, dot, lerp, PX, type BurstSpec } from './shapes';
import type { LavaCues, LavaSpot } from '../lava/lava';
import type { FxOut } from './types';

/** The glow colours (hex), shared by the burst specs and the embers. */
const HOT = 0xffcc68, ORANGE = 0xee8e2e, YELLOW = 0xfacb3e;
const rgb = (c: number): [number, number, number] => [(c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** Motes of an entering and of a pop (before the detail setting). */
const ENTER_N = 6, POP_N = 14;
const ENTER: BurstSpec = { x: 0, y: 0, z: 0, n: ENTER_N, speed: [8 * PX, 30 * PX], up: [0.5, 1.3], life: [0.2, 0.35], g: 3, drag: 0, size: PX * 2, colours: [ORANGE], streak: false, floor: LAVA_Y };
/** A pop's sparks land after about a second. */
const POP: BurstSpec = { x: 0, y: 0, z: 0, n: POP_N, speed: [30 * PX, 65 * PX], up: [0.9, 1.4], life: [0.7, 1.2], g: 5, drag: 0, size: PX * 2, colours: [HOT, ORANGE], streak: false, floor: LAVA_Y };
const SPRAY: BurstSpec = { x: 0, y: 0, z: 0, n: 1, speed: [20 * PX, 25 * PX], up: [0.93, 1.2], life: [0.2, 0.3], g: 3, drag: 0, size: PX * 1.5, colours: [YELLOW], streak: false, floor: LAVA_Y };

/** Embers of a burning hero: how many loop at once, how long each lives, how far from the hero it starts and how it rises (px). */
export const EMBER_SLOTS = 6;
export const EMBER_LIFE = 0.6, EMBER_SPREAD = 6 * PX, EMBER_LIFT = 10 * PX, EMBER_RISE: readonly [number, number] = [20 * PX, 32 * PX];
const EMBER_SIZE = PX * 2;
const EMBER_COLOURS = [rgb(HOT), rgb(ORANGE)];

function emitAll(fx: Effects3d, hidden: ReadonlySet<number>, now: number, list: readonly LavaSpot[], kind: typeof FX_KIND.LavaBurst | typeof FX_KIND.LavaSpray, a: number): void {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!hidden.has(s.id)) fx.emit(kind, now, s.x, s.z, s.id, a);
  }
}

/** The records of lava cues born at `now`: the one place that says which kind and variant a cue makes. A cue of a hidden id makes none. */
export function emitLavaCues(fx: Effects3d, l: LavaCues, now: number, hidden: ReadonlySet<number>): void {
  emitAll(fx, hidden, now, l.enters, FX_KIND.LavaBurst, 0);
  for (let i = 0; i < l.pops.length; i++) fx.emit(FX_KIND.LavaBurst, now, l.pops[i].x, l.pops[i].z, -1, 1);   // a pop belongs to no figure: no id hides it
  emitAll(fx, hidden, now, l.spray, FX_KIND.LavaSpray, 0);
}

/** Where ember `slot` of figure `id` is at `now`: (dx, dy, dz) from the figure's contact point and its fade 0..1 (1 at birth, 0 at its end).
 *  A pure function, looping every EMBER_LIFE seconds with a phase, a place and a rise per slot and id. */
export function emberAt(id: number, slot: number, now: number, out: [number, number, number]): number {
  const t = now / EMBER_LIFE + hash3(id, slot, 11), k = t - Math.floor(t), age = k * EMBER_LIFE;
  const ang = hash3(id, slot, 12) * Math.PI * 2, rad = Math.sqrt(hash3(id, slot, 13)) * EMBER_SPREAD;
  const rise = lerp(EMBER_RISE[0], EMBER_RISE[1], hash3(id, slot, 14));
  out[0] = Math.cos(ang) * rad; out[2] = Math.sin(ang) * rad;
  out[1] = hash3(id, slot, 15) * EMBER_LIFT + rise * age;
  // Bright for most of its life, then out quickly: a straight fade leaves a dull speck on the dark crust for half the time.
  return 1 - k * k * k;
}

/** The records of a frame's lava cues, and the embers of the burning heroes (not records: a pure function of the clock). */
function drawLavaFx(out: FxOut, frame: FxFrame, fx: Effects3d): void {
  const l = frame.lava;
  if (!l) return;
  const now = frame.ctx.now;
  emitLavaCues(fx, l, now, frame.hidden);
  const e: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < l.burning.length; i++) {
    const b = l.burning[i];
    if (frame.hidden.has(b.id)) continue;
    for (let s = 0; s < EMBER_SLOTS; s++) {
      const f = emberAt(b.id, s, now, e);
      const c = EMBER_COLOURS[s & 1];
      dot(out.tris, frame.ctx.ax, b.x + e[0], LAVA_Y + e[1], b.z + e[2], EMBER_SIZE, c[0], c[1], c[2], f);
    }
  }
}

function drawBurst(o: FxOut, f: FxFrame, r: FxRec, age: number): void {
  if (r.follow >= 0 && f.hidden.has(r.follow)) return;
  const pop = r.a === 1;
  const s = pop ? POP : ENTER;
  s.x = r.x; s.y = LAVA_Y; s.z = r.z; s.n = Math.max(pop ? 4 : 2, Math.round((pop ? POP_N : ENTER_N) * f.ctx.detail));
  burst(o.tris, f.ctx.ax, s, age, r.seed);
}

function drawSpray(o: FxOut, f: FxFrame, r: FxRec, age: number): void {
  if (f.hidden.has(r.follow)) return;
  SPRAY.x = r.x; SPRAY.y = LAVA_Y; SPRAY.z = r.z;
  burst(o.tris, f.ctx.ax, SPRAY, age, r.seed);
}

/** Registers the lava's sparks and embers (the frame drawer and the drawers of the two kinds). */
export function registerLavaFx(): void {
  registerFrameFx(drawLavaFx);
  registerFx(FX_KIND.LavaBurst, drawBurst);
  registerFx(FX_KIND.LavaSpray, drawSpray);
}
