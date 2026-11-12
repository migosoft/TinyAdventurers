import { describe, expect, it } from 'vitest';
import { ANIM, CONST, EFFECT, FLAG, KIND, SIDE, TILE_ID } from '../../generated/defs';
import { TILE, TileMap } from '../../sim/map';
import type { OwnHero } from '../../run/view';
import type { EntState } from '../world';
import { FigureStates } from './figureState';

/** A 4x1 map: floor, deep water, chasm, shallow water. */
function map(): TileMap {
  return new TileMap(4, 1, Uint8Array.from([TILE_ID.Floor, TILE_ID.DeepWater, TILE_ID.Chasm, TILE_ID.ShallowWater]));
}
const at = (tx: number) => tx * TILE + TILE / 2;

const ent = (o: Partial<EntState> = {}): EntState => ({ id: 1, kind: KIND.Paladin, x: at(1), y: 8, hp: 10, anim: ANIM.Move, aim: 0.5, animMs: 300, flags: 0, extra: 0, effects: 0, side: SIDE.Friendly, entangled: 0, ...o });
const own = (o: Partial<OwnHero> = {}): OwnHero => ({ x: at(0), y: 8, alive: true, charmed: false, anim: ANIM.Idle, animT: 0.25, aim: 1.5, flags: 2, effects: 4, entangled: 0, dashing: false, sinking: false, arc: 1.1, aimsAtPointer: true, aimFromX: at(0), aimFromY: 8, ...o });
const frame = (o: Partial<OwnHero> = {}) => ({ you: 1, own: own(o) });

describe('FigureStates.stateOf', () => {
  it('draws the own hero from prediction, with the swing arc only in Melee', () => {
    const fs = new FigureStates(map());
    const a = fs.stateOf(ent(), frame(), 0);
    expect(a.predicted).toBe(true);
    expect(a.s).toMatchObject({ x: at(0), y: 8, anim: ANIM.Idle, animT: 0.25, aim: 1.5, flags: 2, effects: 4, party: true, swingArc: undefined });
    expect(a.s.id).toBeUndefined();
    const b = fs.stateOf(ent(), frame({ anim: ANIM.Melee }), 0);
    expect(b.s.swingArc).toBe(1.1);
  });
  it('draws a charmed own hero from the interpolated entity', () => {
    const fs = new FigureStates(map());
    const r = fs.stateOf(ent({ x: at(0) }), frame({ charmed: true, x: at(3) }), 0);
    expect(r.predicted).toBe(false);
    expect(r.s).toMatchObject({ id: 1, x: at(0), anim: ANIM.Move, animT: 0.3, aim: 0.5, party: true });
  });
  it('draws other figures interpolated and not as party unless a hero', () => {
    const fs = new FigureStates(map());
    const r = fs.stateOf(ent({ id: 7, kind: KIND.GoblinArcher }), frame(), 0);
    expect(r.predicted).toBe(false);
    expect(r.s.party).toBe(false);
  });
  it('sinks a figure standing on water, but not a dashing or incorporeal one', () => {
    const fs = new FigureStates(map());
    const wade = fs.stateOf(ent({ id: 7, x: at(3) }), frame(), 0);
    expect(wade.s.sink).toBeGreaterThan(0);
    expect(fs.stateOf(ent({ id: 7, x: at(3), anim: ANIM.Dash }), frame(), 0).s.sink).toBe(0);
    expect(fs.stateOf(ent({ id: 7, x: at(3), flags: FLAG.INCORPOREAL }), frame(), 0).s.sink).toBe(0);
    expect(fs.stateOf(ent(), frame({ x: at(3), dashing: true }), 0).s.sink).toBe(0);
    expect(fs.stateOf(ent(), frame({ x: at(3) }), 0).s.sink).toBeGreaterThan(0);
  });
  it('drowns a hero after a Sink event: drown rises over DROWN_TIME, position pinned', () => {
    const fs = new FigureStates(map());
    fs.event({ t: 'Sink', id: 7, x: at(1), y: 9, how: 1 }, 10);
    const e = ent({ id: 7, x: at(0), y: 3 });
    const a = fs.stateOf(e, frame(), 10);
    expect(a.drowning).toBe(true);
    expect(a.s).toMatchObject({ x: at(1), y: 9, drown: 0, fall: 0, anim: ANIM.Idle, animT: 0 });
    const b = fs.stateOf(e, frame(), 10 + CONST.DROWN_TIME / 2);
    expect(b.s.drown).toBeCloseTo(0.5);
    expect(fs.stateOf(e, frame(), 20).s.drown).toBe(1);
  });
  it('falls into a chasm over FALL_TIME', () => {
    const fs = new FigureStates(map());
    fs.event({ t: 'Sink', id: 7, x: at(2), y: 9, how: 0 }, 0);
    const a = fs.stateOf(ent({ id: 7 }), frame(), CONST.FALL_TIME / 2);
    expect(a.drowning).toBe(false);
    expect(a.s.fall).toBeCloseTo(0.5);
    expect(a.s.drown).toBe(0);
  });
  it('Sink how 2 clears the sink', () => {
    const fs = new FigureStates(map());
    fs.event({ t: 'Sink', id: 7, x: at(1), y: 9, how: 1 }, 0);
    fs.event({ t: 'Sink', id: 7, x: at(1), y: 9, how: 2 }, 0.1);
    const r = fs.stateOf(ent({ id: 7, x: at(0) }), frame(), 0.2);
    expect(r.s.drown).toBeUndefined();
    expect(r.drowning).toBe(false);
  });
  it('starts a predicted sink for the own hero once, and reports it', () => {
    const fs = new FigureStates(map());
    const a = fs.stateOf(ent(), frame({ x: at(1), sinking: true }), 5);
    expect(a.started).toBe(true);
    expect(a.drowning).toBe(true);
    const b = fs.stateOf(ent(), frame({ x: at(0), sinking: true }), 5.1);
    expect(b.started).toBe(false);
    expect(b.s.x).toBe(at(1));
  });
});

