// The demons as built figures (#379, #442): glues the pose and the skeleton into `BuiltFigure.draw`. The body is a static skin loaded from
// a file (skinFile.ts); a frame only places its bones (`placeBones`) and hands the matrices to the layer, which skins on the GPU.
// One memory per demon: its own pose memory, clock and matrices, so two demons never share a buffer and a frame allocates nothing.
// Only `built.ts` imports this file (and the dev page's stage, after `built.ts`, for `DEMON_DEV`). Its imports of `../built` are type-only (the registry there imports this file).
import { newBuiltBuf, type BuiltBuf, type BuiltDrawn, type BuiltFigure, type BuiltIn, type V3 } from '../built';
import { ANIM, CONST, EFFECT } from '../../generated/defs';
import { has } from '../../game/effectBits';
import { BLADE, BONES, BONE_DEFS, B, EYE, MOUTH, buildDemonSkin } from './body';
import { chainSwing, demonPose, newDemonMem, restPose, type DemonMem } from './pose';
import { SKEL, onBone, placeBones } from './skeleton';
import { demonSkin } from './skinFile';

export { DEMON_DEV } from './pose';

/** `unit`: game px per builder unit (the head's top is 54 px); `top`, `hem`: game px. */
export const DEMON = { unit: 54 / SKEL.crown, top: 54, hem: 12 } as const;
/** The seconds a full turn of the glow's pulse takes. */
const PULSE = 4;

/** What one demon keeps between frames: the pose's memory (its clock is the one the glow's pulse runs on), the bone matrices, what `draw` hands back. */
interface DemonFigMem { mem: DemonMem; bones: Float32Array; drawn: BuiltDrawn; built: boolean }

const at = (name: string): V3 => BONE_DEFS[B[name]][2];
const v3 = (): V3 => [0, 0, 0];
const BLADE_U = [0, 0.25, 0.5, 0.75, 1];
const HAND_R = at('handR');
// bind points the anchors ride on (builder frame): the knuckles of the left hand, the mouth, the chest bone's pivot, the eyes, the blade's edge
const PALM = at('fingersL'), CHEST = at('chest');
const EYE_R: V3 = [-EYE[0], EYE[1], EYE[2]], EYES: V3 = [0, EYE[1], EYE[2]];
/** Where the wrist chain hangs from: a little above its first link's bind place, on the left forearm. */
const HANG: V3 = [at('chain0')[0], at('chain0')[1] + 0.03, at('chain0')[2]], HUNG: V3 = [0, 0, 0];
const EDGE = BLADE_U.map((u): V3 => { const e = BLADE.edge(u); return [HAND_R[0] + e[0], HAND_R[1] + e[1], HAND_R[2] + e[2]]; });

function newMem(temper: 1 | -1): () => DemonFigMem {
  return () => {
    const bones = new Float32Array(BONES * 16);
    const drawn: BuiltDrawn = {
      body: newBuiltBuf(0, 0), glow: null, levels: [0, 1, 1, 0], yaw: 0, lift: 0, bones, temper,
      anchors: { hand: v3(), mouth: v3(), chest: v3(), eyes: v3(), eyeL: v3(), eyeR: v3(), blade: BLADE_U.map(v3) },
      halos: [], magic: { gem: 0, flare: 0, chest: 0, mouth: 0 },
    };
    return { mem: newDemonMem(), bones, drawn, built: false };
  };
}

