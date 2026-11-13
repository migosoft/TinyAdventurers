// The sight mask on the CPU (#305): a small world-space field around the viewer with the unseen strength per texel in
// two channels, `hard` (beyond sight) and `soft` (behind a trunk or thicket). Later stages upload it as a texture and
// sample it in shaders. It is filled the way the 2D masks are (visionmask.ts, shademask.ts), with the same pure
// functions (game/sightField.ts), in float fields without a canvas.
import { blurField, canvasRes, extendPoints, extendRim, fillPolygon, rampLayers, type RasterScratch } from '../game/sightField';
import { TILE, type TileMap } from '../sim/map';
import type { View } from '../sim/view';
import { sightRadius } from '../sim/vispoly';

/** Tiles of mask beyond the sight radius on each side. */
export const SIGHT_MARGIN = 2;

/** Steps of the soft ramp from clear to full (as the 2D wedge). */
const RAMP_LAYERS = 4;

/** How a mask is filled: crisp black on dark maps, feathered mist on daylight maps. World px (DEFAULT_HAZE's on daylight, 0 and 0 on dark maps). */
export interface SightLook {
  daylight: boolean;
  feather: number;
  ramp: number;
}

/**
 * The texture covers n texels = n / res tiles a side: one texel more than `size`. That is the world side the GPU must
 * map the texture over (`sample` does); the square's origin is (ox, oz) tiles.
 */
export class SightMask {
  /** Texels per tile (canvasRes(daylight)). */
  readonly res: number;
  /** Whether this is a daylight (mist) mask. */
  readonly daylight: boolean;
  /** The square in tiles: its top-left corner and side. */
  ox = 0;
  oz = 0;
  size = 0;
  /** Texel count per side: `ceil(size * res) + 1` (one more than size * res, so the far edge is covered). */
  n = 0;
  /** RG8: r = hard * 255, g = soft * 255; length n * n * 2. Replaced (a new array) when n changes. */
  data = new Uint8Array(0);
  /** Bumped on every refill. */
  version = 0;

  private lastHard = -1;
  private lastAll = -1;
  private lastMap = NaN;
  private grey = new Float32Array(0);
  private tmp = new Float32Array(0);
  private clip = new Float32Array(0);
  private layer = new Float32Array(0);
  private soft = new Float32Array(0);
  private raster: RasterScratch = { xs: [], row: new Float32Array(0) };
  private clipPts: number[] = [];
  private rimPts: number[] = [];
  private grownPts: number[] = [];

  constructor(
    private map: TileMap,
    private look: SightLook,
  ) {
    this.res = canvasRes(look.daylight);
    this.daylight = look.daylight;
  }

  /** Refills when hard.version, all?.version or the map version differs from the last fill; returns whether it refilled. */
  update(hard: View, all: View | null, mapVersion: number): boolean {
    const allVersion = all ? all.version : -1;
    if (hard.version === this.lastHard && allVersion === this.lastAll && mapVersion === this.lastMap) return false;
    this.lastHard = hard.version;
    this.lastAll = allVersion;
    this.lastMap = mapVersion;
    this.fill(hard, all);
    this.version++;
    return true;
  }

