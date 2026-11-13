// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ANIM, CONST, KIND, LIGHT_KIND, TILE_ID } from '../generated/defs';
import { LightField } from '../game/light';
import { TileMap } from '../sim/map';
import { snap, startInfo } from '../run/testing';
import type { RunFrame, RunViewInit } from '../run/view';
import { keysToWorld } from './camera';
import { AMBIENT, WORK_AMBIENT } from './light';
import { renderPlan } from './quality';
import { DEFAULTS, type R3dParams } from './params';
import { RunView3d, moveInput } from './runView3d';
import { MIST } from './mist';
import { stoneClear } from './light';
import { SIGHT_MARGIN } from './sightmask';
import type { StageCtx } from './host';
import type { EntState } from '../game/world';
import type { Overlay3d } from './overlay';
import type { OverlayItem } from './overlayLayout';
import { SIDE } from '../generated/defs';
import type { FrameInput } from './view';
import { hourLabel, mistLightOf, sky, startHour } from './sun';
import { WIND } from './wind';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('moveInput', () => {
  it('W at yaw 0 walks north', () => {
    expect(moveInput(new Set(['KeyW']), 0)).toEqual({ mx: 0, my: -1 });
  });
  it('W at yaw 90 degrees is the rounded keysToWorld', () => {
    const w = keysToWorld(deg(90), 0, -1);
    expect(moveInput(new Set(['KeyW']), deg(90))).toEqual({ mx: Math.round(w.x) + 0, my: Math.round(w.z) + 0 }); // + 0: no -0
    expect(moveInput(new Set(['KeyW']), deg(90))).toEqual({ mx: 1, my: 0 });
  });
  it('W at yaw 45 degrees walks north-east', () => {
    expect(moveInput(new Set(['KeyW']), deg(45))).toEqual({ mx: 1, my: -1 });
  });
  it('opposite keys cancel', () => {
    expect(moveInput(new Set(['KeyW', 'KeyS']), 0)).toEqual({ mx: 0, my: 0 });
  });
  it('the arrow keys equal the letters', () => {
    expect(moveInput(new Set(['ArrowLeft']), 0)).toEqual(moveInput(new Set(['KeyA']), 0));
    expect(moveInput(new Set(['ArrowLeft']), 0)).toEqual({ mx: -1, my: 0 });
  });
  it('two keys give a diagonal', () => {
    expect(moveInput(new Set(['KeyS', 'KeyD']), 0)).toEqual({ mx: 1, my: 1 });
  });
  it('nothing held is still', () => {
    expect(moveInput(new Set(), deg(30))).toEqual({ mx: 0, my: 0 });
  });
});

