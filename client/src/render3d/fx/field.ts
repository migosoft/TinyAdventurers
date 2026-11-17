// The boss hall's force field, the particles of it (#308): the glitter rising from the sealed cells and the burst of 40 when it appears.
// The glitter is a seeded stream per cell, pure in the clock: mote `j` of a cell is born at
// `j / RATE` and rises 12 px over its life. The fill, bands and rims are the field mesh's material (`fieldMesh.ts`), driven by `fieldAge`.
import { WALL_H } from '../heights';
import { registerFrameFx, type Effects3d, type FxFrame } from './effects3d';
import { hash3 } from './rand';
import { PX, dot, type Axes } from './shapes';
import type { FxTris } from './tris';
import type { FxOut } from './types';

/** The burst when the field appears. */
export const FIELD_BURST = 40;
/** Glitter colours. */
const GLITTER = [0xbfe8ff, 0xffffff, 0x7fc4ff];
/** Motes born per cell and second, and the life of one (s). */
const RATE = 30;
const LIFE0 = 0.4, LIFE1 = 0.9;
/** Rise over a life: 12 px. */
const RISE = 12 * PX;
const SIZE = PX * 1.5;
/** Seconds the burst lasts at most. */
export const FIELD_BURST_LIFE = LIFE0 + 0.5;

const rgb = (c: number, i: number): number => (i === 0 ? c >> 16 : i === 1 ? (c >> 8) & 255 : c & 255) / 255;

/** The burst: `FIELD_BURST` motes thrown from random spots of the field's cells, each a pure function of (`seed`, index) and `age`. */
export function fieldBurst(T: FxTris, ax: Axes, cells: readonly (readonly [number, number])[], age: number, seed: number): void {
  if (age < 0 || age > FIELD_BURST_LIFE || cells.length === 0) return;
  for (let i = 0; i < FIELD_BURST; i++) {
    const life = LIFE0 + 0.5 * hash3(seed, i, 3);
    if (age > life) continue;
    const c = cells[Math.floor(hash3(seed, i, 0) * cells.length) % cells.length];
    // Thrown at +-20 px/s in both directions along the floor and up
    const vx = (hash3(seed, i, 4) - 0.5) * 40 * PX, vy = (hash3(seed, i, 5) - 0.5) * 40 * PX, vz = (hash3(seed, i, 6) - 0.5) * 40 * PX;
    const k = age / life, col = GLITTER[Math.floor(hash3(seed, i, 7) * GLITTER.length) % GLITTER.length];
    dot(T, ax, c[0] + hash3(seed, i, 1) + vx * age, hash3(seed, i, 2) * WALL_H + vy * age, c[1] + hash3(seed, i, 8) + vz * age, SIZE * (1 - k * 0.7), rgb(col, 0), rgb(col, 1), rgb(col, 2), 1 - k * k);
  }
}

/** The steady glitter of one cell at `now`: the motes born in the last `LIFE1` seconds that are still alive. */
function glitter(T: FxTris, ax: Axes, x: number, z: number, now: number, rate: number): void {
  const key = x * 7919 + z * 104729;
  for (let j = Math.max(0, Math.ceil((now - LIFE1) * rate)); j <= Math.floor(now * rate); j++) {
    const life = LIFE0 + (LIFE1 - LIFE0) * hash3(key, j, 3), age = now - j / rate;
    if (age >= life) continue;
    const k = age / life, col = GLITTER[Math.floor(hash3(key, j, 4) * GLITTER.length) % GLITTER.length];
    dot(T, ax, x + hash3(key, j, 0), hash3(key, j, 1) * WALL_H + RISE * k, z + hash3(key, j, 2), SIZE * (1 - k * 0.7), rgb(col, 0), rgb(col, 1), rgb(col, 2), 1 - k * k);
  }
}

/** Draws the glitter of every sealed cell in the footprint, and the burst while the field is new. */
export function drawField(out: FxOut, frame: FxFrame, fx: Effects3d): void {
  const cells = fx.sealed();
  if (cells.length === 0) return;
  const T = out.tris, ctx = frame.ctx, fp = frame.fp, rate = RATE * ctx.detail;
  for (const c of cells) {
    if (fp && (c[0] + 1 < fp.x0 || c[0] > fp.x1 || c[1] + 1 < fp.z0 || c[1] > fp.z1)) continue;
    glitter(T, ctx.ax, c[0], c[1], ctx.now, rate);
  }
  const age = fx.fieldAge(ctx.now);
  if (age <= FIELD_BURST_LIFE) fieldBurst(T, ctx.ax, cells, age, 0x5eed);
}

/** Registers the field's drawer. */
export function registerField(): void {
  registerFrameFx(drawField);
}
