import { describe, expect, it } from 'vitest';
import { TileMap } from '../../sim/map';
import { Effects3d } from './effects3d';
import { run as runBurst } from './booms';
import { FxPass } from './pass';
import { FxTris } from './tris';
import type { BurstSpec } from './shapes';
import type { FxCtx } from './types';

const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const ctxAt = (detail: number): FxCtx => ({ cam, ax: { right: [1, 0, 0], up: [0, 1, 0] }, now: 1, detail, ballDetail: 2, smokeTone: null });
const spec = (): BurstSpec => ({ x: 0, y: 0, z: 0, n: 0, speed: [1, 1], up: [0, 0], life: [5, 5], g: 0, drag: 0, size: 0.1, colours: [0xffffff], streak: false });

describe('quality scales the effects', () => {
  it('a burst of n 40 at detail 0.5 draws 20 motes', () => {
    const full = new FxTris(1000), half = new FxTris(1000);
    runBurst(full, ctxAt(1), spec(), 40, 0, 0, 0, 0.1, 3);
    runBurst(half, ctxAt(0.5), spec(), 40, 0, 0, 0, 0.1, 3);
    expect(full.n).toBe(80); // two triangles a mote
    expect(half.n).toBe(40);
  });

  it('the pass maps the quality to the detail and the ball detail', () => {
    const pass = new FxPass(new Set());
    const fx = new Effects3d(new TileMap(4, 4, new Uint8Array(16)));
    const seen: Array<[number, number]> = [];
    const c = (pass as unknown as { ctx: FxCtx }).ctx;
    for (const q of ['high', 'balanced', 'fast'] as const) {
      pass.run(fx, { cam, now: 1, quality: q, figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(), you: 0, ownCast: null }, { position: [], uv: [], color: [], foot: [], n: 0 });
      seen.push([c.detail, c.ballDetail]);
    }
    expect(seen).toEqual([[1, 2], [0.7, 2], [0.5, 1]]);
  });

  it('counts the triangles and keeps the dropped total over frames', () => {
    const pass = new FxPass(new Set());
    expect(pass.triCount).toBe(0);
    expect(pass.droppedTotal).toBe(0);
    pass.out.tris.tri(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1);
    pass.noteFrame();
    expect(pass.triCount).toBe(1);
    (pass.out.tris as unknown as { dropped: number }).dropped = 3;
    pass.noteFrame();
    pass.noteFrame();
    expect(pass.droppedTotal).toBe(6);
  });
});
