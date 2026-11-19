// The script of the ?r3d=liquids page (#324), pure: the actors at time `t` and the events born in (t - dt, t]. Positions are in px (feet).
import { ANIM, CONST, FLAG, KIND, SIDE } from '../generated/defs';
import { floats } from './models/table';
import type { EntState } from '../game/world';
import type { PictureEv } from '../run/view';
import { TILE } from '../sim/map';

export type Push = 'chasm' | 'water' | 'barrel';
export const PUSHES: readonly Push[] = ['chasm', 'water', 'barrel'];
export interface LiquidsFrame { ents: EntState[]; events: PictureEv[] }

/** Seconds a pushed actor slides to its target cell, and until it is back after the Sink. */
export const SLIDE_TIME = 0.35;
export const BACK_TIME = 3.2;
const EPS = 1e-9;

const ELF_ID = 100, KNIGHT_ID = 101;
/** The speed of the walkers in tiles per second. */
const ELF_SPEED = 2, KNIGHT_SPEED = 1.5;
/** The elf wades up and down the U round the deep: its corners in tiles (all shallow cells). */
const ELF_PATH: [number, number][] = [[3.5, 5.5], [3.5, 8.5], [6.5, 8.5], [6.5, 5.5]];
/** The knight's loop: waits, walks into the lava (x 12.5 to 14.5 at y 4.5), stands 5 s, walks out. */
const K_Y = 4.5, K_X0 = 12.5, K_X1 = 14.5;
const K_WAIT = 0.6, K_STAND = 5;
const K_LEG = (K_X1 - K_X0) / KNIGHT_SPEED;
export const KNIGHT_LOOP = K_WAIT + K_LEG + K_STAND + K_LEG;

interface Pusher { push: Push; id: number; kind: number; from: [number, number]; to: [number, number]; how: number; dur: number; side: number }
const PUSHERS: readonly Pusher[] = [
  { push: 'chasm', id: 102, kind: KIND.Imp, from: [9.5, 7.5], to: [10.5, 7.5], how: 0, dur: CONST.FALL_TIME, side: SIDE.Hostile },
  { push: 'water', id: 103, kind: KIND.Imp, from: [4.5, 4.5], to: [4.5, 5.5], how: 1, dur: CONST.DROWN_TIME, side: SIDE.Hostile },
  { push: 'barrel', id: 104, kind: KIND.Barrel, from: [9.5, 5.5], to: [10.5, 5.5], how: 0, dur: CONST.FALL_TIME, side: SIDE.Neutral },
];

/** A kind that floats (the Ghost, the Shade) is incorporeal in a run, so on this page too. */
const ent = (id: number, kind: number, x: number, y: number, side: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x: x * TILE, y: y * TILE, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: floats(kind) ? FLAG.INCORPOREAL : 0, extra: 0, effects: 0, side, entangled: 0, ...o,
});

/** The elf on its U, going there and back. */
function elfAt(t: number, kind: number): EntState {
  const legs: number[] = [];
  for (let i = 1; i < ELF_PATH.length; i++) legs.push(Math.hypot(ELF_PATH[i][0] - ELF_PATH[i - 1][0], ELF_PATH[i][1] - ELF_PATH[i - 1][1]));
  const len = legs.reduce((a, b) => a + b, 0);
  let d = (t * ELF_SPEED) % (2 * len);
  const back = d > len;
  if (back) d = 2 * len - d;
  let i = 0;
  while (i < legs.length - 1 && d > legs[i]) d -= legs[i++];
  const [a, b] = [ELF_PATH[i], ELF_PATH[i + 1]];
  const k = legs[i] ? d / legs[i] : 0;
  const dx = (b[0] - a[0]) * (back ? -1 : 1);
  return ent(ELF_ID, kind, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, SIDE.Friendly, { anim: ANIM.Move, animMs: t * 1000, aim: dx < 0 ? Math.PI : 0 });
}

