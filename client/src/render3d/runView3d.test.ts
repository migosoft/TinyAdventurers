// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ANIM, CONST, KIND, LIGHT_KIND, TILE_ID } from '../generated/defs';
import { LightField } from '../game/light';
import { TileMap } from '../sim/map';
import { snap, startInfo } from '../run/testing';
import type { RunFrame, RunViewInit } from '../run/view';
import { keysToWorld } from './camera';
import { AMBIENT, WORK_AMBIENT } from './light';
import { renderPlan } from './quality';
import { DEFAULTS, type R3dParams } from './params';
import { POLLEN_DRIFT, RunView3d, moveInput } from './runView3d';
import { MIST } from './mist';
import { stoneClear } from './light';
import { SIGHT_MARGIN, hiddenAt, type SightMask } from './sightmask';
import type { StageCtx } from './host';
import type { EntState } from '../game/world';
import type { Overlay3d } from './overlay';
import type { OverlayItem } from './overlayLayout';
import { SIDE } from '../generated/defs';
import type { FrameInput } from './view';
import { rng } from './fx/rand';
import type { PlantInfo } from '../generated/PlantInfo';
import type { CoverResult } from './cover/coverJob';
import { encodeCover } from './cover/kinds';
import { hourLabel, mistLightOf, sky, startHour, waterSky } from './sun';
import { WIND, WIND_DIR } from './wind';

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

