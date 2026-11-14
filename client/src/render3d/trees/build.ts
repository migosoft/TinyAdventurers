// Turns a tree spec into mesh streams. Leafy trees (round, wide, tall) and the dead tree are built here.
import { rng } from '../../game/vegetation/canvas';
import { SWAY } from '../wind';
import { growLeafy } from './grow';
import { RAMP, TreeMesh, coreBall, mirrorX, tube, tufts, type GradFn } from './mesh';
import type { TreeSpec } from './spec';

export interface BuiltTree {
  mesh: TreeMesh;
  height: number;
  /** Horizontal reach from the foot, leaves and sway included. */
  radius: number;
  /** The crown lobes, for the falling leaves. */
  lobes: { x: number; y: number; z: number; r: number; th: number }[];
}

/** Builds the mesh of one tree, unmirrored and then mirrored when the spec asks for it. */
export function buildTree(s: TreeSpec): BuiltTree {
  if (s.form !== 'round' && s.form !== 'wide' && s.form !== 'tall') throw new Error(`trees: the ${s.form} is not built yet`);
  const sk = growLeafy(s), m = new TreeMesh();
  const wood = s.dead ? RAMP.dead : RAMP.bark, amp = s.dead ? 0 : SWAY.leafy;
  const kOf = (y: number) => amp * (Math.max(0, y) / sk.height) ** 2;
  const shade = (living: number) => (s.dead ? 0 : living);
  tube(m, sk.trunk, 10, wood, kOf, (i) => (i >= sk.trunk.length - 3 ? shade(1) : 0), true);
  for (const b of sk.branches) tube(m, b.pts, b.sides, wood, kOf, () => shade(1), false);
  for (const r of sk.roots) tube(m, r, 5, wood, () => 0, () => 1, false);

  if (!s.dead && sk.lobes.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of sk.lobes) {
      x0 = Math.min(x0, b.x - b.rx); x1 = Math.max(x1, b.x + b.rx); y0 = Math.min(y0, b.y - b.ry); y1 = Math.max(y1, b.y + b.ry);
      z0 = Math.min(z0, b.z - b.rz); z1 = Math.max(z1, b.z + b.rz);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, span = y1 - y0;
    const grad: GradFn = (x, y, z) => [(x - cx) / ((x1 - x0) / 2), (y - cy) / ((y1 - y0) / 2), (z - cz) / ((z1 - z0) / 2), 0.25 - (0.7 * (y1 - y)) / span];
    const rt = rng((s.seed * 31 + 7) >>> 0);
    for (const b of sk.lobes) { coreBall(m, b, RAMP.leaf, grad, b.th); tufts(m, b, grad, b.th, rt, RAMP.leaf); }
  }

  let height = 0, reach = 0;
  for (let i = 0; i < m.verts; i++) {
    height = Math.max(height, m.position[i * 3 + 1]);
    reach = Math.max(reach, Math.hypot(m.position[i * 3], m.position[i * 3 + 2]));
  }
  const lobes = s.dead ? [] : sk.lobes.map((b) => ({ x: b.x, y: b.y, z: b.z, r: b.rx, th: b.th }));
  const out: BuiltTree = { mesh: m, height, radius: reach + amp, lobes };
  if (!s.mirrored) return out;
  return { ...out, mesh: mirrorX(m), lobes: lobes.map((l) => ({ ...l, x: -l.x })) };
}
