// The game's own lights as the 3D view's per-frame light list (#304): static lights from the session's LightField (torches at
// their flame), moving lights from the snapshot (tied to the entity that carries them), and the choice of the most important
// ones for the shader's slots. Pure numbers; the shader side is in lightNodes.ts.
import { LIGHT, LIGHT_KIND } from '../generated/defs';
import type { EntSnap } from '../generated/EntSnap';
import type { MovingLight } from '../generated/MovingLight';
import type { LightField, StaticLight } from '../game/light';
import type { EntState } from '../game/world';
import type { TileMap } from '../sim/map';
import { groundAt, type Cam } from './camera';
import { TORCH_MID } from './figures';
import type { Light } from './light';

/** A light's colour is scaled by this on its way to the shader (first guess). */
export const LIGHT_GAIN = 1.2;
/** How far past the game's falloff radius the shader's light reaches, in tiles (first guess). */
export const LIGHT_MARGIN = 0.5;
/** Height of a Daylight light (a sun far above the room), of a Blast's flash, in tiles (first guesses). */
export const DAYLIGHT_Y = 6;
export const FLASH_Y = 1;
/** A moving light is carried by the snapshot entity within this many px of it. */
export const CARRY_PX = 2;
/** Where a torch's light sits in front of its wall, in tiles. */
const TORCH_STAND = 0.1;
/** Height of other static lights and of an uncarried moving light, in tiles. */
const STATIC_Y = 1;
const MOVING_Y = 0.5;
const TILE = 16;

/** The flicker of a light of `kind` at time `t` (s): the torch's three sines, scaled by the kind's flicker against the torch's. */
export function lightFlicker(kind: number, t: number, phase: number): number {
  const s = LIGHT[kind].flicker / LIGHT[LIGHT_KIND.Torch].flicker;
  return 1 + s * (0.07 * Math.sin(11 * t + phase) + 0.05 * Math.sin(23.3 * t + 2 * phase) + 0.04 * Math.sin(5.1 * t + 3 * phase));
}

/** A light's colour for the shader: its 0xRRGGBB colour (or the kind's), the kind's intensity, `LIGHT_GAIN` and `k`. */
export function lightRgb(kind: number, colour: number | null, k: number): [number, number, number] {
  const c = colour ?? LIGHT[kind].colour;
  const m = (LIGHT[kind].intensity * LIGHT_GAIN * k) / 255;
  return [((c >> 16) & 255) * m, ((c >> 8) & 255) * m, (c & 255) * m];
}

/** A torch's flame on its wall: the point on the wall face, the face's normal (into the room) and the flame's flicker phase. */
export interface TorchWall { x: number; z: number; nx: number; nz: number; phase: number }

/** Pairs the static torch lights with the torch entities the session has seen (the light only knows its tile, the entity its side). */
export class TorchPairs {
  private seen = new Map<string, TorchWall>();

  /** Remembers a torch entity under its light tile, as `drawTorch` places its flame. */
  see(e: EntState): void {
    const x = e.x / TILE;
    const z = e.y / TILE;
    const [wx, wz, nx, nz] = e.extra === 0 ? [x, Math.floor(z), 0, 1] : e.extra === 1 ? [Math.floor(x), z, 1, 0] : [Math.floor(x) + 1, z, -1, 0];
    this.seen.set(`${Math.floor(x)},${Math.floor(z)}`, { x: wx, z: wz, nx, nz, phase: e.id * 1.7 });
  }

  /** The remembered pair of a light, else a guess from the walls beside its tile (north, west, east; none: the tile centre). */
  wallOf(l: StaticLight, map: TileMap): TorchWall {
    const known = this.seen.get(`${l.x},${l.y}`);
    if (known) return known;
    const phase = l.id * 1.7;
    if (map.opaque(l.x, l.y - 1)) return { x: l.x + 0.5, z: l.y, nx: 0, nz: 1, phase };
    if (map.opaque(l.x - 1, l.y)) return { x: l.x, z: l.y + 0.5, nx: 1, nz: 0, phase };
    if (map.opaque(l.x + 1, l.y)) return { x: l.x + 1, z: l.y + 0.5, nx: -1, nz: 0, phase };
    return { x: l.x + 0.5, z: l.y + 0.5, nx: 0, nz: 0, phase };
  }
}

/** A light that may enter the list: its id is stable (`s<lightId>`, `m<entityId>` or `m<n>`). */
export interface Cand extends Light { id: string; kind: number; /** The brightness without flicker: what `selectLights` ranks by, so the choice does not flutter. */ base: number }

/** Every light of the field that is on, except lava (its glow is the ground's own). Torches sit at their flame. */
export function staticCands(field: LightField, torches: TorchPairs, map: TileMap, t: number): Cand[] {
  const out: Cand[] = [];
  for (const l of field.lights.values()) {
    if (!l.on || l.kind === LIGHT_KIND.Lava) continue;
    let x = l.x + 0.5;
    let y = STATIC_Y;
    let z = l.y + 0.5;
    let ph = l.id * 1.7;
    if (l.kind === LIGHT_KIND.Torch) {
      const w = torches.wallOf(l, map);
      ph = w.phase;
      x = w.x + w.nx * TORCH_STAND + 0.03 * Math.sin(13 * t + ph);
      z = w.z + w.nz * TORCH_STAND;
      y = TORCH_MID + 0.03 * Math.sin(17 * t + ph);
    } else if (l.kind === LIGHT_KIND.Daylight) y = DAYLIGHT_Y;
    const [r, g, b] = lightRgb(l.kind, l.colour, lightFlicker(l.kind, t, ph));
    const base = Math.max(...lightRgb(l.kind, l.colour, 1));
    out.push({ id: `s${l.id}`, kind: l.kind, x, y, z, radius: LIGHT[l.kind].radius, r, g, b, shadow: true, skip: -1, base });
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
    out.push({ id, kind, x, y, z, radius: LIGHT[kind].radius, r, g, b, shadow: true, skip: -1, base });
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
