// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHost, type Stage } from './host';
import type { View, WorldInput } from './view';
import { parseMap, MAP_ROWS } from './demoMap';

function fakeView(): View {
  return {
    backend: 'WebGL2 fallback', setSize: vi.fn(), draw: vi.fn(() => 0), canForceLoss: true, forceLoss: vi.fn(() => true),
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
});
