// The stage of the ?r3d=gallery page (#303): every figure kind cycling through its states, the status-effect looks, the board
// objects and shots, and a corridor behind a full-height wall where things walk for the see-through check. It runs on the real
// path of a run: a synthetic `RunFrame` goes through `Figures3d`, its openers through `seenOpeners` (all visible here), and the
// result into `FrameInput.see`. No server, no login.
import { ANIM, CONST, EFFECT, FLAG, HITBOX, KIND, LIGHT_KIND, SIDE } from '../generated/defs';
import { LightField } from '../game/light';
import type { PictureEv } from '../run/view';
import type { RunStartInfo } from '../generated/RunStartInfo';
import { FIGURES, PROJECTILES, isPlayerKind } from '../game/anim/defs';
import type { EntState } from '../game/world';
import type { RunFrame, RunViewInit } from '../run/view';
import { atlasBounds } from './atlasBounds';
import { closeCam, freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { Effects3d } from './fx/effects3d';
import { FxPass } from './fx/pass';
import { groundRing } from './fx/shapes';
import { clearVeils } from './fx/status';
import { FxTris } from './fx/tris';
import type { DrawnFig } from './fx/types';
import { CROWD_MAX, EFFECT_GROUPS, LINEUP_MAX, OBJECT_PLACES, SPECTRE_PLACES, VARIETY_COLS, GROUP_CELLS, MODEL_EFFECT_STRIDE, OBJECT_Z, SHOT_Z, TORCH_Z, layoutOf } from './galleryMap';
import { MOVE_KEYS, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, lightView, selectCasters, selectLights, staticCands, torchOf, TorchPairs } from './lights';
import type { FigureKit } from './models/kit';
import { MODEL_OF_KIND, OBJECT_MODEL, floats, objectModelOf, type ModelKey } from './models/table';
import { seenOpeners } from './openers';
import { seeLook } from './seeThrough';
import { createStageKit, modelsReadouter } from './stageKit';
import type { Assets, WorldInput } from './view';
import { Water3d } from './water/water';
import { reflects } from './params';

const TILE = 16;
/** The free camera's speed in tiles per second. */
const PAN_SPEED = 12;

/** The figure states the rows cycle through. */
export const STATES: [string, number][] = [
  ['idle', ANIM.Idle],
  ['move', ANIM.Move],
  ['melee', ANIM.Melee],
  ['shoot', ANIM.Shoot],
  ['cast', ANIM.Cast],
  ['windup', ANIM.Windup],
  ['dash', ANIM.Dash],
  ['channel', ANIM.Channel],
  ['breath', ANIM.Breath],
  ['tail', ANIM.Tail],
  ['bite', ANIM.Bite],
  ['takeoff', ANIM.TakeOff],
  ['land', ANIM.Land],
];

export const GALLERY = layoutOf(Object.keys(FIGURES).length, Object.keys(MODEL_OF_KIND).length);

/** Entity ids by part of the stage. */
export const ID = {
  figure: 100,
  effect: 1000,
  object: 2000,
  barrelCycle: 2003,
  shot: 2500,
  corridor: 3000,
  corridorBarrel: 3009,
  corridorKnight: 3010,
  /** What opens walls in the corridor: the hero, five skeletons, the wolf, the chest and the closed mimic. */
  corridorOpeners: [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008],
  /** The 3D models (#338): one row per kind with a model, the effect rows (`+ row * MODEL_EFFECT_STRIDE + col`), the figures that die, the pillars' torches, the crowd. */
  model: 4000,
  modelEffect: 4100,
  dying: 4300,
  /** The variety block (#357): `+ row * 10 + col`. Its ids decide what each animal looks like. */
  variety: 4500,
  /** The size line-up (#356): `+ place`. */
  lineup: 4700,
  /** The spectre block (#359): `+ place` (`SPECTRE_PLACES` of them). */
  spectre: 4800,
  /** The kind rows' pillar torches (`+ i`, 4 per kind row: 12 at the present kind count, room for `SPECTRE_TORCH_ID`); the spectre block's six are `+ SPECTRE_TORCH_ID + j`. */
  pillarTorch: 4900,
  crowd: 5000,
} as const;

/** Where the spectre block's torches start among the `ID.pillarTorch` ids (the kind rows' torches stay below it). */
const SPECTRE_TORCH_ID = 20;

export type Focus = 'figures' | 'corridor' | 'effects' | 'objects' | 'models' | 'lineup';
export interface GalleryOpts {
  state: string | null; slow: number; focus: Focus; start: number;
  /** Walking model figures added in a 2 tile grid, and whether they are drawn as models or as cards. */
  crowd: number; crowdAs: 'models' | 'cards';
  /** `&crowdKinds=<model key>,...`: the crowd cycles through the kinds wearing these models (null: every kind with a model). */
  crowdKinds: number[] | null;
  /** `torch`: the gallery is lit by its torches through the game's lights and casters, not by the work light. */
  light: 'work' | 'torch';
  /** The camera's start in tiles (overrides the focus). */
  at: { x: number; z: number } | null;
  /** `&aim=<deg>` (radians here): pins the aim of the figure rows and the model rows (90 faces the camera). */
  aim: number | null;
  /** `&circles=1`: a ring on the ground under every figure of the line-up, the server's hit circle of its kind. */
  circles: boolean;
}

/**
 * `&state=<name>` pins one state, `&slow=<n>` slows the clock, `&focus=` picks where the camera starts (`&at=x,z` in tiles, or
 * `&at=model:<i>` / `effect:<row>,<col>` / `dying:<i>` / `crowd:<i>` / `lineup:<place>` / `object:<place>` / `variety:<row>` (the middle of the row), overrides it;
 * `&focus=lineup` is the size line-up of every model key, shortest left, whole row in one picture at `&zoom=1`),
 * `&t=<s>` starts the clock there (the hurt flash is on at 0), `&crowd=<n>` adds walking model figures (`&crowdAs=cards` as cards),
 * `&light=torch` lights it with the torches.
 */
export function parseGallery(search: string): GalleryOpts {
  const q = new URLSearchParams(search);
  const state = q.get('state');
  const slow = Number(q.get('slow') ?? 1);
  const focus = q.get('focus');
  const start = Number(q.get('t') ?? 0);
  const crowd = Math.floor(Number(q.get('crowd') ?? 0));
  // The kinds of the named models, in the order named; unknown keys are dropped.
  const crowdKinds = (q.get('crowdKinds') ?? '').split(',').flatMap((key) => MODEL_KINDS.filter((k) => MODEL_OF_KIND[k] === key));
  const atRaw = q.get('at') ?? '';
  // `at=x,z` in tiles, or the foot of a figure of the model block: `model:<kind>`, `effect:<row>,<col>`, `dying:<i>`, `crowd:<i>`.
  const named = /^(model|effect|dying|crowd|variety|lineup|object|spectre):(\d+)(?:,(\d+))?$/.exec(atRaw);
  const at = named
    ? (() => {
      const [, what, a, b] = named;
      const n = Number(a);
      if (what === 'object') return GALLERY.object(Math.min(n, OBJECT_PLACES - 1));
      if (what === 'lineup') return GALLERY.lineup(Math.min(n, LINEUP_MAX - 1));
      if (what === 'spectre') return GALLERY.spectre(Math.min(n, SPECTRE_PLACES - 1));
      if (what === 'variety') return GALLERY.variety(n, b === undefined ? (VARIETY_COLS - 1) / 2 : Number(b));
      return what === 'model' ? GALLERY.model(n) : what === 'effect' ? GALLERY.modelEffect(n, Number(b ?? 0)) : what === 'dying' ? GALLERY.dying(n) : GALLERY.crowd(n);
    })()
    : null;
  const xz = atRaw.split(',').map(Number);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 0,
    state: STATES.some(([n]) => n === state) ? state : null,
    slow: Number.isFinite(slow) && slow > 0 ? slow : 1,
    focus: focus === 'corridor' || focus === 'effects' || focus === 'objects' || focus === 'models' || focus === 'lineup' ? focus : 'figures',
    crowd: Number.isFinite(crowd) && crowd > 0 ? Math.min(crowd, CROWD_MAX) : 0,
    crowdAs: q.get('crowdAs') === 'cards' ? 'cards' : 'models',
    crowdKinds: crowdKinds.length > 0 ? crowdKinds : null,
    light: q.get('light') === 'torch' ? 'torch' : 'work',
    at: at ?? (xz.length === 2 && xz.every(Number.isFinite) ? { x: xz[0], z: xz[1] } : null),
    aim: q.get('aim') !== null && Number.isFinite(Number(q.get('aim'))) ? (Number(q.get('aim')) * Math.PI) / 180 : null,
    circles: q.get('circles') === '1',
  };
}

