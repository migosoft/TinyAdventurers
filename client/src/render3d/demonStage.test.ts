// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_KIND } from '../generated/defs';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { PageButton } from './panel';
import type { Stage, StageCtx } from './host';
import { createKit, directRunner } from './models/kit';
import { createDemonStage, demonMap, parseDemon } from './demonStage';
import { DEMON_ACTS } from './demonScript';
import { TERRAIN } from '../game/terrain-layers';
import type { FrameInput } from './view';

// The stage's kit builds on the calling thread (no worker): the demon's picture is ready a few ticks after the first frame.
vi.mock('./stageKit', async (orig) => ({
  ...(await orig<typeof import('./stageKit')>()),
  createStageKit: () => createKit(() => ({ w: 16, h: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) }), directRunner),
}));

// jsdom has no canvas: the atlas bounds fall back to whole frames, without a "not implemented" message
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const n of ['lich', 'big_demon', 'knight_m', 'necromancer', 'imp', 'chort', 'wizzard_m']) for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`${n}_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
for (let i = 0; i < 4; i++) { frames[`necromancer_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 }; }
const assets = { image: {} as HTMLImageElement, frames };

const made: Stage[] = [];
afterEach(() => { for (const s of made.splice(0)) s.dispose(); delete (window as { __r3d?: unknown }).__r3d; });

function make(search: string): { stage: Stage; buttons: PageButton[]; step: (n: number, dt?: number) => FrameInput[]; wait: (until: () => boolean) => Promise<void> } {
  (window as unknown as { __r3d: object }).__r3d = {};
  const params = parseParams(search);
  const buttons: PageButton[] = [];
  const host = { params, setParams: (): void => {}, setPageButtons: (l: PageButton[]) => { buttons.splice(0, buttons.length, ...l); }, syncPageButtons(): void {} };
  const stage = createDemonStage(assets, params, search, host as never);
  made.push(stage);
  let now = 0;
  const out: FrameInput[] = [];
  const view = { draw: (i: FrameInput) => (out.push(i), 0), tileChanged(): void {}, figuresDrawn: { figures: 0, draws: 0 } };
  const step = (n: number, dt = 1 / 30): FrameInput[] => {
    const mine: FrameInput[] = [];
    for (let k = 0; k < n; k++) {
      now += dt;
      const before = out.length;
      stage.frame({ now, dt, params: params as R3dParams, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom: 2, plan: { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 }, canvasEl: null, view, timer: { lap() {}, renderStart() {} } } as unknown as StageCtx);
      mine.push(...out.slice(before));
    }
    return mine;
  };
  // frames until the picture has been painted (a few ticks of the event loop)
  const wait = async (until: () => boolean): Promise<void> => { for (let i = 0; i < 400 && !until(); i++) { await new Promise((r) => setTimeout(r, 5)); step(1); } };
  return { stage, buttons, step, wait };
}

const built = (f: FrameInput): number => f.models?.built?.length ?? 0;

describe('the ?r3d=demon stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=demon')).toBe('demon');
    expect(isR3dDemo('?r3d=demon')).toBe(true);
  });

  it('reads the query', () => {
    expect(parseDemon('?r3d=demon')).toMatchObject({ act: 'stand', at: null, pinned: null, face: null, fx: null, slow: 1, demon: true });
    expect(parseDemon('?act=stand&at=1.3&t=2&fx=stone&px=5&pz=6&demon=0&face=90&slow=4')).toMatchObject({ act: 'stand', at: 1.3, pinned: 2, fx: 'stone', px: 5, pz: 6, demon: false, slow: 4 });
    expect(parseDemon('?face=90').face).toBeCloseTo(Math.PI / 2, 9);
    expect(parseDemon('?act=bogus&fx=immune&slow=0')).toMatchObject({ act: 'stand', fx: null, slow: 1 });
  });

  it('is the hall with a lava pool and a chasm, four torches and a light on every lava tile', () => {
    const m = demonMap();
    expect([m.w, m.h]).toEqual([30, 24]);
    const count = (t: number): number => m.tiles.filter((x) => x === t).length;
    expect(count(TERRAIN.Lava)).toBe(16);
    expect(count(TERRAIN.Chasm)).toBe(16);
    const lights = make('?r3d=demon').stage.world.taken!.lights;
    expect(lights.filter((l) => l.kind === LIGHT_KIND.Torch)).toHaveLength(4);
    expect(lights.filter((l) => l.kind === LIGHT_KIND.Lava)).toHaveLength(16);
  });

  it('draws one built demon of KIND.Demon with its hull once its picture is painted, the lava with it', async () => {
    const r = make('?r3d=demon');
    expect(built(r.step(1)[0])).toBe(0); // the picture is not painted yet: the demon is its card
    let last: FrameInput | undefined;
    await r.wait(() => { last = r.step(1)[0]; return built(last) === 1; });
    const b = last!.models!.built![0];
    expect(b).toMatchObject({ key: 'demon', owner: 1, stone: false });
    expect(b.hull!.verts).toBeGreaterThan(0);
    expect(last!.lava).not.toBeNull();
    expect(last!.lavaPool).toBeDefined();
    expect((window as unknown as { __r3d: { built: number; demonMs: number } }).__r3d.built).toBe(1);
    expect((window as unknown as { __r3d: { demonMs: number } }).__r3d.demonMs).toBeGreaterThanOrEqual(0);
  });

  it('faces the knight unless &face= fixes the aim', async () => {
    const yaw = async (search: string): Promise<number> => {
      const r = make(search);
      let last: FrameInput | undefined;
      await r.wait(() => { last = r.step(1)[0]; return built(last) === 1; });
      return last!.models!.built![0].yaw;
    };
    expect(await yaw('?r3d=demon')).toBeCloseTo(Math.atan2(2.4, 1.6), 6);
    expect(await yaw('?r3d=demon&face=180')).toBeCloseTo(Math.PI, 6);
  });

  it('&demon=0 leaves the demon out; &fx=stone gives a stone demon; the buttons toggle', async () => {
    const none = make('?r3d=demon&demon=0');
    none.step(3);
    await new Promise((x) => setTimeout(x, 20));
    expect(built(none.step(3).at(-1)!)).toBe(0);
    const r = make('?r3d=demon&fx=stone');
    let last: FrameInput | undefined;
    await r.wait(() => { last = r.step(1)[0]; return built(last) === 1; });
    expect(last!.models!.built![0].stone).toBe(true);
    expect(r.buttons.map((b) => b.name)).toEqual([...DEMON_ACTS, 'Frozen', 'Chilled', 'Stone', 'Work light']);
    r.buttons.find((b) => b.name === 'Stone')!.press();
    expect(r.step(1)[0].models!.built![0].stone).toBe(false);
  });

  it('a pinned page holds the glow\'s phase: the same levels every time and on every later frame', async () => {
    const levels = async (search: string): Promise<number[]> => {
      const r = make(search);
      let last: FrameInput | undefined;
      await r.wait(() => { last = r.step(1)[0]; return built(last) === 1; });
      const a = [...last!.models!.built![0].levels];
      expect([...r.step(5).at(-1)!.models!.built![0].levels]).toEqual(a);
      return a;
    };
    const a = await levels('?r3d=demon&t=3');
    expect(a[0]).toBeCloseTo(0.75, 6);
    expect(await levels('?r3d=demon&t=3')).toEqual(a);
    expect((await levels('?r3d=demon&t=1'))[0]).toBeCloseTo(0.25, 6);
  });
});
