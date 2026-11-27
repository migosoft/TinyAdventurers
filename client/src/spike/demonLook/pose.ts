// SPIKE (#379): stances and motion as bone turns. Angles are [x, y, z] in rad on a bone that is axis-aligned at rest:
// x tips a spine bone forward and swings a hanging limb back, y turns to the demon's left, z lifts the left side.
// A stance names the left bones; the right ones are the mirror unless it names them too.
import * as THREE from 'three';
import type { Rig } from './body';
import { on } from './opts';

type A = [number, number, number];
type Pose = Record<string, A>;

function both(p: Pose): Pose {
  const o: Pose = { ...p };
  for (const k in p) if (k.endsWith('L') && !(k.slice(0, -1) + 'R' in p)) o[k.slice(0, -1) + 'R'] = [p[k][0], -p[k][1], -p[k][2]];
  return o;
}

const STAND = both({
  hips: [0.06, 0.1, 0], waist: [0.12, -0.04, 0], chest: [0.2, -0.08, 0], neck: [0.25, 0.04, 0], head: [-0.4, 0.1, 0.04], jaw: [0.12, 0, 0],
  clavL: [0, -0.06, 0], upperArmL: [-0.1, 0, -0.04], foreArmL: [-0.26, 0, -0.1], handL: [-0.05, 0, 0.03], fingersL: [0, 0, -0.35],
  upperArmR: [-0.03, 0, 0.02], foreArmR: [-0.34, 0, 0.13],
  thighL: [-0.5, 0.22, 0.16], shinL: [0.8, 0, 0], thighR: [-0.3, -0.16, -0.14], shinR: [0.6, 0, 0],
  tail0: [0.1, 0, 0], tail2: [-0.2, 0, 0], tail3: [-0.25, 0, 0], tail4: [-0.3, 0, 0],
  wing1L: [-0.42, -0.08, -0.05],
});
const FLY = both({
  hips: [0.38, 0, 0], waist: [-0.05, 0, 0], chest: [-0.12, 0, 0], neck: [-0.05, 0, 0], head: [-0.25, 0, 0], jaw: [0.25, 0, 0],
  clavL: [0, -0.1, 0.1], upperArmL: [-0.35, 0, 0.45], foreArmL: [-0.9, 0, -0.2], handL: [-0.2, 0, 0], fingersL: [0, 0, -0.7],
  thighL: [0.15, 0.1, 0.1], shinL: [0.55, 0, 0], footL: [0.7, 0, 0], thighR: [-1.0, -0.1, -0.1], shinR: [1.5, 0, 0], footR: [0.5, 0, 0],
  tail0: [-0.5, 0, 0], tail1: [-0.1, 0, 0], tail3: [0.2, 0, 0], tail4: [0.3, 0, 0],
  wing1L: [1.0, 0, -0.45],
});
// the sword hand: the fingers closed round the grip, the arm carrying the blade a little forward
if (on('sword')) { STAND.fingersR = [0, 0, 1.25]; FLY.fingersR = [0, 0, 1.25]; STAND.foreArmR = [-0.5, 0, 0.1]; STAND.handR = [-0.1, 0, -0.03]; }
// Added on top of the stance: the right claw drawn back, then thrown across.
const WIND: Pose = {
  hips: [0, -0.2, 0], chest: [-0.1, -0.45, 0], head: [0, 0.3, 0], upperArmR: [0.5, 0, -0.8], foreArmR: [-1.0, 0, 0], fingersR: [0, 0, -0.3],
};
// The breath weapon: a breath in (head and chest back), then the head thrust forward with the jaw wide open.
const INHALE: Pose = { waist: [-0.08, 0, 0], chest: [-0.16, 0, 0], neck: [-0.12, 0, 0], head: [-0.2, 0, 0], jaw: [0.1, 0, 0], upperArmL: [0.15, 0, 0.1], upperArmR: [0.15, 0, -0.1] };
const BREATHE: Pose = { hips: [0.05, 0, 0], waist: [0.05, 0, 0], chest: [0.06, 0, 0], neck: [0.1, 0, 0], head: [-0.22, 0, 0], jaw: [0.85, 0, 0], upperArmL: [0.3, 0, 0.18], upperArmR: [0.3, 0, -0.18], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0] };
const STRIKE: Pose = {
  hips: [0.05, 0.25, 0], chest: [0.3, 0.55, 0], head: [0, -0.35, 0], jaw: [0.35, 0, 0], upperArmR: [-1.5, 0, 0.35], foreArmR: [0.3, 0, 0], fingersR: [0, 0, -0.4], upperArmL: [0.45, 0, 0.2],
};
/**
 * Folding, as a bat's wing does, only at its joints (left wing, rad at full fold): the upper arm drops, the elbow closes so the
 * wrist stands up beside the shoulder, each finger swings down at the wrist into a closed bundle, the knuckles straighten.
 */