/** Which entities the stage draws as 3D models: the model blocks (ids from `ID.model` up, the variety block included), the crowd unless it is cards, and under `&focus=models` the object row's chests, barrels and Mimics (#317). */
export function modelsOf(o: GalleryOpts): (e: EntState) => boolean {
  return (e) => (e.id >= ID.object && e.id < ID.shot ? o.focus === 'models' && objectModelOf(e.kind) !== null : e.id >= ID.model && (e.id < ID.crowd || o.crowdAs === 'models'));
}

/** A figure of the model blocks whose kind floats (the Ghost, the Shade) is incorporeal, as in a run; the card rows are as they were. */
const ent = (id: number, kind: number, x: number, z: number, o: Partial<EntState> = {}): EntState => {
  const e: EntState = {
    id, kind, x: x * TILE, y: z * TILE, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
    side: isPlayerKind(kind) ? SIDE.Friendly : SIDE.Hostile, entangled: 0, ...o,
  };
  if (id >= ID.model && floats(kind)) e.flags |= FLAG.INCORPOREAL;
  return e;
};

/** The effect groups: what each shows, in order (the last is the party, invisible). */
const EFFECT_ROWS: { effect?: number; flag?: number; run?: boolean }[] = [
  { effect: EFFECT.Sleep }, { effect: EFFECT.Petrified }, { effect: EFFECT.Frozen }, { effect: EFFECT.Slowed, run: true }, { effect: EFFECT.Poisoned },
  { effect: EFFECT.Chilled, run: true }, { effect: EFFECT.Tainted }, { flag: FLAG.INCORPOREAL }, {}, { effect: EFFECT.Invisible },
];
const EFFECT_KINDS = [KIND.Knight, KIND.SkeletonWarrior, KIND.Ogre, KIND.Lich];
const PARTY_KINDS = [KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger];
/** The model block's effect rows: every row of `EFFECT_ROWS` that shows something (not the plain wading one), for the four heroes, a skeleton, the ogre, the wolf, the stag, the boar, the Necromancer, the Imp and the Knight (#356). */
const MODEL_EFFECT_ROW_LIST = EFFECT_ROWS.filter((r) => r.effect !== undefined || r.flag !== undefined);
const MODEL_EFFECT_KINDS = [KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger, KIND.SkeletonWarrior, KIND.Ogre, KIND.DireWolf, KIND.Stag, KIND.Boar, KIND.Necromancer, KIND.Imp, KIND.Knight, KIND.Ghost, KIND.Shade];
/** The variety block's rows: one kind each, `VARIETY_COLS` figures per row. */
const VARIETY_KINDS = [KIND.Stag, KIND.Deer, KIND.Boar, KIND.Bunny, KIND.GoblinArcher, KIND.OrcWarrior, KIND.Imp, KIND.Chort];
/**
 * The size line-up (#356, `&focus=lineup`): every model key once, shortest left, by the built model's `baseHeight` (a test builds them and
 * checks the order). Each stands for the first kind that wears it; the line is one row at equal depth, idle, facing right.
 */
