// The demon as a built figure (#379): glues the pose and the builder into `BuiltFigure.draw`. One memory per demon: its own `DemonOut`
// (buffers), pose and clock, so two demons never share a buffer and a frame allocates nothing.
// Only `built.ts` imports this file. Its imports of `../built` are type-only (the registry there imports this file).
import type { BuiltDrawn, BuiltFigure, BuiltIn } from '../built';
import { EFFECT } from '../../generated/defs';
import { has } from '../../game/effectBits';
import { CHEST_AT } from './parts';
import { DEMON_GLOW, glowAt } from './glow';
import { restPose, type DemonPose } from './pose';
import { buildDemon, DEMON, demonRest, newDemonOut, type DemonOut } from './shape';

/** What one demon keeps between frames. `t`: the figure's own clock (s), which the glow's pulse runs on. */
interface DemonFigMem { t: number; pose: DemonPose; out: DemonOut; drawn: BuiltDrawn }

function newMem(): DemonFigMem {
  const out = newDemonOut(), an = out.anchors;
  const drawn: BuiltDrawn = {
    body: out.body, glow: null, hull: out.hull, levels: [0, 1, 1, 0], yaw: 0, lift: 0,
    anchors: { hand: an.hand, mouth: an.mouth, chest: an.chest, eyes: an.eyes },
    halos: [], magic: { gem: 0, flare: 0, chest: 0, mouth: 0 },
  };
  return { t: 0, pose: restPose(), out, drawn };
}

function draw(s: BuiltIn, dt: number, memory: unknown): BuiltDrawn {
  const m = memory as DemonFigMem, d = m.drawn;
  const stone = has(s.effects, EFFECT.Petrified);
  // frozen or stone: every clock of the figure stands still
  if (!stone && !has(s.effects, EFFECT.Frozen)) m.t += dt;
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