function draw(s: BuiltIn, dt: number, memory: unknown): BuiltDrawn {
  const m = memory as DemonFigMem, d = m.drawn, mem = m.mem, a = d.anchors;
  const stone = has(s.effects, EFFECT.Petrified), held = stone || has(s.effects, EFFECT.Frozen);
  const pose = demonPose(s, dt, mem);
  // a held pose is the one the matrices already show (not before the first placing)
  if (!(held && m.built)) {
    placeBones(pose, m.bones);
    m.built = true;
    const b = m.bones;
    onBone(b, B.fingersL, PALM, a.hand); onBone(b, B.jaw, MOUTH, a.mouth!); onBone(b, B.chest, CHEST, a.chest!);
    onBone(b, B.head, EYE, a.eyeL!); onBone(b, B.head, EYE_R, a.eyeR!); onBone(b, B.head, EYES, a.eyes!);
    for (let i = 0; i < EDGE.length; i++) onBone(b, B.handR, EDGE[i], a.blade![i]);
    // the chain swings behind where the wrist went (model x is the builder's front, model z its right)
    onBone(b, B.foreArmL, HANG, HUNG);
    chainSwing(mem, -HUNG[2], HUNG[0], dt);
  }
  const phase = (mem.t / PULSE) % 1;
  d.yaw = mem.face;
  d.lift = pose.lift * SKEL.perPose;   // builder units
  d.levels[0] = phase; d.levels[1] = 1; d.levels[2] = pose.heat; d.levels[3] = 0;
  // shortcut: the chest's light is a plain pulse until the paint and glow of task 10 and 11 give it the crack's own, then read it there
  d.magic.chest = stone ? 0 : 0.6 + 0.4 * Math.sin(phase * 2 * Math.PI);
  // the mouth's light while the breath channels
  d.magic.mouth = !held && s.anim === ANIM.Breath && s.animT >= CONST.DEMON_BREATH_WINDUP ? 1 : 0;
  return d;
}

let rested: BuiltBuf | null = null;
/** The coarse skin (cell 0.04) of the body, the tail and the folded wings, skinned on the CPU by the rest pose, once: the lamp outline's shape. */
function rest(): BuiltBuf {
  if (rested) return rested;
  const skin = buildDemonSkin(0.04), parts = [skin.body, skin.tail, skin.tubes, skin.web];
  const bones = new Float32Array(BONES * 16);
  placeBones(restPose(), bones);
  const verts = parts.reduce((n, p) => n + p.position.length / 3, 0), indices = parts.reduce((n, p) => n + p.index.length, 0);
  const out = newBuiltBuf(verts, indices);
  let v = 0, i = 0;
  const q: V3 = [0, 0, 0], p: V3 = [0, 0, 0];
  for (const part of parts) {
    const n = part.position.length / 3;
    for (let k = 0; k < n; k++) {
      let x = 0, y = 0, z = 0;
      // the file's byte weights sum to a little off 1: divide by their sum
      const sum = part.skinWeight[k * 4] + part.skinWeight[k * 4 + 1] + part.skinWeight[k * 4 + 2] + part.skinWeight[k * 4 + 3] || 1;
      for (let j = 0; j < 4; j++) {
        const w = part.skinWeight[k * 4 + j] / sum;
        if (w === 0) continue;
        p[0] = part.position[k * 3]; p[1] = part.position[k * 3 + 1]; p[2] = part.position[k * 3 + 2];
        onBone(bones, part.skinIndex[k * 4 + j], p, q);
        x += q[0] * w; y += q[1] * w; z += q[2] * w;
      }
      // the folded wings' longest fingers reach under the floor (as in the spike): the outline ends at the floor
      out.position[(v + k) * 3] = x; out.position[(v + k) * 3 + 1] = Math.max(0, y); out.position[(v + k) * 3 + 2] = z;
    }
    for (let k = 0; k < part.index.length; k++) out.index[i + k] = part.index[k] + v;
    v += n; i += part.index.length;
  }
  out.verts = v; out.indices = i;
  return (rested = out);
}

/** The figure of a demon: the fire one (hot) and the ice one (cold) share the skin and the pose; they differ in their key and temper. */
export function demonFigure(kind: 'fire' | 'ice'): BuiltFigure {
  return {
    key: kind === 'fire' ? 'demon' : 'iceDemon', picture: null,
    // shortcut: both demons share one outline frame; they are the same pixels (one skin, one stance), so nothing is lost, and two would not fit the atlas's 2048 px
    ...(kind === 'ice' ? { outline: 'demon' } : {}),
    unit: DEMON.unit, top: DEMON.top, hem: DEMON.hem,
    newMem: newMem(kind === 'fire' ? 1 : -1),
    draw,
    rest,
    // starts loading the skin (once) and says when it is there
    ready: () => demonSkin() !== null,
  };
}
export const DEMON_FIGURE: BuiltFigure = demonFigure('fire'), ICE_DEMON_FIGURE: BuiltFigure = demonFigure('ice');
