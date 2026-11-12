// The per-frame look of one figure, as data: pure and Phaser-free, so the 2D
// view (EntityView) and the 3D view draw from the same decisions. It owns the
// rules (facing, frame choice, tints, lying, sinking, weapon pose); the random
// particles, sparks and swooshes stay in the views.
import { ANIM, EFFECT, FLAG } from '../../generated/defs';
import { has } from '../effectBits';
import type { FigureDef } from './defs';
import { lieLayout, lyingPose, type Bounds } from './lying';
import { pickFrame, windupOf } from './pickFrame';
import { appearFactor, entityAlpha, ghostPhase, VANISH_SECS } from './entityAlpha';
import { SILHOUETTE_FILL, silhouetteAlpha } from '../shadeHaze';

/** Pack weapons are large next to the tiny figures; draw them smaller. */
export const WEAPON_SCALE = 0.6;
/** The melee swing of a pack figure lasts this long (s). */
export const MELEE_T = 0.18;
const HALF_PI = Math.PI / 2;

export interface ViewState {
  x: number;
  y: number;
  anim: number;
  /** Seconds since the current animation started. */
  animT: number;
  aim: number;
  flags: number;
  /** The real arc (rad) of the own hero's melee swing, when it is known; otherwise the figure's fixed one. */
  swingArc?: number;
  /** Bitmask of `EffectKind` ids on the creature. */
  effects?: number;
  /** The entity id: figures that pulse (`FigureDef.pulse`) take their phase from it. */
  id?: number;
  /** A party hero (drawn faintly, not hidden, while Invisible). */
  party?: boolean;
  /** The look of its Entangled effect (`lookOf`); Plain when absent. */
  entangled?: number;
  /** Pixels the figure stands below a surface (wading in water or lava). */
  sink?: number;
  /** Falling into a chasm, 0..1: the figure shrinks a little and vanishes into the dark. */
  fall?: number;
  /** Sinking in deep water, 0..1: the figure goes down below the surface. */
  drown?: number;
}

export interface PoseInput extends ViewState {
  /** The aim as it appears on screen (rad, y down). 2D: = aim. 3D: from the yaw. Facing and weapon angles use it; steps along the aim use `aim`. */
  screenAim: number;
}

/** A frame's opaque bounds and its size (px). */
export interface FrameBounds extends Bounds {
  w: number;
  h: number;
}

export interface PoseMemory {
  clock: number;
  runClock: number;
  speed: number;
  lastX: number;
  lastY: number;
  left: boolean;
  /** Set after the first pose (a figure that appears asleep or as stone still takes its facing once). */
  faced: boolean;
  /** Petrified or frozen: the body frame it was turned to stone (or ice) in. */
  heldFrame: string | null;
  /** Frozen: the weapon pose is made once, then held. */
  heldWeapon: WeaponPose | null;
  /** Seconds left of the fade-in after reappearing. */
  appearLeft: number;
  /** Seconds until the next dash afterimage. */
  afterT: number;
}

export function newPoseMemory(): PoseMemory {
  return { clock: 0, runClock: 0, speed: 0, lastX: 0, lastY: 0, left: false, faced: false, heldFrame: null, heldWeapon: null, appearLeft: 0, afterT: 0 };
}

export interface WeaponPose {
  frame: string;
  scale: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  rot: number;
  alpha: number;
  flipX: boolean;
  /** Drawn behind the body (aiming up the screen). */
  behind: boolean;
  tint: number | null;
}

export type Tint = { mode: 'none' } | { mode: 'mul' | 'fill'; rgb: number };

