import Phaser from 'phaser';
import { ABILITIES, ANIM, CLASSES, CONST, EFFECT, ENEMY_KINDS, FLAG, HITBOX, KIND, TILE_ID } from '../generated/defs';
import type { ClassId } from '../generated/ClassId';
import type { Ev } from '../generated/Ev';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Snapshot } from '../generated/Snapshot';
import type { Net } from '../net';
import type { DebugDraw, OwnHero } from '../run/view';
import { lineOfSight } from '../sim/collision';
import { shotHits } from '../sim/hitbox';
import { TileMap } from '../sim/map';
import type { Disabled, Hud } from '../ui/hud';
import { FIGURES, isProjectileKind } from './anim/defs';
import { lookOf } from './looks';
import { has } from './status';
import { LightField } from './light';
import { nextDarkvision } from './lightview';
import { PhaserRunView } from './PhaserRunView';
import { pickUseHint } from './useHint';
import { meleeFoe, shotPassesThrough } from './shotTargets';
import { FrameTimer, SYSTEMS, type DrawGl } from './frameTimer';
import { abilityChoice, slotUsable, cosmeticCount, cosmeticPierce, Interpolator, ownPredictedShot, Predictor, unseenShotLimit, volleyAngles, volleyShotIds, type EntState } from './world';

export interface GameInit {
  info: RunStartInfo;
  net: Net;
  hud: Hud;
  myClass: ClassId;
}

interface Cosmetic {
  shot: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /** Hit radius (as on the server). */
  r: number;
  target?: [number, number];
  seenOnServer: boolean;
  /** Piercing left (`ResolvedAbility.pierce` / `pierce_through`) and the damage it still carries. */
  pierce: number;
  through: number;
  damage: number;
  split: Record<string, number>;
  /** Enemies it was predicted to pass (never touched again, like the server's `hit`). */
  hit: Set<number>;
  /** When it was fired (s, `performance.now`). */
  born: number;
}

/** Kind id -> name, to look up `ENEMY_KINDS`. */
const KIND_NAME: Record<number, string> = Object.fromEntries(Object.entries(KIND).map(([name, id]) => [id, name]));
const ENEMY_KIND: Record<string, { max_hp: number; res: Record<string, number> } | undefined> = ENEMY_KINDS;

export class GameScene extends Phaser.Scene {
  private net!: Net;
  private hud!: Hud;
  /** The 2D drawing (every Phaser game object of a run); created at the end of `create`. */
  private view!: PhaserRunView;
  private info!: RunStartInfo;
  private map!: TileMap;
  private pred!: Predictor;
  private interp = new Interpolator();
  private ents = new Map<number, EntState>();
  private cosmetics: Cosmetic[] = [];
  /** Own shots whose cosmetic copy has ended (shot id -> time, s): their server copy stays hidden. */
  private endedShots = new Map<number, number>();
  /**
   * Own shots whose cosmetic copy was predicted to stop at an enemy (shot id -> the enemy's
   * position, the shot's direction and how far past the enemy's centre a shot has surely
   * passed it). If the server's shot is seen that far past, it is drawn.
   */
  private stoppedShots = new Map<number, { x: number; y: number; dx: number; dy: number; past: number }>();
  /** The server projectiles the view must not draw this frame (entity ids), see `hiddenShots`. */
  private hidden = new Set<number>();
  /** The own predicted shots that are on the server this frame (shot ids). */
  private myShots = new Set<number>();
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'Q' | 'E', Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private shotId = 0;
  private primaryClicked = false;
  private secondaryClicked = false;
  private actPressed = false;
  private localAnim: { anim: number; start: number; arc?: number } = { anim: ANIM.Idle as number, start: 0 };
  private alive = true;
  private myFlags = 0;
  private spectating: number | null = null;
  private lastSnap?: Snapshot;
  private light!: LightField;
  private unsub?: () => void;
  private frameMs = 0;
  /** The F3 panel's frame, render and per-system timings; on only while the panel is open. */
  private timer = new FrameTimer(SYSTEMS);
  private detachTimer?: () => void;
  private myKind = 0;
  /** A force field already stands over the boss hall (the first entrance tile announces it). */
  private sealed = false;
  /** The own hero as the view draws it, rebuilt each frame (`ownHero`). */
  private own: OwnHero = { x: 0, y: 0, alive: true, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false };
  // Debug mode (a debug run): immortal + path to the boss, drawn above the fog.
  private debug: DebugDraw = { on: false, path: [], ogre: [], cove: [], notice: [], dodges: [] };
  private debugImmortal = true;
  private debugEffect = -1;
  private lastAim = 0;
  /** Which picks an Attribute drain disabled (from `HeroChanged`). */
  private disabled: Disabled = [null, null];

