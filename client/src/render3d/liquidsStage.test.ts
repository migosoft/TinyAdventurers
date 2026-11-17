// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { r3dPage, isR3dDemo, wants3d } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { PageButton } from './panel';
import type { Stage, StageCtx } from './host';
import { createLiquidsStage } from './liquidsStage';
import type { FrameInput } from './view';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const n of ['elf_f', 'knight_m', 'imp', 'chort']) for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`${n}_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const assets = { image: {} as HTMLImageElement, frames };

const made: Stage[] = [];
afterEach(() => { for (const s of made.splice(0)) s.dispose(); delete (window as { __r3d?: unknown }).__r3d; });

function make(search: string): { stage: Stage; buttons: PageButton[]; step: (n: number, dt?: number) => FrameInput[] } {
  const params = parseParams(search);
  const buttons: PageButton[] = [];
  const host = { setPageButtons: (l: PageButton[]) => { buttons.splice(0, buttons.length, ...l); }, syncPageButtons(): void {} };
  const stage = createLiquidsStage(assets, params, search, host as never);
  made.push(stage);
  let now = 0;
  const out: FrameInput[] = [];
  const view = { draw: (i: FrameInput) => (out.push(i), 0), tileChanged(): void {} };
  const step = (n: number, dt = 0.05): FrameInput[] => {
    const mine: FrameInput[] = [];
    for (let k = 0; k < n; k++) {
      now += dt;
      const before = out.length;
      stage.frame({ now, dt, params: params as R3dParams, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom: 2, plan: { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 }, canvasEl: null, view, timer: { lap() {}, renderStart() {} } } as unknown as StageCtx);
      mine.push(...out.slice(before));
    }
    return mine;
  };
  return { stage, buttons, step };
}

const g = (): { t: number; fallers: number } | undefined => (window as unknown as { __r3d?: { liquids?: { t: number; fallers: number } } }).__r3d?.liquids;

describe('the ?r3d=liquids stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=liquids')).toBe('liquids');
    expect(isR3dDemo('?r3d=liquids')).toBe(true);
    expect(wants3d('?r3d=liquids', true)).toBe(false);
  });

  it('builds frames without a view error', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids');
    expect(r.stage.world.map.w).toBe(18);
    expect(r.step(10)).toHaveLength(10);
    expect(g()!.fallers).toBe(0);
  });

  it('pushes into the chasm on key 1', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids');
    r.step(4);
    expect(r.stage.key!({ code: 'Digit1', repeat: false } as KeyboardEvent)).toBe(true);
    let seen = 0;
    for (let k = 0; k < 20; k++) { r.step(1); seen = Math.max(seen, g()!.fallers); }
    expect(seen).toBe(1);
    expect(r.buttons.map((b) => b.name)).toEqual(['Push chasm', 'Push water', 'Push barrel']);
  });

  it('pins the clock with &t and asks &push at 1 s', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids&push=chasm&t=1.5');
    r.step(3);
    expect(g()!.t).toBeCloseTo(1.5);
    expect(g()!.fallers).toBe(1); // the imp sank at 1.35 and falls until 2.05
  });
});

describe('the lava of the ?r3d=liquids stage (#344)', () => {
  const bubbles = (): number | undefined => (window as unknown as { __r3d?: { liquids?: { bubbles?: number } } }).__r3d?.liquids?.bubbles;
  /** The strengths of the rings the view was handed. */
  const rings = (f: FrameInput): number[] => Array.from({ length: 8 }, (_, s) => f.lavaPool!.stirs![s * 4 + 2]);

  it('opens a ring of strength 1 round the knight standing in the lava, and bubbles the pool', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids');
    let ringed = false, most = 0;
    for (let k = 0; k < 160; k++) {
      const f = r.step(1)[0]; // 8 s of 0.05 s steps: the knight stands in the lava from about 2 s to 7 s
      if (rings(f).includes(1)) ringed = true;
      most = Math.max(most, bubbles()!);
    }
    expect(ringed).toBe(true);
    expect(most).toBeGreaterThan(0);
  });

  it('passes the pinned clock as the lava\'s now, with the shimmer on Balanced', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const f = make('?r3d=liquids&t=6.5').step(2);
    for (const x of f) { expect(x.lavaPool?.now).toBeCloseTo(6.5); expect(x.lavaPool?.heat).toBe(true); }
  });

  it('a pinned page shows the same bubbles on every boot and the knight already ringed', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const a = make('?r3d=liquids&t=6.5').step(1)[0];
    const first = Array.from(a.lavaPool!.bubbles!);
    expect(rings(a)).toContain(1);
    const b = make('?r3d=liquids&t=6.5').step(1)[0];
    expect(Array.from(b.lavaPool!.bubbles!)).toEqual(first);
  });
});

describe('the water of the ?r3d=liquids stage (#345)', () => {
  const live = (f: FrameInput): number => {
    const r = f.water?.ripples;
    let n = 0;
    if (r) for (let i = 0; i < r.length; i += 4) if (r[i + 2] >= 0) n++;
    return n;
  };
  const ripples = (): number | undefined => (window as unknown as { __r3d?: { liquids?: { ripples?: number } } }).__r3d?.liquids?.ripples;

  it('rings round the wading elf within a second', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids');
    const fs = r.step(20);
    expect(ripples()).toBeGreaterThan(0);
    expect(live(fs[fs.length - 1])).toBe(ripples());
    expect(fs[fs.length - 1].water?.reflect).toBe(true);
  });

  /** The most ripples live within `reach` tiles of (x, z) in any frame of `n` steps, read frame by frame (the packed array is reused). */
  const nearMax = (r: ReturnType<typeof make>, x: number, z: number, reach: number, n: number): number => {
    let most = 0;
    for (let k = 0; k < n; k++) {
      const rip = r.step(1)[0].water!.ripples!;
      let c = 0;
      for (let i = 0; i < rip.length; i += 4) if (rip[i + 2] >= 0 && Math.hypot(rip[i] - x, rip[i + 1] - z) < reach) c++;
      most = Math.max(most, c);
    }
    return most;
  };

  it('stirs ripples at the imp\'s spot when it is pushed into the deep water (key 2), and none there without the push', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    // The imp goes under at (4.5, 5.5) at 1.35 s; the elf wades along x = 3.5 and x = 6.5, a tile or more away.
    const pushed = make('?r3d=liquids');
    pushed.step(20);
    pushed.stage.key!({ code: 'Digit2', repeat: false } as KeyboardEvent);
    const withPush = nearMax(pushed, 4.5, 5.5, 0.5, 40);
    const quiet = make('?r3d=liquids');
    quiet.step(20);
    const withoutPush = nearMax(quiet, 4.5, 5.5, 0.5, 40);
    expect(withoutPush).toBe(0);
    expect(withPush).toBeGreaterThan(0);
  });

  it('a page pinned after the imp went under replays its droplets and bubbles; without the push there are none', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const lit = (q: string): number => {
      const f = make(q).step(1)[0];
      return f.fx!.lit.n;
    };
    expect(lit('?r3d=liquids&t=1.9')).toBe(0);
    expect(lit('?r3d=liquids&push=water&t=1.9')).toBeGreaterThan(0);
  });

  it('passes the pinned clock as the water\'s now and shows the rings of the replayed seconds', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids&push=water&t=1.9');
    const fs = r.step(3);
    for (const f of fs) expect(f.water?.now).toBeCloseTo(1.9);
    expect(live(fs[0])).toBeGreaterThan(0);
    expect(ripples()).toBeGreaterThan(0);
  });
});
