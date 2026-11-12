// The run session: everything of a run that is not a picture. It owns the map,
// the light field, the predictor, the interpolator, the HUD and net traffic;
// a view (the 2D game or the 3D view) draws what the session hands it. The
// session never imports a view; it asks the view one question (pointerWorld).
import { ABILITIES, ANIM, CLASSES, CONST, EFFECT, FLAG, KIND, TILE_ID } from '../generated/defs';
import { has } from '../game/effectBits';
import { lookOf } from '../game/looks';
import { pickUseHint } from '../game/useHint';
import { FIGURES } from '../game/anim/defs';
import { meleeFoe } from '../game/shotTargets';
import type { ClassId } from '../generated/ClassId';
import type { Ev } from '../generated/Ev';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Snapshot } from '../generated/Snapshot';
import { nextDarkvision } from '../game/darkvisionSteps';
import { LightField } from '../game/light';
import { abilityChoice, cosmeticCount, Interpolator, Predictor, slotUsable, volleyAngles, volleyShotIds, type EntState } from '../game/world';
import { TileMap } from '../sim/map';
import type { Net } from '../net';
import type { Disabled, Hud } from '../ui/hud';
import { aimAt } from './aim';
import { NO_INPUT, type StepInput } from './input';
import { Shots } from './shots';
import { NO_STATS, type DebugDraw, type OwnHero, type RunView, type RunViewInit } from './view';

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
  | 'setTurnHelp'
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
  /** The rules log: it hears every snapshot after the HUD, and ends with the session. */
  log?: { onSnapshot(s: Snapshot): void; destroy(): void };
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
  private readonly input: () => StepInput;
  private readonly clock?: FrameClock;
  private readonly log?: SessionDeps['log'];
  private readonly now: () => number;
  private readonly pred: Predictor;
  private readonly interp = new Interpolator();
  /** The drawn entities by id; the frame fills it from `interp.sample`. */
  private readonly ents = new Map<number, EntState>();
  private view: RunView | null = null;
  private isAlive = true;
  private spectating: number | null = null;
  private lastSnap?: Snapshot;
  private myFlags = 0;
  /** The own hero's server position in the snapshot being dispatched (the 3D view places hits on the hero from it). */
  private serverOwn: { x: number; y: number } | null = null;
  /** Which picks an Attribute drain disabled (from `HeroChanged`). */
  private disabled: Disabled = [null, null];
  /** Entrance tiles of the boss hall that are closed now: the first one announces the force field. */
  private sealedCells = 0;
  private readonly debug: DebugDraw;
  private immortal = true;
  private effectIx = -1;
  private unsub: (() => void) | null;
  /** The own predicted shots (the view draws them from the frame). */
  private readonly shots = new Shots();
  private acc = 0;
  private shotId = 0;
  private lastAim = 0;
  /** The last step's input (the own animation's "moving" and the drawn aim). */
  private lastInput: StepInput = NO_INPUT;
  /** The own hero's last action animation (the frame's `own`). */
  private localAnim: { anim: number; start: number; arc?: number } = { anim: ANIM.Idle as number, start: 0 };
  /** The own hero as drawn this frame, rebuilt each frame (`ownHero`). */
  private readonly own: OwnHero = { x: 0, y: 0, alive: true, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, aimsAtPointer: false, aimFromX: 0, aimFromY: 0, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false };
  /** `frame`'s own duration, ms, averaged; the HUD shows it. */
  private frameMs = 0;

  constructor(deps: SessionDeps) {
    this.runInfo = deps.info;
    this.net = deps.net;
    this.hud = deps.hud;
    this.input = deps.input;
    this.clock = deps.clock;
    this.log = deps.log;
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

  // ------------------------------------------------------------ frame, input & prediction

  /** One display frame: the fixed steps, then the sampled world, the view's frame and the HUD's. */
  frame(deltaMs: number): void {
    const t0 = performance.now();
    if (this.clock) {
      this.clock.on = this.hud.statsOn;
      this.clock.begin();
    }
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= CONST.DT && steps < 5) {
      this.acc -= CONST.DT;
      this.fixedStep();
      steps++;
    }
    if (steps === 5) this.acc = 0;

    const now = this.now();
    this.interp.sample(now, this.ents);
    // Charmed: the server's hero, interpolated like any other entity, is the own figure and the camera's target.
    const charmedEnt = this.pred.charmed && this.isAlive ? this.ents.get(this.runInfo.you) : undefined;
    const [px, py] = charmedEnt ? this.pred.charmedPos(charmedEnt.x, charmedEnt.y, dt) : this.pred.renderPos(dt);

    // Camera & fog follow the own figure, or the spectated teammate.
    let camX = px;
    let camY = py;
    if (!this.isAlive && this.spectating !== null) {
      const sp = this.ents.get(this.spectating);
      if (sp) {
        camX = sp.x;
        camY = sp.y;
      }
    }
    const darkvision = (this.lastSnap?.me.darkvision ?? 0) / 100;

    const hiddenShots = this.shots.hidden(this.ents, this.interp.latest(), this.runInfo.you);
    this.shots.update(dt, now, { map: this.map, ents: this.ents, rtt: this.net.rtt, interpDelay: this.interp.delay }, (s, how) => this.view?.shotEnded(s, how));
    const own = this.ownHero(px, py, now);
    const useHint = this.isAlive && !this.pred.charmed && !this.pred.noAct && !this.pred.sinking ? pickUseHint(this.ents.values(), this.runInfo.you, px, py) : null;
    this.hud.setAsleep(this.isAlive && has(this.myEffects(), EFFECT.Sleep));
    // Dodge lines fade over 0.6 s; none while debug is off or the hero is dead. The session owns the array, so it prunes it.
    const dodges = this.debug.dodges;
    if (!this.debug.on || !this.isAlive) dodges.length = 0;
    else for (let i = dodges.length - 1; i >= 0; i--) if (now - dodges[i].at >= 0.6) dodges.splice(i, 1);
    this.clock?.lap('sim');

    const stats = this.view
      ? this.view.frame({
          dt,
          now,
          ents: this.ents,
          you: this.runInfo.you,
          own,
          watching: this.spectating,
          camera: { x: camX, y: camY },
          snap: this.lastSnap,
          shots: this.shots.live,
          hiddenShots,
          useHint,
          debug: this.debug,
        })
      : NO_STATS;

    this.hud.frame({
      ...stats,
      frameMs: this.frameMs,
      rtt: this.net.rtt,
      jitter: this.interp.jitter * 1000,
      interp: this.interp.delay * 1000,
      snapBytes: this.net.lastSnapshotBytes,
      correction: this.pred.lastCorrection,
      srvMs: this.lastSnap?.srv_ms ?? 0,
      cd1: this.pred.cd1,
      cd2: this.pred.cd2,
      ents: this.ents.size,
      darkvision,
      wolf: this.runInfo.abilities[1].id === 'SummonWolf' ? this.hasOwnWolf() : null,
    });
    this.clock?.lap('hud');
    // after the HUD, so the frame includes it; the panel shows it a frame later, which an average does not notice
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** The own hero as the view draws it: the prediction (position, action animation, facing), or the interpolated hero while charmed. */
  private ownHero(px: number, py: number, now: number): OwnHero {
    const o = this.own;
    o.x = px;
    o.y = py;
    o.alive = this.isAlive;
    o.charmed = this.pred.charmed;
    o.flags = this.myFlags;
    // Effects from the own snapshot (exact, not the interpolated entity), so they show at once.
    o.effects = this.myEffects();
    o.entangled = lookOf(this.lastSnap?.looks ?? [], this.runInfo.you, EFFECT.Entangled);
    o.dashing = this.pred.state.dashT > 0;
    o.sinking = this.pred.sinking;
    o.aimsAtPointer = this.isAlive && !this.pred.charmed && !this.pred.noTurn;
    o.aimFromX = this.pred.state.x;
    o.aimFromY = this.pred.state.y;
    if (this.isAlive && !this.pred.charmed) {
      // Petrified or asleep: the weapon keeps the facing from before the effect.
      o.aim = this.pred.noTurn ? this.lastAim : this.aimInfo(this.lastInput.mx, this.lastInput.my).aim;
      const tLocal = now - this.localAnim.start;
      let anim = this.localAnim.anim;
      const actionOver = anim === ANIM.Dash ? this.pred.state.dashT <= 0 : tLocal > 0.25;
      if (actionOver) anim = this.pred.speedMul > 0 && this.lastInput.held ? ANIM.Move : ANIM.Idle;
      o.anim = anim;
      o.animT = tLocal;
      o.arc = anim === ANIM.Melee ? this.localAnim.arc : undefined;
    }
    return o;
  }

  /** The own hero's effects as a bitmask, from the own snapshot. */
  private myEffects(): number {
    let bits = 0;
    for (const [k] of this.lastSnap?.me.effects ?? []) bits |= 1 << k;
    return bits;
  }

  /** The own hero's dire wolf is alive (the HUD's wolf flag); a loop, as it runs every frame. */
  private hasOwnWolf(): boolean {
    for (const e of this.ents.values()) if (e.kind === KIND.DireWolf && e.extra === this.runInfo.you && !(e.flags & FLAG.DEAD)) return true;
    return false;
  }

  /**
   * The aim at the pointer, and its distance (0 without one). Without a pointer the aim follows the movement
   * (`mx`, `my`), else it stays. Used by the step and by the drawn weapon.
   */
  private aimInfo(mx: number, my: number): { aim: number; dist: number } {
    const wp = this.view?.pointerWorld() ?? null;
    if (wp) return aimAt(this.pred.state, wp);
    return { aim: mx !== 0 || my !== 0 ? Math.atan2(my, mx) : this.lastAim, dist: 0 };
  }

  private fixedStep(): void {
    // Always read, also while dead: it consumes the host's click latches.
    const inp = this.input();
    if (!this.isAlive) return;
    this.lastInput = inp;
    // Charmed: the server drives the hero and ignores the input. Empty inputs keep its clock going and match what it
    // sees when the charm ends before the client knows (no flag on the wire); nothing is predicted.
    const charmed = this.pred.charmed;
    const mx = charmed ? 0 : inp.mx;
    const my = charmed ? 0 : inp.my;
    const { aim: pointerAim, dist } = this.aimInfo(mx, my);
    // Petrified or asleep: the server keeps the old facing, so the client sends it too.
    const aim = this.pred.noTurn ? this.lastAim : pointerAim;
    this.lastAim = aim;
    // Falling, drowning or pushed heroes cannot attack (the server ignores it).
    const free = !charmed && !this.hud.menuOpen && !this.pred.sinking && !this.pred.knocked && !this.pred.noAct;
    const wantPrimary = inp.primary && free;
    const wantSecondary = inp.secondary && free;
    const act = inp.act && free;

    let primary: number | null = null;
    let secondary: number | null = null;
    let dash: [number, number] | null = null;
    const used: [number | null, number | null] = [null, null];
    const usable = [this.slotUsable(0), this.slotUsable(1)] as const;
    if (wantPrimary && !usable[0]) this.hud.needs(0, this.disabled[0]!);
    if (wantSecondary && !usable[1]) this.hud.needs(1, this.disabled[1]!);
    if (wantPrimary && this.pred.cd1 <= 0 && usable[0]) {
      const ids = this.reserveShots(0);
      primary = ids[0];
      used[0] = this.predictAbility(0, ids, aim, dist);
    }
    if (wantSecondary && this.pred.cd2 <= 0 && usable[1]) {
      const ids = this.reserveShots(1);
      secondary = ids[0];
      used[1] = this.predictAbility(1, ids, aim, dist);
      if (used[1] === null) secondary = null;
      else if (ABILITIES[this.runInfo.abilities[1].id].shape === 'Dash') dash = [Math.cos(aim), Math.sin(aim)];
    }
    const seq = this.pred.step(mx, my, dash, used);
    const viewLag = this.net.rtt / 2 + this.interp.delay * 1000;
    this.net.send({
      t: 'Input',
      seq,
      mx,
      my,
      aim,
      aim_dist: dist,
      primary,
      secondary,
      view_lag: Math.min(Math.round(viewLag), 65535),
      rtt: Math.min(Math.round(this.net.rtt), 65535),
      act,
    });
  }

  /**
   * Whether a monster on the ground (not an ally) or a closed chest is within the hero's
   * reach (server `melee_target`): in melee a ranged ability falls back or is blocked.
   */
  private inMelee(x: number, y: number): boolean {
    const reach = this.runInfo.fallback.range;
    return [...this.ents.values()].some((e) => {
      // A closed chest is struck like the hidden mimic it may be.
      if (e.kind === KIND.Chest) return e.anim === 0 && Math.hypot(e.x - x, e.y - y) - CONST.CHEST_RADIUS <= reach;
      // A flying dragon is out of reach, and a calm animal is no melee foe (a grudging boar is sent Hostile).
      return e.id !== this.runInfo.you && meleeFoe(e) && Math.hypot(e.x - x, e.y - y) - (FIGURES[e.kind]?.baseR ?? 6) <= reach;
    });
  }

  /** False for a pick an Attribute drain disabled (a ranged primary in melee still strikes). */
  private slotUsable(slot: 0 | 1): boolean {
    const { x, y } = this.pred.state;
    return slotUsable(this.disabled, slot, this.runInfo.abilities[0].ranged, this.inMelee(x, y));
  }

  /** The shot ids of the next use of the ability in `slot` (a Volley takes a run of them, none 0); the first is sent. */
  private reserveShots(slot: 0 | 1): number[] {
    const ids = volleyShotIds(this.shotId + 1, cosmeticCount(this.runInfo.abilities[slot].id));
    this.shotId = ids[ids.length - 1];
    return ids;
  }

  /**
   * Play the action locally right away. Returns the predicted cooldown, or null when the
   * ability is blocked (a ranged secondary in melee): then it is not sent.
   */
  private predictAbility(slot: 0 | 1, shots: number[], aim: number, dist: number): number | null {
    const a = this.runInfo.abilities[slot];
    const now = this.now();
    const { x, y } = this.pred.state;
    const choice = abilityChoice(a, slot, a.ranged && this.inMelee(x, y));
    if (choice === 'blocked') {
      this.hud.tooClose(1);
      return null;
    }
    if (choice === 'fallback') {
      this.localAnim = { anim: ANIM.Melee, start: now };
      return this.pred.cooldownOf(slot, true);
    }
    let anim: number = ANIM.Cast;
    let arc: number | undefined;
    const shape = ABILITIES[a.id].shape;
    switch (shape) {
      case 'Projectile': {
        if (a.projectile !== null) {
          const angles = volleyAngles(aim, shots.length, CONST.VOLLEY_SPREAD);
          shots.forEach((shot, i) => this.shots.spawn(a.projectile!, shot, angles[i], a, a.radius, a.range / a.speed, { x, y }, now));
        }
        anim = ANIM.Shoot;
        break;
      }
      case 'Blast': {
        const d = Math.min(Math.max(dist, 24), a.range);
        // It flies with radius 4 (server abilities.rs); `a.radius` is its blast.
        this.shots.spawn(KIND.Fireball, shots[0], aim, a, 4, a.range / a.speed + 0.1, { x, y }, now, [x + Math.cos(aim) * d, y + Math.sin(aim) * d]);
        anim = ANIM.Cast;
        break;
      }
      case 'Swing':
        anim = ANIM.Melee;
        arc = a.arc;
        break;
      case 'Dash':
        anim = ANIM.Dash;
        break;
      case 'Ring':
      case 'SelfArea':
      case 'GroundArea':
      case 'Buff':
      case 'Summon':
      // No hero has these shapes (the bosses' breath and gaze).
      case 'Breath':
      case 'Gaze':
        anim = ANIM.Cast;
        break;
      default: {
        const unhandled: never = shape;
        throw new Error(`unhandled shape ${String(unhandled)}`);
      }
    }
    this.localAnim = { anim, start: now, arc };
    return this.pred.cooldownOf(slot);
  }

  destroy(): void {
    this.unsub?.();
    this.unsub = null;
    this.log?.destroy();
  }

  // ------------------------------------------------------------ network

  /** A message that arrived before the session subscribed (the 3D start buffers them while its chunk loads). */
  receive(m: ServerMsg): void {
    this.onMessage(m);
  }

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
    // The figure is drawn from the interpolated entity while charmed; when the charm ends the prediction blends in from there.
    const drawn = this.ents.get(this.runInfo.you);
    if (s.me.alive) this.pred.reconcile(s, drawn ? [drawn.x, drawn.y] : undefined);
    if (this.isAlive && !s.me.alive) this.hud.message('You have fallen. Q / E to watch your party.');
    this.isAlive = s.me.alive;
    this.spectating = s.me.spectating;
    const mine = s.ents.find((e) => e[0] === this.runInfo.you);
    this.myFlags = mine ? mine[8] : 0;
    this.serverOwn = mine ? { x: mine[2], y: mine[3] } : null;
    for (const ev of s.ev) this.onEvent(ev);
    this.hud.snapshot(s, this.runInfo);
    this.log?.onSnapshot(s);
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
        this.view?.event(ev, this.pred.state, this.serverOwn);
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
        this.view?.event(ev, this.pred.state, this.serverOwn);
        if (this.isAlive) this.hud.addCoins(ev.v);
        break;
    }
  }
}
