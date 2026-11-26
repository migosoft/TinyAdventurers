// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearErrors, showError, startHost, type Host, type Stage } from './host';
import type { View, WorldInput } from './view';
import { stoneField } from './stone/field';
import { parseMap, MAP_ROWS } from './demoMap';
import { DEFAULTS } from './params';
import { QUALITY_KEY } from './qualityPref';

function fakeView(backend: View['backend'] = 'WebGL2 fallback'): View {
  return {
    backend, setSize: vi.fn(), draw: vi.fn(() => 0), canForceLoss: true, maxTexture: 8192, forceLoss: vi.fn(() => true), readback: vi.fn(async () => null),
    dispose: vi.fn(), tileChanged: vi.fn(), setGround: vi.fn(), setCover: vi.fn(), stone: null, setStonePages: vi.fn(), chunks: { total: 0, drawn: 0 }, meshes: 0,
  };
}

const worldMap = parseMap(MAP_ROWS);
const world: WorldInput = { map: worldMap, painted: false, clear: 'stone', stone: stoneField(worldMap) };

function setup() {
  const views: View[] = [];
  const lost: ((m: string) => void)[] = [];
  const worlds: WorldInput[] = [];
  const deps = {
    createView: vi.fn(async (_c: HTMLCanvasElement, _a: unknown, w: WorldInput, _o: unknown, onLost: (m: string) => void) => {
      const v = fakeView();
      views.push(v);
      lost.push(onLost);
      worlds.push(w);
      return v;
    }),
    loadAtlas: vi.fn(async () => ({ img: new Image(), frames: {} })),
  };
  const stage = {
    world, built: vi.fn(), frame: vi.fn(() => 0), key: vi.fn(() => false), dispose: vi.fn(),
  } satisfies Stage;
  return { deps, stage, views, lost, worlds };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const key = (target: EventTarget, code = 'KeyW') => target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

describe('startHost', () => {
  it('stop removes everything it added', async () => {
    const { deps, stage, views } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', () => stage, deps);
    expect(host).not.toBeNull();
    expect(el.children.length).toBeGreaterThan(0);
    expect(window.__r3d).toBeDefined();
    host!.stop();
    expect(el.children.length).toBe(0);
    key(window);
    window.dispatchEvent(new Event('blur'));
    expect(stage.key).not.toHaveBeenCalled();
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    expect(stage.dispose).toHaveBeenCalledTimes(1);
    expect(window.__r3d).toBeUndefined();
    host!.stop(); // a second stop does nothing
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('two hosts in a row leave one canvas', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const a = setup();
    (await startHost(el, '', 'demo', () => a.stage, a.deps))!.stop();
    const b = setup();
    const h = await startHost(el, '', 'demo', () => b.stage, b.deps);
    expect(el.querySelectorAll('canvas').length).toBe(1);
    h!.stop();
  });

  it('keys typed into an input are not the stage\'s', async () => {
    const { deps, stage } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', () => stage, deps);
    const input = document.createElement('input');
    el.appendChild(input);
    key(input);
    expect(stage.key).not.toHaveBeenCalled();
    key(el);
    expect(stage.key).toHaveBeenCalledTimes(1);
    host!.stop();
  });

  it('keys reach the stage from a radio or a checkbox but not from a text or range input', async () => {
    const { deps, stage } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', () => stage, deps);
    const make = (type: string) => {
      const i = document.createElement('input');
      i.type = type;
      el.appendChild(i);
      return i;
    };
    try {
      for (const type of ['text', 'range']) {
        key(make(type), 'Escape');
        expect(stage.key).not.toHaveBeenCalled();
      }
      for (const [n, type] of ['radio', 'checkbox'].entries()) {
        key(make(type), 'Escape');
        expect(stage.key).toHaveBeenCalledTimes(n + 1);
      }
    } finally {
      host!.stop();
    }
  });

  it('stop through the Host while the first view is pending leaves nothing behind', async () => {
    const { deps, stage, views } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = deps.createView.getMockImplementation()!;
    deps.createView.mockImplementation(async (...a: Parameters<typeof inner>) => {
      await gate;
      return inner(...a);
    });
    let h!: Host;
    const p = startHost(el, '', 'demo', (_a, host) => ((h = host), stage), deps);
    await vi.waitFor(() => expect(deps.createView).toHaveBeenCalledTimes(1));
    expect(() => h.stop()).not.toThrow();
    release();
    expect(await p).toBeNull();
    expect(el.children.length).toBe(0);
    expect(window.__r3d).toBeUndefined();
    key(window);
    expect(stage.key).not.toHaveBeenCalled();
    expect(views[0].dispose).toHaveBeenCalledTimes(1);
    expect(stage.dispose).toHaveBeenCalledTimes(1);
  });

  it('an error box outlives a failed start, and goes with clearErrors, the next host or a later stop', async () => {
    const { deps, stage } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    deps.createView.mockRejectedValueOnce(new Error('no GPU'));
    expect(await startHost(el, '', 'demo', () => stage, deps)).toBeNull();
    expect(el.querySelectorAll('.r3d-error')).toHaveLength(1);
    clearErrors(el);
    expect(el.children.length).toBe(0);
    deps.createView.mockRejectedValueOnce(new Error('no GPU'));
    await startHost(el, '', 'demo', () => stage, deps);
    const host = await startHost(el, '', 'demo', () => stage, deps); // the next host removes the old box
    expect(el.querySelectorAll('.r3d-error')).toHaveLength(0);
    showError(el, 'ground too large', false); // a box of this host
    host!.stop();
    expect(el.children.length).toBe(0);
  });

  it('setParams inside makeStage does not throw', async () => {
    const { deps, stage } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', (_a, h) => {
      h.setParams({ ...h.params, pitch: 40 });
      return stage;
    }, deps);
    expect(host!.params.pitch).toBe(40);
    host!.stop();
  });

  it('a throwing makeStage or first built leaves nothing behind', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const a = setup();
    await expect(startHost(el, '', 'demo', () => { throw new Error('boom'); }, a.deps)).rejects.toThrow('boom');
    expect(el.children.length).toBe(0);
    const b = setup();
    b.stage.built.mockImplementation(() => { throw new Error('built'); });
    await expect(startHost(el, '', 'demo', () => b.stage, b.deps)).rejects.toThrow('built');
    expect(el.children.length).toBe(0);
    expect(window.__r3d).toBeUndefined();
    expect(b.views[0].dispose).toHaveBeenCalledTimes(1);
    expect(b.stage.dispose).toHaveBeenCalledTimes(1);
    key(window);
    expect(b.stage.key).not.toHaveBeenCalled();
  });

  it('stage.key returning true prevents the default', async () => {
    const { deps, stage } = setup();
    stage.key.mockReturnValue(true);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', () => stage, deps);
    const e = new KeyboardEvent('keydown', { code: 'KeyQ', cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    host!.stop();
  });

  it('stop leaves a newer host\'s __r3d alone and cancels the URL write', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { deps, stage } = setup();
      const el = document.createElement('div');
      document.body.appendChild(el);
      const spy = vi.spyOn(history, 'replaceState');
      const host = await startHost(el, '', 'demo', () => stage, deps);
      host!.setParams({ ...host!.params, pitch: 33 });
      const other = { backend: 'x', frames: 0, renderSize: [0, 0] as [number, number], zoom: 0 };
      window.__r3d = other;
      host!.stop();
      vi.advanceTimersByTime(1000);
      expect(spy).not.toHaveBeenCalled();
      expect(window.__r3d).toBe(other);
      delete window.__r3d;
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rebuild reads the stage\'s world again and calls built', async () => {
    const { deps, stage, lost, worlds } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', () => stage, deps);
    expect(deps.createView).toHaveBeenCalledTimes(1);
    expect(stage.built).toHaveBeenCalledTimes(1);
    lost[0]('test');
    await vi.waitFor(() => expect(stage.built).toHaveBeenCalledTimes(2));
    expect(deps.createView).toHaveBeenCalledTimes(2);
    expect(worlds[1]).toBe(world);
    expect(worlds[0]).toBe(world);
    expect(el.querySelectorAll('canvas').length).toBe(1);
    host!.stop();
  });

  /** Reports a loss from the newest view and waits for the rebuild it starts (or for the recovery to give up). */
  async function loseAndWait(deps: { createView: { mock: { calls: unknown[] } } }, lost: ((m: string) => void)[], settled: () => boolean): Promise<void> {
    const before = deps.createView.mock.calls.length;
    lost[lost.length - 1]('x');
    await vi.waitFor(() => expect(deps.createView.mock.calls.length > before || settled()).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('WebGPU that keeps failing falls back to WebGL2, WebGL2 that keeps failing ends with one error box (#313)', async () => {
    const forced: boolean[] = [];
    const { deps, stage, lost } = setup();
    deps.createView.mockImplementation(async (_c, _a, _w, o: unknown, onLost: (m: string) => void) => {
      forced.push((o as { forceWebGL: boolean }).forceWebGL);
      lost.push(onLost);
      return fakeView(forced[forced.length - 1] ? 'WebGL2 fallback' : 'WebGPU');
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', () => stage, deps);
    let failed = false;
    for (let i = 0; i < 3; i++) await loseAndWait(deps, lost, () => failed);
    expect(forced[forced.length - 1]).toBe(true);
    expect(window.__r3d!.backend).toBe('WebGL2 fallback (WebGPU failed)');
    expect(el.querySelectorAll('.r3d-error').length).toBe(0);
    failed = true;
    for (let i = 0; i < 3; i++) await loseAndWait(deps, lost, () => el.querySelectorAll('.r3d-error').length > 0);
    expect(el.querySelectorAll('.r3d-error').length).toBe(1);
    expect(window.__r3d!.backend).toBe('Graphics device failed');
    host!.stop();
  });

  it('three\'s own WebGL2 fallback counts as WebGL2: three losses end it with no switch (#313)', async () => {
    const { deps, stage, lost } = setup(); // the mock view says 'WebGL2 fallback' whatever forceWebGL is
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, '', 'demo', () => stage, deps);
    for (let i = 0; i < 3; i++) await loseAndWait(deps, lost, () => el.querySelectorAll('.r3d-error').length > 0);
    expect(deps.createView).toHaveBeenCalledTimes(3); // the third loss gave up before rebuilding
    expect(el.querySelectorAll('.r3d-error').length).toBe(1);
    host!.stop();
  });

  it('setRunYaw updates the panel, not the address bar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const spy = vi.spyOn(history, 'replaceState');
    try {
      const { deps, stage } = setup();
      const el = document.createElement('div');
      document.body.appendChild(el);
      const host = await startHost(el, '', 'run', () => stage, deps);
      host!.setRunYaw(45);
      expect(host!.params.yaw).toBe(45);
      vi.advanceTimersByTime(1000);
      expect(spy).not.toHaveBeenCalled();
      // a later change from the panel writes the URL, but a run never keeps the yaw in it
      host!.setParams({ ...host!.params, pitch: 40 });
      vi.advanceTimersByTime(1000);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][2])).not.toContain('yaw');
      host!.stop();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('startHost modes and the stored quality', () => {
  const memStore = (initial?: string) => {
    const data = new Map<string, string>(initial ? [[QUALITY_KEY, initial]] : []);
    return { data, getItem: vi.fn((k: string) => data.get(k) ?? null), setItem: vi.fn((k: string, v: string) => void data.set(k, v)) };
  };
  const start = async (mode: 'demo' | 'run' | 'play', search: string, store: Parameters<typeof startHost>[4] extends infer D ? (D extends { store?: infer S } ? S : never) : never) => {
    const { deps, stage } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const host = await startHost(el, search, mode, () => stage, { ...deps, store });
    return { host: host!, el };
  };
  const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

  it('play: defaults plus the backend and the stored quality; no panel, no address bar, the change is stored', async () => {
    fake();
    const spy = vi.spyOn(history, 'replaceState');
    try {
      const store = memStore('fast');
      const { host, el } = await start('play', '?r3d&pitch=30&free=1&quality=high&see=off&backend=webgl', store);
      expect(host.params).toEqual({ ...DEFAULTS, backend: 'webgl', quality: 'fast' });
      expect(el.querySelector('.r3d-panel')).toBeNull();
      expect(host.dev).toBe(false);
      host.setParams({ ...host.params, quality: 'high' });
      vi.advanceTimersByTime(1000);
      expect(spy).not.toHaveBeenCalled();
      expect(store.data.get(QUALITY_KEY)).toBe('high');
      host.stop();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('play: a store that throws starts at balanced and a change does not throw', async () => {
    const store = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const { host } = await start('play', '', store);
    expect(host.params.quality).toBe('balanced');
    expect(() => host.setParams({ ...host.params, quality: 'fast' })).not.toThrow();
    host.stop();
  });

  it('run: the stored quality, the URL wins for the start only, a change is stored', async () => {
    const a = memStore('fast');
    const ra = await start('run', '?r3d', a);
    expect(ra.host.params.quality).toBe('fast');
    expect(ra.host.dev).toBe(true);
    ra.host.setParams({ ...ra.host.params, quality: 'balanced' });
    expect(a.data.get(QUALITY_KEY)).toBe('balanced');
    ra.host.stop();
    const b = memStore('fast');
    const rb = await start('run', '?r3d&quality=high', b);
    expect(rb.host.params.quality).toBe('high');
    expect(b.data.get(QUALITY_KEY)).toBe('fast');
    rb.host.stop();
  });

  it('demo: the store is neither read nor written', async () => {
    const store = memStore('fast');
    const { host } = await start('demo', '', store);
    expect(host.params.quality).toBe('balanced');
    expect(host.dev).toBe(true);
    host.setParams({ ...host.params, quality: 'high' });
    expect(store.getItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    host.stop();
  });
});

describe('startHost: the mouse wheel zoom', () => {
  let loop: FrameRequestCallback | null = null;
  let t = 0;
  beforeEach(() => {
    loop = null;
    t = 1000;
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => ((loop = cb), 1)));
    vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(1080);
  });
  afterEach(() => vi.restoreAllMocks());
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) loop!((t += 16));
  };
  const begin = async (mode: 'demo' | 'run' | 'play', search = '') => {
    const { deps, stage } = setup();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hud = document.createElement('div');
    el.appendChild(hud);
    const host = (await startHost(el, search, mode, () => stage, deps))!;
    frames(2);
    return { host, stage, el, hud, canvas: el.querySelector('canvas.r3d')! as HTMLCanvasElement };
  };
  const wheel = (target: Element, init: WheelEventInit = {}) => {
    const e = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  it('play: a wheel on the canvas zooms in and is prevented', async () => {
    const { host, canvas } = await begin('play');
    const start = window.__r3d!.zoom;
    expect(start).toBe(7);
    expect(wheel(canvas).defaultPrevented).toBe(true);
    frames(30);
    expect(window.__r3d!.zoom).toBeGreaterThan(start);
    host.stop();
  });

  it('run: a zoom from the URL wins over the wheel (a play run ignores the URL)', async () => {
    const { host, canvas } = await begin('run', '?zoom=4');
    expect(window.__r3d!.zoom).toBe(4);
    wheel(canvas);
    frames(30);
    expect(window.__r3d!.zoom).toBe(4);
    host.stop();
  });

  it('run: the wheel works too', async () => {
    const { host, canvas } = await begin('run');
    const start = window.__r3d!.zoom;
    wheel(canvas);
    frames(30);
    expect(window.__r3d!.zoom).toBeGreaterThan(start);
    host.stop();
  });

  it('a wheel on the HUD changes nothing and is not prevented', async () => {
    const { host, hud } = await begin('play');
    const start = window.__r3d!.zoom;
    expect(wheel(hud).defaultPrevented).toBe(false);
    frames(30);
    expect(window.__r3d!.zoom).toBe(start);
    host.stop();
  });

  it('ctrl+wheel changes nothing and is not prevented', async () => {
    const { host, canvas } = await begin('play');
    const start = window.__r3d!.zoom;
    expect(wheel(canvas, { ctrlKey: true }).defaultPrevented).toBe(false);
    frames(30);
    expect(window.__r3d!.zoom).toBe(start);
    host.stop();
  });

  it('demo: the wheel does nothing', async () => {
    const { host, canvas } = await begin('demo');
    const start = window.__r3d!.zoom;
    expect(wheel(canvas).defaultPrevented).toBe(false);
    frames(30);
    expect(window.__r3d!.zoom).toBe(start);
    host.stop();
  });

  it('stop removes the listener', async () => {
    const { host, el, canvas } = await begin('play');
    host.stop();
    el.appendChild(canvas);
    expect(wheel(canvas).defaultPrevented).toBe(false);
  });

  it('the stage gets labelZoom: the zoom at the start, start x 1.3 at the near limit', async () => {
    const { host, stage, canvas } = await begin('play');
    const last = () => (stage.frame.mock.calls as unknown as { zoom: number; labelZoom: number }[][]).at(-1)![0];
    expect(last().labelZoom).toBe(last().zoom);
    wheel(canvas, { deltaY: -100000 });
    frames(200);
    expect(last().zoom).toBeGreaterThan(7);
    expect(last().labelZoom).toBeCloseTo(7 * 1.3, 6);
    host.stop();
  });
});
