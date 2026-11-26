// The demon as a built figure (#379): glues the pose and the builder into `BuiltFigure.draw`. One memory per demon: its own `DemonOut`
// (buffers), pose and clock, so two demons never share a buffer and a frame allocates nothing.
// Only `built.ts` imports this file (and the dev page's stage, after `built.ts`, for `DEMON_DEV`). Its imports of `../built` are type-only (the registry there imports this file).
import type { BuiltDrawn, BuiltFigure, BuiltIn } from '../built';
import { EFFECT, FLAG } from '../../generated/defs';
import { has } from '../../game/effectBits';
import { CHEST_AT } from './parts';
import { DEMON_GLOW, glowAt } from './glow';
import { DEMON_POSE, restPose, type DemonPose } from './pose';
import { buildDemon, DEMON, demonRest, newDemonOut, type DemonOut } from './shape';
import { WING, beatTarget, chainStep, wingStep, type WingTarget } from './wings';

/**
 * What one demon keeps between frames. `t`: the figure's own clock (s), which the glow's pulse runs on.
 * The wings' and the tail's life until the poses come: `aim` the last frame's (null: none yet), `turn` the body's turning speed
 * (rad/s, eased), `beat` the beat's phase, `tailV` the tail links' speeds, `wing` scratch for a wing's target.
 */
interface DemonFigMem { t: number; pose: DemonPose; out: DemonOut; drawn: BuiltDrawn; aim: number | null; turn: number; beat: number; tailV: Float32Array; wing: WingTarget }

/** The dev page's hand on the wings (the act `wings`, demonStage.ts): a fold their target takes instead of the pose's. null in a run. */
export const DEMON_DEV: { fold: number | null } = { fold: null };

function newMem(): DemonFigMem {
  const out = newDemonOut(), an = out.anchors;
  const drawn: BuiltDrawn = {
    body: out.body, glow: null, hull: out.hull, levels: [0, 1, 1, 0], yaw: 0, lift: 0,
    anchors: { hand: an.hand, mouth: an.mouth, chest: an.chest, eyes: an.eyes },
    halos: [], magic: { gem: 0, flare: 0, chest: 0, mouth: 0 },
  };
  const pose = restPose();
  return { t: 0, pose, out, drawn, aim: null, turn: 0, beat: 0, tailV: new Float32Array(pose.tail.length), wing: { ...WING.rest } };
}

/** The wings and the tail for `dt`: the beat in the air, the rest on the ground; the wings and the tail trail a turn of the body. */
function wingsLife(s: BuiltIn, dt: number, m: DemonFigMem): void {
  const pose = m.pose, air = (s.flags & FLAG.AIRBORNE) !== 0, T = m.wing, turned = m.aim === null ? 0 : Math.atan2(Math.sin(s.aim - m.aim), Math.cos(s.aim - m.aim));
  m.aim = s.aim;
  m.turn += (turned / dt - m.turn) * Math.min(1, dt * WING.turn.ease);
  if (air) { m.beat = (m.beat + dt / WING.beat) % 1; beatTarget(m.beat, T); } else { m.beat = 0; T.fold = WING.rest.fold; T.raise = WING.rest.raise; T.pitch = WING.rest.pitch; }
  if (DEMON_DEV.fold !== null) T.fold = DEMON_DEV.fold;
  // turning to its right, the right wing travels back and lags forward of its place, the left the other way; the tail swings out
  const sweep = air ? T.sweep : WING.rest.sweep, lag = m.turn * WING.turn.sweep;
  T.sweep = sweep - lag; wingStep(pose.wingR, T, dt);
  T.sweep = sweep + lag; wingStep(pose.wingL, T, dt);
  chainStep(pose.tail, m.tailV, m.turn * WING.turn.tail, 0, WING.tailRates, dt);
  pose.lift = dt > WING.maxDt ? (air ? DEMON_POSE.lift : 0) : pose.lift + ((air ? DEMON_POSE.lift : 0) - pose.lift) * Math.min(1, dt * DEMON_POSE.liftRate);
}

function draw(s: BuiltIn, dt: number, memory: unknown): BuiltDrawn {
  const m = memory as DemonFigMem, d = m.drawn;
  const stone = has(s.effects, EFFECT.Petrified);
  // frozen or stone: every clock of the figure stands still
  if (!stone && !has(s.effects, EFFECT.Frozen) && dt > 0) { m.t += dt; wingsLife(s, dt, m); }
  const pose = m.pose;
  buildDemon(pose, m.out);

  const phase = (m.t / DEMON_GLOW.period) % 1;
  d.yaw = s.aim;
  d.lift = pose.lift;
  d.levels[0] = phase; d.levels[1] = 1; d.levels[2] = pose.heat; d.levels[3] = 0;
  // the cracks' light at the chest follows the pulse there; a stone demon gives none
  d.magic.chest = stone ? 0 : glowAt(phase, CHEST_AT[1]);
  d.magic.mouth = 0;
  return d;
}

// `unit`, `top` and `hem` are getters: `built.ts` imports this file and `shape.ts` imports `built.ts`, so when `shape.ts` is loaded first
// this module runs before `DEMON` exists. Nothing here reads it at load time.
export const DEMON_FIGURE: BuiltFigure = {
  key: 'demon', picture: 'demon',
  get unit() { return DEMON.unit; },
  get top() { return DEMON.top; },
  get hem() { return DEMON.hem; },
  newMem,
  draw,
  rest: () => demonRest().body,
};
