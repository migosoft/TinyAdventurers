// The lich as a built figure (#358): glues the cloth, the pose and the builder into `BuiltFigure.draw`. One memory per lich: its own
// `LichOut` (buffers), `Cloth`, `LichMem` and the scratch the frame needs, so two liches never share a buffer and a frame allocates nothing.
// Only `built.ts` imports this file. Its imports of `../built` are type-only (the registry there imports this file).

import type { BuiltDrawn, BuiltFigure, BuiltIn, V3 } from '../built';
import { EFFECT } from '../../generated/defs';
import { has } from '../../game/effectBits';
import { clothFollow, clothMove, newCloth, type Cloth } from './cloth';
import { lichPose, newLichMem, type LichIn, type LichMem } from './pose';
import { ROBE_RINGS } from './rings';
import { buildLich, LICH, LICH_TOP, lichRest, newLichOut, ringLean, type LichOut } from './shape';

/** Game px per tile (the figure pass's own `TILE`). */
const TILE = 16;

interface Halo { at: V3; r: number; rgb: V3 }

/** What one lich keeps between frames. */
interface LichFigMem { mem: LichMem; cloth: Cloth; out: LichOut; lean: Float32Array; inp: LichIn; drawn: BuiltDrawn; halos: Halo[] }

function newMem(): LichFigMem {
  const out = newLichOut(), an = out.anchors;
  const halos: Halo[] = [
    { at: an.eyeL, r: 0, rgb: [0, 0, 0] },
    { at: an.eyeR, r: 0, rgb: [0, 0, 0] },
    { at: an.gem, r: 0, rgb: [0, 0, 0] },
    { at: an.tome, r: 0, rgb: [0, 0, 0] },
  ];
  const drawn: BuiltDrawn = {
    body: out.body, glow: out.claws, levels: [0, 0, 0, 0], yaw: 0,
    anchors: { hand: an.hand, gem: an.gem, eyes: an.eyes, chest: an.chest },
    halos, magic: { gem: 0, flare: 0 },
  };
  return { mem: newLichMem(), cloth: newCloth(), out, lean: new Float32Array(ROBE_RINGS.length * 2), inp: { anim: 0, animT: 0, effects: 0, flags: 0, aim: 0, look: null, glide: 0 }, drawn, halos };
}

function draw(s: BuiltIn, dt: number, memory: unknown): BuiltDrawn {
  const m = memory as LichFigMem, d = m.drawn;
  // frozen or stone: every clock of the figure stands still, the cloth's too (dt 0 changes nothing); a first sight still gets its one call
  const held = m.mem.started && (has(s.effects, EFFECT.Frozen) || has(s.effects, EFFECT.Petrified));
  const cdt = held ? 0 : dt;
  clothMove(m.cloth, (s.x * TILE) / LICH.unit, (s.z * TILE) / LICH.unit, cdt);
  const i = m.inp;
  i.anim = s.anim; i.animT = s.animT; i.effects = s.effects; i.flags = s.flags; i.aim = s.aim; i.look = s.look; i.glide = m.cloth.glide;
  const pose = lichPose(i, dt, m.mem);
  ringLean(pose, m.lean);
  clothFollow(m.cloth, pose.face, cdt, m.lean);
  buildLich(pose, m.cloth, m.out);

  d.yaw = pose.face;
  d.levels[0] = pose.rune; d.levels[1] = pose.staffRune; d.levels[2] = pose.wave; d.levels[3] = 0;
  const [eyeL, eyeR, gem, tome] = m.halos;
  const eye = 0.5 * pose.eye, er = 0.5 + 0.35 * pose.gaze;
  eyeL.r = er; eyeL.rgb[0] = 0.75 * eye; eyeL.rgb[1] = 0.66 * eye; eyeL.rgb[2] = 1.0 * eye;
  eyeR.r = er; eyeR.rgb[0] = 0.75 * eye; eyeR.rgb[1] = 0.66 * eye; eyeR.rgb[2] = 1.0 * eye;
  gem.r = 1.1 + 0.7 * pose.gem;
  gem.rgb[0] = 0.45 * 0.34 * pose.gem; gem.rgb[1] = 0.72 * 0.34 * pose.gem; gem.rgb[2] = 1.0 * 0.34 * pose.gem;
  tome.r = 2.6;
  const t = 0.1 + 0.16 * pose.casting + 0.1 * pose.flare;
  tome.rgb[0] = 0.5 * t; tome.rgb[1] = 0.3 * t; tome.rgb[2] = 0.85 * t;
  d.magic.gem = pose.gem; d.magic.flare = pose.flare;
  return d;
}

// `unit`, `top` and `hem` are getters: `built.ts` imports this file and `shape.ts` imports `built.ts`, so when `shape.ts` is loaded first
// this module runs before `LICH` and `LICH_TOP` exist. Nothing here reads them at load time.
export const LICH_FIGURE: BuiltFigure = {
  key: 'lich', picture: 'lich',
  get unit() { return LICH.unit; },
  get top() { return LICH_TOP * LICH.unit; },
  get hem() { return LICH.hem; },
  newMem,
  draw,
  rest: () => lichRest('caster').body,
};
