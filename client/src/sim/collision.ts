// Port of server/src/collision.rs. Must stay operation-for-operation identical
// so client prediction matches the server (verified by collision.test.ts).
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap, type Mover } from './map';

const EPS = 0.001;

/** Moves a figure by (dx, dy), axis by axis, sliding along whatever blocks this mover. */
export function moveBox(map: TileMap, x: number, y: number, dx: number, dy: number, r: number, mover: Mover): [number, number] {
  let nx = x + dx;
  if (dx !== 0) {
    const top = Math.floor((y - r) / TILE);
    const bot = Math.floor((y + r - EPS) / TILE);
    if (dx > 0) {
      const tx = Math.floor((nx + r - EPS) / TILE);
      for (let ty = top; ty <= bot; ty++) {
        if (map.blocks(tx, ty, mover)) {
          nx = tx * TILE - r;
          break;
        }
      }
    } else {
      const tx = Math.floor((nx - r) / TILE);
      for (let ty = top; ty <= bot; ty++) {
        if (map.blocks(tx, ty, mover)) {
          nx = (tx + 1) * TILE + r;
          break;
        }
      }
    }
  }
  let ny = y + dy;
  if (dy !== 0) {
    const left = Math.floor((nx - r) / TILE);
    const right = Math.floor((nx + r - EPS) / TILE);
    if (dy > 0) {
      const ty = Math.floor((ny + r - EPS) / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (map.blocks(tx, ty, mover)) {
          ny = ty * TILE - r;
          break;
        }
      }
    } else {
      const ty = Math.floor((ny - r) / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (map.blocks(tx, ty, mover)) {
          ny = (ty + 1) * TILE + r;
          break;
        }
      }
    }
  }
  return [nx, ny];
}

export interface MoveState {
  x: number;
  y: number;
  dashT: number;
  dashDx: number;
  dashDy: number;
}

/** A hero walks (slowed by the terrain under their centre at the start of the step) or dashes (jumping deep water, chasms and lava). */
export function stepMove(
  map: TileMap,
  s: MoveState,
  mx: number,
  my: number,
  speed: number,
  dashSpeed: number,
  r: number,
  dt: number,
): MoveState {
  const n = { ...s };
  const mover: Mover = n.dashT > 0 ? 'dash' : 'hero';
  speed = speed * map.speedFactor(n.x, n.y, mover);
  let vx: number;
  let vy: number;
  if (n.dashT > 0) {
    n.dashT = Math.max(n.dashT - dt, 0);
    vx = n.dashDx * dashSpeed;
    vy = n.dashDy * dashSpeed;
  } else {
    const l = Math.sqrt(mx * mx + my * my);
    if (l > 0) {
      vx = (mx / l) * speed;
      vy = (my / l) * speed;
    } else {
      vx = 0;
      vy = 0;
    }
  }
  const [x, y] = moveBox(map, n.x, n.y, vx * dt, vy * dt, r, mover);
  n.x = x;
  n.y = y;
  return n;
}

export function lineOfSight(map: TileMap, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(Math.ceil(len / 4), 1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (map.opaqueAt(ax + dx * t, ay + dy * t)) return false;
  }
  return true;
}

/** The server's terrain rule: a hero not dashing whose centre is over a chasm or deep water is falling or drowning and moves no more. */
export function sinking(map: TileMap, s: MoveState): boolean {
  if (s.dashT > 0) return false;
  const t = map.tileAt(s.x, s.y);
  return t === TILE_ID.Chasm || t === TILE_ID.DeepWater;
}
