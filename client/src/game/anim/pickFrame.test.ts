import { describe, expect, it } from 'vitest';
import { ANIM, CONST, FLAG, KIND } from '../../generated/defs';
import { FIGURES } from './defs';
import { dragonPoints, DRAGON_ANIMS, dragonFrameName } from './dragonRig';
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
  const M = FIGURES[KIND.Demon];
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

  it('enraged, the wind-up is shorter', () => {
    const w = CONST.DEMON_CLEAVE_WINDUP * CONST.DEMON_ENRAGED_PACE;
    expect(at(ANIM.Melee, w + 0.01, FLAG.ENRAGED).frame).toBe('demon_cleave_anim_f2');
    expect(at(ANIM.Melee, w + 0.01).frame).toBe('demon_cleave_anim_f0');
  });

  it('charges: crouch, two looping frames, the stop', () => {
    const w = CONST.DEMON_SWOOP_WINDUP;
    expect(at(ANIM.Dash, 0.1)).toEqual({ frame: 'demon_charge_anim_f0', lift: 0, windup: true });
    const charging = new Set([0.02, 0.12, 0.22, 0.32].map((k) => at(ANIM.Dash, w + k).frame));
    expect(charging).toEqual(new Set(['demon_charge_anim_f1', 'demon_charge_anim_f2']));
    expect(at(ANIM.Dash, w + CONST.DEMON_SWOOP_TIME + 0.05).frame).toBe('demon_charge_anim_f3');
  });

  it('bursts with the ring of fire at the end of the cast wind-up', () => {
    const w = CONST.DEMON_RING_WINDUP;
    expect(at(ANIM.Cast, 0.05).frame).toBe('demon_cast_anim_f0');
    expect(at(ANIM.Cast, w - 0.05).frame).toBe('demon_cast_anim_f1');
    expect(at(ANIM.Cast, w + 0.05)).toEqual({ frame: 'demon_cast_anim_f2', lift: 0, windup: false });
    expect(at(ANIM.Cast, w + CONST.DEMON_RING_RECOVER).frame).toBe('demon_cast_anim_f3');
  });
});
