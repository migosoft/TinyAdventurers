// The order the woodland's ground is settled in (#203).

/** Tile rows nearest to `centre` first (ties: the upper row), so the ground settles around the camera. */
export function bandOrder(rows: number, centre: number): number[] {
  const c = Math.min(rows - 1, Math.max(0, Math.floor(centre)));
  return Array.from({ length: rows }, (_, i) => i).sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b);
}
