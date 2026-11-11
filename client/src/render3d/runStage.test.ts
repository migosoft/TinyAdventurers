// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE_ID } from '../generated/defs';
import type { ClientMsg } from '../generated/ClientMsg';
import type { Ev } from '../generated/Ev';
import type { Net } from '../net';
import type { Hud } from '../ui/hud';
import { FrameTimer } from '../game/frameTimer';
import { fakeHud, fakeNet, snap, startInfo } from '../run/testing';
import { startRun3d } from './boot';
import { followClamp } from './camera';
import { type Host, type StageCtx } from './host';
import { DEFAULTS, type R3dParams } from './params';
import { renderPlan } from './quality';
import { createRunStage, newRun, stepInput } from './runStage';
import { R3D_SYSTEMS } from './stats';
import { GroundTooLargeError, type Assets, type View } from './view';
import type { RunStartInfo } from '../generated/RunStartInfo';

const ROWS = ['#####', '#...#', '#####'];
const BIG = Array.from({ length: 40 }, () => '.'.repeat(40));
const WOODLAND = { seed: 1, end: [0, 0, 1, 1], plants: [], sun: { side: 1, elevation: 30 } } as unknown as RunStartInfo['woodland'];
const tile = (x: number, y: number, v: number): Ev => ({ t: 'Tile', x, y, v });
const inputs = (net: ReturnType<typeof fakeNet>) => net.sent.filter((m): m is Extract<ClientMsg, { t: 'Input' }> => m.t === 'Input');

function fakeView(): View & { setGround: ReturnType<typeof vi.fn>; tileChanged: ReturnType<typeof vi.fn> } {
  return {
    backend: 'WebGL2 fallback', setSize: vi.fn(), draw: vi.fn(() => 3), canForceLoss: true, forceLoss: vi.fn(() => true),
    dispose: vi.fn(), tileChanged: vi.fn(), setGround: vi.fn(), chunks: { total: 4, drawn: 2 }, meshes: 7,
  };
}

const assets: Assets = { image: {} as HTMLImageElement, frames: { knight_m_idle_anim_f0: { x: 0, y: 0, w: 16, h: 28 }, wizzard_m_idle_anim_f0: { x: 0, y: 0, w: 16, h: 28 } } };

function setup(rows = ROWS, over: Partial<RunStartInfo> = {}) {
  const net = fakeNet();
  const hud = fakeHud();
  const info = startInfo(rows, over);
  const run = newRun({ info, net, hud, myClass: 'Wizard' });
  let params: R3dParams = { ...DEFAULTS };
  const host: Host = { get params() { return params; }, setParams: vi.fn((p: R3dParams) => { params = p; }), stop: vi.fn() };
  const el = document.createElement('div');
  const onLoop = vi.fn();
  const stage = createRunStage(run, info, assets, host, el, onLoop);
  const timer = new FrameTimer<(typeof R3D_SYSTEMS)[number]>(R3D_SYSTEMS);
  let now = 0;
  const frame = (view: View | null, held: string[] = [], dt = 1 / 60): number => {
    now += dt;
    const plan = renderPlan(params.quality, 4, 1920, 1080);
    const c: StageCtx = { now, dt, params, held: new Set(held), canvas: { w: 1920, h: 1080 }, zoom: 4, plan, view, timer };
    return stage.frame(c);
  };
  return { net, hud, info, run, host, el, stage, frame, onLoop, setParams: (p: Partial<R3dParams>) => { params = { ...params, ...p }; } };
}

beforeEach(() => vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)));
afterEach(() => vi.unstubAllGlobals());