export const LINEUP_KEYS: readonly ModelKey[] = [
  'bunny', 'boar', 'imp', 'chest', 'mimic', 'goblin', 'skelet', 'wolf', 'deer', 'wizard', 'dwarf', 'knight', 'barrel', 'ogre', 'stag', 'elf',
  'shade', 'npcKnight', 'ghost', 'necromancer', 'summoner', 'disciple', 'chort', 'orc',
];
/** The kind that stands for a model key in the line-up (the objects' kinds from `OBJECT_MODEL`, #317). */
export const lineupKind = (key: ModelKey): number => Number(Object.keys({ ...MODEL_OF_KIND, ...OBJECT_MODEL }).find((k) => (MODEL_OF_KIND[Number(k)] ?? OBJECT_MODEL[Number(k)]) === key));
/** The server's hit circle of a kind in game px: a monster's exported radius; a hero's `PLAYER_RADIUS` (the Dire Wolf's `WOLF_RADIUS` on the server is the same 5). */
export const circleOf = (kind: number): number => HITBOX[kind]?.r ?? CONST.PLAYER_RADIUS;
const RING: readonly [number, number, number] = [1, 0.9, 0.2];
/** `&circles=1`: the hit circle of every line-up figure as a thin ring on the ground (its outer edge is the circle). */
export function lineupCircles(T: FxTris): void {
  LINEUP_KEYS.forEach((key, i) => {
    const p = GALLERY.lineup(i), r = circleOf(lineupKind(key)) / TILE;
    groundRing(T, p.x, p.z, 0.03, r - 0.5 / TILE, r, RING, 1, 1);
  });
}
/** The kinds with a model, in the order of the model rows. */
const MODEL_KINDS = Object.keys(MODEL_OF_KIND).map(Number);
/** A figure of the dying row lives this many seconds of every `DIE_PERIOD`, then dies (and leaves its skull). */
const DIE_PERIOD = 6;
const DIE_AT = 3;

