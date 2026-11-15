// The 3D effects system (#308): events and shots become small records; every frame the records still alive are drawn by the drawer
// registered for their kind (later tasks register them). A record's picture is a pure function of its age, seed and numbers.
// Nothing here touches prediction, interpolation or the simulation.
import { isBossKind, isProjectileKind } from '../../game/anim/defs';
import { KIND } from '../../generated/defs';
import type { Snapshot } from '../../generated/Snapshot';
import type { EntState } from '../../game/world';
import type { OwnCast, PictureEv, ShotView } from '../../run/view';
import type { TileMap } from '../../sim/map';
import { TILE } from '../../sim/map';
import { FX_KIND_CAP, type DrawnFig, type FxCtx, type FxOut } from './types';

/** Every kind of record. Boom is split by its `k`. */
export const FX_KIND = {
  Dmg: 0,
  /** Boom k 0 and 4 (the fireball), and k 7 (the barrel, with splinters). */
  FireBlast: 1,
  FrostNova: 2,
  Holy: 3,
  Flame: 4,
  Slam: 5,
  Gloom: 6,
  Splinters: 7,
  Nature: 8,
  Shock: 9,
  Sparks: 10,
  Zap: 11,
  Died: 12,
  DiedGhost: 13,
  DiedBoss: 14,
  Raise: 15,
  Immune: 16,
  /** The runes of a cast (their own life is managed by the runes' drawer; this is the upper bound). */
  Cast: 17,
  ShotHit: 18,
} as const;
export type FxKind = (typeof FX_KIND)[keyof typeof FX_KIND];

/** Seconds a record lives (first guesses from the plan; the drawers end their picture within them). */
export const FX_LIFE: Readonly<Record<FxKind, number>> = {
  [FX_KIND.Dmg]: 0.25,
  [FX_KIND.FireBlast]: 4,
  [FX_KIND.FrostNova]: 3.4,
  [FX_KIND.Holy]: 0.8,
  [FX_KIND.Flame]: 0.7,
  [FX_KIND.Slam]: 0.9,
  [FX_KIND.Gloom]: 0.8,
  [FX_KIND.Splinters]: 0.9,
  [FX_KIND.Nature]: 0.8,
  [FX_KIND.Shock]: 0.5,
  [FX_KIND.Sparks]: 0.5,
  [FX_KIND.Zap]: 0.18,
  [FX_KIND.Died]: 0.6,
  [FX_KIND.DiedGhost]: 1,
  [FX_KIND.DiedBoss]: 1,
  [FX_KIND.Raise]: 0.9,
  [FX_KIND.Immune]: 0.3,
  [FX_KIND.Cast]: 8,
  [FX_KIND.ShotHit]: 0.45,
};

/** One effect in progress. `a` to `d` are the kind's numbers (see `Effects3d.event`). */
export interface FxRec {
  kind: FxKind;
  start: number;
  x: number;
  z: number;
  seed: number;
  /** The entity it follows, or -1. */
  follow: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

/** What `frame` is handed besides the context. */
export interface FxFrame {
  ctx: FxCtx;
  figs: readonly DrawnFig[];
  ents: ReadonlyMap<number, EntState>;
  shots: readonly ShotView[];
  hiddenShots: ReadonlySet<number>;
  snap: Snapshot | undefined;
  hidden: ReadonlySet<number>;
  you: number;
  ownCast: OwnCast | null;
}

/** Draws one record at `age` seconds into its life. */
export type FxDrawer = (out: FxOut, frame: FxFrame, rec: FxRec, age: number) => void;

const DRAWERS: (FxDrawer | undefined)[] = [];
/** Registers the drawer of a kind (a second registration replaces the first). */
export function registerFx(kind: FxKind, draw: FxDrawer): void {
  DRAWERS[kind] = draw;
}
/** Empties the registry (tests). */
export function clearFxRegistry(): void {
  DRAWERS.length = 0;
}

/** The record kind of a Boom `k`, or null when 3D draws nothing for it (k 3 has no sender on the server). */
export function boomKind(k: number): FxKind | null {
  switch (k) {
    case 0: case 4: case 7: return FX_KIND.FireBlast;
    case 10: return FX_KIND.FrostNova;
    case 1: case 13: return FX_KIND.Holy;
    case 2: return FX_KIND.Flame;
    case 5: return FX_KIND.Slam;
    case 6: return FX_KIND.Gloom;
    case 8: return FX_KIND.Splinters;
    case 9: return FX_KIND.Nature;
    case 11: return FX_KIND.Shock;
    case 12: return FX_KIND.Sparks;
    default: return null;
  }
}

export class Effects3d {
  private recs: FxRec[] = [];
  private seq = 0;