  constructor() {
    super('game');
  }

  init(data: GameInit): void {
    this.net = data.net;
    this.hud = data.hud;
    this.info = data.info;
    this.cosmetics = [];
    this.endedShots.clear();
    this.stoppedShots.clear();
    this.interp = new Interpolator();
    this.ents = new Map();
    this.alive = true;
    this.spectating = null;
    this.acc = 0;
    this.myFlags = 0;
    this.lastSnap = undefined;
    this.disabled = [null, null];
    const tiles = this.info.tiles instanceof Uint8Array ? this.info.tiles : Uint8Array.from(this.info.tiles as ArrayLike<number>);
    this.map = new TileMap(this.info.width, this.info.height, new Uint8Array(tiles));
    this.sealed = tiles.includes(TILE_ID.DoorClosed);
    this.myKind = CLASSES[data.myClass].kind;
    this.pred = new Predictor(this.map, this.info.speed, this.info.abilities, this.info.fallback, this.info.spawn_x, this.info.spawn_y);
    this.light = new LightField(this.map);
    this.light.daylight = this.info.daylight;
    this.light.load(this.info.lights);
  }

  create(): void {
    // A debug run (from a debug room): the server puts every hero in debug mode, so the badge and F4/F7/F8/F9 work from the first frame.
    this.debug = { on: this.info.debug, path: [], ogre: [], cove: [], notice: [], dodges: [] };
    this.debugImmortal = true;

    const kb = this.input.keyboard!;
    // No key capture: Phaser's capture calls preventDefault page-wide and outlives the
    // scene, so these letters could no longer be typed into the lobby's inputs.
    this.keys = kb.addKeys('W,A,S,D,Q,E', false) as GameScene['keys'];
    kb.on('keydown-Q', () => this.net.send({ t: 'Spectate', dir: -1 }));
    kb.on('keydown-E', (e: KeyboardEvent) => {
      // One push per press: holding E must not push again on OS key repeat.
      if (this.alive) {
        if (!e.repeat) this.actPressed = true;
      }
      else this.net.send({ t: 'Spectate', dir: 1 });
    });
    kb.on('keydown-F3', (e: KeyboardEvent) => {
      e.preventDefault();
      this.hud.toggleDebug();
    });
    // Debug runs only (debug accounts): cycle your own hero's darkvision 0 -> 50% -> 100% -> 0.
    // Ignored otherwise, so a stray F4 never turns a normal run into a debug run, and
    // while dead (spectating, the snapshot's darkvision is the teammate's).
    kb.on('keydown-F4', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat || !this.debug.on || !this.alive) return;
      // The server announces the change to the party.
      this.net.send({ t: 'DebugDarkvision', ratio: nextDarkvision((this.lastSnap?.me.darkvision ?? 0) / 100) });
    });
    // Debug runs only (debug accounts): the nearest enemy within 8 tiles becomes incorporeal (and vanishes for 3 s).
    kb.on('keydown-F7', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat || !this.debug.on || !this.alive) return;
      // Shift+F7: your own hero's anti-magic on and off.
      this.net.send(e.shiftKey ? { t: 'DebugAntiMagic' } : { t: 'DebugIncorporeal' });
    });
    // Debug runs only (debug accounts): put the next effect on your own hero (Blind, Sleep, Petrified, Slowed, Accelerated).
    kb.on('keydown-F8', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat || !this.debug.on || !this.alive) return;
      // Shift+F8: a Dispel on your own hero (pauses up to 3 positive effects, items or nodes for 5 s).
      if (e.shiftKey) {
        this.net.send({ t: 'DebugDispel' });
        return;
      }
      this.debugEffect = (this.debugEffect + 1) % Object.keys(EFFECT).length;
      this.net.send({ t: 'DebugEffect', kind: this.debugEffect });
    });
    // Debug runs only (debug accounts): immortality off and on (the run stays a debug run).
    kb.on('keydown-F9', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat || !this.debug.on || !this.alive) return;
      this.net.send({ t: 'DebugImmortal', on: !this.debugImmortal });
    });
    kb.on('keydown-ESC', () => this.hud.toggleMenu());
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.secondaryClicked = true;
      else this.primaryClicked = true;
    });

    this.unsub = this.net.on((m) => this.onMessage(m));
    this.events.once('shutdown', () => this.cleanup());
    const renderer = this.game.renderer;
    this.detachTimer = this.timer.attach(this.game.events, renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? (renderer.gl as unknown as DrawGl) : null);
    this.hud.startRun(this.info);
    if (this.info.debug) this.hud.setDebug(true, true, true);
    this.view = new PhaserRunView(this, { info: this.info, map: this.map, light: this.light, myKind: this.myKind }, { net: this.net, timer: this.timer });
    this.hud.setToggles(this.view.rulesLog.settings());
  }

  private cleanup(): void {
    this.unsub?.();
    this.detachTimer?.();
    this.timer.on = false;
    this.view.destroy();
  }

  // ------------------------------------------------------------ network

  private onMessage(m: ServerMsg): void {
    if (m.t === "Snap") this.onSnapshot(m);
    else if (m.t === "DebugPath") {
      if (m.on !== this.debug.on || m.immortal !== this.debugImmortal) this.hud.setDebug(m.on, m.immortal, m.on !== this.debug.on);
      this.debug.on = m.on;
      this.debugImmortal = m.immortal;
      this.debug.path = m.points;
      this.debug.ogre = m.ogre;
      this.debug.cove = m.cove;
      this.debug.notice = m.notice;
    }
    else if (m.t === 'DebugDodge') {
      if (this.debug.on) this.debug.dodges.push({ x0: m.from[0], y0: m.from[1], x1: m.to[0], y1: m.to[1], at: performance.now() / 1000 });
    }
    else if (m.t === 'HeroChanged') {
      this.info = { ...this.info, speed: m.speed, abilities: m.abilities, fallback: m.fallback };
      this.disabled = m.disabled;
      this.pred.setNumbers(m.speed, m.abilities, m.fallback);
      this.hud.setAbilities(m.abilities, m.disabled);
    }
    else if (m.t === 'RunEnded') this.hud.showEnd(m);
  }

  private onSnapshot(s: Snapshot): void {
    const now = performance.now() / 1000;
    this.interp.push(s, now);
    this.lastSnap = s;
    this.pred.solids = s.ents.filter((e) => e[1] === KIND.Barrel && e[5] < 2).map((e) => ({ x: e[2], y: e[3], half: CONST.BARREL_RADIUS }));
    // The figure is drawn from the interpolated entity while charmed; when the charm ends the prediction blends in from there.
    const drawn = this.ents.get(this.info.you);
    if (s.me.alive) this.pred.reconcile(s, drawn ? [drawn.x, drawn.y] : undefined);
    if (this.alive && !s.me.alive) this.hud.message('You have fallen. Q / E to watch your party.');
    this.alive = s.me.alive;
    this.spectating = s.me.spectating;
    const mine = s.ents.find((e) => e[0] === this.info.you);
    this.myFlags = mine ? mine[8] : 0;
    for (const ev of s.ev) this.onEvent(ev);
    this.hud.snapshot(s, this.info);
    this.view.rulesLog.onSnapshot(s);
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
        this.view.event(ev, this.pred.state);
        break;
      case 'Tile':
        this.map.set(ev.x, ev.y, ev.v);
        this.light.mapChanged();
        if (ev.v === TILE_ID.DoorClosed) {
          // The entrance tiles arrive one event each; only announce the first.
          if (!this.sealed) this.hud.message('A force field seals the hall behind you!', 'game');
          this.sealed = true;
        }
        this.view.tileChanged(ev.x, ev.y, ev.v);
        break;
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
        this.view.event(ev, this.pred.state);
        if (this.alive) this.hud.addCoins(ev.v);
        break;
    }
  }

  // ------------------------------------------------------------ input & prediction

  private aimInfo(): { aim: number; dist: number } {
    const wp = this.view.pointerWorld();
    if (!wp) return { aim: this.lastAim, dist: 0 };
    const dx = wp.x - this.pred.state.x;
    const dy = wp.y - (this.pred.state.y - 8);
    return { aim: Math.atan2(dy, dx), dist: Math.hypot(dx, dy) };
  }

  private fixedStep(): void {
    if (!this.alive) {
      this.primaryClicked = this.secondaryClicked = this.actPressed = false;
      return;
    }
    const k = this.keys;
    // Charmed: the server drives the hero and ignores the input. Empty inputs keep its clock going and match what it
    // sees when the charm ends before the client knows (no flag on the wire); nothing is predicted.
    const charmed = this.pred.charmed;
    const mx = charmed ? 0 : (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0);
    const my = charmed ? 0 : (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
    const { aim: pointerAim, dist } = this.aimInfo();
    // Petrified or asleep: the server keeps the old facing, so the client sends it too.
    const aim = this.pred.noTurn ? this.lastAim : pointerAim;
    this.lastAim = aim;
    const ptr = this.input.activePointer;
    // Falling, drowning or pushed heroes cannot attack (the server ignores it).
    const free = !charmed && !this.hud.menuOpen && !this.pred.sinking && !this.pred.knocked && !this.pred.noAct;
    const wantPrimary = (ptr.leftButtonDown() || this.primaryClicked) && free;
    const wantSecondary = (ptr.rightButtonDown() || this.secondaryClicked) && free;
    const act = this.actPressed && free;
    this.primaryClicked = this.secondaryClicked = this.actPressed = false;

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
      else if (ABILITIES[this.info.abilities[1].id].shape === 'Dash') dash = [Math.cos(aim), Math.sin(aim)];
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
    const reach = this.info.fallback.range;
    return [...this.ents.values()].some((e) => {
      // A closed chest is struck like the hidden mimic it may be.
      if (e.kind === KIND.Chest) return e.anim === 0 && Math.hypot(e.x - x, e.y - y) - CONST.CHEST_RADIUS <= reach;
      // A flying dragon is out of reach, and a calm animal is no melee foe (a grudging boar is sent Hostile).
      return e.id !== this.info.you && meleeFoe(e) && Math.hypot(e.x - x, e.y - y) - (FIGURES[e.kind]?.baseR ?? 6) <= reach;
    });
  }

  /** False for a pick an Attribute drain disabled (a ranged primary in melee still strikes). */
  private slotUsable(slot: 0 | 1): boolean {
    const { x, y } = this.pred.state;
    return slotUsable(this.disabled, slot, this.info.abilities[0].ranged, this.inMelee(x, y));
  }

  /** The shot ids of the next use of the ability in `slot` (a Volley takes a run of them, none 0); the first is sent. */
  private reserveShots(slot: 0 | 1): number[] {
    const ids = volleyShotIds(this.shotId + 1, cosmeticCount(this.info.abilities[slot].id));
    this.shotId = ids[ids.length - 1];
    return ids;
  }

  /**
   * Play the action locally right away. Returns the predicted cooldown, or null when the
   * ability is blocked (a ranged secondary in melee): then it is not sent.
   */
  private predictAbility(slot: 0 | 1, shots: number[], aim: number, dist: number): number | null {
    const a = this.info.abilities[slot];
    const now = performance.now() / 1000;
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
          shots.forEach((shot, i) => this.spawnCosmetic(a.projectile!, shot, angles[i], a, a.radius, a.range / a.speed));
        }
        anim = ANIM.Shoot;
        break;
      }
      case 'Blast': {
        const d = Math.min(Math.max(dist, 24), a.range);
        // It flies with radius 4 (server abilities.rs); `a.radius` is its blast.
        this.spawnCosmetic(KIND.Fireball, shots[0], aim, a, 4, a.range / a.speed + 0.1, [x + Math.cos(aim) * d, y + Math.sin(aim) * d]);
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

  private spawnCosmetic(kind: number, shot: number, aim: number, a: ResolvedAbility, r: number, life: number, target?: [number, number]): void {
    const speed = a.speed;
    const { x, y } = this.pred.state;
    this.cosmetics.push({
      shot,
      kind,
      x: x + Math.cos(aim) * 6,
      y: y + Math.sin(aim) * 6,
      vx: Math.cos(aim) * speed,
      vy: Math.sin(aim) * speed,
      life,
      r,
      target,
      seenOnServer: false,
      pierce: a.pierce,
      through: a.pierce_through,
      damage: a.damage,
      split: a.split,
      hit: new Set(),
      born: performance.now() / 1000,
    });
  }

  /** The first thing the shot touches on its way to (nx, ny), skipping the enemies it passed. */
  private shotTouchesEnemy(c: Cosmetic, nx: number, ny: number): EntState | null {
    const steps = Math.max(1, Math.ceil(Math.hypot(nx - c.x, ny - c.y) / 4));
    for (const e of this.ents.values()) {
      if (e.flags & FLAG.DEAD || c.hit.has(e.id)) continue;
      // An opened chest lets shots pass; a closed one stops them (server `stops_shots`).
      if (e.kind === KIND.Chest && e.anim !== 0) continue;
      // Neutral and recruited creatures are not targets of a hero's shot.
      if (shotPassesThrough(e)) continue;
      const air = (e.flags & FLAG.AIRBORNE) !== 0;
      for (let k = 1; k <= steps; k++) {
        if (shotHits(e.kind, e.x, e.y, air, c.x + ((nx - c.x) * k) / steps, c.y + ((ny - c.y) * k) / steps, c.r)) return e;
      }
    }
    return null;
  }

  /** Whether the shot flies on past `e` (server `impact`); updates its piercing and damage if so. */
  private passes(c: Cosmetic, e: EntState): boolean {
    // Objects (a closed chest, a barrel) always stop a shot (server `impact_object`); so does a blast.
    if (c.target || e.kind === KIND.Chest || e.kind === KIND.Barrel) return false;
    const kind = ENEMY_KIND[KIND_NAME[e.kind]];
    const next = cosmeticPierce(c, e.hp * 255, kind?.max_hp, c.split, kind?.res);
    if (next === 'stop') return false;
    c.pierce = next.pierce;
    c.through = next.through;
    c.damage = next.damage;
    c.hit.add(e.id);
    return true;
  }

  /**
   * Which server projectiles the view does not draw this frame, and which own predicted shots are on the server.
   * Our own projectiles are shown by the local cosmetic copy, also once it has ended; but a shot predicted to stop at
   * an enemy that the server's shot flew on past after all is drawn from there on.
   */
  private hiddenShots(): void {
    const hidden = this.hidden;
    const mineOnServer = this.myShots;
    hidden.clear();
    mineOnServer.clear();
    for (const e of this.ents.values()) {
      if (!isProjectileKind(e.kind)) continue;
      const shot = e.extra & 0xffff;
      // Only shots the client predicted: the AI's shots of a charmed hero (ids from 0xF000) are the server's.
      const ownShot = ownPredictedShot(e.extra, this.info.you) !== null;
      if (ownShot) mineOnServer.add(shot);
      const stop = ownShot ? this.stoppedShots.get(shot) : undefined;
      // Predicted to stop, but the server's shot flew on past the enemy: show it from here on.
      // Both the position it is drawn at (interpolated, so it reappears past the enemy, never before it)
      // and its newest snapshot position (so an extrapolated overshoot of a shot that did stop never shows) must be past.
      const past = (x: number, y: number) => stop !== undefined && (x - stop.x) * stop.dx + (y - stop.y) * stop.dy > stop.past;
      const raw = stop && this.interp.latest()?.get(e.id);
      if (raw && past(raw[2], raw[3]) && past(e.x, e.y)) {
        this.stoppedShots.delete(shot);
        this.endedShots.delete(shot);
      }
      if (ownShot && (this.endedShots.has(shot) || this.cosmetics.some((c) => c.shot === shot))) hidden.add(e.id);
    }
  }

  private updateCosmetics(dt: number, serverShots: Set<number>, now: number): void {
    for (const [shot, t] of this.endedShots) {
      if (now - t <= 2) continue;
      this.endedShots.delete(shot);
      this.stoppedShots.delete(shot);
    }
    for (let i = this.cosmetics.length - 1; i >= 0; i--) {
      const c = this.cosmetics[i];
      const onServer = serverShots.has(c.shot);
      if (onServer) c.seenOnServer = true;
      c.life -= dt;
      const nx = c.x + c.vx * dt;
      const ny = c.y + c.vy * dt;
      const reachedTarget = c.target && (c.target[0] - nx) * c.vx + (c.target[1] - ny) * c.vy <= 0;
      const hitWall = !lineOfSight(this.map, c.x, c.y, nx, ny) || this.map.opaqueAt(nx, ny);
      // The server projectile hit something: ours ends too.
      const goneOnServer = c.seenOnServer && !onServer;
      // Predicted to pass an enemy, but the server's shot never showed up: it ended there (or soon after).
      const neverSeen = !c.seenOnServer && c.hit.size > 0 && now - c.born > unseenShotLimit(this.net.rtt, this.interp.delay);
      // Shots stop at the first enemy they touch unless they are predicted to pierce it
      // (the server decides the damage), checked every 4 px like there.
      const touched = hitWall ? null : this.shotTouchesEnemy(c, nx, ny);
      const hitEnemy = touched !== null && !this.passes(c, touched);
      if (c.life <= 0 || hitWall || goneOnServer || neverSeen || reachedTarget || hitEnemy) {
        // The view draws a spark at a wall; a wrongly predicted pass needs none of its own: the server's `Dmg` draws one at that enemy.
        this.view.shotEnded(c, hitWall ? 'wall' : hitEnemy ? 'enemy' : 'gone');
        this.cosmetics.splice(i, 1);
        this.endedShots.set(c.shot, now);
        // Predicted to stop: if the server's shot flies on past this enemy after all, it is drawn
        // (`hiddenShots`).
        if (hitEnemy) {
          const v = Math.hypot(c.vx, c.vy) || 1;
          this.stoppedShots.set(c.shot, { x: touched.x, y: touched.y, dx: c.vx / v, dy: c.vy / v, past: (HITBOX[touched.kind]?.r ?? 6) + c.r });
        }
        continue;
      }
      c.x = nx;
      c.y = ny;
    }
  }

  // ------------------------------------------------------------ frame

  update(_time: number, deltaMs: number): void {
    const t0 = performance.now();
    this.timer.on = this.hud.statsOn;
    this.timer.begin();
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= CONST.DT && steps < 5) {
      this.acc -= CONST.DT;
      this.fixedStep();
      steps++;
    }
    if (steps === 5) this.acc = 0;

    const now = performance.now() / 1000;
    this.interp.sample(now, this.ents);
    // Charmed: the server's hero, interpolated like any other entity, is the own figure and the camera's target.
    const charmedEnt = this.pred.charmed && this.alive ? this.ents.get(this.info.you) : undefined;
    const [px, py] = charmedEnt ? this.pred.charmedPos(charmedEnt.x, charmedEnt.y, dt) : this.pred.renderPos(dt);

    // Camera & fog follow the own figure, or the spectated teammate.
    let camX = px;
    let camY = py;
    if (!this.alive && this.spectating !== null) {
      const sp = this.ents.get(this.spectating);
      if (sp) {
        camX = sp.x;
        camY = sp.y;
      }
    }
    const darkvision = (this.lastSnap?.me.darkvision ?? 0) / 100;

    this.hiddenShots();
    this.updateCosmetics(dt, this.myShots, now);
    const own = this.ownHero(px, py, now);
    const hint = this.alive && !this.pred.charmed && !this.pred.noAct && !this.pred.sinking ? pickUseHint(this.ents.values(), this.info.you, px, py) : null;
    this.hud.setAsleep(this.alive && has(this.myEffects(), EFFECT.Sleep));
    this.timer.lap('sim');

    const stats = this.view.frame({
      dt,
      now,
      ents: this.ents,
      you: this.info.you,
      own,
      watching: this.spectating,
      camera: { x: camX, y: camY },
      snap: this.lastSnap,
      shots: this.cosmetics,
      hiddenShots: this.hidden,
      useHint: hint,
      debug: this.debug,
    });

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
      wolf: this.info.abilities[1].id === 'SummonWolf' ? this.hasOwnWolf() : null,
    });
    this.timer.lap('hud');
    // after the HUD, so `update` includes it; the panel shows it a frame later, which an average does not notice
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** The own hero as the view draws it: the prediction (position, action animation, facing), or the interpolated hero while charmed. */
  private ownHero(px: number, py: number, now: number): OwnHero {
    const o = this.own;
    o.x = px;
    o.y = py;
    o.alive = this.alive;
    o.charmed = this.pred.charmed;
    o.flags = this.myFlags;
    // Effects from the own snapshot (exact, not the interpolated entity), so they show at once.
    o.effects = this.myEffects();
    o.entangled = lookOf(this.lastSnap?.looks ?? [], this.info.you, EFFECT.Entangled);
    o.dashing = this.pred.state.dashT > 0;
    o.sinking = this.pred.sinking;
    if (this.alive && !this.pred.charmed) {
      // Petrified or asleep: the weapon keeps the facing from before the effect.
      o.aim = this.pred.noTurn ? this.lastAim : this.aimInfo().aim;
      const tLocal = now - this.localAnim.start;
      let anim = this.localAnim.anim;
      const actionOver = anim === ANIM.Dash ? this.pred.state.dashT <= 0 : tLocal > 0.25;
      if (actionOver) {
        const moving = this.pred.speedMul > 0 && (this.keys.W.isDown || this.keys.A.isDown || this.keys.S.isDown || this.keys.D.isDown);
        anim = moving ? ANIM.Move : ANIM.Idle;
      }
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
    for (const e of this.ents.values()) if (e.kind === KIND.DireWolf && e.extra === this.info.you && !(e.flags & FLAG.DEAD)) return true;
    return false;
  }
}
