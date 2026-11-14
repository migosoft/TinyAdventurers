// The moss source (#330): where moss grows in the dungeon's rooms, decided on the client from the run's tiles alone
// (the same for every player of a party, different per run). Pure data: no three.js, no Phaser.
import { TILE_ID } from '../../generated/defs';
import type { CoveInfo } from '../../generated/CoveInfo';
import { noise, type Rgb } from '../../game/covemath';
import { P } from '../../game/vegetation/canvas';
import { TILE, type TileMap } from '../../sim/map';
import { heightAt } from '../heights';
import { COVER } from './kinds';
import type { CoverSource } from './source';

export const MOSS = { area: 12, areaCut: 0.62, cornerReach: 12, wallReach: 6, wobble: 4, patchChance: 0.06, patchR: [4, 9] } as const; // first guesses

/** Dark to light. */
export const MOSS_TONES: Rgb[] = [P['5'], P['0'], P['6'], P['1']];

/** FNV-1a over the solid/open layout (one byte per tile, 1 where `heightAt > 0`), row-major. Doors, water and lava
 * change during a run and do not count, so a source rebuilt later grows the same moss. */
export function tilesSeed(map: TileMap): number {
  let h = 0x811c9dc5;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) h = Math.imul(h ^ (heightAt(map, x, y) > 0 ? 1 : 0), 0x01000193) >>> 0;
  return h;
}

/** A hash of the seed and three integers in [0, 1). */
function hash(seed: number, a: number, b: number, c: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(b + 0x165667b1, 0x27d4eb2f) ^ Math.imul(c + 0x1b873593, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const BAD_NEIGHBOUR = new Set<number>([TILE_ID.DoorOpen, TILE_ID.DoorClosed, TILE_ID.ShallowWater, TILE_ID.DeepWater, TILE_ID.Lava, TILE_ID.Chasm]);

export function mossSource(map: TileMap, cove: CoveInfo | null, opts?: { everywhere?: boolean }): CoverSource | null {
  const everywhere = opts?.everywhere ?? false;
  const { w: tw, h: th } = map;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === TILE_ID.Lava) return null;
  const seed = tilesSeed(map);
  const w = tw * TILE, h = th * TILE;
  const wall = (x: number, z: number): boolean => heightAt(map, x, z) > 0;

  const eligible = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    if (map.get(tx, ty) !== TILE_ID.Floor) continue;
    if (cove && tx >= cove.x && tx < cove.x + cove.w && ty >= cove.y && ty < cove.y + cove.h) continue;
    let ok = true;
    for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) if (BAD_NEIGHBOUR.has(map.get(tx + dx, ty + dz))) { ok = false; break; }
    if (!ok) continue;
    if ((wall(tx - 1, ty) && wall(tx + 1, ty)) || (wall(tx, ty - 1) && wall(tx, ty + 1))) continue; // corridor
    eligible[ty * tw + tx] = 1;
  }

  const area = noise(seed, MOSS.area * TILE), wobble = noise(seed + 1, 48), fine = noise(seed + 2, 6);
  const mossy = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const i = ty * tw + tx;
    if (eligible[i] && (everywhere || area(tx * TILE + TILE / 2, ty * TILE + TILE / 2) > MOSS.areaCut)) mossy[i] = 1;
  }

  /** One free patch per lucky mossy tile: an ellipse at a hashed point of the tile. */
  const patchAt = (tx: number, ty: number): { x: number; y: number; rx: number; ry: number } | null => {
    if (!mossy[ty * tw + tx] || hash(seed, tx, ty, 10) >= MOSS.patchChance) return null;
    const r = MOSS.patchR[0] + hash(seed, tx, ty, 11) * (MOSS.patchR[1] - MOSS.patchR[0]);
    return { x: tx * TILE + hash(seed, tx, ty, 12) * TILE, y: ty * TILE + hash(seed, tx, ty, 13) * TILE, rx: r, ry: r * (0.55 + hash(seed, tx, ty, 14) * 0.3) };
  };

  const grow = new Uint8Array(w * h), allow = new Uint8Array(w * h), colour = new Uint8ClampedArray(w * h * 4);

  const band = (ty: number): void => {
    for (let tx = 0; tx < tw; tx++) {
      const i = ty * tw + tx;
      if (!eligible[i]) continue; // colour is read only where `allow` is 1, so only eligible tiles are worked
      let reach = 0;
      if (mossy[i]) {
        const vert = wall(tx, ty - 1) || wall(tx, ty + 1), horiz = wall(tx - 1, ty) || wall(tx + 1, ty);
        reach = vert && horiz ? MOSS.cornerReach : vert || horiz ? MOSS.wallReach : 0;
      }
      const patches: { x: number; y: number; rx: number; ry: number }[] = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx, nz = ty + dz;
        if (nx < 0 || nz < 0 || nx >= tw || nz >= th) continue;
        const p = patchAt(nx, nz);
        if (p) patches.push(p);
      }
      for (let ly = 0; ly < TILE; ly++) for (let lx = 0; lx < TILE; lx++) {
        const x = tx * TILE + lx, y = ty * TILE + ly, o = y * w + x;
        const n = fine(x, y) * 0.7 + hash(seed, x, y, 20) * 0.3;
        const tone = MOSS_TONES[Math.min(MOSS_TONES.length - 1, Math.floor(n * n * MOSS_TONES.length))]; // darker tones commoner
        colour[o * 4] = tone[0]; colour[o * 4 + 1] = tone[1]; colour[o * 4 + 2] = tone[2]; colour[o * 4 + 3] = 255;
        allow[o] = 1;
        if (!mossy[i]) continue;
        let d = 99;
        if (reach > 0) {
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dz) && wall(tx + dx, ty + dz)) {
              const ex = dx < 0 ? lx + 1 : dx > 0 ? TILE - lx : 0, ez = dz < 0 ? ly + 1 : dz > 0 ? TILE - ly : 0;
              d = Math.min(d, Math.hypot(ex, ez));
            }
          }
        }
        let on = reach > 0 && d < reach + (wobble(x, y) - 0.5) * 2 * MOSS.wobble;
        if (!on) for (const p of patches) if (((x + 0.5 - p.x) / p.rx) ** 2 + ((y + 0.5 - p.y) / p.ry) ** 2 < 1) { on = true; break; }
        if (on) grow[o] = 1;
      }
    }
  };

  const prep: (() => void)[] = [];
  for (let ty = 0; ty < th; ty++) prep.push(() => band(ty));
  return { kind: COVER.moss, w, h, grow, allow, colour, prep };
}
