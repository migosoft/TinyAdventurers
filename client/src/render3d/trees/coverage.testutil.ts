// Test helper: how much of the crown's picture the leaves cover, seen from the game's camera.
import type { BuiltTree } from './build';
import { CORE_VERTS, SHAPE, TUFT_VERTS } from './mesh';

const PITCH = (55 * Math.PI) / 180;
const GRID = 96;

interface Patch { x: number; y: number; r: number; th: number; round: boolean }

/** Screen position of a plant-local point: x east, up = y cos(pitch) - z sin(pitch). */
const screen = (x: number, y: number, z: number): [number, number] => [x, y * Math.cos(PITCH) - z * Math.sin(PITCH)];

/** Every leaf patch (tuft squares, core balls) of the mesh, in screen space. */
function patches(t: BuiltTree): Patch[] {
  const m = t.mesh, out: Patch[] = [];
  const at = (i: number): [number, number, number] => [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
  for (let i = 0; i < m.verts; ) {
    const shape = m.part[i * 4 + 1];
    if (shape === SHAPE.tuft) {
      const [x, y] = screen(...at(i));
      out.push({ x, y, r: m.tuft[i * 4 + 2], th: m.misc[i * 4 + 3], round: false });
      i += TUFT_VERTS;
    } else if (shape === SHAPE.core) {
      let cx = 0, cy = 0;
      const pts: [number, number][] = [];
      for (let k = 0; k < CORE_VERTS; k++) { const p = screen(...at(i + k)); pts.push(p); cx += p[0] / CORE_VERTS; cy += p[1] / CORE_VERTS; }
      out.push({ x: cx, y: cy, r: Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))), th: m.misc[i * 4 + 3], round: true });
      i += CORE_VERTS;
    } else i++;
  }
  return out;
}

/** The share of a 96 x 96 grid, fitted to the whole crown, that leaves with a threshold <= `leaf` cover. */
export function crownCoverage(t: BuiltTree, leaf: number): number {
  const all = patches(t);
  if (!all.length) return 0;
  const x0 = Math.min(...all.map((p) => p.x - p.r)), x1 = Math.max(...all.map((p) => p.x + p.r));
  const y0 = Math.min(...all.map((p) => p.y - p.r)), y1 = Math.max(...all.map((p) => p.y + p.r));
  const cw = (x1 - x0) / GRID, ch = (y1 - y0) / GRID, grid = new Uint8Array(GRID * GRID);
  for (const p of all) {
    if (p.th > leaf) continue;
    const gx0 = Math.max(0, Math.floor((p.x - p.r - x0) / cw)), gx1 = Math.min(GRID - 1, Math.floor((p.x + p.r - x0) / cw));
    const gy0 = Math.max(0, Math.floor((p.y - p.r - y0) / ch)), gy1 = Math.min(GRID - 1, Math.floor((p.y + p.r - y0) / ch));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const cx = x0 + (gx + 0.5) * cw, cy = y0 + (gy + 0.5) * ch;
      if (p.round ? Math.hypot(cx - p.x, cy - p.y) <= p.r : Math.abs(cx - p.x) <= p.r && Math.abs(cy - p.y) <= p.r) grid[gy * GRID + gx] = 1;
    }
  }
  let n = 0;
  for (const v of grid) n += v;
  return n / (GRID * GRID);
}
