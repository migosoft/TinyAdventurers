// The marks the client places from a level's seed (#380 part 5): rooms, puddles, cracks, crevices, floor pieces, grates and crystal
// shards. Task 7 fills them; the painter and the mesh read them. Declared now, with empty lists, so no signature moves later.

export interface Room { cells: number[]; kind: 0 | 1; x0: number; z0: number; x1: number; z1: number }
export interface Puddle { x: number; z: number; r: number }
export interface Crack { pts: [number, number][]; branch: number[][] }
export interface Crevice extends Crack { width: number; depth: number }
export interface FloorPiece { kind: 'circle' | 'mosaic'; x: number; z: number; r: number }
export interface Grate { x: number; z: number }
export interface Shard { x: number; z: number; nx: number; nz: number; big: boolean; lightId?: number }
export interface Marks { rooms: Room[]; puddles: Puddle[]; rockCracks: Crack[]; crevices: Crevice[]; pieces: FloorPiece[]; grates: Grate[]; shards: Shard[] }

/** No marks at all: what every caller passes until the placement exists. */
export function noMarks(): Marks {
  return { rooms: [], puddles: [], rockCracks: [], crevices: [], pieces: [], grates: [], shards: [] };
}
