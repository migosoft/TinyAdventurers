import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, FLAG, KIND } from '../../generated/defs';
import { FIGURES, type FigureDef } from '../../game/anim/defs';
import { MELEE_T, type ViewState } from '../../game/anim/pose';
import { BONES, MAX_BONES, buildFigure, type FigureModel } from './model';
import { ATTACK_IN_SECS, GAIT, HIT_SECS, LIE_SINK, SLAM_DEFAULT_SECS, TURN_RATE, copyPose, newPose3dMemory, poseFigure, restPose, sideReach, type Pose3d, type Pose3dMemory } from './pose3d';
import { skinVertex } from './rig';
import { DESCS, type DescKey } from './table';

const SLOW = 120000;
const KIND_OF: Record<DescKey, number> = { elf: KIND.ElvenRanger, knight: KIND.Paladin, wizard: KIND.Wizard, dwarf: KIND.Barbarian, skelet: KIND.SkeletonWarrior, ogre: KIND.Ogre, wolf: KIND.DireWolf };
const KEYS = Object.keys(DESCS) as DescKey[];
// Building a figure takes a while: each is built once for the whole file.
const memo = new Map<DescKey, FigureModel>();
const model = (k: DescKey): FigureModel => {
  let m = memo.get(k);
  if (!m) memo.set(k, (m = buildFigure(k, DESCS[k])));
  return m;
};
const def = (k: DescKey): FigureDef => FIGURES[KIND_OF[k]];
const view = (o: Partial<ViewState> = {}): ViewState => ({ x: 0, y: 0, anim: ANIM.Idle, animT: 0, aim: 0, flags: 0, ...o });
/** A memory of a figure that has been standing for a while, heading 0. */
const settled = (o: Partial<Pose3dMemory> = {}): Pose3dMemory => ({ ...newPose3dMemory(), faced: true, ...o });
const bone = (name: (typeof BONES)[number]): number => BONES.indexOf(name);
const pivot = (m: FigureModel, name: (typeof BONES)[number]): [number, number, number] => {
  const b = bone(name);
  return [m.pivots[b * 3], m.pivots[b * 3 + 1], m.pivots[b * 3 + 2]];
};
const apply = (p: Pose3d, b: number, v: [number, number, number]): [number, number, number] => {
  const o = b * 12;
  return [0, 1, 2].map((r) => p.bones[o + r * 4] * v[0] + p.bones[o + r * 4 + 1] * v[1] + p.bones[o + r * 4 + 2] * v[2] + p.bones[o + r * 4 + 3]) as [number, number, number];
};
/** Where a hand's centre is, in model space. */
const hand = (m: FigureModel, p: Pose3d, side: 'R' | 'L'): [number, number, number] => {
  const q = pivot(m, `hand${side}`);
  return apply(p, bone(`hand${side}`), [q[0], q[1] + m.handY, q[2]]);
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const isIdentity = (p: Pose3d, b: number): boolean => identity.every((e, k) => Math.abs(p.bones[b * 12 + k] - e) < 1e-6);

describe('the standing pose', () => {
  it('stays on the ground with only the breathing moving', () => {
    for (const k of ['skelet', 'wolf'] as DescKey[]) {
      const m = model(k), d = def(k), mem = settled({ clock: 0.6 });
      const p = poseFigure(m, d, view(), 1 / 60, mem);
      expect(p.air, k).toBe(0);
      expect(p.root.y, k).toBe(0);
      expect(p.root.roll, k).toBe(0);
      for (const leg of ['leg0', 'leg1', 'leg2', 'leg3'] as const) expect(isIdentity(p, bone(leg)), `${k} ${leg}`).toBe(true);
      expect(isIdentity(p, bone('hips')), k).toBe(true);
      // The body breathes: its matrix is not the identity, but its feet pivot does not move in y.
      expect(isIdentity(p, bone('body')), k).toBe(false);
      const pv = pivot(m, 'body');
      expect(apply(p, bone('body'), pv)[1]).toBeCloseTo(pv[1], 5);
    }
  }, SLOW);
});

describe('the skip', () => {
  it('hops 2.4 sprite px at the top of a step and is on the ground at the landing', () => {
    const m = model('skelet'), d = def('skelet');
    const up = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 2 }));
    expect(up.root.y).toBeCloseTo(2.4 * GAIT.bounce * m.scale, 5);
    expect(up.air).toBeCloseTo(1, 5);
    const down = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 0 }));
    expect(down.root.y).toBeCloseTo(0, 5);
    expect(down.air).toBeCloseTo(0, 5);
  }, SLOW);

  it('swings the two legs against each other', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 4 }));
    // Element 4 of a bone matrix is sin of the turn about z.
    const a = p.bones[bone('leg0') * 12 + 4], b = p.bones[bone('leg1') * 12 + 4];
    expect(Math.abs(a)).toBeGreaterThan(0.1);
    expect(a).toBeCloseTo(-b, 5);
  }, SLOW);

  it('blends in over about 0.2 s and out again', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    for (let i = 0; i < 6; i++) poseFigure(m, d, view({ anim: ANIM.Move, x: i * 2 }), 1 / 60, mem);
    expect(mem.walk).toBeGreaterThan(0.3);
    expect(mem.walk).toBeLessThan(0.9);
    for (let i = 0; i < 60; i++) poseFigure(m, d, view({ anim: ANIM.Idle, x: 12 }), 1 / 60, mem);
    expect(mem.walk).toBeLessThan(0.02);
    expect(mem.phi).toBe(0);
  }, SLOW);
});

