import { describe, expect, it } from 'vitest';
import { LIGHT, LIGHT_KIND, TILE_ID } from '../generated/defs';
import type { EntSnap } from '../generated/EntSnap';
import type { MovingLight } from '../generated/MovingLight';
import { LightField } from '../game/light';
import type { EntState } from '../game/world';
import { TileMap } from '../sim/map';
import type { Cam } from './camera';
import { CARRY_PX, DAYLIGHT_Y, FLASH_Y, LIGHT_MARGIN, footprint, lightFlicker, lightRgb, movingCands, selectLights, staticCands, TorchPairs, type Cand } from './lights';
import { TORCH_MID } from './figures';

const mapOf = (rows: string[]): TileMap => {
  const w = rows[0].length;
  return new TileMap(w, rows.length, Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? TILE_ID.Wall : TILE_ID.Floor))));
};
const open = (): TileMap => mapOf(Array.from({ length: 12 }, () => '.'.repeat(12)));

const torchEnt = (id: number, x: number, y: number, extra: number): EntState => ({
  id, kind: 0, x, y, hp: 1, anim: 1, aim: 0, animMs: 0, flags: 0, extra, effects: 0, side: 0, entangled: 0,
});

describe('lightFlicker and lightRgb', () => {
  it('leaves daylight steady and gives lava a third of the torch swing', () => {
    for (const t of [0, 0.7, 12.3]) expect(lightFlicker(LIGHT_KIND.Daylight, t, 0)).toBe(1);
    const ratio = LIGHT[LIGHT_KIND.Lava].flicker / LIGHT[LIGHT_KIND.Torch].flicker;
    expect(ratio).toBeCloseTo(1 / 3, 6);
    const dev = (kind: number): number => Math.abs(lightFlicker(kind, 0.37, 1.1) - 1);
    expect(dev(LIGHT_KIND.Lava)).toBeCloseTo(dev(LIGHT_KIND.Torch) * ratio, 9);
  });
  it('colours a torch (1.2, 0.8, 0.42)', () => {
    const c = lightRgb(LIGHT_KIND.Torch, null, 1);
    expect(c[0]).toBeCloseTo(1.2, 2);
    expect(c[1]).toBeCloseTo(0.8, 2);
    expect(c[2]).toBeCloseTo(0.42, 2);
  });
  it('takes an explicit colour and a scale', () => {
    const c = lightRgb(LIGHT_KIND.Torch, 0xff0000, 0.5);
    expect(c[0]).toBeCloseTo(0.6, 6);
    expect(c[1]).toBe(0);
  });
});

describe('TorchPairs', () => {
  it('remembers a seen Face torch', () => {
    const tp = new TorchPairs();
    const map = open();
    tp.see(torchEnt(7, (3 + 0.5) * 16, (4 + 1) * 16 + 0.5, 0));
    const w = tp.wallOf({ id: 1, kind: 0, colour: 0, x: 3, y: 5, on: true }, map);
    expect(w.nz).toBe(1);
    expect(w.nx).toBe(0);
    expect(w.z).toBe(5);
    expect(w.x).toBeCloseTo(3.5, 6);
    expect(w.phase).toBeCloseTo(7 * 1.7, 9);
  });
  it('remembers West and East sides', () => {
    const tp = new TorchPairs();
    const map = open();
    tp.see(torchEnt(1, 3 * 16 + 0.5, 5.5 * 16, 1));
    tp.see(torchEnt(2, 8 * 16 + 15.5, 5.5 * 16, 2));
    const west = tp.wallOf({ id: 1, kind: 0, colour: 0, x: 3, y: 5, on: true }, map);
    expect(west.nx).toBe(1);
    expect(west.x).toBe(3);
    const east = tp.wallOf({ id: 2, kind: 0, colour: 0, x: 8, y: 5, on: true }, map);
    expect(east.nx).toBe(-1);
    expect(east.x).toBe(9);
  });
  it('guesses from the walls when unseen', () => {
    const tp = new TorchPairs();
    const north = mapOf(['....', '.#..', '....']);
    const a = tp.wallOf({ id: 3, kind: 0, colour: 0, x: 1, y: 2, on: true }, north);
    expect(a.nz).toBe(1);
    expect(a.z).toBe(2);
    expect(a.phase).toBeCloseTo(3 * 1.7, 9);
    const west = mapOf(['....', '#...', '....']);
    const b = tp.wallOf({ id: 4, kind: 0, colour: 0, x: 1, y: 1, on: true }, west);
    expect(b.nx).toBe(1);
    expect(b.x).toBe(1);
    const east = mapOf(['....', '..#.', '....']);
    const c = tp.wallOf({ id: 5, kind: 0, colour: 0, x: 1, y: 1, on: true }, east);
    expect(c.nx).toBe(-1);
    expect(c.x).toBe(2);
    const none = tp.wallOf({ id: 6, kind: 0, colour: 0, x: 1, y: 1, on: true }, open());
    expect(none.x).toBeCloseTo(1.5, 6);
    expect(none.z).toBeCloseTo(1.5, 6);
  });
});