/** The dying row's figures alive at time `t`: the first `DIE_AT` seconds of every period. */
function dyingAt(t: number): EntState[] {
  if (t % DIE_PERIOD >= DIE_AT) return [];
  return MODEL_KINDS.map((k, i) => {
    const p = GALLERY.dying(i);
    return ent(ID.dying + i, k, p.x, p.z, { anim: ANIM.Idle, animMs: (t % 1) * 1000 });
  });
}

/** The effects pass's share of a frame (#359): the drawn figures that are spectres (a model Ghost or Shade, wherever it stands) and their entities, copied into the reused containers. Other kinds never reach the pass. */
export function spectrePassIn(figs: readonly DrawnFig[], ents: readonly EntState[], outFigs: DrawnFig[], outEnts: Map<number, EntState>): void {
  outFigs.length = 0;
  outEnts.clear();
  for (const f of figs) if (f.spectre !== null) outFigs.push(f);
  for (const e of ents) if (e.kind === KIND.Ghost || e.kind === KIND.Shade) outEnts.set(e.id, e);
}

/** The `Died` events of the dying row between two times (the stage sends them to the figures, which leave a skull): one per figure when a period's `DIE_AT` falls in (t0, t1]. */
export function diedBetween(t0: number, t1: number): Extract<PictureEv, { t: 'Died' }>[] {
  if (Math.floor((t1 - DIE_AT) / DIE_PERIOD) === Math.floor((t0 - DIE_AT) / DIE_PERIOD)) return [];
  return dyingAt(0).map((e) => ({ t: 'Died', id: e.id, x: e.x, y: e.y, kind: e.kind }));
}

/**
 * The spectre block's life loop (#359), in seconds of `SPECTRE_LIFE`: the figure forms in the ambush warning, stands idle, winds up
 * `SPECTRE_WINDUP` s before each blow and swings `SPECTRE_BLOW` s, and is gone from `SPECTRE_GONE` s (it dies then) until the loop repeats.
 */
export const SPECTRE_LIFE = 9;
const SPECTRE_GONE = 7;
const SPECTRE_BLOWS = [3, 5] as const;
const SPECTRE_WINDUP = 0.25;
const SPECTRE_BLOW = 0.5;
/** The first frame looks this many seconds back for a death (a page started with `&t=` just after one). */
const CATCH_UP = 1;
/** The life figures are places 2 (the Ghost) and 5 (the Shade); 1 and 4 walk, 0 and 3 stand. */
const SPECTRE_LIVES = [2, 5] as const;
/** The walkers' sway in tiles and its rad/s. */
const SPECTRE_SWAY = 1.5;
const SPECTRE_SWAY_W = 2;
const spectreKind = (i: number): number => (i < SPECTRE_PLACES / 2 ? KIND.Ghost : KIND.Shade);

/** The life figure's state at loop second `s` (null: gone), with the seconds it has been in it. */
function lifeState(s: number, t: number): { anim: number; animMs: number } | null {
  if (s >= SPECTRE_GONE) return null;
  if (s < CONST.AMBUSH_WARNING) return { anim: ANIM.Ambush, animMs: s * 1000 };
  for (const b of SPECTRE_BLOWS) {
    if (s >= b - SPECTRE_WINDUP && s < b) return { anim: ANIM.Windup, animMs: (s - (b - SPECTRE_WINDUP)) * 1000 };
    if (s >= b && s < b + SPECTRE_BLOW) return { anim: ANIM.Melee, animMs: (s - b) * 1000 };
  }
  return { anim: ANIM.Idle, animMs: (t % 1) * 1000 };
}

/** The spectre block at time `t`: per kind an idle figure, a walker and the life figure (which is absent while it is gone). `aimPin` aims the standing ones. */
export function spectreAt(t: number, aimPin: number | null = null): EntState[] {
  const out: EntState[] = [];
  const s = t % SPECTRE_LIFE;
  for (let i = 0; i < SPECTRE_PLACES; i++) {
    const p = GALLERY.spectre(i), kind = spectreKind(i), id = ID.spectre + i, aim = aimPin ?? 0;
    switch (i % (SPECTRE_PLACES / 2)) {
      case 0: out.push(ent(id, kind, p.x, p.z, { anim: ANIM.Idle, animMs: (t % 1) * 1000, aim })); break;
      case 1: {
        const w = walk(p.x, SPECTRE_SWAY, SPECTRE_SWAY_W, 0, t);
        out.push(ent(id, kind, w.x, p.z, { anim: ANIM.Move, animMs: t * 1000, aim: w.aim }));
        break;
      }
      default: {
        const st = lifeState(s, t);
        if (st) out.push(ent(id, kind, p.x, p.z, { ...st, aim }));
      }
    }
  }
  return out;
}