describe('stepInput', () => {
  it('turns the held keys by the yaw, with no buttons, and says whether a key is down', () => {
    expect(stepInput({ held: new Set(['KeyW']), yaw: 0, free: false })).toEqual({ mx: 0, my: -1, primary: false, secondary: false, act: false, held: true });
    expect(stepInput({ held: new Set(), yaw: 0, free: false })).toEqual({ mx: 0, my: 0, primary: false, secondary: false, act: false, held: false });
  });
  it('held stays true when two keys cancel out', () => {
    expect(stepInput({ held: new Set(['KeyA', 'KeyD']), yaw: 0, free: false })).toEqual({ mx: 0, my: 0, primary: false, secondary: false, act: false, held: true });
  });
  it('while the free camera is on, nothing moves and held is false', () => {
    expect(stepInput({ held: new Set(['KeyD', 'KeyW']), yaw: 1, free: true })).toEqual({ mx: 0, my: 0, primary: false, secondary: false, act: false, held: false });
  });
});

describe('the run stage', () => {
  it("the stage's world map is the session's map", () => {
    const { net, stage, run } = setup();
    net.emit(snap({ ev: [tile(2, 1, TILE_ID.DoorClosed)] }));
    expect(stage.world.map).toBe(run.session.map);
    expect(stage.world.map.get(2, 1)).toBe(TILE_ID.DoorClosed);
    expect(stage.world.painted).toBe(false);
    expect(stage.world.clear).toBe('stone');
  });

  it('a woodland run is painted on a green clear colour', () => {
    const { stage } = setup(ROWS, { woodland: WOODLAND });
    expect(stage.world.painted).toBe(true);
    expect(stage.world.clear).not.toBe('stone');
  });

  it('a tile change reaches the three view', () => {
    const { net, stage } = setup();
    const view = fakeView();
    stage.built!(view);
    net.emit(snap({ ev: [tile(2, 1, TILE_ID.DoorClosed)] }));
    expect(view.tileChanged).toHaveBeenCalledWith(2, 1);
  });

  it('the ground is uploaded again after a rebuild, not repainted', () => {
    const { stage, frame } = setup(ROWS, { woodland: WOODLAND });
    const view = fakeView();
    stage.built!(view);
    expect(view.setGround).not.toHaveBeenCalled(); // the job is not done yet
    for (let i = 0; i < 50 && !stage.job!.done; i++) frame(view);
    expect(stage.job!.done).toBe(true);
    expect(view.setGround).toHaveBeenCalledTimes(1);
    const first = view.setGround.mock.calls[0][0] as { data: Uint8ClampedArray };
    const view2 = fakeView();
    stage.built!(view2);
    expect(view2.setGround).toHaveBeenCalledTimes(1);
    expect((view2.setGround.mock.calls[0][0] as { data: Uint8ClampedArray }).data).toBe(first.data);
    frame(view2);
    expect(view2.setGround).toHaveBeenCalledTimes(1); // no second upload by the frame
  });

  it('a ground too large for the device shows the error once and the run goes on', () => {
    const { stage, frame, el } = setup(ROWS, { woodland: WOODLAND });
    const view = fakeView();
    view.setGround.mockImplementation(() => {
      throw new GroundTooLargeError(1, 1, 0);
    });
    stage.built!(view);
    for (let i = 0; i < 50 && !stage.job!.done; i++) frame(view);
    expect(el.querySelectorAll('.r3d-error')).toHaveLength(1);
    stage.built!(view);
    expect(el.querySelectorAll('.r3d-error')).toHaveLength(1);
    expect(() => frame(view)).not.toThrow();
  });

  it('the first frame tells the starter that the loop has taken over', () => {
    const { frame, onLoop } = setup();
    expect(onLoop).not.toHaveBeenCalled();
    frame(fakeView());
    frame(fakeView());
    expect(onLoop).toHaveBeenCalledTimes(1);
  });

  it('a frame draws through the view and returns its draw calls', () => {
    const { stage, frame } = setup();
    const view = fakeView();
    stage.built!(view);
    expect(frame(view)).toBe(3);
    expect(view.draw).toHaveBeenCalledTimes(1);
  });

  it('a frame without a view still runs the session', () => {
    const { frame, net } = setup();
    expect(frame(null)).toBe(0);
    frame(null);
    expect(inputs(net).length).toBeGreaterThan(0);
  });

  it('walks by the keys: D at yaw 0 sends east', () => {
    const { frame, net } = setup();
    const view = fakeView();
    for (let i = 0; i < 4; i++) frame(view, ['KeyD']);
    expect(inputs(net).some((m) => m.mx === 1 && m.my === 0)).toBe(true);
  });

  it('the free camera stops the hero', () => {
    const { frame, net, stage, setParams } = setup(BIG);
    const view = fakeView();
    frame(view);
    const x0 = stage.runView.cam.x;
    setParams({ free: true });
    for (let i = 0; i < 30; i++) frame(view, ['KeyD']);
    const sent = inputs(net).slice(-5);
    expect(sent.length).toBeGreaterThan(0);
    for (const m of sent) {
      expect(m.mx).toBe(0);
      expect(m.my).toBe(0);
    }
    expect(stage.runView.cam.x).toBeGreaterThan(x0 + 1);
  });

  it('the follow camera stays inside the map', () => {
    const { frame, stage, info } = setup(BIG);
    const view = fakeView();
    for (let i = 0; i < 60; i++) frame(view);
    const plan = renderPlan(DEFAULTS.quality, 4, 1920, 1080);
    const want = followClamp({ w: info.width, h: info.height }, { x: stage.runView.hero.x, z: stage.runView.hero.z, pitch: (DEFAULTS.pitch * Math.PI) / 180, yaw: 0 }, plan.halfW, plan.halfH);
    expect(Math.abs(stage.runView.cam.x - want.x)).toBeLessThan(0.01);
    expect(Math.abs(stage.runView.cam.z - want.z)).toBeLessThan(0.01);
    expect(want.x).toBeGreaterThan(stage.runView.hero.x + 1); // the corner hero is not centred
  });

  it('back from the free camera, the follow camera eases from where it was', () => {
    const { frame, stage, setParams } = setup(BIG);
    const view = fakeView();
    frame(view);
    setParams({ free: true });
    for (let i = 0; i < 30; i++) frame(view, ['KeyD']);
    const away = stage.runView.cam.x;
    setParams({ free: false });
    frame(view);
    expect(stage.runView.cam.x).toBeLessThan(away); // eased toward the hero, not jumped
    expect(stage.runView.cam.x).toBeGreaterThan(15);
  });

  it('the camera is a lantern light only outside a woodland, with the lantern parameter', () => {
    const { stage, frame, setParams } = setup(ROWS);
    const view = fakeView();
    stage.built!(view);
    frame(view);
    const calls = vi.mocked(view.draw).mock.calls;
    expect(calls[0][0].lights).toEqual([]);
    setParams({ light: 'lantern' });
    frame(view);
    expect(calls[1][0].lights).toHaveLength(1);
    expect(calls[1][0].lights[0]).toMatchObject({ y: 1.0, radius: 9 });
  });

  it('keys: Esc opens the menu, F flips the free camera, Q and E watch only when dead', () => {
    const { stage, hud, host, net } = setup();
    expect(stage.key!({ code: 'Escape', repeat: false } as KeyboardEvent)).toBe(true);
    expect(hud.calls.some((c) => c[0] === 'toggleMenu')).toBe(true);
    expect(stage.key!({ code: 'KeyF', repeat: false } as KeyboardEvent)).toBe(true);
    expect(host.setParams).toHaveBeenCalledWith(expect.objectContaining({ free: true }));
    expect(stage.key!({ code: 'KeyQ', repeat: false } as KeyboardEvent)).toBe(false);
    expect(net.sent.some((m) => m.t === 'Spectate')).toBe(false);
    net.emit(snap({ me: { ...snap().me, alive: false } }));
    expect(stage.key!({ code: 'KeyE', repeat: false } as KeyboardEvent)).toBe(true);
    expect(stage.key!({ code: 'KeyQ', repeat: false } as KeyboardEvent)).toBe(true);
    expect(net.sent.filter((m) => m.t === 'Spectate')).toEqual([{ t: 'Spectate', dir: 1 }, { t: 'Spectate', dir: -1 }]);
    expect(stage.key!({ code: 'KeyX', repeat: false } as KeyboardEvent)).toBe(false);
  });

  it('F3 toggles the session stats and keeps the host readout hidden', () => {
    const { stage, hud } = setup();
    expect(stage.stats!()).toBe(true);
    expect(hud.calls.some((c) => c[0] === 'toggleDebug')).toBe(true);
  });

  it('window.__r3d gains hero, cam and chunks', () => {
    const { stage, frame } = setup();
    const state = { backend: '', frames: 0, renderSize: [0, 0] as [number, number], zoom: 0 };
    window.__r3d = state;
    const view = fakeView();
    stage.built!(view);
    frame(view);
    expect(window.__r3d.hero).toBe(stage.runView.hero);
    expect(window.__r3d.cam).toBe(stage.runView.cam);
    expect(window.__r3d.chunks).toEqual({ total: 4, drawn: 2 });
    delete window.__r3d;
  });
});

