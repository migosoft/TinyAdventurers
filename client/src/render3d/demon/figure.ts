// The demon as a built figure (#379): glues the pose and the builder into `BuiltFigure.draw`. One memory per demon: its own `DemonOut`
// (buffers), pose memory and clock, so two demons never share a buffer and a frame allocates nothing.
// Only `built.ts` imports this file (and the dev page's stage, after `built.ts`, for `DEMON_DEV`). Its imports of `../built` are type-only (the registry there imports this file).
import type { BuiltDrawn, BuiltFigure, BuiltIn } from '../built';
import { ANIM, CONST, EFFECT } from '../../generated/defs';
import { has } from '../../game/effectBits';
import { CHEST_AT } from './parts';
import { DEMON_GLOW, glowAt } from './glow';
import { demonPose, newDemonMem, type DemonMem } from './pose';
import { buildDemon, DEMON, demonRest, newDemonOut, type DemonOut } from './shape';

export { DEMON_DEV } from './pose';

/** What one demon keeps between frames: the pose's memory (its clock is the one the glow's pulse runs on), the buffers, what `draw` hands back. */
interface DemonFigMem { mem: DemonMem; out: DemonOut; drawn: BuiltDrawn }

function newMem(): DemonFigMem {
  const out = newDemonOut(), an = out.anchors;
  const drawn: BuiltDrawn = {
    body: out.body, glow: null, hull: out.hull, levels: [0, 1, 1, 0], yaw: 0, lift: 0,
    anchors: { hand: an.hand, mouth: an.mouth, chest: an.chest, eyes: an.eyes },
    halos: [], magic: { gem: 0, flare: 0, chest: 0, mouth: 0 },
  };
  return { mem: newDemonMem(), out, drawn };
}

function draw(s: BuiltIn, dt: number, memory: unknown): BuiltDrawn {
  const m = memory as DemonFigMem, d = m.drawn, mem = m.mem;
  const stone = has(s.effects, EFFECT.Petrified), held = stone || has(s.effects, EFFECT.Frozen);
  const pose = demonPose(s, dt, mem);
  buildDemon(pose, m.out);

  const phase = (mem.t / DEMON_GLOW.period) % 1;
  d.yaw = mem.face;
  d.lift = pose.lift;
  d.levels[0] = phase; d.levels[1] = 1; d.levels[2] = pose.heat; d.levels[3] = 0;
  // the cracks' light at the chest follows the pulse there; a stone demon gives none
  d.magic.chest = stone ? 0 : glowAt(phase, CHEST_AT[1]);
  // the mouth's light while the breath channels
  d.magic.mouth = !held && s.anim === ANIM.Breath && s.animT >= CONST.DEMON_BREATH_WINDUP ? 1 : 0;
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
