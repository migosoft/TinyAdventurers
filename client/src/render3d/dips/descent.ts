import { CHASM_BED, LAVA_LEVEL } from './shape';
import { CONST, TILE_ID } from '../../generated/defs';
import type { TileMap } from '../../sim/map';

// First guesses for the user to tune; every number of the descent lives here.
export const FALL_G = 14, SLIDE_MAX = 3, RIM_PULL = 2, FALL_GONE = CHASM_BED - 0.5, FALL_MAX_AGE = 3;
export const LAVA_SINK = 1.05, LAVA_IN = 0.55, LAVA_OUT = 2.5;
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

/** One step. While the bed under it carries it (bed >= y): it is pulled toward (cx, cz) at RIM_PULL and stays on the bed. Else gravity; the sideways step is dropped (and the speed zeroed) when the bed at the new place is above the foot; at the end y is clamped to the bed at the final place, so the foot never ends below the ground. False once it is gone (y <= -FALL_GONE or age > FALL_MAX_AGE). */
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
  const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
  if (bed(nx, nz) > y) {
    f.vx = 0; f.vz = 0;
  } else {
    f.x = nx; f.z = nz;
  }
  const b = bed(f.x, f.z);
  if (y < b) { f.y = b; f.vy = 0; } else f.y = y;
  return f.y > -FALL_GONE;
}

/** A drowning foot: from y0 to the bed over DROWN_TIME with a smoothstep, then on the bed. */
export function drownY(y0: number, bed: number, age: number): number {
  const u = Math.min(1, Math.max(0, age / CONST.DROWN_TIME));
  if (u >= 1) return bed;
  return y0 + (bed - y0) * u * u * (3 - 2 * u);
}

/** The slow sink in lava: toward LAVA_SINK at LAVA_IN per second on a lava tile, toward 0 at LAVA_OUT otherwise (1 - exp(-rate * dt) easing). */
export function stepLavaSink(sink: number, inLava: boolean, dt: number): number {
  const target = inLava ? LAVA_SINK : 0;
  const rate = inLava ? LAVA_IN : LAVA_OUT;
  return sink + (target - sink) * (1 - Math.exp(-rate * dt));
}

/** Where a grounded foot stands: on the bed, or floating in lava at LAVA_LEVEL - sink when that is higher. `sink` null: not in lava. */
export function standY(bed: number, sink: number | null): number {
  return sink === null ? bed : Math.max(bed, LAVA_LEVEL - sink);
}
