import { describe, expect, it, vi } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { cloudCount } from './moodmath';
import { Mood, type AirTorch } from './mood';
import { TERRAIN } from './terrain';

// terrain.ts and torch.ts import Phaser, which needs a browser window; Mood itself only uses it for types.
vi.mock('phaser', () => ({ default: {} }));

/** A chainable stub for any game object: every method returns itself, `destroy` is counted. */
function fakeScene() {
  const made: { destroyed: number }[] = [];
  const mk = () => {
    const o: Record<string, unknown> = { destroyed: 0 };
    const self: unknown = new Proxy(o, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => {
        if (k === 'destroy') (t.destroyed as number)++;
        return k === 'getContext' ? a : self;
      }),
    });
    made.push(o as { destroyed: number });
    return self;
  };
  const scene = { add: { image: mk, tileSprite: mk, graphics: mk }, textures: { exists: () => true } } as never;
  return { scene, made };
}

const view = (w = 640, h = 360, x = 0, y = 0) => ({ x, y, width: w, height: h, right: x + w, bottom: y + h }) as never;

function setup(w: number, h: number, tile: number, lit = 1) {
  const map = new TileMap(w, h, new Uint8Array(w * h).fill(tile));
  const light = { light: new Float32Array(w * h * 3).fill(255), seenLit: new Uint8Array(w * h).fill(lit) };
  const { scene, made } = fakeScene();
  const mood = new Mood(scene, map, light as never);
  return { map, light, mood, made, scene };
}

const run = (mood: Mood, secs: number, torches: AirTorch[] = [], shots: { x: number; y: number; kind: number }[] = [], v = view()) => {
  for (let i = 0; i < secs * 60; i++) mood.update(1 / 60, v, torches, shots);
};

describe('Mood', () => {
  it('keeps as many dust clouds as the view area asks for', () => {
    const { mood } = setup(60, 40, TILE_ID.Floor);
    mood.update(1 / 60, view(), [], []);
    expect(mood.counts.clouds).toBe(cloudCount(640, 360));
    expect(mood.counts.clouds).toBe(24);
    mood.update(1 / 60, view(160, 160), [], []);
    expect(mood.counts.clouds).toBe(4);
  });

  it('respects the caps on smoke, embers and drips', () => {
    const lava = setup(60, 40, TERRAIN.Lava);
    let smoke = 0;
    let embers = 0;
    for (let i = 0; i < 60 * 60; i++) {
      lava.mood.update(1 / 60, view(), [], []);
      smoke = Math.max(smoke, lava.mood.counts.smoke);
      embers = Math.max(embers, lava.mood.counts.embers);
    }
    expect(smoke).toBeGreaterThan(0);
    expect(smoke).toBeLessThanOrEqual(200);
    expect(embers).toBeGreaterThan(0);
    expect(embers).toBeLessThanOrEqual(160);
    const water = setup(60, 40, TERRAIN.Shallow);
    let drips = 0;
    for (let i = 0; i < 60 * 60; i++) {
      water.mood.update(1 / 60, view(), [], []);
      drips = Math.max(drips, water.mood.counts.drips);
    }
    expect(drips).toBeGreaterThan(0);
    expect(drips).toBeLessThanOrEqual(12);
  });

  it('forgets lava that turned to floor once the old puffs are gone', () => {
    const { map, mood } = setup(30, 20, TERRAIN.Lava);
    run(mood, 3);
    expect(mood.counts.smoke).toBeGreaterThan(0);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) map.set(x, y, TILE_ID.Floor);
    mood.mapChanged();
    run(mood, 10);
    expect(mood.counts.smoke).toBe(0);
    expect(mood.counts.embers).toBe(0);
  });

  it('smokes only from lit torches whose tile is seen and lit', () => {
    const torch: AirTorch = { x: 5.5 * TILE, y: 5.5 * TILE, side: 0, lit: true };
    const dark = setup(20, 20, TILE_ID.Floor, 0);
    run(dark.mood, 3, [torch]);
    expect(dark.mood.counts.smoke).toBe(0);
    const seen = setup(20, 20, TILE_ID.Floor, 0);
    seen.light.seenLit[5 * 20 + 5] = 1;
    run(seen.mood, 3, [torch]);
    expect(seen.mood.counts.smoke).toBeGreaterThan(0);
    const out = setup(20, 20, TILE_ID.Floor, 1);
    run(out.mood, 3, [{ ...torch, lit: false }]);
    expect(out.mood.counts.smoke).toBe(0);
  });

  it('throws a blast burst once, not every frame', () => {
    const { mood } = setup(20, 20, TILE_ID.Floor);
    run(mood, 0.4, [], [{ x: 100, y: 100, kind: LIGHT_KIND.Blast }]);
    expect(mood.counts.embers).toBe(18);
  });

  it('trails embers behind a fire shot', () => {
    const { mood } = setup(20, 20, TILE_ID.Floor);
    run(mood, 0.5, [], [{ x: 100, y: 100, kind: LIGHT_KIND.Fire }]);
    expect(mood.counts.embers).toBeGreaterThan(5);
  });

  it('can be built twice on one scene and destroyed twice', () => {
    const a = setup(10, 10, TILE_ID.Floor);
    const map = new TileMap(10, 10, new Uint8Array(100));
    expect(() => new Mood(a.scene, map, a.light as never)).not.toThrow();
    run(a.mood, 1);
    a.mood.destroy();
    expect(() => a.mood.destroy()).not.toThrow();
    expect(a.made.every((o) => o.destroyed <= 1)).toBe(true);
  });
});
