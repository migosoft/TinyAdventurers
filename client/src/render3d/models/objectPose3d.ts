// The pose of the objects that do not walk (#317): the chest, the Mimic and the barrel. One small function writes the lid angle, the
// scale of the loot or tongue (`hat`), the lift, the squash, the pitch and the offset into a `Pose3d`; the 2D-side state they come
// from is `game/objectPose.ts`. Frames as in pose3d.ts: x is the front, y up, z the width; the instance turns the pose by `yaw`, so
// `ahead` (root x) is along the facing and `side` (root z) across it.

import { chestLid, chestLoot, type MimicPose } from '../../game/objectPose';
import { BONES, MAX_BONES } from './bones';
import type { FigureModel } from './model';
import { newPose, TURN_RATE, type Pose3d } from './pose3d';
import { composeBones, identityLocal, type BoneLocal } from './rig';

export const CHEST_OPEN = (110 * Math.PI) / 180, MIMIC_GAPE = (75 * Math.PI) / 180, SOUTH = Math.PI / 2;

export interface ObjectPoseIn {
  yaw: number;
  /** Rad about the hinge, 0 shut. */
  lid: number;
  /** The scale of the `hat` bone: the chest's loot, the Mimic's tongue; 0 hides it. */
  hat: number;
  /** Game px above the ground. */
  lift: number;
  /** Squash and stretch: along the ground (both ways) and the height. */
  sx: number; sy: number;
  /** Rad, the front up. */
  pitch: number;
  /** Game px along the facing and across it. */
  ahead: number; side: number;
  /** Rad at the tongue's tip. */
  sway: number;
}

export const REST_OBJECT: ObjectPoseIn = { yaw: 0, lid: 0, hat: 1, lift: 0, sx: 1, sy: 1, pitch: 0, ahead: 0, side: 0, sway: 0 };

const BODY = BONES.indexOf('body'), HEAD = BONES.indexOf('head'), HAT = BONES.indexOf('hat');
const locals: BoneLocal[] = Array.from({ length: MAX_BONES }, identityLocal);
const fin = (v: number, rest: number): number => (Number.isFinite(v) ? v : rest);
const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Writes the pose into `out` (a new pose when omitted). A non-finite input counts as its rest value. */
export function poseObject(m: FigureModel, o: ObjectPoseIn, out: Pose3d = newPose(0)): Pose3d {
  const R = REST_OBJECT, hat = fin(o.hat, R.hat);
  out.yaw = fin(o.yaw, R.yaw);
  for (const L of locals) { L.rx = L.ry = L.rz = L.tx = L.ty = L.tz = 0; L.sx = L.sy = L.sz = 1; L.q = undefined; }
  locals[BODY].rz = fin(o.pitch, R.pitch);
  locals[HEAD].rz = fin(o.lid, R.lid);
  locals[HAT].sx = locals[HAT].sy = locals[HAT].sz = hat;
  composeBones(m, locals, out.bones);
  const r = out.root;
  r.x = fin(o.ahead, R.ahead); r.y = fin(o.lift, R.lift); r.z = fin(o.side, R.side); r.roll = 0;
  r.sx = r.sz = fin(o.sx, R.sx); r.sy = fin(o.sy, R.sy);
  out.bends.fill(0);
  if (m.bends.length > 0) { out.bends[0] = 1; out.bends[3] = fin(o.sway, R.sway); }
  out.robe[0] = out.robe[1] = out.robe[2] = 0;
  out.air = 0; out.attack = null; out.asleep = false; out.channel = false;
  return out;
}

/** The chest facing south: the lid by how far it is open, the loot until it is taken. */
export function chestPoseIn(opened: number): ObjectPoseIn {
  return { ...REST_OBJECT, yaw: SOUTH, lid: chestLid(opened) * CHEST_OPEN, hat: chestLoot(opened) ? 1 : 0 };
}

/** The Mimic from its 2D-side pose; hiding it is the chest (no tongue, a shiver sideways). */
export function mimicPoseIn(p: MimicPose, hiding: boolean, yaw: number, clock: number): ObjectPoseIn {
  return {
    yaw, lid: p.lid * MIMIC_GAPE, hat: hiding ? 0 : smooth(p.lid / 0.3), lift: p.lift, sx: p.sx, sy: p.sy,
    pitch: (p.pitch * Math.PI) / 180, ahead: p.lunge, side: hiding ? p.bx : 0, sway: 0.25 * Math.sin(clock * 3),
  };
}

/** A fixed turn per barrel. */
export function barrelYaw(id: number): number {
  return (id * 2.399963) % (2 * Math.PI);
}

/** The facing turned towards `aim` at TURN_RATE, the short way round; a non-finite aim or dt leaves it. */
export function turnTo(yaw: number, aim: number, dt: number): number {
  if (!Number.isFinite(aim) || !Number.isFinite(dt) || dt <= 0) return yaw;
  const tau = 2 * Math.PI, d = ((((aim - yaw + Math.PI) % tau) + tau) % tau) - Math.PI, lim = TURN_RATE * dt;
  return yaw + Math.max(-lim, Math.min(lim, d));
}
