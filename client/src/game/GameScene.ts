import Phaser from 'phaser';
import { ABILITIES, ANIM, CLASSES, CONST, FLAG, KIND, TILE_ID } from '../generated/defs';
import type { ClassId } from '../generated/ClassId';
import type { Ev } from '../generated/Ev';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Snapshot } from '../generated/Snapshot';
import type { Net } from '../net';
import { lineOfSight } from '../sim/collision';
import { Fov } from '../sim/fov';
import { TILE, TileMap } from '../sim/map';
import type { Hud } from '../ui/hud';
import { FIGURES, PROJECTILES, isBossKind, isPlayerKind, isProjectileKind } from './anim/defs';
import { EntityView, type ViewState } from './anim/EntityView';
import { tileDraws } from './autotile';
import { DEPTH, Effects } from './effects';
import { Interpolator, Predictor, type EntState } from './world';

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
  target?: [number, number];
  seenOnServer: boolean;
}

type AbilityName = keyof typeof ABILITIES;
const ATTACKS: AbilityName[] = ['MagicMissile', 'Fireball', 'Sword', 'Axe', 'Dash', 'CrossbowDagger'];

const SKELETAL = new Set<number>([KIND.SkeletonWarrior, KIND.SkeletonArcher, KIND.RaisedSkeleton, KIND.Lich]);

