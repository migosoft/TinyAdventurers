// The stage of the ?r3d=demon page (#379): the built demon on the game's own code, no server. The lich's boss hall (`createHallStage`:
// the torches on the pillars, the knight on WASD, the frame loop and the pinned replay) with a lava pool and a chasm, and the demon an
// entity of `KIND.Demon` whose state is what a run would send (`demonAct`, demonScript.ts). It looks at the knight:
// its body turns to him, or with `&face=` only its head; the acts `walk` and `swoop` go there and back on a fixed line.
// Query: `&act=` (demonScript.ts), `&at=<s>` (pins the act's clock, seconds of its loop), `&face=<deg>` (a fixed aim), `&t=<s>` (pins the
// page's clock: the stage steps to it from rest in steps of 1/30 s, then holds still), `&zoom=`, `&light=work`,
// `&fx=frozen|chilled|stone`, `&px=&pz=` (the demon's place, tiles), `&slow=<n>` (the page's clock n times slower), `&demon=0` (no demon,
// for the cost), `&fold=<0..1>` (both wings' fold, where the act does not set it), `&two=1` (a second demon 3 tiles west). Readouts: `window.__r3d.built` and `window.__r3d.demonMs` (the mean of `Figures3d.frame` in ms).
// `&at=` without `&t=` pins the page at 3 s.
import { CONST, EFFECT, KIND, SIDE } from '../generated/defs';
import { TERRAIN } from '../game/terrain-layers';
import { builtOf } from './built';
import { DEMON_DEV } from './demon/figure';
import { DEMON_POSE } from './demon/pose';
import { actPeriod, DEMON_ACTS, demonAct, demonDev, type DemonAct } from './demonScript';
import type { EntState } from '../game/world';
import { fxEnt } from './fxStage';
import type { Host, Stage } from './host';
import { BOSS_ID, createHallStage, HALL_CENTRE, hallMap, queryNum, type HallPool } from './lichStage';
import type { R3dParams } from './params';
import type { Assets } from './view';

/** The lava pool east of the demon and the chasm west of it (map tiles, both ends included). */
const POOLS: HallPool[] = [
  { x0: 19, x1: 22, z0: 10, z1: 13, tile: TERRAIN.Lava },
  { x0: 7, x1: 10, z0: 12, z1: 15, tile: TERRAIN.Chasm },
];
/** The facing of an act that goes there and back (`walk`, `swoop`), and the furthest the head turns after the knight (rad). */
const WAY = (30 * Math.PI) / 180, HEAD = DEMON_POSE.neck, TILE = CONST.TILE;
const FX_NAMES =['frozen', 'chilled', 'stone'] as const;
type FxName = (typeof FX_NAMES)[number];

export const demonMap = (): ReturnType<typeof hallMap> => hallMap(POOLS);

export interface DemonOpts {
  act: DemonAct; at: number | null; pinned: number | null; face: number | null; fx: FxName | null; px: number | null; pz: number | null; slow: number; demon: boolean; fold: number | null; two: boolean;
}

export function parseDemon(search: string): DemonOpts {
  const q = new URLSearchParams(search);
  const num = (k: string): number | null => queryNum(q, k);
  const act = q.get('act') as DemonAct, fx = q.get('fx') as FxName, face = num('face'), slow = num('slow');
  return {
    act: DEMON_ACTS.includes(act) ? act : 'stand', at: num('at'), pinned: num('t'), face: face === null ? null : (face * Math.PI) / 180,
    fx: FX_NAMES.includes(fx) ? fx : null, px: num('px'), pz: num('pz'), slow: slow !== null && slow > 0 ? slow : 1, demon: q.get('demon') !== '0', fold: num('fold'), two: q.get('two') === '1',
  };
}

export function createDemonStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setPageButtons' | 'syncPageButtons' | 'params' | 'setParams'>): Stage {
  const opts = parseDemon(search);
  const demon = { x: opts.px ?? HALL_CENTRE.x, z: opts.pz ?? HALL_CENTRE.z, aim: opts.face ?? WAY, head: 0, ox: 0, oz: 0 };
  const state = { act: opts.act, origin: 0, frozen: opts.fx === 'frozen', chilled: opts.fx === 'chilled', stone: opts.fx === 'stone' };
  const toggle = (name: string, key: 'frozen' | 'chilled' | 'stone') => ({ name, pressed: () => state[key], press: () => { state[key] = !state[key]; } });
  // `&at=` without `&t=` pins the page too (at 3 s).
  const pin = opts.pinned ?? (opts.at !== null ? 3 : null);
  /** Seconds of the act's loop at page time `t`: `&at=` pins it to the pinned time's end, else it runs from the act's start. */
  const actClock = (t: number): number => (opts.at !== null ? opts.at - (pin! - t) : t - state.origin);

  return createHallStage(assets, p, demonMap(), {
    name: 'demon', picture: builtOf(KIND.Demon)!.picture, at: demon, pin, slow: opts.slow,
    buttons: (now) => [
      ...DEMON_ACTS.map((a) => ({ name: a, pressed: () => state.act === a, press: () => { state.act = a; state.origin = now(); } })),
      toggle('Frozen', 'frozen'), toggle('Chilled', 'chilled'), toggle('Stone', 'stone'),
      { name: 'Work light', pressed: () => host!.params.light === 'work', press: () => { host!.setParams({ ...host!.params, light: host!.params.light === 'work' ? 'game' : 'work' }); } },
    ],
    sim(_dt, t, knight): void {
      const dev = demonDev(state.act, actClock(t)), toKnight = Math.atan2(knight.z - demon.z, knight.x - demon.x);
      // an act that goes there and back keeps its line; with a fixed aim the head alone follows the knight, as in a run
      const face = opts.face ?? (state.act === 'walk' || state.act === 'swoop' ? WAY : toKnight);
      demon.aim = face + dev.turn;
      demon.head = opts.face === null ? 0 : Math.max(-HEAD, Math.min(HEAD, Math.atan2(Math.sin(toKnight - demon.aim), Math.cos(toKnight - demon.aim))));
      demon.ox = (Math.cos(face) * dev.along) / TILE; demon.oz = (Math.sin(face) * dev.along) / TILE;
    },
    ents(t) {
      DEMON_DEV.fold = demonDev(state.act, actClock(t)).fold ?? opts.fold;
      if (!opts.demon) return { ents: [], drain: null };
      const effects = (state.frozen ? 1 << EFFECT.Frozen : 0) | (state.chilled ? 1 << EFFECT.Chilled : 0) | (state.stone ? 1 << EFFECT.Petrified : 0);
      const one = (id: number, dx: number): EntState => fxEnt(id, KIND.Demon, demon.x + demon.ox + dx, demon.z + demon.oz, { side: SIDE.Hostile, aim: demon.aim, head: demon.head, ...demonAct(state.act, actClock(t)), effects });
      return { ents: opts.two ? [one(BOSS_ID, 0), one(BOSS_ID + 2, -3)] : [one(BOSS_ID, 0)], drain: null };
    },
    label: (clock) => `demon (#379): ${state.act}; act ${actClock(clock).toFixed(2)} of ${actPeriod(state.act).toFixed(2)} s; t ${clock.toFixed(2)} s; WASD moves the knight`,
  }, host);
}