describe('the bound', () => {
  it('moves the front pair and the hind pair each together, and pitches nose up after take-off', () => {
    const m = model('wolf'), d = def('wolf');
    expect(m.quad).toBe(true);
    const p = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: 0 }));
    const r = (n: 0 | 1 | 2 | 3): number => p.bones[bone(`leg${n}` as (typeof BONES)[number]) * 12 + 4];
    expect(Math.abs(r(0))).toBeGreaterThan(0.1);
    expect(r(0)).toBeCloseTo(r(1), 5);
    expect(r(2)).toBeCloseTo(r(3), 5);
    expect(r(0)).toBeCloseTo(-r(2), 5);
    const q = poseFigure(m, d, view({ anim: ANIM.Move }), 0, settled({ walk: 1, phi: Math.PI / 4 }));
    expect(q.bones[bone('body') * 12 + 4]).toBeGreaterThan(0.05);   // sin(pitch) with pitch > 0
  }, SLOW);
});

describe('facing', () => {
  it('turns the short way, never faster than TURN_RATE', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled({ yaw: 0 }), dt = 1 / 60;
    let last = 0;
    for (let i = 0; i < 90; i++) {
      poseFigure(m, d, view({ anim: ANIM.Windup, aim: 3 }), dt, mem);
      const step = mem.yaw - last;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(TURN_RATE * dt + 1e-9);
      last = mem.yaw;
    }
    expect(mem.yaw).toBeCloseTo(3, 5);
  }, SLOW);

  it('goes the short way round the back', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled({ yaw: 3 });
    poseFigure(m, d, view({ anim: ANIM.Windup, aim: -3 }), 1 / 60, mem);
    // From 3 to -3 the short way is through pi (0.28 rad), not back through 0: one step on, wrapped into (-pi, pi].
    expect(mem.yaw).toBeCloseTo(3 + TURN_RATE / 60 - 2 * Math.PI, 6);
  }, SLOW);

  it('walks towards where it goes', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    for (let i = 1; i <= 40; i++) poseFigure(m, d, view({ anim: ANIM.Move, x: 0, y: i * 2, aim: 0 }), 1 / 60, mem);
    expect(mem.yaw).toBeCloseTo(Math.PI / 2, 3);
  }, SLOW);

  it('takes the aim at once on the first pose, and keeps it while standing', () => {
    const m = model('skelet'), d = def('skelet'), mem = newPose3dMemory();
    const p = poseFigure(m, d, view({ aim: 1.2 }), 1 / 60, mem);
    expect(p.yaw).toBeCloseTo(1.2, 6);
    expect(poseFigure(m, d, view({ aim: -2 }), 1 / 60, mem).yaw).toBeCloseTo(1.2, 6);
  }, SLOW);
});