export interface Pose {
  /** false when FLAG.DEAD. */
  visible: boolean;
  frame: string;
  left: boolean;
  /** 0..1 (the hips, mirrored). */
  originX: number;
  /** Frame row of the feet. */
  footY: number;
  /** def.scale * (1 - fall * 0.2). */
  scale: number;
  /** In the card's plane, frame px, y down: shiver, cast bob, lift, attack tilt (deg), dash stretch. */
  body: { x: number; y: number; angle: number; sx: number; sy: number };
  /** World px along the aim: the melee step and the lunge (2D adds it to body x / y). */
  aimStep: { x: number; y: number };
  /** Px cut from the bottom and sunk. */
  sink: number;
  /** Px the figure goes down while falling. */
  drop: number;
  lie: null | { angle: number; squash: number; cropX: number; cropW: number; x: number; y: number };
  tint: Tint;
  weaponTint: number | null;
  grey: boolean;
  silhouette: boolean;
  /** rootAlpha * figureAlpha. */
  alpha: number;
  /** entityAlpha (or silhouetteAlpha) * the fade-in: what the figure's root takes. */
  rootAlpha: number;
  /** The fade of a figure falling into a chasm. */
  figureAlpha: number;
  shadow: { visible: boolean; sx: number; sy: number };
  /** null asleep, unarmed, or drowned past 0.4. */
  weapon: WeaponPose | null;
  /** The weapon was posed afresh this frame (not held, not asleep): its sparks may fire. */
  weaponFresh: boolean;
  /** A dash afterimage is due this frame (every 0.03 s, not during an own-frames wind-up). */
  afterimage: boolean;
}

/** Multiplies a tint colour channel-wise by `k` and blends it towards `to`. */
export function shade(k: number, to: number, mix: number): number {
  const ch = (s: number) => Math.round(255 * k * (1 - mix) + ((to >> s) & 255) * mix) << s;
  return ch(16) | ch(8) | ch(0);
}

/** Horizontal origin of the body: the hips for figures not centred in their frames (`hipX`, mirrored when facing left). */
export function originXOf(d: FigureDef, w: number, left: boolean): number {
  if (d.hipX === undefined) return 0.5;
  return (left ? w - d.hipX - 0.5 : d.hipX + 0.5) / w;
}

/** The pose of a dead figure: nothing is drawn. */
function hidden(d: FigureDef, m: PoseMemory): Pose {
  return {
    visible: false,
    frame: `${d.idle}0`,
    left: m.left,
    originX: 0.5,
    footY: d.footY ?? 16,
    scale: d.scale ?? 1,
    body: { x: 0, y: 1, angle: 0, sx: 1, sy: 1 },
    aimStep: { x: 0, y: 0 },
    sink: 0,
    drop: 0,
    lie: null,
    tint: { mode: 'none' },
    weaponTint: null,
    grey: false,
    silhouette: false,
    alpha: 1,
    rootAlpha: 1,
    figureAlpha: 1,
    shadow: { visible: false, sx: 1, sy: 1 },
    weapon: null,
    weaponFresh: false,
    afterimage: false,
  };
}

