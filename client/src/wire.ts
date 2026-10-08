// Compact wire forms of snapshots and inputs (docs/compact-snapshots.md).
// The server sends `SnapW` arrays with positions in 1/POS_SCALE px and aim
// in 1/256 turns; unpackSnap rebuilds the readable `Snapshot` the game uses.
import { CONST, EV } from './generated/defs';
import type { EntSnap } from './generated/EntSnap';
import type { Ev } from './generated/Ev';
import type { EvW } from './generated/EvW';
import type { InputMsg } from './generated/InputMsg';
import type { InputW } from './generated/InputW';
import type { SnapW } from './generated/SnapW';
import type { Snapshot } from './generated/Snapshot';

const pos = (v: number): number => v / CONST.POS_SCALE;
/** 0-255 → (-π, π], the range of atan2 on the server (128 = exactly left = +π). */
const angle = (a: number): number => ((a > 128 ? a - 256 : a) / 256) * (2 * Math.PI);

type DmgW = [number, number, number, number, boolean, boolean];
type HealW = [number, number, number, number];
type BoomW = [number, number, number, number, number];
type DiedW = [number, number, number, number, number];
type RaiseW = [number, number, number, boolean];
type ImmuneW = [number, number, number];
type TileW = [number, number, number, number];
type MsgW = [number, string];
type CoinsW = [number, number, number, number];
type SinkW = [number, number, number, number, number];

function unpackEv(e: EvW): Ev {
  switch (e[0]) {
    case EV.Dmg: {
      const [, x, y, v, crit, p] = e as DmgW;
      return { t: 'Dmg', x: pos(x), y: pos(y), v, crit, p };
    }
    case EV.Heal: {
      const [, x, y, v] = e as HealW;
      return { t: 'Heal', x: pos(x), y: pos(y), v };
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
      const [, x, y, fire] = e as RaiseW;
      return { t: 'Raise', x: pos(x), y: pos(y), fire };
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
    default:
      throw new Error(`unknown event code ${e[0]}`);
  }
}

export function unpackSnap(w: SnapW): Snapshot {
  const [tick, ack, ents, me, boss, ev, srv_ms] = w;
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
    },
    boss: boss && { kind: boss[0], hp: boss[1], max_hp: boss[2], immune: boss[3], enraged: boss[4] },
    ev: ev.map(unpackEv),
    srv_ms,
  };
}

export function packInput(i: InputMsg): InputW {
  return [i.seq, i.mx, i.my, i.aim, i.aim_dist, i.primary ?? null, i.secondary ?? null, i.view_lag, i.rtt];
}
