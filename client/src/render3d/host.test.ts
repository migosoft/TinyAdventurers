// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearErrors, showError, startHost, type Host, type Stage } from './host';
import type { View, WorldInput } from './view';
import { parseMap, MAP_ROWS } from './demoMap';

function fakeView(): View {
  return {
    backend: 'WebGL2 fallback', setSize: vi.fn(), draw: vi.fn(() => 0), canForceLoss: true, forceLoss: vi.fn(() => true), readback: vi.fn(async () => null),
    dispose: vi.fn(), tileChanged: vi.fn(), setGround: vi.fn(), chunks: { total: 0, drawn: 0 }, meshes: 0,
  };
}

const world: WorldInput = { map: parseMap(MAP_ROWS), painted: false, clear: 'stone' };

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
