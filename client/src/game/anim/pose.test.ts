import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, FLAG, KIND } from '../../generated/defs';
import { FIGURES } from './defs';
import { figurePose, newPoseMemory, type PoseInput, type PoseMemory } from './pose';
import { SILHOUETTE_FILL, silhouetteAlpha } from '../shadeHaze';

const bounds = () => ({ l: 3, r: 12, t: 4 });
const KNIGHT = FIGURES[KIND.Knight];
const PALADIN = FIGURES[KIND.Paladin];
const SHADE = FIGURES[KIND.Shade];

const input = (o: Partial<PoseInput> = {}): PoseInput => ({ x: 0, y: 0, anim: ANIM.Idle, animT: 0, aim: 0, screenAim: o.aim ?? 0, flags: 0, ...o });
const pose = (d = KNIGHT, o: Partial<PoseInput> = {}, dt = 0, m: PoseMemory = newPoseMemory()) => figurePose(d, input({ screenAim: o.aim ?? 0, ...o }), dt, m, bounds);

describe('figurePose', () => {
  it('idles by the clock and runs by the run clock', () => {
    const m = newPoseMemory();
    expect(pose(KNIGHT, {}, 0.2, m).frame).toBe(`${KNIGHT.idle}1`);
    const r = newPoseMemory();
    r.speed = 40;
    r.runClock = 0.25;
    expect(pose(KNIGHT, { anim: ANIM.Move }, 0, r).frame).toBe(`${KNIGHT.run}2`);
  });

  it('facing holds inside the dead zone', () => {
    const m = newPoseMemory();
    expect(pose(KNIGHT, { aim: Math.PI }, 0, m).left).toBe(true);
    expect(pose(KNIGHT, { aim: Math.PI / 2 }, 0, m).left).toBe(true);
  });

  it('asleep keeps the side it fell to', () => {
    const m = newPoseMemory();
    pose(KNIGHT, { aim: Math.PI }, 0, m);
    const p = pose(PALADIN, { aim: 0, effects: 1 << EFFECT.Sleep }, 0, m);
    expect(p.left).toBe(true);
    expect(p.lie!.angle).toBe(-90);
    expect(p.lie!.squash).toBe(0.92);
    expect(p.weapon).toBeNull();
    expect(p.shadow.sx).toBe(1.6);
  });

  it('petrified holds the frame and greys', () => {
    const m = newPoseMemory();
    const a = pose(KNIGHT, { effects: 1 << EFFECT.Petrified }, 0, m);
    const b = pose(KNIGHT, { effects: 1 << EFFECT.Petrified }, 1, m);
    expect(b.frame).toBe(a.frame);
    expect(b.grey).toBe(true);
  });

  it('frozen holds the weapon pose', () => {
    const m = newPoseMemory();
    const fx = 1 << EFFECT.Frozen;
    const a = pose(PALADIN, { aim: 0.3, effects: fx }, 0, m);
    const b = pose(PALADIN, { aim: 1.2, effects: fx }, 0, m);
    expect(a.weapon).not.toBeNull();
    expect(b.weapon!.rot).toBe(a.weapon!.rot);
  });

  it('hurt flash fills white without a hit frame; a hero with a hit frame shows it', () => {
    expect(pose(KNIGHT, { flags: FLAG.HURT }).tint).toEqual({ mode: 'fill', rgb: 0xffffff });
    expect(pose(PALADIN, { flags: FLAG.HURT }).frame).toBe(PALADIN.hit);
  });

  it('wind-up flashes red and shivers', () => {
    const m = newPoseMemory();
    const a = pose(KNIGHT, { anim: ANIM.Windup }, 0.07, m); // clock 0.07: flash on, shiver -1
    const b = pose(KNIGHT, { anim: ANIM.Windup }, 0.07, m); // clock 0.14: flash off, shiver +1
    const tints = [a.tint, b.tint].map((t) => (t.mode === 'none' ? -1 : t.rgb));
    expect(new Set(tints).size).toBe(2);
    expect(tints).toContain(0xff8080);
    expect(Math.abs(a.body.x)).toBe(1);
    expect(Math.abs(b.body.x)).toBe(1);
    expect(a.body.x).not.toBe(b.body.x);
  });

  it('melee step goes along the world aim', () => {
    const p = pose(KNIGHT, { anim: ANIM.Melee, animT: 0, aim: 0 });
    expect(p.aimStep.x).toBe(3);
    expect(p.aimStep.y).toBe(0);
    const q = pose(KNIGHT, { anim: ANIM.Melee, animT: 0, aim: 0, screenAim: Math.PI });
    expect(q.left).toBe(true);
    expect(q.aimStep).toEqual(p.aimStep);
  });

  it('blade swing fades the weapon out and starts at the near edge of the arc', () => {
    const p = pose(PALADIN, { anim: ANIM.Melee, animT: 0.009, aim: 0 });
    expect(p.weapon!.alpha).toBeCloseTo(0.75, 10);
    expect(p.weapon!.rot).toBeCloseTo(Math.PI / 2 - PALADIN.swing!.arc / 2, 10);
  });

  it('weapon goes behind when aiming up the screen', () => {
    expect(pose(PALADIN, { aim: -Math.PI / 2 }).weapon!.behind).toBe(true);
    expect(pose(PALADIN, { aim: Math.PI / 2 }).weapon!.behind).toBe(false);
  });

  it('sinking crops, falling shrinks and fades', () => {
    const a = pose(KNIGHT, { sink: 4 });
    expect(a.sink).toBe(4);
    expect(a.shadow.visible).toBe(false);
    const b = pose(KNIGHT, { fall: 0.85 });
    expect(b.alpha).toBeCloseTo(0.5, 10);
    expect(b.scale).toBeCloseTo(0.83 * (KNIGHT.scale ?? 1), 10);
  });

  it("the Shade's ambush is a silhouette", () => {
    const p = pose(SHADE, { anim: ANIM.Ambush, animT: 0.4 });
    expect(p.silhouette).toBe(true);
    expect(p.tint).toEqual({ mode: 'fill', rgb: SILHOUETTE_FILL });
    expect(p.alpha).toBe(silhouetteAlpha(0.4));
  });

  it('dead is invisible', () => {
    expect(pose(KNIGHT, { flags: FLAG.DEAD }).visible).toBe(false);
  });

  it('dash afterimage every 0.03 s', () => {
    const m = newPoseMemory();
    const seen = [0, 1, 2].map(() => pose(KNIGHT, { anim: ANIM.Dash }, 0.02, m).afterimage);
    expect(seen).toEqual([true, false, true]);
  });
});