describe('staticCands', () => {
  it('skips lava and lights that are off, and brings a torch back when it is turned on', () => {
    const map = open();
    const field = new LightField(map);
    field.add({ id: 1, kind: LIGHT_KIND.Torch, colour: LIGHT[0].colour, x: 4, y: 4, on: true });
    field.add({ id: 2, kind: LIGHT_KIND.Lava, colour: LIGHT[1].colour, x: 6, y: 6, on: true });
    field.add({ id: 3, kind: LIGHT_KIND.Fire, colour: LIGHT[2].colour, x: 8, y: 8, on: false });
    const tp = new TorchPairs();
    expect(staticCands(field, tp, map, 0).map((c) => c.id)).toEqual(['s1']);
    field.set(1, false, LIGHT[0].colour);
    expect(staticCands(field, tp, map, 0)).toEqual([]);
    field.set(1, true, LIGHT[0].colour);
    expect(staticCands(field, tp, map, 0).map((c) => c.id)).toEqual(['s1']);
  });
  it('puts a torch at its flame and the other kinds at the tile centre', () => {
    const map = open();
    const field = new LightField(map);
    field.add({ id: 1, kind: LIGHT_KIND.Torch, colour: LIGHT[0].colour, x: 3, y: 5, on: true });
    field.add({ id: 2, kind: LIGHT_KIND.Daylight, colour: 0xffffff, x: 6, y: 6, on: true });
    field.add({ id: 3, kind: LIGHT_KIND.Fire, colour: LIGHT[2].colour, x: 8, y: 8, on: true });
    const tp = new TorchPairs();
    tp.see(torchEnt(7, 3.5 * 16, 5 * 16 + 0.5, 0));
    const [torch, day, fire] = staticCands(field, tp, map, 0);
    expect(torch.x).toBeCloseTo(3.5, 1);
    expect(torch.z).toBeCloseTo(5.1, 1);
    expect(torch.y).toBeCloseTo(TORCH_MID, 1);
    expect(torch.shadow).toBe(true);
    expect(torch.radius).toBe(LIGHT[0].radius);
    expect(torch.skip).toBe(-1);
    expect(day.y).toBe(DAYLIGHT_Y);
    expect([day.x, day.z]).toEqual([6.5, 6.5]);
    expect(fire.y).toBe(1);
    expect([fire.x, fire.z]).toEqual([8.5, 8.5]);
  });
});

describe('movingCands', () => {
  const ent = (id: number, px: number, py: number): EntSnap => [id, 2, px, py, 255, 0, 0, 0, 0, 0, 0, 0];
  it('moves a carried light with its entity', () => {
    const snap: MovingLight[] = [[100 + 1, 100, LIGHT_KIND.Magic, null]];
    const ents = [ent(9, 100, 100)];
    const out = movingCands(snap, ents, (id) => (id === 9 ? { id: 9, x: 3, z: 4, y: 0.6 } : null), 0);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('m9');
    expect(out[0].x).toBeCloseTo(3 + 1 / 16, 6);
    expect(out[0].z).toBeCloseTo(4, 6);
    expect(out[0].y).toBe(0.6);
  });
  it('leaves an uncarried light at its snapshot spot', () => {
    const far = CARRY_PX + 20;
    const snap: MovingLight[] = [[160, 80, LIGHT_KIND.Blast, null], [32, 48, LIGHT_KIND.Magic, null]];
    const out = movingCands(snap, [ent(9, 160 + far, 80)], () => ({ id: 9, x: 99, z: 99, y: 0 }), 0);
    expect(out[0].x).toBeCloseTo(10, 6);
    expect(out[0].z).toBeCloseTo(5, 6);
    expect(out[0].y).toBe(FLASH_Y);
    expect(out[1].y).toBe(0.5);
    expect(out[0].id).not.toBe(out[1].id);
    expect(out[0].id.startsWith('m')).toBe(true);
  });
});

describe('footprint', () => {
  it('boxes the ground under the screen corners', () => {
    const cam: Cam = { x: 10, z: 10, pitch: Math.PI / 3, yaw: 0 };
    const fp = footprint(cam, 8, 4);
    expect(fp.x0).toBeCloseTo(2, 6);
    expect(fp.x1).toBeCloseTo(18, 6);
    expect(fp.z0).toBeCloseTo(10 - 4 / Math.sin(Math.PI / 3), 6);
    expect(fp.z1).toBeCloseTo(10 + 4 / Math.sin(Math.PI / 3), 6);
  });
});

describe('selectLights', () => {
  const cand = (id: string, x: number, z: number, radius = 3, r = 1): Cand => ({ id, kind: 0, x, y: 1, z, radius, r, g: 0, b: 0, shadow: true, skip: -1 });
  const fp = { x0: 0, z0: 0, x1: 20, z1: 20 };
  const twenty = Array.from({ length: 20 }, (_, i) => cand(`s${i}`, 5 + (i % 5) * 2, 5 + Math.floor(i / 5) * 2));
  it('caps equal lights deterministically in any order', () => {
    const a = selectLights(twenty, fp, { x: 10, z: 10 }, 16);
    const b = selectLights([...twenty].reverse(), fp, { x: 10, z: 10 }, 16);
    expect(a.list.length).toBe(16);
    expect(a.inView).toBe(20);
    expect(b.list.map((c) => c.id)).toEqual(a.list.map((c) => c.id));
  });
  it('drops a light whose reach ends outside the footprint', () => {
    const outside = cand('far', 30, 10, 3);
    const edge = cand('edge', 23.6, 10, 3);
    const touching = cand('touch', 23.4, 10, 3);
    const out = selectLights([outside, edge, touching], fp, { x: 0, z: 0 }, 16);
    expect(out.list.map((c) => c.id)).toEqual(['touch']);
    expect(out.inView).toBe(1);
    expect(3 + LIGHT_MARGIN).toBe(3.5);
  });
  it('prefers the light with the focus in reach', () => {
    const near = cand('b', 10, 10, 3);
    const other = cand('a', 15, 15, 3);
    const out = selectLights([other, near], fp, { x: 10, z: 10 }, 1);
    expect(out.list[0].id).toBe('b');
  });
});