describe('attacks', () => {
  it('swings the right arm out in front at half the sweep', () => {
    const m = model('knight'), d = def('knight');
    const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2 }), 0, settled());
    expect(p.attack?.style).toBe('swing');
    const h = hand(m, p, 'R'), rest = pivot(m, 'handR');
    expect(h[0]).toBeGreaterThan(rest[0] + 0.5);
    expect(p.attack!.u).toBeGreaterThan(0);
  }, SLOW);

  it('bites with the wolf and darts d.lunge px forward', () => {
    const m = model('wolf'), d = def('wolf');
    expect(m.armLength).toBe(0);
    const p = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075 }), 0, settled());
    expect(p.attack?.style).toBe('bite');
    expect(p.root.x).toBeCloseTo(d.lunge!, 5);
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.3 }), 0, settled()).root.x).toBeCloseTo(0, 5);
  }, SLOW);

  it('shoots with the ranger holding the bow in the left arm', () => {
    const m = model('elf'), d = def('elf');
    const p = poseFigure(m, d, view({ anim: ANIM.Shoot, animT: 0.05 }), 0, settled());
    expect(p.attack?.style).toBe('shot');
    const l = hand(m, p, 'L'), restL = pivot(m, 'handL');
    expect(l[0]).toBeGreaterThan(restL[0] + 3);
    const idle = poseFigure(m, d, view(), 0, settled());
    expect(l[0]).toBeGreaterThan(hand(m, idle, 'L')[0] + 3);
  }, SLOW);

  it('casts with the wizard', () => {
    const m = model('wizard'), d = def('wizard');
    const p = poseFigure(m, d, view({ anim: ANIM.Cast, animT: 0.05 }), 0, settled());
    expect(p.attack?.style).toBe('cast');
    expect(hand(m, p, 'R')[0]).toBeGreaterThan(pivot(m, 'handR')[0] + 2);
  }, SLOW);

  it('ends the attack once its time is up', () => {
    const m = model('knight'), d = def('knight');
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 2 }), 0, settled()).attack).toBeNull();
  }, SLOW);

  it('moves the root by the game\'s scale, as the card scales its steps: a scaled creature lunges and shivers as far as its card', () => {
    const m = model('wolf'), d = { ...def('wolf'), scale: 2 };
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075 }), 0, settled()).root.x).toBeCloseTo(2 * def('wolf').lunge!, 5);
    const k = model('knight');
    const a = poseFigure(k, { ...def('knight'), scale: 1.5 }, view({ anim: ANIM.Windup }), 0, settled({ clock: 0 }));
    expect(Math.abs(a.root.z)).toBeCloseTo(1.5, 6);
    // the fall shrink the card has in its scale too
    const f = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.075, fall: 0.5 }), 0, settled());
    expect(f.root.x).toBeCloseTo(2 * 0.9 * def('wolf').lunge!, 5);
  }, SLOW);

  it('holds the wound-up pose in a wind-up, shivering and leaning back, without an attack for the effects', () => {
    const m = model('knight'), d = def('knight');
    const a = poseFigure(m, d, view({ anim: ANIM.Windup }), 0, settled({ clock: 0 }));
    const b = poseFigure(m, d, view({ anim: ANIM.Windup }), 0, settled({ clock: 0.03 }));
    expect(a.attack).toBeNull();
    expect(Math.abs(a.root.z)).toBe(1);
    expect(b.root.z).toBe(-a.root.z);
    expect(a.bones[bone('body') * 12 + 4]).toBeGreaterThan(0.05);   // leaning back: turned anticlockwise about z
  }, SLOW);

  it('fits the slam to the ogre\'s own slam time: raised by 0.75 t, smashed down at t, held down after', () => {
    const m = model('ogre'), d = def('ogre'), t = d.slam!.t;
    expect(t).toBeGreaterThan(0);
    const at = (animT: number): Pose3d => poseFigure(m, d, view({ anim: ANIM.Slam, animT }), 0, settled());
    for (const side of ['R', 'L'] as const) {
      const shoulder = pivot(m, `arm${side}`)[1];
      expect(hand(m, at(0.5 * t), side)[1], `raised at 0.5 t ${side}`).toBeGreaterThan(shoulder);
      expect(hand(m, at(0.75 * t), side)[1], `up at 0.75 t ${side}`).toBeGreaterThan(shoulder + 2);
      expect(hand(m, at(t), side)[1], `down at t ${side}`).toBeLessThan(shoulder);
      expect(hand(m, at(2 * t), side)[1], `held down ${side}`).toBeCloseTo(hand(m, at(t), side)[1], 4);
    }
  }, SLOW);

  it('without a slam time in the description, takes SLAM_DEFAULT_SECS', () => {
    const m = model('ogre'), d = { ...def('ogre'), slam: undefined };
    const p = poseFigure(m, d, view({ anim: ANIM.Slam, animT: SLAM_DEFAULT_SECS }), 0, settled());
    expect(hand(m, p, 'R')[1]).toBeLessThan(pivot(m, 'armR')[1]);
  }, SLOW);

  it('runs a swing\'s sweep in MELEE_T and its return in MELEE_T', () => {
    const m = model('knight'), d = def('knight');
    const u = (animT: number): number | undefined => poseFigure(m, d, view({ anim: ANIM.Melee, animT }), 0, settled()).attack?.u;
    expect(u(0)).toBeCloseTo(0.2, 6);
    expect(u(MELEE_T)).toBeCloseTo(0.56, 6);
    expect(u(1.5 * MELEE_T)).toBeCloseTo(0.78, 6);
    expect(u(2 * MELEE_T - 1e-6)).toBeGreaterThan(0.999);
    expect(poseFigure(m, d, view({ anim: ANIM.Melee, animT: 2 * MELEE_T }), 0, settled()).attack).toBeNull();
  }, SLOW);

  it('blends an attack in over ATTACK_IN_SECS after idling, but not after a wind-up', () => {
    const m = model('knight'), d = def('knight');
    const rest = pivot(m, 'handR');
    const idleHand = hand(m, poseFigure(m, d, view(), 0, settled()), 'R');
    const cold = (animT: number): [number, number, number] => hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT }), 0, settled()), 'R');
    // After idling: at animT 0 the arm is at rest, at ATTACK_IN_SECS it is on the full curve.
    cold(0).forEach((v, i) => expect(v).toBeCloseTo(idleHand[i], 4));
    const mem = settled({ woundUp: true });
    const full = (animT: number): [number, number, number] => hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT }), 0, mem), 'R');
    cold(ATTACK_IN_SECS).forEach((v, i) => expect(v).toBeCloseTo(full(ATTACK_IN_SECS)[i], 4));
    // Half-way it is between the two.
    const mid = cold(ATTACK_IN_SECS / 2), f = full(ATTACK_IN_SECS / 2);
    expect(Math.hypot(mid[0] - f[0], mid[1] - f[1], mid[2] - f[2])).toBeGreaterThan(0.1);
    // After a wind-up frame the first Melee frame is the full curve, and the memory keeps it so.
    const wm = settled();
    poseFigure(m, d, view({ anim: ANIM.Windup }), 0, wm);
    const first = hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), 0, wm), 'R');
    const ref = full(0);
    first.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 5));
    expect(Math.abs(first[0] - idleHand[0]) + Math.abs(first[1] - idleHand[1]) + Math.abs(first[2] - idleHand[2])).toBeGreaterThan(0.5);
    expect(rest).toBeDefined();
    // It goes back to blending once the figure has done something else.
    poseFigure(m, d, view(), 0, wm);
    hand(m, poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0 }), 0, wm), 'R').forEach((v, i) => expect(v).toBeCloseTo(idleHand[i], 4));
  }, SLOW);

  it('freezes a figure in its swing: the pose of the frame the ice began in, attack and all', () => {
    const m = model('knight'), d = def('knight'), mem = settled();
    const a = poseFigure(m, d, view({ anim: ANIM.Melee, animT: MELEE_T / 2, effects: 1 << EFFECT.Frozen }), 1 / 60, mem);
    expect(hand(m, a, 'R')[0]).toBeGreaterThan(pivot(m, 'handR')[0] + 0.5);
    const hx = hand(m, a, 'R');
    const b = poseFigure(m, d, view({ anim: ANIM.Idle, effects: 1 << EFFECT.Frozen }), 0.5, mem);
    hand(m, b, 'R').forEach((v, i) => expect(v).toBeCloseTo(hx[i], 6));
    expect(b.attack).toEqual(a.attack);
  }, SLOW);

  it('writes the same pose object each call (owned by the memory) and copyPose keeps one', () => {
    const m = model('wizard'), d = def('wizard'), mem = settled();
    const a = poseFigure(m, d, view({ anim: ANIM.Move, x: 2 }), 1 / 60, mem);
    const kept = copyPose(a);
    const b = poseFigure(m, d, view({ anim: ANIM.Cast, animT: 0.05, x: 4 }), 1 / 60, mem);
    expect(b).toBe(a);
    expect(kept.bones).not.toEqual(b.bones);
    expect(kept.attack).toBeNull();
    const into = copyPose(b, kept);
    expect(into).toBe(kept);
    expect(kept.bones).toEqual(b.bones);
    expect(kept.attack).toEqual(b.attack);
    expect(kept.attack).not.toBe(b.attack);
  }, SLOW);

  it('stretches the dash along the heading', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ anim: ANIM.Dash }), 1 / 60, settled());
    expect(p.root.sx).toBeCloseTo(1.25, 6);
    expect(p.root.sy).toBeCloseTo(0.9, 6);
  }, SLOW);
});

