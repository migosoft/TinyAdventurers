import { describe, expect, it } from 'vitest';
import { CONST, EFFECT, EFFECT_LOOK, TILE_ID } from '../generated/defs';
import type { EntSnap } from '../generated/EntSnap';
import type { Snapshot } from '../generated/Snapshot';
import { TILE, TileMap } from '../sim/map';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import { EffectLooks, Interpolator, Predictor, abilityChoice, cosmeticPierce, type EntState } from './world';

const ab = (id: ResolvedAbility['id'], over: Partial<ResolvedAbility> = {}): ResolvedAbility => ({ id, cooldown: 1, damage: 1, range: 100, arc: 0, speed: 100, radius: 4, duration: 0.2, pierce: 0, pierce_through: 0, ranged: false, projectile: null, split: { Physical: 1 }, behind: 0, ...over });
/** Predictor for tests: the class only picks which ids the abilities carry. */
function mk(map: TileMap, cls: 'Wizard' | 'Barbarian' | 'ElvenRanger', x: number, y: number): Predictor {
  const ids: Record<string, [ResolvedAbility['id'], ResolvedAbility['id']]> = { Wizard: ['MagicMissile', 'Fireball'], Barbarian: ['Strike', 'Charge'], ElvenRanger: ['Shoot', 'SummonWolf'] };
  const [a, b] = ids[cls];
  return new Predictor(map, 60, [ab(a, { cooldown: 0.6 }), ab(b)], ab('Strike', { cooldown: 0.4 }), x, y);
}

/** 12x5 floor in walls, with a chasm at tile (8, 2). */
function chasmMap(): TileMap {
  const w = 12;
  const h = 5;
  const tiles = new Uint8Array(w * h).fill(TILE_ID.Wall);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) tiles[y * w + x] = TILE_ID.Floor;
  tiles[2 * w + 8] = TILE_ID.Chasm;
  return new TileMap(w, h, tiles);
}

function snap(ack: number, x: number, y: number): Snapshot {
  const me = { alive: true, hp: 100, max_hp: 100, x, y, dash_t: 0, dash_dx: 0, dash_dy: 0, knock_vx: 0, knock_vy: 0, cd1: 0, cd2: 0, spectating: null, darkvision: 0, vision: 9, effects: [], speed_mul: 1, no_act: false };
  return { tick: ack, ack, ents: [], me, boss: null, ev: [], drain: null, lights: [], looks: [], srv_ms: 0 };
}

