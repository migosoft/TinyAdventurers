import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, KIND } from '../../generated/defs';
import { builtOf, type BuiltIn } from '../built';
import { DEMON_FIGURE } from './figure';
import { DEMON, demonRest } from './shape';

const idle = (o: Partial<BuiltIn> = {}): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });

describe('DEMON_FIGURE', () => {
  it('is the figure of the demon kind: 54 px tall, its own picture', () => {
    expect(builtOf(KIND.Demon)).toBe(DEMON_FIGURE);
    expect(DEMON_FIGURE).toMatchObject({ key: 'demon', picture: 'demon', unit: DEMON.unit, hem: DEMON.hem });
    expect(DEMON_FIGURE.top).toBe(54);
  });

  it('keeps two memories apart: no shared buffer', () => {
    const a = DEMON_FIGURE.draw(idle(), 0.016, DEMON_FIGURE.newMem()), b = DEMON_FIGURE.draw(idle({ aim: 2 }), 0.016, DEMON_FIGURE.newMem());
    // `===`, not `not.toBe`: that one compares the big buffers deeply for its message
    const same = [a === b, a.body === b.body, a.hull === b.hull, a.levels === b.levels, a.anchors.hand === b.anchors.hand, a.magic === b.magic];
    for (const k of ['position', 'normal', 'uv', 'colour', 'look', 'index'] as const) same.push(a.body[k] === b.body[k], a.hull![k] === b.hull![k], a.body[k] === a.hull![k]);
    expect(same).toEqual(same.map(() => false));
  });

  it('draw hands back the memory\'s own buffers, a hull, no claws, no halos, the anchors and the lights', () => {
    const m = DEMON_FIGURE.newMem();
    const d = DEMON_FIGURE.draw(idle({ aim: 1 }), 0.016, m);
    expect(DEMON_FIGURE.draw(idle({ aim: 1 }), 0.016, m)).toBe(d);
    expect(d.body.verts).toBeGreaterThan(0);
    expect(d.hull!.verts).toBeGreaterThan(0);
    expect(d.glow).toBeNull();
    expect(d.halos).toEqual([]);
    expect(d.yaw).toBe(1);
    expect(d.lift).toBe(0);
    for (const k of ['hand', 'mouth', 'chest', 'eyes'] as const) expect(d.anchors[k]!.every(Number.isFinite)).toBe(true);
    expect(d.anchors.mouth![1]).toBeGreaterThan(20);
    expect(d.magic.chest).toBeGreaterThan(0);
    expect(d.magic.mouth).toBe(0);
    expect(d.levels[1]).toBe(1);
    expect(d.levels[2]).toBe(1);
  });

  it('the glow\'s phase runs on the figure\'s clock, a quarter turn a second, and stands still while frozen or stone', () => {
    const m = DEMON_FIGURE.newMem();
    expect(DEMON_FIGURE.draw(idle(), 0, m).levels[0]).toBe(0);
    expect(DEMON_FIGURE.draw(idle(), 1, m).levels[0]).toBeCloseTo(0.25, 9);
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) expect(DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 1, m).levels[0]).toBeCloseTo(0.25, 9);
    expect(DEMON_FIGURE.draw(idle(), 3.5, m).levels[0]).toBeCloseTo(0.125, 9);
  });

  it('rest is the standing figure\'s body', () => {
    const r = DEMON_FIGURE.rest();
    expect(r.verts).toBe(demonRest().body.verts);
    expect(r.indices).toBeGreaterThan(0);
  });
});