export function figurePose(d: FigureDef, s: PoseInput, dt: number, m: PoseMemory, bounds: (frame: string) => FrameBounds): Pose {
  m.clock += dt;
  const moved = Math.hypot(s.x - m.lastX, s.y - m.lastY);
  m.speed = m.speed * 0.8 + (dt > 0 ? moved / dt : 0) * 0.2;
  m.lastX = s.x;
  m.lastY = s.y;
  if ((s.flags & FLAG.DEAD) !== 0) return hidden(d, m);

  const fxBits = s.effects ?? 0;
  const asleep = has(fxBits, EFFECT.Sleep);
  const stone = has(fxBits, EFFECT.Petrified);
  const slowed = has(fxBits, EFFECT.Slowed);
  const iced = has(fxBits, EFFECT.Frozen);
  const poisoned = has(fxBits, EFFECT.Poisoned);
  const chilled = has(fxBits, EFFECT.Chilled);
  const tainted = has(fxBits, EFFECT.Tainted);
  if (!iced) m.heldWeapon = null;

  // Facing follows the aim. TODO(4-dir): pick up/down sheets here once they exist.
  const cos = Math.cos(s.screenAim);
  // Lying asleep, turned to stone or frozen, the figure keeps the side it faces (the own hero's aim still follows the mouse).
  if (Math.abs(cos) > 0.15 && (!(asleep || stone || iced) || !m.faced)) m.left = cos < 0;
  m.faced = true;
  const left = m.left;
  const sgn = left ? -1 : 1;

  // ---- body: pack idle/run/hit frames ----
  const hurt = (s.flags & FLAG.HURT) !== 0;
  const moving = s.anim === ANIM.Move || s.anim === ANIM.Dash || m.speed > 8;
  // Slowed: the legs run at half pace; accelerated: half as fast again; chilled: at 0.7 (the move speed it has).
  const pace = (slowed ? 0.5 : has(fxBits, EFFECT.Accelerated) ? 1.5 : 1) * (chilled ? 0.7 : 1);
  if (moving) m.runClock += dt * Math.min(Math.max(m.speed / 40, 0.7), 2) * pace;
  const own = d.frames ? pickFrame(d, s, m.clock, m.runClock, moving) : null;
  let frame: string;
  if (own) frame = own.frame;
  else if (hurt && d.hit) frame = d.hit;
  else if (moving) frame = `${d.run}${Math.floor(m.runClock * 10) % 4}`;
  else frame = `${d.idle}${Math.floor(m.clock * 6) % 4}`;
  // Petrified or frozen: the figure keeps the frame it was turned to stone (or ice) in.
  if (stone || iced) frame = m.heldFrame ??= frame;
  else m.heldFrame = null;
  const fb = bounds(frame);
  const fw = fb.w;
  const originX = originXOf(d, fw, left);
  // Flying: the body rises above its shadow, which shrinks a little.
  const lift = own?.lift ?? 0;
  let bx = 0;
  let by = 1 - Math.round(lift * (d.lift ?? 0));
  let angle = 0;
  let sx = 1;
  let sy = 1;
  // Wading: the feet go below the surface (the body is cut off there).
  // Drowning: the figure sinks until it is fully below the surface.
  const fall = s.fall ?? 0;
  const drown = s.drown ?? 0;
  const foot = d.footY ?? fb.h;
  const sink = Math.min(foot, Math.round((s.sink ?? 0) + drown * (foot + 2)));
  const scale = (d.scale ?? 1) * (1 - fall * 0.2);
  const figureAlpha = fall > 0.7 ? 1 - (fall - 0.7) / 0.3 : 1;

  // The ambush wind-up of a silhouette figure (the Shade): a flat dark shape, no eyes, fainter than the real thing.
  const silhouette = !!d.silhouette && s.anim === ANIM.Ambush;
  let tint: Tint;
  if (hurt && !d.hit && Math.floor(m.clock * 30) % 2 === 0) tint = { mode: 'fill', rgb: 0xffffff };
  else if (silhouette) tint = { mode: 'fill', rgb: SILHOUETTE_FILL };
  else if (!stone && !iced && (s.anim === ANIM.Windup || s.anim === ANIM.Slam || own?.windup)) {
    // Telegraph: flashing red (the lich: pale purple gloom) and a shiver before the blow lands.
    tint = { mode: 'mul', rgb: Math.floor(m.clock * 16) % 2 ? (d.slam?.gloom ? 0xc890ff : 0xff8080) : (d.tint ?? 0xffffff) };
    bx = Math.floor(m.clock * 40) % 2 ? 1 : -1;
    if (own) by += Math.floor(m.clock * 40) % 2;
  } else if (poisoned) tint = { mode: 'mul', rgb: shade(1, 0x9be37a, 0.5 + 0.5 * Math.sin(m.clock * Math.PI * 3)) };
  else if (slowed) tint = { mode: 'mul', rgb: 0xa0c8ff };
  else if (chilled) tint = { mode: 'mul', rgb: 0xd8ecff };
  else if (tainted) tint = { mode: 'mul', rgb: shade(1, 0x9be37a, 0.3 * (0.5 + 0.5 * Math.sin(m.clock * Math.PI * 2))) };
  else if (d.tint) tint = { mode: 'mul', rgb: d.tint };
  else tint = { mode: 'none' };
  // Into the dark (chasm) or the deep (water): the figure darkens as it goes.
  if (fall > 0) tint = { mode: 'mul', rgb: shade(1 - fall * 0.95, 0, 0) };
  else if (drown > 0) tint = { mode: 'mul', rgb: shade(1, 0x243f4c, Math.min(1, drown * 1.5)) };
  const weaponTint = fall > 0 ? shade(1 - fall * 0.95, 0, 0) : (d.weaponTint ?? null);

  let shadowSx = 1 - 0.3 * lift;
  let shadowSy = shadowSx;
  // Asleep: lying on the floor towards the facing, the side on the floor cut
  // off so the body rests on the ground, the shadow stretched under it.
  let lie: Pose['lie'] = null;
  if (asleep) {
    const lp = lyingPose(foot, left);
    const cut = d.lieCrop ?? lp.cropBottom;
    // After ±90° the frame's side edge faces the floor (the crop is in display space, after the flip):
    // its right edge falling right (90°), its left edge falling left (-90°). The squash is on the
    // frame's x axis, which is the vertical one once the body is turned.
    const lay = lieLayout(fb, fw, foot, originX * fw, left, cut, lp.squash);
    lie = { angle: lp.angle, squash: lp.squash, ...lay };
    bx = lay.x;
    by = lay.y;
    angle = lp.angle;
    sx = lp.squash;
    sy = 1;
    shadowSx = 1.6;
    shadowSy = 1;
  }

  const appearLeft = Math.max(0, m.appearLeft - dt);
  m.appearLeft = appearLeft;
  // A pulsing figure (the Ghost) blinks during its ambush wind-up (PhaserRunView skips the fade-in then).
  const ghost = d.pulse ? { t: m.clock, phase: ghostPhase(s.id ?? 0), ambushT: s.anim === ANIM.Ambush ? s.animT : null } : undefined;
  const appear = appearFactor(appearLeft, VANISH_SECS);
  const rootAlpha = (silhouette ? silhouetteAlpha(s.animT) : entityAlpha(s.flags, fxBits, s.party ?? false, ghost, d.incorporealAlpha)) * appear;

  const ax = Math.cos(s.aim);
  const ay = Math.sin(s.aim);
  const t = s.animT;
  const step = { x: 0, y: 0 };
  let afterimage = false;

  // ---- body moves for attacks (the pack has no attack frames); none asleep, turned to stone or frozen ----
  const still = asleep || stone || iced;
  if (!still) switch (s.anim) {
    case ANIM.Melee:
    case ANIM.Tail: {
      const tail = s.anim === ANIM.Tail;
      // Own frames: the strike comes after the wind-up, drawn by the frames.
      if (t < windupOf(d, s.anim)) break;
      if (!own) {
        const k = Math.min(t / MELEE_T, 1);
        step.x += ax * (tail ? -3 : 3) * (1 - k);
        step.y += ay * 1.5 * (1 - k);
        angle = sgn * 8 * Math.sin(k * Math.PI);
      }
      // Darting toward the aim over the first 0.15 s, out and back (the wolf's bite).
      if (d.lunge && !tail) {
        const lk = Math.sin(Math.min(t / 0.15, 1) * Math.PI);
        step.x += ax * d.lunge * lk;
        step.y += ay * d.lunge * lk;
      }
      break;
    }
    case ANIM.Cast:
    case ANIM.Channel:
      if (!own) by -= Math.sin(m.clock * 12) > 0 ? 1 : 0;
      break;
    case ANIM.Breath:
      if (!own) angle = sgn * -6;
      break;
    case ANIM.Dash:
      // Own frames draw the charge (and its wind-up); pack figures stretch.
      if (!own) {
        sx = 1.25;
        sy = 0.9;
      }
      m.afterT -= dt;
      if (m.afterT <= 0 && !own?.windup) {
        m.afterT = 0.03;
        afterimage = true;
      }
      break;
  }

  // ---- weapon ----
  // Frozen: the weapon stays as it was when the ice took hold (posed once, then held).
  let weapon: WeaponPose | null = null;
  const weaponFresh = !!d.weapon && !asleep && !(iced && m.heldWeapon);
  if (weaponFresh) {
    weapon = weaponPose(d, s, sgn, left, weaponTint);
    if (iced) m.heldWeapon = weapon;
  } else if (d.weapon && !asleep) weapon = m.heldWeapon;
  // Drowned past 0.4 the weapon is hidden (a fresh pose still counts, as its sparks fire as before).
  if (drown >= 0.4) weapon = null;

  return {
    visible: true,
    frame,
    left,
    originX,
    footY: foot,
    scale,
    body: { x: bx, y: by, angle, sx, sy },
    aimStep: step,
    sink,
    drop: Math.round(fall * 6),
    lie,
    tint,
    weaponTint,
    grey: stone,
    silhouette,
    alpha: rootAlpha * figureAlpha,
    rootAlpha,
    figureAlpha,
    shadow: { visible: sink === 0 && fall === 0, sx: shadowSx, sy: shadowSy },
    weapon,
    weaponFresh,
    afterimage,
  };
}