describe('hit', () => {
  it('jolts back from the heading, is done after HIT_SECS and does not start again while the flag is held', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    const first = poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem);
    expect(first.root.x).toBeLessThan(0);
    let frames = 1, min = first.root.x, last = first;
    for (; frames * (1 / 60) < 0.3; frames++) { last = poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem); min = Math.min(min, last.root.x); }
    expect(min).toBeLessThan(-0.5);
    expect(last.root.x).toBe(0);
    for (let i = 0; i < 30; i++) expect(poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem).root.x).toBe(0);
    // Let go and hurt again: a second jolt.
    poseFigure(m, d, view(), 1 / 60, mem);
    expect(poseFigure(m, d, view({ flags: FLAG.HURT }), 1 / 60, mem).root.x).toBeLessThan(0);
    expect(HIT_SECS).toBeLessThan(0.3);
  }, SLOW);
});

describe('held and lying states', () => {
  it('keeps the pose of the frame the stone began in', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    const a = poseFigure(m, d, view({ effects: 1 << EFFECT.Petrified }), 1 / 60, mem);
    const b = poseFigure(m, d, view({ anim: ANIM.Move, x: 20, effects: 1 << EFFECT.Petrified }), 0.5, mem);
    expect(b.bones).toEqual(a.bones);
    expect(b.yaw).toBe(a.yaw);
    // When it wears off the figure moves again.
    const c = poseFigure(m, d, view(), 0.5, mem);
    expect(mem.held).toBeNull();
    expect(c.bones).not.toEqual(a.bones);
  }, SLOW);

  it('holds frozen figures too, hit or not', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    const a = poseFigure(m, d, view({ effects: 1 << EFFECT.Frozen }), 1 / 60, mem);
    const b = poseFigure(m, d, view({ anim: ANIM.Melee, animT: 0.1, flags: FLAG.HURT, effects: 1 << EFFECT.Frozen }), 0.3, mem);
    expect(b.bones).toEqual(a.bones);
    expect(b.root).toEqual(a.root);
  }, SLOW);

  it('holds the legs of an entangled figure and lets the rest idle', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled();
    for (let i = 0; i < 20; i++) poseFigure(m, d, view({ anim: ANIM.Move, x: i * 2, effects: 1 << EFFECT.Entangled }), 1 / 60, mem);
    const p = poseFigure(m, d, view({ anim: ANIM.Move, x: 40, effects: 1 << EFFECT.Entangled }), 1 / 60, mem);
    for (const leg of ['leg0', 'leg1'] as const) expect(isIdentity(p, bone(leg)), leg).toBe(true);
    expect(p.root.y).toBe(0);
  }, SLOW);

  it('lays a sleeping figure on its side on the ground', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ effects: 1 << EFFECT.Sleep }), 1 / 60, settled());
    expect(p.asleep).toBe(true);
    expect(p.root.roll).toBeCloseTo(Math.PI / 2, 6);
    // The root is lifted by the side reach, less the sink into the soft ground.
    expect(LIE_SINK).toBe(0.3);
    expect(p.root.y).toBeCloseTo(sideReach(m) * m.scale * (1 - LIE_SINK) * p.root.sy, 6);
    // The lowest point of the lying figure is below the ground by that sink.
    let low = Infinity;
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < m.position.length / 3; i++) if (m.skin[i * 4 + 1] === 0) { skinVertex(m, p, i, out); low = Math.min(low, out[1]); }   // not the outline hulls
    expect(low).toBeCloseTo(-sideReach(m) * m.scale * LIE_SINK * p.root.sy, 2);
  }, SLOW);

  it('shrinks a falling figure', () => {
    const m = model('skelet'), d = def('skelet');
    const p = poseFigure(m, d, view({ fall: 0.5 }), 1 / 60, settled());
    expect(p.root.sx).toBeCloseTo(0.9, 6);
    expect(p.root.sy).toBeCloseTo(0.9, 6);
    expect(p.root.sz).toBeCloseTo(0.9, 6);
  }, SLOW);

  it('flags a channelling figure', () => {
    const m = model('wizard'), d = def('wizard');
    const p = poseFigure(m, d, view({ anim: ANIM.Channel }), 1 / 60, settled());
    expect(p.channel).toBe(true);
    expect(p.attack).toBeNull();
  }, SLOW);
});

