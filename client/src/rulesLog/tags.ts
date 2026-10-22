import { TAG_NAME } from '../generated/defs';
import { isAllyKind, isPlayerKind } from '../game/anim/defs';

/**
 * The tag text over a figure while the log is on. A tagged entity reads "{kind} {n}" (the kind the
 * server sent, so a hidden mimic reads "Chest n"); the own hero its name; an ally "{owner}'s wolf"
 * (its `extra` is the owner's entity id). Teammates already show their name, so they get null.
 */
export function tagText(
  e: { id: number; kind: number; extra: number },
  tags: Map<number, [number, number]>,
  names: Map<number, string>,
  you?: number,
): string | null {
  const t = tags.get(e.id);
  if (t) return `${TAG_NAME[t[0]] ?? '?'} ${t[1]}`;
  if (isPlayerKind(e.kind)) return e.id === you ? (names.get(e.id) ?? null) : null;
  if (isAllyKind(e.kind)) {
    const owner = names.get(e.extra);
    return owner ? `${owner}'s wolf` : null;
  }
  return null;
}
