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

const pos = (v: number): number => v / CONST.POS_SCALE;
/** 0-255 → (-π, π], the range of atan2 on the server (128 = exactly left = +π). */
const angle = (a: number): number => ((a > 128 ? a - 256 : a) / 256) * (2 * Math.PI);

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
type LightAddW = [number, number, number, number, number, number, boolean];
type LightRemoveW = [number, number];

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
      const [, id, kind, colour, x, y, on] = e as LightAddW;
      return { t: 'LightAdd', id, kind, colour, x, y, on };
    }
    case EV.LightRemove: {
      const [, id] = e as LightRemoveW;
      return { t: 'LightRemove', id };
    }
    default:
      throw new Error(`unknown event code ${e[0]}`);
  }
}

export function unpackSnap(w: SnapW): Snapshot {
  const [tick, ack, ents, me, boss, ev, srv_ms, drain, lights] = w;
  return {
    tick,
    ack,
    ents: ents.map((e): EntSnap => [e[0], e[1], pos(e[2]), pos(e[3]), e[4], e[5], angle(e[6]), e[7], e[8], e[9]]),
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
      hidden: me[10],
      spectating: me[11],
      knock_vx: me[12]?.[0] ?? 0,
      knock_vy: me[12]?.[1] ?? 0,
      darkvision: me[13],
    },
    boss: boss && { kind: boss[0], hp: boss[1], max_hp: boss[2], immune: boss[3], enraged: boss[4] },
    ev: ev.map(unpackEv),
    drain: drain && Array.from({ length: drain.length / 2 }, (_, i): [number, number] => [pos(drain[2 * i]), pos(drain[2 * i + 1])]),
    lights: lights.map((l): MovingLight => [pos(l[0]), pos(l[1]), l[2], l[3]]),
    srv_ms,
  };
}

export function packInput(i: InputMsg): InputW {
  return [i.seq, i.mx, i.my, i.aim, i.aim_dist, i.primary ?? null, i.secondary ?? null, i.view_lag, i.rtt, i.act ?? false];
}
