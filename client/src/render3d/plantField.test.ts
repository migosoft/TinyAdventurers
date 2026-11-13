import { describe, expect, it } from 'vitest';
import type { PlantInfo } from '../generated/PlantInfo';
import { DEFAULT_LIGHT, PLANT_KINDS } from '../game/vegetation';
import { PlantField, type PlantChunk } from './plantField';
import { CHUNK } from './worldMesh';

const MAP = { w: 64, h: 32 };
const kind = (k: string): number => PLANT_KINDS.indexOf(k as never);
/** [kind, x px, y px, seed, scale %, mirrored]: tile (tx, tz) at its bottom. */
const at = (k: string, tx: number, tz: number, seed: number, scale = 100, mirrored = false): PlantInfo => [kind(k), tx * 16 + 8, tz * 16 + 12, seed, scale, mirrored];

const all = (f: ReturnType<PlantField['frame']>): PlantChunk[] => [...f.chunks.values()].flat();

function drawAll(f: PlantField, cam = { x: 0, z: 0 }): void {
  for (let i = 0; i < 1000 && f.drawn < f.total; i++) f.step(cam, 1000);
}

describe('PlantField', () => {
  const plants: PlantInfo[] = [at('bush', 2, 2, 1), at('bush', 40, 3, 2), at('round', 20, 20, 3)];

  it('has nothing before the first step (the first frames of a run)', () => {
    const f = new PlantField(plants, MAP, DEFAULT_LIGHT);
    const fr = f.frame(true, 0);
    expect(fr.chunks.size).toBe(0);
    expect(fr.versions.size).toBe(0);
    expect(fr.pages).toHaveLength(0);
    expect(f.drawn).toBe(0);
    expect(f.total).toBe(3);
  });

  it('puts every plant in exactly one chunk once all are drawn', () => {
    const f = new PlantField(plants, MAP, DEFAULT_LIGHT);
    drawAll(f);
    expect(f.drawn).toBe(3);
    const fr = f.frame(true, 0);
    // The bush at (2,2), the bush at (40,3) and the round tree at (20,20) lie in three different chunks.
    expect(fr.chunks.size).toBe(3);
    const nx = Math.ceil(MAP.w / CHUNK);
    expect([...fr.chunks.keys()].sort((a, b) => a - b)).toEqual([
      Math.floor(2 / CHUNK), Math.floor(3 / CHUNK) * nx + Math.floor(40 / CHUNK), Math.floor(20 / CHUNK) * nx + Math.floor(20 / CHUNK),
    ].sort((a, b) => a - b));
    // Every plant has a card; the roots of a tree make a decal quad in the same buffer.
    const quads = all(fr).reduce((s, c) => s + c.cards.n / 6, 0);
    expect(quads).toBeGreaterThanOrEqual(3);
    for (const c of all(fr)) expect(c.page).toBeGreaterThanOrEqual(0);
  });

  it('lets two equal plants share one image on one page', () => {
    const twins: PlantInfo[] = [at('round', 5, 5, 9, 100), at('round', 6, 8, 9, 100, true), at('round', 7, 9, 9, 100)];
    const f = new PlantField(twins, MAP, DEFAULT_LIGHT);
    drawAll(f);
    const fr = f.frame(false, 0);
    expect(fr.pages).toHaveLength(1);
    const one = new PlantField([twins[0]], MAP, DEFAULT_LIGHT);
    drawAll(one);
    // The same rect for all three: the uv origin of the first quad repeats (mirroring only swaps the columns).
    const uvs = new Set<string>();
    for (const c of all(fr)) for (let i = 0; i < c.cards.n; i++) uvs.add(`${c.cards.uv[i * 2 + 1]}`);
    const solo = new Set<string>();
    for (const c of all(one.frame(false, 0))) for (let i = 0; i < c.cards.n; i++) solo.add(`${c.cards.uv[i * 2 + 1]}`);
    expect(uvs).toEqual(solo);
  });

  it('draws the plant nearest the camera first', () => {
    const f = new PlantField(plants, MAP, DEFAULT_LIGHT);
    expect(f.step({ x: 20.5, z: 20 }, 0)).toBe(1); // the first job always runs
    const fr = f.frame(true, 0);
    expect(fr.chunks.size).toBe(1);
    const nx = Math.ceil(MAP.w / CHUNK);
    expect([...fr.chunks.keys()]).toEqual([Math.floor(20 / CHUNK) * nx + Math.floor(20 / CHUNK)]);
    expect(f.drawn).toBe(1);
  });

  it('re-sorts after the camera moved four tiles', () => {
    const f = new PlantField(plants, MAP, DEFAULT_LIGHT);
    f.step({ x: 2, z: 2 }, 0); // the bush at (2,2)
    f.step({ x: 41, z: 3 }, 0); // far from where it was sorted: the bush at (40,3) is next
    const nx = Math.ceil(MAP.w / CHUNK);
    expect(new Set(f.frame(true, 0).chunks.keys())).toEqual(new Set([0, Math.floor(3 / CHUNK) * nx + Math.floor(40 / CHUNK)]));
  });

  it('bumps a chunk version only when a plant was added to it', () => {
    const f = new PlantField(plants, MAP, DEFAULT_LIGHT);
    f.step({ x: 2, z: 2 }, 0);
    const v1 = new Map(f.frame(true, 0).versions);
    f.step({ x: 2, z: 2 }, 0);
    const v2 = f.frame(true, 0).versions;
    const changed = [...v2].filter(([k, v]) => v1.get(k) !== v);
    expect(changed).toHaveLength(1); // the second plant's chunk is new, the first one's is untouched
    const first = [...v1.keys()][0];
    expect(v2.get(first)).toBe(v1.get(first));
    // Nothing left to draw: stepping again changes nothing.
    drawAll(f, { x: 2, z: 2 });
    const v3 = new Map(f.frame(true, 0).versions);
    expect(f.step({ x: 2, z: 2 }, 1000)).toBe(0);
    expect(new Map(f.frame(true, 0).versions)).toEqual(v3);
  });

  it('bumps the page version when an image was drawn into it', () => {
    const f = new PlantField(plants, MAP, DEFAULT_LIGHT);
    f.step({ x: 2, z: 2 }, 0);
    const v = f.frame(true, 0).pages[0].version;
    expect(v).toBeGreaterThan(0);
    expect(f.frame(true, 0).pages[0].size).toBe(1024);
    expect(f.frame(true, 0).pages[0].data.length).toBe(1024 * 1024 * 4);
    f.step({ x: 2, z: 2 }, 0);
    expect(f.frame(true, 0).pages[0].version).toBeGreaterThan(v);
  });

  it('hands the wind switch and the time through', () => {
    const f = new PlantField(plants, MAP, DEFAULT_LIGHT);
    const fr = f.frame(true, 12.5);
    expect([fr.wind, fr.t]).toEqual([true, 12.5]);
  });

  it('gives a leafy tree clump discs and a trunk caster, a bare tree its whole card as caster and no discs', () => {
    const f = new PlantField([at('round', 10, 10, 4), at('bare', 30, 10, 5)], MAP, DEFAULT_LIGHT);
    drawAll(f);
    const fr = f.frame(true, 0);
    const [round] = fr.chunks.get(0)!, [bare] = fr.chunks.get(1)!;
    expect(round.clumps.n).toBeGreaterThan(0);
    expect(round.trunks.n).toBe(6);
    expect(bare.clumps.n).toBe(0);
    expect(bare.trunks.n).toBe(6);
  });
});

describe('PlantField.fromAtlas', () => {
  it('puts every item in its chunk at once, on page -1, with no pages', () => {
    const sprite = { page: -1, rect: { x: 0, y: 0, w: 96, h: 100 }, foot: { x: 48, y: 80 }, shape: null };
    const f = PlantField.fromAtlas([
      { place: { x: 3, z: 4, mirrored: false, amp: 0.11, seed: 1 }, sprite },
      { place: { x: 40, z: 20, mirrored: true, amp: 0.11, seed: 2 }, sprite },
    ], MAP);
    const fr = f.frame(false, 0);
    expect(fr.pages).toHaveLength(0);
    expect(f.drawn).toBe(2);
    expect(f.total).toBe(2);
    expect(fr.chunks.size).toBe(2);
    for (const c of all(fr)) expect(c.page).toBe(-1);
    expect(f.step({ x: 0, z: 0 }, 1000)).toBe(0);
  });
});
