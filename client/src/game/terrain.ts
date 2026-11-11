// Water, lava and chasms on the board. The tiles are generated at atlas build
// time from pack colours (client/scripts/terrain-tiles.ts): an animated base
// texture per cell plus an edge overlay (bank face, rims, rounded corners)
// picked from the cell's eight neighbours. Lava also glows (runtime effect).
import Phaser from 'phaser';
import { TERRAIN_FRAMES, TERRAIN_PERIOD, type TerrainSet } from './terrain-codes';
import { isWater, TERRAIN, TERRAIN_FPS, terrainLayers } from './terrain-layers';
import { DEPTH, type Effects } from './effects';
import { TILE, type TileMap } from '../sim/map';

export { TERRAIN, speedFactor, sinkDepth, terrainLayers, TERRAIN_FPS } from './terrain-layers';

/** Splashes on entering water or lava, ripples while wading, embers on a burning hero. One per figure. */
export class WadeFx {
  private lastTile = 0;
  private rippleT = 0;

  update(fx: Effects, x: number, y: number, tile: number, dashing: boolean, moving: boolean, burns: boolean, dt: number): void {
    const wet = isWater(tile);
    const lava = tile === TERRAIN.Lava;
    if (!dashing && tile !== this.lastTile && (wet || lava)) fx.burst(x, y - 2, 6, wet ? 0x72d6ce : 0xee8e2e, 30, 0.35);
    if (dashing && (wet || lava) && Math.random() < 0.5) fx.particle(x, y - 2, (Math.random() - 0.5) * 30, -20, 0.3, wet ? 0xcae6f5 : 0xfacb3e);
    this.lastTile = tile;
    this.rippleT -= dt;
    if (!dashing && wet && moving && this.rippleT <= 0) {
      this.rippleT = 0.35;
      fx.ring(x, y - 1, 5, 0x72d6ce, 0.5);
    }
    if (!dashing && lava && burns && Math.random() < dt * 14)
      fx.particle(x + (Math.random() - 0.5) * 8, y - Math.random() * 10, 0, -18 - Math.random() * 10, 0.4, Math.random() < 0.5 ? 0xffcc68 : 0xee8e2e);
  }
}

/** The moment a figure goes over the edge of a chasm, or under in deep water. */
export function sinkStartFx(fx: Effects, x: number, y: number, drown: boolean): void {
  if (!drown) fx.burst(x, y - 4, 6, 0x775c55, 25, 0.4);
  else {
    fx.burst(x, y - 3, 14, 0xcae6f5, 45, 0.45);
    fx.ring(x, y - 1, 9, 0x72d6ce, 0.6);
  }
}

/** Bubbles rising where a figure went down in deep water. */
export function bubbleFx(fx: Effects, x: number, y: number, dt: number): void {
  if (Math.random() < dt * 12) fx.particle(x + (Math.random() - 0.5) * 8, y - 2 - Math.random() * 4, 0, -10, 0.35, 0xcae6f5);
}
interface Animated {
  img: Phaser.GameObjects.Image;
  set: TerrainSet;
  q: number;
}

/** Draws all terrain cells of a map and animates the surfaces. */
export class TerrainLayer {
  private animated: Animated[] = [];
  private glows: { img: Phaser.GameObjects.Image; ph: number }[] = [];
  private lava: [number, number][] = [];
  private clock = 0;

  constructor(
    scene: Phaser.Scene,
    map: TileMap,
    private fx?: Effects,
  ) {
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const { base, edges } = terrainLayers(map, x, y);
        for (const set of base) {
          const p = TERRAIN_PERIOD[set];
          const q = (x % p) + p * (y % p);
          const img = scene.add.image(x * TILE, y * TILE, 'atlas', `terrain_${set}_f0_q${q}`).setOrigin(0).setDepth(DEPTH.map + 0.2);
          if (TERRAIN_FRAMES[set] > 1) this.animated.push({ img, set, q });
        }
        for (const e of edges) scene.add.image(x * TILE, y * TILE, 'atlas', e).setOrigin(0).setDepth(DEPTH.map + 0.3);
        if (map.get(x, y) === TERRAIN.Lava) {
          this.lava.push([x, y]);
          // Soft light over the lava and the ground next to it.
          const glow = scene.add
            .image(x * TILE + 8, y * TILE + 8, 'glow')
            .setTint(0xff4818)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setScale(4.5)
            .setDepth(DEPTH.hazard);
          this.glows.push({ img: glow, ph: (x * 7 + y * 13) % 10 });
        }
      }
  }

  update(dt: number): void {
    this.clock += dt;
    for (const a of this.animated) {
      const f = Math.floor(this.clock * TERRAIN_FPS[a.set]) % TERRAIN_FRAMES[a.set];
      a.img.setFrame(`terrain_${a.set}_f${f}_q${a.q}`);
    }
    for (const g of this.glows) g.img.setAlpha(0.18 + 0.06 * Math.sin(this.clock * 2 + g.ph));
    // Embers rising from the lava now and then.
    if (this.fx && this.lava.length && Math.random() < dt * this.lava.length * 0.15) {
      const [x, y] = this.lava[Math.floor(Math.random() * this.lava.length)];
      this.fx.particle(x * TILE + Math.random() * TILE, y * TILE + Math.random() * TILE, (Math.random() - 0.5) * 6, -12 - Math.random() * 10, 0.9, Math.random() < 0.5 ? 0xffcc68 : 0xee8e2e, { depth: DEPTH.fx });
    }
  }
}
