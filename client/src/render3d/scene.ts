// The demo scene's state and step: figures, props and torches, in world units (tiles).
import type { TileMap } from '../sim/map';
import { heightAt } from './heights';

export type FigKind = 'knight' | 'wizard' | 'elf' | 'orc' | 'skelet' | 'demon';
export interface Ent {
  kind: FigKind; x: number; z: number; vx: number; vz: number; fx: number; fz: number;
  flip: boolean; moving: boolean; t: number; speed: number; path?: [number, number][]; at: number; pause: number; wait: number;
}
export interface Torch { x: number; y: number; z: number; ph: number }
/** ents[0] is the player. */
export interface SceneState { player: Ent; ents: Ent[]; props: { frame: string; x: number; z: number }[]; torches: Torch[] }

const PLAYER_R = 0.28;

function ent(kind: FigKind, x: number, z: number, speed: number, t: number, path?: [number, number][], pause = 0): Ent {
  return { kind, x, z, vx: 0, vz: 0, fx: 1, fz: 0, flip: false, moving: false, t, speed, path, at: 1, pause, wait: 0 };
}

export function newScene(): SceneState {
  const player = ent('knight', 10.4, 7.4, 4.6, 0);
  // The demo starts walkers at random animation phases; fixed offsets keep the scene deterministic.
  const walker = (kind: FigKind, path: [number, number][], speed: number, pause: number, t: number) =>
    ent(kind, path[0][0], path[0][1], speed, t, path, pause);
  const ents = [
    player,
    walker('skelet', [[5.4, 3.3], [9.4, 3.3], [9.4, 5.7], [5.4, 5.7]], 2.2, 0, 0.7),
    walker('orc', [[9, 7.2], [16.2, 6.1], [13.2, 9.6], [8.2, 9.4]], 1.8, 1.2, 1.9),
    walker('elf', [[24, 5.9], [17.2, 5.9], [17.2, 3.4], [20.6, 3.4], [20.6, 5.9]], 3.2, 0.8, 2.6),
    walker('demon', [[17, 3.5], [20.6, 3.6], [19, 7.4], [16.6, 6.6]], 1.2, 2.5, 3.3),
    ent('wizard', 11.2, 3.1, 0, 0),
  ];
  const props = [
    { frame: 'crate', x: 20.4, z: 9.3 }, { frame: 'crate', x: 21.3, z: 9.9 }, { frame: 'crate', x: 2.6, z: 2.9 },
  ];
  // The demo has the first four; the last two light the new corridor and room.
  const torches = [[5, 1], [12, 1], [18, 1], [23, 4], [34, 4], [30, 12]]
    .map(([cx, cz], i) => ({ x: cx + 0.5, y: 1.0, z: cz + 1 + 0.16, ph: i * 1.7 }));
  return { player, ents, props, torches };
}

/** The moving light's orbit: a slow ellipse with a small bob. */
export function orbAt(t: number): { x: number; y: number; z: number } {
  const a = 0.42 * t;
  return { x: 12.2 + 6.6 * Math.cos(a), y: 0.95 + 0.12 * Math.sin(2.1 * t), z: 6.45 + 1.25 * Math.sin(a) };
}

/** Frame time in seconds, clamped to 0.001..0.05. */
export function frameDt(nowS: number, lastS: number): number {
  return Math.min(0.05, Math.max(0.001, nowS - lastS));
}

/** Whether a circle of radius r at (x, z) hits a wall corner cell or a prop (demo `blocked`). */
export function blocked(m: TileMap, s: SceneState, x: number, z: number, r: number): boolean {
  for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) if (heightAt(m, Math.floor(x + dx), Math.floor(z + dz)) > 0) return true;
  for (const p of s.props) if (Math.hypot(x - p.x, z - (p.z - 0.25)) < 0.5 + r * 0.5) return true;
  return false;
}

export function stepScene(m: TileMap, s: SceneState, move: { x: number; z: number }, dt: number): void {
  const p = s.player;
  const il = Math.hypot(move.x, move.z) || 1;
  const sx = (move.x / il) * p.speed * dt, sz = (move.z / il) * p.speed * dt;
  const px = p.x, pz = p.z;
  if (!blocked(m, s, p.x + sx, p.z, PLAYER_R)) p.x += sx;
  if (!blocked(m, s, p.x, p.z + sz, PLAYER_R)) p.z += sz;
  p.vx = (p.x - px) / dt;
  p.vz = (p.z - pz) / dt;
  p.moving = Math.hypot(p.vx, p.vz) > 0.3;
  if (move.x || move.z) { p.fx = move.x; p.fz = move.z; }

  for (const e of s.ents) {
    e.t += dt;
    if (!e.path) continue;
    if (e.wait > 0) { e.wait -= dt; e.vx = e.vz = 0; e.moving = false; continue; }
    const [tx, tz] = e.path[e.at];
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz), step = e.speed * dt;
    if (d <= step) { e.x = tx; e.z = tz; e.at = (e.at + 1) % e.path.length; e.wait = e.pause; continue; }
    e.vx = (dx / d) * e.speed; e.vz = (dz / d) * e.speed;
    e.x += e.vx * dt; e.z += e.vz * dt;
    e.moving = true;
    e.fx = dx; e.fz = dz;
  }
}

const BASE: Record<FigKind, string> = {
  knight: 'knight_m', wizard: 'wizzard_m', elf: 'elf_f', orc: 'orc_warrior', skelet: 'skelet', demon: 'big_demon',
};

/** Atlas frame name of the figure's current animation frame (idle 5/s, run 9/s; the wizard has no run). */
export function frameOf(e: Ent): string {
  const run = e.moving && e.kind !== 'wizard';
  return `${BASE[e.kind]}_${run ? 'run' : 'idle'}_anim_f${Math.floor(e.t * (run ? 9 : 5)) % 4}`;
}
