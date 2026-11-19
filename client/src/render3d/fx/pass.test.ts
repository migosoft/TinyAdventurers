import { describe, expect, it } from 'vitest';
import { TileMap } from '../../sim/map';
import { newGlowBuf } from '../cards';
import { Effects3d, clearFxRegistry } from './effects3d';
import { FxPass, type FxPassIn } from './pass';

const input = (): FxPassIn => ({
  cam: { x: 5, z: 5, pitch: 0.9, yaw: 0.3 }, now: 1, quality: 'high', figs: [], ents: new Map(), shots: [], hiddenShots: new Set(),
  snap: undefined, hidden: new Set(), you: 0, ownCast: null,
});

describe('the effects pass and the smoke buffer (#359)', () => {
  it('run clears the smoke buffer each frame, and noteFrame adds its dropped count to droppedTotal', () => {
    clearFxRegistry();
    const pass = new FxPass(new Set());
    const fx = new Effects3d(new TileMap(4, 4, new Uint8Array(16)));
    const s = pass.smoke;
    s.position.push(1, 2, 3); s.rgba.push(1, 1, 1, 1); s.c.push(0, 0, 0, 0); s.n = 1;
    pass.run(fx, input(), newGlowBuf());
    expect(pass.smoke).toBe(s);
    expect([s.position.length, s.rgba.length, s.c.length, s.n, s.dropped]).toEqual([0, 0, 0, 0, 0]);
    pass.out.smoke.dropped = 7;
    pass.noteFrame();
    expect(pass.droppedTotal).toBe(7);
    pass.noteFrame();
    expect(pass.droppedTotal).toBe(14);
  });
});
