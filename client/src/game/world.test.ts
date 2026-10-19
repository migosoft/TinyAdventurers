import { describe, expect, it } from 'vitest';
import { CONST, TILE_ID } from '../generated/defs';
import type { Snapshot } from '../generated/Snapshot';
import { TILE, TileMap } from '../sim/map';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import { Predictor } from './world';

const ab = (id: ResolvedAbility['id'], over: Partial<ResolvedAbility> = {}): ResolvedAbility => ({ id, cooldown: 1, damage: 1, range: 100, arc: 0, speed: 100, radius: 4, duration: 0.2, ...over });
/** Predictor for tests: the class only picks which ids the abilities carry. */
function mk(map: TileMap, cls: 'Wizard' | 'Barbarian' | 'ElvenRanger', x: number, y: number): Predictor {
  const ids: Record<string, [ResolvedAbility['id'], ResolvedAbility['id']]> = { Wizard: ['MagicMissile', 'Fireball'], Barbarian: ['Axe', 'Dash'], ElvenRanger: ['CrossbowDagger', 'SummonWolf'] };
  const [a, b] = ids[cls];
  return new Predictor(map, 60, [ab(a, { cooldown: 0.6 }), ab(b)], cls === 'ElvenRanger' ? ab('CrossbowDagger', { cooldown: 0.4 }) : null, x, y);
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
  return { tick: ack, ack, ents: [], me, boss: null, ev: [], drain: null, lights: [], srv_ms: 0 };
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
    const pred = new Predictor(chasmMap(), 90, [ab('MagicMissile', { cooldown: 0.5 }), ab('Dash', { duration: 0.25 })], ab('CrossbowDagger', { cooldown: 0.3 }), x0, y0);
    pred.step(1, 0, null);
    expect(pred.state.x - x0).toBeCloseTo(90 * CONST.DT, 6);
    expect(pred.cooldownOf(0)).toBe(0.5);
    expect(pred.cooldownOf(1)).toBe(1);
    expect(pred.cooldownOf(0, true)).toBe(0.3);
    pred.step(1, 0, [1, 0]);
    expect(pred.state.dashT).toBe(0.25);
  });
});
