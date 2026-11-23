// The game's own lights as the 3D view's per-frame light list (#304): static lights from the session's LightField (torches at
// their flame), moving lights from the snapshot (tied to the entity that carries them), and the choice of the most important
// ones for the shader's slots. Pure numbers; the shader side is in lightNodes.ts.
import { LIGHT, LIGHT_KIND, TILE_ID } from '../generated/defs';
import type { EntSnap } from '../generated/EntSnap';
import type { MovingLight } from '../generated/MovingLight';
import type { LightField } from '../game/light';
import { cloudAt, lookFor, sunLook, type SunLook } from '../game/sunmath';
import type { EntState } from '../game/world';
import type { TileMap } from '../sim/map';
import { groundAt, type Cam } from './camera';
import { WALL_H, wallOf } from './heights';
import type { Light } from './light';
import { flameMid } from './torch/torch';
import { CRYSTAL_RATE, CRYSTAL_STAND, CRYSTAL_Y } from './stone/crystals';

/** The swing of a crystal light's slow pulse (a torch's flicker swings by up to 0.16; first guess). */
export const CRYSTAL_PULSE = 0.06;

/** A light's colour is scaled by this on its way to the shader (first guess). */
export const LIGHT_GAIN = 1.2;
/** How far past the game's falloff radius the shader's light reaches, in tiles (first guess). */
export const LIGHT_MARGIN = 0.5;
/** Height of the Daylight bounce fill (the faint light where a crack's patch bounces off the floor) and of a Blast's flash, in tiles (first guesses). */
export const BOUNCE_Y = 0.7;
/** The bounce fill's share of the Daylight light's colour (first guess). */
export const BOUNCE_GAIN = 0.35;
export const FLASH_Y = 1;
/** A moving light is carried by the snapshot entity within this many px of it. */
export const CARRY_PX = 2;
/** The slots of the shader's caster list (first guess). */
export const CASTER_CAP = 16;
/** Height of other static lights and of an uncarried moving light, in tiles. */
const STATIC_Y = 1;
const MOVING_Y = 0.5;
const TILE = 16;

/** The flicker of a light of `kind` at time `t` (s): the torch's three sines, scaled by the kind's flicker against the torch's. */
export function lightFlicker(kind: number, t: number, phase: number): number {
  // a crystal does not flicker: it pulses slowly (#380)
  if (kind === LIGHT_KIND.Crystal) return 1 + CRYSTAL_PULSE * Math.sin(CRYSTAL_RATE * t + phase);
  const s = LIGHT[kind].flicker / LIGHT[LIGHT_KIND.Torch].flicker;
  return 1 + s * (0.07 * Math.sin(11 * t + phase) + 0.05 * Math.sin(23.3 * t + 2 * phase) + 0.04 * Math.sin(5.1 * t + 3 * phase));
}

/** A light's colour for the shader: its 0xRRGGBB colour (or the kind's), the kind's intensity, `LIGHT_GAIN` and `k`. */
export function lightRgb(kind: number, colour: number | null, k: number): [number, number, number] {
  const c = colour ?? LIGHT[kind].colour;
  const m = (LIGHT[kind].intensity * LIGHT_GAIN * k) / 255;
  return [((c >> 16) & 255) * m, ((c >> 8) & 255) * m, (c & 255) * m];
}

/** The wall point a torch entity hangs at, the wall's normal (into the room) and the floor tile of its light. */
export function torchOf(e: EntState): { x: number; z: number; nx: number; nz: number; tx: number; tz: number } {
  const x = e.x / TILE;
  const z = e.y / TILE;
  const [wx, wz, nx, nz] = e.extra === 0 ? [x, Math.floor(z), 0, 1] : e.extra === 1 ? [Math.floor(x), z, 1, 0] : [Math.floor(x) + 1, z, -1, 0];
  return { x: wx, z: wz, nx, nz, tx: Math.floor(x), tz: Math.floor(z) };
}

/** A figure that casts a shadow (Task 6 of #304 fills it): its box in the world (centre x, z, width, y range) and its frame in the atlas. */
export interface ShadowCaster { id: number; x: number; z: number; w: number; y0: number; y1: number; u0: number; v0: number; u1: number; v1: number }

/** A light that may enter the list: its id is stable (`s<lightId>`, `m<entityId>` or `m<n>`). */
export interface Cand extends Light { id: string; kind: number; /** The entity that carries the light (its own card must not shadow it), -1 for none. */ carrier: number; /** The brightness without flicker: what `selectLights` ranks by, so the choice does not flutter. */ base: number }

