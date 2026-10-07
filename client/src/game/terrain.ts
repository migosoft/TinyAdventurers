// Water, lava and chasms on the board. The tiles are generated at atlas build
// time from pack colours (client/scripts/terrain-tiles.ts): an animated base
// texture per cell plus an edge overlay (bank face, rims, rounded corners)
// picked from the cell's eight neighbours. Lava also glows (runtime effect).
import Phaser from 'phaser';
import { edgeCode, TERRAIN_FRAMES, TERRAIN_PERIOD, type TerrainEdge, type TerrainSet } from './terrain-codes';
import { DEPTH, type Effects } from './effects';
import { TILE, type TileMap } from '../sim/map';

/** Terrain tile ids. TODO(terrain): take these from TILE_ID once the server has them. */
export const TERRAIN = { Shallow: 5, Deep: 6, Chasm: 7, Lava: 8 } as const;

/** Movement speed factor on a terrain tile (demons are not slowed by lava). */
export function speedFactor(t: number, demon = false): number {
  if (t === TERRAIN.Shallow) return 0.7;
  if (t === TERRAIN.Lava) return demon ? 1 : 0.4;
  return 1;
}

/** Pixels a figure stands below the surface on this tile (wading). */
export function sinkDepth(t: number): number {
  return t === TERRAIN.Shallow ? 3 : t === TERRAIN.Lava ? 2 : 0;
}

const isWater = (t: number) => t === TERRAIN.Shallow || t === TERRAIN.Deep;
const FPS: Record<TerrainSet, number> = { water: 4, deep: 4, lava: 5, chasm: 1 };
const D8: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

interface Animated {
  img: Phaser.GameObjects.Image;
  set: TerrainSet;
  q: number;
}

/** Base textures and edge overlays to draw for one cell, bottom to top. */
export function terrainLayers(m: TileMap, x: number, y: number): { base: TerrainSet[]; edges: string[] } {
  const t = m.get(x, y);
  const code = (same: (u: number) => boolean) => edgeCode(D8.map(([dx, dy]) => same(m.get(x + dx, y + dy))));
  const edge = (e: TerrainEdge, c: string) => (c === '0000' ? [] : [`terrain_${e}_e${c}`]);
  if (t === TERRAIN.Shallow) return { base: ['water'], edges: edge('shore', code(isWater)) };
  if (t === TERRAIN.Deep) return { base: ['water', 'deep'], edges: [...edge('deep', code((u) => u === TERRAIN.Deep)), ...edge('shore', code(isWater))] };
  if (t === TERRAIN.Lava) return { base: ['lava'], edges: edge('lava', code((u) => u === TERRAIN.Lava)) };
  if (t === TERRAIN.Chasm) return { base: ['chasm'], edges: edge('chasm', code((u) => u === TERRAIN.Chasm)) };
  return { base: [], edges: [] };
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
      const f = Math.floor(this.clock * FPS[a.set]) % TERRAIN_FRAMES[a.set];
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