describe('FigureStates.event', () => {
  const died = { t: 'Died', id: 7, x: 0, y: 0, kind: KIND.Paladin } as const;
  it('Died after a sink returns lost, once; otherwise null', () => {
    const fs = new FigureStates(map());
    expect(fs.event(died, 0)).toBeNull();
    fs.event({ t: 'Sink', id: 7, x: at(1), y: 9, how: 1 }, 0);
    expect(fs.event(died, 1)).toBe('lost');
    expect(fs.event(died, 1)).toBeNull();
  });
  it('a second Sink event does not restart the sink', () => {
    const fs = new FigureStates(map());
    fs.event({ t: 'Sink', id: 7, x: at(1), y: 9, how: 1 }, 0);
    fs.event({ t: 'Sink', id: 7, x: at(2), y: 9, how: 0 }, 5);
    expect(fs.stateOf(ent({ id: 7 }), frame(), 0.45).s.drown).toBeCloseTo(0.5);
  });
  it('Invisible on then takeVanish is true once; off then takeReappear is true once', () => {
    const fs = new FigureStates(map());
    fs.event({ t: 'Effect', id: 7, kind: EFFECT.Invisible, on: true, look: 0 }, 0);
    expect(fs.takeVanish(7, 0.1)).toBe(true);
    expect(fs.takeVanish(7, 0.1)).toBe(false);
    fs.event({ t: 'Effect', id: 7, kind: EFFECT.Invisible, on: false, look: 0 }, 1);
    expect(fs.takeReappear(7, 1.1)).toBe(true);
    expect(fs.takeReappear(7, 1.1)).toBe(false);
  });
  it('an on cancels a pending reappear and an off a pending vanish', () => {
    const fs = new FigureStates(map());
    fs.event({ t: 'Effect', id: 7, kind: EFFECT.Invisible, on: false, look: 0 }, 0);
    fs.event({ t: 'Effect', id: 7, kind: EFFECT.Invisible, on: true, look: 0 }, 0.1);
    expect(fs.takeReappear(7, 0.2)).toBe(false);
    fs.event({ t: 'Effect', id: 7, kind: EFFECT.Invisible, on: false, look: 0 }, 0.3);
    expect(fs.takeVanish(7, 0.4)).toBe(false);
  });
  it('marks expire; prune drops them', () => {
    const fs = new FigureStates(map());
    fs.event({ t: 'Effect', id: 7, kind: EFFECT.Invisible, on: true, look: 0 }, 0);
    fs.prune(100);
    expect(fs.takeVanish(7, 100)).toBe(false);
  });
});

describe('FigureStates.ownEntity', () => {
  it('makes the own entity from the own hero', () => {
    const fs = new FigureStates(map());
    expect(fs.ownEntity(frame({ entangled: 2 }), KIND.Paladin)).toEqual({ id: 1, kind: KIND.Paladin, x: at(0), y: 8, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 4, side: SIDE.Friendly, entangled: 2 });
  });
});