/**
 * Every light of the field that is on, except lava (its glow is the ground's own). Torches sit at their flame. A Daylight light is
 * the **bounce fill**: the crack (air/cracks.ts) lights its own patch, this faint light at `BOUNCE_Y` is what that patch bounces
 * into the room. It dims with the crack's cloud, `base` is its unclouded brightness. `sun` is the sun look the cracks use.
 */
export function staticCands(field: LightField, t: number, sun: SunLook = sunLook): Cand[] {
  const out: Cand[] = [];
  for (const l of field.lights.values()) {
    if (!l.on || l.kind === LIGHT_KIND.Lava) continue;
    let x = l.x + 0.5;
    let y = STATIC_Y;
    let z = l.y + 0.5;
    let ph = l.id * 1.7;
    if (l.kind === LIGHT_KIND.Torch) {
      [x, y, z] = flameMid(wallOf(l));
      x += 0.03 * Math.sin(13 * t + ph);
      y += 0.03 * Math.sin(17 * t + ph);
    } else if (l.kind === LIGHT_KIND.Crystal) {
      // at its cluster (stone/place.ts stands the big shard at the same wall), low at the wall's foot
      const w = wallOf(l);
      x = w.x + w.nx * CRYSTAL_STAND;
      z = w.z + w.nz * CRYSTAL_STAND;
      y = CRYSTAL_Y;
    } else if (l.kind === LIGHT_KIND.Daylight) y = BOUNCE_Y;
    const bounce = l.kind === LIGHT_KIND.Daylight ? BOUNCE_GAIN : 1;
    const cloud = l.kind === LIGHT_KIND.Daylight ? cloudAt(l.id, t, lookFor(l.id, sun)) : 1;
    const [r, g, b] = lightRgb(l.kind, l.colour, lightFlicker(l.kind, t, ph) * bounce * cloud);
    const base = Math.max(...lightRgb(l.kind, l.colour, bounce));
    out.push({ id: `s${l.id}`, kind: l.kind, carrier: -1, x, y, z, radius: LIGHT[l.kind].radius, r, g, b, shadow: true, skip: -1, base });
  }
  return out;
}

/** A light's carrier as drawn: its id, drawn position (tiles) and the height of its card's centre. */
export interface Carrier { id: number; x: number; z: number; y: number }

/** The snapshot's moving lights as candidates, each tied to the nearest entity within `CARRY_PX` and moving with its drawn figure. */
export function movingCands(moving: readonly MovingLight[], snapEnts: readonly EntSnap[], drawn: (id: number) => Carrier | null, t: number): Cand[] {
  const out: Cand[] = [];
  const used = new Map<string, number>();
  /** The first light of a name keeps it; later ones get `.1`, `.2` in snapshot order. */
  const unique = (name: string): string => {
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    return n === 0 ? name : `${name}.${n}`;
  };
  for (const [px, py, kind, colour] of moving) {
    let best: EntSnap | null = null;
    let bd = CARRY_PX;
    for (const e of snapEnts) {
      const d = Math.hypot(e[2] - px, e[3] - py);
      if (d <= bd) {
        bd = d;
        best = e;
      }
    }
    const car = best ? drawn(best[0]) : null;
    let id: string;
    let x: number;
    let y: number;
    let z: number;
    let ph: number;
    if (best && car) {
      id = unique(`m${best[0]}`);
      x = car.x + (px - best[2]) / TILE;
      z = car.z + (py - best[3]) / TILE;
      y = car.y;
      ph = best[0] * 1.7;
    } else {
      id = unique(best ? `m${best[0]}` : `p${kind}:${Math.round(px)}:${Math.round(py)}`);
      x = px / TILE;
      z = py / TILE;
      y = kind === LIGHT_KIND.Blast ? FLASH_Y : MOVING_Y;
      ph = best ? best[0] * 1.7 : kind * 3.1 + px * 0.13 + py * 0.29;
    }
    const [r, g, b] = lightRgb(kind, colour, lightFlicker(kind, t, ph));
    const base = Math.max(...lightRgb(kind, colour, 1));
    out.push({ id, kind, carrier: best ? best[0] : -1, x, y, z, radius: LIGHT[kind].radius, r, g, b, shadow: true, skip: -1, base });
  }
  return out;
}

/** The ground the screen shows, as an axis-aligned box in tiles. */
export interface Footprint { x0: number; z0: number; x1: number; z1: number }

