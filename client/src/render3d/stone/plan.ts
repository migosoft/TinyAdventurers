// Which chunk and which wall face owns which part of the stone sheets (#380). Pure: no three.
// The ground sheet has one page (layer) per chunk that shows ground. The wall sheet is cut into slots of FACE_W by FACE_H px, one per wall face
// (a wall cell and a side that borders a lower cell); a chunk owns whole wall pages of 16 by 8 slots, so a chunk's faces never share a page with another's.
import { TILE_ID } from '../../generated/defs';
import type { TileMap } from '../../sim/map';
import { cellHeight, heightAt } from '../heights';
import { FACE_H, FACE_W, PAGE } from './format';
import { CHUNK, SIDE_STEP, chunkGrid } from './grid';

/** A wall cell and the side (worldMesh's order: 0 south, 1 north, 2 east, 3 west) that borders a lower cell. */
export interface Face { x: number; z: number; side: 0 | 1 | 2 | 3 }
/** px of the slot's top-left texel in its wall page. */
export interface FaceSlot { layer: number; u: number; v: number }
export interface SheetPlan {
  groundLayers: number; wallLayers: number;
  /** The chunk's ground layer, or -1 for a chunk with no open and no Wall cell. */
  groundOf(cx: number, cz: number): number;
  /** The chunk's faces in a fixed order: z, x, side. */
  facesOf(cx: number, cz: number): readonly Face[];
  slotOf(f: Face): FaceSlot;
}

/** Slots per wall page: 16 across, 8 down. */
export const SLOTS_PER_PAGE = (PAGE / FACE_W) * (PAGE / FACE_H);
const ACROSS = PAGE / FACE_W;

/** Whether the chunk shows ground: any open cell (height 0) or a Wall cell (its top reads the ground sheet). A chunk of only Void does not. */
export function groundNeeded(map: TileMap, cx: number, cz: number): boolean {
  const x1 = Math.min(map.w, (cx + 1) * CHUNK), z1 = Math.min(map.h, (cz + 1) * CHUNK);
  for (let z = cz * CHUNK; z < z1; z++) for (let x = cx * CHUNK; x < x1; x++) {
    const t = map.get(x, z);
    if (t === TILE_ID.Wall || cellHeight(t) === 0) return true;
  }
  return false;
}

/** The faces of chunk (cx, cz): every cell above a lower neighbour on a side, in the order z, x, side. */
function chunkFaces(map: TileMap, cx: number, cz: number): Face[] {
  const out: Face[] = [];
  const x1 = Math.min(map.w, (cx + 1) * CHUNK), z1 = Math.min(map.h, (cz + 1) * CHUNK);
  for (let z = cz * CHUNK; z < z1; z++) for (let x = cx * CHUNK; x < x1; x++) {
    const h = heightAt(map, x, z);
    if (h === 0) continue;
    for (let s = 0; s < 4; s++) {
      if (heightAt(map, x + SIDE_STEP[s][0], z + SIDE_STEP[s][1]) < h) out.push({ x, z, side: s as 0 | 1 | 2 | 3 });
    }
  }
  return out;
}

/** Changes exactly when the chunk's faces change (a door opening or closing changes none). */
export function facesKey(map: TileMap, cx: number, cz: number): string {
  return chunkFaces(map, cx, cz).map((f) => `${f.x},${f.z},${f.side}`).join(';');
}

export function planSheets(map: TileMap): SheetPlan {
  const { nx, nz } = chunkGrid(map);
  const ground = new Int32Array(nx * nz);
  const faces: Face[][] = [];
  const slots = new Map<number, FaceSlot>();
  let groundLayers = 0, wallLayers = 0;
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
    ground[cz * nx + cx] = groundNeeded(map, cx, cz) ? groundLayers++ : -1;
    const list = chunkFaces(map, cx, cz);
    faces.push(list);
    const first = wallLayers;
    list.forEach((f, i) => {
      const j = i % SLOTS_PER_PAGE;
      slots.set((f.z * map.w + f.x) * 4 + f.side, { layer: first + Math.floor(i / SLOTS_PER_PAGE), u: (j % ACROSS) * FACE_W, v: Math.floor(j / ACROSS) * FACE_H });
    });
    wallLayers += Math.ceil(list.length / SLOTS_PER_PAGE);
  }
  return {
    groundLayers, wallLayers,
    groundOf: (cx, cz) => (cx < 0 || cz < 0 || cx >= nx || cz >= nz ? -1 : ground[cz * nx + cx]),
    facesOf: (cx, cz) => (cx < 0 || cz < 0 || cx >= nx || cz >= nz ? [] : faces[cz * nx + cx]),
    slotOf(f) {
      const s = slots.get((f.z * map.w + f.x) * 4 + f.side);
      if (!s) throw new Error(`no slot for the face ${f.x},${f.z} side ${f.side}`);
      return s;
    },
  };
}

/** The plan of a map that draws no stone sheets (the woodland): no layers, so every sheet read has weight 0 and the stone cells show the flat stone colour. */
export function unplanned(): SheetPlan {
  return { groundLayers: 0, wallLayers: 0, groundOf: () => -1, facesOf: () => [], slotOf: () => ({ layer: -1, u: 0, v: 0 }) };
}

/** Whether two plans of `map` lay out the same pages and slots (a rebuilt view's plan against the one its sheets were painted for). */
export function samePlan(a: SheetPlan, b: SheetPlan, map: TileMap): boolean {
  if (a.groundLayers !== b.groundLayers || a.wallLayers !== b.wallLayers) return false;
  const { nx, nz } = chunkGrid(map);
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
    if (a.groundOf(cx, cz) !== b.groundOf(cx, cz)) return false;
    const fa = a.facesOf(cx, cz), fb = b.facesOf(cx, cz);
    if (fa.length !== fb.length) return false;
    for (let i = 0; i < fa.length; i++) {
      if (fa[i].x !== fb[i].x || fa[i].z !== fb[i].z || fa[i].side !== fb[i].side) return false;
      const sa = a.slotOf(fa[i]), sb = b.slotOf(fb[i]);
      if (sa.layer !== sb.layer || sa.u !== sb.u || sa.v !== sb.v) return false;
    }
  }
  return true;
}
