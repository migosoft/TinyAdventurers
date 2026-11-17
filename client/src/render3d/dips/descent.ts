import { CHASM_BED, LAVA_LEVEL } from './shape';
import { TILE_ID } from '../../generated/defs';
import type { TileMap } from '../../sim/map';

// First guesses for the user to tune; every number of the descent lives here.
export const FALL_G = 14, SLIDE_MAX = 3, RIM_PULL = 2, FALL_GONE = CHASM_BED - 0.5, FALL_MAX_AGE = 3;
/** Seconds a drowning figure takes to drop to the bed: a look; the server's rule (CONST.DROWN_TIME) is unchanged. */
export const DROWN_SINK = 0.4;
/** The faller's body radius in tiles (a card or model is about 0.6 wide): a falling figure keeps this far from a wall. */
export const FALL_RADIUS = 0.3;
export const LAVA_IN = 0.55, LAVA_OUT = 2.5;
/** The share of its height a body sinks below the lava's level. */
export const LAVA_SHARE = 0.6;
/** How deep below the lava's level a body of `height` tiles floats. */
export function lavaSinkOf(height: number): number {
  return LAVA_SHARE * height;
}
export interface Faller { x: number; z: number; y: number; vx: number; vz: number; vy: number; cx: number; cz: number; age: number }

/** A fall starting at (x, z) tiles and height y with the figure's drawn speed (tiles/s, capped at SLIDE_MAX); cx, cz: the centre of the cell it sank in. */
export function startFall(x: number, z: number, y: number, vx: number, vz: number, cell?: { cx: number; cz: number }): Faller {
  const sp = Math.hypot(vx, vz);
  const k = sp > SLIDE_MAX ? SLIDE_MAX / sp : 1;
  return { x, z, y, vx: vx * k, vz: vz * k, vy: 0, cx: cell?.cx ?? Math.floor(x) + 0.5, cz: cell?.cz ?? Math.floor(z) + 0.5, age: 0 };
}

/**
 * The cell a fall starting at (x, z) sinks into. A drawn spot can lag the server's (the position is interpolated, the anim is not), so a
 * barrel's fall may start on the floor before the rim: then the chasm cell nearest to the spot in the 3x3 around it, the one the drawn
 * velocity points into preferred, gives the centre. Null when the spot is on a chasm cell or no chasm cell is near (the default centre).
 */
export function sinkCell(map: TileMap, x: number, z: number, vx: number, vz: number): { cx: number; cz: number } | null {
  const i0 = Math.floor(x), j0 = Math.floor(z);
  if (map.get(i0, j0) === TILE_ID.Chasm) return null;
  const sp = Math.hypot(vx, vz);
  let best: { cx: number; cz: number } | null = null, bestScore = Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (map.get(i0 + di, j0 + dj) !== TILE_ID.Chasm) continue;
      const cx = i0 + di + 0.5, cz = j0 + dj + 0.5;
      const d = Math.hypot(cx - x, cz - z);
      const along = sp > 0.5 && d > 0 ? ((cx - x) * vx + (cz - z) * vz) / (d * sp) : 0;
      const score = d - 0.6 * along;
      if (score < bestScore) { bestScore = score; best = { cx, cz }; }
    }
  }
  return best;
}

