import { TILE_ID } from '../generated/defs';

export const TILE = 16;

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

  solid(x: number, y: number): boolean {
    const t = this.get(x, y);
    return !(t === TILE_ID.Floor || t === TILE_ID.DoorOpen);
  }

  solidAt(px: number, py: number): boolean {
    return this.solid(Math.floor(px / TILE), Math.floor(py / TILE));
  }
}
