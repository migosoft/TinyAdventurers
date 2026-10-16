import { describe, expect, it } from 'vitest';
import { ABILITIES, CONST, TILE_ID } from '../generated/defs';
import type { Snapshot } from '../generated/Snapshot';
import { TILE, TileMap } from '../sim/map';
import { Predictor } from './world';

const MODS = { damage: 1, attack_speed: 1, move_speed: 1, life: 1, armor: 0 };

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
  const me = { alive: true, hp: 100, max_hp: 100, x, y, dash_t: 0, dash_dx: 0, dash_dy: 0, knock_vx: 0, knock_vy: 0, cd1: 0, cd2: 0, hidden: 0, spectating: null, darkvision: 0, vision: 9, effects: [], speed_mul: 1, no_act: false };
  return { tick: ack, ack, ents: [], me, boss: null, ev: [], drain: null, lights: [], srv_ms: 0 };
}

describe('Predictor', () => {
  it('moves at the speed factor the server sends', () => {
    const map = chasmMap();
    const x0 = 3 * TILE + 8, y0 = 2 * TILE + 8;
    for (const mul of [0, 0.5, 1.5]) {
      const pred = new Predictor(map, 'Wizard', MODS, x0, y0);
      pred.reconcile({ ...snap(0, x0, y0), me: { ...snap(0, x0, y0).me, speed_mul: mul } });
      pred.step(1, 0, null);
      expect(pred.state.x - x0).toBeCloseTo(pred.speed * mul * CONST.DT, 6);
    }
  });

  it('reconcile_uses_the_servers_speed_factor', () => {
    const map = chasmMap();
    const x0 = 3 * TILE + 8, y0 = 2 * TILE + 8;
    const pred = new Predictor(map, 'Wizard', MODS, x0, y0);
    for (let i = 0; i < 4; i++) pred.step(1, 0, null);
    pred.reconcile({ ...snap(1, x0, y0), me: { ...snap(1, x0, y0).me, speed_mul: 0.5 } });
    expect(pred.state.x - x0).toBeCloseTo(3 * pred.speed * 0.5 * CONST.DT, 6);
  });

  it('cannot act or turn while the server says so', () => {
    const pred = new Predictor(chasmMap(), 'Wizard', MODS, 3 * TILE + 8, 2 * TILE + 8);
    const s = snap(0, pred.state.x, pred.state.y);
    pred.reconcile({ ...s, me: { ...s.me, no_act: true, effects: [[2, 1.0]] } });
    expect(pred.noAct).toBe(true);
    expect(pred.noTurn).toBe(true);
  });

  it('replays the moves it sent while it thought it was sinking (debug climb-out)', () => {
    const map = chasmMap();
    const chasm = [8 * TILE + 8, 2 * TILE + 8];
    const pred = new Predictor(map, 'Barbarian', MODS, chasm[0], chasm[1]);
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
    const pred = new Predictor(chasmMap(), 'ElvenRanger', MODS, 3 * TILE + 8, 2 * TILE + 8);
    for (let i = 0; i < 2; i++) pred.step(0, 0, null);
    const cd = pred.cooldownOf('CrossbowDagger');
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

  it('keeps the hide time of a Hide the server has not seen yet', () => {
    const pred = new Predictor(chasmMap(), 'ElvenRanger', MODS, 3 * TILE + 8, 2 * TILE + 8);
    const t = ABILITIES.Hide.duration;
    pred.step(0, 0, null);
    pred.useHide(t);
    pred.step(0, 0, null, [null, pred.cooldownOf('Hide')]);
    for (let i = 0; i < 4; i++) pred.step(0, 0, null);
    expect(pred.hidden).toBeCloseTo(t - 4 * CONST.DT, 6);
    // A snapshot from before the server saw the Hide: not hidden there yet.
    pred.reconcile(snap(1, pred.state.x, pred.state.y));
    expect(pred.hidden).toBeCloseTo(t - 4 * CONST.DT, 6);
    // An attack the server has not seen yet ends it, here too.
    pred.useHide(0);
    pred.step(0, 0, null);
    const s = snap(4, pred.state.x, pred.state.y);
    s.me.hidden = t - 2 * CONST.DT;
    pred.reconcile(s);
    expect(pred.hidden).toBe(0);
  });
});