/** The weapon's frame, size, origin, position, rotation and alpha for the figure's mount. */
function weaponPose(d: FigureDef, s: PoseInput, sgn: number, left: boolean, tint: number | null): WeaponPose {
  const t = s.animT;
  const isMelee = s.anim === ANIM.Melee;
  const hx = (d.handX ?? 3) * sgn;
  const ax = Math.cos(s.screenAim);
  const ay = Math.sin(s.screenAim);
  let alpha = 1;
  let rot = 0;
  let ox = 0;
  let oy = 0;
  let originX = 0.5;
  let originY = 0.5;
  let flipX = false;
  switch (d.mount) {
    case 'blade': {
      // Pack blades point up; aim them at the cursor. The swing itself is a
      // swoosh drawn at the real damage reach: the weapon fades out at the
      // start position and fades back in at the end position.
      originY = 0.85;
      rot = s.screenAim + HALF_PI;
      if (isMelee && d.swing) {
        const k = Math.min(t / MELEE_T, 1);
        // A full-circle swing (Whirl) sweeps all the way round.
        const arc = s.swingArc ?? d.swing.arc;
        const half = Math.min(arc, Math.PI * 2) / 2;
        if (k < 0.5) {
          rot -= sgn * half;
          alpha = Math.max(0, 1 - k / 0.2);
        } else {
          rot += sgn * half;
          alpha = Math.min(1, Math.max(0, (k - 0.7) / 0.3));
        }
      } else if (s.anim === ANIM.Windup) rot -= sgn * 1.6;
      else if (s.anim === ANIM.Slam) {
        // Ground slam: the club goes up over the head, then comes down at the impact.
        const k = Math.min(t / 0.3, 1);
        rot = -sgn * 0.5 * k;
        oy = -6 * k;
        ox = -hx * 0.6 * k;
      }
      flipX = left;
      break;
    }
    case 'bow': {
      rot = s.screenAim;
      if (isMelee && d.meleeWeapon) {
        // Ranger rapier thrust: along the aim, not a swing.
        originY = 0.85;
        rot = s.screenAim + HALF_PI;
        const k = Math.min(t / 0.15, 1);
        ox = ax * 5 * Math.sin(k * Math.PI);
        oy = ay * 5 * Math.sin(k * Math.PI);
      } else if (s.anim === ANIM.Shoot) {
        const k = Math.min(t / 0.12, 1);
        ox = -ax * 3 * (1 - k);
        oy = -ay * 3 * (1 - k);
      } else if (s.anim === ANIM.Windup) {
        ox = -ax * 2;
        oy = -ay * 2;
      }
      break;
    }
    case 'staff': {
      // Held upright, leaning toward the aim; thrust forward when casting.
      originY = 0.75;
      rot = sgn * 0.25;
      if (s.anim === ANIM.Cast || s.anim === ANIM.Shoot || s.anim === ANIM.Windup || s.anim === ANIM.Channel) {
        const k = Math.min(t / 0.25, 1);
        rot = sgn * 0.25 + (s.screenAim + HALF_PI - sgn * 0.25) * Math.sin(k * Math.PI) * 0.6;
      } else if (s.anim === ANIM.Slam) {
        // Nova wind-up: the staff held high.
        rot = 0;
        oy = -4;
      }
      break;
    }
  }
  return {
    frame: isMelee && d.meleeWeapon ? d.meleeWeapon : d.weapon!,
    scale: WEAPON_SCALE * ((isMelee && d.meleeWeapon ? d.meleeWeaponScale : undefined) ?? d.weaponScale ?? 1),
    originX,
    originY,
    x: hx + ox,
    y: -d.handY + oy,
    rot,
    alpha,
    flipX,
    behind: ay < -0.3,
    tint,
  };
}
