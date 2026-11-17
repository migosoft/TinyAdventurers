// The droplets of the water in 3D (#345): the splash of a figure entering or plunging, the spray of a dash and the bubbles of a drowning.
// The 2D originals are `WadeFx`, `sinkStartFx` and `bubbleFx` (game/terrain.ts); speeds are art pixels per second as in figureFx.ts.
// The cues come from `Water3d` (`frame.water`); a cue of an id the sight hides makes no record. All droplets are lit, like dust and smoke.
import { WATER_Y } from '../air/drips';
import { FX_KIND, registerFrameFx, registerFx, type Effects3d, type FxFrame, type FxRec } from './effects3d';
import { burst, PX, type BurstSpec } from './shapes';
import type { WaterCues, WaterSpot } from '../water/water';
import type { FxOut } from './types';

/** Motes of an entering and of a plunge (before the detail setting). */
const ENTER_N = 6, PLUNGE_N = 14;
const ENTER: BurstSpec = { x: 0, y: 0, z: 0, n: ENTER_N, speed: [8 * PX, 30 * PX], up: [0.5, 1.3], life: [0.2, 0.35], g: 3, drag: 0, size: PX * 2, colours: [0x72d6ce], streak: false, floor: WATER_Y };
const PLUNGE: BurstSpec = { x: 0, y: 0, z: 0, n: PLUNGE_N, speed: [10 * PX, 45 * PX], up: [0.6, 1.4], life: [0.25, 0.45], g: 3, drag: 0, size: PX * 2, colours: [0xcae6f5], streak: false, floor: WATER_Y };
/** A spray droplet: sideways up to 15 px/s, up 20 px/s. A bubble rises at 10 px/s. */
const SPRAY: BurstSpec = { x: 0, y: 0, z: 0, n: 1, speed: [20 * PX, 25 * PX], up: [0.93, 1.2], life: [0.2, 0.3], g: 3, drag: 0, size: PX * 1.5, colours: [0xcae6f5], streak: false, floor: WATER_Y };
const BUBBLE: BurstSpec = { x: 0, y: 0, z: 0, n: 1, speed: [10 * PX, 10 * PX], up: [Math.PI / 2 - 0.01, Math.PI / 2 - 0.01], life: [0.25, 0.35], g: 0, drag: 0, size: PX * 1.5, colours: [0xcae6f5], streak: false, floor: WATER_Y };

function emitAll(fx: Effects3d, hidden: ReadonlySet<number>, now: number, list: readonly WaterSpot[], kind: typeof FX_KIND.WaterSplash | typeof FX_KIND.WaterDrop, a: number): void {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!hidden.has(s.id)) fx.emit(kind, now, s.x, s.z, s.id, a);
  }
}

/** The records of water cues born at `now`: the one place that says which kind and variant a cue makes. A cue of a hidden id makes none. */
export function emitWaterCues(fx: Effects3d, w: WaterCues, now: number, hidden: ReadonlySet<number>): void {
  emitAll(fx, hidden, now, w.enters, FX_KIND.WaterSplash, 0);
  emitAll(fx, hidden, now, w.plunges, FX_KIND.WaterSplash, 1);
  emitAll(fx, hidden, now, w.spray, FX_KIND.WaterDrop, 0);
  emitAll(fx, hidden, now, w.bubbles, FX_KIND.WaterDrop, 1);
}

/** The records of a frame's water cues. */
function drawWaterFx(_out: FxOut, frame: FxFrame, fx: Effects3d): void {
  if (frame.water) emitWaterCues(fx, frame.water, frame.ctx.now, frame.hidden);
}

function drawSplash(o: FxOut, f: FxFrame, r: FxRec, age: number): void {
  if (f.hidden.has(r.follow)) return;
  const s = r.a === 1 ? PLUNGE : ENTER;
  s.x = r.x; s.y = WATER_Y; s.z = r.z; s.n = Math.max(2, Math.round((r.a === 1 ? PLUNGE_N : ENTER_N) * f.ctx.detail));
  burst(o.lit, f.ctx.ax, s, age, r.seed);
}

function drawDrop(o: FxOut, f: FxFrame, r: FxRec, age: number): void {
  if (f.hidden.has(r.follow)) return;
  const s = r.a === 1 ? BUBBLE : SPRAY;
  s.x = r.x; s.y = WATER_Y; s.z = r.z;
  burst(o.lit, f.ctx.ax, s, age, r.seed);
}

/** Registers the water's droplets (the frame drawer and the drawers of the two kinds). */
export function registerWaterFx(): void {
  registerFrameFx(drawWaterFx);
  registerFx(FX_KIND.WaterSplash, drawSplash);
  registerFx(FX_KIND.WaterDrop, drawDrop);
}