/** In the air the wing opens all the way: the arm lifts, the elbow straightens, the fingers fan out, the knuckles straighten. */
const SPREAD = on('spread') ? { arm: 0.5, elbow: -0.25, wrist: [0.45, 0.3, 0.16, 0.04], knuckle: [-0.15, -0.1, -0.05, 0] } : { arm: 0, elbow: 0, wrist: [0, 0, 0, 0], knuckle: [0, 0, 0, 0] };
const FOLD = { arm: -1.31, elbow: 1.52, wrist: [-1.29, -0.77, -0.45, -0.31], knuckle: [0.6, 0.3, 0, 0] };

export interface State { fly: number; look: number; attack: number; fold: number; breath: number }
/** How open the throat is (0..1) at a time into the breath's loop. */
export function breathOut(b: number): number { const ph = b % 3.6; return b < 0 || ph < 0.6 ? 0 : ph < 2.4 ? ease((ph - 0.6) / 0.18) : 1 - ease((ph - 2.4) / 0.6); }
const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), ax = new THREE.Vector3(), v = new THREE.Vector3();
/** Turns a bone about an axis given in the world, on top of its own turn. */
function twist(b: THREE.Bone, axis: THREE.Vector3, angle: number) {
  b.parent!.getWorldQuaternion(q);
  b.quaternion.premultiply(q2.setFromAxisAngle(ax.copy(axis).applyQuaternion(q.invert()), angle));
}

/** The wing beat's phase at a time. */
export const beat = (t: number) => t * Math.PI * 2 * 1.5;

