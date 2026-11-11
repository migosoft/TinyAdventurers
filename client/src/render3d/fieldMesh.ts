import { TILE_ID } from '../generated/defs';
import type { TileMap } from '../sim/map';
import { WALL_H, heightAt } from './heights';
import { pushQuad, KIND } from './worldMesh';

export const FIELD_COLOUR: [number, number, number] = [0.3, 0.55, 1.0];
export const FIELD_ALPHA = 0.35;

export function sealedCells(map: TileMap): [number, number][] {
  const out: [number, number][] = [];
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) if (map.get(x, z) === TILE_ID.DoorClosed) out.push([x, z]);
  return out;
}

const NO = { x: 0, y: 0, w: 0, h: 0 };

/** A box of WALL_H per DoorClosed cell: its top, and a side toward every neighbour that is lower than WALL_H and not DoorClosed. 6 vertices per quad. */
export function buildField(map: TileMap): { position: Float32Array; count: number } {
  const sink = { position: [] as number[], uv: [] as number[], normal: [] as number[], kind: [] as number[], rect: [] as number[] };
  const H = WALL_H;
  for (const [x, z] of sealedCells(map)) {
    pushQuad(sink, [[x, H, z, 0, 0], [x + 1, H, z, 0, 0], [x + 1, H, z + 1, 0, 0], [x, H, z + 1, 0, 0]], [0, 1, 0], KIND.top, NO);
    // dx, dz, then the edge ends (left and right seen from outside)
    const sides: [number, number, number, number, number, number][] = [
      [0, 1, 0, 1, 1, 1], [0, -1, 1, 0, 0, 0], [1, 0, 1, 1, 1, 0], [-1, 0, 0, 0, 0, 1],
    ];
    for (const [dx, dz, ax, az, bx, bz] of sides) {
      if (heightAt(map, x + dx, z + dz) >= H || map.get(x + dx, z + dz) === TILE_ID.DoorClosed) continue;
      pushQuad(sink, [[x + ax, H, z + az, 0, 0], [x + bx, H, z + bz, 0, 0], [x + bx, 0, z + bz, 0, 0], [x + ax, 0, z + az, 0, 0]], [dx, 0, dz], KIND.face, NO);
    }
  }
  return { position: new Float32Array(sink.position), count: sink.kind.length };
}
