import { describe, expect, it } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { CIRCLE_STONES, RUNE_RING, floorBlockAt } from './blocks';
import { ROCK, stoneField } from './field';
import { FACE_H, FACE_W, FLAG, FLAT_A, PAGE, decodeRelief } from './format';
import { paintFace, paintGroundRows } from './paint';
import { MEAN_TOLERANCE, OLD_FLOOR, RUNES, TILT_SHOWN } from './paintLaid';
import { VEIN } from './paintRock';
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
    expect(fnv(out)).toBe(921680116); // re-pinned whenever the laid look is tuned
    expect(RUNES.length).toBe(CIRCLE_STONES[RUNE_RING]); // one glyph per stone of the rune ring: what keeps the runes of a ring all different
  });
});

describe('the painter of natural rock', () => {
  const rockMap = (): TileMap => new TileMap(32, 16, new Uint8Array(32 * 16).fill(TILE_ID.Floor));
  const allRock = (map: TileMap): Uint8Array => new Uint8Array(map.w * map.h).fill(ROCK);

  it('paints a rock page the same twice, and its facets lean', () => {
    const { map, f, marks } = stoneLevel();
    const a = new Uint8Array(PAGE * PAGE * 4), b = new Uint8Array(PAGE * PAGE * 4);
    paintGroundRows(f, map, marks, 0, 0, 0, PAGE, a);
    paintGroundRows(f, map, marks, 1, 0, 0, 64, new Uint8Array(PAGE * PAGE * 4)); // another page in between
    for (let r = 0; r < PAGE; r += 32) paintGroundRows(f, map, marks, 0, 0, r, r + 32, b); // in the job's slices
    expect(b.findIndex((x, i) => x !== a[i])).toBe(-1);
    let leaning = 0;
    for (let i = 3; i < a.length; i += 4) if (a[i] !== FLAT_A) leaning++;
    expect(leaning).toBeGreaterThan(PAGE * PAGE / 4);
  });

  it('runs a facet on across the edge two pages share', () => {
    const map = rockMap(), kinds = allRock(map);
    const left = page(map, 0, 0, SEED, noMarks(), kinds), right = page(map, 1, 0, SEED, noMarks(), kinds);
    let same = 0, leaning = 0;
    for (let y = 0; y < PAGE; y++) {
      const a = left[(y * PAGE + PAGE - 1) * 4 + 3], b = right[y * PAGE * 4 + 3];
      if (a === b) same++; // the same facet: the same slope on both sides of the seam
      if (a !== FLAT_A) leaning++;
    }
    expect(same).toBeGreaterThan(PAGE * 0.85); // the rest: a facet edge that happens to run along the seam
    expect(leaning).toBeGreaterThan(PAGE / 4);
  });

  it('flags a px on a crevice\'s line as a pit on the ground and on a face of every side', () => {
    const map = rockMap();
    map.set(8, 8, TILE_ID.Wall);
    const marks = noMarks();
    // one crevice through the wall cell from north to south, one from west to east
    marks.crevices.push({ pts: [[8.5, 6], [8.5, 11]], branch: [], width: 0.1, depth: 0.3 }, { pts: [[6, 8.5], [11, 8.5]], branch: [], width: 0.1, depth: 0.3 });
    const f = stoneField(map, allRock(map), SEED), ground = page(map, 0, 0, SEED, marks, allRock(map));
    for (const [x, y] of [[272, 200], [272, 330], [200, 272], [330, 272]]) {
      expect(flagAt(ground, x, y)).toBe(FLAG.pit);
      expect([...ground.subarray((y * PAGE + x) * 4, (y * PAGE + x) * 4 + 3)]).toEqual([0, 0, 0]);
    }
    expect(flagAt(ground, 230, 230)).toBe(FLAG.plain);
    for (const side of [0, 1, 2, 3] as const) {
      const face = new Uint8Array(FACE_W * FACE_H * 4);
      paintFace(f, map, marks, { x: 8, z: 8, side }, face);
      const foot = ((FACE_H - 1) * FACE_W + 16) * 4; // the middle of the wall's foot, where the line meets it
      expect(decodeRelief(face[foot + 3]).flag).toBe(FLAG.pit);
      expect(face[foot]).toBe(0);
      expect(decodeRelief(face[((FACE_H - 1) * FACE_W + 4) * 4 + 3]).flag).not.toBe(FLAG.pit);
    }
  });

  it('paints a puddle\'s basin darker, with no groove or pit px inside it', () => {
    const { map, f, marks } = stoneLevel();
    expect(marks.puddles.length).toBeGreaterThan(0);
    const pages = new Map<number, Uint8Array>();
    const px = (u: number, v: number): Uint8Array => {
      const cx = u >> 9, cz = v >> 9;
      let p = pages.get(cz * 8 + cx);
      if (!p) { p = new Uint8Array(PAGE * PAGE * 4); paintGroundRows(f, map, marks, cx, cz, 0, PAGE, p); pages.set(cz * 8 + cx, p); }
      return p.subarray(((v & 511) * PAGE + (u & 511)) * 4, ((v & 511) * PAGE + (u & 511)) * 4 + 4);
    };
    for (const p of marks.puddles) {
      const cu = p.x * 32, cv = p.z * 32, r = p.r * 32;
      let inside = 0, n = 0, round = 0, m = 0;
      for (let v = Math.floor(cv - r - 12); v <= cv + r + 12; v++) for (let u = Math.floor(cu - r - 12); u <= cu + r + 12; u++) {
        const d = Math.hypot(u + 0.5 - cu, v + 0.5 - cv), t = px(u, v);
        if (d < r) { expect(decodeRelief(t[3]).flag).toBe(FLAG.plain); inside += t[0]; n++; }
        else if (d > r + 4 && d < r + 12) { round += t[0]; m++; }
      }
      expect(inside / n).toBeLessThan((round / m) * 0.9);
    }
  });

  it('draws mineral veins in rock only', () => {
    const { map, f, marks } = stoneLevel();
    const vein = (p: Uint8Array, i: number): boolean => p[i] === VEIN[0] && p[i + 1] === VEIN[1] && p[i + 2] === VEIN[2];
    let veins = 0;
    for (const cx of [0, 1, 2]) { // the cave, the border passage, the laid hall
      const p = new Uint8Array(PAGE * PAGE * 4);
      paintGroundRows(f, map, marks, cx, 0, 0, PAGE, p);
      for (let y = 0; y < PAGE; y++) for (let x = 0; x < PAGE; x++) if (vein(p, (y * PAGE + x) * 4)) {
        veins++;
        expect(floorBlockAt(f, map, marks, cx * PAGE + x, y)).toBeNull();
      }
    }
    expect(veins).toBeGreaterThan(30);
  });
});