function run(over: { water?: [number, number][]; lava?: [number, number][]; cove?: boolean; woodland?: boolean; plants?: PlantInfo[]; params?: Partial<R3dParams>; me?: { darkvision: number; vision: number }; moving?: [number, number, number, number | null][]; ents?: number[][]; torch?: boolean; ownX?: number; rows?: string[]; daylight?: boolean; noSnap?: boolean; sun?: boolean; camera?: { x: number; y: number }; trunk?: [number, number]; figs?: EntState[]; paint?: OverlayItem[]; tick?: number; lavaRng?: () => number; stone?: { done: number; total: number } | null } = {}) {
  const info = startInfo(over.rows ?? ['#######', '#.....#', '#.....#', '#######'], { ...(over.woodland ? { woodland: { seed: 1, end: [0, 0, 1, 1], plants: over.plants ?? [], sun: { side: 1, elevation: 30 }, palette: 0, pond: null } as never } : {}), ...(over.daylight ? { daylight: true } : {}), ...(over.cove ? { cove: { x: 1, y: 1, w: 5, h: 2, tree_x: 3, tree_y: 2, seed: 3 } } : {}) });
  const map = new TileMap(info.width, info.height, new Uint8Array(info.tiles));
  if (over.trunk) map.set(over.trunk[0], over.trunk[1], TILE_ID.Trunk);
  for (const [wx, wy] of over.water ?? []) map.set(wx, wy, TILE_ID.ShallowWater);
  for (const [lx, ly] of over.lava ?? []) map.set(lx, ly, TILE_ID.Lava);
  const light = new LightField(map);
  if (over.sun) light.add({ id: 2, kind: LIGHT_KIND.Daylight, colour: 0xffffff, x: 3, y: 2, on: true, wall: 0 });
  if (over.torch !== false) light.add({ id: 1, kind: LIGHT_KIND.Torch, colour: 0xffa040, x: 3, y: 1, on: true, wall: 0 });
  const init: RunViewInit = { info, map, light, myKind: KIND.Wizard, lavaRng: over.lavaRng };
  const overlay = over.paint ? ({ size() {}, measure: () => 10, paint: (items: OverlayItem[]) => over.paint!.splice(0, over.paint!.length, ...items) } as unknown as Overlay3d) : null;
  const v = new RunView3d(init, frames, bounds, overlay);
  v.stoneProgress = over.stone ?? null;
  let got: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((got = i), 0), meshes: 0, tileChanged: () => {} };
  const params = { ...DEFAULTS, ...over.params };
  const plan = { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 };
  const canvasEl = document.createElement('canvas');
  canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 }) as DOMRect;
  const timer = { lap() {}, renderStart() {}, systems: {}, frameMs: 0, renderMs: 0 };
  const ctx = { now: 0, dt: 1 / 60, params, held: new Set(), canvas: { w: 1280, h: 720 }, zoom: 2, plan, canvasEl, view, timer } as unknown as StageCtx;
  v.begin(ctx);
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
  return { f: first, stats, own, v, light, again, map, ctx };
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
  it('a dungeon with a cove hands over its willow and bushes as trees (no sun), adds the pixie lights and the bushes as casters, and gives its tufts and ferns as bushel spots', () => {
    const r = run({ cove: true, params: { sight: false } });
    const { f } = r;
    expect(f?.trees).toBeDefined();
    expect(f?.trees?.complete).toBe(true); // a willow and a few bushes: all built in the first frame
    expect(f?.sun ?? null).toBeNull();
    expect([...f!.trees!.chunks.values()].reduce((n, k) => n + k.mesh.verts, 0)).toBeGreaterThan(0); // the willow is built in the first frame
    expect(f).not.toHaveProperty('plants');
    expect(f?.lights.filter((l) => !l.shadow).length).toBeGreaterThan(0);
    expect(f?.casters.some((k) => k.id <= -1000)).toBe(true);
    expect(Array.isArray(r.v.bushelSpots())).toBe(true); // this small cove may place no tuft; Cove3d's own test counts them
    expect(run().v.bushelSpots()).toEqual([]);
  });
  it('with sight on the cove plants cast only where the picture shows them (the mask of this frame: it is filled before the lights, #308)', () => {
    const r = run({ cove: true });
    expect(r.f?.casters.some((k) => k.id <= -1000)).toBe(true);
    for (const k of r.f!.casters) if (k.id <= -1000) expect(hiddenAt((r.v as unknown as { mask: SightMask }).mask, k.x, k.z)).toBe(false);
    const again = r.again();
    expect(again?.casters.some((k) => k.id <= -1000)).toBe(true);
    for (const k of again!.casters) if (k.id <= -1000) expect(hiddenAt((r.v as unknown as { mask: SightMask }).mask, k.x, k.z)).toBe(false);
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
    expect(stats.lines).toEqual(['lights     1 of 1 (cap 8)', 'shadows    1 cards (cap 4)', 'fx         0 rec, 0 tris (0 dropped total)']);
  });
  it('a dungeon with a stone job shows `stone <done> of <total>` after the lights, a woodland or a level without one shows none (#380)', () => {
    const lines = (p: { done: number; total: number } | null, woodland = false) => {
      const r = run({ woodland, torch: false, stone: p });
      return r.stats.lines!.filter((l) => l.startsWith('stone'));
    };
    expect(lines({ done: 3, total: 7 })).toEqual(['stone      3 of 7']);
    expect(lines({ done: 7, total: 7 })).toEqual(['stone      7 of 7']);
    expect(lines(null)).toEqual([]);
    expect(lines(null, true)).toEqual([]);
  });
  it('a cove shows the trees built line but no sky lines; a level with a woodland and a cove is refused', () => {
    const { stats } = run({ cove: true });
    expect(stats.lines!.find((l) => l.startsWith('plants'))).toMatch(/^plants {5}\d+ of \d+$/);
    expect(stats.lines!.some((l) => l.startsWith('sun'))).toBe(false);
    expect(() => run({ cove: true, woodland: true })).toThrow(/woodland and a cove/);
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
describe('the ground cover in the run view (#330)', () => {
  /** A cover of 4 art px over the whole 7 x 4 map. */
  const covered = (): CoverResult => {
    const w = 7 * 16, h = 4 * 16, data = new Uint8Array(w * h * 4);
    for (let p = 0; p < w * h; p++) data[p * 4 + 3] = encodeCover(4, 0);
    return { image: { w, h, data }, bare: null, bushels: [], sheets: 4 };
  };
  const shadowYs = (f: FrameInput | null): number[] => {
    const p = f!.dynamic.shadows.position, out: number[] = [];
    for (let i = 1; i < p.length; i += 3) out.push(p[i]);
    return out;
  };

  it('the frame carries cover { on, gh, wind, t } from the parameters', () => {
    const { f } = run({ params: { cover: false, gh: 2, wind: false } });
    expect(f?.cover).toEqual({ on: false, gh: 2, wind: false, t: 0 });
    expect(run().f?.cover).toEqual({ on: true, gh: 1, wind: true, t: 0 });
  });

  it('lifts the ground ovals onto the cover after setCover, none before, and not with the switch off', () => {
    const r = run();
    const before = shadowYs(r.f);
    expect(before.length).toBeGreaterThan(0);
    r.v.setCover(covered());
    const after = shadowYs(r.again());
    expect(after).toHaveLength(before.length);
    after.forEach((y, i) => expect(y - before[i]).toBeCloseTo(4 / 16, 6));
    r.v.setCover(null);
    expect(shadowYs(r.again())).toEqual(before);
  });

  it('gh scales the lift and cover=0 lifts nothing', () => {
    const lifted = (params: Partial<R3dParams>): number[] => {
      const r = run({ params });
      r.v.setCover(covered());
      return shadowYs(r.again());
    };
    const plain = shadowYs(run().f);
    expect(lifted({ gh: 2 })[0] - plain[0]).toBeCloseTo(8 / 16, 6);
    expect(lifted({ cover: false })).toEqual(plain);
  });
});

describe('the woodland run: sky, hour, sun and plants (#306)', () => {
  it('the first frame (no snapshot) has the sun for the start hour', () => {
    const { f } = run({ woodland: true, torch: false, noSnap: true });
    const s = sky(startHour(WOODLAND_SUN));
    expect(f?.sun).toBeTruthy();
    expect(f!.sun!.dir).toEqual(s.dir);
    expect(f!.sun!.colour).toEqual(s.colour);
    expect(f!.sun!.fit.size).toBe(2048);
    expect(f?.trees).toBeDefined();
    // the water's sky (#360) is the hour's; a level without a pond has no fish
    expect(f!.water!.sky).toEqual(waterSky(s));
    expect(f!.water!.fish).toBeNull();
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
  it('a dungeon frame has sun null', () => {
    const { f } = run();
    expect(f?.sun).toBeNull();
    expect(f?.trees).toBeUndefined();
  });
  it('the forest is built a few trees a frame and the readout counts them', () => {
    const plants: PlantInfo[] = [[0, 40, 40, 1, 100, false, 100, false], [1, 60, 40, 2, 100, false, 100, false], [4, 80, 40, 3, 100, false, 60, false]];
    const r = run({ woodland: true, torch: false, plants });
    expect(r.f!.trees!.chunks.size).toBeGreaterThan(0);
    expect(r.f!.trees!.palette).toBe(0);
    expect(r.stats.lines!.find((l) => l.startsWith('plants'))).toMatch(/^plants {5}[1-3] of 3$/);
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

describe('the air in the run view (#307)', () => {
  const sunny = (r: ReturnType<typeof run>): void => r.light.add({ id: 2, kind: LIGHT_KIND.Daylight, colour: 0xffffff, x: 3, y: 2, on: true, wall: 0 });
  it('a dungeon frame passes the air parts, its haze, the shafts switch and the cracks of the Daylight lights in sight', () => {
    const r = run({ rows: ['#######', '#.....#', '#.....#', '#.....#', '#######'] });
    sunny(r);
    const f = r.again();
    expect(f?.air?.parts.specks).toBeDefined();
    expect(f?.air?.haze.on).toBe(true);
    expect(f?.shafts).toBe(true);
    expect(f?.cracks).toHaveLength(1);
    expect(f?.cracks?.[0].fx).toBeCloseTo(3.5);
  });
  it('the cracks follow this frame\'s sight: a Daylight light in view is sent from the first frame on', () => {
    expect(run({ sun: true, rows: ['#######', '#.....#', '#.....#', '#.....#', '#######'] }).f?.cracks).toHaveLength(1);
  });
  it('the haze is off with the haze switch and the shafts are off with shafts=0', () => {
    const f = run({ params: { haze: false, shafts: false } }).f;
    expect(f?.air?.haze.on).toBe(false);
    expect(f?.shafts).toBe(false);
  });
  it('a woodland frame has the pollen only: no smoke, embers or drips, no haze, no cracks', () => {
    const r = run({ woodland: true, torch: false });
    r.light.add({ id: 2, kind: LIGHT_KIND.Daylight, colour: 0xffffff, x: 3, y: 1, on: true, wall: 0 });
    const f = r.again();
    expect(f?.air).toBeTruthy();
    expect(f?.air?.haze.on).toBe(false);
    expect(f?.air?.parts.puffs.count).toBe(0);
    expect(f?.air?.parts.embers.count).toBe(0);
    expect(f?.air?.parts.drops.count).toBe(0);
    expect(f?.cracks ?? []).toHaveLength(0);
  });
  it('the work light keeps the air and sends no cracks', () => {
    const r = run({ params: { light: 'work' } });
    sunny(r);
    const f = r.again();
    expect(f?.air).toBeTruthy();
    expect(f?.cracks ?? []).toHaveLength(0);
  });
  it('a changed tile tells the air to collect its water and lava again', () => {
    const r = run();
    const spy = vi.spyOn((r.v as unknown as { air: { mapChanged(): void } }).air, 'mapChanged');
    r.v.tileChanged(2, 1, 1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('the woodland pollen drifts along the wind direction, and not at all with wind=0', () => {
    const drift = (wind: boolean): readonly number[] | null | undefined => {
      const r = run({ woodland: true, torch: false, params: { wind } });
      const air = (r.v as unknown as { air: { step(i: { drift: readonly number[] | null }): unknown } }).air;
      const spy = vi.spyOn(air, 'step');
      r.again();
      return spy.mock.calls[0][0].drift;
    };
    const on = drift(true);
    expect(on![0]).toBeCloseTo(WIND_DIR[0] * POLLEN_DRIFT);
    expect(on![1]).toBeCloseTo(WIND_DIR[1] * POLLEN_DRIFT);
    expect(drift(false)).toEqual([0, 0]);
  });
  it('a new view after a device loss gets the same air: the clouds go on', () => {
    const r = run();
    for (let i = 0; i < 30; i++) r.again();
    const before = (r.v as unknown as { air: { counts: { clouds: number } } }).air.counts.clouds;
    const parts = r.again()!.air!.parts;
    expect(before).toBeGreaterThan(0);
    let got: FrameInput | null = null;
    r.ctx.view = { draw: (i: FrameInput) => ((got = i), 0), meshes: 0, tileChanged: () => {} } as never;
    r.v.begin(r.ctx); // the lost device's replacement
    r.again(); // draws into the new view
    expect((got as FrameInput | null)?.air?.parts).toBe(parts);
  });
});

describe('the run view and the effects (#308)', () => {
  it('effects survive a view swap', () => {
    const r = run();
    r.v.event({ t: 'Boom', x: 60, y: 30, k: 0, r: 32 } as never, { x: 56, y: 24 });
    expect(r.v.fxRecords).toBe(1);
    r.v.attach(null);
    r.again();
    r.v.attach(r.ctx.view);
    expect(r.v.fxRecords).toBe(1);
    expect(r.again()?.fx).toBeDefined();
  });

  it('a figure lost to a chasm leaves no death effect and no shake', () => {
    const r = run();
    const steady = r.f!.cam;
    r.v.event({ t: 'Sink', id: 77, x: 60, y: 30, how: 0 } as never, { x: 56, y: 24 });
    r.v.event({ t: 'Died', id: 77, x: 60, y: 30, kind: KIND.Dragon } as never, { x: 56, y: 24 });
    expect(r.v.fxRecords).toBe(0);
    r.ctx.now += 0.016;
    expect(r.again()!.cam.x).toBeCloseTo(steady.x, 6);
    r.v.event({ t: 'Died', id: 78, x: 60, y: 30, kind: KIND.Dragon } as never, { x: 56, y: 24 });
    expect(r.v.fxRecords).toBe(1);
  });

  it('hands the view the two effect buffers, empty while no drawer is registered', () => {
    const { f } = run();
    expect(f?.fx?.tris.n).toBe(0);
    expect(f?.fx?.lit.n).toBe(0);
  });

  it('a barrel blast shakes the camera near the own hero and not far away', () => {
    const shifted = (bx: number): boolean => {
      const r = run();
      const steady = r.f!.cam;
      r.v.event({ t: 'Boom', x: bx, y: 24, r: 20, k: 7 } as never, { x: 56, y: 24 });
      for (let i = 0; i < 4; i++) {
        r.ctx.now += 0.016;
        const c = r.again()!.cam;
        if (c.x !== steady.x || c.z !== steady.z) return true;
      }
      return false;
    };
    expect(shifted(60)).toBe(true);
    expect(shifted(56 + 5000)).toBe(false);
  });
  it('a hit on the own hero shakes only the drawn camera, and the shake ends', () => {
    const r = run();
    const steady = r.f!.cam;
    r.v.event({ t: 'Dmg', x: 56, y: 14, v: 3, p: true, imm: false, ty: 0 } as never, { x: 56, y: 24 });
    let shifted = false;
    for (let i = 0; i < 4; i++) {
      r.ctx.now += 0.016;
      const c = r.again()!.cam;
      if (c.x !== steady.x || c.z !== steady.z) shifted = true;
    }
    expect(shifted).toBe(true);
    r.ctx.now += 0.2;
    expect(r.again()!.cam.x).toBeCloseTo(steady.x, 3);
  });
});

describe('the water in the run view (#345)', () => {
  const POOL: [number, number][] = [1, 2, 3, 4, 5].flatMap((x) => [[x, 1], [x, 2]] as [number, number][]);
  /** Ripples with an age of 0 or more in the packed array of a frame. */
  const live = (f: FrameInput | null): number => {
    const r = f?.water?.ripples;
    let n = 0;
    if (r) for (let i = 0; i < r.length; i += 4) if (r[i + 2] >= 0) n++;
    return n;
  };

  it('hands the view the water with the mirror on Balanced and off on Fast or with refl off', () => {
    expect(run().f?.water?.reflect).toBe(true);
    expect(run({ params: { quality: 'fast' } }).f?.water?.reflect).toBe(false);
    expect(run({ params: { refl: false } }).f?.water?.reflect).toBe(false);
    expect(run({ params: { quality: 'high' } }).f?.water?.reflect).toBe(true);
  });

  it("passes the run's clock as the water's now", () => {
    const r = run({ water: POOL });
    r.ctx.now = 3.25;
    expect(r.again()?.water?.now).toBe(3.25);
  });

  it('a wading own hero stirs ripples within a second; a hero on dry floor stirs none', () => {
    const wet = run({ water: POOL });
    const dry = run();
    let last: FrameInput | null = null, dryLast: FrameInput | null = null;
    for (let k = 1; k <= 60; k++) {
      wet.own.x = 56 + 20 * Math.sin(k * 0.2);
      wet.ctx.now = k / 60;
      last = wet.again();
      dry.own.x = 56 + 20 * Math.sin(k * 0.2);
      dry.ctx.now = k / 60;
      dryLast = dry.again();
    }
    expect(live(last)).toBeGreaterThanOrEqual(1);
    expect(live(dryLast)).toBe(0);
  });
});

describe('the lava in the run view (#344)', () => {
  const ROWS = ['##############', '#............#', '#............#', '#............#', '#............#', '#............#', '#............#', '##############'];
  const POOL: [number, number][] = [];
  for (let z = 2; z <= 5; z++) for (let x = 4; x <= 11; x++) POOL.push([x, z]);
  /** Bubbles with an age of 0 or more in the packed array of a frame. */
  const live = (f: FrameInput | null): number => {
    const b = f?.lavaPool?.bubbles;
    let n = 0;
    if (b) for (let i = 0; i < b.length; i += 4) if (b[i + 2] >= 0) n++;
    return n;
  };
  /** Steps `n` frames of 1/60 s (the run frame's dt) and returns the most bubbles live in any of them. */
  const most = (r: ReturnType<typeof run>, n: number): number => {
    let m = 0;
    for (let k = 1; k <= n; k++) { r.ctx.now += 1 / 60; m = Math.max(m, live(r.again())); }
    return m;
  };

  it('hands the view the lava with the shimmer on Balanced and off on Fast or with heat off', () => {
    expect(run().f?.lavaPool?.heat).toBe(true);
    expect(run({ params: { quality: 'fast' } }).f?.lavaPool?.heat).toBe(false);
    expect(run({ params: { heat: false } }).f?.lavaPool?.heat).toBe(false);
  });

  it("passes the run's clock as the lava's now", () => {
    const r = run({ rows: ROWS, lava: POOL });
    r.ctx.now = 3.25;
    expect(r.again()?.lavaPool?.now).toBe(3.25);
  });

  it('bubbles a pool in view within 3 s, and a map without lava never', () => {
    expect(most(run({ rows: ROWS, lava: POOL, ownX: 24, lavaRng: rng(5) }), 180)).toBeGreaterThan(0);
    expect(most(run({ rows: ROWS, ownX: 24 }), 180)).toBe(0);
  });

  it('a changed lava tile reaches the lava: a pool turned to floor stops bubbling', () => {
    const r = run({ rows: ROWS, lava: POOL, ownX: 24 });
    const spy = vi.spyOn((r.v as unknown as { lavaSim: { mapChanged(): void } }).lavaSim, 'mapChanged');
    for (const [x, z] of POOL) r.map.set(x, z, TILE_ID.Floor);
    r.v.tileChanged(4, 2, TILE_ID.Floor);
    expect(spy).toHaveBeenCalledTimes(1);
    r.ctx.now += 1;
    r.again(); // any bubble of before is pruned by this step
    expect(most(r, 180)).toBe(0);
  });

  it('hands the effects the lava cues of the frame', () => {
    const r = run({ rows: ROWS, lava: POOL, ownX: 24 });
    const spy = vi.spyOn((r.v as unknown as { fxPass: { run(...a: unknown[]): void } }).fxPass, 'run');
    r.again();
    expect((spy.mock.calls[0][1] as { lava?: unknown }).lava).toBeDefined();
  });

  it('a new view after a device loss keeps the bubbles', () => {
    const r = run({ rows: ROWS, lava: POOL, ownX: 24, lavaRng: rng(6) });
    let f: FrameInput | null = null;
    for (let k = 0; k < 240 && live(f) === 0; k++) { r.ctx.now += 1 / 60; f = r.again(); }
    expect(live(f)).toBeGreaterThan(0);
    const arr = f!.lavaPool!.bubbles;
    let got: FrameInput | null = null;
    r.ctx.view = { draw: (i: FrameInput) => ((got = i), 0), meshes: 0, tileChanged: () => {} } as never;
    r.v.begin(r.ctx);
    r.again();
    expect((got as FrameInput | null)?.lavaPool?.bubbles).toBe(arr);
    expect(live(got)).toBeGreaterThan(0);
  });
});
