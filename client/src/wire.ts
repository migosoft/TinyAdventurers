// Compact wire forms of snapshots and inputs (docs/compact-snapshots.md).
// The server sends `SnapW` arrays with positions in 1/POS_SCALE px and aim
// in 1/256 turns; unpackSnap rebuilds the readable `Snapshot` the game uses.
import { CONST, EV } from './generated/defs';
import type { EntSnap } from './generated/EntSnap';
import type { Ev } from './generated/Ev';
import type { EvW } from './generated/EvW';
import type { InputMsg } from './generated/InputMsg';
import type { InputW } from './generated/InputW';
import type { MovingLight } from './generated/MovingLight';
import type { SnapW } from './generated/SnapW';
import type { Snapshot } from './generated/Snapshot';
import { isHazardKind } from './game/anim/defs';

const pos = (v: number): number => v / CONST.POS_SCALE;
/** 0-255 → (-π, π], the range of atan2 on the server (128 = exactly left = +π). */
const angle = (a: number): number => ((a > 128 ? a - 256 : a) / 256) * (2 * Math.PI);
/** The hit-direction byte of an entity (`hurt_byte` on the server): null = no direction, else 1..255 → (-π, π]. */
export const hurtDirOf = (b: number): number | null => {
  if (b === 0) return null;
  const a = ((b - 1) / 255) * 2 * Math.PI;
  return a > Math.PI ? a - 2 * Math.PI : a;
};
/** The head-angle byte (`head_byte`): 128 = straight ahead, 1 and 255 = ∓π. */
export const headOf = (b: number): number => ((b - 128) / 127) * Math.PI;
/** The drowning-stage byte of a creature `t` s in deep water (the server's `drown_byte`; for dev pages and tests): 0 outside the water. */
export const drownByte = (t: number, breathless = false): number => (t <= 0 ? 0 : 1 + Math.min(Math.round(t * 10), 126) + (breathless ? 128 : 0));
/** The drowning-stage byte (`drown_byte`): null = not in the drowning state, else the seconds in deep water (1/10 s steps) and whether the creature is breathless (no bubbles). */
export const drownOf = (b: number): { t: number; breathless: boolean } | null => {
  const n = b & 127;
  return n === 0 ? null : { t: (n - 1) / 10, breathless: (b & 128) !== 0 };
};

type DmgW = [number, number, number, number, boolean, boolean, number, boolean];
type HealW = [number, number, number, number, boolean];
type BoomW = [number, number, number, number, number];
type DiedW = [number, number, number, number, number];
type RaiseW = [number, number, number, number];
type ImmuneW = [number, number, number];
type TileW = [number, number, number, number];
type MsgW = [number, string];
type CoinsW = [number, number, number, number];
type SinkW = [number, number, number, number, number];
type LightEvW = [number, number, boolean, number];
type LightAddW = [number, number, number, number, number, number, boolean, number];
type LightRemoveW = [number, number];
type EffectW = [number, number, number, boolean, number];
type ZapW = [number, number, number, number, number];
type CastW = [number, number, number, number, number, number, number, number];
type LandW = [number, number, number, number, number, number, number];
type CueW = [number, number, number, number, number];

