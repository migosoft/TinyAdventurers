// What a hero sees, tile by tile: open tiles the visibility polygon (vispoly.ts)
// reaches with any of 16 sample points, and walls by the tile FOV (fov.ts). The
// server's `vispoly.rs` holds the same rule (checked by the shared fixture), so
// the client lights exactly the floor the server sends monsters on.
import { Fov } from './fov';
import { TILE, type TileMap } from './map';
import { inside, sightPolygon, sightRadius, type SightPolygon } from './vispoly';

/** Sample points per tile side (4×4, 4 px apart, 2 px in from the edges). */
const SAMPLES = 4;

export class View {
  readonly fov: Fov;
  polygon: SightPolygon = { points: [], angles: [] };
  px = NaN;
  py = NaN;
  /** Counts computes, so a drawer can tell when to redraw. */
  version = 0;
  private stamp: Uint32Array;
  private gen = 0;

  constructor(
    public w: number,
    public h: number,
  ) {
    this.fov = new Fov(w, h);
    this.stamp = new Uint32Array(w * h);
  }

  /** The view from (px, py) with `vision` tiles (rounded). */
  compute(map: TileMap, px: number, py: number, vision: number): void {
    const v = Math.round(vision);
    const r = sightRadius(v);
    this.px = px;
    this.py = py;
    this.version++;
    this.gen = (this.gen + 1) >>> 0 || 1;
    this.fov.compute(map, Math.floor(px / TILE), Math.floor(py / TILE), v);
    this.polygon = sightPolygon(map, px, py, r);
    const x0 = Math.max(0, Math.floor((px - r) / TILE));
    const y0 = Math.max(0, Math.floor((py - r) / TILE));
    const x1 = Math.min(this.w - 1, Math.floor((px + r) / TILE));
    const y1 = Math.min(this.h - 1, Math.floor((py + r) / TILE));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (map.opaque(x, y) ? this.fov.isVisible(x, y) : this.covered(x, y)) this.stamp[y * this.w + x] = this.gen;
  }

  /** Any of the tile's 16 sample points inside the polygon. */
  private covered(x: number, y: number): boolean {
    for (let j = 0; j < SAMPLES; j++)
      for (let i = 0; i < SAMPLES; i++) if (inside(this.polygon, this.px, this.py, x * TILE + 2 + 4 * i, y * TILE + 2 + 4 * j)) return true;
    return false;
  }

  isVisible(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.stamp[y * this.w + x] === this.gen;
  }
}
