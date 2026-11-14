// Turns a tree spec into mesh streams: the leafy trees (round, wide, tall), the dead tree, the willow, conifers and bushes.
import { rng } from '../../game/vegetation/canvas';
import { growLeafy, growPlant, growWillow, swayK, type FallLobe, type Skeleton } from './grow';
import { RAMP, TreeMesh, coreBall, mirrorX, skirt, tube, tuftPatch, tufts, type GradFn } from './mesh';
import type { TreeSpec } from './spec';

export interface BuiltTree {
  mesh: TreeMesh;
  height: number;
  /** Horizontal reach from the foot, leaves and sway included. */
  radius: number;
  /** Where leaves may fall from, for the falling leaves. */
  lobes: FallLobe[];
}

function skeletonOf(s: TreeSpec): Skeleton {
  switch (s.form) {
    case 'round': case 'wide': case 'tall': return growLeafy(s);
    case 'willow': return growWillow(s);
    case 'conifer': case 'bush': return growPlant(s);
  }
}

/**
 * Builds the mesh of one tree, unmirrored and then mirrored when the spec asks for it. A dead leafy tree is its bare wood; a dead
 * conifer or bush keeps its living shape and leaves, with dead wood and no sway (first guess).
 */
export function buildTree(s: TreeSpec): BuiltTree {
  const sk = skeletonOf(s), m = new TreeMesh(), leafy = s.form === 'round' || s.form === 'wide' || s.form === 'tall';
  const wood = s.dead ? RAMP.dead : RAMP.bark;
  const kOf = (y: number) => swayK(sk.amp, y, sk.height);
  const shade = (living: number) => (s.dead ? 0 : living);
  tube(m, sk.trunk, sk.trunkSides, wood, kOf, (i) => (sk.trunkShaded && i >= sk.trunk.length - 3 ? shade(1) : 0), true);
  for (const b of sk.branches) tube(m, b.pts, b.sides, wood, kOf, () => shade(1), false);
  for (const r of sk.roots) tube(m, r, sk.rootSides, wood, () => 0, () => 1, false);

  if (!(s.dead && leafy) && sk.lobes.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of sk.lobes) {
      x0 = Math.min(x0, b.x - b.rx); x1 = Math.max(x1, b.x + b.rx); y0 = Math.min(y0, b.y - b.ry); y1 = Math.max(y1, b.y + b.ry);
      z0 = Math.min(z0, b.z - b.rz); z1 = Math.max(z1, b.z + b.rz);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, span = y1 - y0;
    const grad: GradFn = (x, y, z) => [(x - cx) / ((x1 - x0) / 2), (y - cy) / ((y1 - y0) / 2), (z - cz) / ((z1 - z0) / 2), 0.25 - (0.7 * (y1 - y)) / span];
    const rt = rng((s.seed * 31 + 7) >>> 0);
    for (const b of sk.lobes) { coreBall(m, b, RAMP.leaf, grad, b.th, sk.lift); tufts(m, b, grad, b.th, rt, RAMP.leaf, [0, 0], sk.lift); }
  }
  for (const o of sk.skirts) skirt(m, o);
  for (const t of sk.curtain) tuftPatch(m, t);

  let height = 0, reach = 0;
  for (let i = 0; i < m.verts; i++) {
    height = Math.max(height, m.position[i * 3 + 1]);
    reach = Math.max(reach, Math.hypot(m.position[i * 3], m.position[i * 3 + 2]));
  }
  const out: BuiltTree = { mesh: m, height, radius: reach + sk.amp, lobes: sk.falls };
  if (!s.mirrored) return out;
  return { ...out, mesh: mirrorX(m), lobes: sk.falls.map((l) => ({ ...l, x: -l.x })) };
}
