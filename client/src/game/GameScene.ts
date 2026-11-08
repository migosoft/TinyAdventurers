import Phaser from 'phaser';
import { ABILITIES, ANIM, CLASSES, CONST, EFFECT, ENEMY_KINDS, FLAG, HITBOX, KIND, SIDE, TILE_ID } from '../generated/defs';
import type { ClassId } from '../generated/ClassId';
import type { Ev } from '../generated/Ev';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Snapshot } from '../generated/Snapshot';
import type { Net } from '../net';
import { lineOfSight } from '../sim/collision';
import { shotHits } from '../sim/hitbox';
import { isTerrain, TILE, TileMap } from '../sim/map';
import type { Disabled, Hud } from '../ui/hud';
import { MARK_TTL, Marks, skimsTerrain, splashes } from './anim/entityAlpha';
import { FIGURES, PROJECTILES, heroWeapons, isAnimalKind, isBossKind, isHazardKind, isPlayerKind, isProjectileKind } from './anim/defs';
import { EntityView, type ViewState } from './anim/EntityView';
import { tileDraws } from './autotile';
import { BarrelView } from './barrel';
import { TorchView } from './torch';
import { ChestView } from './chest';
import { dmgColor } from './damage';
import { DEPTH, Effects, numberDepth } from './effects';
import { lookOf } from './looks';
import { drawGazeBeam, has } from './status';
import { LightField } from './light';
import { LightView, nextDarkvision } from './lightview';
import { Sunbeams } from './sunbeams';
import { CoveView } from './cove';
import { WoodlandView } from './woodland/WoodlandView';
import { GROUND_TILES } from './woodland/ground';
import { Mood, type AirTorch, type AirShot, type AirMover } from './mood';
import { MoverTracker } from './airmovers';
import { projectileAir } from './airshots';
import { VisionMask } from './visionmask';
import { DEFAULT_HAZE, syncUnseenFX } from './unseenfx';
import { ShadeMask } from './shademask';
import { DARKVISION_FX, syncDarkvisionFX } from './darkvisionfx';
import { ForceField } from './forcefield';
import { MimicView } from './mimic';
import { RulesLog } from '../rulesLog';
import { barName, showsBar } from './barName';
import { KeyCap } from './keycap';
import { pickUseHint } from './useHint';
import { meleeFoe, shotPassesThrough } from './shotTargets';
import { FONT_TEXT } from '../fonts';
import { critLabel, smoothText, TEXT_RESOLUTION, WORLD_TEXT } from './worldText';
import { bubbleFx, sinkDepth, sinkStartFx, TerrainLayer, WadeFx } from './terrain';
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
  img: Phaser.GameObjects.Image;
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

/**
 * How each hazard looks: glow tint, base radius (px, used when the server sends none), the glow's
 * squash, its strength, and its rising sparks (chance per frame, speed, colors).
 */
const HAZARD_LOOKS: Record<number, { tint: number; r: number; sx: number; sy: number; alpha: number; sparks: number; rise: number; colors: number[] }> = {
  [KIND.FirePatch]: { tint: 0xff5010, r: 10, sx: 1.75, sy: 0.98, alpha: 1, sparks: 0.5, rise: 25, colors: [0xff7020, 0xffd040] },
  [KIND.HolyGround]: { tint: 0xffd040, r: 40, sx: 1, sy: 0.7, alpha: 0.45, sparks: 0.15, rise: 15, colors: [0xffd040, 0xfff0a0] },
  [KIND.Roots]: { tint: 0x40a040, r: 36, sx: 1, sy: 0.7, alpha: 0.5, sparks: 0.2, rise: 10, colors: [0x60c050, 0x90e070] },
};

/** Kind id -> name, to look up `ENEMY_KINDS`. */
const KIND_NAME: Record<number, string> = Object.fromEntries(Object.entries(KIND).map(([name, id]) => [id, name]));
const ENEMY_KIND: Record<string, { max_hp: number; res: Record<string, number> } | undefined> = ENEMY_KINDS;

const SKELETAL = new Set<number>([KIND.SkeletonWarrior, KIND.SkeletonArcher, KIND.RaisedSkeleton, KIND.Lich]);

