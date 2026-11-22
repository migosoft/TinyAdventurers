import { describe, expect, it } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { floorBlockAt } from './blocks';
import { stoneField } from './field';
import { FACE_H, FACE_W, FLAG, FLAT_A, PAGE, decodeRelief } from './format';
import { paintFace, paintGroundRows } from './paint';
import { MEAN_TOLERANCE, OLD_FLOOR, TILT_SHOWN } from './paintLaid';
import { noMarks, placeMarks } from './place';
import { planSheets } from './plan';
import { STONE_SEED, STONE_SPAWN, TORCH_TILES, stoneMap, zoneKinds } from './stoneMap';

/** 32 by 32 cells of floor: four ground pages of laid stone. */
const floorMap = (): TileMap => new TileMap(32, 32, new Uint8Array(32 * 32).fill(TILE_ID.Floor));
const SEED = 7;

function page(map: TileMap, cx: number, cz: number, seed = SEED, marks = noMarks(), kinds: Uint8Array | null = null): Uint8Array {
  const out = new Uint8Array(PAGE * PAGE * 4);
  paintGroundRows(stoneField(map, kinds, seed), map, marks, cx, cz, 0, PAGE, out);
  return out;
}
const flagAt = (p: Uint8Array, x: number, y: number): number => decodeRelief(p[(y * PAGE + x) * 4 + 3]).flag;

/** The stone page's level with its marks, as the page builds them. */
function stoneLevel() {
  const map = stoneMap(), f = stoneField(map, zoneKinds(map), STONE_SEED);
  const marks = placeMarks(map, f, { lights: TORCH_TILES.map(([x, y], i) => ({ id: i + 1, kind: LIGHT_KIND.Torch, x, y })), spawn: STONE_SPAWN });
  return { map, f, marks };
}

function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return h;
}

