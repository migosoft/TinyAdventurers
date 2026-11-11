// The run session: everything of a run that is not a picture. It owns the map,
// the light field, the predictor, the interpolator, the HUD and net traffic;
// a view (the 2D game or the 3D view) draws what the session hands it. The
// session never imports a view; it asks the view one question (pointerWorld).
import { CLASSES, CONST, EFFECT, KIND, TILE_ID } from '../generated/defs';
import type { ClassId } from '../generated/ClassId';
import type { Ev } from '../generated/Ev';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Snapshot } from '../generated/Snapshot';
import { nextDarkvision } from '../game/darkvisionSteps';
import { LightField } from '../game/light';
import { Interpolator, Predictor } from '../game/world';
import { TileMap } from '../sim/map';
import type { Net } from '../net';
import type { Disabled, Hud } from '../ui/hud';
import type { StepInput } from './input';
import type { DebugDraw, RunView, RunViewInit } from './view';

export type NetLike = Pick<Net, 'on' | 'send' | 'rtt' | 'lastSnapshotBytes'>;
export type HudLike = Pick<
  Hud,
  | 'startRun'
  | 'setDebug'
  | 'snapshot'
  | 'message'
  | 'setAbilities'
  | 'showEnd'
  | 'addCoins'
  | 'needs'
  | 'tooClose'
  | 'frame'
  | 'setAsleep'
  | 'toggleDebug'
  | 'toggleMenu'
  | 'statsOn'
  | 'menuOpen'
>;
/** The host's frame timer, as far as the session uses it. `FrameTimer` fits. */
export interface FrameClock {
  on: boolean;
  begin(): void;
  lap(s: 'sim' | 'hud'): void;
}

export interface SessionDeps {
  info: RunStartInfo;
  net: NetLike;
  hud: HudLike;
  myClass: ClassId;
  /** Called once per fixed step, also while dead (it consumes click latches). */
  input: () => StepInput;
  clock?: FrameClock;
  /** Seconds; default `performance.now() / 1000`. */
  now?: () => number;
}

export class RunSession {
  readonly map: TileMap;
  readonly light: LightField;
  readonly myKind: number;

  private runInfo: RunStartInfo;
  private readonly net: NetLike;
  private readonly hud: HudLike;
  // The next five are read by `frame` (A5); not private so the unused-member check passes until then.
  readonly input: () => StepInput;
  readonly clock?: FrameClock;
  private readonly now: () => number;
  private readonly pred: Predictor;
  private readonly interp = new Interpolator();
  private view: RunView | null = null;
  private isAlive = true;
  spectating: number | null = null;
  private lastSnap?: Snapshot;
  myFlags = 0;
  /** Which picks an Attribute drain disabled (from `HeroChanged`). */
  disabled: Disabled = [null, null];
  /** Entrance tiles of the boss hall that are closed now: the first one announces the force field. */
  private sealedCells = 0;
  private readonly debug: DebugDraw;
  private immortal = true;
  private effectIx = -1;
  private unsub: (() => void) | null;

  constructor(deps: SessionDeps) {
    this.runInfo = deps.info;
    this.net = deps.net;
    this.hud = deps.hud;
    this.input = deps.input;
    this.clock = deps.clock;
    this.now = deps.now ?? (() => performance.now() / 1000);
    const info = deps.info;
    const tiles = info.tiles instanceof Uint8Array ? info.tiles : Uint8Array.from(info.tiles as ArrayLike<number>);
    this.map = new TileMap(info.width, info.height, new Uint8Array(tiles));
    for (const t of tiles) if (t === TILE_ID.DoorClosed) this.sealedCells++;
    this.myKind = CLASSES[deps.myClass].kind;
    this.pred = new Predictor(this.map, info.speed, info.abilities, info.fallback, info.spawn_x, info.spawn_y);
    this.light = new LightField(this.map);
    this.light.daylight = info.daylight;
    this.light.load(info.lights);
    // A debug run: the server puts every hero in debug mode, so the badge and F4/F7/F8/F9 work from the first frame.
    this.debug = { on: info.debug, path: [], ogre: [], cove: [], notice: [], dodges: [] };
    this.unsub = this.net.on((m) => this.onMessage(m));
    this.hud.startRun(info);
    if (info.debug) this.hud.setDebug(true, true, true);
  }

  get info(): RunStartInfo {
    return this.runInfo;
  }

  get alive(): boolean {
    return this.isAlive;
  }

  viewInit(): RunViewInit {
    return { info: this.runInfo, map: this.map, light: this.light, myKind: this.myKind };
  }

  setView(v: RunView | null): void {
    this.view = v;
  }

  // ------------------------------------------------------------ keys

  spectate(dir: -1 | 1): void {
    this.net.send({ t: 'Spectate', dir });
  }

  toggleStats(): void {
    this.hud.toggleDebug();
  }

  toggleMenu(): void {
    this.hud.toggleMenu();
  }

