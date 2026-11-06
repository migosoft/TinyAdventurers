// What E would do from the hero's spot, for the key cap: wake a sleeping teammate, recruit a neutral
// creature, or use a barrel or torch. The server's `act` takes them in this order.
import { CONST, EFFECT, FLAG, KIND, SIDE } from '../generated/defs';
import { FIGURES, isPlayerKind } from './anim/defs';
import { has } from './status';
import type { EntState } from './world';

export interface UseHint {
  ent: EntState;
  /** The words next to the key: null for the bare cap (barrels and torches). */
  label: 'Wake' | 'Recruit' | null;
}

/** The nearest thing in the first group that has one within `CONST.USE_REACH`, or null. */
export function pickUseHint(ents: Iterable<EntState>, me: number, px: number, py: number): UseHint | null {
  const list = [...ents];
  const nearest = (label: UseHint['label'], pick: (e: EntState) => number | null): UseHint | null => {
    let best: UseHint | null = null;
    let bestGap = Infinity;
    for (const e of list) {
      const r = pick(e);
      if (r === null) continue;
      const gap = Math.hypot(e.x - px, e.y - py) - CONST.PLAYER_RADIUS - r;
      if (gap <= CONST.USE_REACH && gap < bestGap) (bestGap = gap), (best = { ent: e, label });
    }
    return best;
  };
  return (
    // A sleeping teammate in reach is woken first (like the server).
    nearest('Wake', (e) => (e.id !== me && isPlayerKind(e.kind) && !(e.flags & FLAG.DEAD) && has(e.effects, EFFECT.Sleep) ? CONST.PLAYER_RADIUS : null)) ??
    // Then a neutral creature is recruited (objects are sent with side 0 too, but have no figure).
    nearest('Recruit', (e) => (FIGURES[e.kind] && !isPlayerKind(e.kind) && e.side === SIDE.Neutral && !(e.flags & (FLAG.DEAD | FLAG.WILD)) ? (FIGURES[e.kind]?.baseR ?? 6) : null)) ??
    nearest(null, (e) => (e.kind === KIND.Barrel && e.anim < 2 ? CONST.BARREL_RADIUS : e.kind === KIND.Torch ? CONST.TORCH_RADIUS : null))
  );
}