  private fill(hard: View, all: View | null): void {
    const { res, map } = this;
    const { feather, ramp } = this.look;
    const vision = hard.r / TILE - 0.5;
    // on daylight maps the blur's tails reach 3 * feather px past the edge of sight; the margin keeps the border fully unseen
    const half = sightRadius(vision) / TILE + SIGHT_MARGIN + Math.ceil((3 * feather) / TILE);
    const cx = hard.px / TILE, cz = hard.py / TILE;
    this.size = 2 * half;
    this.ox = Math.floor((cx - half) * res) / res;
    this.oz = Math.floor((cz - half) * res) / res;
    const n = Math.ceil(this.size * res) + 1;
    if (n !== this.n) {
      this.n = n;
      this.data = new Uint8Array(n * n * 2);
      this.grey = new Float32Array(n * n);
      this.tmp = new Float32Array(n * n);
      this.clip = new Float32Array(n * n);
      this.layer = new Float32Array(n * n);
      this.soft = new Float32Array(n * n);
    }
    const count = n * n;
    const tx = this.ox * TILE, ty = this.oz * TILE, s = res / TILE;
    const { grey, raster } = this;

    // hard: the polygon in white, visible hard walls whole, then the feather
    grey.fill(0);
    fillPolygon(grey, n, n, hard.polygon.points, tx, ty, s, raster);
    // per tile, a row fill per texel row (as 2D's walls step): the texels of tile t are those with floor(o + (k + 0.5) / res) = t
    const first = (o: number, t: number): number => Math.max(0, Math.ceil((t - o) * res - 0.5));
    const t0x = Math.floor(this.ox + 0.5 / res), t1x = Math.floor(this.ox + (n - 0.5) / res);
    const t0z = Math.floor(this.oz + 0.5 / res), t1z = Math.floor(this.oz + (n - 0.5) / res);
    for (let tz = t0z; tz <= t1z; tz++) {
      const j0 = first(this.oz, tz), j1 = Math.min(n, first(this.oz, tz + 1));
      for (let tx2 = t0x; tx2 <= t1x; tx2++) {
        if (!map.hardOpaque(tx2, tz) || !hard.isVisible(tx2, tz)) continue;
        const i0 = first(this.ox, tx2), i1 = Math.min(n, first(this.ox, tx2 + 1));
        for (let j = j0; j < j1; j++) grey.fill(255, j * n + i0, j * n + i1);
      }
    }
    if (feather > 0) blurField(grey, n, n, Math.max(1, Math.round((feather * res) / TILE)), this.tmp);

    // soft: inside the hard polygon (clip) and the share outside the full one, over the ramp's layers
    const soft = this.soft;
    soft.fill(0);
    if (all) {
      const ext = Math.max(TILE, 3 * feather);
      this.clip.fill(0);
      fillPolygon(this.clip, n, n, extendRim(hard.polygon.points, hard.px, hard.py, hard.r, ext, this.clipPts), tx, ty, s, raster);
      const rim = extendRim(all.polygon.points, all.px, all.py, all.r, ext, this.rimPts);
      const layers = rampLayers(0, ramp, RAMP_LAYERS);
      for (const { depth } of layers) {
        this.layer.fill(0);
        fillPolygon(this.layer, n, n, extendPoints(rim, all.px, all.py, depth, this.grownPts), tx, ty, s, raster);
        for (let k = 0; k < count; k++) soft[k] += 1 - this.layer[k] / 255;
      }
      for (let k = 0; k < count; k++) soft[k] = (this.clip[k] / 255) * (soft[k] / layers.length);
    }

    const data = this.data;
    for (let k = 0; k < count; k++) {
      data[2 * k] = Math.round((1 - grey[k] / 255) * 255);
      data[2 * k + 1] = Math.round(Math.min(1, Math.max(0, soft[k])) * 255);
    }
  }

  /** Bilinear read at a ground point in tiles, matching the GPU's linear sampling with clamp-to-edge; outside the square: { hard: 1, soft: 0 }. */
  sample(x: number, z: number): { hard: number; soft: number } {
    const { n, res } = this;
    const u = (x - this.ox) * res, v = (z - this.oz) * res;
    if (n === 0 || u < 0 || v < 0 || u > n || v > n) return { hard: 1, soft: 0 };
    // texel centres lie at +0.5
    const fu = Math.min(n - 1, Math.max(0, u - 0.5)), fv = Math.min(n - 1, Math.max(0, v - 0.5));
    const i0 = Math.floor(fu), j0 = Math.floor(fv);
    const i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
    const a = fu - i0, b = fv - j0;
    const w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
    const d = this.data;
    const at = (c: number) =>
      (d[2 * (j0 * n + i0) + c] * w00 + d[2 * (j0 * n + i1) + c] * w10 + d[2 * (j1 * n + i0) + c] * w01 + d[2 * (j1 * n + i1) + c] * w11) / 255;
    return { hard: at(0), soft: at(1) };
  }
}

/** The offsets of a wide figure's extra probe points, as a share of its reach. */
const PROBE = 0.8;

/**
 * One value per thing: the least `hard` and `soft` of its foot and, when `reach` > 0.5 tile (the server's radius > 8 px),
 * the four points at ±0.8 reach.
 */
export function footSight(m: SightMask, x: number, z: number, reach: number): { hard: number; soft: number } {
  let { hard, soft } = m.sample(x, z);
  if (reach > 0.5) {
    const d = PROBE * reach;
    // the four diagonal corners, as the server's `visible` checks a wide figure
    for (const [dx, dz] of [[d, d], [-d, d], [d, -d], [-d, -d]]) {
      const p = m.sample(x + dx, z + dz);
      hard = Math.min(hard, p.hard);
      soft = Math.min(soft, p.soft);
    }
  }
  return { hard, soft };
}

/**
 * The `hard` a thing (card, glow, shadow) receives. On daylight masks the feather is centred on the edge of sight, so a
 * seen thing just inside it would read 0.2..0.5: only the outer half of the transition counts, `clamp((hard - 0.5) * 2)`,
 * so a seen figure at the edge has no fade and no mist. Dark masks are crisp: unchanged.
 */
export function thingHard(m: SightMask, hard: number): number {
  return m.daylight ? Math.min(1, Math.max(0, (hard - 0.5) * 2)) : hard;
}
