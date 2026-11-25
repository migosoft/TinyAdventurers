// The brushers of a run frame (#331): which movers the player sees walking, and which ids still exist.
import { EFFECT, FLAG } from '../generated/defs';
import { has } from '../game/effectBits';
import { isPlayerKind } from '../game/anim/defs';
import type { AirMover } from '../game/airTypes';
import type { EntState } from '../game/world';
import { BrushTracker, walkersOf, type Brusher, type Walker } from './brush';

/** The parts of a run frame this reads. */
export interface BrushFrame { dt: number; you: number; ents: ReadonlyMap<number, EntState>; own: { alive: boolean } }

const walkers: Walker[] = [];

/** One step of `tracker` for this frame: a hidden figure, and an Invisible one that is not a party hero, never brushes (and loses its brusher at once). The own hero always counts. */
export function brushFrame(tracker: BrushTracker, f: BrushFrame, movers: readonly AirMover[], hidden: ReadonlySet<number>, look: { x: number; z: number }): readonly Brusher[] {
  const seen = (m: AirMover): boolean => {
    if (hidden.has(m.id)) return false;
    const e = f.ents.get(m.id);
    return m.id === f.you || !e || !has(e.effects, EFFECT.Invisible) || isPlayerKind(e.kind);
  };
  const present = (id: number): boolean => {
    if (hidden.has(id)) return false;
    if (id === f.you) return f.own.alive;
    const e = f.ents.get(id);
    return !!e && (e.flags & FLAG.DEAD) === 0;
  };
  return tracker.step(f.dt, walkersOf(movers, seen, walkers), present, look);
}
