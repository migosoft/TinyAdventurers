import { describe, expect, it, vi } from 'vitest';
import { LIGHT_KIND } from '../generated/defs';
import { DEPTH } from './effects';
import { Sunbeams } from './sunbeams';

vi.mock('phaser', () => ({ default: {} }));

interface Obj {
  depth: number;
  visible: boolean;
  destroyed: number;
}

/** A chainable stub for any game object; depth, visibility and destroy calls are recorded. */
function fakeScene() {
  const made: Obj[] = [];
  const existing = new Set<string>();
  const mk = () => {
    const o: Record<string, unknown> = { depth: 0, visible: true, destroyed: 0 };
    const self: unknown = new Proxy(o, {
      get: (t, k: string) => {
        if (k in t) return t[k];
        return (...a: unknown[]) => {
          if (k === 'setDepth') t.depth = a[0];
          if (k === 'setVisible') t.visible = a[0];
          if (k === 'destroy') (t.destroyed as number)++;
          return self;
        };
      },
    });
    made.push(o as unknown as Obj);
    return self;
  };
  const textures = {
    exists: (key: string) => existing.has(key),
    createCanvas: (key: string) => {
      existing.add(key);
      const ctx: unknown = new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => ctx) });
      return { getContext: () => ctx, refresh: () => undefined, setFilter: () => undefined };
    },
  };
  return { scene: { add: { image: mk, graphics: mk }, textures } as never, made };
}

const W = 40;
const H = 30;
const view = { x: 0, y: 0, width: 640, height: 360, right: 640, bottom: 360 } as never;

function setup(lit = 1) {
  const { scene, made } = fakeScene();
  const lights = new Map<number, { id: number; kind: number; colour: number; x: number; y: number; on: boolean }>();
  lights.set(1, { id: 1, kind: LIGHT_KIND.Daylight, colour: 0xfff0b0, x: 10, y: 8, on: true });
  lights.set(2, { id: 2, kind: LIGHT_KIND.Torch, colour: 0xffaa55, x: 12, y: 8, on: true });
  const light = { w: W, light: new Float32Array(W * H * 3), seenLit: new Uint8Array(W * H) };
  light.seenLit[8 * W + 10] = lit;
  light.seenLit.fill(lit);
  const sb = new Sunbeams(scene, { lights } as never, light as never);
  const shown = () => made.filter((o) => o.visible).length;
  return { sb, made, lights, light, shown };
}

describe('Sunbeams', () => {
  it('draws only daylight lights whose tile is seen and lit, under the darkness', () => {
    const lit = setup(1);
    lit.sb.update(1 / 60, view, 3);
    // beam + patch + 24 motes for the one daylight light, none for the torch
    expect(lit.shown()).toBe(26);
    for (const o of lit.made) expect(o.depth).toBeLessThan(DEPTH.fog);
    const dark = setup(0);
    dark.sb.update(1 / 60, view, 3);
    expect(dark.shown()).toBe(0);
    dark.light.seenLit.fill(1);
    dark.sb.update(1 / 60, view, 3);
    expect(dark.shown()).toBe(26);
    dark.lights.get(1)!.on = false;
    dark.sb.update(1 / 60, view, 3);
    expect(dark.shown()).toBe(0);
  });

  it('hides a beam outside the view', () => {
    const s = setup(1);
    s.lights.get(1)!.x = 35;
    s.sb.update(1 / 60, { x: 0, y: 0, width: 200, height: 360, right: 200, bottom: 360 } as never, 3);
    expect(s.shown()).toBe(0);
  });

  it('rebuilds_on_light_changes_and_destroys_everything', () => {
    const s = setup(1);
    s.sb.update(1 / 60, view, 3);
    s.lights.set(3, { id: 3, kind: LIGHT_KIND.Daylight, colour: 0xfff0b0, x: 14, y: 9, on: true });
    s.sb.update(1 / 60, view, 3);
    expect(s.shown()).toBe(52);
    s.lights.delete(3);
    s.sb.update(1 / 60, view, 3);
    expect(s.shown()).toBe(26);
    const made = s.made.length;
    for (let i = 0; i < 120; i++) s.sb.update(1 / 60, view, 3 + i / 60);
    expect(s.made.length).toBe(made);
    s.sb.destroy();
    for (const o of s.made) expect(o.destroyed).toBeGreaterThanOrEqual(1);
  });

  it('hides the motes over tiles that are not seen and lit', () => {
    const s = setup(1);
    s.sb.update(1 / 60, view, 3);
    s.light.seenLit.fill(0);
    s.light.seenLit[8 * W + 10] = 1;
    for (let i = 0; i < 60; i++) s.sb.update(1 / 60, view, 3 + i / 60);
    expect(s.shown()).toBeLessThan(26);
    expect(s.shown()).toBeGreaterThanOrEqual(2);
  });
});
