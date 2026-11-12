// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ANIM, KIND, LIGHT_KIND } from '../generated/defs';
import { LightField } from '../game/light';
import { TileMap } from '../sim/map';
import { fakeHud, snap, startInfo } from '../run/testing';
import type { RunFrame, RunViewInit } from '../run/view';
import { keysToWorld } from './camera';
import { AMBIENT, WORK_AMBIENT } from './light';
import { renderPlan } from './quality';
import { DEFAULTS, type R3dParams } from './params';
import { RunView3d, moveInput } from './runView3d';
import type { StageCtx } from './host';
import type { FrameInput } from './view';

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

function run(over: { woodland?: boolean; params?: Partial<R3dParams>; me?: { darkvision: number; vision: number }; moving?: [number, number, number, number | null][]; ents?: number[][]; torch?: boolean } = {}) {
  const info = startInfo(['#######', '#.....#', '#.....#', '#######'], over.woodland ? { woodland: { seed: 1, end: [0, 0, 1, 1], plants: [], sun: { side: 1, elevation: 30 } } as never } : {});
  const map = new TileMap(info.width, info.height, new Uint8Array(info.tiles));
  const light = new LightField(map);
  if (over.torch !== false) light.add({ id: 1, kind: LIGHT_KIND.Torch, colour: 0xffa040, x: 3, y: 1, on: true });
  const init: RunViewInit = { info, map, light, myKind: KIND.Wizard };
  const v = new RunView3d(init, frames, bounds);
  let got: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((got = i), 0), meshes: 0, tileChanged: () => {} };
  const params = { ...DEFAULTS, ...over.params };
  const plan = { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 };
  const canvasEl = document.createElement('canvas');
  canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 }) as DOMRect;
  const timer = { lap() {}, renderStart() {}, systems: {}, frameMs: 0, renderMs: 0 };
  v.begin({ now: 0, dt: 1 / 60, params, held: new Set(), canvas: { w: 1280, h: 720 }, zoom: 2, plan, canvasEl, view, timer } as unknown as StageCtx);
  const s = snap({ lights: over.moving ?? [], ents: (over.ents ?? []) as never });
  if (over.me) Object.assign(s.me, over.me);
  const own = { x: 56, y: 24, alive: true, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, aimsAtPointer: false, aimFromX: 56, aimFromY: 24, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false };
  const f = { dt: 1 / 60, now: 0, ents: new Map(), you: 1, own, watching: null, camera: { x: 56, y: 24 }, snap: s, shots: [], hiddenShots: new Set(), useHint: null, dark: new Set(), debug: { on: false, path: [], ogre: [], cove: [], notice: [], dodges: [] } } as unknown as RunFrame;
  const stats = v.frame(f);
  void fakeHud;
  return { f: got as FrameInput | null, stats, own, v };
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
  it('a woodland frame has no lights, no lava, no darkvision and the work ambient', () => {
    const { f, stats } = run({ woodland: true });
    expect(f?.lights).toEqual([]);
    expect(f?.casters).toEqual([]);
    expect(f?.lava).toBeNull();
    expect(f?.darkvision).toBeNull();
    expect(f?.ambient).toEqual([...WORK_AMBIENT]);
    expect(stats.lines).toBeUndefined();
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
    const { f, own } = run({ torch: false, moving: [[56, 24, LIGHT_KIND.Torch, null]], ents: [ent] });
    expect(f?.lights).toHaveLength(1);
    expect(f?.lights[0].x).toBeCloseTo(own.x / 16);
    expect(f?.lights[0].z).toBeCloseTo(own.y / 16);
  });
  it('the readout lines say the lights in use and the caps', () => {
    const { stats } = run({ params: { lcap: 8, ccap: 4 } });
    expect(stats.lines).toEqual(['lights     1 of 1 (cap 8)', 'shadows    1 cards (cap 4)']);
  });
  it('a refilled lava buffer bumps lavaVersion', () => {
    const a = run();
    expect(a.f?.lavaVersion).toBeGreaterThan(0);
  });
});