// A recording view: what the run view hands `draw`.
const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`wizzard_m_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const bounds = () => ({ l: 0, r: 15, t: 0, w: 16, h: 28 });

for (const n of ['cove_tree', 'cove_bush_a', 'cove_bush_b', 'cove_tuft_a', 'cove_tuft_b', 'cove_fern']) frames[n] = { x: 20, y: 0, w: n === 'cove_tree' ? 96 : 14, h: n === 'cove_tree' ? 100 : 12 };
frames.floor_1 = { x: 0, y: 40, w: 16, h: 16 };

function run(over: { cove?: boolean; woodland?: boolean; params?: Partial<R3dParams>; me?: { darkvision: number; vision: number }; moving?: [number, number, number, number | null][]; ents?: number[][]; torch?: boolean; ownX?: number; rows?: string[]; daylight?: boolean; noSnap?: boolean; camera?: { x: number; y: number }; trunk?: [number, number]; figs?: EntState[]; paint?: OverlayItem[]; tick?: number } = {}) {
  const info = startInfo(over.rows ?? ['#######', '#.....#', '#.....#', '#######'], { ...(over.woodland ? { woodland: { seed: 1, end: [0, 0, 1, 1], plants: [], sun: { side: 1, elevation: 30 } } as never } : {}), ...(over.daylight ? { daylight: true } : {}), ...(over.cove ? { cove: { x: 1, y: 1, w: 5, h: 2, tree_x: 3, tree_y: 2, seed: 3 } } : {}) });
  const map = new TileMap(info.width, info.height, new Uint8Array(info.tiles));
  if (over.trunk) map.set(over.trunk[0], over.trunk[1], TILE_ID.Trunk);
  const light = new LightField(map);
  if (over.torch !== false) light.add({ id: 1, kind: LIGHT_KIND.Torch, colour: 0xffa040, x: 3, y: 1, on: true });
  const init: RunViewInit = { info, map, light, myKind: KIND.Wizard };
  const overlay = over.paint ? ({ size() {}, measure: () => 10, paint: (items: OverlayItem[]) => over.paint!.splice(0, over.paint!.length, ...items) } as unknown as Overlay3d) : null;
  const v = new RunView3d(init, frames, bounds, overlay);
  let got: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((got = i), 0), meshes: 0, tileChanged: () => {} };
  const params = { ...DEFAULTS, ...over.params };
  const plan = { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 };
  const canvasEl = document.createElement('canvas');
  canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 }) as DOMRect;
  const timer = { lap() {}, renderStart() {}, systems: {}, frameMs: 0, renderMs: 0 };
  v.begin({ now: 0, dt: 1 / 60, params, held: new Set(), canvas: { w: 1280, h: 720 }, zoom: 2, plan, canvasEl, view, timer } as unknown as StageCtx);
  const s = snap({ lights: over.moving ?? [], ents: (over.ents ?? []) as never, ...(over.tick !== undefined ? { tick: over.tick } : {}) });
  if (over.me) Object.assign(s.me, over.me);
  const own = { x: over.ownX ?? 56, y: 24, alive: true, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, aimsAtPointer: false, aimFromX: over.ownX ?? 56, aimFromY: 24, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false };
  const f = { dt: 1 / 60, now: 0, ents: new Map((over.figs ?? []).map((e) => [e.id, e])), you: 1, own, watching: null, camera: over.camera ?? { x: 56, y: 24 }, snap: over.noSnap ? null : s, shots: [], hiddenShots: new Set(), useHint: null, dark: new Set(), debug: { on: false, path: [], ogre: [], cove: [], notice: [], dodges: [] } } as unknown as RunFrame;
  const stats = v.frame(f);
  const first = got as FrameInput | null;
  /** Another frame of the same view and frame data: what it hands `draw`. */
  const again = (): FrameInput | null => {
    got = null;
    v.frame(f);
    return got;
  };
  return { f: first, stats, own, v, light, again, map };
}

describe('the run view and the game lights', () => {
  it('a dungeon frame passes the torch light and a black ambient', () => {
    const { f } = run();
    expect(f?.lights).toHaveLength(1);
    expect(f?.ambient).toEqual([0, 0, 0]);
    expect(f?.lava).not.toBeNull();
  });
  it('amb 1 is the demo ambient', () => {
    expect(run({ params: { amb: 1 } }).f?.ambient).toEqual([...AMBIENT]);
  });
  it('a woodland frame has no torch lights and the sky ambient of the hour', () => {
    const { f } = run({ woodland: true, torch: false });
    expect(f?.lights).toEqual([]);
    expect(f?.casters).toEqual([]);
    expect(f?.darkvision).toBeNull();
    expect(f?.ambient).toEqual(sky(startHour(WOODLAND_SUN)).ambient);
  });
  it('a dungeon with a cove hands over its plants, adds the pixie lights and the plants as casters', () => {
    const { f } = run({ cove: true });
    expect(f?.plants).toBeDefined();
    expect([...f!.plants!.chunks.values()].flat().every((k) => k.page === -1)).toBe(true);
    expect(f?.lights.filter((l) => !l.shadow).length).toBeGreaterThan(0);
    expect(f?.casters.some((k) => k.id <= -1000)).toBe(true);
    expect(run().f?.plants).toBeUndefined();
  });
  it('light=work is the same', () => {
    const { f } = run({ params: { light: 'work' } });
    expect(f?.lights).toEqual([]);
    expect(f?.ambient).toEqual([...WORK_AMBIENT]);
  });
  it('darkvision 50 % at vision 8 reaches 4 tiles', () => {
    const { f } = run({ me: { darkvision: 50, vision: 8 } });
    expect(f?.darkvision).toEqual({ x: 3.5, z: 1.5, reach: 4 });
    expect(run().f?.darkvision).toBeNull();
  });
  it('a moving light on the own hero sits at the drawn hero', () => {
    const ent = [1, KIND.Wizard, 56, 24, 0, 0, 0, 0, 0, 0, 0, 0];
    // The snapshot's entity (and the light on it) is at x 56 px; the predicted hero is drawn at 60: the light follows the drawn hero.
    const { f } = run({ torch: false, moving: [[56, 24, LIGHT_KIND.Torch, null]], ents: [ent], ownX: 60 });
    expect(f?.lights).toHaveLength(1);
    expect(f?.lights[0].x).toBeCloseTo(60 / 16);
    expect(f?.lights[0].z).toBeCloseTo(24 / 16);
    // The hero is a caster (id `f.you`, as the figures give it) and its own light skips that card's slot.
    const slot = f!.casters.findIndex((c) => c.id === 1);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(f?.lights[0].skip).toBe(slot);
  });
  it('the readout lines say the lights in use and the caps', () => {
    const { stats } = run({ params: { lcap: 8, ccap: 4 } });
    expect(stats.lines).toEqual(['lights     1 of 1 (cap 8)', 'shadows    1 cards (cap 4)']);
  });
  it('a refilled lava buffer bumps lavaVersion', () => {
    const a = run();
    const v1 = a.f!.lavaVersion;
    expect(v1).toBeGreaterThan(0);
    expect(a.again()?.lavaVersion).toBe(v1); // nothing changed: no refill
    a.light.mapChanged(); // a tile changed (lava appeared, a door opened)
    const v2 = a.again()!.lavaVersion;
    expect(v2).toBeGreaterThan(v1);
    expect(a.again()?.lavaVersion).toBe(v2);
  });
});

const WOODLAND_SUN = { side: 1, elevation: 30 } as const;
describe('the woodland run: sky, hour, sun and plants (#306)', () => {
  it('the first frame (no snapshot) has the sun for the start hour', () => {
    const { f } = run({ woodland: true, torch: false, noSnap: true });
    const s = sky(startHour(WOODLAND_SUN));
    expect(f?.sun).toBeTruthy();
    expect(f!.sun!.dir).toEqual(s.dir);
    expect(f!.sun!.colour).toEqual(s.colour);
    expect(f!.sun!.fit.size).toBe(2048);
    expect(f?.plants).toBeDefined();
  });
  it('a snapshot at tick 60 * 720 is one hour later', () => {
    const { f } = run({ woodland: true, torch: false, tick: 60 * 720 });
    expect(f!.sun!.dir).toEqual(sky(startHour(WOODLAND_SUN) + 1).dir);
    expect(f!.sight!.mistDay).toBe(sky(startHour(WOODLAND_SUN) + 1).day);
  });
  it('hourRate multiplies the pace and 0 stops the hour', () => {
    expect(run({ woodland: true, torch: false, tick: 60 * 720, params: { hourRate: 0 } }).f!.sun!.dir).toEqual(sky(startHour(WOODLAND_SUN)).dir);
    expect(run({ woodland: true, torch: false, tick: 60 * 720, params: { hourRate: 2 } }).f!.sun!.dir).toEqual(sky(startHour(WOODLAND_SUN) + 2).dir);
  });
  it('a panel hour is the hour from the first frame on', () => {
    expect(run({ woodland: true, torch: false, noSnap: true, params: { hour: 20 } }).f!.sun!.dir).toEqual(sky(20).dir);
    expect(run({ woodland: true, torch: false, tick: 60 * 720, params: { hour: 20 } }).f!.sun!.dir).toEqual(sky(20).dir); // anchored at that run time
  });
  it('the mist follows the hour: mistDay, mistLight and the wind', () => {
    const night = run({ woodland: true, torch: false, daylight: true, params: { hour: 1 } }).f!.sight!;
    expect(night.mistDay).toBe(sky(1).day);
    expect(night.mistLight).toEqual(mistLightOf(sky(1)));
    expect(night.wind).toEqual(WIND);
    expect(run({ woodland: true, torch: false, daylight: true, params: { wind: false } }).f!.sight!.wind).toEqual([0, 0]);
  });
  it('light=work gives no sun and the work ambient', () => {
    const { f } = run({ woodland: true, torch: false, params: { light: 'work' } });
    expect(f?.sun ?? null).toBeNull();
    expect(f?.ambient).toEqual([...WORK_AMBIENT]);
  });
  it('a dungeon frame has sun null and no plants', () => {
    const { f } = run();
    expect(f?.sun).toBeNull();
    expect(f?.plants).toBeUndefined();
  });
  it('the readout says the sun and the plants', () => {
    const { stats } = run({ woodland: true, torch: false });
    expect(stats.lines).toContain(`sun        ${hourLabel(startHour(WOODLAND_SUN))} 2048 px`);
    expect(stats.lines).toContain('plants     0 of 0');
  });
});

describe('the run view feeds the sight mask (#305)', () => {
  const big = ['#'.repeat(40), ...Array.from({ length: 38 }, () => `#${'.'.repeat(38)}#`), '#'.repeat(40)];
  const centre = (m: NonNullable<FrameInput['sight']>['mask']): { x: number; z: number } => ({ x: m!.ox + m!.size / 2, z: m!.oz + m!.size / 2 });

  it('a dungeon frame is dark, a daylight one mist', () => {
    const d = run().f!.sight!;
    expect(d.mode).toBe('dark');
    expect(d.mask).not.toBeNull();
    expect(run({ daylight: true }).f!.sight!.mode).toBe('mist');
  });
  it('the mist comes from the params over MIST', () => {
    const s = run({ daylight: true, params: { mistHigh: 4, mistTop: 0.2, mistDrift: 0.5, mistDay: 0.3 } }).f!.sight!;
    expect(s.mist).toEqual({ ...MIST, high: 4, top: 0.2, drift: 0.5 });
    expect(s.mistDay).toBe(0.3);
    expect(s.mistLight).toEqual([1, 1, 1]);
  });
  it('params.sight false turns it off', () => {
    const s = run({ params: { sight: false } }).f!.sight!;
    expect(s.mode).toBe('off');
    expect(s.mask).toBeNull();
  });
  it('a dark map clears to stoneClear(ambient)', () => {
    expect(run().f!.sight!.clear).toEqual(stoneClear([0, 0, 0]));
  });
  it('a spectated camera centres the mask on f.camera, with the free camera too', () => {
    for (const free of [false, true]) {
      const m = run({ rows: big, camera: { x: 30 * 16 + 8, y: 20 * 16 + 8 }, params: { free } }).f!.sight!.mask!;
      const c = centre(m);
      expect(Math.abs(c.x - 30.5)).toBeLessThan(0.25);
      expect(Math.abs(c.z - 20.5)).toBeLessThan(0.25);
    }
  });
  it('without a snapshot the vision is FOV_RADIUS', () => {
    const m = run({ noSnap: true }).f!.sight!.mask!;
    expect(m.size).toBe(2 * (CONST.FOV_RADIUS + 0.5 + SIGHT_MARGIN));
  });
  it('a standing view does not refill, tileChanged does, and a trunk-free map drops the all view', () => {
    const a = run({ rows: big, trunk: [5, 5] });
    const m = a.f!.sight!.mask!;
    const v0 = m.version;
    a.again();
    expect(m.version).toBe(v0);
    a.v.tileChanged(5, 5, 0);
    a.again();
    expect(m.version).toBeGreaterThan(v0);
    // the only trunk becomes floor: the all view is no longer computed, so its version stops
    const allVersion = (): number => (a.v as unknown as { allSight: { version: number } }).allSight.version;
    const before = allVersion();
    expect(before).toBeGreaterThan(0);
    a.map.set(5, 5, TILE_ID.Floor);
    a.v.tileChanged(5, 5, 0);
    a.again();
    a.again();
    expect(allVersion()).toBe(before);
    const b = run({ rows: big });
    expect((b.v as unknown as { allSight: { version: number } }).allSight.version).toBe(0);
  });
});

