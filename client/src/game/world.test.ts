import { describe, expect, it } from 'vitest';
import { CONST, TILE_ID } from '../generated/defs';
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
  const me = { alive: true, hp: 100, max_hp: 100, x, y, dash_t: 0, dash_dx: 0, dash_dy: 0, knock_vx: 0, knock_vy: 0, cd1: 0, cd2: 0, hidden: 0, spectating: null };
  return { tick: ack, ack, ents: [], me, boss: null, ev: [], drain: null, srv_ms: 0 };
}

describe('Predictor', () => {
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
});