export class GameScene extends Phaser.Scene {
  private net!: Net;
  private hud!: Hud;
  private info!: RunStartInfo;
  private map!: TileMap;
  private mapRt!: Phaser.GameObjects.RenderTexture;
  private fov!: Fov;
  private fogTex!: Phaser.Textures.CanvasTexture;
  private fogOrigin = [-1, -1];
  private pred!: Predictor;
  private interp = new Interpolator();
  private ents = new Map<number, EntState>();
  private views = new Map<number, EntityView>();
  private projViews = new Map<number, Phaser.GameObjects.Image>();
  private hazardViews = new Map<number, Phaser.GameObjects.Image>();
  private cosmetics: Cosmetic[] = [];
  private fx!: Effects;
  private bars!: Phaser.GameObjects.Graphics;
  private beams!: Phaser.GameObjects.Graphics;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'Q' | 'E', Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private shotId = 0;
  private primaryClicked = false;
  private secondaryClicked = false;
  private localAnim = { anim: ANIM.Idle as number, start: 0 };
  private alive = true;
  private myFlags = 0;
  private spectating: number | null = null;
  private lastSnap?: Snapshot;
  private unsub?: () => void;
  private frameMs = 0;
  private myKind = 0;
  private doorImg?: Phaser.GameObjects.Image;
  // Debug mode (?debug): immortal + path to the boss, drawn above the fog.
  private debugOn = false;
  private debugPath: [number, number][] = [];
  private debugGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super('game');
  }

  init(data: GameInit): void {
    this.net = data.net;
    this.hud = data.hud;
    this.info = data.info;
    this.views = new Map();
    this.projViews = new Map();
    this.hazardViews = new Map();
    this.cosmetics = [];
    this.interp = new Interpolator();
    this.ents = new Map();
    this.alive = true;
    this.spectating = null;
    this.fogOrigin = [-1, -1];
    this.acc = 0;
    this.myFlags = 0;
    this.lastSnap = undefined;
    const tiles = this.info.tiles instanceof Uint8Array ? this.info.tiles : Uint8Array.from(this.info.tiles as ArrayLike<number>);
    this.map = new TileMap(this.info.width, this.info.height, new Uint8Array(tiles));
    this.myKind = CLASSES[data.myClass].kind;
    this.pred = new Predictor(this.map, data.myClass, this.info.mods, this.info.spawn_x, this.info.spawn_y);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2b1a10');
    this.cameras.main.setRoundPixels(true);
    this.fx = new Effects(this);
    this.drawBoard();
    this.setupFog();
    this.bars = this.add.graphics().setDepth(DEPTH.numbers - 1);
    this.beams = this.add.graphics().setDepth(DEPTH.beam);
    this.debugGfx = this.add.graphics().setDepth(DEPTH.fog + 1);
    this.debugOn = false;
    this.debugPath = [];

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,Q,E') as GameScene['keys'];
    kb.on('keydown-Q', () => this.net.send({ t: 'Spectate', dir: -1 }));
    kb.on('keydown-E', () => this.net.send({ t: 'Spectate', dir: 1 }));
    kb.on('keydown-F3', (e: KeyboardEvent) => {
      e.preventDefault();
      this.hud.toggleDebug();
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
    if (new URLSearchParams(location.search).has("debug")) this.net.send({ t: "Debug", on: true });
  }

  private cleanup(): void {
    this.unsub?.();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
  }

  // ------------------------------------------------------------ board

  /** Slight per-tile brightness variation so the board does not look flat. */
  private tileTint(x: number, y: number): number {
    const v = ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000) / 1000;
    const shade = 0xea + Math.floor(v * 0x15);
    return (shade << 16) | (shade << 8) | shade;
  }

  private drawTile(x: number, y: number, batch: boolean): void {
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
    this.placeDoor();
    // Faint printed grid lines on the floor, like a game board.
    const grid = this.add.graphics().setDepth(DEPTH.map);
    grid.lineStyle(1, 0x000000, 0.12);
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        if (this.map.get(x, y) !== TILE_ID.Floor) continue;
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

  /** The pack's door leaf sprite over the boss hall entrance. */
  private placeDoor(): void {
    const doors: [number, number][] = [];
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) if (this.map.get(x, y) === TILE_ID.DoorOpen) doors.push([x, y]);
    if (doors.length === 0) return;
    const horizontal = doors.every(([, y]) => y === doors[0][1]);
    if (!horizontal) return; // side doors: shown as a wall when closed
    const cx = (doors.reduce((s, [x]) => s + x, 0) / doors.length + 0.5) * TILE;
    const by = (doors[0][1] + 1) * TILE;
    this.doorImg = this.add.image(cx, by, 'atlas', 'doors_leaf_open').setOrigin(0.5, 1).setDepth(DEPTH.entityBase + by - 8);
  }

  // ------------------------------------------------------------ fog of war

  private setupFog(): void {
    this.fov = new Fov(this.map.w, this.map.h);
    if (this.textures.exists('fog')) this.textures.remove('fog');
    this.fogTex = this.textures.createCanvas('fog', this.map.w, this.map.h)!;
    this.fogTex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.add.image(0, 0, "fog").setOrigin(0, 0).setScale(TILE).setDepth(DEPTH.fog);
  }

  private updateFog(px: number, py: number): void {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx === this.fogOrigin[0] && ty === this.fogOrigin[1]) return;
    this.fogOrigin = [tx, ty];
    const R = CONST.FOV_RADIUS;
    this.fov.compute(this.map, tx, ty, R);
    const ctx = this.fogTex.getContext();
    const img = ctx.createImageData(this.map.w, this.map.h);
    const d = img.data;
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        const i = (y * this.map.w + x) * 4;
        d[i] = 10;
        d[i + 1] = 6;
        d[i + 2] = 18;
        let a = 0.68;
        if (this.fov.isVisible(x, y)) {
          const dist = Math.hypot(x - tx, y - ty) / R;
          a = dist < 0.55 ? 0 : ((dist - 0.55) / 0.45) * 0.4;
        }
        d[i + 3] = Math.round(a * 255);
      }
    ctx.putImageData(img, 0, 0);
    this.fogTex.refresh();
  }

  // ------------------------------------------------------------ network

  private onMessage(m: ServerMsg): void {
    if (m.t === "Snap") this.onSnapshot(m);
    else if (m.t === "DebugPath") {
      if (m.on !== this.debugOn) this.hud.setDebug(m.on);
      this.debugOn = m.on;
      this.debugPath = m.points;
    }
    else if (m.t === 'RunEnded') this.hud.showEnd(m);
  }

  private onSnapshot(s: Snapshot): void {
    const now = performance.now() / 1000;
    this.interp.push(s, now);
    this.lastSnap = s;
    if (s.me.alive) this.pred.reconcile(s);
    if (this.alive && !s.me.alive) this.hud.message('You have fallen. Q / E to watch your party.');
    this.alive = s.me.alive;
    this.spectating = s.me.spectating;
    const mine = s.ents.find((e) => e[0] === this.info.you);
    this.myFlags = mine ? mine[8] : 0;
    for (const ev of s.ev) this.onEvent(ev);
    this.hud.snapshot(s, this.info);
  }

  private onEvent(ev: Ev): void {
    switch (ev.t) {
      case 'Dmg':
        if (ev.crit) this.fx.text(ev.x, ev.y, `CRIT ${Math.round(ev.v)}`, '#ffe040', true);
        else this.fx.text(ev.x, ev.y, `${Math.round(ev.v)}`, ev.p ? '#ff5050' : '#ffffff');
        this.fx.hitSpark(ev.x, ev.y + 4, ev.p ? 0xff4040 : 0xffffff);
        if (ev.p && Math.hypot(ev.x - this.pred.state.x, ev.y + 10 - this.pred.state.y) < 4) this.cameras.main.shake(90, 0.003);
        break;
      case 'Heal':
        this.fx.text(ev.x, ev.y, `+${Math.round(ev.v)}`, '#60ff80');
        break;
      case 'Boom':
        if (ev.k === 1) this.fx.healRing(ev.x, ev.y, ev.r);
        else if (ev.k === 2) {
          this.fx.ring(ev.x, ev.y, ev.r * 2, 0xff6020, 0.5, true);
          this.fx.burst(ev.x, ev.y, 20, 0xff8030, 80);
        } else if (ev.k === 3) this.fx.ring(ev.x, ev.y, ev.r, 0x6a2a8a, 0.4, true);
        else this.fx.explosion(ev.x, ev.y, ev.r);
        break;
      case 'Died': {
                if (!isProjectileKind(ev.kind)) {
          // A skull token marks where a figure fell.
          this.add.image(ev.x, ev.y - 2, "atlas", "skull").setDepth(DEPTH.decal).setAlpha(0.85).setFlipX(Math.random() < 0.5);
          this.fx.burst(ev.x, ev.y - 6, 14, SKELETAL.has(ev.kind) ? 0xe8e4d0 : 0x9a2020, 50, 0.5, 60);
          if (isBossKind(ev.kind)) this.fx.explosion(ev.x, ev.y - 10, 50, 0xffe060);
        }
        break;
      }
      case 'Raise':
        this.fx.raise(ev.x, ev.y);
        break;
      case 'Immune':
        this.fx.immune(ev.x, ev.y);
        break;
      case 'Tile':
        this.map.set(ev.x, ev.y, ev.v);
        this.redrawTile(ev.x, ev.y);
        this.fogOrigin = [-1, -1];
        if (ev.v === TILE_ID.DoorClosed) {
          this.doorImg?.setFrame('doors_leaf_closed');
          this.hud.message('The doors slam shut behind you!');
        }
        break;
      case 'Msg':
        this.hud.message(ev.text);
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
      this.primaryClicked = this.secondaryClicked = false;
      return;
    }
    const k = this.keys;
    const mx = (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0);
    const my = (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
    const { aim, dist } = this.aimInfo();
    const ptr = this.input.activePointer;
    const wantPrimary = (ptr.leftButtonDown() || this.primaryClicked) && !this.hud.menuOpen;
    const wantSecondary = (ptr.rightButtonDown() || this.secondaryClicked) && !this.hud.menuOpen;
    this.primaryClicked = this.secondaryClicked = false;

    let primary: number | null = null;
    let secondary: number | null = null;
    let dash: [number, number] | null = null;
    if (wantPrimary && this.pred.cd1 <= 0) {
      primary = this.shotId = (this.shotId + 1) & 0xffff;
      this.pred.cd1 = this.predictAbility(this.pred.primary, primary, aim, dist);
    }
    if (wantSecondary && this.pred.cd2 <= 0) {
      secondary = this.shotId = (this.shotId + 1) & 0xffff;
      this.pred.cd2 = this.predictAbility(this.pred.secondary, secondary, aim, dist);
      if (this.pred.secondary === 'Dash') dash = [Math.cos(aim), Math.sin(aim)];
    }
    const seq = this.pred.step(mx, my, dash);
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
    });
  }

  /** Play the action locally right away. Returns the predicted cooldown. */
  private predictAbility(name: AbilityName, shot: number, aim: number, dist: number): number {
    const a = ABILITIES[name];
    const now = performance.now() / 1000;
    const { x, y } = this.pred.state;
    let anim: number = ANIM.Cast;
    let cooldown = this.pred.cooldownOf(name);
    switch (name) {
      case 'MagicMissile':
        this.spawnCosmetic(KIND.Missile, shot, aim, a.speed, a.range / a.speed);
        anim = ANIM.Shoot;
        break;
      case 'Fireball': {
        const d = Math.min(Math.max(dist, 24), a.range);
        this.spawnCosmetic(KIND.Fireball, shot, aim, a.speed, a.range / a.speed + 0.1, [x + Math.cos(aim) * d, y + Math.sin(aim) * d]);
        anim = ANIM.Cast;
        break;
      }
      case 'Sword':
      case 'Axe':
        anim = ANIM.Melee;
        break;
      case 'Dash':
        anim = ANIM.Dash;
        break;
      case 'Hide':
        this.pred.hidden = a.duration;
        anim = ANIM.Cast;
        break;
      case 'Heal':
        anim = ANIM.Cast;
        break;
      case 'CrossbowDagger': {
        const close = [...this.ents.values()].some(
          (e) => !isPlayerKind(e.kind) && FIGURES[e.kind] && Math.hypot(e.x - x, e.y - y) - FIGURES[e.kind].baseR <= CONST.DAGGER_RANGE,
        );
        if (close) {
          anim = ANIM.Melee;
          cooldown = this.pred.cooldownOf(name, true);
        } else {
          this.spawnCosmetic(KIND.Bolt, shot, aim, a.speed, a.range / a.speed);
          anim = ANIM.Shoot;
        }
        break;
      }
    }
    if (ATTACKS.includes(name)) this.pred.hidden = 0;
    this.localAnim = { anim, start: now };
    return cooldown;
  }

  private spawnCosmetic(kind: number, shot: number, aim: number, speed: number, life: number, target?: [number, number]): void {
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
      target,
      seenOnServer: false,
    });
  }

  private updateCosmetics(dt: number, serverShots: Set<number>): void {
    for (let i = this.cosmetics.length - 1; i >= 0; i--) {
      const c = this.cosmetics[i];
      const onServer = serverShots.has(c.shot);
      if (onServer) c.seenOnServer = true;
      c.life -= dt;
      const nx = c.x + c.vx * dt;
      const ny = c.y + c.vy * dt;
      const reachedTarget = c.target && (c.target[0] - nx) * c.vx + (c.target[1] - ny) * c.vy <= 0;
      const hitWall = !lineOfSight(this.map, c.x, c.y, nx, ny) || this.map.solidAt(nx, ny);
      // The server projectile hit something: ours ends too.
      const goneOnServer = c.seenOnServer && !onServer;
      if (c.life <= 0 || hitWall || goneOnServer || reachedTarget) {
        if (hitWall) this.fx.hitSpark(c.x, c.y, PROJECTILES[c.kind].trail ?? 0xffffff);
        c.img.destroy();
        this.cosmetics.splice(i, 1);
        continue;
      }
      c.x = nx;
      c.y = ny;
      const pd = PROJECTILES[c.kind];
      c.img.setPosition(Math.round(c.x), Math.round(c.y - 8));
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
    const [px, py] = this.pred.renderPos(dt);

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
    this.updateFog(camX, camY);

    const seen = new Set<number>();
    const myShots = new Set<number>();
    for (const e of this.ents.values()) {
      if (isProjectileKind(e.kind)) {
        const owner = e.extra >>> 16;
        if (owner === this.info.you) myShots.add(e.extra & 0xffff);
      }
    }
    for (const e of this.ents.values()) {
      seen.add(e.id);
      if (e.kind === KIND.FirePatch) this.drawHazard(e);
      else if (isProjectileKind(e.kind)) this.drawProjectile(e);
      else this.drawFigure(e, dt, px, py, now);
    }
    // Own figure is always drawn from prediction.
    if (!seen.has(this.info.you) && this.alive) {
      seen.add(this.info.you);
      this.drawFigure({ id: this.info.you, kind: this.myKind, x: px, y: py, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0 }, dt, px, py, now);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) (v.destroy(), this.views.delete(id));
    for (const [id, v] of this.projViews) if (!seen.has(id)) (v.destroy(), this.projViews.delete(id));
    for (const [id, v] of this.hazardViews) if (!seen.has(id)) (v.destroy(), this.hazardViews.delete(id));

    this.updateCosmetics(dt, myShots);
    this.drawBarsAndBeams(now);
    this.drawDebugPath(px, py, now);
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
    });
  }

  private drawFigure(e: EntState, dt: number, px: number, py: number, now: number): void {
    const me = e.id === this.info.you;
    let view = this.views.get(e.id);
    if (!view) {
      const name = isPlayerKind(e.kind) ? this.info.players.find((p) => p.ent === e.id)?.name : undefined;
      view = new EntityView(this, e.kind, this.fx, me ? undefined : name);
      this.views.set(e.id, view);
    }
    let s: ViewState;
    if (me && this.alive) {
      const { aim } = this.aimInfo();
      const tLocal = now - this.localAnim.start;
      let anim = this.localAnim.anim;
      const actionOver = anim === ANIM.Dash ? this.pred.state.dashT <= 0 : tLocal > 0.25;
      if (actionOver) {
        const moving = this.keys.W.isDown || this.keys.A.isDown || this.keys.S.isDown || this.keys.D.isDown;
        anim = moving ? ANIM.Move : ANIM.Idle;
      }
      let flags = this.myFlags & ~FLAG.HIDDEN;
      if (this.pred.hidden > 0) flags |= FLAG.HIDDEN;
      s = { x: px, y: py, anim, animT: tLocal, aim, flags };
    } else {
      s = { x: e.x, y: e.y, anim: e.anim, animT: e.animMs / 1000, aim: e.aim, flags: e.flags };
    }
    view.update(s, dt);
    // Dragon breath: a cone of fire particles from the mouth.
    void py;
  }

  private drawProjectile(e: EntState): void {
    const owner = e.extra >>> 16;
    const shot = e.extra & 0xffff;
    // Our own projectiles are shown by the local cosmetic copy.
    const mine = owner === this.info.you && this.cosmetics.some((c) => c.shot === shot);
    const pd = PROJECTILES[e.kind];
    if (!pd) return;
    let img = this.projViews.get(e.id);
    if (!img) {
      img = this.projectileImage(pd);
      this.projViews.set(e.id, img);
    }
    img.setVisible(!mine).setPosition(Math.round(e.x), Math.round(e.y - 8));
    this.orientProjectile(img, pd, e.aim);
    if (!mine && pd.trail && Math.random() < 0.5) this.fx.particle(e.x, e.y - 8, 0, 0, 0.25, pd.trail, { depth: DEPTH.projectile - 1 });
  }

  /** Debug: marching dashed line along the server's shortest path to the boss. */
  private drawDebugPath(px: number, py: number, now: number): void {
    const g = this.debugGfx.clear();
    if (!this.debugOn || this.debugPath.length < 2 || !this.alive) return;
    // Start at the predicted position (the server's first point is slightly old).
    const pts: [number, number][] = [[px, py], ...this.debugPath.slice(1)];
    const DASH = 6;
    const GAP = 4;
    let phase = (now * 40) % (DASH + GAP);
    g.lineStyle(2, 0x000000, 0.5);
    g.strokePoints(pts.map(([x, y]) => ({ x, y: y + 1 })), false);
    g.lineStyle(2, 0xffe040, 0.95);
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
    g.fillStyle(0xff4040, 0.6 + 0.4 * Math.sin(now * 8)).fillCircle(ex, ey, 4);
    g.lineStyle(1, 0xffe040, 1).strokeCircle(ex, ey, 7);
  }

  /** Pack sprite (arrows) or a runtime glow for magic projectiles. */
  private projectileImage(pd: (typeof PROJECTILES)[number]): Phaser.GameObjects.Image {
    const img = pd.frame ? this.add.image(0, 0, 'atlas', pd.frame) : this.add.image(0, 0, 'glow').setTint(pd.glow ?? 0xffffff).setBlendMode(Phaser.BlendModes.ADD);
    return img.setScale(pd.scale).setDepth(DEPTH.projectile);
  }

  private orientProjectile(img: Phaser.GameObjects.Image, pd: (typeof PROJECTILES)[number], aim: number): void {
    // Pack arrows point up; glows are round but pulse a little.
    if (pd.frame) img.setRotation(aim + Math.PI / 2);
    else img.setScale(pd.scale * (0.9 + 0.15 * Math.sin(performance.now() / 50)));
  }

  /** Burning ground from dragon breath: a glow with rising flames (no pack sprite exists). */
  private drawHazard(e: EntState): void {
    let img = this.hazardViews.get(e.id);
    if (!img) {
      img = this.add.image(0, 0, 'glow').setTint(0xff5010).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.hazard).setScale(2.5, 1.4);
      this.hazardViews.set(e.id, img);
    }
    img.setPosition(Math.round(e.x), Math.round(e.y)).setAlpha(Math.min(1, e.extra / 500) * (0.7 + 0.3 * Math.sin(performance.now() / 70 + e.id)));
    if (Math.random() < 0.5)
      this.fx.particle(e.x + (Math.random() * 16 - 8), e.y, 0, -25 - Math.random() * 20, 0.5, Math.random() < 0.5 ? 0xff7020 : 0xffd040, {
        depth: DEPTH.entityBase + e.y,
      });
  }

  private drawBarsAndBeams(now: number): void {
    const g = this.bars;
    g.clear();
    for (const e of this.ents.values()) {
      if (isProjectileKind(e.kind) || e.kind === KIND.FirePatch || isBossKind(e.kind) || e.hp >= 1 || e.flags & FLAG.DEAD) continue;
      const v = this.views.get(e.id);
      if (!v) continue;
      const w = 12;
      const x = Math.round(e.x - w / 2);
      const y = Math.round(e.y - v.height - 3);
      g.fillStyle(0x140c1a, 1).fillRect(x - 1, y - 1, w + 2, 4);
      g.fillStyle(isPlayerKind(e.kind) ? 0x40d060 : 0xd03030, 1).fillRect(x, y, Math.max(1, Math.round(w * e.hp)), 2);
    }
    // Lich draining its disciples: red shimmering energy flowing to the lich.
    const b = this.beams;
    b.clear();
    let lich: EntState | undefined;
    for (const e of this.ents.values()) if (e.kind === KIND.Lich) lich = e;
    if (!lich) return;
    for (const e of this.ents.values()) {
      if (e.kind !== KIND.Disciple || e.anim !== ANIM.Channel) continue;
      const sx = e.x, sy = e.y - 10, tx = lich.x, ty = lich.y - 16;
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
