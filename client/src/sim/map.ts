import { CONST, TILE_ID } from '../generated/defs';

export const TILE = 16;

/** Who is moving. The walking rules (`TileMap.blocks`) differ per mover. Mirrors `Mover` in server/src/dungeon/mod.rs. */
export type Mover = 'hero' | 'enemy' | 'demon' | 'dash' | 'breathless';

/** Does this tile start the water clock of a walker? Here only deep water, and not mid-dash. #346's Swim trait plugs in here. Mirrors `drowning_tile`. */
export function drowningTile(t: number, dashing: boolean): boolean {
  return !dashing && t === TILE_ID.DeepWater;
}

/** Is the head under water after `t` seconds in deep water? Mirrors `head_under`. */
export function headUnder(t: number): boolean {
  return t >= CONST.HEAD_UNDER;
}

/** Factor on walking speed for the time `t` in deep water. Mirrors `under_factor`. */
export function underFactor(t: number): number {
  return headUnder(t) ? CONST.UNDER_SPEED / CONST.SWIM_SPEED : 1;
}

/** Which tiles stop a sight line: every opaque tile, or only the hard ones (light passes trunks and thickets). Mirrors `Blocker`. */
export type Blocker = 'all' | 'hard';

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

  /** Blocks sight and projectiles (trunks and thickets too). Floor, roads, open doors, terrain and barriers do not. */
  opaque(x: number, y: number): boolean {
    const t = this.get(x, y);
    return !(t === TILE_ID.Floor || t === TILE_ID.DoorOpen || t === TILE_ID.Road || t === TILE_ID.Barrier || isTerrain(t));
  }

  /** Blocks light as well: opaque, except trunks and thickets. */
  hardOpaque(x: number, y: number): boolean {
    const t = this.get(x, y);
    return this.opaque(x, y) && t !== TILE_ID.Trunk && t !== TILE_ID.Thicket;
  }

  blocksSight(x: number, y: number, b: Blocker): boolean {
    return b === 'all' ? this.opaque(x, y) : this.hardOpaque(x, y);
  }

  opaqueAt(px: number, py: number): boolean {
    return this.opaque(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** Blocks walking for this mover. An invisible wall (Barrier, #259) blocks every mover. */
  blocks(x: number, y: number, mover: Mover): boolean {
    const t = this.get(x, y);
    if (t === TILE_ID.Barrier || this.opaque(x, y)) return true;
    switch (mover) {
      case 'dash':
        return false;
      case 'hero':
        return false;
      case 'breathless':
        return t === TILE_ID.Chasm || t === TILE_ID.Lava;
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
    if (t === TILE_ID.DeepWater) return CONST.SWIM_SPEED;
    if (t === TILE_ID.Lava && mover !== 'demon') return CONST.LAVA_SPEED;
    return 1;
  }
}
