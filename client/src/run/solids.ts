import { CONST } from '../generated/defs';
import type { Snapshot } from '../generated/Snapshot';
import type { Solid } from '../sim/collision';

/** Half size of every solid object kind (server `defs/objects.rs`), by kind id. */
const SOLID_HALF: Record<number, number> = CONST.SOLID_OBJECTS;

/**
 * What the hero's predicted walk collides with: the sent solid objects (a barrel is solid until it sinks:
 * `anim < 2`) and the blocking objects near the hero that the server did not send as entities (behind a wall,
 * or the hero is Blind), which are collision only and never drawn (`Snapshot.solids`, #274).
 */
export function predictedSolids(s: Pick<Snapshot, 'ents' | 'solids'>): Solid[] {
  const sent = s.ents.filter((e) => e[1] in SOLID_HALF && e[5] < 2).map((e) => ({ x: e[2], y: e[3], half: SOLID_HALF[e[1]] }));
  return sent.concat(s.solids.map(([x, y, half]) => ({ x, y, half })));
}