describe('startRun3d', () => {
  it('stop ends the pre-view interval', () => {
    vi.useFakeTimers();
    try {
      const net = fakeNet();
      const hud = fakeHud();
      const run = startRun3d(document.createElement('div'), '', {
        info: startInfo(ROWS), net: net as unknown as Net, hud: hud as unknown as Hud, myClass: 'Wizard',
        startHost: () => new Promise(() => {}),
      });
      vi.advanceTimersByTime(100);
      const before = hud.calls.filter((c) => c[0] === 'frame').length;
      expect(before).toBeGreaterThan(0); // the session runs without a view
      run.stop();
      vi.advanceTimersByTime(100);
      expect(hud.calls.filter((c) => c[0] === 'frame').length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the host's first frame takes over from the interval", async () => {
    vi.useFakeTimers();
    try {
      const net = fakeNet();
      const hud = fakeHud();
      let stage: ReturnType<typeof createRunStage> | null = null;
      const host: Host = { params: DEFAULTS, setParams: vi.fn(), stop: vi.fn() };
      const run = startRun3d(document.createElement('div'), '', {
        info: startInfo(ROWS), net: net as unknown as Net, hud: hud as unknown as Hud, myClass: 'Wizard',
        startHost: async (_el, _s, _m, make) => {
          stage = make(assets, host) as ReturnType<typeof createRunStage>;
          return host;
        },
      });
      await Promise.resolve();
      expect(stage).not.toBeNull();
      const timer = new FrameTimer<(typeof R3D_SYSTEMS)[number]>(R3D_SYSTEMS);
      const plan = renderPlan('balanced', 4, 1920, 1080);
      stage!.frame({ now: 1, dt: 1 / 60, params: DEFAULTS, held: new Set(), canvas: { w: 1920, h: 1080 }, zoom: 4, plan, view: null, timer });
      const n = hud.calls.filter((c) => c[0] === 'frame').length;
      vi.advanceTimersByTime(100);
      expect(hud.calls.filter((c) => c[0] === 'frame').length).toBe(n);
      run.stop();
      expect(host.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop before the host exists stops the host the moment it is made', async () => {
    const net = fakeNet();
    const hud = fakeHud();
    const host: Host = { params: DEFAULTS, setParams: vi.fn(), stop: vi.fn() };
    const run = startRun3d(document.createElement('div'), '', {
      info: startInfo(ROWS), net: net as unknown as Net, hud: hud as unknown as Hud, myClass: 'Wizard',
      startHost: async (_el, _s, _m, make) => {
        await Promise.resolve();
        make(assets, host);
        return host;
      },
    });
    run.stop();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.stop).toHaveBeenCalled();
  });
});
