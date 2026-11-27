import { describe, expect, it } from 'vitest';
import { ANIM, CONST, FLAG, KIND } from '../../generated/defs';
import { FIGURES } from './defs';
import { dragonPoints, DRAGON_ANIMS, dragonFrameName } from './dragonRig';
import { DEMON_ANIMS, demonFrameName, type DemonAnim } from './demonFrames';
import { pickFrame } from './pickFrame';

const D = FIGURES[KIND.Dragon];
const pick = (anim: number, animT: number, flags = 0, moving = false) => pickFrame(D, { anim, animT, flags }, 0, 0, moving);

describe('dragon frames', () => {
  it('idles and walks on the ground', () => {
    expect(pick(ANIM.Idle, 0).frame).toBe('dragon_idle_anim_f0');
    expect(pick(ANIM.Move, 0, 0, true).frame).toBe('dragon_walk_anim_f0');
    expect(pick(ANIM.Move, 0, 0, true).lift).toBe(0);
  });

  it('shows the wind-up pose with the telegraph, then the strike', () => {
    const w = CONST.DRAGON_CLAW_WINDUP;
    expect(pick(ANIM.Melee, w / 2)).toEqual({ frame: 'dragon_claw_anim_f0', lift: 0, windup: true });
    expect(pick(ANIM.Melee, w + 0.01)).toEqual({ frame: 'dragon_claw_anim_f1', lift: 0, windup: false });
    expect(pick(ANIM.Melee, w + 1).frame).toBe('dragon_claw_anim_f3');
    expect(pick(ANIM.Tail, CONST.DRAGON_TAIL_WINDUP / 2).frame).toBe('dragon_tail_anim_f0');
    expect(pick(ANIM.Tail, CONST.DRAGON_TAIL_WINDUP + 1).frame).toBe('dragon_tail_anim_f5');
  });

  it('bites: head back first, then the jaws snap', () => {
    const w = CONST.DRAGON_BITE_WINDUP;
    expect(pick(ANIM.Bite, w / 2)).toEqual({ frame: 'dragon_bite_anim_f0', lift: 0, windup: true });
    expect(pick(ANIM.Bite, w + 0.01).frame).toBe('dragon_bite_anim_f1');
    expect(pick(ANIM.Bite, w + 1).frame).toBe('dragon_bite_anim_f3');
  });

  it('opens the mouth for the fire after the breath wind-up', () => {
    expect(pick(ANIM.Breath, 0.1).frame).toBe('dragon_breath_anim_f0');
    expect(pick(ANIM.Breath, CONST.DRAGON_BREATH_WINDUP + 0.1).frame).toBe('dragon_breath_anim_f1');
  });

  it('lifts off, hovers and lands', () => {
    expect(pick(ANIM.TakeOff, 0)).toMatchObject({ frame: 'dragon_takeoff_anim_f0', lift: 0 });
    expect(pick(ANIM.TakeOff, CONST.DRAGON_TAKEOFF * 0.99).frame).toBe('dragon_takeoff_anim_f3');
    expect(pick(ANIM.TakeOff, CONST.DRAGON_TAKEOFF).lift).toBe(1);
    expect(pick(ANIM.Move, 0, FLAG.AIRBORNE, true)).toMatchObject({ frame: 'dragon_hover_anim_f0', lift: 1 });
    expect(pick(ANIM.Breath, CONST.DRAGON_BREATH_WINDUP + 0.1, FLAG.AIRBORNE).frame).toBe('dragon_hoverbreath_anim_f0');
    expect(pick(ANIM.Land, 0)).toMatchObject({ frame: 'dragon_land_anim_f0', lift: 1 });
    expect(pick(ANIM.Land, CONST.DRAGON_LAND)).toMatchObject({ frame: 'dragon_land_anim_f2', lift: 0 });
  });

  it('has a mouth and a nostril point for every frame', () => {
    const { mouth, nostrils } = dragonPoints();
    for (const [a, poses] of Object.entries(DRAGON_ANIMS))
      poses.forEach((_, i) => {
        const n = dragonFrameName(a as keyof typeof DRAGON_ANIMS, i);
        expect(mouth[n]).toBeDefined();
        expect(nostrils[n]).toBeDefined();
      });
    // The open jaw drops the mouth point below the closed one.
    expect(mouth['dragon_breath_anim_f1'][1]).toBeGreaterThan(mouth['dragon_idle_anim_f0'][1]);
  });
});