describe('the painter of laid stone', () => {
  it('paints a page the same twice', () => {
    const { map, f, marks } = stoneLevel();
    const a = new Uint8Array(PAGE * PAGE * 4), b = new Uint8Array(PAGE * PAGE * 4);
    paintGroundRows(f, map, marks, 2, 1, 0, PAGE, a);
    paintGroundRows(f, map, marks, 0, 0, 0, 64, new Uint8Array(PAGE * PAGE * 4)); // another page in between
    for (let r = 0; r < PAGE; r += 32) paintGroundRows(f, map, marks, 2, 1, r, r + 32, b); // in the job's slices
    expect(b.findIndex((x, i) => x !== a[i])).toBe(-1); // (`toEqual` on a megabyte is slow)
  });

  it('cuts no block at the edge two pages share: a groove on the seam lies only where two blocks meet', () => {
    const map = floorMap(), f = stoneField(map, null, SEED), marks = noMarks();
    const right = page(map, 1, 0), below = page(map, 0, 1);
    let meets = 0, stray = 0;
    for (let i = 0; i < PAGE; i++) {
      // the first column of the page to the right, against the last column of page (0, 0); then the same for rows
      for (const [here, there, flag, edge] of [
        [floorBlockAt(f, map, marks, PAGE, i)!, floorBlockAt(f, map, marks, PAGE - 1, i)!, flagAt(right, 0, i), 'v0'],
        [floorBlockAt(f, map, marks, i, PAGE)!, floorBlockAt(f, map, marks, i, PAGE - 1)!, flagAt(below, i, 0), 'u0'],
      ] as const) {
        if (here.id !== there.id) { meets++; expect(flag).toBe(FLAG.groove); }
        else if (i !== here[edge] && flag === FLAG.groove) stray++; // inside one block: only a crack may be a groove
      }
    }
    expect(meets).toBeGreaterThan(20);
    expect(stray).toBeLessThan(8);
  });

  it('leaves a px inside an untilted slab flat', () => {
    const map = floorMap(), f = stoneField(map, null, SEED), marks = noMarks(), p = page(map, 0, 0);
    let flat = 0;
    for (let y = 8; y < PAGE - 8; y += 3) for (let x = 8; x < PAGE - 8; x += 3) {
      const b = floorBlockAt(f, map, marks, x, y)!;
      if (Math.abs(b.tilt[0]) >= TILT_SHOWN || Math.abs(b.tilt[1]) >= TILT_SHOWN) continue;
      if (x - b.u0 < 4 || b.u1 - x < 5 || y - b.v0 < 4 || b.v1 - y < 5 || flagAt(p, x, y) !== FLAG.plain) continue; // off the bevel and the chips, not a crack
      const r = decodeRelief(p[(y * PAGE + x) * 4 + 3]);
      if (r.dhdu === 0 && r.dhdv === 0) { flat++; expect(p[(y * PAGE + x) * 4 + 3]).toBe(FLAT_A); }
    }
    expect(flat).toBeGreaterThan(200);
  });

  it('flags a joint px as a groove', () => {
    const map = floorMap(), f = stoneField(map, null, SEED), marks = noMarks(), p = page(map, 0, 0);
    for (const [x, y] of [[100, 100], [300, 200], [57, 400], [480, 30]]) {
      const b = floorBlockAt(f, map, marks, x, y)!;
      expect(flagAt(p, b.u0, y)).toBe(FLAG.groove);
      expect(flagAt(p, x, b.v0)).toBe(FLAG.groove);
    }
    // a wall face: the top of every course
    const wall = new TileMap(16, 16, new Uint8Array(256).fill(TILE_ID.Floor));
    wall.set(5, 5, TILE_ID.Wall);
    const face = new Uint8Array(FACE_W * FACE_H * 4);
    paintFace(stoneField(wall, null, SEED), wall, marks, { x: 5, z: 5, side: 0 }, face);
    for (const v of [0, 10, 21, 29, 41, 52]) for (let u = 0; u < FACE_W; u++) expect(decodeRelief(face[(v * FACE_W + u) * 4 + 3]).flag).toBe(FLAG.groove);
  });

  it('gives no px alpha 0, on floors, tops, rims, rock and faces', () => {
    const { map, f, marks } = stoneLevel();
    for (const [cx, cz] of [[0, 0], [1, 0], [2, 0], [2, 1], [3, 0]]) {
      const out = new Uint8Array(PAGE * PAGE * 4);
      paintGroundRows(f, map, marks, cx, cz, 0, PAGE, out);
      for (let i = 3; i < out.length; i += 4) if (out[i] === 0) throw new Error(`alpha 0 in page ${cx},${cz} at px ${(i - 3) / 4}`);
    }
    const plan = planSheets(map);
    let faces = 0;
    for (let cz = 0; cz < 2; cz++) for (let cx = 0; cx < 5; cx++) for (const face of plan.facesOf(cx, cz)) {
      const out = new Uint8Array(FACE_W * FACE_H * 4);
      paintFace(f, map, marks, face, out);
      for (let i = 3; i < out.length; i += 4) if (out[i] === 0) throw new Error(`alpha 0 in the face ${face.x},${face.z} side ${face.side}`);
      faces++;
    }
    expect(faces).toBeGreaterThan(100);
  });

  it('keeps the mean colour of a laid page near the old floor\'s warm brown-grey', () => {
    const p = page(floorMap(), 0, 0);
    const mean = [0, 0, 0];
    for (let i = 0; i < p.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += p[i + c] / (PAGE * PAGE);
    for (let c = 0; c < 3; c++) expect(Math.abs(mean[c] - OLD_FLOOR[c])).toBeLessThan(MEAN_TOLERANCE);
    expect(mean[0]).toBeGreaterThan(mean[2]); // warm
  });

  it('is pinned for the stone page\'s seed: the page with the summoning circle', () => {
    const { map, f, marks } = stoneLevel();
    const out = new Uint8Array(PAGE * PAGE * 4);
    paintGroundRows(f, map, marks, 2, 1, 0, PAGE, out);
    expect(fnv(out)).toBe(1442445131); // re-pinned whenever the laid look is tuned
  });
});