let lastT = 0, follow = 0, lagVel = 0;
export function animate(r: Rig, rest: Map<THREE.Bone, THREE.Vector3>, t: number, s: State) {
  const fly = ease(s.fly), cur: Pose = {};
  for (const b of r.bones) {
    const a = STAND[b.name] ?? [0, 0, 0], f = FLY[b.name] ?? [0, 0, 0];
    cur[b.name] = [a[0] + (f[0] - a[0]) * fly, a[1] + (f[1] - a[1]) * fly, a[2] + (f[2] - a[2]) * fly];
  }
  const addTo = (p: Pose, w: number) => { for (const k in p) for (let c = 0; c < 3; c++) cur[k][c] += p[k][c] * w; };
  // breathing, the tail, the head's small life
  const br = Math.sin(t * 1.3);
  cur.chest[0] += 0.025 * br; cur.waist[0] -= 0.012 * br; cur.clavL[2] += 0.03 * br; cur.clavR[2] -= 0.03 * br;
  cur.head[1] += 0.05 * Math.sin(t * 0.43); cur.head[0] += 0.03 * Math.sin(t * 0.61 + 1);
  for (let i = 0; i < 5; i++) cur[`tail${i}`][1] += 0.14 * Math.sin(t * 0.9 - i * 0.7);
  // looking round: the turn is shared by chest, neck and head
  const yaw = 0.95 * Math.sin(t * 0.9) * s.look;
  cur.chest[1] += 0.18 * yaw; cur.neck[1] += 0.36 * yaw; cur.head[1] += 0.46 * yaw; cur.head[2] -= 0.1 * yaw; cur.head[0] += 0.1 * Math.sin(t * 1.7) * s.look;
  // the claw strike
  let wind = 0, strike = 0;
  if (s.attack >= 0) {
    const ph = s.attack % 2.4;
    wind = ph < 0.5 ? ease(ph / 0.5) : 1 - ease((ph - 0.5) / 0.12);
    strike = ph < 0.5 ? 0 : ph < 0.85 ? 1 - (1 - Math.min(1, (ph - 0.5) / 0.12)) ** 3 : 1 - ease((ph - 0.85) / 0.75);
    addTo(WIND, wind); addTo(STRIKE, strike);
  }
  if (on('life')) {
    // weight shifting from foot to foot, the jaw working, a snarl as the blow is drawn, heaving after it, the wings resettling
    const roll = 0.035 * Math.sin(t * 0.5) * (1 - fly);
    cur.hips[2] += roll; cur.thighL[2] -= roll; cur.thighR[2] -= roll; cur.waist[2] -= roll * 0.6; cur.chest[2] -= roll * 0.5; cur.head[2] += roll * 0.4;
    cur.jaw[0] += 0.06 * Math.max(0, Math.sin(t * 0.7)) ** 2 + 0.3 * wind + 0.15 * strike;
    if (s.attack >= 0) { const ph = s.attack % 2.4, after = ph > 0.9 ? Math.exp(-(ph - 0.9) * 1.6) : 0; cur.chest[0] += 0.05 * after * Math.sin(ph * 9); cur.clavL[2] += 0.05 * after * Math.sin(ph * 9); cur.clavR[2] -= 0.05 * after * Math.sin(ph * 9); }
    for (let i = 0; i < 5; i++) cur[`tail${i}`][1] += 0.1 * Math.sin(t * 0.5 - 0.6 - i * 0.5) * (1 - fly);
  }
  if (on('life')) {
    // the tail trails behind a turn of the body and whips after it
    const yaw = cur.hips[1] + 0.6 * cur.chest[1], dt = Math.min(0.05, Math.max(0, t - lastT)); lastT = t;
    lagVel += ((yaw - follow) * 38 - lagVel * 4.5) * dt; follow += lagVel * dt;
    const off = Math.max(-1, Math.min(1, follow - yaw));
    for (let i = 0; i < 5; i++) cur[`tail${i}`][1] += off * (i ? 0.45 : 0.9);
  }
  const out = breathOut(s.breath);
  if (s.breath >= 0) { const ph = s.breath % 3.6; addTo(INHALE, ph < 0.6 ? ease(ph / 0.5) : 1 - ease((ph - 0.6) / 0.15)); addTo(BREATHE, out); }
  // folding the wings (on the ground)
  const shrug = on('life') ? 0.14 * Math.exp(-((((t % 7.5) - 6) / 0.35) ** 2)) : 0;
  const fold = Math.min(1, s.fold + shrug) * (1 - fly);
  for (const [side, m] of [['L', 1], ['R', -1]] as const) {
    cur['wing1' + side][2] += m * (FOLD.arm * fold + SPREAD.arm * fly); cur['wing2' + side][2] += m * (FOLD.elbow * fold + SPREAD.elbow * fly);
    for (let i = 0; i < 4; i++) {
      cur[`wf${i}a` + side][2] += m * (FOLD.wrist[i] * fold + SPREAD.wrist[i] * fly + 0.03 * Math.sin(t * 0.7 + i * 1.3));
      cur[`wf${i}b` + side][2] += m * (FOLD.knuckle[i] * fold + SPREAD.knuckle[i] * fly + 0.04 * Math.sin(t * 0.9 + i * 0.8 + 2));
    }
  }
  for (const b of r.bones) { const a = cur[b.name]; b.rotation.set(a[0], a[1], a[2]); b.position.copy(rest.get(b)!); }

  const phi = beat(t);
  r.root.position.y += -0.14 * (1 - fly) + 0.012 * br + fly * (1.0 - 0.07 * Math.sin(phi - 0.4)) - 0.1 * strike;
  r.root.position.z += 0.15 * strike - 0.05 * wind;
  r.root.updateMatrixWorld(true);

  // the wings: a slow sway on the ground, a flare with the strike, the beat in the air; each joint further out lags
  const fwd = v.set(0, 0, 1).applyQuaternion(r.by.chest.getWorldQuaternion(q)).clone();
  const lift = (lag: number) => 0.08 * Math.sin(t * 0.8 - lag) * (1 - fly) + fly * Math.sin(phi - lag);
  for (const [side, m] of [['L', 1], ['R', -1]] as const) {
    twist(r.by['wing1' + side], fwd, m * (0.5 * lift(0) + 0.15 * fly + 0.25 * strike - 0.1 * wind + 0.18 * out));
    twist(r.by['wing2' + side], fwd, m * 0.3 * lift(0.7));
    for (let i = 0; i < 4; i++) { twist(r.by[`wf${i}a` + side], fwd, m * 0.18 * lift(1.2)); twist(r.by[`wf${i}b` + side], fwd, m * 0.25 * lift(1.7)); }
  }

  // the feet: on the ground the knees bend as far as it takes to keep each foot on the floor, and the foot lies flat
  for (const side of ['L', 'R']) {
    const thigh = r.by['thigh' + side], shin = r.by['shin' + side], foot = r.by['foot' + side];
    const t0 = thigh.rotation.x, s0 = shin.rotation.x;
    let lo = -0.7, hi = 1.7;
    for (let i = 0; i < 16; i++) {
      const b = ((lo + hi) / 2) * (1 - fly);
      thigh.rotation.x = t0 - 0.5 * b; shin.rotation.x = s0 + b;
      thigh.updateMatrixWorld(true);
      if (foot.getWorldPosition(v).y < 0.28) lo = (lo + hi) / 2; else hi = (lo + hi) / 2;
    }
    shin.getWorldQuaternion(q);
    const f = v.set(0, 0, 1).applyQuaternion(q);
    q2.setFromAxisAngle(ax.set(0, 1, 0), Math.atan2(f.x, f.z));
    const flat = q.invert().multiply(q2);
    foot.quaternion.slerp(flat, 1 - fly);
  }
  r.root.updateMatrixWorld(true);
}
