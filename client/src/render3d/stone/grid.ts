// The chunk grid and the vertex kinds of the world mesh (#380). They live here, not in worldMesh.ts, so the stone modules (plan, mesh)
// and worldMesh.ts import them without a cycle; worldMesh.ts re-exports them.

/** Cells per chunk edge. */
export const CHUNK = 16;

/** The `kind` vertex attribute of the world mesh: floor and ground read a sheet (the ground kind: the woodland's painted image), a face is a wall side, a top the wall's top. */
export const KIND = { floor: 0, face: 1, top: 2, ground: 3 } as const;

export function chunkGrid(map: { w: number; h: number }): { nx: number; nz: number } {
  return { nx: Math.ceil(map.w / CHUNK), nz: Math.ceil(map.h / CHUNK) };
}

/**
 * The chunk of the cell and those of its eight neighbours (a face's `straight` flag and the terrain edges
 * read the diagonal cells) where they differ and lie inside the grid; no duplicates.
 */
export function chunksOfTile(map: { w: number; h: number }, x: number, z: number): [cx: number, cz: number][] {
  const { nx, nz } = chunkGrid(map);
  const out: [number, number][] = [];
  for (const [dx, dz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = Math.floor((x + dx) / CHUNK), cz = Math.floor((z + dz) / CHUNK);
    if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
    if (!out.some((c) => c[0] === cx && c[1] === cz)) out.push([cx, cz]);
  }
  return out;
}

/** dx, dz of the neighbour a wall's side faces: 0 south (+z), 1 north (-z), 2 east (+x), 3 west (-x). The order of every side list. */
export const SIDE_STEP: readonly (readonly [number, number])[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
