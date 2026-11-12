// The 2D view of a run: every Phaser game object of the game scene lives here, behind the RunView interface
// (run/view.ts). The run session (run/session.ts) holds the logic and hands this view a RunFrame each frame, the events
// that have a picture, tile changes and ended shots. Picture-only state (entity views, wading and sinking,
// vanish and reappear marks, skull decals, bar labels, the force field's age) stays here.
import Phaser from 'phaser';
import { ANIM, CONST, FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
import type { Net } from '../net';
import { RulesLog } from '../rulesLog';
import { SHOT_LIFT_PX, settleOwnAim } from '../run/aim';
import type { PictureEv, RunFrame, RunView, RunViewInit, ShotView, ViewStats } from '../run/view';
import { isTerrain, TILE, TileMap } from '../sim/map';
import { skimsTerrain, splashes } from './anim/entityAlpha';
import { FigureStates } from './anim/figureState';
import { PROJECTILES, FIGURES, heroWeapons, isAnimalKind, isBossKind, isHazardKind, isPlayerKind, isProjectileKind } from './anim/defs';
import { EntityView, type ViewState } from './anim/EntityView';
import { MoverTracker } from './airmovers';
import { projectileAir } from './airshots';
import { tileDraws } from './autotile';
import { barName, showsBar } from './barName';
import { BarrelView } from './barrel';
import { ChestView } from './chest';
import { onContextRestored } from './contextrestore';
import { dmgColor } from './damage';
import { DARKVISION_FX, syncDarkvisionFX } from './darkvisionfx';
import { DEPTH, Effects, numberDepth } from './effects';
import { ForceField } from './forcefield';
import { FrameTimer, SYSTEMS } from './frameTimer';
import { KeyCap } from './keycap';
import { LightView } from './lightview';
import { MimicView } from './mimic';
import { Mood, type AirMover, type AirShot, type AirTorch } from './mood';
import { ShadeMask } from './shademask';
import { drawGazeBeam } from './status';
import { Sunbeams } from './sunbeams';
import { bubbleFx, sinkStartFx, TerrainLayer, WadeFx } from './terrain';
import { CoveView } from './cove';
import { TorchView } from './torch';
import { DEFAULT_HAZE, syncUnseenFX } from './unseenfx';
import { VisionMask } from './visionmask';
import { WoodlandView } from './woodland/WoodlandView';
import { GROUND_TILES } from './woodland/ground';
import { FONT_TEXT } from '../fonts';
import { critLabel, smoothText, TEXT_RESOLUTION, WORLD_TEXT } from './worldText';
import { ownPredictedShot, type EntState } from './world';

/**
 * How each hazard looks: glow tint, base radius (px, used when the server sends none), the glow's
 * squash, its strength, and its rising sparks (chance per frame, speed, colors).
 */
const HAZARD_LOOKS: Record<number, { tint: number; r: number; sx: number; sy: number; alpha: number; sparks: number; rise: number; colors: number[] }> = {
  [KIND.FirePatch]: { tint: 0xff5010, r: 10, sx: 1.75, sy: 0.98, alpha: 1, sparks: 0.5, rise: 25, colors: [0xff7020, 0xffd040] },
  [KIND.HolyGround]: { tint: 0xffd040, r: 40, sx: 1, sy: 0.7, alpha: 0.45, sparks: 0.15, rise: 15, colors: [0xffd040, 0xfff0a0] },
  [KIND.Roots]: { tint: 0x40a040, r: 36, sx: 1, sy: 0.7, alpha: 0.5, sparks: 0.2, rise: 10, colors: [0x60c050, 0x90e070] },
};

const SKELETAL = new Set<number>([KIND.SkeletonWarrior, KIND.SkeletonArcher, KIND.RaisedSkeleton, KIND.Lich]);

export class PhaserRunView implements RunView {
  readonly rulesLog: RulesLog;
  private readonly info: RunViewInit['info'];
  private readonly map: TileMap;
  private readonly myKind: number;
  private readonly timer: FrameTimer;
  private mapRt!: Phaser.GameObjects.RenderTexture;
  private views = new Map<number, EntityView>();
  /** Sink, vanish and reappear bookkeeping, shared with the 3D view. */
  private readonly figures: FigureStates;
  private projViews = new Map<number, Phaser.GameObjects.Image>();
  private hazardViews = new Map<number, Phaser.GameObjects.Image>();
  private mimicViews = new Map<number, MimicView>();
  private chestViews = new Map<number, ChestView>();
  private barrelViews = new Map<number, BarrelView>();
  private torchViews = new Map<number, TorchView>();
  /** The own predicted shots' images by shot id (the session's cosmetic copies). */
  private shotImgs = new Map<number, Phaser.GameObjects.Image>();
  private useHint: KeyCap;
  private fx: Effects;
  private bars: Phaser.GameObjects.Graphics;
  /** HP bars over heroes: under the darkness, so they vanish with their hero. */
  private heroBars: Phaser.GameObjects.Graphics;
  /** The heroes' names by entity id (the wolf's label reads its leader's). Duplicates `RulesLog.names`: the boundary test forbids reaching into the log. */
  private heroNames = new Map<number, string>();
  /** The names over the bars of neutral and recruited monsters, by entity id. */
  private barLabels = new Map<number, Phaser.GameObjects.Text>();
  private beams: Phaser.GameObjects.Graphics;
  /** The lich's stone gaze: a grey line from its eyes to the target hero. */
  private gaze: Phaser.GameObjects.Graphics;
  private lightView: LightView;
  private mood: Mood | null;
  private sunbeams: Sunbeams;
  private cove: CoveView | null;
  private woodland: WoodlandView | null;
  private movers = new MoverTracker();
  private airMovers: AirMover[] = [];
  private visionMask: VisionMask;
  /** Kept for cleanup: `cameras.main` is already gone at shutdown. */
  private mainCamera: Phaser.Cameras.Scene2D.Camera;
  private shadeMask: ShadeMask;
  private forceField?: ForceField;
  private terrain?: TerrainLayer;
  /** Splash and ripple state per figure. */
  private wade = new Map<number, WadeFx>();
  private debugGfx: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    init: RunViewInit,
    deps: { net: Net; timer: FrameTimer },
  ) {
    this.info = init.info;
    this.map = init.map;
    this.figures = new FigureStates(init.map);
    this.myKind = init.myKind;
    this.timer = deps.timer;
    scene.cameras.main.setBackgroundColor('#2b1a10');
    scene.cameras.main.setRoundPixels(true);
    // the camera never shows past the map's edge (#259: the woodland's road runs on past its invisible walls, and
    // the cut must not show); every level's map is larger than the view
    scene.cameras.main.setBounds(0, 0, this.map.w * TILE, this.map.h * TILE);
    this.fx = new Effects(scene);
    this.drawBoard();
    this.lightView = new LightView(scene, this.map, init.light);
    this.mood = this.info.daylight ? null : new Mood(scene, this.map, this.lightView);
    this.sunbeams = new Sunbeams(scene, init.light, this.lightView);
    this.cove = this.info.cove ? new CoveView(scene, this.info.cove) : null;
    this.woodland = this.info.woodland ? new WoodlandView(scene, this.info.woodland, this.map, { x: this.info.spawn_x, y: this.info.spawn_y }) : null;
    this.mainCamera = scene.cameras.main;
    this.visionMask = new VisionMask(scene, this.map);
    // daylight maps haze what lies beyond sight instead of blacking it out (#258, #278); dark maps stay black
    this.visionMask.haze = this.info.daylight;
    if (this.info.daylight) {
      this.visionMask.outside = DEFAULT_HAZE.outside;
      this.visionMask.soft = DEFAULT_HAZE.soft;
      this.visionMask.feather = DEFAULT_HAZE.feather;
      this.visionMask.ramp = DEFAULT_HAZE.ramp;
      if (this.woodland) this.visionMask.seen = this.woodland.seenPainter;
    } else this.visionMask.outside = 1;
    this.shadeMask = new ShadeMask(scene, this.map);
    this.useHint = new KeyCap(scene);
    this.bars = scene.add.graphics().setDepth(DEPTH.enemyBars);
    this.heroBars = scene.add.graphics().setDepth(DEPTH.heroBars);
    this.beams = scene.add.graphics().setDepth(DEPTH.beam);
    this.gaze = scene.add.graphics().setDepth(DEPTH.fx);
    this.debugGfx = scene.add.graphics().setDepth(DEPTH.fog + 1);
    for (const p of this.info.players) this.heroNames.set(p.ent, p.name);
    this.rulesLog = new RulesLog(scene, deps.net, this.info);
  }

  destroy(): void {
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
    this.figures.clear();
    for (const v of this.mimicViews.values()) v.destroy();
    this.mimicViews.clear();
    for (const v of this.chestViews.values()) v.destroy();
    this.chestViews.clear();
    for (const v of this.barrelViews.values()) v.destroy();
    this.barrelViews.clear();
    for (const v of this.torchViews.values()) v.destroy();
    this.torchViews.clear();
  }

  pointerWorld(): { x: number; y: number } | null {
    const wp = this.scene.input.activePointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    return { x: wp.x, y: wp.y + SHOT_LIFT_PX };
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
    const frame = this.scene.add.graphics().setDepth(DEPTH.map - 1);
    frame.fillStyle(0x140c08, 0.6).fillRect(-10, -6, W + 28, H + 28);
    frame.fillStyle(0x5a3a22, 1).fillRect(-14, -14, W + 28, H + 28);
    frame.fillStyle(0x6e4a2c, 1).fillRect(-12, -12, W + 24, H + 24);
    frame.fillStyle(0x25131a, 1).fillRect(-2, -2, W + 4, H + 4);

    this.mapRt = this.scene.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(DEPTH.map);
    this.paintBoard();
    // A restored WebGL context recreates the map texture empty: paint it again from the current map (#298).
    onContextRestored(this.scene, () => {
      this.mapRt.clear();
      this.paintBoard();
    });
    this.syncForceField(false);
    // Water, lava and chasms: animated surfaces over the floor.
    this.terrain = new TerrainLayer(this.scene, this.map, this.fx);
  }

  /** Draws every tile of the current map into the map texture, then the grid lines. */
  private paintBoard(): void {
    this.mapRt.beginDraw();
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) this.drawTile(x, y, true);
    this.mapRt.endDraw();
    // Faint printed grid lines on the floor, like a game board: drawn into the map texture once
    // (a live Graphics with one stroke per floor tile cost ~9 ms of render per frame, #289).
    const grid = this.gridLines(0, 0, this.map.w - 1, this.map.h - 1);
    this.mapRt.draw(grid);
    grid.destroy();
  }

  /** The grid lines of the floor tiles in [x0, x1] × [y0, y1], in world coordinates (not on the display list).
   *  Each tile's 1 px outline also covers the first pixel column and row of its right and lower neighbours. */
  private gridLines(x0: number, y0: number, x1: number, y1: number): Phaser.GameObjects.Graphics {
    const grid = this.scene.make.graphics({}, false);
    grid.lineStyle(1, 0x000000, 0.12);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const t = this.map.get(x, y);
        if (t === TILE_ID.Wall || t === TILE_ID.Void || isTerrain(t) || (this.info.woodland && GROUND_TILES.has(t))) continue; // the entrance tiles are floor too
        grid.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE, TILE);
      }
    return grid;
  }

  /** Redraw a changed tile and its neighbours (corner pieces depend on them), grid lines included. */
  private redrawTile(x: number, y: number): void {
    for (let ty = y - 1; ty <= y + 1; ty++)
      for (let tx = x - 1; tx <= x + 1; tx++) {
        this.mapRt.fill(0x25131a, 1, tx * TILE, ty * TILE, TILE, TILE);
        this.drawTile(tx, ty, false);
      }
    // The grid of the 3×3 area: the outlines of its tiles and the edges that spill in from the tiles above and to
    // the left. They are drawn into a texture the size of the area, which clips them to it, so the lines just
    // outside the area are not drawn twice.
    const ox = (x - 1) * TILE;
    const oy = (y - 1) * TILE;
    const grid = this.gridLines(x - 2, y - 2, x + 1, y + 1);
    const clip = this.scene.make.renderTexture({ width: 3 * TILE, height: 3 * TILE }, false).setOrigin(0, 0);
    clip.draw(grid, -ox, -oy);
    this.mapRt.draw(clip, ox, oy);
    clip.destroy();
    grid.destroy();
  }

  /** The force field over the sealed boss hall entrance (also for players who join or spectate later). */
  private syncForceField(appear: boolean): void {
    const sealed: [number, number][] = [];
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) if (this.map.get(x, y) === TILE_ID.DoorClosed) sealed.push([x, y]);
    const prev = this.forceField;
    prev?.destroy();
    this.forceField = sealed.length ? new ForceField(this.scene, this.fx, sealed, appear && !prev) : undefined;
    if (prev && this.forceField) this.forceField.age = prev.age;
  }

  /** The session has already updated the map and the LightField. */
  tileChanged(x: number, y: number, v: number): void {
    this.redrawTile(x, y);
    this.lightView.mapChanged();
    this.mood?.mapChanged();
    this.visionMask.mapChanged();
    this.shadeMask.mapChanged(y);
    // The entrance tiles arrive one event each.
    if (v === TILE_ID.DoorClosed) this.syncForceField(true);
  }

  // ------------------------------------------------------------ events

  event(ev: PictureEv, own: { x: number; y: number }): void {
    switch (ev.t) {
      case 'Dmg': {
        // Numbers on heroes and allies show over the darkness; numbers on enemies stay under it.
        const depth = numberDepth(ev.p);
        if (ev.imm) this.fx.text(ev.x, ev.y, 'immune', '#a0a0a0', { depth, kind: 'small' });
        else if (ev.crit) this.fx.text(ev.x, ev.y, critLabel(ev.v), WORLD_TEXT.crit.color, { big: true, depth });
        else this.fx.text(ev.x, ev.y, `${Math.round(ev.v)}`, dmgColor(ev.ty, ev.p), { depth });
        if (!ev.imm) this.fx.hitSpark(ev.x, ev.y + 4, ev.p ? 0xff4040 : 0xffffff);
        if (ev.p && !ev.imm && Math.hypot(ev.x - own.x, ev.y + 10 - own.y) < 4) this.scene.cameras.main.shake(90, 0.003);
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
          this.scene.cameras.main.shake(120, 0.004);
        } else if (ev.k === 8) this.fx.splinters(ev.x, ev.y);
        else if (ev.k === 9) this.fx.natureSparkles(ev.x, ev.y, ev.r);
        else if (ev.k === 10) this.fx.nova(ev.x, ev.y, ev.r, 0x78c8ff);
        else if (ev.k === 11) {
          this.fx.ring(ev.x, ev.y, ev.r, 0xff6020, 0.5, true);
          if (Math.hypot(ev.x - own.x, ev.y - own.y) < CONST.PLAYER_RADIUS * 2) this.scene.cameras.main.shake(100, 0.003);
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
        if (this.figures.event(ev, performance.now() / 1000) === 'lost') break;
        if (ev.kind === KIND.Ghost) {
          // A Ghost leaves no skull: it comes apart.
          this.fx.disintegrate(ev.x, ev.y - 6);
        } else if (ev.kind === KIND.Shade) {
          // A Shade leaves no skull either: its body goes and the veil that wrapped it drifts apart.
          const rem = this.views.get(ev.id)?.veilRemains();
          this.fx.shadeDeath(ev.x, ev.y, rem?.veil ?? null, rem?.body);
        } else if (!isProjectileKind(ev.kind)) {
          // A skull token marks where a figure fell.
          this.scene.add.image(ev.x, ev.y - 2, 'atlas', 'skull').setDepth(DEPTH.decal).setAlpha(0.85).setFlipX(Math.random() < 0.5);
          this.fx.burst(ev.x, ev.y - 6, 14, SKELETAL.has(ev.kind) ? 0xe8e4d0 : 0x9a2020, 50, 0.5, 60);
          if (isBossKind(ev.kind)) this.fx.explosion(ev.x, ev.y - 10, 50, 0xffe060);
        }
        break;
      }
      case 'Sink': {
        const began = ev.how !== 2 && !this.figures.sinking(ev.id);
        this.figures.event(ev, performance.now() / 1000);
        if (began) sinkStartFx(this.fx, ev.x, ev.y, ev.how === 1);
        break;
      }
      case 'Raise':
        this.fx.raise(ev.x, ev.y, ev.k);
        break;
      case 'Immune':
        this.fx.immune(ev.x, ev.y);
        break;
      case 'Effect':
        // Drawn from the snapshot bitmask and its looks (status.ts). Invisible has a default fade:
        // the entity leaves the snapshot at once, so a ghost image fades out; on return it fades in.
        this.figures.event(ev, performance.now() / 1000);
        break;
      case 'Coins':
        this.fx.coins(ev.x, ev.y, Math.min(10, 3 + Math.floor(ev.v / 4)));
        this.fx.text(ev.x, ev.y - 14, `+${ev.v} coins`, '#ffd040', { kind: 'small' });
        break;
    }
  }

  shotEnded(shot: ShotView, how: 'wall' | 'enemy' | 'gone'): void {
    // A wrongly predicted pass needs no spark of its own: the server's `Dmg` draws one at that enemy.
    if (how === 'wall') this.fx.hitSpark(shot.x, shot.y, PROJECTILES[shot.kind].trail ?? 0xffffff);
    this.shotImgs.get(shot.shot)?.destroy();
    this.shotImgs.delete(shot.shot);
  }

  // ------------------------------------------------------------ frame

  frame(f: RunFrame): ViewStats {
    const { dt, now } = f;
    const timer = this.timer;
    const cam = this.scene.cameras.main;
    const camX = f.camera.x;
    const camY = f.camera.y;
    cam.centerOn(Math.round(camX), Math.round(camY - 8));
    // Phaser's getWorldPoint reads scrollX/scrollY directly, so this frame's centre is used.
    settleOwnAim(f.own, this.pointerWorld());
    const darkvision = (f.snap?.me.darkvision ?? 0) / 100;
    const vision = f.snap?.me.vision ?? CONST.FOV_RADIUS;
    this.lightView.update(cam.worldView, camX, camY, f.snap?.lights ?? [], now, darkvision, vision);
    timer.lap('light');
    const torches: AirTorch[] = [];
    for (const e of f.ents.values()) if (e.kind === KIND.Torch) torches.push({ x: e.x, y: e.y, side: e.extra, lit: e.anim === 1 });
    const shots: AirShot[] = (f.snap?.lights ?? []).map(([x, y, kind]) => ({ x, y, kind }));
    this.mood?.update(dt, cam.worldView, torches, shots, this.collectMovers(f));
    this.sunbeams.update(dt, cam.worldView, now);
    timer.lap('mood');
    const settled = !this.woodland || this.woodland.settled;
    if (this.info.daylight) this.visionMask.soft = settled ? DEFAULT_HAZE.soft : 0;
    this.visionMask.update(cam.worldView, this.lightView.view, () => this.lightView.sight);
    // only the soft wedge waits for the scenery it belongs to (the woodland's trunks): over undrawn trees it would
    // haze bare ground. On daylight maps that is the haze's soft level (soft 0 = no haze behind blockers); the
    // pipeline itself stays on, since toggling it as `settled` flips would rebuild it and pop the beyond-sight haze.
    // On dark maps (the cove) the ShadeMask's black 0.3 waits instead.
    syncUnseenFX(cam, this.info.daylight, this.visionMask.texture, this.visionMask.rect, DEFAULT_HAZE);
    this.shadeMask.on = !this.info.daylight && settled;
    this.shadeMask.update(cam.worldView, this.lightView.view, () => this.lightView.sight);
    syncDarkvisionFX(cam, darkvision, this.lightView.mask, [this.map.w * TILE, this.map.h * TILE]);
    timer.lap('mask');

    const seen = new Set<number>();
    for (const e of f.ents.values()) {
      seen.add(e.id);
      if (e.kind === KIND.Torch) this.drawTorch(e, now);
      else if (isHazardKind(e.kind)) this.drawHazard(e);
      else if (e.kind === KIND.Chest) this.drawChest(e);
      else if (e.kind === KIND.Barrel) this.drawBarrel(e);
      else if (e.kind === KIND.Mimic) this.drawMimic(e, f);
      else if (isProjectileKind(e.kind)) this.drawProjectile(e, f);
      else this.drawFigure(e, f);
    }
    // Own figure is always drawn from prediction.
    if (!seen.has(f.you) && f.own.alive) {
      seen.add(f.you);
      this.drawFigure(this.figures.ownEntity(f, this.myKind), f);
    }
    this.figures.prune(now);
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      if (this.figures.takeVanish(id, now)) v.ghost();
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
    timer.lap('figures');
    // after the views moved this frame, so the copy is not a frame behind the hero
    // only the own hero, and only while it plays (not dead or spectating); teammates get no silhouette
    const ownLook = f.own.alive && f.watching === null ? this.views.get(f.you)?.bodyLook() ?? null : null;
    this.cove?.update(now, ownLook);
    this.woodland?.update(now, ownLook, cam.worldView, this.lightView.seenLit);
    timer.lap('woodland');

    const hint = f.useHint;
    if (hint) this.useHint.set(hint.label, Math.round(hint.ent.x), Math.round(hint.ent.y - 26));
    else this.useHint.hide();

    this.drawShots(f);
    this.drawBarsAndBeams(f);
    this.rulesLog.draw(f.ents.values(), (id) => (this.views.get(id) ?? this.mimicViews.get(id) ?? this.chestViews.get(id) ?? this.barrelViews.get(id))?.height);
    this.drawGaze(f);
    this.drawDebugPath(f);
    this.forceField?.update(dt);
    this.terrain?.update(dt);
    this.fx.update(dt);
    timer.lap('effects');

    return {
      fps: this.scene.game.loop.actualFps,
      wholeMs: timer.frameMs,
      renderMs: timer.renderMs,
      systems: timer.on ? SYSTEMS.map((s) => [s, timer.systems[s]] as const) : [],
      objects: this.scene.children.length,
      drawCalls: timer.drawCalls,
      canvas: { w: this.scene.scale.width, h: this.scene.scale.height, cssZoom: this.scene.scale.zoom },
    };
  }

  private drawFigure(e: EntState, f: RunFrame): void {
    const me = e.id === f.you;
    const now = f.now;
    let view = this.views.get(e.id);
    if (!view) {
      const pi = isPlayerKind(e.kind) ? this.info.players.find((p) => p.ent === e.id) : undefined;
      const weapons = pi ? heroWeapons(FIGURES[e.kind], pi.melee, pi.ranged) : undefined;
      view = new EntityView(this.scene, e.kind, this.fx, me ? undefined : pi?.name, weapons);
      this.views.set(e.id, view);
    }
    // Reappearing in the ambush wind-up: the flicker is the entrance, the default fade-in would blur it.
    if (this.figures.takeReappear(e.id, now) && !isPlayerKind(e.kind) && e.anim !== ANIM.Ambush) view.fadeIn();
    const { s, predicted, started, drowning } = this.figures.stateOf(e, f, now);
    if (started) sinkStartFx(this.fx, s.x, s.y, drowning);
    this.terrainState(e, s, predicted, drowning, f);
    view.update(s, f.dt);
  }

  /** Wading, splashes and embers, or the bubbles of a drowning hero (the sink itself is in `FigureStates`). */
  private terrainState(e: EntState, s: ViewState, predicted: boolean, drowning: boolean, f: RunFrame): void {
    const dt = f.dt;
    if (s.fall !== undefined) {
      if (drowning) bubbleFx(this.fx, s.x, s.y, dt);
      return;
    }
    const tile = this.map.tileAt(s.x, s.y);
    const dashing = skimsTerrain(e.flags, predicted ? f.own.dashing : e.anim === ANIM.Dash);
    if (!splashes(e.flags)) return; // incorporeal: no wading, splash, spray or embers
    let wade = this.wade.get(e.id);
    if (!wade) this.wade.set(e.id, (wade = new WadeFx()));
    // Only heroes burn: demons walk lava unharmed, other enemies never enter it.
    wade.update(this.fx, s.x, s.y, tile, dashing, s.anim === ANIM.Move, isPlayerKind(e.kind), dt);
  }

  private drawMimic(e: EntState, f: RunFrame): void {
    let view = this.mimicViews.get(e.id);
    if (!view) {
      view = new MimicView(this.scene, this.fx);
      this.mimicViews.set(e.id, view);
    }
    view.sync({ x: e.x, y: e.y, anim: e.anim, animT: e.animMs / 1000, aim: e.aim, flags: e.flags }, f.dt, f.own.alive ? Math.hypot(e.x - f.own.x, e.y - f.own.y) : Infinity);
  }

  private drawChest(e: EntState): void {
    let view = this.chestViews.get(e.id);
    if (!view) {
      view = new ChestView(this.scene);
      this.chestViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim === 1 ? e.animMs / 1000 : -1);
  }

  private drawBarrel(e: EntState): void {
    let view = this.barrelViews.get(e.id);
    if (!view) {
      view = new BarrelView(this.scene);
      this.barrelViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim, e.animMs);
  }

  private drawTorch(e: EntState, now: number): void {
    let view = this.torchViews.get(e.id);
    if (!view) {
      view = new TorchView(this.scene);
      this.torchViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim === 1, e.extra, now);
  }

  private drawProjectile(e: EntState, f: RunFrame): void {
    // Our own projectiles are shown by the local cosmetic copy, also once it has ended (the session's `hiddenShots`).
    const mine = f.hiddenShots.has(e.id);
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

  /** The own predicted shots: an image each, moved, spun and trailed (the session moves the shots themselves). */
  private drawShots(f: RunFrame): void {
    for (const c of f.shots) {
      const pd = PROJECTILES[c.kind];
      let img = this.shotImgs.get(c.shot);
      if (!img) {
        img = this.projectileImage(pd);
        this.orientProjectile(img, pd, Math.atan2(c.vy, c.vx));
        this.shotImgs.set(c.shot, img);
      }
      img.setPosition(Math.round(c.x), Math.round(c.y - 8));
      // The thrower only sees this copy: a spinning axe must keep turning.
      if (pd.spin) this.orientProjectile(img, pd, Math.atan2(c.vy, c.vx));
      if (pd.trail && Math.random() < 0.6) this.fx.particle(c.x, c.y - 8, 0, 0, 0.25, pd.trail, { depth: DEPTH.projectile - 1 });
    }
  }

  /** Debug: marching dashed lines along the server's shortest paths to the boss (yellow), the ogre (blue) and the cove (green). */
  private drawDebugPath(f: RunFrame): void {
    const g = this.debugGfx.clear();
    const d = f.debug;
    if (!d.on || !f.own.alive) return;
    // Dodge notice circles at the creatures' drawn positions, and the dodge lines, fading over 0.6 s.
    g.lineStyle(1, 0xffffff, 0.3);
    for (const [id, r] of d.notice) {
      const e = f.ents.get(id);
      if (e && !(e.flags & FLAG.DEAD)) g.strokeCircle(e.x, e.y, r);
    }
    // The session prunes the dodges (older than 0.6 s); this only draws them.
    for (const dd of d.dodges) {
      g.lineStyle(2, 0xff40ff, 1 - (f.now - dd.at) / 0.6);
      g.lineBetween(dd.x0, dd.y0, dd.x1, dd.y1);
    }
    this.drawPathLine(g, f.own.x, f.own.y, f.now, d.cove, 0x40e070, 0x20a050);
    this.drawPathLine(g, f.own.x, f.own.y, f.now, d.ogre, 0x40a0ff, 0x4060ff);
    this.drawPathLine(g, f.own.x, f.own.y, f.now, d.path, 0xffe040, 0xff4040);
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
    const img = pd.frame ? this.scene.add.image(0, 0, 'atlas', pd.frame) : this.scene.add.image(0, 0, 'glow').setTint(pd.glow ?? 0xffffff).setBlendMode(Phaser.BlendModes.ADD);
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
      img = this.scene.add.image(0, 0, 'glow').setTint(look.tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.hazard);
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

  /**
   * The lich's stone gaze: while it stares (`ANIM.Gaze`), a thin grey line
   * from its eyes to the hero it petrifies (entity id in `extra`), when in view.
   */
  private drawGaze(f: RunFrame): void {
    const g = this.gaze.clear();
    for (const e of f.ents.values()) {
      if (e.anim !== ANIM.Gaze || e.flags & FLAG.DEAD) continue;
      const me = e.extra === f.you && f.own.alive;
      const t = me ? null : f.ents.get(e.extra);
      if (!me && !t) continue;
      const tx = me ? f.own.x : t!.x;
      const ty = me ? f.own.y : t!.y;
      drawGazeBeam(g, e.x, e.y, tx, ty, f.now);
    }
  }

  /** What moves through the air this frame: figures, the own hero (from prediction), others' shots and the own cosmetic shots, each once. */
  private collectMovers(f: RunFrame): AirMover[] {
    const out = this.airMovers;
    out.length = 0;
    const tr = this.movers;
    tr.begin(f.dt);
    const add = (m: AirMover | null) => {
      if (m) out.push(m);
    };
    // Projectiles are drawn 8 px above their ground position; their air follows the drawing.
    const shotMover = (m: AirMover | null): AirMover | null => {
      if (m) m.airY = m.y - 8;
      return m;
    };
    for (const e of f.ents.values()) {
      if (e.id === f.you || e.flags & FLAG.DEAD) continue;
      if (isProjectileKind(e.kind)) {
        if (ownPredictedShot(e.extra, f.you) !== null) continue; // own shots come from f.shots
        const a = projectileAir(e.kind);
        add(shotMover(tr.track(e.id, e.x, e.y, a.r, true, a.heat)));
      } else if (e.kind === KIND.Torch || isHazardKind(e.kind) || e.kind === KIND.Chest || e.kind === KIND.Barrel) {
        continue;
      } else {
        add(tr.track(e.id, e.x, e.y, FIGURES[e.kind]?.baseR ?? 6, false, 0));
      }
    }
    if (f.own.alive) add(tr.track(-1, f.own.x, f.own.y, FIGURES[this.myKind]?.baseR ?? 6, false, 0));
    for (const c of f.shots) {
      const a = projectileAir(c.kind);
      add(shotMover(tr.track(-(100000 + c.shot), c.x, c.y, a.r, true, a.heat)));
    }
    return out;
  }

  private drawBarsAndBeams(f: RunFrame): void {
    const now = f.now;
    this.bars.clear();
    this.heroBars.clear();
    const labelled = new Set<number>();
    for (const e of f.ents.values()) {
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
          t = smoothText(this.scene.add.text(0, 0, name, { fontFamily: FONT_TEXT, fontStyle: WORLD_TEXT.tag.style, fontSize: `${WORLD_TEXT.tag.size}px`, resolution: TEXT_RESOLUTION }).setOrigin(0.5, 1));
          this.barLabels.set(e.id, t);
        }
        // `setColor` redraws and re-uploads the text canvas, and every `setDepth` queues a
        // sort of the display list: set them only when they change (a charm flips the side).
        const color = hero ? '#7fe08a' : '#b8c4d8';
        const depth = hero ? DEPTH.heroBars : DEPTH.enemyBars;
        if (t.style.color !== color) t.setColor(color);
        if (t.depth !== depth) t.setDepth(depth);
        t.setPosition(Math.round(e.x), y - 2);
        labelled.add(e.id);
      }
    }
    for (const [id, t] of this.barLabels) if (!labelled.has(id)) (t.destroy(), this.barLabels.delete(id));
    // Lich draining its disciples: red shimmering energy flowing to the lich.
    // The server sends both ends even when they are out of view (`drain`), and
    // the beams are drawn above the fog; a lich in view uses its smooth position.
    const b = this.beams;
    b.clear();
    const drain = f.snap?.drain;
    if (!drain) return;
    let lich: EntState | undefined;
    for (const e of f.ents.values()) if (e.kind === KIND.Lich) lich = e;
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