function unpackEv(e: EvW): Ev {
  switch (e[0]) {
    case EV.Dmg: {
      const [, x, y, v, crit, p, ty, imm] = e as DmgW;
      return { t: 'Dmg', x: pos(x), y: pos(y), v, crit, p, ty, imm };
    }
    case EV.Heal: {
      const [, x, y, v, p] = e as HealW;
      return { t: 'Heal', x: pos(x), y: pos(y), v, p };
    }
    case EV.Boom: {
      const [, x, y, r, k] = e as BoomW;
      return { t: 'Boom', x: pos(x), y: pos(y), r, k };
    }
    case EV.Died: {
      const [, id, x, y, kind] = e as DiedW;
      return { t: 'Died', id, x: pos(x), y: pos(y), kind };
    }
    case EV.Raise: {
      const [, x, y, k] = e as RaiseW;
      return { t: 'Raise', x: pos(x), y: pos(y), k };
    }
    case EV.Immune: {
      const [, x, y] = e as ImmuneW;
      return { t: 'Immune', x: pos(x), y: pos(y) };
    }
    case EV.Tile: {
      const [, x, y, v] = e as TileW;
      return { t: 'Tile', x, y, v };
    }
    case EV.Msg: {
      const [, text] = e as MsgW;
      return { t: 'Msg', text };
    }
    case EV.Coins: {
      const [, x, y, v] = e as CoinsW;
      return { t: 'Coins', x: pos(x), y: pos(y), v };
    }
    case EV.Sink: {
      const [, id, x, y, how] = e as SinkW;
      return { t: 'Sink', id, x: pos(x), y: pos(y), how };
    }
    case EV.Light: {
      const [, id, on, colour] = e as LightEvW;
      return { t: 'Light', id, on, colour };
    }
    case EV.LightAdd: {
      const [, id, kind, colour, x, y, on, wall] = e as LightAddW;
      return { t: 'LightAdd', id, kind, colour, x, y, on, wall };
    }
    case EV.LightRemove: {
      const [, id] = e as LightRemoveW;
      return { t: 'LightRemove', id };
    }
    case EV.Effect: {
      const [, id, kind, on, look] = e as EffectW;
      return { t: 'Effect', id, kind, on, look };
    }
    case EV.Zap: {
      const [, x, y, x2, y2] = e as ZapW;
      return { t: 'Zap', x: pos(x), y: pos(y), x2: pos(x2), y2: pos(y2) };
    }
    case EV.Cast: {
      const [, id, x, y, look, windup_ms, primary, aim] = e as CastW;
      return { t: 'Cast', id, x: pos(x), y: pos(y), look, windup_ms, primary: primary !== 0, aim: angle(aim) };
    }
    case EV.Land: {
      const [, id, x, y, kind, aim, extra] = e as LandW;
      return { t: 'Land', id, x: pos(x), y: pos(y), kind, aim: angle(aim), extra };
    }
    case EV.Cue: {
      const [, id, x, y, k] = e as CueW;
      return { t: 'Cue', id, x: pos(x), y: pos(y), k };
    }
    default:
      throw new Error(`unknown event code ${e[0]}`);
  }
}

export function unpackSnap(w: SnapW): Snapshot {
  const [tick, ack, ents, me, boss, ev, srv_ms, drain, lights, looks, dark, dark_ev, solids] = w;
  return {
    tick,
    ack,
    // Element 6 is the aim in 1/256 turns, but a hazard's radius in whole px (no angle to wrap).
    ents: ents.map((e): EntSnap => [e[0], e[1], pos(e[2]), pos(e[3]), e[4], e[5], isHazardKind(e[1]) ? e[6] : angle(e[6]), e[7], e[8], e[9], e[10], e[11], e[12], e[13], e[14]]),
    me: {
      alive: me[0],
      hp: me[1],
      max_hp: me[2],
      x: me[3],
      y: me[4],
      dash_t: me[5],
      dash_dx: me[6],
      dash_dy: me[7],
      cd1: me[8],
      cd2: me[9],
      spectating: me[10],
      knock_vx: me[11]?.[0] ?? 0,
      knock_vy: me[11]?.[1] ?? 0,
      darkvision: me[12],
      vision: me[13],
      effects: me[14],
      speed_mul: me[15],
      no_act: me[16],
      cd_mul: me[17],
      cd_rate: me[18],
      paused_items: me[19],
      paused_nodes: me[20],
      charmed_by: me[21],
      water_t: me[22],
    },
    boss: boss && { kind: boss[0], hp: boss[1], max_hp: boss[2], immune: boss[3] },
    ev: ev.map(unpackEv),
    drain: drain && Array.from({ length: drain.length / 2 }, (_, i): [number, number] => [pos(drain[2 * i]), pos(drain[2 * i + 1])]),
    lights: lights.map((l): MovingLight => [pos(l[0]), pos(l[1]), l[2], l[3]]),
    looks,
    dark,
    dark_ev,
    solids: Array.from({ length: solids.length / 3 }, (_, i): [number, number, number] => [pos(solids[3 * i]), pos(solids[3 * i + 1]), pos(solids[3 * i + 2])]),
    srv_ms,
    log: w[13] ?? null,
  };
}

export function packInput(i: InputMsg): InputW {
  return [i.seq, i.mx, i.my, i.aim, i.aim_dist, i.primary ?? null, i.secondary ?? null, i.view_lag, i.rtt, i.act ?? false];
}