/** The time (s) a life figure dies in (t0, t1]: `SPECTRE_GONE` s into a loop; null when none falls in. */
export function spectreDeathIn(t0: number, t1: number): number | null {
  const k = Math.floor((t1 - SPECTRE_GONE) / SPECTRE_LIFE);
  return k === Math.floor((t0 - SPECTRE_GONE) / SPECTRE_LIFE) ? null : SPECTRE_GONE + k * SPECTRE_LIFE;
}

/** The `Died` events of the block's life figures in (t0, t1]: one each when a life ends in it (the stage sends them to the figures and the effects). */
export function spectreDiedBetween(t0: number, t1: number): Extract<PictureEv, { t: 'Died' }>[] {
  if (spectreDeathIn(t0, t1) === null) return [];
  return SPECTRE_LIVES.map((i) => ({ t: 'Died', id: ID.spectre + i, x: GALLERY.spectre(i).x * TILE, y: GALLERY.spectre(i).z * TILE, kind: spectreKind(i) }));
}

/** A walker: `base` and `amp` in tiles, `w` rad/s. Its position, and the aim it faces while it goes. */
function walk(base: number, amp: number, w: number, ph: number, t: number): { x: number; aim: number } {
  return { x: base + amp * Math.sin(w * t + ph), aim: Math.cos(w * t + ph) >= 0 ? 0 : Math.PI };
}

/** The barrel's cycle as the gallery runs it: rest, fuse, fall, rest, sink. */
const BARREL_STEPS: [number, number][] = [[0, 1], [1, CONST.BARREL_FUSE], [2, CONST.FALL_TIME + 0.3], [0, 1], [3, CONST.DROWN_TIME + 0.3]];
function barrelAt(t: number): { anim: number; animMs: number } {
  const total = BARREL_STEPS.reduce((s, [, d]) => s + d, 0);
  let bt = t % total;
  let step = BARREL_STEPS[0];
  for (const s of BARREL_STEPS) { step = s; if (bt < s[1]) break; bt -= s[1]; }
  return { anim: step[0], animMs: bt * 1000 };
}