/** One step. While the bed under it carries it (bed >= y): it is pulled toward (cx, cz) at RIM_PULL and stays on the bed. Else gravity; each axis' sideways step is dropped (and its speed zeroed) when the bed at the new place or FALL_RADIUS ahead of it is above the foot, and a body overlapping a wall eases toward the cell's centre line at RIM_PULL; at the end y is clamped to the bed at the final place, so the foot never ends below the ground. False once it is gone (y <= -FALL_GONE or age > FALL_MAX_AGE). */
export function stepFall(f: Faller, dt: number, bed: (x: number, z: number) => number): boolean {
  f.age += dt;
  if (f.age > FALL_MAX_AGE) return false;
  if (bed(f.x, f.z) >= f.y) {
    const dx = f.cx - f.x, dz = f.cz - f.z, d = Math.hypot(dx, dz);
    const s = Math.min(d, RIM_PULL * dt);
    const nx = d > 0 ? f.x + (dx / d) * s : f.x, nz = d > 0 ? f.z + (dz / d) * s : f.z;
    f.vy = 0;
    // On the ground: follow the bed up (a lip), but never snap down it; when the bed drops away the next step falls.
    f.x = nx; f.z = nz;
    f.y = Math.max(bed(f.x, f.z), f.y);
    return f.y > -FALL_GONE;
  }
  const y = f.y + f.vy * dt - 0.5 * FALL_G * dt * dt;
  f.vy -= FALL_G * dt;
  // The body has a radius: each axis moves on its own (so a slide along a wall goes on), and is dropped with its speed when the bed
  // FALL_RADIUS ahead of the new place, or at the place itself, is above the foot.
  const sx = Math.sign(f.vx), sz = Math.sign(f.vz);
  // The diagonal point guards a convex rock corner the two axis probes slip past: a hit undoes the step and zeroes both speeds.
  const R = FALL_RADIUS, ox = f.x, oz = f.z;
  const nx = f.x + f.vx * dt;
  if (f.vx !== 0 && (bed(nx, f.z) > y || bed(nx + sx * R, f.z) > y)) f.vx = 0; else f.x = nx;
  const nz = f.z + f.vz * dt;
  if (f.vz !== 0 && (bed(f.x, nz) > y || bed(f.x, nz + sz * R) > y)) f.vz = 0; else f.z = nz;
  if (bed(f.x, f.z) > y || (f.vx !== 0 && f.vz !== 0 && bed(f.x + sx * R, f.z + sz * R) > y)) { f.x = ox; f.z = oz; f.vx = 0; f.vz = 0; }
  // A body that overlaps a wall (a narrow chasm, a sink spot near a bank) eases away from the side that hit (toward the cell's centre
  // line when both sides hit), on that axis only, at RIM_PULL, never into rock. The four diagonal probes ease it away from a corner.
  const pull = RIM_PULL * dt;
  const away = (hitPlus: boolean, hitMinus: boolean, centre: number, at: number): number =>
    hitPlus && !hitMinus ? -pull : hitMinus && !hitPlus ? pull : Math.max(-pull, Math.min(pull, centre - at));
  const hx0 = bed(f.x + R, f.z) > y, hx1 = bed(f.x - R, f.z) > y, hz0 = bed(f.x, f.z + R) > y, hz1 = bed(f.x, f.z - R) > y;
  let ex = hx0 || hx1 ? away(hx0, hx1, f.cx, f.x) : 0, ez = hz0 || hz1 ? away(hz0, hz1, f.cz, f.z) : 0;
  for (const ix of [-1, 1]) {
    for (const iz of [-1, 1]) {
      if (bed(f.x + ix * R, f.z + iz * R) <= y) continue;
      if (ex === 0) ex = -ix * pull;
      if (ez === 0) ez = -iz * pull;
    }
  }
  if (ex !== 0 && bed(f.x + ex, f.z) <= y) f.x += ex;
  if (ez !== 0 && bed(f.x, f.z + ez) <= y) f.z += ez;
  const b = bed(f.x, f.z);
  if (y < b) { f.y = b; f.vy = 0; } else f.y = y;
  return f.y > -FALL_GONE;
}

/** A drowning foot: from y0 to the bed over DROWN_SINK (ease-in, u squared: it drops), then it rests on the bed until `Died`. */
export function drownY(y0: number, bed: number, age: number): number {
  const u = Math.min(1, Math.max(0, age / DROWN_SINK));
  if (u >= 1) return bed;
  return y0 + (bed - y0) * u * u;
}

/** The slow sink in lava: toward `goal` (`lavaSinkOf` the height on a lava tile, 0 off it) at LAVA_IN per second on lava, at LAVA_OUT otherwise (1 - exp(-rate * dt) easing). */
export function stepLavaSink(sink: number, goal: number, dt: number): number {
  const rate = goal > 0 ? LAVA_IN : LAVA_OUT;
  return sink + (goal - sink) * (1 - Math.exp(-rate * dt));
}

/** Where a grounded foot stands: on the bed, or floating in lava at LAVA_LEVEL - sink when that is higher. `sink` null: not in lava. */
export function standY(bed: number, sink: number | null): number {
  return sink === null ? bed : Math.max(bed, LAVA_LEVEL - sink);
}
