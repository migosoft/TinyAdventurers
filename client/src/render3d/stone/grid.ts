// The chunk grid and the vertex kinds of the world mesh (#380). They live here, not in worldMesh.ts, so the stone modules (plan, mesh)
// and worldMesh.ts import them without a cycle; worldMesh.ts re-exports them.

/** Cells per chunk edge. */
export const CHUNK = 16;

/** The `kind` vertex attribute of the world mesh: floor and ground read a sheet (the ground kind: the woodland's painted image), a face is a wall side, a top the wall's top. */
export const KIND = { floor: 0, face: 1, top: 2, ground: 3 } as const;

export function chunkGrid(map: { w: number; h: number }): { nx: number; nz: number } {
  return { nx: Math.ceil(map.w / CHUNK), nz: Math.ceil(map.h / CHUNK) };
}

/** dx, dz of the neighbour a wall's side faces: 0 south (+z), 1 north (-z), 2 east (+x), 3 west (-x). The order of every side list. */
export const SIDE_STEP: readonly (readonly [number, number])[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
