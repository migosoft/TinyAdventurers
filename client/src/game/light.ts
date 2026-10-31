// Light sources for drawing. Static and moving lights use the same shadowcast as
// server/src/run/light.rs (checked by fixtures), so a tile the server counts
// as lit is never drawn fully black (the light fades out inside its lit
// tiles, never beyond them). Colours mix additively. Knows nothing about
// torches or lava: only light kinds, colours and tiles.
import { LIGHT } from '../generated/defs';
import type { LightInfo } from '../generated/LightInfo';
import { Fov } from '../sim/fov';
import type { TileMap } from '../sim/map';

export interface StaticLight {
  id: number;
  kind: number;
  colour: number;
  /** Tile coordinates. */
  x: number;
  y: number;
  on: boolean;
}

interface Cells {
  idx: Int32Array;
  fall: Float32Array;
}

/** Brightness at the edge of a light's radius: near black, so the light fades out inside its lit tiles. */
export const EDGE = 0.1;

/** Brightness at distance `d` (tiles) from a light of radius `r`: 1 at the centre, a smoothstep down to `EDGE` at the edge. */
export function falloff(d: number, r: number): number {
  const k = Math.min(1, d / r);
  return 1 - (1 - EDGE) * k * k * (3 - 2 * k);
}

/** Dims a falloff value by `k` (1 = none) towards `EDGE` only: the rim stays at `EDGE`, so the lit area never shrinks. */
export function cloudy(fall: number, k: number): number {
  return EDGE + (fall - EDGE) * k;
}

/** Adds `colour` (0xRRGGBB) times `k` to tile `i` of an rgb buffer (no cap: the drawer caps at 255). */
export function addColour(rgb: Float32Array, i: number, colour: number, k: number): void {
  rgb[i * 3] += ((colour >> 16) & 255) * k;
  rgb[i * 3 + 1] += ((colour >> 8) & 255) * k;
  rgb[i * 3 + 2] += (colour & 255) * k;
}

export class LightField {
  readonly lights = new Map<number, StaticLight>();
  private cells = new Map<number, Cells>();
  private fov: Fov;
  private lit: Uint8Array;
  private litDirty = true;

  constructor(private map: TileMap) {
    this.fov = new Fov(map.w, map.h);
    this.lit = new Uint8Array(map.w * map.h);
  }

  load(infos: LightInfo[]): void {
    for (const [id, kind, colour, x, y, on] of infos) this.add({ id, kind, colour, x, y, on });
  }

  add(l: StaticLight): void {
    this.lights.set(l.id, { ...l });
    this.cells.delete(l.id);
    this.litDirty = true;
  }

  set(id: number, on: boolean, colour: number): void {
    const l = this.lights.get(id);
    if (!l) return;
    l.on = on;
    l.colour = colour;
    this.litDirty = true;
  }

  remove(id: number): void {
    this.lights.delete(id);
    this.cells.delete(id);
    this.litDirty = true;
  }

  /** A tile changed (door, lava): every shadowcast is redone lazily. */
  mapChanged(): void {
    this.cells.clear();
    this.litDirty = true;
  }

  private cellsOf(l: StaticLight): Cells {
    let c = this.cells.get(l.id);
    if (c) return c;
    const r = LIGHT[l.kind].radius;
    this.fov.compute(this.map, l.x, l.y, r);
    const idx: number[] = [];
    const fall: number[] = [];
    for (let y = Math.max(0, l.y - r); y <= Math.min(this.map.h - 1, l.y + r); y++)
      for (let x = Math.max(0, l.x - r); x <= Math.min(this.map.w - 1, l.x + r); x++)
        if (this.fov.isVisible(x, y)) {
          idx.push(y * this.map.w + x);
          fall.push(falloff(Math.hypot(x - l.x, y - l.y), r));
        }
    c = { idx: Int32Array.from(idx), fall: Float32Array.from(fall) };
    this.cells.set(l.id, c);
    return c;
  }

  /** Lit by a static light (same set as the server's static layer). */
  isLit(x: number, y: number): boolean {
    if (this.litDirty) {
      this.lit.fill(0);
      for (const l of this.lights.values()) if (l.on) for (const i of this.cellsOf(l).idx) this.lit[i] = 1;
      this.litDirty = false;
    }
    return x >= 0 && y >= 0 && x < this.map.w && y < this.map.h && this.lit[y * this.map.w + x] === 1;
  }

  /** Adds every lit static light's colour into `rgb` (`dim` 0..1 dims a light's centre, never its rim) (w*h*3) inside the tile window [x0,x1)×[y0,y1). */
  accumulate(rgb: Float32Array, x0: number, y0: number, x1: number, y1: number, scale: (l: StaticLight) => number, dim: (l: StaticLight) => number = () => 1): void {
    const w = this.map.w;
    for (const l of this.lights.values()) {
      if (!l.on) continue;
      const r = LIGHT[l.kind].radius;
      if (l.x + r < x0 || l.x - r >= x1 || l.y + r < y0 || l.y - r >= y1) continue;
      const k = LIGHT[l.kind].intensity * scale(l);
      const d = dim(l);
      const c = this.cellsOf(l);
      for (let j = 0; j < c.idx.length; j++) {
        const i = c.idx[j];
        const x = i % w;
        const y = (i - x) / w;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) addColour(rgb, i, l.colour, k * cloudy(c.fall[j], d));
      }
    }
  }

  /** A moving light at pixel position (px, py) as sent: shadowcast from its tile (the server's `light_tile`), colour into `rgb`, lit tiles marked in `lit`. */
  addMoving(rgb: Float32Array, lit: Uint8Array, px: number, py: number, kind: number, colour: number, k: number, tile: number): void {
    const r = LIGHT[kind].radius;
    const cx = Math.floor(px / tile);
    const cy = Math.floor(py / tile);
    this.fov.compute(this.map, cx, cy, r);
    for (let y = Math.max(0, cy - r); y <= Math.min(this.map.h - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(this.map.w - 1, cx + r); x++) {
        if (!this.fov.isVisible(x, y)) continue;
        const i = y * this.map.w + x;
        lit[i] = 1;
        const d = Math.hypot(x + 0.5 - px / tile, y + 0.5 - py / tile);
        addColour(rgb, i, colour, LIGHT[kind].intensity * k * falloff(d, r));
      }
  }
}
