// Per-figure bookkeeping shared by the 2D and the 3D view, Phaser-free: which state a figure is drawn from (predicted
// for the own hero, interpolated otherwise), the fall into a chasm or the drowning of a hero lost to the terrain, and
// the vanish and reappear marks of Invisible. The views keep the pictures (splashes, bubbles, ghost images).
import { ANIM, CONST, EFFECT, SIDE, TILE_ID } from '../../generated/defs';
import type { OwnHero, PictureEv } from '../../run/view';
import type { TileMap } from '../../sim/map';
import { sinkDepth } from '../terrain-layers';
import type { EntState } from '../world';
import { isPlayerKind } from './defs';
import { MARK_TTL, Marks, skimsTerrain } from './entityAlpha';
import type { ViewState } from './pose';

interface Sink {
  x: number;
  y: number;
  drown: boolean;
  t: number;
}

export class FigureStates {
  /** Heroes falling into a chasm or drowning (from `Ev::Sink`, or predicted for the own hero). */
  private sinks = new Map<number, Sink>();
  /** Entities that just reappeared from Invisible: their view fades in when it is created. */
  private reappearing = new Marks(MARK_TTL);
  /** Enemies that went invisible: a ghost is left where the view is last drawn, when it is culled. */
  private vanishing = new Marks(MARK_TTL);

  constructor(private readonly map: TileMap) {}

  /** The ViewState a figure is drawn from this frame: predicted for the own hero (unless charmed), interpolated otherwise; sink, fall and drown applied. `started` is true on the frame a predicted sink begins (2D plays sinkStartFx). */
  stateOf(e: EntState, f: { you: number; own: OwnHero }, nowS: number): { s: ViewState; predicted: boolean; started: boolean; drowning: boolean } {
    // The own figure is drawn from prediction, except while charmed: then it is the server's, interpolated hero.
    const predicted = e.id === f.you && f.own.alive && !f.own.charmed;
    let s: ViewState;
    if (predicted) {
      // Effects from the own snapshot (exact, not the interpolated entity), so they show at once.
      s = { x: f.own.x, y: f.own.y, anim: f.own.anim, animT: f.own.animT, aim: f.own.aim, flags: f.own.flags, effects: f.own.effects, entangled: e.entangled, party: isPlayerKind(e.kind), swingArc: f.own.anim === ANIM.Melee ? f.own.arc : undefined };
    } else {
      s = { id: e.id, x: e.x, y: e.y, anim: e.anim, animT: e.animMs / 1000, aim: e.aim, flags: e.flags, effects: e.effects, entangled: e.entangled, party: isPlayerKind(e.kind) };
    }
    const tile = this.map.tileAt(s.x, s.y);
    let started = false;
    if (predicted && f.own.sinking && !this.sinks.has(e.id)) {
      this.sinks.set(e.id, { x: s.x, y: s.y, drown: tile === TILE_ID.DeepWater, t: nowS });
      started = true;
    }
    const sk = this.sinks.get(e.id);
    if (sk) {
      const k = Math.min(1, (nowS - sk.t) / (sk.drown ? CONST.DROWN_TIME : CONST.FALL_TIME));
      Object.assign(s, { x: sk.x, y: sk.y, anim: ANIM.Idle, animT: 0, fall: sk.drown ? 0 : k, drown: sk.drown ? k : 0 });
      return { s, predicted, started, drowning: sk.drown };
    }
    const dashing = skimsTerrain(e.flags, predicted ? f.own.dashing : e.anim === ANIM.Dash);
    s.sink = dashing ? 0 : sinkDepth(tile);
    return { s, predicted, started, drowning: false };
  }

  /** Whether a figure is falling or drowning (the 2D view plays its start effect when a Sink event begins one). */
  sinking(id: number): boolean {
    return this.sinks.has(id);
  }

  /** Sink, Effect(Invisible) and Died bookkeeping. Died returns 'lost' when the figure fell or drowned (no skull). */
  event(ev: PictureEv, nowS: number): 'lost' | null {
    switch (ev.t) {
      case 'Died':
        return this.sinks.delete(ev.id) ? 'lost' : null;
      case 'Sink':
        if (ev.how === 2) this.sinks.delete(ev.id); // debug: back on safe ground
        else if (!this.sinks.has(ev.id)) this.sinks.set(ev.id, { x: ev.x, y: ev.y, drown: ev.how === 1, t: nowS });
        return null;
      case 'Effect':
        // Invisible has a default fade: the entity leaves the snapshot at once, so a ghost image fades out; on return it fades in.
        if (ev.kind === EFFECT.Invisible) {
          if (ev.on) (this.vanishing.add(ev.id, nowS), this.reappearing.delete(ev.id));
          else (this.reappearing.add(ev.id, nowS), this.vanishing.delete(ev.id));
        }
        return null;
      default:
        return null;
    }
  }

  /** The own figure when it is missing from `ents` but alive (2D's fallback entity). */
  ownEntity(f: { you: number; own: OwnHero }, myKind: number): EntState {
    return { id: f.you, kind: myKind, x: f.own.x, y: f.own.y, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: f.own.effects, side: SIDE.Friendly, entangled: f.own.entangled };
  }

  takeReappear(id: number, nowS: number): boolean {
    return this.reappearing.take(id, nowS);
  }

  takeVanish(id: number, nowS: number): boolean {
    return this.vanishing.take(id, nowS);
  }

  prune(nowS: number): void {
    this.reappearing.prune(nowS);
    this.vanishing.prune(nowS);
  }

  clear(): void {
    this.sinks.clear();
    this.reappearing.clear();
    this.vanishing.clear();
  }
}