describe('Predictor', () => {
  it('moves at the speed factor the server sends', () => {
    const map = chasmMap();
    const x0 = 3 * TILE + 8, y0 = 2 * TILE + 8;
    for (const mul of [0, 0.5, 1.5]) {
      const pred = mk(map, 'Wizard', x0, y0);
      pred.reconcile({ ...snap(0, x0, y0), me: { ...snap(0, x0, y0).me, speed_mul: mul } });
      pred.step(1, 0, null);
      expect(pred.state.x - x0).toBeCloseTo(pred.speed * mul * CONST.DT, 6);
    }
  });

  it('reconcile_uses_the_servers_speed_factor', () => {
    const map = chasmMap();
    const x0 = 3 * TILE + 8, y0 = 2 * TILE + 8;
    const pred = mk(map, 'Wizard', x0, y0);
    for (let i = 0; i < 4; i++) pred.step(1, 0, null);
    pred.reconcile({ ...snap(1, x0, y0), me: { ...snap(1, x0, y0).me, speed_mul: 0.5 } });
    expect(pred.state.x - x0).toBeCloseTo(3 * pred.speed * 0.5 * CONST.DT, 6);
  });

  it('cannot act or turn while the server says so', () => {
    const pred = mk(chasmMap(), 'Wizard', 3 * TILE + 8, 2 * TILE + 8);
    const s = snap(0, pred.state.x, pred.state.y);
    pred.reconcile({ ...s, me: { ...s.me, no_act: true, effects: [[2, 1.0]] } });
    expect(pred.noAct).toBe(true);
    expect(pred.noTurn).toBe(true);
  });

  it('replays the moves it sent while it thought it was sinking (debug climb-out)', () => {
    const map = chasmMap();
    const chasm = [8 * TILE + 8, 2 * TILE + 8];
    const pred = mk(map, 'Barbarian', chasm[0], chasm[1]);
    expect(pred.sinking).toBe(true);
    // Walking left while the client still predicts the fall: no predicted movement.
    for (let i = 0; i < 10; i++) pred.step(-1, 0, null);
    expect(pred.state.x).toBe(chasm[0]);
    // The server had already climbed the hero out onto safe ground after input 4,
    // so it applied inputs 5..10 as sent.
    const safe = [4 * TILE + 8, 2 * TILE + 8];
    pred.reconcile(snap(4, safe[0], safe[1]));
    expect(pred.state.x).toBeCloseTo(safe[0] - 6 * pred.speed * CONST.DT, 6);
    expect(pred.state.y).toBe(safe[1]);
  });

  it('keeps the cooldown of a shot the server has not seen yet', () => {
    // Holding the button refired as soon as a snapshot from before the shot reset the cooldown to 0.
    const pred = mk(chasmMap(), 'ElvenRanger', 3 * TILE + 8, 2 * TILE + 8);
    for (let i = 0; i < 2; i++) pred.step(0, 0, null);
    const cd = pred.cooldownOf(0);
    pred.step(0, 0, null, [cd, null]);
    for (let i = 0; i < 4; i++) pred.step(0, 0, null);
    expect(pred.cd1).toBeCloseTo(cd - 4 * CONST.DT, 6);
    // The server has seen inputs 1 and 2 only: its cooldown is still 0.
    pred.reconcile(snap(2, pred.state.x, pred.state.y));
    expect(pred.cd1).toBeCloseTo(cd - 4 * CONST.DT, 6);
    // Once it has seen the shot, its own cooldown counts.
    const s = snap(5, pred.state.x, pred.state.y);
    s.me.cd1 = cd - 2 * CONST.DT;
    pred.reconcile(s);
    expect(pred.cd1).toBeCloseTo(cd - 4 * CONST.DT, 6);
  });
});

describe('wolf cooldown', () => {
  it('takes the 60 s wait from the server when the wolf falls', () => {
    const pred = mk(chasmMap(), 'ElvenRanger', 3 * TILE + 8, 2 * TILE + 8);
    expect(pred.cd2).toBe(0);
    const s = snap(0, pred.state.x, pred.state.y);
    s.me.cd2 = 60;
    pred.reconcile(s);
    expect(pred.cd2).toBeCloseTo(60, 1);
  });
});

describe('resolved numbers', () => {
  it('predictor_uses_resolved_numbers', () => {
    const x0 = 3 * TILE + 8, y0 = 2 * TILE + 8;
    const pred = new Predictor(chasmMap(), 90, [ab('MagicMissile', { cooldown: 0.5 }), ab('Charge', { duration: 0.25 })], ab('Strike', { cooldown: 0.3 }), x0, y0);
    pred.step(1, 0, null);
    expect(pred.state.x - x0).toBeCloseTo(90 * CONST.DT, 6);
    expect(pred.cooldownOf(0)).toBe(0.5);
    expect(pred.cooldownOf(1)).toBe(1);
    expect(pred.cooldownOf(0, true)).toBe(0.3);
    pred.step(1, 0, [1, 0]);
    expect(pred.state.dashT).toBe(0.25);
  });
});

describe('abilityChoice', () => {
  const ranged = ab('MagicMissile', { ranged: true });
  const fire = ab('Fireball', { ranged: true });
  it('falls back to Strike for a ranged primary in melee', () => expect(abilityChoice(ranged, 0, true)).toBe('fallback'));
  it('blocks a ranged secondary in melee', () => expect(abilityChoice(fire, 1, true)).toBe('blocked'));
  it('uses a melee ability in melee', () => {
    expect(abilityChoice(ab('Strike'), 0, true)).toBe('use');
    expect(abilityChoice(ab('HolyLight'), 1, true)).toBe('use');
  });
  it('uses anything out of melee', () => {
    expect(abilityChoice(ranged, 0, false)).toBe('use');
    expect(abilityChoice(fire, 1, false)).toBe('use');
    expect(abilityChoice(ab('Charge'), 1, false)).toBe('use');
  });
});

