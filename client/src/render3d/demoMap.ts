/** The demo dungeon: a grid of tiles, each a floor (height 0) or a wall (height WALL_H). */
export const WALL_H = 2;

export const MAP_ROWS: string[] = [
  '########################################',
  '########################################',
  '##....................##################',
  '##....................##################',
  '##.....#.......#......##################',
  '##..................................####',
  '##..................................####',
  '##..................................####',
  '##.............#......###########...####',
  '##....................###########...####',
  '##....................###########...####',
  '########...######################...####',
  '########...######################...####',
  '########...#################..........##',
  '########...#################..........##',
  '############################..........##',
  '############################..........##',
  '############################..........##',
  '############################..........##',
  '########################################',
  '########################################',
  '########################################',
];

export interface DemoMap { w: number; h: number; heights: Float32Array }

/** Parses rows of text; '#' is a wall, anything else is floor. */
export function parseMap(rows: string[]): DemoMap {
  const h = rows.length;
  const w = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const heights = new Float32Array(w * h);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) heights[z * w + x] = rows[z][x] === '#' ? WALL_H : 0;
  return { w, h, heights };
}

/** Tile height; everything outside the map counts as wall. */
export function heightAt(m: DemoMap, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= m.w || z >= m.h) return WALL_H;
  return m.heights[z * m.w + x];
}

export function solid(m: DemoMap, x: number, z: number): boolean {
  return heightAt(m, x, z) > 0;
}

/** round(height * 100) per tile; the shader reads r * 2.55. */
export function heightBytes(m: DemoMap): Uint8Array {
  const out = new Uint8Array(m.w * m.h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(m.heights[i] * 100);
  return out;
}
