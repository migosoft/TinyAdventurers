// Fakes for the run session's tests (and for a 3D view's tests): a net that
// records what is sent, a HUD that records its calls, a view that records its
// frames, and builders for a small run.
import { TILE_ID } from '../generated/defs';
import type { ClientMsg } from '../generated/ClientMsg';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Snapshot } from '../generated/Snapshot';
import type { HudLike, NetLike } from './session';
import type { PictureEv, RunFrame, RunView, ShotView } from './view';
import { NO_STATS } from './view';

const GLYPH: Record<string, number> = { '#': TILE_ID.Wall, '.': TILE_ID.Floor, D: TILE_ID.DoorOpen, ' ': TILE_ID.Void };

const ability = (id: ResolvedAbility['id']): ResolvedAbility => ({
  id,
  cooldown: 1,
  cd_steps: { base: 1, attr: 'Dex', have: 10, scaled: 1, mods: 1 },
  damage: 1,
  range: 100,
  arc: 0,
  speed: 100,
  radius: 4,
  duration: 0.2,
  pierce: 0,
  pierce_through: 0,
  ranged: false,
  projectile: null,
  split: { Physical: 1 },
  windup: 0,
  behind: 0,
  per_cast: 0,
  alive: 0,
});

/** A run start from ASCII rows: '#' Wall, '.' Floor, 'D' DoorOpen, ' ' Void. You are entity 1; one player; spawn at the first '.'. */
export function startInfo(rows: string[], over: Partial<RunStartInfo> = {}): RunStartInfo {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const tiles = new Uint8Array(width * height);
  let spawn: [number, number] | null = null;
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const c = row[x] ?? ' ';
      tiles[y * width + x] = GLYPH[c] ?? TILE_ID.Void;
      if (c === '.' && !spawn) spawn = [x, y];
    }
  });
  const [sx, sy] = spawn ?? [1, 1];
  return {
    level: 'Dungeon',
    width,
    height,
    tiles,
    tile_size: 16,
    you: 1,
    players: [{ ent: 1, name: 'Hero', class: 'Wizard', melee: 'KnightSword', ranged: null }],
    spawn_x: sx * 16 + 8,
    spawn_y: sy * 16 + 8,
    speed: 60,
    abilities: [ability('MagicMissile'), ability('Fireball')],
    fallback: ability('Strike'),
    lights: [],
    debug: false,
    cove: null,
    daylight: false,
    woodland: null,
    ...over,
  };
}

export function fakeNet(): NetLike & { sent: ClientMsg[]; emit(m: ServerMsg): void } {
  const handlers = new Set<(m: ServerMsg) => void>();
  const sent: ClientMsg[] = [];
  return {
    sent,
    rtt: 50,
    lastSnapshotBytes: 0,
    on(h) {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    send(m) {
      sent.push(m);
    },
    emit(m) {
      for (const h of [...handlers]) h(m);
    },
  };
}

export function fakeHud(): HudLike & { calls: [name: string, ...args: unknown[]][]; statsOn: boolean; menuOpen: boolean } {
  const calls: [string, ...unknown[]][] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    statsOn: false,
    menuOpen: false,
    startRun: rec('startRun'),
    setDebug: rec('setDebug'),
    snapshot: rec('snapshot'),
    message: rec('message'),
    setAbilities: rec('setAbilities'),
    showEnd: rec('showEnd'),
    addCoins: rec('addCoins'),
    needs: rec('needs'),
    tooClose: rec('tooClose'),
    frame: rec('frame'),
    setAsleep: rec('setAsleep'),
    toggleDebug() {
      this.statsOn = !this.statsOn;
      calls.push(['toggleDebug']);
    },
    toggleMenu() {
      this.menuOpen = !this.menuOpen;
      calls.push(['toggleMenu']);
    },
  };
}

export function fakeView(
  pointer: { x: number; y: number } | null = null,
): RunView & { frames: RunFrame[]; events: PictureEv[]; tiles: [number, number, number][]; ended: [ShotView, string][]; onTile?: (x: number, y: number, v: number) => void } {
  const v = {
    frames: [] as RunFrame[],
    events: [] as PictureEv[],
    tiles: [] as [number, number, number][],
    ended: [] as [ShotView, string][],
    onTile: undefined as ((x: number, y: number, v: number) => void) | undefined,
    frame(f: RunFrame) {
      v.frames.push(f);
      return NO_STATS;
    },
    event(ev: PictureEv) {
      v.events.push(ev);
    },
    tileChanged(x: number, y: number, t: number) {
      v.onTile?.(x, y, t);
      v.tiles.push([x, y, t]);
    },
    shotEnded(s: ShotView, how: 'wall' | 'enemy' | 'gone') {
      v.ended.push([s, how]);
    },
    pointerWorld: () => pointer,
    destroy() {},
  };
  return v;
}

/** A snapshot with a living own hero at the spawn tile (1, 1) centre and no entities. */
export function snap(over: Partial<Snapshot> = {}): Extract<ServerMsg, { t: 'Snap' }> {
  return {
    t: 'Snap',
    tick: 1,
    ack: 0,
    ents: [],
    me: {
      alive: true,
      hp: 10,
      max_hp: 10,
      x: 24,
      y: 24,
      dash_t: 0,
      dash_dx: 0,
      dash_dy: 0,
      knock_vx: 0,
      knock_vy: 0,
      cd1: 0,
      cd2: 0,
      spectating: null,
      darkvision: 0,
      vision: 8,
      effects: [],
      paused_items: [],
      paused_nodes: [],
      speed_mul: 1,
      no_act: false,
      cd_mul: 1,
      cd_rate: 1,
      charmed_by: null,
    },
    boss: null,
    ev: [],
    drain: null,
    lights: [],
    looks: [],
    srv_ms: 0,
    log: null,
    ...over,
  } as Extract<ServerMsg, { t: 'Snap' }>;
}