/** Every entity of the stage at gallery time `t` (s); `state` pins a state (else the 1.2 s cycle); `crowd` walking model figures are added. */
export function galleryEnts(t: number, state: string | null, crowd = 0, aimPin: number | null = null, crowdKinds: readonly number[] | null = null): EntState[] {
  const crowdCycle = crowdKinds ?? MODEL_KINDS;
  const out: EntState[] = [];
  // Figure rows: the state cycle, the hurt flash every 3 s, the aim swinging and turning every 4 s.
  const only = STATES.findIndex(([n]) => n === state);
  const [, anim] = STATES[only >= 0 ? only : Math.floor(t / 1.2) % STATES.length];
  const animMs = ((t % 1.2) % 0.5) * 1000;
  const aim = aimPin ?? Math.sin(t * 0.7) * 0.6 + (Math.floor(t / 4) % 2 ? Math.PI : 0);
  const hurt = Math.floor(t * 2) % 6 === 0 ? FLAG.HURT : 0;
  Object.keys(FIGURES).map(Number).forEach((k, i) => {
    const p = GALLERY.figure(i);
    out.push(ent(ID.figure + i, k, p.x + (anim === ANIM.Move ? (Math.sin(t * 3) * 6) / TILE : 0), p.z, { anim, animMs, aim, flags: hurt }));
  });

  // The model block: a row of the kinds with a model, cycling like the card rows; the effect rows; the figures that die; the pillars' torches; the crowd.
  MODEL_KINDS.forEach((k, i) => {
    const p = GALLERY.model(i);
    out.push(ent(ID.model + i, k, p.x + (anim === ANIM.Move ? (Math.sin(t * 3) * 6) / TILE : 0), p.z, { anim, animMs, aim, flags: hurt }));
  });
  const swapM = Math.floor(t / 4) % 2;
  MODEL_EFFECT_ROW_LIST.forEach((row, r) => MODEL_EFFECT_KINDS.forEach((kind, c) => {
    const p = GALLERY.modelEffect(r, c);
    const dx = row.run ? Math.sin(t * 3) * (18 / TILE) : 0;
    out.push(ent(ID.modelEffect + r * MODEL_EFFECT_STRIDE + c, kind, p.x + dx, p.z, {
      anim: row.run ? ANIM.Move : ANIM.Idle, animMs: (t % 1) * 1000,
      aim: row.run ? (Math.cos(t * 3) > 0 ? 0 : Math.PI) : (c + swapM) % 2 ? Math.PI : 0,
      effects: row.effect !== undefined ? 1 << row.effect : 0, flags: row.flag ?? 0,
    }));
  }));
  out.push(...dyingAt(t));
  VARIETY_KINDS.forEach((kind, r) => {
    for (let c = 0; c < VARIETY_COLS; c++) {
      const p = GALLERY.variety(r, c);
      out.push(ent(ID.variety + r * 10 + c, kind, p.x, p.z, { anim: ANIM.Idle, animMs: (t % 1) * 1000, aim: 0 }));
    }
  });
  LINEUP_KEYS.forEach((key, i) => {
    const p = GALLERY.lineup(i);
    const kind = lineupKind(key);
    // A Mimic stands awake here (a hiding one is the chest beside it); the chest and the barrel are neutral objects.
    out.push(ent(ID.lineup + i, kind, p.x, p.z, { anim: ANIM.Idle, animMs: 0, aim: 0, ...(kind === KIND.Chest || kind === KIND.Barrel ? { side: SIDE.Neutral } : {}) }));
  });
  out.push(...spectreAt(t, aimPin));
  GALLERY.pillarTorches.forEach((p, i) => out.push(ent(ID.pillarTorch + i, KIND.Torch, p.x, p.z, { side: SIDE.Neutral, anim: 1, extra: 0 })));
  GALLERY.spectreTorches.forEach((p, i) => out.push(ent(ID.pillarTorch + SPECTRE_TORCH_ID + i, KIND.Torch, p.x, p.z, { side: SIDE.Neutral, anim: 1, extra: 0 })));
  for (let i = 0; i < crowd; i++) {
    const p = GALLERY.crowd(i);
    const w = walk(p.x, 0.4, 1 + (i % 5) * 0.2, i * 0.9, t);
    out.push(ent(ID.crowd + i, crowdCycle[i % crowdCycle.length], w.x, p.z, { anim: ANIM.Move, animMs: t * 1000 + i * 70, aim: w.aim }));
  }

  // Effect groups: idle (the slowed and chilled run back and forth); asleep and stone figures keep a facing, alternating every 4 s.
  const swap = Math.floor(t / 4) % 2;
  EFFECT_ROWS.forEach((row, g) => {
    for (let k = 0; k < GROUP_CELLS; k++) {
      const p = GALLERY.effect(g, k);
      const kind = (g === EFFECT_GROUPS - 1 ? PARTY_KINDS : EFFECT_KINDS)[k];
      const dx = row.run ? Math.sin(t * 3) * (18 / TILE) : 0;
      out.push(ent(ID.effect + g * 10 + k, kind, p.x + dx, p.z, {
        anim: row.run ? ANIM.Move : ANIM.Idle, animMs: (t % 1) * 1000,
        aim: row.run ? (Math.cos(t * 3) > 0 ? 0 : Math.PI) : (k + swap) % 2 ? Math.PI : 0,
        effects: row.effect !== undefined ? 1 << row.effect : 0, flags: row.flag ?? 0,
      }));
    }
  });

  // World objects: a chest, an opening chest, a barrel, the cycling explosive barrel, three mimics, a lit and an unlit torch.
  const ox = (i: number): number => GALLERY.object(i).x;
  out.push(ent(ID.object, KIND.Chest, ox(0), OBJECT_Z, { side: SIDE.Neutral }));
  out.push(ent(ID.object + 1, KIND.Chest, ox(1), OBJECT_Z, { side: SIDE.Neutral, anim: 1, animMs: (t % 3) * 1000 }));
  out.push(ent(ID.object + 2, KIND.Barrel, ox(2), OBJECT_Z, { side: SIDE.Neutral }));
  out.push(ent(ID.barrelCycle, KIND.Barrel, ox(3), OBJECT_Z, { side: SIDE.Neutral, ...barrelAt(t) }));
  out.push(ent(ID.object + 4, KIND.Mimic, ox(4), OBJECT_Z, { flags: FLAG.HIDING }));
  out.push(ent(ID.object + 5, KIND.Mimic, ox(5), OBJECT_Z, { anim: ANIM.Move, animMs: t * 1000, aim: Math.cos(t * 2) > 0 ? 0 : Math.PI }));
  out.push(ent(ID.object + 6, KIND.Mimic, ox(6), OBJECT_Z, t % 6 < 3 ? { flags: FLAG.HIDING } : {})); // it gives itself away every 6 s
  out.push(ent(ID.object + 7, KIND.Torch, 26.5, TORCH_Z, { side: SIDE.Neutral, anim: 1, extra: 0 }));
  out.push(ent(ID.object + 8, KIND.Torch, 29.5, TORCH_Z, { side: SIDE.Neutral, anim: 0, extra: 0 }));
  // Shots of every kind, each flying along its row in a loop.
  Object.keys(PROJECTILES).map(Number).forEach((k, i) => {
    out.push(ent(ID.shot + i, k, 3 + i * 2.6 + ((t * 5) % 2) - 1, SHOT_Z, { side: SIDE.Neutral }));
  });

  // The corridor: a hero, five skeletons close together, a wolf, a chest, a closed mimic, a barrel and a Neutral knight.
  const c = ID.corridor;
  const move = (e: { x: number; aim: number }) => ({ anim: ANIM.Move, animMs: t * 1000, aim: e.aim });
  const hero = walk(22, 3, 1.1, 0, t);
  out.push(ent(c, KIND.Wizard, hero.x, 3.4, move(hero)));
  for (let i = 0; i < 5; i++) {
    const s = walk(15 + 1.1 * i, 1.5, 0.9, i * 0.7, t);
    out.push(ent(c + 1 + i, KIND.SkeletonWarrior, s.x, 1.7 + (i % 3) * 0.8, move(s)));
  }
  const wolf = walk(25, 3, 1.3, 1, t);
  out.push(ent(c + 6, KIND.DireWolf, wolf.x, 3.5, move(wolf)));
  out.push(ent(c + 7, KIND.Chest, 29.5, 3.6, { side: SIDE.Neutral }));
  out.push(ent(c + 8, KIND.Mimic, 34, 3.6, { flags: FLAG.HIDING }));
  // Right behind the wall, where it would hide them: neither opens it.
  out.push(ent(ID.corridorBarrel, KIND.Barrel, 8.5, 3.75, { side: SIDE.Neutral }));
  const knight = walk(6, 3, 1, 0.5, t);
  out.push(ent(ID.corridorKnight, KIND.Knight, knight.x, 3.75, { side: SIDE.Neutral, ...move(knight) }));
  return out;
}

