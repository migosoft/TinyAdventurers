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
import { castMode, newChannel, newRune, WINK, type RuneRec } from './runes';
import { drawShots } from './shots';
import { ANIM } from '../../generated/defs';
import { FX_KIND_CAP, type DrawnFig, type FxCtx, type FxOut, type MimicCue } from './types';

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
  /** A hit spark (a=colour 0xrrggbb, b=motes, c=height in tiles) at x, z: a release, a dragon's bite. */
  Spark: 19,
  /** A mimic's reveal (gold motes) and landing (dust). */
  MimicWake: 20,
  MimicLand: 21,
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
  [FX_KIND.Spark]: 0.35,
  [FX_KIND.MimicWake]: 0.6,
  [FX_KIND.MimicLand]: 0.4,
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
  /** The state of a Cast record's runes (null for the other kinds). */
  rune: RuneRec | null;
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
  /** The mimics' one-shot cues of this frame. */
  cues?: readonly MimicCue[];
}

/** Draws one record at `age` seconds into its life. Returning `false` retires the record at once (it has nothing left to draw). */
export type FxDrawer = (out: FxOut, frame: FxFrame, rec: FxRec, age: number) => void | boolean;

/** Draws what belongs to the figures of the frame, not to a record (the figure effects); runs before the records. May add records. */
export type FxFrameDrawer = (out: FxOut, frame: FxFrame, fx: Effects3d) => void;

