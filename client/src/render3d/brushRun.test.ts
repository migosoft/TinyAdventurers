import { describe, expect, it } from 'vitest';
import { EFFECT, KIND } from '../generated/defs';
import type { AirMover } from '../game/airTypes';
import type { EntState } from '../game/world';
import { BrushTracker } from './brush';
import { brushFrame, type BrushFrame } from './brushRun';

const mover = (id: number): AirMover => ({ id, flags: 0, x: 160, y: 160, vx: 40, vy: 0, r: 6, shot: false, heat: 0 });
const ent = (id: number, kind: number, o: Partial<EntState> = {}): EntState => ({ id, kind, x: 160, y: 160, hp: 10, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: 0, entangled: 0, ...o });
const frame = (ents: EntState[]): BrushFrame => ({ dt: 0.016, you: 1, ents: new Map(ents.map((e) => [e.id, e])), own: { alive: true } });
const look = { x: 10, z: 10 };

describe('brushFrame (#331)', () => {
  it('brushes a walking, seen figure, and the own hero', () => {
    const t = new BrushTracker();
    expect(brushFrame(t, frame([ent(2, KIND.SkeletonWarrior)]), [mover(1), mover(2)], new Set(), look)).toHaveLength(2);
  });

  it('an Invisible monster never brushes, an Invisible party hero does', () => {
    const inv = 1 << EFFECT.Invisible;
    const t = new BrushTracker();
    const b = brushFrame(t, frame([ent(2, KIND.SkeletonWarrior, { effects: inv }), ent(3, KIND.Wizard, { effects: inv })]), [mover(2), mover(3)], new Set(), look);
    expect(b).toHaveLength(1);
  });

  it('a figure hidden mid-walk loses its brusher in the same frame, with no ease-out', () => {
    const t = new BrushTracker();
    const f = frame([ent(2, KIND.SkeletonWarrior)]);
    expect(brushFrame(t, f, [mover(2)], new Set(), look)).toHaveLength(1);
    expect(brushFrame(t, f, [], new Set([2]), look)).toHaveLength(0);
    expect(brushFrame(t, f, [], new Set(), look)).toHaveLength(0); // not back as an ease-out either
  });

  it('a dead or gone figure is dropped at once', () => {
    const t = new BrushTracker();
    expect(brushFrame(t, frame([ent(2, KIND.SkeletonWarrior)]), [mover(2)], new Set(), look)).toHaveLength(1);
    expect(brushFrame(t, frame([]), [], new Set(), look)).toHaveLength(0);
  });
});