/** The frame of a run's view for `ents`: no own hero, no shots of its own. */
export function galleryFrame(ents: readonly EntState[], now: number, dt: number): RunFrame {
  return {
    dt, now, ents: new Map(ents.map((e) => [e.id, e])), you: -1,
    own: { x: 0, y: 0, alive: false, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, aimsAtPointer: false, aimFromX: 0, aimFromY: 0, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false },
    watching: null, camera: { x: 0, y: 0 }, snap: undefined, shots: [], hiddenShots: new Set(), useHint: null, ownCast: null, dark: new Set(),
    debug: { on: false, path: [], ogre: [], cove: [], notice: [], dodges: [] },
  };
}

/** What `Figures3d` reads of a run's start: the map, no players of its own (nobody is "you"), and a kind for the own figure. */
export function galleryInit(): RunViewInit {
  return { info: { players: [] } as unknown as RunStartInfo, map: GALLERY.map, light: undefined as unknown as RunViewInit['light'], myKind: KIND.Wizard };
}

/** Everything is in sight in the gallery. */
const ALL_VISIBLE = { isVisible: (): boolean => true };
const NO_IDS: ReadonlySet<number> = new Set();

/** `deps.kit` is for tests; a stage makes its own and ends it. */
export function createGalleryStage(assets: Assets, initial: { pitch: number; yaw: number }, search: string, deps: { kit?: FigureKit } = {}): Stage {
  const opts = parseGallery(search);
  const map = GALLERY.map;
  const world: WorldInput = { map, painted: false, clear: 'stone' };
  const figures = new Figures3d(galleryInit(), assets.frames, atlasBounds(assets.image, assets.frames));
  const water = new Water3d(map);
  // One kit for the stage, kept across a rebuilt view (the new layer draws from its cached models).
  const kit = deps.kit ?? createStageKit(assets);
  const readout = modelsReadouter(kit);
  const is = modelsOf(opts);
  const at = opts.at ?? GALLERY.focus[opts.focus];
  const cam = { x: at.x, z: at.z, pitch: (initial.pitch * Math.PI) / 180, yaw: (initial.yaw * Math.PI) / 180 };
  let t = opts.start;
  // `light=torch`: the torches (the lit one on the objects' wall and the pillars') light the gallery through the game's lights and casters.
  const field = new LightField(map);
  const pairs = new TorchPairs();
  if (opts.light === 'torch') {
    let id = 1;
    for (const e of galleryEnts(0, null)) {
      if (e.kind !== KIND.Torch || e.anim !== 1) continue;
      const tc = torchOf(e);
      field.add({ id: id++, kind: LIGHT_KIND.Torch, colour: 0xffaa5a, x: tc.tx, y: tc.tz, on: true });
    }
  }

  // A caption with the state on show.
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);

  const ringTris = new FxTris(LINEUP_MAX * 64);
  // The effects run only over the spectre models' figures wherever they stand (reused containers), so no other kind changes.
  const pass = new FxPass(NO_IDS);
  const fx = new Effects3d(map);
  const specFigs: DrawnFig[] = [];
  const specEnts = new Map<number, EntState>();
  clearVeils();
  let first = true;

  return {
    world,
    frame(c: StageCtx): number {
      const dt = c.dt / opts.slow;
      const t0 = t;
      t += dt;
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      if (ix || iz) {
        const w = keysToWorld(cam.yaw, ix, iz);
        const len = Math.hypot(w.x, w.z) || 1;
        const p = freeClamp(map, cam.x + (w.x / len) * PAN_SPEED * c.dt, cam.z + (w.z / len) * PAN_SPEED * c.dt);
        cam.x = p.x;
        cam.z = p.z;
      }
      const only = STATES.findIndex(([n]) => n === opts.state);
      label.textContent = `state: ${STATES[only >= 0 ? only : Math.floor(t / 1.2) % STATES.length][0]} (hurt flash every 3 s); WASD pans`;
      c.timer.lap('sim');
      if (!c.view) return 0;
      // The figures that died since the last frame leave their skulls; the event comes before the frame that no longer has them.
      // The spectres of the dying row also send theirs to the effects (the Shade's death fog, the Ghost's death effect); no other kind has one here.
      for (const ev of diedBetween(t0, t)) {
        figures.event(ev);
        if (ev.kind === KIND.Ghost || ev.kind === KIND.Shade) fx.event(ev, t, false);
      }
      // The block's lives that ended since the last frame, to the figures and the effects (stamped with the moment they ended). The first
      // frame looks back `CATCH_UP` s, so a page that starts just after a death shows the death's fog.
      const from = first ? Math.max(0, t0 - CATCH_UP) : t0;
      first = false;
      const diedAt = spectreDeathIn(from, t);
      if (diedAt !== null) for (const ev of spectreDiedBetween(from, t)) { figures.event(ev); fx.event(ev, diedAt, false); }
      const ents = galleryEnts(t, opts.state, opts.crowd, opts.aim, opts.crowdKinds);
      const torch = opts.light === 'torch';
      if (torch) for (const e of ents) if (e.kind === KIND.Torch) pairs.see(e);
      const ambient = torch ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const fo = figures.frame(galleryFrame(ents, t, dt), cam, { ambient, dark: c.params.dark, torchGlow: !torch, oval: 1, models: { kit, is } });
      spectrePassIn(fo.figs, ents, specFigs, specEnts);
      pass.run(fx, { cam, now: t, quality: c.params.quality, figs: specFigs, ents: specEnts, shots: [], hiddenShots: NO_IDS, snap: undefined, hidden: NO_IDS, you: -1, ownCast: null }, fo.glows);
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');
      let lights: ReturnType<typeof selectLights>['list'] = [];
      let casters: ReturnType<typeof selectCasters> = [];
      let inView = 0;
      if (torch) {
        const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
        const sel = selectLights([...staticCands(field, pairs, map, t), ...pass.out.lights], lightView(fp, cam), { x: cam.x, z: cam.z }, Math.min(LIGHT_CAP, c.params.lcap));
        lights = sel.list;
        inView = sel.inView;
        casters = selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap));
        assignSkips(lights, carrierMap(lights), casters);
      }
      c.timer.lap('lights');
      // The water under the wading group (#345): ripples only (the gallery has no effects pass), on the page's clock `t`.
      const wo = water.step({ dt, now: t, figs: fo.figs, sinks: fo.sinks, landed: null, hidden: NO_IDS });
      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.models = readout(c.view.figuresDrawn ?? { figures: 0, draws: 0 }, t);
        r.lights = { list: lights.length, inView };
        r.casters = casters.length;
      }
      // `&circles=1`: the rings join the pass's blended triangles.
      if (opts.circles) {
        ringTris.clear();
        lineupCircles(ringTris);
        ringTris.flush(pass.blend, cam, true);
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient, lava: null, lavaVersion: 0, darkvision: null, casters, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) }, models: { insts: fo.models, kit },
          water: { ripples: wo.ripples, now: t, reflect: reflects(c.params) },
          fx: { tris: pass.blend, lit: pass.lit },
        },
        c.timer,
      );
    },
    dispose(): void {
      label.remove();
      clearVeils();
      if (!deps.kit) kit.dispose();
    },
  };
}