describe('cosmeticPierce', () => {
  const none = { Physical: 0, Cold: 0, Heat: 0, Magical: 0, Poison: 0 };
  const phys = { Physical: 1 };
  const shot = { pierce: 255, through: 0, damage: 16 };
  it('flies on with the rest after an overkill', () => {
    const r = cosmeticPierce(shot, 255, 5, phys, none);
    expect(r).not.toBe('stop');
    if (r === 'stop') return;
    expect(r.damage).toBeCloseTo(11, 9);
    expect(r.pierce).toBe(255);
    expect(r.through).toBe(0);
  });
  it('estimates the HP from the share', () => {
    // Half of 24 HP is 12: a kill, 4 left.
    const r = cosmeticPierce(shot, 127.5, 24, phys, none);
    expect(r === 'stop' ? r : r.damage).toBeCloseTo(4, 9);
  });
  it('stops at an exact kill, like the server', () => {
    expect(cosmeticPierce(shot, 255, 16, phys, none)).toBe('stop');
    expect(cosmeticPierce(shot, 255, 16 - 1e-12, phys, none)).toBe('stop');
  });
  it('stops at an enemy it does not kill', () => expect(cosmeticPierce(shot, 255, 24, phys, none)).toBe('stop'));
  it('stops at an immune enemy', () => expect(cosmeticPierce(shot, 255, 5, phys, { ...none, Physical: 1.0 })).toBe('stop'));
  it('counts down a limited overkill pierce and stops at 0', () => {
    expect(cosmeticPierce({ ...shot, pierce: 1 }, 255, 5, phys, none)).toEqual({ pierce: 0, through: 0, damage: 11 });
    expect(cosmeticPierce({ ...shot, pierce: 0 }, 255, 5, phys, none)).toBe('stop');
  });
  it('passes through with full damage first, then follows the overkill rule', () => {
    expect(cosmeticPierce({ pierce: 0, through: 1, damage: 16 }, 255, 70, phys, none)).toEqual({ pierce: 0, through: 0, damage: 16 });
    expect(cosmeticPierce({ pierce: 0, through: 0, damage: 16 }, 255, 70, phys, none)).toBe('stop');
  });
  it('stops at an enemy of unknown max HP', () => expect(cosmeticPierce(shot, 255, undefined, phys, undefined)).toBe('stop'));
  it('floors a weakness at -1 like the server', () => {
    // Weakness -3 counts as -1: 16 x 2 = 32 against 24 HP, 4 left.
    const r = cosmeticPierce(shot, 255, 24, { Cold: 1 }, { ...none, Cold: -3 });
    expect(r === 'stop' ? r : r.damage).toBeCloseTo(4, 9);
  });
});

describe('Interpolator looks', () => {
  it('hands an entity its effects looks', () => {
    const it = new Interpolator();
    const s = { ...snap(1, 0, 0), ents: [[7, 1, 10, 10, 255, 0, 0, 0, 0, 0, 1 << EFFECT.Entangled] as EntSnap], looks: [[7, EFFECT.Entangled, EFFECT_LOOK.Vines] as [number, number, number]] };
    it.push(s, 0);
    const out = new Map<number, EntState>();
    it.sample(1, out);
    expect(out.get(7)?.looks).toEqual(new Map([[EFFECT.Entangled, EFFECT_LOOK.Vines]]));
  });
});

describe('EffectLooks', () => {
  it('keeps a look from its start event until the effect ends', () => {
    const l = new EffectLooks();
    l.event(7, EFFECT.Entangled, true, EFFECT_LOOK.Vines);
    expect(l.get(7)).toEqual(new Map([[EFFECT.Entangled, EFFECT_LOOK.Vines]]));
    l.event(7, EFFECT.Entangled, false, 0);
    expect(l.get(7)).toBeUndefined();
  });
});
