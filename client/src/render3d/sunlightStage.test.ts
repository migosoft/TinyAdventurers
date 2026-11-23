// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { KIND, LIGHT_KIND } from '../generated/defs';
import { TILE } from '../sim/map';
import { SECOND, SUN, SUNLIGHT_H, SUNLIGHT_W, sunlightMap } from '../game/sunlightDemoScript';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import type { PageButton } from './panel';
import { createSunlightStage, parseSunLook, sunlightEnts } from './sunlightStage';
import type { FrameInput } from './view';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`npc_knight_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const assets = { image: {} as HTMLImageElement, frames };

/** The stages a test made: each is disposed (its caption removed) when the test ends. */
const made: Stage[] = [];
afterEach(() => {
  for (const s of made.splice(0)) s.dispose();
});

function make(search: string): { stage: Stage; draw: (now?: number) => FrameInput; params: R3dParams } {
  const params = parseParams(search);
  const stage = createSunlightStage(assets, params, search);
  made.push(stage);
  const draw = (now = 0): FrameInput => {
    let f: FrameInput | null = null;
    const view = { draw: (i: FrameInput) => ((f = i), 0) };
    const zoom = 2;
    stage.frame({
      now, dt: 0.05, params, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom,
      plan: { ...renderPlan('balanced', zoom, 1280, 720), halfW: 40, halfH: 40 }, canvasEl: null, view, timer: { lap() {}, renderStart() {} },
    } as unknown as StageCtx);
    return f!;
  };
  return { stage, draw, params };
}

const key = (stage: Stage, code: string): boolean => stage.key!({ code, repeat: false } as KeyboardEvent);

describe('the ?r3d=sunlight stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=sunlight')).toBe('sunlight');
    expect(isR3dDemo('?r3d=sunlight')).toBe(true);
  });

  it("shows the script's room and the crack at SUN", () => {
    const { stage, draw } = make('?r3d=sunlight');
    expect(stage.world.map.w).toBe(SUNLIGHT_W);
    expect(stage.world.map.h).toBe(SUNLIGHT_H);
    expect(Array.from(stage.world.map.tiles)).toEqual(Array.from(sunlightMap().tiles));
    const f = draw();
    expect(f.cracks).toHaveLength(1);
    expect(f.cracks![0].fx).toBe(SUN.x + 0.5);
    expect(f.cracks![0].fz).toBe(SUN.y + 0.5);
    expect(f.shafts).toBe(true);
  });

  it('draws two knights, the lit and the dead torch', () => {
    const e = sunlightEnts();
    expect(e.filter((x) => x.kind === KIND.Knight)).toHaveLength(2);
    const t = e.filter((x) => x.kind === KIND.Torch);
    expect(t.map((x) => x.anim)).toEqual([0, 1]);
  });

  it('gives every torch entity a field light on its tile, on its wall, lit as it is (#391)', () => {
    const { stage } = make('?r3d=sunlight');
    for (const e of sunlightEnts().filter((x) => x.kind === KIND.Torch)) {
      const l = stage.world.taken!.lights.find((x) => x.kind === LIGHT_KIND.Torch && x.x === Math.floor(e.x / TILE) && x.y === Math.floor(e.y / TILE));
      expect(l?.wall).toBe(e.extra + 1);
      expect((l as { on?: boolean } | undefined)?.on).toBe(e.anim === 1);
    }
  });

  it('has one crack, two after 2 (the second at SECOND), one again after 2', () => {
    const { stage, draw } = make('?r3d=sunlight');
    expect(draw().cracks).toHaveLength(1);
    expect(key(stage, 'Digit2')).toBe(true);
    const two = draw().cracks!;
    expect(two).toHaveLength(2);
    expect(two.some((c) => c.fx === SECOND.x + 0.5 && c.fz === SECOND.y + 0.5)).toBe(true);
    key(stage, 'Digit2');
    expect(draw().cracks).toHaveLength(1);
  });

  it('gives the panel Second crack, Reroll and Vary, which act as the keys 2, R and V; a key syncs the panel', () => {
    let buttons: PageButton[] = [];
    let syncs = 0;
    const host = { setPageButtons: (l: PageButton[]) => { buttons = l; }, syncPageButtons: () => { syncs++; } };
    const search = '?r3d=sunlight&vary=0';
    const params = parseParams(search);
    const stage = createSunlightStage(assets, params, search, host);
    made.push(stage);
    expect(buttons.map((b) => b.name)).toEqual(['Second crack', 'Reroll', 'Vary']);
    const [second, reroll, vary] = buttons;
    expect(second.pressed!()).toBe(false);
    second.press();
    expect(second.pressed!()).toBe(true);
    expect(reroll.pressed).toBeNull();
    expect(vary.pressed!()).toBe(false);
    vary.press();
    expect(vary.pressed!()).toBe(true);
    key(stage, 'KeyV');
    expect(vary.pressed!()).toBe(false);
    expect(syncs).toBe(1);
    stage.dispose();
    made.pop();
    expect(buttons).toEqual([]);
  });

  it('starts with the second crack for second=1', () => {
    expect(make('?r3d=sunlight&second=1').draw().cracks).toHaveLength(2);
  });

  it('rerolls the looks with R: new ids give different rays', () => {
    const { stage, draw } = make('?r3d=sunlight');
    const before = draw().cracks![0];
    key(stage, 'KeyR');
    const one = draw().cracks![0];
    expect(one.id).not.toBe(before.id);
    key(stage, 'KeyR');
    const two = draw().cracks![0];
    expect(before.rays).toHaveLength(2);
    expect(two.rays).toHaveLength(3);
  });

  it('V switches the varied looks off: the fixed look has the URL values', () => {
    const { stage, draw } = make('?r3d=sunlight&vary=0&rays=3');
    expect(draw().cracks![0].rays).toHaveLength(3);
    key(stage, 'KeyV');
    const varied = draw().cracks![0];
    expect(varied.rx).not.toBeCloseTo(2 / 2 / 0.81); // the varied patch is hashed from the id
    expect(key(stage, 'KeyX')).toBe(false);
  });

  it('vary=0&rays=1&patch=3 gives one ray and rx = 3 / 2 / 0.81', () => {
    const c = make('?r3d=sunlight&vary=0&rays=1&patch=3').draw().cracks![0];
    expect(c.rays).toHaveLength(1);
    expect(c.rx).toBeCloseTo(3 / 2 / 0.81, 6);
  });

  it('shafts=0 passes shafts off and dust=0 gives no specks; the air has no smoke, embers or drips', () => {
    expect(make('?r3d=sunlight&shafts=0').draw().shafts).toBe(false);
    const { draw } = make('?r3d=sunlight');
    let specks = 0;
    for (let i = 0; i < 100; i++) {
      const a = draw(i * 0.05).air!;
      specks = Math.max(specks, a.parts.specks.count);
      expect(a.parts.puffs.count + a.parts.embers.count + a.parts.drops.count).toBe(0);
    }
    expect(specks).toBeGreaterThan(0);
    const none = make('?r3d=sunlight&dust=0');
    for (let i = 0; i < 100; i++) expect(none.draw(i * 0.05).air!.parts.specks.count).toBe(0);
  });
});

describe('parseSunLook', () => {
  it('reads the URL keys into the page look, not the shared one', () => {
    const l = parseSunLook('?shape=straight&patch=3&slant=1&from=right&clouds=0.6&height=5&style=parallel&rays=2&glow=1.5&often=1&vary=0');
    expect(l).toMatchObject({ widen: false, patch: 3, slant: 1, dir: 1, clouds: 0.6, height: 5, style: 'parallel', rays: 2, glow: 1.5, vary: false });
    expect(l.gap).toEqual([2, 4]);
    expect(parseSunLook('').vary).toBe(true);
  });

  it('ignores values off the lists', () => {
    const l = parseSunLook('?height=9&rays=7');
    expect(l.height).toBe(6);
    expect(l.rays).toBe(2);
  });
});