describe('what the picture hides has nothing over it (#305)', () => {
  const big = ['#'.repeat(40), ...Array.from({ length: 38 }, () => `#${'.'.repeat(38)}#`), '#'.repeat(40)];
  const mob = (id: number, tileX: number): EntState => ({ id, kind: KIND.Wizard, x: tileX * 16 + 8, y: 24, hp: 0.5, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: SIDE.Hostile, entangled: 0 });
  const opener = (v: RunView3d): number[] => v.seen.map((o) => o.id);

  it('a monster beyond sight gets no bar and no opener; with sight off it does', () => {
    const on: OverlayItem[] = [];
    const far = run({ rows: big, figs: [mob(7, 30)], paint: on });
    expect(on.filter((i) => i.t === 'bar')).toHaveLength(0);
    expect(opener(far.v)).not.toContain(7);
    const off: OverlayItem[] = [];
    const sightOff = run({ rows: big, figs: [mob(7, 30)], paint: off, params: { sight: false } });
    expect(off.filter((i) => i.t === 'bar')).toHaveLength(1);
    // (an opener also needs the tile to be visible to the hard view, which is far away; the bar is the proof)
    expect(sightOff.v).toBeDefined();
  });
  it('a monster inside sight keeps its bar and its opener', () => {
    const on: OverlayItem[] = [];
    const near = run({ rows: big, figs: [mob(7, 6)], paint: on });
    expect(on.filter((i) => i.t === 'bar')).toHaveLength(1);
    expect(opener(near.v)).toContain(7);
  });
  it('a daylight monster at the edge of sight keeps its bar, one far beyond loses it', () => {
    const edge: OverlayItem[] = [];
    run({ rows: big, daylight: true, figs: [mob(7, 11)], paint: edge }); // vision 8: the edge is at 8.5 tiles from tile 3.5
    expect(edge.filter((i) => i.t === 'bar')).toHaveLength(1);
    const beyond: OverlayItem[] = [];
    run({ rows: big, daylight: true, figs: [mob(7, 30)], paint: beyond });
    expect(beyond.filter((i) => i.t === 'bar')).toHaveLength(0);
  });
});