/** The box around the ground under the four screen corners (the view is `halfW` x `halfH` tiles from the camera target). */
export function footprint(cam: Cam, halfW: number, halfH: number): Footprint {
  const pts = [groundAt(cam, -halfW, -halfH), groundAt(cam, halfW, -halfH), groundAt(cam, -halfW, halfH), groundAt(cam, halfW, halfH)];
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    x1: Math.max(...pts.map((p) => p.x)),
    z0: Math.min(...pts.map((p) => p.z)),
    z1: Math.max(...pts.map((p) => p.z)),
  };
}

/**
 * The footprint plus the ground under what stands up to `top` tiles on it and shows above the screen's bottom edge: such a thing
 * stands top / tan(pitch) nearer the camera than the edge, so the box grows that far toward the camera (and only there).
 */
export function raised(fp: Footprint, cam: Cam, top: number): Footprint {
  const k = top / Math.tan(cam.pitch);
  const dx = -Math.sin(cam.yaw) * k;
  const dz = Math.cos(cam.yaw) * k;
  return { x0: Math.min(fp.x0, fp.x0 + dx), x1: Math.max(fp.x1, fp.x1 + dx), z0: Math.min(fp.z0, fp.z0 + dz), z1: Math.max(fp.z1, fp.z1 + dz) };
}

/**
 * The ground whose lights the screen can show (#326): the footprint raised to the wall tops, so a torch just below the bottom
 * edge stays in the list while a wall top it lights is on screen.
 */
export function lightView(fp: Footprint, cam: Cam): Footprint {
  return raised(fp, cam, WALL_H);
}

/** The lights that reach the footprint (reach = radius + `LIGHT_MARGIN`), most important first, at most `cap`; `inView` counts all that reach. */
export function selectLights(cands: readonly Cand[], fp: Footprint, focus: { x: number; z: number }, cap: number): { list: Cand[]; inView: number } {
  const scored: { c: Cand; score: number }[] = [];
  for (const c of cands) {
    const reach = c.radius + LIGHT_MARGIN;
    const w = Math.min(c.x + reach, fp.x1) - Math.max(c.x - reach, fp.x0);
    const h = Math.min(c.z + reach, fp.z1) - Math.max(c.z - reach, fp.z0);
    if (w <= 0 || h <= 0) continue;
    const share = (w * h) / ((2 * reach) * (2 * reach));
    const near = Math.hypot(focus.x - c.x, focus.z - c.z) <= reach ? 1.5 : 1;
    scored.push({ c, score: c.base * share * near });
  }
  scored.sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  return { list: scored.slice(0, cap).map((s) => s.c), inView: scored.length };
}

/**
 * The casters within reach of a light of the list (horizontal distance to its position at most radius + `LIGHT_MARGIN`), nearest to
 * any such light first, ties by id, at most `cap`. The result is the shader's slot order.
 */
export function selectCasters(casters: readonly ShadowCaster[], lights: readonly Cand[], cap: number): ShadowCaster[] {
  const scored: { c: ShadowCaster; d: number }[] = [];
  for (const c of casters) {
    let best = Infinity;
    for (const l of lights) {
      const d = Math.hypot(c.x - l.x, c.z - l.z);
      if (d <= l.radius + LIGHT_MARGIN && d < best) best = d;
    }
    if (best < Infinity) scored.push({ c, d: best });
  }
  scored.sort((a, b) => a.d - b.d || a.c.id - b.c.id);
  return scored.slice(0, Math.max(0, cap)).map((s) => s.c);
}

/** Sets each light's `skip` to the slot (in `slots`) of its carrier, -1 when it has none or the carrier casts no shadow in this list. */
export function assignSkips(lights: Cand[], slots: readonly ShadowCaster[]): void {
  for (const l of lights) l.skip = l.carrier < 0 ? -1 : slots.findIndex((c) => c.id === l.carrier);
}

/** The lava lights as one texel per tile (rgba, `map.w * map.h * 4`): rgb the summed Lava lights over the whole map, alpha 1 on lava tiles (#304). */
export function lavaTexels(field: LightField, map: TileMap, out: Float32Array): void {
  const n = map.w * map.h;
  const rgb = new Float32Array(n * 3);
  field.accumulate(rgb, 0, 0, map.w, map.h, () => 1, () => 1, (l) => l.kind === LIGHT_KIND.Lava);
  for (let i = 0; i < n; i++) {
    out[i * 4] = (rgb[i * 3] / 255) * LIGHT_GAIN;
    out[i * 4 + 1] = (rgb[i * 3 + 1] / 255) * LIGHT_GAIN;
    out[i * 4 + 2] = (rgb[i * 3 + 2] / 255) * LIGHT_GAIN;
    out[i * 4 + 3] = map.tiles[i] === TILE_ID.Lava ? 1 : 0;
  }
}