  /** Cycles your own hero's darkvision 0 -> 50% -> 100% -> 0 (the server announces it to the party). */
  debugDarkvision(): void {
    if (!this.debugKeyOk()) return;
    this.net.send({ t: 'DebugDarkvision', ratio: nextDarkvision((this.lastSnap?.me.darkvision ?? 0) / 100) });
  }

  /** The nearest enemy within 8 tiles becomes incorporeal (and vanishes for 3 s). */
  debugIncorporeal(): void {
    if (!this.debugKeyOk()) return;
    this.net.send({ t: 'DebugIncorporeal' });
  }

  /** Your own hero's anti-magic on and off. */
  debugAntiMagic(): void {
    if (!this.debugKeyOk()) return;
    this.net.send({ t: 'DebugAntiMagic' });
  }

  /** Puts the next effect on your own hero. */
  debugEffect(): void {
    if (!this.debugKeyOk()) return;
    this.effectIx = (this.effectIx + 1) % Object.keys(EFFECT).length;
    this.net.send({ t: 'DebugEffect', kind: this.effectIx });
  }

  /** A Dispel on your own hero. */
  debugDispel(): void {
    if (!this.debugKeyOk()) return;
    this.net.send({ t: 'DebugDispel' });
  }

  /** Immortality off and on (the run stays a debug run). */
  debugImmortal(): void {
    if (!this.debugKeyOk()) return;
    this.net.send({ t: 'DebugImmortal', on: !this.immortal });
  }

  /** Debug runs only, and while alive (dead, the snapshot's darkvision is the teammate's). */
  private debugKeyOk(): boolean {
    return this.debug.on && this.isAlive;
  }

  destroy(): void {
    this.unsub?.();
    this.unsub = null;
  }

  // ------------------------------------------------------------ network

  private onMessage(m: ServerMsg): void {
    if (m.t === 'Snap') this.onSnapshot(m);
    else if (m.t === 'DebugPath') {
      if (m.on !== this.debug.on || m.immortal !== this.immortal) this.hud.setDebug(m.on, m.immortal, m.on !== this.debug.on);
      this.debug.on = m.on;
      this.immortal = m.immortal;
      this.debug.path = m.points;
      this.debug.ogre = m.ogre;
      this.debug.cove = m.cove;
      this.debug.notice = m.notice;
    } else if (m.t === 'DebugDodge') {
      if (this.debug.on) this.debug.dodges.push({ x0: m.from[0], y0: m.from[1], x1: m.to[0], y1: m.to[1], at: this.now() });
    } else if (m.t === 'HeroChanged') {
      this.runInfo = { ...this.runInfo, speed: m.speed, abilities: m.abilities, fallback: m.fallback };
      this.disabled = m.disabled;
      this.pred.setNumbers(m.speed, m.abilities, m.fallback);
      this.hud.setAbilities(m.abilities, m.disabled);
    } else if (m.t === 'RunEnded') this.hud.showEnd(m);
  }

  private onSnapshot(s: Snapshot): void {
    this.interp.push(s, this.now());
    this.lastSnap = s;
    this.pred.solids = s.ents.filter((e) => e[1] === KIND.Barrel && e[5] < 2).map((e) => ({ x: e[2], y: e[3], half: CONST.BARREL_RADIUS }));
    if (s.me.alive) this.pred.reconcile(s, undefined);
    if (this.isAlive && !s.me.alive) this.hud.message('You have fallen. Q / E to watch your party.');
    this.isAlive = s.me.alive;
    this.spectating = s.me.spectating;
    const mine = s.ents.find((e) => e[0] === this.runInfo.you);
    this.myFlags = mine ? mine[8] : 0;
    for (const ev of s.ev) this.onEvent(ev);
    this.hud.snapshot(s, this.runInfo);
  }

  private onEvent(ev: Ev): void {
    switch (ev.t) {
      case 'Dmg':
      case 'Heal':
      case 'Boom':
      case 'Zap':
      case 'Died':
      case 'Sink':
      case 'Raise':
      case 'Immune':
      case 'Effect':
        this.view?.event(ev, this.pred.state);
        break;
      case 'Tile': {
        const was = this.map.get(ev.x, ev.y);
        this.map.set(ev.x, ev.y, ev.v);
        this.light.mapChanged();
        if (was === TILE_ID.DoorClosed) this.sealedCells--;
        if (ev.v === TILE_ID.DoorClosed) {
          // The entrance tiles arrive one event each; only announce the first.
          if (this.sealedCells === 0) this.hud.message('A force field seals the hall behind you!', 'game');
          this.sealedCells++;
        }
        this.view?.tileChanged(ev.x, ev.y, ev.v);
        break;
      }
      case 'Light':
        this.light.set(ev.id, ev.on, ev.colour);
        break;
      case 'LightAdd':
        this.light.add({ id: ev.id, kind: ev.kind, colour: ev.colour, x: ev.x, y: ev.y, on: ev.on });
        break;
      case 'LightRemove':
        this.light.remove(ev.id);
        break;
      case 'Msg':
        this.hud.message(ev.text, 'game');
        break;
      case 'Coins':
        this.view?.event(ev, this.pred.state);
        if (this.isAlive) this.hud.addCoins(ev.v);
        break;
    }
  }
}