/** The knight: floor, into the lava, standing, out again. */
function knightAt(t: number, kind: number): EntState {
  const s = ((t % KNIGHT_LOOP) + KNIGHT_LOOP) % KNIGHT_LOOP;
  if (s < K_WAIT) return ent(KNIGHT_ID, kind, K_X0, K_Y, SIDE.Friendly);
  if (s < K_WAIT + K_LEG) return ent(KNIGHT_ID, kind, K_X0 + (s - K_WAIT) * KNIGHT_SPEED, K_Y, SIDE.Friendly, { anim: ANIM.Move, animMs: t * 1000 });
  if (s < K_WAIT + K_LEG + K_STAND) return ent(KNIGHT_ID, kind, K_X1, K_Y, SIDE.Friendly);
  return ent(KNIGHT_ID, kind, K_X1 - (s - K_WAIT - K_LEG - K_STAND) * KNIGHT_SPEED, K_Y, SIDE.Friendly, { anim: ANIM.Move, animMs: t * 1000, aim: Math.PI });
}

/** Where a pushed thing stops: 0.1 tile inside its target cell (the Sink comes as it crosses the rim, as on the server; the fall's rim pull does the rest). */
const INSIDE = 0.1;
function reach(q: Pusher): [number, number] {
  const dx = Math.sign(q.to[0] - q.from[0]), dy = Math.sign(q.to[1] - q.from[1]);
  return [q.to[0] - dx * (0.5 - INSIDE), q.to[1] - dy * (0.5 - INSIDE)];
}

/** Events of a push at `p`: the Sink when the slide ends, the Died after the fall's or the drowning's time. */
function eventsOf(q: Pusher, kind: number, p: number): { at: number; ev: PictureEv }[] {
  const at = p + SLIDE_TIME;
  const [x, y] = [reach(q)[0] * TILE, reach(q)[1] * TILE];
  return [
    { at, ev: { t: 'Sink', id: q.id, x, y, how: q.how } },
    { at: at + q.dur, ev: { t: 'Died', id: q.id, kind, x, y } },
  ];
}

/**
 * The page's actors at time `t` (s) and the events born in the window (t - dt, t] (each event once when the windows follow each other):
 * an elf wading up and down the shallow rim, a knight walking into the lava, standing 5 s and walking out, an imp beside the water
 * and one beside the chasm, a barrel beside the chasm. `pushes`: when each push was asked (s) or null. A pushed imp slides 0.35 s to
 * its target cell, gets `Sink` (how 0 or 1), stays FALL_TIME or DROWN_TIME, gets `Died` and leaves; it is back after 3.2 s (counted
 * from the Sink). A pushed barrel rolls in and shows anim 2 for FALL_TIME, then leaves, with no Sink and no Died (as the server does
 * it); it too is back after 3.2 s, so the button works again. `as` (a kind) lets that kind play the wader, the lava walker and the two
 * pushed figures (the barrel stays a barrel); the ids and the events are the same.
 */
export function liquidsScript(t: number, dt: number, pushes: Record<Push, number | null>, as?: number): LiquidsFrame {
  const ents: EntState[] = [elfAt(t, as ?? KIND.ElvenRanger), knightAt(t, as ?? KIND.Knight)];
  const events: PictureEv[] = [];
  for (const q of PUSHERS) {
    const p = pushes[q.push];
    const kind = q.kind === KIND.Barrel ? q.kind : as ?? q.kind;
    const rest = ent(q.id, kind, q.from[0], q.from[1], q.side);
    if (p === null || t < p) { ents.push(rest); continue; }
    const sink = p + SLIDE_TIME;
    const [rx, ry] = reach(q);
    if (t < sink) {
      const k = (t - p) / SLIDE_TIME;
      ents.push({ ...rest, x: (q.from[0] + (rx - q.from[0]) * k) * TILE, y: (q.from[1] + (ry - q.from[1]) * k) * TILE, ...(kind !== KIND.Barrel ? { anim: ANIM.Move, animMs: (t - p) * 1000 } : {}) });
    } else if (t < sink + q.dur) {
      ents.push({ ...rest, x: rx * TILE, y: ry * TILE, ...(q.kind === KIND.Barrel ? { anim: 2, animMs: (t - sink) * 1000 } : {}) });
    } else if (t >= sink + BACK_TIME) ents.push(rest);
    // The server sends no Sink and no Died for a barrel (objects.rs): it only shows anim 2 and is gone.
    if (q.kind !== KIND.Barrel) for (const e of eventsOf(q, kind, p)) if (e.at > t - dt + EPS && e.at <= t + EPS) events.push(e.ev);
  }
  return { ents, events };
}