describe('finite', () => {
  it('has only finite numbers for every figure, step, animation and effect, from the first frame', () => {
    const anims = [ANIM.Idle, ANIM.Move, ANIM.Melee, ANIM.Shoot, ANIM.Cast, ANIM.Windup, ANIM.Slam, ANIM.Dash, ANIM.Channel, ANIM.Bite];
    const effects = [0, 1 << EFFECT.Sleep, 1 << EFFECT.Petrified, 1 << EFFECT.Frozen];
    for (const k of KEYS) {
      const m = model(k), d = def(k);
      for (const dt of [0, 1 / 60, 1]) for (const anim of anims) for (const fx of effects) for (const flags of [0, FLAG.HURT]) {
        const mem = newPose3dMemory();
        const p = poseFigure(m, d, view({ anim, effects: fx, flags, animT: dt, x: 3, y: -4, aim: 0, fall: 0.3 }), dt, mem);
        const all = [p.yaw, ...Object.values(p.root), ...p.bones, ...p.bends, ...p.robe, p.air, ...Object.values(mem).filter((v) => typeof v === 'number') as number[]];
        for (const v of all) expect(Number.isFinite(v), `${k} dt ${dt} anim ${anim} fx ${fx}`).toBe(true);
        expect(p.bones.length).toBe(MAX_BONES * 12);
        // A second frame from the same memory, moving.
        const q = poseFigure(m, d, view({ anim, effects: fx, flags, animT: dt, x: 3 + dt, y: -4, aim: 2 }), dt, mem);
        for (const v of [q.yaw, ...q.bones, ...q.bends]) expect(Number.isFinite(v), `${k} second`).toBe(true);
      }
    }
  }, SLOW);

  it('faces somewhere defined when a figure never moved (atan2(0, 0))', () => {
    const m = model('skelet'), d = def('skelet'), mem = settled({ yaw: 0.4 });
    const p = poseFigure(m, d, view({ anim: ANIM.Move }), 1 / 60, mem);
    expect(p.yaw).toBeCloseTo(0.4, 6);
  }, SLOW);
});