const DRAWERS: (FxDrawer | undefined)[] = [];
const FRAME_DRAWERS: FxFrameDrawer[] = [];
/** Registers the drawer of a kind (a second registration replaces the first). */
export function registerFx(kind: FxKind, draw: FxDrawer): void {
  DRAWERS[kind] = draw;
}
/** Registers a per-frame drawer (a second registration of the same function is ignored). */
export function registerFrameFx(draw: FxFrameDrawer): void {
  if (!FRAME_DRAWERS.includes(draw)) FRAME_DRAWERS.push(draw);
}
/** Empties the registry (tests). */
export function clearFxRegistry(): void {
  DRAWERS.length = 0;
  FRAME_DRAWERS.length = 0;
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

/** A predicted own cast waits this long for the server's Cast (a refused prediction never gets one). */
const PENDING_LIFE = 2;
const PENDING_MAX = 8;

export class Effects3d {
  private recs: FxRec[] = [];
  private seq = 0;
  /** The own hero's entity id (from the last frame) and the last predicted cast seen (`seq`). */
  private you = -1;
  private ownSeq = 0;
  /** Predicted own casts the server has not echoed yet, oldest first (fixed size, reused): look and time. */
  private readonly pendLook = new Int32Array(PENDING_MAX);
  private readonly pendAt = new Float64Array(PENDING_MAX);
  private pendN = 0;
  /** The last one-shot action of each figure that was given its spark: its anim and when it began (the run's clock). */
  readonly actions = new Map<number, { anim: number; start: number; seen: number }>();
  private pruned = 0;

  private pendDrop(i: number): void {
    for (let k = i + 1; k < this.pendN; k++) { this.pendLook[k - 1] = this.pendLook[k]; this.pendAt[k - 1] = this.pendAt[k]; }
    this.pendN--;
  }

  /** Takes the oldest live pending predicted cast of `look`; false when there is none. */
  private pendTake(look: number, now: number): boolean {
    while (this.pendN > 0 && now - this.pendAt[0] > PENDING_LIFE) this.pendDrop(0);
    for (let i = 0; i < this.pendN; i++) {
      if (this.pendLook[i] === look && now - this.pendAt[i] <= PENDING_LIFE) { this.pendDrop(i); return true; }
    }
    return false;
  }

  /** The rune records of Cast kind (for tests). */
  castRecords(): readonly FxRec[] {
    return this.recs.filter((r) => r.kind === FX_KIND.Cast);
  }

  constructor(readonly map: TileMap) {}

  get records(): number {
    return this.recs.length;
  }

  private add(kind: FxKind, now: number, x: number, z: number, follow: number, a = 0, b = 0, c = 0, d = 0): FxRec {
    // the oldest of a kind goes first (records are in start order)
    let count = 0;
    for (const r of this.recs) if (r.kind === kind) count++;
    if (count >= FX_KIND_CAP) {
      const at = this.recs.findIndex((r) => r.kind === kind);
      this.recs.splice(at, 1);
    }
    const seed = (Math.imul(++this.seq, 2654435761) ^ Math.imul(kind + 1, 40503)) >>> 0;
    const rec: FxRec = { kind, start: now, x, z, seed, follow, a, b, c, d, rune: null };
    this.recs.push(rec);
    return rec;
  }

  /** Adds a record from outside the events (the figure effects). Numbers as `add`. */
  emit(kind: FxKind, now: number, x: number, z: number, follow = -1, a = 0, b = 0, c = 0, d = 0): FxRec {
    return this.add(kind, now, x, z, follow, a, b, c, d);
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
        // the barrel's blast throws splinters too (the same spot)
        if (ev.k === 7) this.add(FX_KIND.Splinters, now, x, z, -1, 8, ev.r / TILE);
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
      case 'Cast': {
        // the own hero's cast was drawn from the key press: the server's copy takes one predicted cast and draws nothing
        if (ev.id === this.you && this.pendTake(ev.look, now)) break;
        const rec = this.add(FX_KIND.Cast, now, x, z, ev.id, ev.look, ev.windup_ms / 1000, ev.primary ? 1 : 0, ev.aim);
        rec.rune = newRune(ev.id, ev.look, castMode(ev.primary, ev.windup_ms / 1000), now, ev.windup_ms / 1000, ev.aim, x, z, rec.seed);
        break;
      }
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
    // the glowing shots in flight (hidden ones draw nothing)
    drawShots(out, input);
    this.you = input.you;
    const oc = input.ownCast;
    if (oc && oc.seq !== this.ownSeq) {
      this.ownSeq = oc.seq;
      let x = 0, z = 0, found = false;
      for (const f of input.figs) if (f.id === input.you) { x = f.x; z = f.z; found = true; break; }
      if (!found) {
        const e = input.ents.get(input.you);
        if (e) { x = e.x / TILE; z = e.y / TILE; found = true; }
      }
      if (found) {
        if (this.pendN === PENDING_MAX) this.pendDrop(0);
        this.pendLook[this.pendN] = oc.look; this.pendAt[this.pendN] = now; this.pendN++;
        const rec = this.add(FX_KIND.Cast, now, x, z, input.you, oc.look, 0, oc.primary ? 1 : 0, oc.aim);
        rec.rune = newRune(input.you, oc.look, castMode(oc.primary, 0), now, 0, oc.aim, x, z, rec.seed);
      }
    }
    // a figure that channels gets a swirl of runes of its own, for as long as it channels
    for (const f of input.figs) {
      if (f.anim !== ANIM.Channel) continue;
      let has = false;
      for (const r of recs) if (r.rune && r.rune.mode === 'channel' && r.rune.end === null && r.rune.caster === f.id) { has = true; break; }
      if (!has) {
        const rec = this.add(FX_KIND.Cast, now, f.x, f.z, f.id);
        rec.rune = newChannel(f.id, now, f.x, f.z, rec.seed);
      }
    }
    for (const draw of FRAME_DRAWERS) draw(out, input, this);
    // an action not seen for a few seconds is forgotten (checked once a second)
    if (now - this.pruned >= 1 || now < this.pruned) {
      this.pruned = now;
      for (const [id, m] of this.actions) if (now - m.seen > 3) this.actions.delete(id);
    }
    let w = 0;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      // an unbroken channel lasts as long as the figure channels
      const open = r.rune !== null && r.rune.mode === 'channel' && (r.rune.end === null || now - r.rune.end <= WINK);
      if (now - r.start > FX_LIFE[r.kind] && !open) continue;
      const draw = DRAWERS[r.kind];
      if (draw && now >= r.start && draw(out, input, r, now - r.start) === false) continue;
      recs[w++] = r;
    }
    recs.length = w;
  }
}
