import { beforeEach, describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { newGlowBuf } from '../cards';
import { Effects3d, clearFxRegistry, type FxFrame } from './effects3d';
import { FIELD_BURST, drawField, fieldBurst, registerField } from './field';
import { FxTris } from './tris';
import type { FxOut } from './types';

const cells: [number, number][] = [[3, 2], [4, 2]];
const mapOf = (): TileMap => {
  const t = new Uint8Array(8 * 6).fill(TILE_ID.Floor);
  for (const [x, z] of cells) t[z * 8 + x] = TILE_ID.DoorClosed;
  return new TileMap(8, 6, t);
};
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [] });
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const frameOf = (now: number): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(), you: 0, ownCast: null,
});
const ax = { right: [1, 0, 0] as const, up: [0, 1, 0] as const };

beforeEach(() => { clearFxRegistry(); registerField(); });

describe('force field fx', () => {
  it('glitter burst on appear', () => {
    const T = new FxTris(1000);
    fieldBurst(T, ax, cells, 0.05, 7);
    expect(T.n).toBe(FIELD_BURST * 2);
    T.clear();
    fieldBurst(T, ax, cells, 1, 7);
    expect(T.n).toBe(0);
  });

  it('old fields do not fade in', () => {
    const fx = new Effects3d(mapOf());
    expect(fx.fieldAge(0)).toBeGreaterThanOrEqual(10);
    expect(fx.fieldAge(123)).toBeGreaterThanOrEqual(10);
    const out = newOut();
    fx.frame(frameOf(5), out);
    const steady = out.tris.n;
    expect(steady).toBeGreaterThan(0);
    expect(steady).toBeLessThan(FIELD_BURST * 2 * 2);
  });

  it('a closing door starts the field at age 0 with the burst', () => {
    const fx = new Effects3d(mapOf());
    fx.tileChanged(5, 2, TILE_ID.DoorClosed, 20);
    expect(fx.fieldAge(20.05)).toBeCloseTo(0.05, 9);
    const young = newOut(), old = newOut();
    fx.frame(frameOf(20.05), young);
    const fx2 = new Effects3d(mapOf());
    fx2.frame(frameOf(20.05), old);
    expect(young.tris.n).toBeGreaterThanOrEqual(old.tris.n + FIELD_BURST * 2);
    const later = newOut();
    fx.frame(frameOf(22), later);
    expect(later.tris.n).toBeLessThan(young.tris.n);
  });

  it('draws nothing when no cell is sealed', () => {
    const fx = new Effects3d(new TileMap(4, 4, new Uint8Array(16).fill(TILE_ID.Floor)));
    const out = newOut();
    fx.frame(frameOf(3), out);
    expect(out.tris.n).toBe(0);
    expect(typeof drawField).toBe('function');
  });
});
