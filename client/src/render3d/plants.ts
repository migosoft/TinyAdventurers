// The 3D woodland's plant geometry (#306): the upright card with its root decal, the trunk caster and the clump discs the sun's
// shadow pass draws, and the chunking of plants. Pure: no three.js, and nothing here depends on the camera.
import type { PlantShape } from '../game/vegetation';
import { CHUNK } from './worldMesh';

/** Pixels per tile in a plant's image. */
const PX = 16;

/** A plant drawn into a page (page -1: the atlas). rect in page px; foot and shape in the image's px. */
export interface PlantSprite { page: number; rect: { x: number; y: number; w: number; h: number }; foot: { x: number; y: number }; shape: PlantShape | null }
export interface PlantPlace { x: number; z: number; mirrored: boolean; amp: number; seed: number }
/** Per vertex: foot (x, z), corner (u tiles across the card, signed; y tiles up), uv (page px), sway (amp, card height in tiles), part (0 card, 1 root decal). `n` counts vertices. */
export interface PlantBuf { foot: number[]; corner: number[]; uv: number[]; sway: number[]; part: number[]; n: number }
/** A clump disc: centre (x, y, z) world-fixed, radius, phase for the lumpy edge, foot (x, z) and sway (amp, h) for the shadow's sway. `corner` is the quad corner (-1..1). `n` counts vertices. */
export interface ClumpBuf { centre: number[]; corner: number[]; radius: number[]; phase: number[]; foot: number[]; sway: number[]; n: number }

export const newPlantBuf = (): PlantBuf => ({ foot: [], corner: [], uv: [], sway: [], part: [], n: 0 });
export const newClumpBuf = (): ClumpBuf => ({ centre: [], corner: [], radius: [], phase: [], foot: [], sway: [], n: 0 });

/** Tiles: the root decal's height, above the terrain layers' range. */
export const ROOT_LIE = 0.004;

// Corners run top-left, top-right, bottom-right, bottom-left; two triangles (as cards.ts).
const ORDER = [0, 3, 2, 0, 2, 1];

/**
 * One quad of the image rows `r0..r1` and columns `c0..c1` (px). `foot` is the plant's foot in the image's px; a mirrored
 * plant reads its columns back to front, so its u runs the other way and its uv swaps. `up0`/`up1` are the y of the top and bottom edge in tiles.
 */
function quad(out: PlantBuf, p: PlantPlace, s: PlantSprite, c0: number, c1: number, r0: number, r1: number, up0: number, up1: number, part: number): void {
  const fx = s.foot.x;
  const uL = p.mirrored ? -(c1 - fx) / PX : (c0 - fx) / PX, uR = p.mirrored ? -(c0 - fx) / PX : (c1 - fx) / PX;
  const xL = p.mirrored ? c1 : c0, xR = p.mirrored ? c0 : c1;
  const h = s.foot.y / PX;
  const cs: [number, number][] = [[uL, up0], [uR, up0], [uR, up1], [uL, up1]];
  const us: [number, number][] = [[xL, r0], [xR, r0], [xR, r1], [xL, r1]];
  for (const k of ORDER) {
    out.foot.push(p.x, p.z);
    out.corner.push(cs[k][0], cs[k][1]);
    out.uv.push(s.rect.x + us[k][0], s.rect.y + us[k][1]);
    out.sway.push(p.amp, h);
    out.part.push(part);
  }
  out.n += 6;
}

/** The upright card (rows 0..foot.y) and the root decal lying flat (rows foot.y..h). */
export function pushPlant(out: PlantBuf, p: PlantPlace, s: PlantSprite): void {
  const { w, h } = s.rect, fy = s.foot.y;
  quad(out, p, s, 0, w, 0, fy, fy / PX, 0, 0);
  if (h > fy) quad(out, p, s, 0, w, fy, h, 0, -(h - fy) / PX, 1);
}

/** The trunk caster: rows trunkTop..foot, columns trunkX0..trunkX1; 'whole' plants: the whole card above the foot. Nothing when the plant has no shape or no trunk. */
export function pushTrunkCaster(out: PlantBuf, p: PlantPlace, s: PlantSprite): void {
  const sh = s.shape;
  if (!sh) return;
  const fy = s.foot.y;
  if (sh.cast === 'whole') { quad(out, p, s, 0, s.rect.w, 0, fy, fy / PX, 0, 0); return; }
  if (sh.trunkTop >= fy) return;
  quad(out, p, s, sh.trunkX0, sh.trunkX1 + 1, sh.trunkTop, fy, (fy - sh.trunkTop) / PX, 0, 0);
}

function hash(seed: number, i: number): number {
  let t = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(i + 1, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Seeded depth offset (tiles, toward or away from the camera) of clump i; |d| <= 0.65 and <= `reachPx` (the disc's depth budget, if it has one), 0 on the axis. */
export function clumpDepth(seed: number, i: number, onAxis: boolean, reachPx = Infinity): number {
  return onAxis ? 0 : (hash(seed, i) * 2 - 1) * Math.min(0.65, reachPx / PX);
}

/** One disc per clump, at a world-fixed centre. */
export function pushClumps(out: ClumpBuf, p: PlantPlace, s: PlantSprite): void {
  const sh = s.shape;
  if (!sh) return;
  const h = s.foot.y / PX;
  sh.clumps.forEach((c, i) => {
    const off = (c.x - s.foot.x) / PX;
    const cx = p.x + (p.mirrored ? -off : off), cy = (s.foot.y - c.y) / PX, cz = p.z + clumpDepth(p.seed, i, Math.abs(c.x - s.foot.x) < 0.5, c.reach);
    const phase = hash(p.seed, i + 1000) * Math.PI * 2;
    for (const k of ORDER) {
      out.centre.push(cx, cy, cz);
      out.corner.push(k === 0 || k === 3 ? -1 : 1, k < 2 ? 1 : -1);
      out.radius.push(c.r / PX);
      out.phase.push(phase);
      out.foot.push(p.x, p.z);
      out.sway.push(p.amp, h);
    }
    out.n += 6;
  });
}

/** Which chunk (CHUNK tiles) each plant's foot lies in: chunk index = cz * nx + cx. Values are indices into `feet`. */
export function plantChunks(feet: readonly { x: number; z: number }[], map: { w: number; h: number }): Map<number, number[]> {
  const nx = Math.ceil(map.w / CHUNK), nz = Math.ceil(map.h / CHUNK);
  const out = new Map<number, number[]>();
  feet.forEach((f, i) => {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor(f.x / CHUNK))), cz = Math.min(nz - 1, Math.max(0, Math.floor(f.z / CHUNK)));
    const k = cz * nx + cx;
    const l = out.get(k);
    if (l) l.push(i); else out.set(k, [i]);
  });
  return out;
}

/** Tracks which chunk versions a consumer has; a new consumer (a rebuilt view) sees every chunk as changed. */
export class ChunkSync {
  private seen = new Map<number, number>();
  changed(versions: ReadonlyMap<number, number>): number[] {
    const out: number[] = [];
    for (const [k, v] of versions) if (this.seen.get(k) !== v) { out.push(k); this.seen.set(k, v); }
    return out;
  }
}
