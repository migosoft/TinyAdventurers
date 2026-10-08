import { CONST, TILE_ID } from '../generated/defs';

export const TILE = 16;

/** Who is moving. The walking rules (`TileMap.blocks`) differ per mover. Mirrors `Mover` in server/src/dungeon/mod.rs. */
export type Mover = 'hero' | 'enemy' | 'demon' | 'dash';

/** Water, chasm or lava. */
export function isTerrain(t: number): boolean {
  return t >= TILE_ID.ShallowWater && t <= TILE_ID.Lava;
}

/** Tile grid shared by prediction, FOV and rendering. Mirrors `Map` in server/src/dungeon/mod.rs. */
export class TileMap {
  constructor(
    public w: number,
    public h: number,
    public tiles: Uint8Array,
  ) {}

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TILE_ID.Void;
    return this.tiles[y * this.w + x];
  }

  set(x: number, y: number, v: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.tiles[y * this.w + x] = v;
  }

  tileAt(px: number, py: number): number {
    return this.get(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** Blocks sight and projectiles. Terrain does not. */
  opaque(x: number, y: number): boolean {
    const t = this.get(x, y);
    return !(t === TILE_ID.Floor || t === TILE_ID.DoorOpen || isTerrain(t));
  }

  opaqueAt(px: number, py: number): boolean {
    return this.opaque(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** Blocks walking for this mover. */
  blocks(x: number, y: number, mover: Mover): boolean {
    if (this.opaque(x, y)) return true;
    const t = this.get(x, y);
    switch (mover) {
      case 'dash':
        return false;
      case 'hero':
        return t === TILE_ID.DeepWater;
      case 'demon':
        return t === TILE_ID.DeepWater || t === TILE_ID.Chasm;
      case 'enemy':
        return t === TILE_ID.DeepWater || t === TILE_ID.Chasm || t === TILE_ID.Lava;
    }
  }

  /** Walking speed multiplier on this tile (a dash ignores terrain). */
  speedFactor(px: number, py: number, mover: Mover): number {
    const t = this.tileAt(px, py);
    if (mover === 'dash') return 1;
    if (t === TILE_ID.ShallowWater) return CONST.SHALLOW_SPEED;
    if (t === TILE_ID.Lava && mover !== 'demon') return CONST.LAVA_SPEED;
    return 1;
  }
}