  constructor(readonly map: TileMap) {}

  get records(): number {
    return this.recs.length;
  }

  private add(kind: FxKind, now: number, x: number, z: number, follow: number, a = 0, b = 0, c = 0, d = 0): void {
    // the oldest of a kind goes first (records are in start order)
    let count = 0;
    for (const r of this.recs) if (r.kind === kind) count++;
    if (count >= FX_KIND_CAP) {
      const at = this.recs.findIndex((r) => r.kind === kind);
      this.recs.splice(at, 1);
    }
    const seed = (Math.imul(++this.seq, 2654435761) ^ Math.imul(kind + 1, 40503)) >>> 0;
    this.recs.push({ kind, start: now, x, z, seed, follow, a, b, c, d });
  }

  /** Events in the dark make nothing. Positions are simulation px; records hold tiles. Numbers: Boom a=k b=r (tiles); Zap a,b=x2,z2;
   *  Died a=kind; Raise a=k; Dmg a=1 on a hero; Cast a=look b=windup s c=1 primary d=aim; ShotHit a=shot kind. */
  event(ev: PictureEv, now: number, dark: boolean): void {
    if (dark) return;
    const x = 'x' in ev ? ev.x / TILE : 0, z = 'y' in ev ? ev.y / TILE : 0;
    switch (ev.t) {
      case 'Dmg':
        if (!ev.imm) this.add(FX_KIND.Dmg, now, x, z, -1, ev.p ? 1 : 0);
        break;
      case 'Boom': {
        const k = boomKind(ev.k);
        if (k !== null) this.add(k, now, x, z, -1, ev.k, ev.r / TILE);
        break;
      }
      case 'Zap': this.add(FX_KIND.Zap, now, x, z, -1, ev.x2 / TILE, ev.y2 / TILE); break;
      case 'Died': {
        if (ev.kind === KIND.Shade || isProjectileKind(ev.kind)) break;
        const k = ev.kind === KIND.Ghost ? FX_KIND.DiedGhost : isBossKind(ev.kind) ? FX_KIND.DiedBoss : FX_KIND.Died;
        this.add(k, now, x, z, ev.id, ev.kind);
        break;
      }
      case 'Raise': this.add(FX_KIND.Raise, now, x, z, -1, ev.k); break;
      case 'Immune': this.add(FX_KIND.Immune, now, x, z, -1); break;
      case 'Cast': this.add(FX_KIND.Cast, now, x, z, ev.id, ev.look, ev.windup_ms / 1000, ev.primary ? 1 : 0, ev.aim); break;
      default: break;
    }
  }

  /** A server or predicted shot ended; a wall hit leaves sparks. */
  shotEnded(shot: ShotView, how: 'wall' | 'enemy' | 'gone', now: number): void {
    if (how === 'wall') this.add(FX_KIND.ShotHit, now, shot.x / TILE, shot.y / TILE, -1, shot.kind);
  }

  /** A tile changed (the force field's cells follow it in a later task). */
  tileChanged(_x: number, _y: number, _v: number, _now: number): void {}

  /** Clears the outputs, drops the records past their life and draws the others. */
  frame(input: FxFrame, out: FxOut): void {
    out.tris.clear();
    out.lit.clear();
    out.lights.length = 0;
    const g = out.glows;
    g.position.length = 0; g.uv.length = 0; g.color.length = 0; g.foot.length = 0; g.n = 0;
    const now = input.ctx.now, recs = this.recs;
    let w = 0;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (now - r.start > FX_LIFE[r.kind]) continue;
      recs[w++] = r;
    }
    recs.length = w;
    for (let i = 0; i < w; i++) {
      const r = recs[i], draw = DRAWERS[r.kind];
      if (draw && now >= r.start) draw(out, input, r, now - r.start);
    }
  }
}
