// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KIND } from '../generated/defs';
import { TILE } from '../sim/map';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { PageButton } from './panel';
import type { Stage, StageCtx } from './host';
import { createKit, directRunner } from './models/kit';
import { createLichStage, immuneRing, lichMap, parseLich } from './lichStage';
import type { FrameInput } from './view';

// The stage's kit builds on the calling thread (no worker): the lich's picture is ready a few ticks after the first frame.
vi.mock('./stageKit', async (orig) => ({
  ...(await orig<typeof import('./stageKit')>()),
  createStageKit: () => createKit(() => ({ w: 16, h: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) }), directRunner),
}));

// jsdom has no canvas: the atlas bounds fall back to whole frames, without a "not implemented" message
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const n of ['lich', 'knight_m', 'necromancer', 'imp', 'chort', 'wizzard_m']) for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`${n}_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
for (let i = 0; i < 4; i++) { frames[`necromancer_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 }; frames[`torch_f${i}`] = { x: 0, y: 0, w: 16, h: 16 }; }
const assets = { image: {} as HTMLImageElement, frames };

const made: Stage[] = [];
afterEach(() => { for (const s of made.splice(0)) s.dispose(); delete (window as { __r3d?: unknown }).__r3d; });

function make(search: string): { stage: Stage; buttons: PageButton[]; step: (n: number, dt?: number) => FrameInput[]; wait: (until: () => boolean) => Promise<void> } {
  (window as unknown as { __r3d: object }).__r3d = {};
  const params = parseParams(search);
  const buttons: PageButton[] = [];
  const host = { params, setParams: (): void => {}, setPageButtons: (l: PageButton[]) => { buttons.splice(0, buttons.length, ...l); }, syncPageButtons(): void {} };
  const stage = createLichStage(assets, params, search, host as never);
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

describe('the ?r3d=lich stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=lich')).toBe('lich');
    expect(isR3dDemo('?r3d=lich')).toBe(true);
  });

  it('reads the query', () => {
    expect(parseLich('?r3d=lich')).toMatchObject({ act: 'stand', at: null, pinned: null, glide: false, fx: null, lich: true });
    expect(parseLich('?act=nova&at=1.3&t=2&glide=1&fx=stone&px=5&pz=6&lich=0&face=90')).toMatchObject({ act: 'nova', at: 1.3, pinned: 2, glide: true, fx: 'stone', px: 5, pz: 6, lich: false });
    expect(parseLich('?act=glide').glide).toBe(true);
    expect(parseLich('?act=bogus&fx=bogus').act).toBe('stand');
  });

  it('is a hall with water in it', () => {
    const m = lichMap();
    expect(m.w).toBe(30);
    expect(m.h).toBe(24);
    expect(new Set(m.tiles).size).toBe(3); // wall, floor, shallow water
  });

  it('draws one built lich, and no lich card, once its picture is painted', async () => {
    const r = make('?r3d=lich');
    const first = r.step(1)[0]; // the picture is not painted yet: the lich is its card
    expect(built(first)).toBe(0);
    let last: FrameInput | undefined;
    await r.wait(() => { last = r.step(1)[0]; return built(last) === 1; });
    expect(built(last!)).toBe(1);
    expect(last!.models!.built![0].key).toBe('lich');
    expect(last!.models!.built![0].owner).toBe(1);
    expect((window as unknown as { __r3d: { built: number } }).__r3d.built).toBe(1);
    expect(last!.dynamic.cards.count).toBeLessThan(first.dynamic.cards.count);
  });

  it('&lich=0 leaves the lich out', async () => {
    const r = make('?r3d=lich&lich=0');
    r.step(3);
    await new Promise((x) => setTimeout(x, 20));
    expect(built(r.step(3).at(-1)!)).toBe(0);
  });

  it('&fx=stone gives a stone lich', async () => {
    const r = make('?r3d=lich&fx=stone');
    let last: FrameInput | undefined;
    await r.wait(() => { last = r.step(1)[0]; return built(last) === 1; });
    expect(last!.models!.built![0].stone).toBe(true);
    const plain = make('?r3d=lich');
    await plain.wait(() => built(plain.step(1)[0]) === 1);
    expect(built(plain.step(1)[0])).toBe(1);
    expect(plain.step(1)[0].models!.built![0].stone).toBe(false);
  });

  it('&fx=immune gives six Disciples round the lich and a drain of seven points ending at the lich', async () => {
    const ring = immuneRing(10, 12);
    expect(ring.ents).toHaveLength(6);
    expect(ring.ents.every((e) => e.kind === KIND.Disciple)).toBe(true);
    expect(ring.drain).toHaveLength(7);
    expect(ring.drain[0]).toEqual([10 * TILE, 12 * TILE]);
    for (const [x, z] of ring.drain.slice(1)) expect(Math.hypot(x / TILE - 10, z / TILE - 12)).toBeCloseTo(3.2, 6);
    const r = make('?r3d=lich&fx=immune');
    let last: FrameInput | undefined;
    await r.wait(() => { last = r.step(1)[0]; return (last.models?.insts.filter((i) => i.model === 'disciple').length ?? 0) === 6; });
    expect(last!.models!.insts.filter((i) => i.model === 'disciple')).toHaveLength(6);
    expect(built(last!)).toBe(1);
  });

  /** The built lich's body vertices of a page, once its picture is painted and the page has replayed. */
  const body = async (search: string): Promise<{ pos: number[]; yaw: number }> => {
    const r = make(search);
    let last: FrameInput | undefined;
    await r.wait(() => { last = r.step(1)[0]; return built(last) === 1 && last.models!.built![0].body.verts > 0; });
    const b = last!.models!.built![0];
    return { pos: [...b.body.position.slice(0, b.body.verts * 3)], yaw: b.yaw };
  };

  it('a pinned page is the same picture every time, and not the rest pose', async () => {
    const a = await body('?r3d=lich&t=2&act=nova&at=1.3'), b = await body('?r3d=lich&t=2&act=nova&at=1.3');
    expect(a.pos.length).toBeGreaterThan(300);
    expect(b.pos).toEqual(a.pos);
    expect(b.yaw).toBe(a.yaw);
    const stand = await body('?r3d=lich&act=stand&t=2');
    expect(stand.pos).not.toEqual(a.pos);
  });

  it('&at without &t pins the page at 3 s: the replay passes the release', async () => {
    const alone = await body('?r3d=lich&act=nova&at=1.3'), pinned = await body('?r3d=lich&t=3&act=nova&at=1.3');
    expect(alone.pos).toEqual(pinned.pos);
    expect(alone.pos).not.toEqual((await body('?r3d=lich&act=stand&t=3')).pos);
  });

  it('a frozen or stone lich does not glide, as in a run; thawed it glides again', async () => {
    for (const toggle of ['Frozen', 'Stone']) {
      const r = make('?r3d=lich&glide=1');
      let last: FrameInput | undefined;
      await r.wait(() => { last = r.step(1)[0]; return built(last) === 1; });
      r.buttons.find((b) => b.name === toggle)!.press();
      const x0 = r.step(1)[0].models!.built![0].x;
      for (let i = 0; i < 30; i++) expect(r.step(1)[0].models!.built![0].x).toBe(x0);
      r.buttons.find((b) => b.name === toggle)!.press();
      r.step(30);
      expect(r.step(1)[0].models!.built![0].x).not.toBe(x0);
    }
  });

  it('has a button per act and the toggles', () => {
    const r = make('?r3d=lich');
    expect(r.buttons.map((b) => b.name)).toEqual(['Stand', 'Nova', 'Raise Dead', 'Bolts', 'Curse', 'Mist', 'Stone Gaze', 'Hurt', 'Broken wind-up', 'Glide', 'Frozen', 'Chilled', 'Stone', 'Immune', 'Work light']);
    r.buttons.find((b) => b.name === 'Stone')!.press();
    expect(r.buttons.find((b) => b.name === 'Stone')!.pressed!()).toBe(true);
  });
});