export class GameScene extends Phaser.Scene {
  private net!: Net;
  private hud!: Hud;
  private rulesLog!: RulesLog;
  private info!: RunStartInfo;
  private map!: TileMap;
  private mapRt!: Phaser.GameObjects.RenderTexture;
  private pred!: Predictor;
  private interp = new Interpolator();
  private ents = new Map<number, EntState>();
  private views = new Map<number, EntityView>();
  /** Entities that just reappeared from Invisible: their view fades in when it is created. */
  private reappearing = new Marks(MARK_TTL);
  /** Enemies that went invisible: a ghost is left where the view is last drawn, when it is culled. */
  private vanishing = new Marks(MARK_TTL);
  private projViews = new Map<number, Phaser.GameObjects.Image>();
  private hazardViews = new Map<number, Phaser.GameObjects.Image>();
  private mimicViews = new Map<number, MimicView>();
  private chestViews = new Map<number, ChestView>();
  private barrelViews = new Map<number, BarrelView>();
  private torchViews = new Map<number, TorchView>();
  private useHint!: KeyCap;
  private cosmetics: Cosmetic[] = [];
  /** Own shots whose cosmetic copy has ended (shot id -> time, s): their server copy stays hidden. */
  private endedShots = new Map<number, number>();
  /**
   * Own shots whose cosmetic copy was predicted to stop at an enemy (shot id -> the enemy's
   * position, the shot's direction and how far past the enemy's centre a shot has surely
   * passed it). If the server's shot is seen that far past, it is drawn.
   */
  private stoppedShots = new Map<number, { x: number; y: number; dx: number; dy: number; past: number }>();
  private fx!: Effects;
  private bars!: Phaser.GameObjects.Graphics;
  /** HP bars over heroes: under the darkness, so they vanish with their hero. */
  private heroBars!: Phaser.GameObjects.Graphics;
  /** The heroes' names by entity id (the wolf's label reads its leader's). Duplicates `RulesLog.names`: the boundary test forbids reaching into the log. */
  private heroNames = new Map<number, string>();
  /** The names over the bars of neutral and recruited monsters, by entity id. */
  private barLabels = new Map<number, Phaser.GameObjects.Text>();
  private beams!: Phaser.GameObjects.Graphics;
  /** The lich's stone gaze: a grey line from its eyes to the target hero. */
  private gaze!: Phaser.GameObjects.Graphics;
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
  private lightView!: LightView;
  private mood: Mood | null = null;
  private sunbeams!: Sunbeams;
  private cove: CoveView | null = null;
  private woodland: WoodlandView | null = null;
  private movers = new MoverTracker(); // replaced in init() for every run
  private airMovers: AirMover[] = [];
  private visionMask!: VisionMask;
  /** Kept for cleanup: `cameras.main` is already gone at shutdown. */
  private mainCamera!: Phaser.Cameras.Scene2D.Camera;
  private shadeMask!: ShadeMask;
  private unsub?: () => void;
  private frameMs = 0;
  private myKind = 0;
  private forceField?: ForceField;
  private terrain?: TerrainLayer;
  /** Splash and ripple state per figure. */
  private wade = new Map<number, WadeFx>();
  /** Heroes falling into a chasm or drowning (from `Ev::Sink`, or predicted for the own hero). */
  private sinks = new Map<number, { x: number; y: number; drown: boolean; t: number }>();
  // Debug mode (a debug run): immortal + path to the boss, drawn above the fog.
  private debugOn = false;
  private debugImmortal = true;
  private debugEffect = -1;
  private lastAim = 0;
  /** Which picks an Attribute drain disabled (from `HeroChanged`). */
  private disabled: Disabled = [null, null];
  private debugPath: [number, number][] = [];
  private debugOgre: [number, number][] = [];
  private debugCove: [number, number][] = [];
  /** Dodge notice circles (entity id, radius px) and the recent dodge lines (#220). */
  private debugNotice: [number, number][] = [];
  private debugDodges: { x0: number; y0: number; x1: number; y1: number; at: number }[] = [];
  private debugGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super('game');
  }

  init(data: GameInit): void {
    this.net = data.net;
    this.hud = data.hud;
    this.info = data.info;
    this.views = new Map();
    this.wade = new Map();
    this.sinks = new Map();
    this.projViews = new Map();
    this.hazardViews = new Map();
    this.mimicViews = new Map();
    this.chestViews = new Map();
    this.barrelViews = new Map();
    this.torchViews = new Map();
    this.cosmetics = [];
    this.movers = new MoverTracker();
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
    this.myKind = CLASSES[data.myClass].kind;
    this.pred = new Predictor(this.map, this.info.speed, this.info.abilities, this.info.fallback, this.info.spawn_x, this.info.spawn_y);
    this.light = new LightField(this.map);
    this.light.daylight = this.info.daylight;
    this.light.load(this.info.lights);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2b1a10');
    this.cameras.main.setRoundPixels(true);
    // the camera never shows past the map's edge (#259: the woodland's road runs on past its invisible walls, and
    // the cut must not show); every level's map is larger than the view
    this.cameras.main.setBounds(0, 0, this.map.w * TILE, this.map.h * TILE);
    this.fx = new Effects(this);
    this.drawBoard();
    this.lightView = new LightView(this, this.map, this.light);
    this.mood = this.info.daylight ? null : new Mood(this, this.map, this.lightView);
    this.sunbeams = new Sunbeams(this, this.light, this.lightView);
    this.cove = this.info.cove ? new CoveView(this, this.info.cove) : null;
    this.woodland = this.info.woodland ? new WoodlandView(this, this.info.woodland, this.map, { x: this.info.spawn_x, y: this.info.spawn_y }) : null;
    this.mainCamera = this.cameras.main;
    this.visionMask = new VisionMask(this, this.map);
    // daylight maps haze what lies beyond sight instead of blacking it out (#258, #278); dark maps stay black
    this.visionMask.haze = this.info.daylight;
    if (this.info.daylight) {
      this.visionMask.outside = DEFAULT_HAZE.outside;
      this.visionMask.soft = DEFAULT_HAZE.soft;
      this.visionMask.feather = DEFAULT_HAZE.feather;
      this.visionMask.ramp = DEFAULT_HAZE.ramp;
      if (this.woodland) this.visionMask.seen = this.woodland.seenPainter;
    } else this.visionMask.outside = 1;
    this.shadeMask = new ShadeMask(this, this.map);
    this.useHint = new KeyCap(this);
    this.bars = this.add.graphics().setDepth(DEPTH.enemyBars);
    this.heroBars = this.add.graphics().setDepth(DEPTH.heroBars);
    this.beams = this.add.graphics().setDepth(DEPTH.beam);
    this.gaze = this.add.graphics().setDepth(DEPTH.fx);
    this.debugGfx = this.add.graphics().setDepth(DEPTH.fog + 1);
    // A debug run (from a debug room): the server puts every hero in debug mode, so the badge and F4/F7/F8/F9 work from the first frame.
    this.debugOn = this.info.debug;
    this.debugImmortal = true;
    this.debugPath = [];
    this.debugOgre = [];
    this.debugCove = [];
    this.debugNotice = [];
    this.debugDodges = [];

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
      if (e.repeat || !this.debugOn || !this.alive) return;
      // The server announces the change to the party.
      this.net.send({ t: 'DebugDarkvision', ratio: nextDarkvision((this.lastSnap?.me.darkvision ?? 0) / 100) });
    });
    // Debug runs only (debug accounts): the nearest enemy within 8 tiles becomes incorporeal (and vanishes for 3 s).
    kb.on('keydown-F7', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat || !this.debugOn || !this.alive) return;
      // Shift+F7: your own hero's anti-magic on and off.
      this.net.send(e.shiftKey ? { t: 'DebugAntiMagic' } : { t: 'DebugIncorporeal' });
    });
    // Debug runs only (debug accounts): put the next effect on your own hero (Blind, Sleep, Petrified, Slowed, Accelerated).
    kb.on('keydown-F8', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat || !this.debugOn || !this.alive) return;
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
      if (e.repeat || !this.debugOn || !this.alive) return;
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
    this.hud.startRun(this.info);
    if (this.info.debug) this.hud.setDebug(true, true, true);
    for (const p of this.info.players) this.heroNames.set(p.ent, p.name);
    this.rulesLog = new RulesLog(this, this.net, this.info);
    this.hud.setToggles(this.rulesLog.settings());
  }

  private cleanup(): void {
    this.unsub?.();
    this.mood?.destroy();
    this.shadeMask.destroy();
    // the camera manager is already shut down here (`cameras.main` is gone): use the reference kept at creation
    syncUnseenFX(this.mainCamera, false, undefined, this.visionMask.rect, DEFAULT_HAZE);
    if (this.mainCamera.postPipelines.some((p) => p.name === DARKVISION_FX)) this.mainCamera.removePostPipeline(DARKVISION_FX);
    this.sunbeams.destroy();
    this.cove?.destroy();
    this.cove = null;
    this.woodland?.destroy();
    this.woodland = null;
    this.rulesLog.destroy();
    this.useHint.destroy();
    for (const t of this.barLabels.values()) t.destroy();
    this.barLabels.clear();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.reappearing.clear();
    this.vanishing.clear();
    for (const v of this.mimicViews.values()) v.destroy();
    this.mimicViews.clear();
    for (const v of this.chestViews.values()) v.destroy();
    this.chestViews.clear();
    for (const v of this.barrelViews.values()) v.destroy();
    this.barrelViews.clear();
    for (const v of this.torchViews.values()) v.destroy();
    this.torchViews.clear();
  }

  // ------------------------------------------------------------ board

  /** Slight per-tile brightness variation so the board does not look flat. */
  private tileTint(x: number, y: number): number {
    const v = ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000) / 1000;
    const shade = 0xea + Math.floor(v * 0x15);
    return (shade << 16) | (shade << 8) | shade;
  }

  private drawTile(x: number, y: number, batch: boolean): void {
    if (this.info.woodland && GROUND_TILES.has(this.map.get(x, y))) return; // the woodland paints its own ground
    for (const d of tileDraws(this.map, x, y)) {
      const tint = d.frame.startsWith('floor') ? this.tileTint(x, y) : 0xffffff;
      const py = y * TILE + (d.dy ?? 0);
      if (batch) this.mapRt.batchDrawFrame('atlas', d.frame, x * TILE, py, 1, tint);
      else this.mapRt.drawFrame('atlas', d.frame, x * TILE, py, 1, tint);
    }
  }

  private drawBoard(): void {
    const W = this.map.w * TILE;
    const H = this.map.h * TILE;
    // The board lies on a wooden table: a raised frame around the dungeon.
    const frame = this.add.graphics().setDepth(DEPTH.map - 1);
    frame.fillStyle(0x140c08, 0.6).fillRect(-10, -6, W + 28, H + 28);
    frame.fillStyle(0x5a3a22, 1).fillRect(-14, -14, W + 28, H + 28);
    frame.fillStyle(0x6e4a2c, 1).fillRect(-12, -12, W + 24, H + 24);
    frame.fillStyle(0x25131a, 1).fillRect(-2, -2, W + 4, H + 4);

    this.mapRt = this.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(DEPTH.map);
    this.mapRt.beginDraw();
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) this.drawTile(x, y, true);
    this.mapRt.endDraw();
    this.syncForceField(false);
    // Water, lava and chasms: animated surfaces over the floor.
    this.terrain = new TerrainLayer(this, this.map, this.fx);
    // Faint printed grid lines on the floor, like a game board.
    const grid = this.add.graphics().setDepth(DEPTH.map);
    grid.lineStyle(1, 0x000000, 0.12);
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        const t = this.map.get(x, y);
        if (t === TILE_ID.Wall || t === TILE_ID.Void || isTerrain(t) || (this.info.woodland && GROUND_TILES.has(t))) continue; // the entrance tiles are floor too
        grid.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE, TILE);
      }
  }

  /** Redraw a changed tile and its neighbours (corner pieces depend on them). */
  private redrawTile(x: number, y: number): void {
    for (let ty = y - 1; ty <= y + 1; ty++)
      for (let tx = x - 1; tx <= x + 1; tx++) {
        this.mapRt.fill(0x25131a, 1, tx * TILE, ty * TILE, TILE, TILE);
        this.drawTile(tx, ty, false);
      }
  }

  /** The force field over the sealed boss hall entrance (also for players who join or spectate later). */
  private syncForceField(appear: boolean): void {
    const sealed: [number, number][] = [];
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) if (this.map.get(x, y) === TILE_ID.DoorClosed) sealed.push([x, y]);
    const prev = this.forceField;
    prev?.destroy();
    this.forceField = sealed.length ? new ForceField(this, this.fx, sealed, appear && !prev) : undefined;
    if (prev && this.forceField) this.forceField.age = prev.age;
  }

  // ------------------------------------------------------------ network

  private onMessage(m: ServerMsg): void {
    if (m.t === "Snap") this.onSnapshot(m);
    else if (m.t === "DebugPath") {
      if (m.on !== this.debugOn || m.immortal !== this.debugImmortal) this.hud.setDebug(m.on, m.immortal, m.on !== this.debugOn);
      this.debugOn = m.on;
      this.debugImmortal = m.immortal;
      this.debugPath = m.points;
      this.debugOgre = m.ogre;
      this.debugCove = m.cove;
      this.debugNotice = m.notice;
    }
    else if (m.t === 'DebugDodge') {
      if (this.debugOn) this.debugDodges.push({ x0: m.from[0], y0: m.from[1], x1: m.to[0], y1: m.to[1], at: performance.now() / 1000 });
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
    this.rulesLog.onSnapshot(s);
  }

  private onEvent(ev: Ev): void {
    switch (ev.t) {
      case 'Dmg': {
        // Numbers on heroes and allies show over the darkness; numbers on enemies stay under it.
        const depth = numberDepth(ev.p);
        if (ev.imm) this.fx.text(ev.x, ev.y, 'immune', '#a0a0a0', { depth, kind: 'small' });
        else if (ev.crit) this.fx.text(ev.x, ev.y, critLabel(ev.v), WORLD_TEXT.crit.color, { big: true, depth });
        else this.fx.text(ev.x, ev.y, `${Math.round(ev.v)}`, dmgColor(ev.ty, ev.p), { depth });
        if (!ev.imm) this.fx.hitSpark(ev.x, ev.y + 4, ev.p ? 0xff4040 : 0xffffff);
        if (ev.p && !ev.imm && Math.hypot(ev.x - this.pred.state.x, ev.y + 10 - this.pred.state.y) < 4) this.cameras.main.shake(90, 0.003);
        break;
      }
      case 'Heal':
        this.fx.text(ev.x, ev.y, `+${Math.round(ev.v)}`, '#60ff80', { depth: numberDepth(ev.p) });
        break;
      case 'Boom':
        if (ev.k === 1) this.fx.healRing(ev.x, ev.y, ev.r);
        else if (ev.k === 2) {
          this.fx.ring(ev.x, ev.y, ev.r * 2, 0xff6020, 0.5, true);
          this.fx.burst(ev.x, ev.y, 20, 0xff8030, 80);
        } else if (ev.k === 3) this.fx.ring(ev.x, ev.y, ev.r, 0x6a2a8a, 0.4, true);
        else if (ev.k === 5) this.fx.shockwave(ev.x, ev.y, ev.r);
        else if (ev.k === 6) this.fx.nova(ev.x, ev.y, ev.r);
        else if (ev.k === 7) {
          this.fx.explosion(ev.x, ev.y, ev.r, 0xffa030);
          this.fx.burst(ev.x, ev.y, 18, 0x8a5a2a, 70);
          this.cameras.main.shake(120, 0.004);
        } else if (ev.k === 8) this.fx.splinters(ev.x, ev.y);
        else if (ev.k === 9) this.fx.natureSparkles(ev.x, ev.y, ev.r);
        else if (ev.k === 10) this.fx.nova(ev.x, ev.y, ev.r, 0x78c8ff);
        else if (ev.k === 11) {
          this.fx.ring(ev.x, ev.y, ev.r, 0xff6020, 0.5, true);
          if (Math.hypot(ev.x - this.pred.state.x, ev.y - this.pred.state.y) < CONST.PLAYER_RADIUS * 2) this.cameras.main.shake(100, 0.003);
        } else if (ev.k === 12) this.fx.ring(ev.x, ev.y, ev.r, 0xffe040, 0.5, true);
        else if (ev.k === 13) this.fx.healRing(ev.x, ev.y, ev.r, 0xfff0b0);
        // k 0: the hero Fireball's explosion (the dragon's is k 4).
        else this.fx.blast(ev.x, ev.y, ev.r);
        break;
      case 'Zap':
        this.fx.zap(ev.x, ev.y, ev.x2, ev.y2);
        break;
      case 'Died': {
        // Lost to a chasm or deep water: nothing is left behind.
        if (this.sinks.delete(ev.id)) break;
        if (ev.kind === KIND.Ghost) {
          // A Ghost leaves no skull: it comes apart.
          this.fx.disintegrate(ev.x, ev.y - 6);
        } else if (ev.kind === KIND.Shade) {
          // A Shade leaves no skull either: its body goes and the veil that wrapped it drifts apart.
          const rem = this.views.get(ev.id)?.veilRemains();
          this.fx.shadeDeath(ev.x, ev.y, rem?.veil ?? null, rem?.body);
        } else if (!isProjectileKind(ev.kind)) {
          // A skull token marks where a figure fell.
          this.add.image(ev.x, ev.y - 2, "atlas", "skull").setDepth(DEPTH.decal).setAlpha(0.85).setFlipX(Math.random() < 0.5);
          this.fx.burst(ev.x, ev.y - 6, 14, SKELETAL.has(ev.kind) ? 0xe8e4d0 : 0x9a2020, 50, 0.5, 60);
          if (isBossKind(ev.kind)) this.fx.explosion(ev.x, ev.y - 10, 50, 0xffe060);
        }
        break;
      }
      case 'Sink':
        if (ev.how === 2) this.sinks.delete(ev.id); // debug: back on safe ground
        else if (!this.sinks.has(ev.id)) this.startSink(ev.id, ev.x, ev.y, ev.how === 1);
        break;
      case 'Raise':
        this.fx.raise(ev.x, ev.y, ev.k);
        break;
      case 'Immune':
        this.fx.immune(ev.x, ev.y);
        break;
      case 'Tile':
        this.map.set(ev.x, ev.y, ev.v);
        this.redrawTile(ev.x, ev.y);
        this.light.mapChanged();
        this.lightView.mapChanged();
        this.mood?.mapChanged();
        this.visionMask.mapChanged();
        this.shadeMask.mapChanged(ev.y);
        if (ev.v === TILE_ID.DoorClosed) {
          // The entrance tiles arrive one event each; only announce the first.
          if (!this.forceField) this.hud.message('A force field seals the hall behind you!', 'game');
          this.syncForceField(true);
        }
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
      case 'Effect':
        // Drawn from the snapshot bitmask and its looks (status.ts). Invisible has a default fade:
        // the entity leaves the snapshot at once, so a ghost image fades out; on return it fades in.
        if (ev.kind === EFFECT.Invisible) {
          const t = performance.now() / 1000;
          if (ev.on) (this.vanishing.add(ev.id, t), this.reappearing.delete(ev.id));
          else (this.reappearing.add(ev.id, t), this.vanishing.delete(ev.id));
        }
        break;
      case 'Msg':
        this.hud.message(ev.text, 'game');
        break;
      case 'Coins':
        this.fx.coins(ev.x, ev.y, Math.min(10, 3 + Math.floor(ev.v / 4)));
        this.fx.text(ev.x, ev.y - 14, `+${ev.v} coins`, '#ffd040', { kind: 'small' });
        if (this.alive) this.hud.addCoins(ev.v);
        break;
    }
  }

  // ------------------------------------------------------------ input & prediction

  private aimInfo(): { aim: number; dist: number } {
    const p = this.input.activePointer;
    const wp = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
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
    const pd = PROJECTILES[kind];
    const { x, y } = this.pred.state;
    const img = this.projectileImage(pd);
    this.orientProjectile(img, pd, aim);
    this.cosmetics.push({
      shot,
      kind,
      img,
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
        // A wrongly predicted pass needs no spark of its own: the server's `Dmg` draws one at that enemy.
        if (hitWall) this.fx.hitSpark(c.x, c.y, PROJECTILES[c.kind].trail ?? 0xffffff);
        c.img.destroy();
        this.cosmetics.splice(i, 1);
        this.endedShots.set(c.shot, now);
        // Predicted to stop: if the server's shot flies on past this enemy after all, it is drawn
        // (`drawProjectile`).
        if (hitEnemy) {
          const v = Math.hypot(c.vx, c.vy) || 1;
          this.stoppedShots.set(c.shot, { x: touched.x, y: touched.y, dx: c.vx / v, dy: c.vy / v, past: (HITBOX[touched.kind]?.r ?? 6) + c.r });
        }
        continue;
      }
      c.x = nx;
      c.y = ny;
      const pd = PROJECTILES[c.kind];
      c.img.setPosition(Math.round(c.x), Math.round(c.y - 8));
      // The thrower only sees this copy: a spinning axe must keep turning.
      if (pd.spin) this.orientProjectile(c.img, pd, Math.atan2(c.vy, c.vx));
      if (pd.trail && Math.random() < 0.6) this.fx.particle(c.x, c.y - 8, 0, 0, 0.25, pd.trail, { depth: DEPTH.projectile - 1 });
    }
  }

  // ------------------------------------------------------------ frame

  update(_time: number, deltaMs: number): void {
    const t0 = performance.now();
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
    this.cameras.main.centerOn(Math.round(camX), Math.round(camY - 8));
    const darkvision = (this.lastSnap?.me.darkvision ?? 0) / 100;
    const vision = this.lastSnap?.me.vision ?? CONST.FOV_RADIUS;
    this.lightView.update(this.cameras.main.worldView, camX, camY, this.lastSnap?.lights ?? [], now, darkvision, vision);
    const torches: AirTorch[] = [];
    for (const e of this.ents.values()) if (e.kind === KIND.Torch) torches.push({ x: e.x, y: e.y, side: e.extra, lit: e.anim === 1 });
    const shots: AirShot[] = (this.lastSnap?.lights ?? []).map(([x, y, kind]) => ({ x, y, kind }));
    this.mood?.update(dt, this.cameras.main.worldView, torches, shots, this.collectMovers(dt, px, py));
    this.sunbeams.update(dt, this.cameras.main.worldView, now);
    const settled = !this.woodland || this.woodland.settled;
    if (this.info.daylight) this.visionMask.soft = settled ? DEFAULT_HAZE.soft : 0;
    this.visionMask.update(this.cameras.main.worldView, this.lightView.view, () => this.lightView.sight);
    // only the soft wedge waits for the scenery it belongs to (the woodland's trunks): over undrawn trees it would
    // haze bare ground. On daylight maps that is the haze's soft level (soft 0 = no haze behind blockers); the
    // pipeline itself stays on, since toggling it as `settled` flips would rebuild it and pop the beyond-sight haze.
    // On dark maps (the cove) the ShadeMask's black 0.3 waits instead.
    syncUnseenFX(this.cameras.main, this.info.daylight, this.visionMask.texture, this.visionMask.rect, DEFAULT_HAZE);
    this.shadeMask.on = !this.info.daylight && settled;
    this.shadeMask.update(this.cameras.main.worldView, this.lightView.view, () => this.lightView.sight);
    syncDarkvisionFX(this.cameras.main, darkvision, this.lightView.mask, [this.map.w * TILE, this.map.h * TILE]);

    const seen = new Set<number>();
    const myShots = new Set<number>();
    for (const e of this.ents.values()) {
      if (isProjectileKind(e.kind)) {
        // Only shots the client predicted: the AI's shots of a charmed hero (ids from 0xF000) are the server's.
        const shot = ownPredictedShot(e.extra, this.info.you);
        if (shot !== null) myShots.add(shot);
      }
    }
    for (const e of this.ents.values()) {
      seen.add(e.id);
      if (e.kind === KIND.Torch) this.drawTorch(e, now);
      else if (isHazardKind(e.kind)) this.drawHazard(e);
      else if (e.kind === KIND.Chest) this.drawChest(e);
      else if (e.kind === KIND.Barrel) this.drawBarrel(e);
      else if (e.kind === KIND.Mimic) this.drawMimic(e, dt, px, py);
      else if (isProjectileKind(e.kind)) this.drawProjectile(e);
      else this.drawFigure(e, dt, px, py, now);
    }
    // Own figure is always drawn from prediction.
    if (!seen.has(this.info.you) && this.alive) {
      seen.add(this.info.you);
      this.drawFigure({ id: this.info.you, kind: this.myKind, x: px, y: py, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: this.myEffects(), side: SIDE.Friendly, entangled: lookOf(this.lastSnap?.looks ?? [], this.info.you, EFFECT.Entangled) }, dt, px, py, now);
    }
    this.reappearing.prune(now);
    this.vanishing.prune(now);
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      if (this.vanishing.take(id, now)) v.ghost();
      v.destroy();
      this.views.delete(id);
      this.wade.delete(id);
    }
    for (const [id, v] of this.projViews) if (!seen.has(id)) (v.destroy(), this.projViews.delete(id));
    for (const [id, v] of this.hazardViews) if (!seen.has(id)) (v.destroy(), this.hazardViews.delete(id));
    for (const [id, v] of this.mimicViews) if (!seen.has(id)) (v.destroy(), this.mimicViews.delete(id));
    for (const [id, v] of this.chestViews) if (!seen.has(id)) (v.destroy(), this.chestViews.delete(id));
    for (const [id, v] of this.barrelViews) if (!seen.has(id)) (v.destroy(), this.barrelViews.delete(id));
    for (const [id, v] of this.torchViews) if (!seen.has(id)) (v.destroy(), this.torchViews.delete(id));
    // after the views moved this frame, so the copy is not a frame behind the hero
    // only the own hero, and only while it plays (not dead or spectating); teammates get no silhouette
    const ownLook = this.alive && this.spectating === null ? this.views.get(this.info.you)?.bodyLook() ?? null : null;
    this.cove?.update(now, ownLook);
    this.woodland?.update(now, ownLook, this.cameras.main.worldView, this.lightView.seenLit);

    const hint = this.alive && !this.pred.charmed && !this.pred.noAct && !this.pred.sinking ? pickUseHint(this.ents.values(), this.info.you, px, py) : null;
    this.hud.setAsleep(this.alive && has(this.myEffects(), EFFECT.Sleep));
    if (hint) this.useHint.set(hint.label, Math.round(hint.ent.x), Math.round(hint.ent.y - 26));
    else this.useHint.hide();

    this.updateCosmetics(dt, myShots, now);
    this.drawBarsAndBeams(now);
    this.rulesLog.draw(this.ents.values(), (id) => (this.views.get(id) ?? this.mimicViews.get(id) ?? this.chestViews.get(id) ?? this.barrelViews.get(id))?.height);
    this.drawGaze(px, py, now);
    this.drawDebugPath(px, py, now);
    this.forceField?.update(dt);
    this.terrain?.update(dt);
    this.fx.update(dt);

    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.hud.frame({
      fps: this.game.loop.actualFps,
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
      wolf: this.info.abilities[1].id === 'SummonWolf' ? [...this.ents.values()].some((e) => e.kind === KIND.DireWolf && e.extra === this.info.you && !(e.flags & FLAG.DEAD)) : null,
    });
  }

  private drawFigure(e: EntState, dt: number, px: number, py: number, now: number): void {
    const me = e.id === this.info.you;
    let view = this.views.get(e.id);
    if (!view) {
      const pi = isPlayerKind(e.kind) ? this.info.players.find((p) => p.ent === e.id) : undefined;
      const weapons = pi ? heroWeapons(FIGURES[e.kind], pi.melee, pi.ranged) : undefined;
      view = new EntityView(this, e.kind, this.fx, me ? undefined : pi?.name, weapons);
      this.views.set(e.id, view);
    }
    // Reappearing in the ambush wind-up: the flicker is the entrance, the default fade-in would blur it.
    if (this.reappearing.take(e.id, now) && !isPlayerKind(e.kind) && e.anim !== ANIM.Ambush) view.fadeIn();
    let s: ViewState;
    // The own figure is drawn from prediction, except while charmed: then it is the server's, interpolated hero.
    const predicted = me && this.alive && !this.pred.charmed;
    if (predicted) {
      // Petrified or asleep: the weapon keeps the facing from before the effect.
      const aim = this.pred.noTurn ? this.lastAim : this.aimInfo().aim;
      const tLocal = now - this.localAnim.start;
      let anim = this.localAnim.anim;
      const actionOver = anim === ANIM.Dash ? this.pred.state.dashT <= 0 : tLocal > 0.25;
      if (actionOver) {
        const moving = this.pred.speedMul > 0 && (this.keys.W.isDown || this.keys.A.isDown || this.keys.S.isDown || this.keys.D.isDown);
        anim = moving ? ANIM.Move : ANIM.Idle;
      }
      const flags = this.myFlags;
      // Effects from the own snapshot (exact, not the interpolated entity), so they show at once.
      s = { x: px, y: py, anim, animT: tLocal, aim, flags, effects: this.myEffects(), entangled: e.entangled, party: isPlayerKind(e.kind), swingArc: anim === ANIM.Melee ? this.localAnim.arc : undefined };
    } else {
      s = { id: e.id, x: e.x, y: e.y, anim: e.anim, animT: e.animMs / 1000, aim: e.aim, flags: e.flags, effects: e.effects, entangled: e.entangled, party: isPlayerKind(e.kind) };
    }
    this.terrainState(e, s, predicted, dt);
    view.update(s, dt);
    // Dragon breath: a cone of fire particles from the mouth.
    void py;
  }

  /** Wading, splashes and embers, or the fall / drowning of a hero lost to the terrain. */
  private terrainState(e: EntState, s: ViewState, predicted: boolean, dt: number): void {
    const tile = this.map.tileAt(s.x, s.y);
    if (predicted && this.pred.sinking && !this.sinks.has(e.id)) this.startSink(e.id, s.x, s.y, tile === TILE_ID.DeepWater);
    const sk = this.sinks.get(e.id);
    if (sk) {
      const k = Math.min(1, (performance.now() / 1000 - sk.t) / (sk.drown ? CONST.DROWN_TIME : CONST.FALL_TIME));
      Object.assign(s, { x: sk.x, y: sk.y, anim: ANIM.Idle, animT: 0, fall: sk.drown ? 0 : k, drown: sk.drown ? k : 0 });
      if (sk.drown) bubbleFx(this.fx, sk.x, sk.y, dt);
      return;
    }
    const dashing = skimsTerrain(e.flags, predicted ? this.pred.state.dashT > 0 : e.anim === ANIM.Dash);
    s.sink = dashing ? 0 : sinkDepth(tile);
    if (!splashes(e.flags)) return; // incorporeal: no wading, splash, spray or embers
    let wade = this.wade.get(e.id);
    if (!wade) this.wade.set(e.id, (wade = new WadeFx()));
    // Only heroes burn: demons walk lava unharmed, other enemies never enter it.
    wade.update(this.fx, s.x, s.y, tile, dashing, s.anim === ANIM.Move, isPlayerKind(e.kind), dt);
  }

  private startSink(id: number, x: number, y: number, drown: boolean): void {
    this.sinks.set(id, { x, y, drown, t: performance.now() / 1000 });
    sinkStartFx(this.fx, x, y, drown);
  }

  private drawMimic(e: EntState, dt: number, px: number, py: number): void {
    let view = this.mimicViews.get(e.id);
    if (!view) {
      view = new MimicView(this, this.fx);
      this.mimicViews.set(e.id, view);
    }
    view.sync({ x: e.x, y: e.y, anim: e.anim, animT: e.animMs / 1000, aim: e.aim, flags: e.flags }, dt, this.alive ? Math.hypot(e.x - px, e.y - py) : Infinity);
  }

  private drawChest(e: EntState): void {
    let view = this.chestViews.get(e.id);
    if (!view) {
      view = new ChestView(this);
      this.chestViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim === 1 ? e.animMs / 1000 : -1);
  }

  private drawBarrel(e: EntState): void {
    let view = this.barrelViews.get(e.id);
    if (!view) {
      view = new BarrelView(this);
      this.barrelViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim, e.animMs);
  }

  private drawTorch(e: EntState, now: number): void {
    let view = this.torchViews.get(e.id);
    if (!view) {
      view = new TorchView(this);
      this.torchViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim === 1, e.extra, now);
  }

  private drawProjectile(e: EntState): void {
    const shot = e.extra & 0xffff;
    const ownShot = ownPredictedShot(e.extra, this.info.you) !== null;
    // Our own projectiles are shown by the local cosmetic copy, also once it has ended.
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
    const mine = ownShot && (this.endedShots.has(shot) || this.cosmetics.some((c) => c.shot === shot));
    const pd = PROJECTILES[e.kind];
    if (!pd) return;
    let img = this.projViews.get(e.id);
    if (!img) {
      img = this.projectileImage(pd);
      this.projViews.set(e.id, img);
    }
    img.setVisible(!mine).setPosition(Math.round(e.x), Math.round(e.y - 8));
    this.orientProjectile(img, pd, e.aim);
    if (!mine && pd.gloom) this.fx.gloomWisp(e.x, e.y - 8);
    else if (!mine && pd.trail && Math.random() < 0.5) this.fx.particle(e.x, e.y - 8, 0, 0, 0.25, pd.trail, { depth: DEPTH.projectile - 1 });
  }

  /** Debug: marching dashed lines along the server's shortest paths to the boss (yellow), the ogre (blue) and the cove (green). */
  private drawDebugPath(px: number, py: number, now: number): void {
    const g = this.debugGfx.clear();
    if (!this.debugOn || !this.alive) {
      this.debugDodges.length = 0;
      return;
    }
    // Dodge notice circles at the creatures' drawn positions, and the dodge lines, fading over 0.6 s.
    g.lineStyle(1, 0xffffff, 0.3);
    for (const [id, r] of this.debugNotice) {
      const e = this.ents.get(id);
      if (e && !(e.flags & FLAG.DEAD)) g.strokeCircle(e.x, e.y, r);
    }
    const t = performance.now() / 1000;
    if (this.debugDodges.length) this.debugDodges = this.debugDodges.filter((d) => t - d.at < 0.6);
    for (const d of this.debugDodges) {
      g.lineStyle(2, 0xff40ff, 1 - (t - d.at) / 0.6);
      g.lineBetween(d.x0, d.y0, d.x1, d.y1);
    }
    this.drawPathLine(g, px, py, now, this.debugCove, 0x40e070, 0x20a050);
    this.drawPathLine(g, px, py, now, this.debugOgre, 0x40a0ff, 0x4060ff);
    this.drawPathLine(g, px, py, now, this.debugPath, 0xffe040, 0xff4040);
  }

  private drawPathLine(g: Phaser.GameObjects.Graphics, px: number, py: number, now: number, path: [number, number][], color: number, end: number): void {
    if (path.length < 2) return;
    // Start at the predicted position (the server's first point is slightly old).
    const pts: [number, number][] = [[px, py], ...path.slice(1)];
    const DASH = 6;
    const GAP = 4;
    let phase = (now * 40) % (DASH + GAP);
    g.lineStyle(2, 0x000000, 0.5);
    g.strokePoints(pts.map(([x, y]) => ({ x, y: y + 1 })), false);
    g.lineStyle(2, color, 0.95);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.01) continue;
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      // Dashes march toward the boss.
      for (let d = -phase; d < len; d += DASH + GAP) {
        const a = Math.max(d, 0);
        const b = Math.min(d + DASH, len);
        if (b > a) g.lineBetween(x0 + ux * a, y0 + uy * a, x0 + ux * b, y0 + uy * b);
      }
      phase = (phase + len) % (DASH + GAP);
    }
    const [ex, ey] = pts[pts.length - 1];
    g.fillStyle(end, 0.6 + 0.4 * Math.sin(now * 8)).fillCircle(ex, ey, 4);
    g.lineStyle(1, color, 1).strokeCircle(ex, ey, 7);
  }

  /** Pack sprite (arrows) or a runtime glow for magic projectiles. */
  private projectileImage(pd: (typeof PROJECTILES)[number]): Phaser.GameObjects.Image {
    const img = pd.frame ? this.add.image(0, 0, 'atlas', pd.frame) : this.add.image(0, 0, 'glow').setTint(pd.glow ?? 0xffffff).setBlendMode(Phaser.BlendModes.ADD);
    return img.setScale(pd.scale).setDepth(DEPTH.projectile);
  }

  private orientProjectile(img: Phaser.GameObjects.Image, pd: (typeof PROJECTILES)[number], aim: number): void {
    // Pack arrows point up; glows are round but pulse a little.
    if (pd.spin) img.setRotation((performance.now() / 1000) * 14);
    else if (pd.frame) img.setRotation(aim + Math.PI / 2);
    // Gloom shimmers: an unsteady flicker instead of a smooth pulse.
    else if (pd.gloom) img.setScale(pd.scale * (0.8 + Math.random() * 0.35)).setAlpha(0.7 + Math.random() * 0.3);
    else img.setScale(pd.scale * (0.9 + 0.15 * Math.sin(performance.now() / 50)));
  }

  /**
   * Ground hazards: burning ground from dragon breath, a hero's Consecrate (gold) or Entangle
   * (roots). A glow of the hazard's radius (the server sends it in the aim field) with rising sparks.
   */
  private drawHazard(e: EntState): void {
    const look = HAZARD_LOOKS[e.kind];
    let img = this.hazardViews.get(e.id);
    if (!img) {
      img = this.add.image(0, 0, 'glow').setTint(look.tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.hazard);
      this.hazardViews.set(e.id, img);
    }
    const r = e.aim > 0 ? e.aim : look.r;
    // The glow texture is 14 px wide: scaled to the hazard's diameter, then squashed into an ellipse (the fire patch keeps its old, wider look).
    img.setScale(((r * 2) / 14) * look.sx, ((r * 2) / 14) * look.sy);
    img.setPosition(Math.round(e.x), Math.round(e.y)).setAlpha(Math.min(1, e.extra / 500) * (0.7 + 0.3 * Math.sin(performance.now() / 70 + e.id)) * look.alpha);
    if (Math.random() < look.sparks) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      this.fx.particle(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.6, 0, -look.rise - Math.random() * 20, 0.5, look.colors[Math.floor(Math.random() * look.colors.length)], {
        depth: DEPTH.entityBase + e.y,
      });
    }
  }

  /** The own hero's effects as a bitmask, from the own snapshot. */
  private myEffects(): number {
    let bits = 0;
    for (const [k] of this.lastSnap?.me.effects ?? []) bits |= 1 << k;
    return bits;
  }

  /**
   * The lich's stone gaze: while it stares (`ANIM.Gaze`), a thin grey line
   * from its eyes to the hero it petrifies (entity id in `extra`), when in view.
   */
  private drawGaze(px: number, py: number, now: number): void {
    const g = this.gaze.clear();
    for (const e of this.ents.values()) {
      if (e.anim !== ANIM.Gaze || e.flags & FLAG.DEAD) continue;
      const me = e.extra === this.info.you && this.alive;
      const t = me ? null : this.ents.get(e.extra);
      if (!me && !t) continue;
      const tx = me ? px : t!.x;
      const ty = me ? py : t!.y;
      drawGazeBeam(g, e.x, e.y, tx, ty, now);
    }
  }

  /** What moves through the air this frame: figures, the own hero (from prediction), others' shots and the own cosmetic shots, each once. */
  private collectMovers(dt: number, px: number, py: number): AirMover[] {
    const out = this.airMovers;
    out.length = 0;
    const tr = this.movers;
    tr.begin(dt);
    const add = (m: AirMover | null) => {
      if (m) out.push(m);
    };
    // Projectiles are drawn 8 px above their ground position; their air follows the drawing.
    const shotMover = (m: AirMover | null): AirMover | null => {
      if (m) m.airY = m.y - 8;
      return m;
    };
    for (const e of this.ents.values()) {
      if (e.id === this.info.you || e.flags & FLAG.DEAD) continue;
      if (isProjectileKind(e.kind)) {
        if (ownPredictedShot(e.extra, this.info.you) !== null) continue; // own shots come from this.cosmetics
        const a = projectileAir(e.kind);
        add(shotMover(tr.track(e.id, e.x, e.y, a.r, true, a.heat)));
      } else if (e.kind === KIND.Torch || isHazardKind(e.kind) || e.kind === KIND.Chest || e.kind === KIND.Barrel) {
        continue;
      } else {
        add(tr.track(e.id, e.x, e.y, FIGURES[e.kind]?.baseR ?? 6, false, 0));
      }
    }
    if (this.alive) add(tr.track(-1, px, py, FIGURES[this.myKind]?.baseR ?? 6, false, 0));
    for (const c of this.cosmetics) {
      const a = projectileAir(c.kind);
      add(shotMover(tr.track(-(100000 + c.shot), c.x, c.y, a.r, true, a.heat)));
    }
    return out;
  }

  private drawBarsAndBeams(now: number): void {
    this.bars.clear();
    this.heroBars.clear();
    const labelled = new Set<number>();
    for (const e of this.ents.values()) {
      if (isProjectileKind(e.kind) || isHazardKind(e.kind) || e.kind === KIND.Chest || e.kind === KIND.Barrel || isBossKind(e.kind) || e.flags & FLAG.DEAD) continue;
      // Neutral and Friendly creatures (the recruited knight, the wolf) always show their bar and name; the ogre (mini-boss)
      // always shows a wide bar; others only once hurt.
      const ogre = e.kind === KIND.Ogre;
      const named = e.side !== SIDE.Hostile && !isPlayerKind(e.kind) && !isAnimalKind(e.kind);
      if (!showsBar(e)) continue;
      const v = this.views.get(e.id) ?? this.mimicViews.get(e.id);
      if (!v) continue;
      const w = ogre ? 28 : 12;
      const x = Math.round(e.x - w / 2);
      const y = Math.round(e.y - v.height - 3);
      // A hero is green unless it is on the enemy side (charmed): then it gets the enemy's red bar, like a charmed monster.
      const hero = (isPlayerKind(e.kind) && e.side !== SIDE.Hostile) || e.side === SIDE.Friendly;
      const g = hero ? this.heroBars : this.bars;
      g.fillStyle(0x140c1a, 1).fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle(hero ? 0x40d060 : e.side === SIDE.Neutral ? 0x8a9ab8 : 0xd03030, 1).fillRect(x, y, Math.max(1, Math.round(w * e.hp)), 2);
      const name = named ? barName(e, this.heroNames) : undefined;
      if (name) {
        let t = this.barLabels.get(e.id);
        if (!t) {
          t = smoothText(this.add.text(0, 0, name, { fontFamily: FONT_TEXT, fontStyle: WORLD_TEXT.tag.style, fontSize: `${WORLD_TEXT.tag.size}px`, resolution: TEXT_RESOLUTION }).setOrigin(0.5, 1));
          this.barLabels.set(e.id, t);
        }
        t.setColor(hero ? '#7fe08a' : '#b8c4d8').setDepth(hero ? DEPTH.heroBars : DEPTH.enemyBars).setPosition(Math.round(e.x), y - 2);
        labelled.add(e.id);
      }
    }
    for (const [id, t] of this.barLabels) if (!labelled.has(id)) (t.destroy(), this.barLabels.delete(id));
    // Lich draining its disciples: red shimmering energy flowing to the lich.
    // The server sends both ends even when they are out of view (`drain`), and
    // the beams are drawn above the fog; a lich in view uses its smooth position.
    const b = this.beams;
    b.clear();
    const drain = this.lastSnap?.drain;
    if (!drain) return;
    let lich: EntState | undefined;
    for (const e of this.ents.values()) if (e.kind === KIND.Lich) lich = e;
    const [lx, ly] = lich ? [lich.x, lich.y] : drain[0];
    for (let d = 1; d < drain.length; d++) {
      const [dx, dy] = drain[d];
      const e = { id: d * 7919 };
      const sx = dx, sy = dy - 10, tx = lx, ty = ly - 12;
      const nx = -(ty - sy), ny = tx - sx;
      const nl = Math.hypot(nx, ny) || 1;
      b.lineStyle(1, 0xff2030, 0.25 + 0.15 * Math.sin(now * 20 + e.id));
      b.beginPath();
      for (let i = 0; i <= 12; i++) {
        const k = i / 12;
        const wave = Math.sin(k * 10 - now * 8 + e.id) * 2;
        const x = sx + (tx - sx) * k + (nx / nl) * wave;
        const y = sy + (ty - sy) * k + (ny / nl) * wave;
        if (i === 0) b.moveTo(x, y);
        else b.lineTo(x, y);
      }
      b.strokePath();
      for (let i = 0; i < 4; i++) {
        const k = (now * 0.8 + i / 4 + e.id * 0.13) % 1;
        const wave = Math.sin(k * 10 - now * 8 + e.id) * 2;
        const x = sx + (tx - sx) * k + (nx / nl) * wave;
        const y = sy + (ty - sy) * k + (ny / nl) * wave;
        b.fillStyle(i % 2 ? 0xff4050 : 0xffa0a0, 0.9).fillRect(Math.round(x), Math.round(y), 2, 2);
      }
    }
  }
}