describe('purity', () => {
  it('gives the same output for the same memory copy and input', () => {
    const m = model('wizard'), d = def('wizard');
    const base = settled({ clock: 3.3, phi: 1.1, walk: 0.7, hitT: 0.05, wasHurt: true });
    const run = (): { p: Pose3d; mem: Pose3dMemory } => {
      const mem = structuredClone(base);
      return { p: poseFigure(m, d, view({ anim: ANIM.Cast, animT: 0.1, x: 5, flags: FLAG.HURT }), 1 / 60, mem), mem };
    };
    const a = run(), b = run();
    expect(b.p).toEqual(a.p);
    expect(b.mem).toEqual(a.mem);
  }, SLOW);
});

describe('restPose and skinVertex', () => {
  it('rests on the ground with identity bones, and moves no vertex but by the figure scale', () => {
    for (const k of ['wizard', 'wolf', 'elf'] as DescKey[]) {
      const m = model(k), p = restPose(m, 0.5);
      expect(p.yaw).toBe(0.5);
      expect(p.root).toEqual({ x: 0, y: 0, z: 0, roll: 0, sx: 1, sy: 1, sz: 1 });
      expect(p.attack).toBeNull();
      for (let b = 0; b < MAX_BONES; b++) expect(isIdentity(p, b), `${k} ${b}`).toBe(true);
      const out: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < m.position.length / 3; i += 7) {
        skinVertex(m, p, i, out);
        for (let a = 0; a < 3; a++) expect(out[a]).toBeCloseTo(m.position[i * 3 + a] * m.scale, 4);
      }
    }
  }, SLOW);

  it('bends a loose piece about its origin and swings a robe hem', () => {
    const m = model('wizard'), p = restPose(m, 0), out: [number, number, number] = [0, 0, 0];
    // The beard (a bend): find its tip vertex (along 1).
    let tip = -1, hem = -1;
    for (let i = 0; i < m.position.length / 3; i++) {
      if (m.skin[i * 4 + 2] >= 0 && m.skin[i * 4 + 3] > 0.99) tip = i;
      if (m.skin[i * 4 + 2] === -2 && m.skin[i * 4 + 3] > 0.99) hem = i;
    }
    expect(tip).toBeGreaterThanOrEqual(0);
    expect(hem).toBeGreaterThanOrEqual(0);
    const bi = m.skin[tip * 4 + 2];
    p.bends.set([0, 0, 1, 0.5], bi * 4);
    p.robe[0] = 2; p.robe[1] = -1;
    skinVertex(m, p, tip, out);
    const o = m.bends[bi].origin, v = [m.position[tip * 3] - o[0], m.position[tip * 3 + 1] - o[1]];
    // Turned 0.5 rad about z at the tip (along 1).
    expect(out[0] / m.scale).toBeCloseTo(o[0] + v[0] * Math.cos(0.5) - v[1] * Math.sin(0.5), 4);
    expect(out[1] / m.scale).toBeCloseTo(o[1] + v[0] * Math.sin(0.5) + v[1] * Math.cos(0.5), 4);
    skinVertex(m, p, hem, out);
    const w = m.skin[hem * 4 + 3];
    expect(out[0] / m.scale).toBeCloseTo(m.position[hem * 3] + 2 * w, 4);
    expect(out[2] / m.scale).toBeCloseTo(m.position[hem * 3 + 2] - 1 * w, 4);
  }, SLOW);
});