describe('demon frames', () => {
  const M = FIGURES[KIND.FireDemon];
  const at = (anim: number, animT: number, flags = 0, moving = false) => pickFrame(M, { anim, animT, flags }, 0, 0, moving);

  it('idles and walks', () => {
    expect(at(ANIM.Idle, 0).frame).toBe('demon_idle_anim_f0');
    expect(at(ANIM.Move, 0, 0, true).frame).toBe('demon_walk_anim_f0');
  });

  it('cleaves: wind-up with the telegraph, the swing just before the hit, impact after it', () => {
    const w = CONST.DEMON_CLEAVE_WINDUP;
    expect(at(ANIM.Melee, w / 2)).toEqual({ frame: 'demon_cleave_anim_f0', lift: 0, windup: true });
    expect(at(ANIM.Melee, w - 0.02)).toEqual({ frame: 'demon_cleave_anim_f1', lift: 0, windup: false });
    expect(at(ANIM.Melee, w + 0.01).frame).toBe('demon_cleave_anim_f2');
    expect(at(ANIM.Melee, w + CONST.DEMON_CLEAVE_RECOVER).frame).toBe('demon_cleave_anim_f4');
  });

  it('charges: crouch, two looping frames, the stop', () => {
    const w = CONST.DEMON_SWOOP_WINDUP;
    expect(at(ANIM.Dash, 0.1)).toEqual({ frame: 'demon_charge_anim_f0', lift: 0, windup: true });
    const charging = new Set([0.02, 0.12, 0.22, 0.32].map((k) => at(ANIM.Dash, w + k).frame));
    expect(charging).toEqual(new Set(['demon_charge_anim_f1', 'demon_charge_anim_f2']));
    expect(at(ANIM.Dash, w + CONST.DEMON_SWOOP_TIME + 0.05).frame).toBe('demon_charge_anim_f3');
  });

  it('lifts off and lands on its idle frames', () => {
    expect(at(ANIM.TakeOff, 0)).toEqual({ frame: 'demon_idle_anim_f0', lift: 0, windup: false });
    expect(at(ANIM.TakeOff, CONST.DEMON_TAKEOFF).lift).toBe(1);
    expect(at(ANIM.TakeOff, CONST.DEMON_TAKEOFF / 2).lift).toBeGreaterThan(0);
    expect(at(ANIM.TakeOff, CONST.DEMON_TAKEOFF / 2).lift).toBeLessThan(1);
    expect(at(ANIM.Land, 0)).toEqual({ frame: 'demon_idle_anim_f0', lift: 1, windup: false });
    expect(at(ANIM.Land, CONST.DEMON_LAND).lift).toBe(0);
    expect(at(ANIM.Land, CONST.DEMON_LAND / 2).lift).toBeGreaterThan(0);
    expect(at(ANIM.Land, CONST.DEMON_LAND / 2).lift).toBeLessThan(1);
  });

  it('swipes its tail on the cleave frames', () => {
    const w = CONST.DEMON_TAIL_WINDUP;
    expect(at(ANIM.Tail, w / 2)).toEqual({ frame: 'demon_cleave_anim_f0', lift: 0, windup: true });
    expect(at(ANIM.Tail, w + 0.01)).toEqual({ frame: 'demon_cleave_anim_f2', lift: 0, windup: false });
    expect(at(ANIM.Tail, w + CONST.DEMON_TAIL_RECOVER).frame).toBe('demon_cleave_anim_f4');
  });

  it('breathes on the cast frames', () => {
    const w = CONST.DEMON_BREATH_WINDUP;
    expect(at(ANIM.Breath, 0.05)).toEqual({ frame: 'demon_cast_anim_f0', lift: 0, windup: true });
    expect(at(ANIM.Breath, w - 0.05)).toEqual({ frame: 'demon_cast_anim_f1', lift: 0, windup: true });
    expect(at(ANIM.Breath, w + 0.1)).toEqual({ frame: 'demon_cast_anim_f2', lift: 0, windup: false });
    expect(at(ANIM.Breath, w + CONST.DEMON_BREATH_TIME - 0.05).frame).toBe('demon_cast_anim_f2');
    expect(at(ANIM.Breath, w + CONST.DEMON_BREATH_TIME + 0.05).frame).toBe('demon_cast_anim_f3');
  });

  it('in the air every anim keeps lift 1', () => {
    for (const anim of [ANIM.Idle, ANIM.Move, ANIM.Cast, ANIM.Breath]) {
      for (const t of [0, 0.3, 1, 2.5]) expect(at(anim, t, FLAG.AIRBORNE, anim === ANIM.Move).lift).toBe(1);
    }
    expect(at(ANIM.Idle, 0, FLAG.AIRBORNE).frame).toBe('demon_idle_anim_f0');
    expect(at(ANIM.Move, 0, FLAG.AIRBORNE, true).frame).toBe('demon_walk_anim_f0');
    expect(at(ANIM.Land, 0, FLAG.AIRBORNE).lift).toBe(1);
    expect(at(ANIM.Land, CONST.DEMON_LAND, FLAG.AIRBORNE).lift).toBe(0);
  });

  it('gives a frame the atlas has for every anim the script sends', () => {
    const count: Record<string, number> = DEMON_ANIMS;
    for (const anim of [ANIM.Idle, ANIM.Move, ANIM.Melee, ANIM.Tail, ANIM.Dash, ANIM.Cast, ANIM.Breath, ANIM.TakeOff, ANIM.Land]) {
      for (const flags of [0, FLAG.AIRBORNE]) for (const t of [0, 0.3, 2]) for (const moving of [false, true]) {
        const m = /^demon_(idle|walk|cleave|charge|cast)_anim_f(\d)$/.exec(at(anim, t, flags, moving).frame);
        expect(m).not.toBeNull();
        expect(Number(m![2])).toBeLessThan(count[m![1]]);
      }
    }
  });

  it('has a mouth point for every frame name and for none else', () => {
    const names = Object.entries(DEMON_ANIMS).flatMap(([a, n]) => [...Array(n).keys()].map((i) => demonFrameName(a as DemonAnim, i)));
    expect(Object.keys(M.mouth!).sort()).toEqual([...names].sort());
    expect(Object.keys(M.nostrils!).sort()).toEqual([...names].sort());
  });

  it('flies, slams and swishes its tail like the dragon', () => {
    expect(M.flight).toEqual({ takeoff: CONST.DEMON_TAKEOFF, land: CONST.DEMON_LAND });
    expect(D.flight).toEqual({ takeoff: CONST.DRAGON_TAKEOFF, land: CONST.DRAGON_LAND });
    expect(M.lift).toBe(14);
    expect(M.slam).toEqual({ r: CONST.DEMON_SMASH_RADIUS, anim: ANIM.Land, t: CONST.DEMON_LAND });
    expect(M.tail).toEqual({ reach: CONST.DEMON_TAIL_RANGE, arc: 2.4, color: 0xffa080 });
  });

  it('never throws, for any figure with own frames in any anim, grounded or airborne', () => {
    for (const d of Object.values(FIGURES)) {
      if (!d.frames) continue;
      for (const anim of Object.values(ANIM)) for (const flags of [0, FLAG.AIRBORNE]) for (const t of [0, 0.3, 2]) {
        expect(() => pickFrame(d, { anim, animT: t, flags }, 0, 0, false)).not.toThrow();
      }
    }
  });

  it('bursts with the ring of fire at the end of the cast wind-up', () => {
    const w = CONST.DEMON_CAST_WINDUP;
    expect(at(ANIM.Cast, 0.05).frame).toBe('demon_cast_anim_f0');
    expect(at(ANIM.Cast, w - 0.05).frame).toBe('demon_cast_anim_f1');
    expect(at(ANIM.Cast, w + 0.05)).toEqual({ frame: 'demon_cast_anim_f2', lift: 0, windup: false });
    expect(at(ANIM.Cast, w + CONST.DEMON_CAST_RECOVER).frame).toBe('demon_cast_anim_f3');
  });
});
