// The air of the 3D view (#307): dust and pollen, smoke, embers and drips simulated on the CPU in world tiles with height, a port
// of game/mood.ts and mood-drips.ts. It owns the 2D `Wind` (px units: x = tiles * 16, y = z * 16) and writes `AirParts`, reused
// arrays the renderer draws as camera-facing quads. No three.js, no GPU: every rule is tested here.
import type { AirMover, AirShot } from '../../game/airTypes';
import { TERRAIN } from '../../game/terrain-layers';
import { Wind } from '../../game/wind';
import type { TileMap } from '../../sim/map';
import type { Footprint } from '../lights';
import type { Light } from '../light';
import type { SightMask } from '../sightmask';
import { MARGIN, PX, hidden, type AirCtx, type AirOn } from './airCtx';
import { newParts, type AirParts } from './airParts';
import type { Crack } from './cracks';
import { Drips } from './drips';
import { Dust } from './dust';
import { Puffs } from './puffs';

export type { AirOn } from './airCtx';
export { airLightAt } from './airLight';
export { newParts } from './airParts';
export type { AirParts } from './airParts';

export interface AirInput {
  dt: number;
  t: number;
  fp: Footprint;
  mask: SightMask | null;
  /** Flame foot on the wall (x, z), its normal, and its floor tile. */
  torches: readonly { x: number; z: number; nx: number; nz: number; lit: boolean; tx: number; tz: number }[];
  /** px, as 2D. */
  shots: readonly AirShot[];
  movers: readonly AirMover[];
  lights: readonly Light[];
  cracks: readonly Crack[];
  on: AirOn;
  /** Seconds a stirred cloud waits before it respawns. */
  respawn: number;
  /** Woodland: tiles/s added to every speck (WIND_DIR * POLLEN_DRIFT); null in a dungeon. */
  drift: [number, number] | null;
  /** `pollen`: dust only (no smoke, embers, drips). */
  kinds: 'dungeon' | 'pollen';
}

export class Air3d {
  private ctx: AirCtx;
  private dust: Dust;
  private puffs: Puffs;
  private drips: Drips;
  private parts = newParts();
  private lava: [number, number][] = [];
  private water: [number, number][] = [];
  /** The lava (seen) and water tiles in view this frame (reused). */
  private lavaNow: [number, number][] = [];
  private waterNow: [number, number][] = [];
  private view = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private map: TileMap, rng: () => number = Math.random) {
    const wind = new Wind((px, py) => map.hardOpaque(Math.floor(px / 16), Math.floor(py / 16)));
    this.ctx = {
      map, rng, wind, t: 0, fp: { x0: 0, z0: 0, x1: 0, z1: 0 }, mask: null, windOn: false, air: [0, 0],
      on: { dust: true, smoke: true, embers: true, drips: true, stir: true, draft: true },
    };
    this.dust = new Dust(this.ctx);
    this.puffs = new Puffs(this.ctx);
    this.drips = new Drips(rng);
    this.mapChanged();
  }

  /** Read-only counts, for tests and the F3 panel. */
  get counts(): { clouds: number; smoke: number; embers: number; drips: number; stirred: number } {
    return { clouds: this.dust.active, smoke: this.puffs.smokeCount, embers: this.puffs.emberCount, drips: this.drips.count, stirred: this.dust.stirred };
  }

  /** Terrain changed: collect the lava and water tiles again; the wind's walls too. Puffs already in the air die out by themselves. */
  mapChanged(): void {
    this.ctx.wind.wallsChanged();
    this.lava = [];
    this.water = [];
    const m = this.map;
    for (let z = 0; z < m.h; z++)
      for (let x = 0; x < m.w; x++) {
        const t = m.get(x, z);
        if (t === TERRAIN.Lava) this.lava.push([x, z]);
        else if (t === TERRAIN.Shallow || t === TERRAIN.Deep) this.water.push([x, z]);
      }
  }

  /** Advances the air by `i.dt` s and returns the frame's particles (the same arrays every call). */
  step(i: AirInput): AirParts {
    const c = this.ctx;
    const pollen = i.kinds === 'pollen';
    c.t = i.t;
    c.fp = i.fp;
    c.mask = i.mask;
    c.on = i.on;
    this.collect(pollen);
    this.puffs.emit(i.dt, { torches: pollen ? [] : i.torches, shots: pollen ? [] : i.shots }, this.lavaNow);
    this.stepWind(i);
    this.drips.step(i.dt, this.waterNow, i.on.drips && !pollen, this.parts);
    this.dust.step(i.dt, { lights: i.lights, cracks: i.cracks, drift: i.drift, pollen, respawn: i.respawn }, this.parts.specks);
    this.puffs.step(i.dt, this.parts);
    return this.parts;
  }

  /** Lava (seen) and water in view; none of either in a pollen world. */
  private collect(pollen: boolean): void {
    const c = this.ctx;
    this.lavaNow.length = 0;
    this.waterNow.length = 0;
    if (pollen) return;
    const { x0, x1, z0, z1 } = c.fp;
    const inside = (t: [number, number]) => t[0] + 1 > x0 - MARGIN && t[0] < x1 + MARGIN && t[1] + 1 > z0 - MARGIN && t[1] < z1 + MARGIN;
    for (const t of this.lava) if (inside(t) && !hidden(c, t[0] + 0.5, t[1] + 0.5)) this.lavaNow.push(t);
    for (const t of this.water) if (inside(t)) this.waterNow.push(t);
  }

  /** Movers on seen tiles in view push the air, then the wind moves on one step. Off entirely when neither stir nor draft is on. */
  private stepWind(i: AirInput): void {
    const c = this.ctx;
    c.windOn = i.on.stir || i.on.draft;
    if (!c.windOn) return;
    c.wind.draftOn = i.on.draft;
    const { x0, x1, z0, z1 } = i.fp;
    if (i.on.stir) {
      const lo = MARGIN / PX;
      for (const m of i.movers) {
        if (m.x < x0 / PX - lo || m.x > x1 / PX + lo || m.y < z0 / PX - lo || m.y > z1 / PX + lo || hidden(c, m.x * PX, m.y * PX)) continue;
        const ay = m.airY !== undefined && !this.map.hardOpaque(Math.floor(m.x / 16), Math.floor(m.airY / 16)) ? m.airY : m.y;
        if (m.shot) c.wind.wake(m.x, ay, m.vx, m.vy, m.r, m.heat);
        else c.wind.push(m.x, ay, m.vx, m.vy, m.r);
      }
    }
    const v = this.view;
    v.x = x0 / PX;
    v.y = z0 / PX;
    v.width = (x1 - x0) / PX;
    v.height = (z1 - z0) / PX;
    c.wind.step(i.dt, v);
  }
}
