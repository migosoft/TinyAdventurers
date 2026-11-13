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
import { followClamp, keysToWorld } from './camera';
import { startHost, type Host, type StageCtx } from './host';
import { DEFAULTS, type R3dParams } from './params';
import { renderPlan } from './quality';
import { toCanvas } from './screen';
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
    backend: 'WebGL2 fallback', setSize: vi.fn(), draw: vi.fn(() => 3), canForceLoss: true, forceLoss: vi.fn(() => true), readback: vi.fn(async () => null),
    dispose: vi.fn(), tileChanged: vi.fn(), setGround: vi.fn(), chunks: { total: 4, drawn: 2 }, meshes: 7,
  };
}

// The wizard's idle frames sit at u 0, its run frames at u 50 (every frame of an animation at the same place, so the test does not depend on the clock).
const assets: Assets = { image: {} as HTMLImageElement, frames: { knight_m_idle_anim_f0: { x: 0, y: 0, w: 16, h: 28 } } };
for (let i = 0; i < 4; i++) {
  assets.frames[`wizzard_m_idle_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
  assets.frames[`wizzard_m_run_anim_f${i}`] = { x: 50, y: 0, w: 16, h: 28 };
}

function setup(rows = ROWS, over: Partial<RunStartInfo> = {}, startYaw = 0) {
  const net = fakeNet();
  const hud = fakeHud();
  const info = startInfo(rows, over);
  const run = newRun({ info, net, hud, myClass: 'Wizard' });
  let params: R3dParams = { ...DEFAULTS, yaw: startYaw };
  const host: Host = {
    get params() { return params; },
    setParams: vi.fn((p: R3dParams) => { params = p; }),
    setRunYaw: vi.fn((yaw: number) => { params = { ...params, yaw }; }),
    setDaylight: vi.fn(),
    setSky: vi.fn(),
    stop: vi.fn(),
  };
  const el = document.createElement('div');
  const onLoop = vi.fn();
  const stage = createRunStage(run, info, assets, host, el, onLoop);
  const timer = new FrameTimer<(typeof R3D_SYSTEMS)[number]>(R3D_SYSTEMS);
  const mkCanvas = (): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.className = 'r3d';
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 1080 }) as DOMRect;
    el.appendChild(c);
    return c;
  };
  let canvasEl = mkCanvas();
  let now = 0;
  const frame = (view: View | null, held: string[] = [], dt = 1 / 60): number => {
    now += dt;
    const plan = renderPlan(params.quality, 4, 1920, 1080);
    const c: StageCtx = { now, dt, params, held: new Set(held), canvas: { w: 1920, h: 1080 }, canvasEl, zoom: 4, plan, view, timer };
    return stage.frame(c);
  };
  const rebuild = (): HTMLCanvasElement => {
    const next = mkCanvas();
    canvasEl.replaceWith(next);
    canvasEl = next;
    return next;
  };
  return { net, hud, info, run, host, el, stage, frame, onLoop, canvas: () => canvasEl, rebuild, setParams: (p: Partial<R3dParams>) => { params = { ...params, ...p }; } };
}

beforeEach(() => vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)));
afterEach(() => vi.unstubAllGlobals());

const NO_BUTTONS = { primary: () => false, secondary: () => false, act: false };

describe('stepInput', () => {
  it('reads the buttons and clears the act latch', () => {
    const s = { held: new Set<string>(), yaw: 0, free: false, primary: () => true, secondary: () => false, act: true };
    expect(stepInput(s)).toMatchObject({ primary: true, secondary: false, act: true });
    expect(s.act).toBe(false);
    expect(stepInput(s).act).toBe(false);
  });
  it('the free camera sends no buttons but still clears the latch', () => {
    const s = { held: new Set<string>(), yaw: 0, free: true, primary: () => true, secondary: () => true, act: true };
    expect(stepInput(s)).toMatchObject({ primary: false, secondary: false, act: false });
    expect(s.act).toBe(false);
  });
  it('turns the held keys by the yaw, with no buttons, and says whether a key is down', () => {
    expect(stepInput({ held: new Set(['KeyW']), yaw: 0, free: false, ...NO_BUTTONS })).toEqual({ mx: 0, my: -1, primary: false, secondary: false, act: false, held: true });
    expect(stepInput({ held: new Set(), yaw: 0, free: false, ...NO_BUTTONS })).toEqual({ mx: 0, my: 0, primary: false, secondary: false, act: false, held: false });
  });
  it('held stays true when two keys cancel out', () => {
    expect(stepInput({ held: new Set(['KeyA', 'KeyD']), yaw: 0, free: false, ...NO_BUTTONS })).toEqual({ mx: 0, my: 0, primary: false, secondary: false, act: false, held: true });
  });
  it('while the free camera is on, nothing moves and held is false', () => {
    expect(stepInput({ held: new Set(['KeyD', 'KeyW']), yaw: 1, free: true, ...NO_BUTTONS })).toEqual({ mx: 0, my: 0, primary: false, secondary: false, act: false, held: false });
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

  it('the hero card runs by the session\'s animation: against a wall and with opposite keys held, not when no key is down', () => {
    const { stage, frame } = setup(); // the hero stands at tile (1, 1), a wall to its west
    const view = fakeView();
    stage.built!(view);
    const calls = vi.mocked(view.draw).mock.calls;
    // the frame's left edge (a card facing left has its u mirrored)
    const u = (n: number): number => Math.min(...[0, 2, 4, 6, 8, 10].map((i) => calls[n][0].dynamic.cards.uv[i]));
    for (let i = 0; i < 6; i++) frame(view); // nothing held
    expect(u(calls.length - 1)).toBe(0);
    for (let i = 0; i < 12; i++) frame(view, ['KeyA']); // walks into the wall: the position does not change
    expect(stage.runView.hero.x).toBeCloseTo(1.5, 0);
    expect(u(calls.length - 1)).toBe(50);
    for (let i = 0; i < 12; i++) frame(view, ['KeyA', 'KeyD']); // the keys cancel out
    expect(u(calls.length - 1)).toBe(50);
    for (let i = 0; i < 12; i++) frame(view);
    expect(u(calls.length - 1)).toBe(0);
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

  it('the level\'s lights reach the view with the game light, and none with the work light', () => {
    const { stage, frame, setParams } = setup(ROWS, { lights: [[1, 0, 0xffa040, 2, 1, true]] });
    const view = fakeView();
    stage.built!(view);
    frame(view);
    const calls = vi.mocked(view.draw).mock.calls;
    expect(calls[0][0].lights).toHaveLength(1);
    setParams({ light: 'work' });
    frame(view);
    expect(calls[1][0].lights).toEqual([]);
    setParams({ light: 'game' });
    frame(view);
    expect(calls[2][0].lights).toHaveLength(1);
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
    expect(stage.key!({ code: 'KeyG', repeat: false } as KeyboardEvent)).toBe(false);
  });

  it('debug keys: F4, F7, F8, F9 and Shift+F7, Shift+F8 reach the session once per press, and the browser never sees them', () => {
    const { stage, run } = setup();
    const s = run.session;
    const spies = {
      darkvision: vi.spyOn(s, 'debugDarkvision'),
      incorporeal: vi.spyOn(s, 'debugIncorporeal'),
      antiMagic: vi.spyOn(s, 'debugAntiMagic'),
      effect: vi.spyOn(s, 'debugEffect'),
      dispel: vi.spyOn(s, 'debugDispel'),
      immortal: vi.spyOn(s, 'debugImmortal'),
    };
    const press = (code: string, shiftKey = false, repeat = false): boolean => stage.key!({ code, shiftKey, repeat } as KeyboardEvent);
    for (const [code, shift] of [['F4', false], ['F7', false], ['F7', true], ['F8', false], ['F8', true], ['F9', false]] as const) {
      expect(press(code, shift)).toBe(true);
      expect(press(code, shift, true)).toBe(true); // a held key: no second call, still not the browser's (F7 is caret browsing)
    }
    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
  });

  const click = (target: Element, button = 0): void => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button }));
    window.dispatchEvent(new MouseEvent('mouseup', { button }));
  };

  it('L turns the rules log on (not in a text field) and the Settings list its switches', () => {
    const { stage, net, hud } = setup();
    expect(hud.calls.filter((c) => c[0] === 'setToggles')).toHaveLength(1);
    const field = document.createElement('input');
    expect(stage.key!({ code: 'KeyL', repeat: false, shiftKey: false, target: field } as unknown as KeyboardEvent)).toBe(false);
    expect(net.sent.some((m) => m.t === 'RulesLog')).toBe(false);
    expect(stage.key!({ code: 'KeyL', repeat: false, shiftKey: false, target: null } as unknown as KeyboardEvent)).toBe(true);
    expect(net.sent.filter((m) => m.t === 'RulesLog')).toEqual([{ t: 'RulesLog', on: true, details: true }]);
  });

  it('E acts while alive, once per press', () => {
    const { stage, frame, net } = setup();
    const view = fakeView();
    expect(stage.key!({ code: 'KeyE', repeat: false } as KeyboardEvent)).toBe(true);
    expect(stage.key!({ code: 'KeyE', repeat: true } as KeyboardEvent)).toBe(true);
    frame(view);
    frame(view);
    frame(view);
    const acts = inputs(net).map((m) => m.act);
    expect(acts.filter(Boolean)).toHaveLength(1);
    expect(acts[0]).toBe(true);
  });

  it('a click sends a primary', () => {
    const { frame, net, canvas } = setup();
    const view = fakeView();
    frame(view);
    click(canvas());
    for (let i = 0; i < 3; i++) frame(view);
    expect(inputs(net).some((m) => m.primary !== null)).toBe(true);
  });

  it('a click on the panel sends nothing', () => {
    const { frame, net, el } = setup();
    const panel = document.createElement('div');
    panel.className = 'r3d-panel';
    el.appendChild(panel);
    click(panel);
    for (let i = 0; i < 3; i++) frame(fakeView());
    expect(inputs(net).every((m) => m.primary === null)).toBe(true);
  });

  it('after a rebuild a click on the new canvas still fires', () => {
    const { frame, net, rebuild } = setup();
    const view = fakeView();
    frame(view);
    const next = rebuild();
    click(next);
    for (let i = 0; i < 3; i++) frame(view);
    expect(inputs(net).some((m) => m.primary !== null)).toBe(true);
  });

  it('the pointer aims the hero', () => {
    const { frame, net, stage } = setup();
    const view = fakeView();
    for (let i = 0; i < 3; i++) frame(view);
    const plan = renderPlan(DEFAULTS.quality, 4, 1920, 1080);
    const cam = { x: stage.runView.cam.x, z: stage.runView.cam.z, pitch: (DEFAULTS.pitch * Math.PI) / 180, yaw: 0 };
    // 2 tiles east of the hero, 8 art px (4 x 8 canvas px) above that spot
    const p = toCanvas(cam, plan, 4, stage.runView.hero.x + 2, 0, stage.runView.hero.z);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: p.px, clientY: p.py - 8 * 4 }));
    for (let i = 0; i < 3; i++) frame(view);
    const last = inputs(net).at(-1)!;
    expect(last.aim).toBeCloseTo(0, 2);
    expect(last.aim_dist).toBeGreaterThan(20);
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
      const host: Host = { params: DEFAULTS, setParams: vi.fn(), setRunYaw: vi.fn(), setDaylight: vi.fn(), setSky: vi.fn(), stop: vi.fn() };
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
      stage!.frame({ now: 1, dt: 1 / 60, params: DEFAULTS, held: new Set(), canvas: { w: 1920, h: 1080 }, canvasEl: document.createElement('canvas'), zoom: 4, plan, view: null, timer });
      const n = hud.calls.filter((c) => c[0] === 'frame').length;
      vi.advanceTimersByTime(100);
      expect(hud.calls.filter((c) => c[0] === 'frame').length).toBe(n);
      run.stop();
      expect(host.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds the Settings switches to the run's log at once, even if the host never starts, and clears them on stop", () => {
    const net = fakeNet();
    const hud = fakeHud();
    const run = startRun3d(document.createElement('div'), '', {
      info: startInfo(ROWS), net: net as unknown as Net, hud: hud as unknown as Hud, myClass: 'Wizard',
      startHost: () => new Promise(() => {}), // the atlas never loads
    });
    const toggles = hud.calls.filter((c) => c[0] === 'setToggles');
    expect(toggles).toHaveLength(1);
    expect((toggles[0][1] as { label: string }[]).length).toBeGreaterThan(0);
    run.stop();
    expect(hud.calls.filter((c) => c[0] === 'setToggles').pop()).toEqual(['setToggles', []]);
  });

  it('replays the messages buffered while the chunk loaded into the session', () => {
    const net = fakeNet();
    const hud = fakeHud();
    const info = startInfo(['#####', '#...#', '#####']);
    const run = startRun3d(document.createElement('div'), '', {
      info, net: net as unknown as Net, hud: hud as unknown as Hud, myClass: 'Wizard',
      early: [snap({ ev: [tile(1, 1, TILE_ID.DoorClosed)] })], startHost: () => new Promise(() => {}),
    });
    const said = hud.calls.filter((c) => c[0] === 'message' && String(c[1]).includes('force field'));
    expect(said).toHaveLength(1); // the Tile event changed the session's map
    run.stop();
  });

  it('stop before the host exists stops the host the moment it is made', async () => {
    const net = fakeNet();
    const hud = fakeHud();
    const host: Host = { params: DEFAULTS, setParams: vi.fn(), setRunYaw: vi.fn(), setDaylight: vi.fn(), setSky: vi.fn(), stop: vi.fn() };
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

  describe('turning the camera', () => {
    const press = (stage: ReturnType<typeof setup>['stage'], code: string, repeat = false): boolean => stage.key!({ code, repeat } as KeyboardEvent);
    const settle = (frame: ReturnType<typeof setup>['frame']): void => {
      for (let i = 0; i < 20; i++) frame(null);
    };
    const lastDir = (net: ReturnType<typeof fakeNet>): [number, number] => {
      const m = inputs(net)[inputs(net).length - 1];
      return [m.mx, m.my];
    };

    it('a run starts facing north even with yaw in the URL', () => {
      const { frame, host, run } = setup(ROWS, {}, 90);
      frame(null);
      expect(host.params.yaw).toBe(0);
      expect(run.input.yaw).toBe(0);
    });

    it('Z then a held D still walks screen-right after the turn', () => {
      const { stage, frame, net, host } = setup();
      expect(press(stage, 'KeyZ')).toBe(true);
      settle(frame);
      expect(host.params.yaw).toBe(45);
      for (let i = 0; i < 6; i++) frame(null, ['KeyD']);
      expect(lastDir(net)).toEqual([1, 1]);
    });

    it('a key held through a turn keeps its screen direction within 22.5 degrees', () => {
      const { stage, frame, net, run } = setup();
      press(stage, 'KeyZ');
      let checked = 0;
      for (let i = 0; i < 20; i++) {
        const before = inputs(net).length;
        frame(null, ['KeyD']);
        if (inputs(net).length === before) continue;
        const [mx, my] = lastDir(net);
        const want = keysToWorld(run.input.yaw, 1, 0);
        const diff = Math.abs(Math.atan2(my, mx) - Math.atan2(want.z, want.x));
        expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThanOrEqual(Math.PI / 8 + 1e-6);
        checked++;
      }
      expect(checked).toBeGreaterThan(3);
    });

    it('X turns back to north', () => {
      const { stage, frame, host } = setup();
      press(stage, 'KeyZ');
      press(stage, 'KeyZ');
      settle(frame);
      expect(host.params.yaw).toBe(90);
      press(stage, 'KeyX');
      settle(frame);
      expect(host.params.yaw).toBe(0);
    });

    it('C turns the other way and a repeat does nothing', () => {
      const { stage, frame, host } = setup();
      press(stage, 'KeyC');
      press(stage, 'KeyC', true);
      settle(frame);
      expect(host.params.yaw).toBe(-45);
    });

    it("the panel's yaw slider sets the turn", () => {
      const { frame, setParams, run, host } = setup();
      frame(null);
      setParams({ yaw: 120 });
      frame(null);
      expect(run.input.yaw).toBeCloseTo((120 * Math.PI) / 180);
      expect(host.params.yaw).toBe(120);
    });

    it('Z, C and X do nothing while a text field has focus', () => {
      const { stage, frame, host } = setup();
      const input = document.createElement('input');
      document.body.appendChild(input);
      const onKey = (e: KeyboardEvent): void => void stage.key!(e);
      window.addEventListener('keydown', onKey);
      for (const code of ['KeyZ', 'KeyC', 'KeyX']) input.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      window.removeEventListener('keydown', onKey);
      input.remove();
      settle(frame);
      expect(host.params.yaw).toBe(0);
    });

    it('Ctrl, Cmd or Alt with Z, X, C or L is left to the browser', () => {
      const { stage, frame, host, net } = setup();
      for (const code of ['KeyZ', 'KeyC', 'KeyX', 'KeyL']) {
        for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
          expect(stage.key!({ code, repeat: false, shiftKey: false, target: null, [mod]: true } as unknown as KeyboardEvent)).toBe(false);
        }
      }
      settle(frame);
      expect(host.params.yaw).toBe(0);
      expect(net.sent.some((m) => m.t === 'RulesLog')).toBe(false);
      expect(stage.key!({ code: 'KeyZ', repeat: false, target: null } as unknown as KeyboardEvent)).toBe(true); // plain Z still turns
    });

    it('reads the canvas rect once per frame, however often the pointer is read', () => {
      const { frame, canvas } = setup();
      let reads = 0;
      const c = canvas();
      c.getBoundingClientRect = () => {
        reads++;
        return { left: 0, top: 0, width: 1920, height: 1080 } as DOMRect;
      };
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 300 }));
      frame(null);
      frame(null);
      frame(null);
      expect(reads).toBe(3);
    });

    it('turning does not write yaw into the URL', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const spy = vi.spyOn(history, 'replaceState');
      try {
        const net = fakeNet();
        const info = startInfo(ROWS);
        const run = newRun({ info, net, hud: fakeHud(), myClass: 'Wizard' });
        const el = document.createElement('div');
        document.body.appendChild(el);
        const deps = {
          createView: vi.fn(async () => fakeView()),
          loadAtlas: vi.fn(async () => ({ img: new Image(), frames: {} })),
        };
        let st: ReturnType<typeof createRunStage> | undefined;
        const host = await startHost(el, '', 'run', (a, h) => (st = createRunStage(run, info, a, h, el)), deps);
        st!.key!({ code: 'KeyZ', repeat: false } as KeyboardEvent);
        st!.frame({ now: 1, dt: 1, params: host!.params, held: new Set(), canvas: { w: 1920, h: 1080 }, canvasEl: el.querySelector('canvas')!, zoom: 4, plan: renderPlan('balanced', 4, 1920, 1080), view: null, timer: new FrameTimer(R3D_SYSTEMS) });
        expect(host!.params.yaw).toBe(45);
        host!.setParams({ ...host!.params, pitch: 40 });
        vi.advanceTimersByTime(1000);
        expect(spy).toHaveBeenCalled(); // the pitch change was written, so the check below looks at something
        for (const c of spy.mock.calls) expect(String(c[2])).not.toContain('yaw');
        host!.stop();
      } finally {
        spy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('the stage shows the turn help and removes it on dispose', async () => {
      const { hud, stage } = setup();
      await vi.waitFor(() => expect(hud.calls.some((c) => c[0] === 'setTurnHelp' && Array.isArray(c[1]))).toBe(true));
      stage.dispose();
      expect(hud.calls[hud.calls.length - 1]).toEqual(['setTurnHelp', null]);
    });
  });
});
