import { describe, expect, it } from 'vitest';
import { ANIM, CONST, FLAG } from '../generated/defs';
import { BITE_T, HOP, HOP_H, MimicTracker, WAKE_T, barrelPose, chestFrame, chestLid, chestLoot, mimicPose } from './objectPose';

const fresh = () => ({ lastHop: -1, wakeFx: false });

describe('chestFrame', () => {
  it('closed, opening, empty', () => {
    expect(chestFrame(-1)).toBe('chest_full_open_anim_f0');
    expect(chestFrame(0.15)).toBe('chest_full_open_anim_f1');
    expect(chestFrame(0.6)).toBe('chest_empty_open_anim_f2');
  });
});

describe('barrelPose', () => {
  it('rests', () => {
    expect(barrelPose(0, 0)).toEqual({ fill: null, dx: 0, dy: 0, scale: 1, alpha: 1, shadow: true });
  });
  it('flashes when the fuse starts', () => {
    expect(barrelPose(1, 0).fill).toBe(0xfff0c0);
  });
  it('shrinks and fades while falling', () => {
    const p = barrelPose(2, CONST.FALL_TIME * 500);
    expect(p.scale).toBeCloseTo(0.6);
    expect(p.alpha).toBeCloseTo(0.5);
    expect(p.shadow).toBe(false);
  });
  it('has sunk and gone when drowned', () => {
    const p = barrelPose(3, CONST.DROWN_TIME * 1000);
    expect(p.dy).toBe(10);
    expect(p.alpha).toBe(0);
  });
});

describe('mimicPose', () => {
  it('hiding without a rattle is a plain chest', () => {
    const p = mimicPose({ x: 0, y: 0, hiding: true, rattle: 0, aim: 0 }, 0, fresh());
    expect(p).toMatchObject({ frame: 0, lift: 0, sx: 1, sy: 1 });
  });
  it('the reveal jumps, and its pop cue fires once', () => {
    const mem = fresh();
    const s = { x: 0, y: 0, hiding: false, wakeT: WAKE_T * 0.5, aim: 0 };
    const a = mimicPose(s, 0, mem);
    expect(a.frame).toBe(2);
    expect(a.lift).toBeGreaterThan(0);
    expect(a.wakeCue).toBe(true);
    expect(mimicPose(s, 0, mem).wakeCue).toBe(false);
  });
  it('mid-air in a hop is at full height', () => {
    const p = mimicPose({ x: 0, y: 0, hiding: false, hop: HOP.crouch + (HOP.air - HOP.crouch) / 2, aim: 0 }, 0, fresh());
    expect(p.frame).toBe(2);
    expect(p.lift).toBeCloseTo(HOP_H);
  });
  it('landing fires the dust cue once per hop', () => {
    const mem = fresh();
    const air = { x: 0, y: 0, hiding: false, hop: HOP.air - 0.01, aim: 0 };
    const land = { ...air, hop: HOP.air + 0.01 };
    expect(mimicPose(air, 0, mem).landCue).toBe(false);
    expect(mimicPose(land, 0, mem).landCue).toBe(true);
    expect(mimicPose(land, 0, mem).landCue).toBe(false);
  });
  it('bites open wide mid-lunge', () => {
    expect(mimicPose({ x: 0, y: 0, hiding: false, biteT: BITE_T * 0.4, aim: 0 }, 0, fresh()).frame).toBe(2);
  });
});

describe('chestLid and chestLoot', () => {
  it('the lid eases open over the opening', () => {
    expect(chestLid(-1)).toBe(0);
    expect(chestLid(0)).toBe(0);
    expect(chestLid(0.15)).toBeCloseTo(0.5);
    expect(chestLid(0.3)).toBe(1);
    expect(chestLid(1e9)).toBe(1);
  });
  it('the loot is there until the chest has been open a while', () => {
    expect(chestLoot(-1)).toBe(true);
    expect(chestLoot(0.49)).toBe(true);
    expect(chestLoot(0.5)).toBe(false);
    expect(chestLoot(1e9)).toBe(false);
  });
});

describe('mimicPose lid, lunge and pitch', () => {
  const awake = { x: 0, y: 0, hiding: false, aim: 0 };
  it('a hiding mimic without a rattle is shut and still', () => {
    const p = mimicPose({ x: 0, y: 0, hiding: true, rattle: 0, aim: 0 }, 0, fresh());
    expect(p).toMatchObject({ lid: 0, pitch: 0, lunge: 0 });
  });
  it('a rattle lifts the lid a crack on a shiver frame', () => {
    const p = mimicPose({ x: 0, y: 0, hiding: true, rattle: 0.5, aim: 0 }, 0, fresh());
    expect(p.lid).toBeCloseTo(0.125);
  });
  it('the reveal throws the jaws wide', () => {
    expect(mimicPose({ ...awake, wakeT: WAKE_T * 0.25 }, 0, fresh()).lid).toBe(1);
  });
  it('a bite opens wide while lunging, then clamps shut', () => {
    const open = mimicPose({ ...awake, biteT: BITE_T * 0.3 }, 0, fresh());
    expect(open.lid).toBe(1);
    expect(open.lunge).toBeGreaterThan(0);
    expect(mimicPose({ ...awake, biteT: BITE_T * 0.9 }, 0, fresh()).lid).toBe(0);
  });
  it('a hop is open in the air, level at the top, and shut at the end of the landing', () => {
    const mid = mimicPose({ ...awake, hop: HOP.crouch + (HOP.air - HOP.crouch) / 2 }, 0, fresh());
    expect(mid.lid).toBe(1);
    expect(mid.pitch).toBeCloseTo(0);
    expect(mimicPose({ ...awake, hop: HOP.land - 1e-4 }, 0, fresh()).lid).toBeLessThan(0.01);
  });
  it('standing awake it chomps slowly', () => {
    for (const clock of [0, 0.25, 0.5, 0.75]) {
      const { lid } = mimicPose(awake, clock, fresh());
      // The swing is 0.35 +- 0.25, so the ends of the range are reached exactly.
      expect(lid).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(lid).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });
});

describe('MimicTracker', () => {
  const snap = (hiding: boolean) => ({ x: 1, y: 2, anim: ANIM.Idle, animT: 0, aim: 0, flags: hiding ? FLAG.HIDING : 0 });
  it('starts the wake clock on the step a hiding mimic stops hiding', () => {
    const t = new MimicTracker();
    expect(t.step(snap(true), 0.05, 999).wakeT).toBe(-1);
    expect(t.step(snap(false), 0.05, 999).wakeT).toBe(0);
    expect(t.step(snap(false), 0.1, 999).wakeT).toBeCloseTo(0.1);
  });
  it('a mimic first seen awake never reveals', () => {
    expect(new MimicTracker().step(snap(false), 0.05, 999).wakeT).toBe(-1);
  });
});
