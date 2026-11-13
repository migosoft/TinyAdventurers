// Every figure and every shot of a real run as cards (#303): the Phaser-free twin of EntityView and the projectile part of
// PhaserRunView. The look of a figure is `figurePose` (game/anim/pose.ts), shared with the 2D view; this file turns the pose
// into cards in the 3D view's passes (render3d/cards.ts). The board objects (torches, chests, barrels, mimics) and the coin
// burst are drawn here too, from the poses in game/objectPose.ts; walls, props and hazards are not.
import { ANIM, FLAG, KIND, SIDE } from '../generated/defs';
import { barrelPose, CHEST_HEIGHT, chestFrame, MimicTracker, mimicPose, torchFrame, type MimicState } from '../game/objectPose';
import { FIGURES, heroWeapons, isHazardKind, isPlayerKind, isProjectileKind, PROJECTILES, type FigureDef, type FramePoints } from '../game/anim/defs';
import { VANISH_SECS } from '../game/anim/entityAlpha';
import { FigureStates } from '../game/anim/figureState';
import { figurePose, newPoseMemory, type FrameBounds, type PoseMemory, type Tint } from '../game/anim/pose';
import type { EntState } from '../game/world';
import type { WorldTextKind } from '../game/worldText';
import type { PictureEv, RunFrame, RunViewInit, ShotView } from '../run/view';
import { SHOT_LIFT, snapGround, type Cam } from './camera';
import { casterOf, newCardBuf, newGlowBuf, newShadowBuf, pushCard, pushFlat, pushGlow, pushLying, pushShadow, pushWall, sortBackToFront, WALL_SIGHT_PUSH, WEAPON_BIAS, type Card, type CardBuf, type GlowBuf, type ShadowBuf } from './cards';
import { AMBIENT, darkAlpha, torchFlicker } from './light';
import type { ShadowCaster } from './lights';
import { opensWalls } from './openers';
import type { FrameRects } from './worldMesh';

const TILE = 16;
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The 2D ground shadow: an ellipse 0.45 as deep as it is wide, 0.45 strong at the centre. */
const SHADOW_DEPTH = 0.45;
const SHADOW_ALPHA = 0.45;
/** A dash afterimage lives this long (s) and starts at half alpha. */
const AFTER_SECS = 0.25;
const AFTER_ALPHA = 0.5;
/** Skull tokens kept (the oldest go first). */
const SKULL_CAP = 256;
/** The torch's flame frames, and how far in front of its wall face the card hangs (tiles). */
const TORCH_FRAMES = ['torch_f0', 'torch_f1', 'torch_f2', 'torch_f3', 'torch_f4'];
const TORCH_OFF = 0.02;
/** The flame card's centre height (tiles) and its glow's lift above that, size and colour (the demo's torch). */
export const TORCH_MID = 1.0;
const TORCH_GLOW = { lift: 0.25, size: 1.5, rgb: [0.5, 0.3, 0.14] as [number, number, number] };
/** The 2D chest, barrel and mimic shadow: an ellipse 13 x 5 px, strength 0.4. */
const OBJ_SHADOW_RX = 6.5;
const OBJ_SHADOW_RY = 2.5;
const OBJ_SHADOW_ALPHA = 0.4;
/** Coins thrown from a chest or a fallen enemy (`fx.coins`): gravity px/s^2, the most kept at once. */
const COIN_GRAVITY = 220;
const COIN_CAP = 128;

/**
 * The aim as it appears on screen (rad, y down). The camera's right vector is (cos yaw, sin yaw) and its ground-down vector
 * (-sin yaw, cos yaw) (`project`); the world direction (cos a, sin a) is screen right by cos(a - yaw) and down by sin(a - yaw),
 * so the screen angle is a - yaw: yaw 0 leaves the aim as it is, and at yaw 90 degrees an aim along +x runs up the screen.
 */
export function screenAim(yaw: number, aim: number): number {
  return aim - yaw;
}

/**
 * How a frame is lit, as the caller draws it: the `ambient` it uses, what a dark figure does (`fade` into the dark, or `shape`: keep its
 * shape, lit by the ambient only) and whether a lit torch gets a glow quad (`light=work`; with the game's lights the flame card is all).
 */
export interface FigureLook { ambient: [number, number, number]; dark: 'fade' | 'shape'; torchGlow: boolean }
const DEFAULT_LOOK: FigureLook = { ambient: AMBIENT, dark: 'shape', torchGlow: true };

/** Something that may open walls this frame (#303 Task 7): its foot in tiles, its middle height in tiles, and why. */
export interface Opener { id: number; x: number; z: number; mid: number; who: 'hero' | 'enemy' | 'friend' | 'chest' | 'mimic' | 'object' }

/** Where overlays hang from a drawn thing (#311). Foot in tiles; heights in art px above the foot on screen. */
export interface FigureAnchor {
  x: number; z: number;
  /** 2D's view `height`: body frame height x scale (EntityView), CHEST_HEIGHT for chests, barrels, mimics. */
  height: number;
  /** 2D's name-tag offset: (footY ?? frame h) x scale + 3. */
  tag: number;
  /** 2D's StatusAnchor `head` and `cx`: the opaque body's top, and its opaque centre from the foot (flip applied). */
  head: number; cx: number;
  alpha: number;
  /** False while falling or drowning. */
  tagShown: boolean;
  /** Effect bits (the own hero's from `f.own.effects`). */
  effects: number;
}

export interface FigureOut {
  cards: CardBuf; ghosts: CardBuf; decals: CardBuf; shadows: ShadowBuf; glows: GlowBuf; emissive: CardBuf;
  openers: Opener[];
  /** The standing body card of every figure, chest, barrel and mimic as a shadow caster (id: the entity's); not lying, shots, flames or images. */
  casters: ShadowCaster[];
  /** Floating words born this frame (the mimic's wake cue): simulation px, `up` art px above the spot. */
  floats: Array<{ x: number; y: number; text: string; color: string; kind: WorldTextKind; up: number }>;
}

interface Fig {
  mem: PoseMemory;
  def: FigureDef;
  /** The standing body card of the last frame (null while lying, hidden or before the first). */
  body: Card | null;
}

/** An image left behind: a vanished figure fading out, or a dash afterimage. */
interface Image { card: Card; alpha0: number; secs: number; left: number }
interface Skull { x: number; z: number; flip: boolean }
/** A coin in flight: spot in tiles, launch speed in screen px/s (right, up), `born` null until the next frame stamps it. */
interface Coin { x: number; z: number; vx: number; vy: number; life: number; born: number | null; frame: string }
/** A mimic's clocks: the wake and rattle tracker and the pose's one-shot memory. */
interface MimicMem { tracker: MimicTracker; mem: { lastHop: number; wakeFx: boolean } }

const rgbOf = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** The tint of a body card from the pose: `mode` 0 multiply, 1 fill, 2 grey then multiply (stone). */
function lookOf(t: Tint, grey: boolean): { tint: [number, number, number]; mode: 0 | 1 | 2 } {
  if (t.mode === 'fill') return { tint: rgbOf(t.rgb), mode: 1 };
  return { tint: t.mode === 'mul' ? rgbOf(t.rgb) : [1, 1, 1], mode: grey ? 2 : 0 };
}

/** Not a figure: its own look is the object's (torches, chests, barrels, mimics, hazards) or the shot's. */
const isFigureKind = (k: number): boolean => !(k === KIND.Torch || k === KIND.Chest || k === KIND.Barrel || k === KIND.Mimic || isHazardKind(k) || isProjectileKind(k));

export class Figures3d {
  /** Figures drawn last frame. */
  count = 0;
  /** The overlay anchors of the last frame, by entity id (rebuilt every frame): figures, chests, barrels and mimics. */
  readonly anchors = new Map<number, FigureAnchor>();
  private readonly states: FigureStates;
  private readonly figs = new Map<number, Fig>();
  private images: Image[] = [];
  private skulls: Skull[] = [];
  private coins: Coin[] = [];
  private readonly mimics = new Map<number, MimicMem>();
  private now = 0;
  private cam: Cam | null = null;
  /** This frame's look: the entities the server marks dark, whether they fade (else keep their shape), by how much, and whether a torch has a glow quad. */
  private dark: ReadonlySet<number> = new Set();
  private darkFade = false;
  private fadeAlpha = 1;
  private torchGlow = true;
  private readonly myKind: number;
  private readonly players: RunViewInit['info']['players'];

  constructor(init: RunViewInit, private readonly frames: FrameRects, private readonly bounds: (frame: string) => FrameBounds) {
    this.states = new FigureStates(init.map);
    this.myKind = init.myKind;
    this.players = init.info.players;
  }

  /** Sink, Invisible and Died bookkeeping; a Died adds a skull unless the figure was lost to a chasm or the deep, or comes apart (Ghost, Shade) or is a shot. */
  event(ev: PictureEv): void {
    if (ev.t === 'Coins') {
      // Like `fx.coins`: min(10, 3 + v / 4) coins, aimed up the screen within +-0.8 rad, 50..90 px/s, living 0.7..1 s.
      const n = Math.min(10, 3 + Math.floor(ev.v / 4));
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const s = 50 + Math.random() * 40;
        this.coins.push({ x: ev.x / TILE, z: ev.y / TILE, vx: Math.cos(a) * s, vy: -Math.sin(a) * s, life: 0.7 + Math.random() * 0.3, born: null, frame: `coin_anim_f${i % 4}` });
      }
      if (this.coins.length > COIN_CAP) this.coins.splice(0, this.coins.length - COIN_CAP);
      return;
    }
    const lost = this.states.event(ev, this.now);
    if (ev.t !== 'Died' || lost === 'lost') return;
    if (ev.kind === KIND.Ghost || ev.kind === KIND.Shade || isProjectileKind(ev.kind)) return;
    this.skulls.push({ x: ev.x / TILE, z: ev.y / TILE, flip: Math.random() < 0.5 });
    if (this.skulls.length > SKULL_CAP) this.skulls.shift();
  }

  /** The 3D view has no picture for a shot's end yet (the sparks are a later task). */
  shotEnded(_shot: ShotView): void {}

  frame(f: RunFrame, cam: Cam, look: FigureLook = DEFAULT_LOOK): FigureOut {
    this.now = f.now;
    this.cam = cam;
    this.dark = f.dark;
    this.darkFade = look.dark === 'fade';
    this.fadeAlpha = darkAlpha(look.ambient);
    this.torchGlow = look.torchGlow;
    const out: FigureOut = { cards: newCardBuf(), ghosts: newCardBuf(), decals: newCardBuf(), shadows: newShadowBuf(), glows: newGlowBuf(), emissive: newCardBuf(), openers: [], casters: [], floats: [] };
    const seen = new Set<number>();
    this.anchors.clear();
    let drawn = 0;
    for (const e of f.ents.values()) {
      seen.add(e.id);
      if (isFigureKind(e.kind)) { if (this.drawFigure(e, f, cam, out)) drawn++; }
      else if (e.kind === KIND.Torch) this.drawTorch(e, f.now, cam, out);
      else if (e.kind === KIND.Chest) this.drawChest(e, cam, out);
      else if (e.kind === KIND.Barrel) this.drawBarrel(e, cam, out);
      else if (e.kind === KIND.Mimic) this.drawMimic(e, f, cam, out);
    }
    for (const id of this.mimics.keys()) if (!seen.has(id)) this.mimics.delete(id);
    // The own figure is always drawn from prediction.
    if (!seen.has(f.you) && f.own.alive) {
      seen.add(f.you);
      if (this.drawFigure(this.states.ownEntity(f, this.myKind), f, cam, out)) drawn++;
    }
    this.count = drawn;
    this.states.prune(f.now);
    for (const [id, fig] of this.figs) {
      if (seen.has(id)) continue;
      // A figure that went invisible leaves its image fading out where it was last drawn.
      if (this.states.takeVanish(id, f.now) && fig.body) this.images.push({ card: fig.body, alpha0: fig.body.alpha, secs: VANISH_SECS, left: VANISH_SECS });
      this.figs.delete(id);
    }

    this.drawImages(f.dt, cam, out);
    this.drawShots(f, cam, out);
    for (const sk of this.skulls) {
      // 2D puts the token 2 px up the screen from the death spot: 2 / 16 tile away from the camera on the ground.
      const x = sk.x + (Math.sin(cam.yaw) * 2) / TILE;
      const z = sk.z - (Math.cos(cam.yaw) * 2) / TILE;
      pushFlat(out.decals, { frame: 'skull', x, z, lift: 0, flip: sk.flip, originX: 0.5, footY: 0.5, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 0.85 }, this.frames, cam);
    }
    this.drawCoins(f.now, cam, out);
    sortBackToFront(out.ghosts, cam);
    return out;
  }

  /** The torch's foot is the wall's edge: its face plane is the tile line it sits on, and its card hangs `TORCH_OFF` in front. */
  private drawTorch(e: EntState, now: number, cam: Cam, out: FigureOut): void {
    const x = e.x / TILE;
    const z = e.y / TILE;
    const lit = e.anim === 1;
    const ph = e.id * 1.7;
    // side 0 (Face): the south face of the wall cell north of the floor; 1 (West): the east face of the wall west of the floor; 2 (East): the west face of the wall east of it
    const [cx, cz, nx, nz] = e.extra === 0 ? [x, Math.floor(z) + TORCH_OFF, 0, 1] : e.extra === 1 ? [Math.floor(x) + TORCH_OFF, z, 1, 0] : [Math.floor(x) + 1 - TORCH_OFF, z, -1, 0];
    pushWall(out.emissive, torchFrame(lit, now + ph / 8, TORCH_FRAMES), cx, TORCH_MID, cz, nx, nz, e.extra === 2, this.frames);
    const sightAt: [number, number] = [cx + nx * WALL_SIGHT_PUSH, cz + nz * WALL_SIGHT_PUSH];
    if (lit && this.torchGlow) {
      const k = torchFlicker(now, ph);
      pushGlow(out.glows, cx, TORCH_MID + TORCH_GLOW.lift, cz, TORCH_GLOW.size, [TORCH_GLOW.rgb[0] * k, TORCH_GLOW.rgb[1] * k, TORCH_GLOW.rgb[2] * k], cam, sightAt);
    }
    this.opener(e, false, x, z, TORCH_MID, 'object', out);
  }

  /**
   * A card of a dark entity (lit by the ambient only): flagged `dark`; with `fade` its alpha is scaled by the ambient's brightness and
   * it goes to the translucent pass (`ghost`). Any other card comes back as it is.
   */
  private lit(c: Card, id: number): { card: Card; ghost: boolean } {
    if (!this.dark.has(id)) return { card: c, ghost: c.alpha < 1 };
    return this.darkFade ? { card: { ...c, dark: true, alpha: c.alpha * this.fadeAlpha }, ghost: true } : { card: { ...c, dark: true }, ghost: c.alpha < 1 };
  }

  /** An entity's body card in the opaque or the translucent pass, owned by the entity, and its shadow caster (opaque, lit cards only). */
  private body(c: Card, id: number, cam: Cam, out: FigureOut): void {
    const { card, ghost } = this.lit(c, id);
    pushCard(ghost ? out.ghosts : out.cards, card, this.frames, cam, id);
    if (ghost || card.dark) return;
    const k = casterOf(card, id, this.frames, cam);
    if (k) out.casters.push(k);
  }

  /** A dark entity's ground shadow is not drawn. */
  private shadowed(id: number): boolean {
    return !this.dark.has(id);
  }

  /** The 2D body sits 1 px below its shadow: the foot moves 1 / 16 tile toward the camera on the ground (as the figures do). */
  private bodyFoot(x: number, z: number, cam: Cam): [number, number] {
    return [x - Math.sin(cam.yaw) / TILE, z + Math.cos(cam.yaw) / TILE];
  }

  private objShadow(id: number, x: number, z: number, scale: number, alpha: number, cam: Cam, out: FigureOut): void {
    if (!this.shadowed(id)) return;
    const foot = snapGround(cam.pitch, cam.yaw, x, z);
    pushShadow(out.shadows, cam, foot.x, foot.z, (OBJ_SHADOW_RX * scale) / TILE, (OBJ_SHADOW_RY * scale) / TILE, alpha);
  }

  private drawChest(e: EntState, cam: Cam, out: FigureOut): void {
    const x = e.x / TILE;
    const z = e.y / TILE;
    const [bx, bz] = this.bodyFoot(x, z, cam);
    this.body({ frame: chestFrame(e.anim === 1 ? e.animMs / 1000 : -1), x: bx, z: bz, lift: 0, flip: false, originX: 0.5, footY: 1, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 1 }, e.id, cam, out);
    this.objShadow(e.id, x, z, 1, OBJ_SHADOW_ALPHA, cam, out);
    this.objectAnchor(e, x, z);
    this.opener(e, false, x, z, CHEST_HEIGHT / 2 / TILE, 'chest', out);
  }

  private drawBarrel(e: EntState, cam: Cam, out: FigureOut): void {
    const p = barrelPose(e.anim, e.animMs);
    // The fuse's shake moves the body along screen right.
    const x = e.x / TILE + (Math.cos(cam.yaw) * p.dx) / TILE;
    const z = e.y / TILE + (Math.sin(cam.yaw) * p.dx) / TILE;
    const [bx, bz] = this.bodyFoot(x, z, cam);
    const frame = 'barrel_explosive';
    const fr = this.frames[frame];
    if (fr) {
      const card: Card = { frame, x: bx, z: bz, lift: -p.dy / TILE, flip: false, originX: 0.5, footY: 1, scale: p.scale, tint: p.fill !== null ? rgbOf(p.fill) : [1, 1, 1], mode: p.fill !== null ? 1 : 0, alpha: p.alpha };
      // Sinking in deep water: the part below the surface is cut off, not drawn under the floor.
      if (p.dy > 0) card.crop = { x: 0, y: 0, w: fr.w, h: Math.max(0, fr.h - p.dy) };
      if (!card.crop || card.crop.h > 0) this.body(card, e.id, cam, out);
    }
    if (p.shadow) this.objShadow(e.id, x, z, 1, OBJ_SHADOW_ALPHA, cam, out);
    this.objectAnchor(e, e.x / TILE, e.y / TILE);
    this.opener(e, false, x, z, CHEST_HEIGHT / 2 / TILE, 'object', out);
  }

  private drawMimic(e: EntState, f: RunFrame, cam: Cam, out: FigureOut): void {
    if (e.flags & FLAG.DEAD) return;
    let m = this.mimics.get(e.id);
    if (!m) this.mimics.set(e.id, (m = { tracker: new MimicTracker(), mem: { lastHop: -1, wakeFx: false } }));
    // The aim is read as it appears on screen (as the figures' is), so the facing and the lunge follow the camera.
    const aim = screenAim(cam.yaw, e.aim);
    const dist = f.own.alive ? Math.hypot(e.x - f.own.x, e.y - f.own.y) : Infinity;
    const s: MimicState = m.tracker.step({ x: e.x, y: e.y, anim: e.anim, animT: e.animMs / 1000, aim, flags: e.flags }, f.dt, dist);
    const p = mimicPose(s, f.now, m.mem);
    // 2D's reveal cue: a red "!" 18 px above the chest (the burst is the particles' business, #308).
    if (p.wakeCue && !f.dark.has(e.id)) out.floats.push({ x: e.x, y: e.y, text: '!', color: '#ff5050', kind: 'mark', up: 18 });
    const x = e.x / TILE;
    const z = e.y / TILE;
    const [bx, bz] = this.bodyFoot(x, z, cam);
    this.body({
      frame: `chest_mimic_open_anim_f${p.frame}`, x: bx, z: bz, lift: p.lift / TILE, flip: p.flip, originX: 0.5, footY: 1, scale: 1, sx: p.sx, sy: p.sy,
      angle: rad(p.angle), offset: [p.bx, p.by], tint: [1, 1, 1], mode: p.hurtFill ? 1 : 0, alpha: 1,
    }, e.id, cam, out);
    this.objShadow(e.id, x, z, p.shadowScale, p.shadowAlpha, cam, out);
    this.objectAnchor(e, x, z);
    this.opener(e, false, x, z, CHEST_HEIGHT / 2 / TILE, 'mimic', out);
  }

  /** A chest, a barrel or a mimic: 2D's `CHEST_HEIGHT` for the bar and the use hint. */
  private objectAnchor(e: EntState, x: number, z: number): void {
    this.anchors.set(e.id, { x, z, height: CHEST_HEIGHT, tag: CHEST_HEIGHT + 3, head: CHEST_HEIGHT, cx: 0, alpha: 1, tagShown: false, effects: e.effects });
  }

  /** Reports a thing as a wall opener when `opensWalls` (openers.ts) says it may; the one rule lives there. */
  private opener(e: EntState, fading: boolean, x: number, z: number, mid: number, who: Opener['who'], out: FigureOut): void {
    if (opensWalls(e, fading)) out.openers.push({ id: e.id, x, z, mid, who });
  }

  /** Coins in flight: thrown up the screen from the spot (a little above it), pulled down by gravity, fading out. */
  private drawCoins(now: number, cam: Cam, out: FigureOut): void {
    const keep: Coin[] = [];
    for (const c of this.coins) {
      c.born ??= now;
      const t = now - c.born;
      if (t >= c.life) continue;
      keep.push(c);
      // 2D starts a coin 6 px above the spot; right is along the camera's right on the ground, up is height.
      const right = (c.vx * t) / TILE;
      const up = (6 + c.vy * t - 0.5 * COIN_GRAVITY * t * t) / TILE;
      // The card's middle sits on the foot point (footY 0.5): never lower than half its height, so a landed coin rests on the floor.
      const rest = (this.frames[c.frame]?.h ?? 0) / 2 / TILE;
      pushCard(out.ghosts, {
        frame: c.frame, x: c.x + Math.cos(cam.yaw) * right, z: c.z + Math.sin(cam.yaw) * right, lift: Math.max(rest, up), flip: false, originX: 0.5, footY: 0.5, scale: 1,
        tint: [1, 1, 1], mode: 0, alpha: 1 - t / c.life,
      }, this.frames, cam);
    }
    this.coins = keep;
  }

  /**
   * A frame pixel of a figure's current standing body frame (the dragon's mouth) as a world point in tiles, following flip,
   * tilt, lift and scale (the card's own placement, `place` in cards.ts); null when the figure or the frame has no such point.
   */
  framePoint(id: number, points: FramePoints | undefined): { x: number; y: number; z: number } | null {
    const c = this.figs.get(id)?.body;
    const cam = this.cam;
    const p = c && points ? points[c.frame] : undefined;
    const fr = c ? this.frames[c.frame] : undefined;
    if (!c || !cam || !p || !fr) return null;
    const disp = c.flip ? fr.w - p[0] : p[0];
    const dx = disp - c.originX * fr.w;
    const dy = c.footY * fr.h - p[1];
    const ang = c.angle ?? 0;
    const rx = dx * Math.cos(ang) + dy * Math.sin(ang);
    const ry = -dx * Math.sin(ang) + dy * Math.cos(ang);
    const a = (rx * c.scale * (c.sx ?? 1) + (c.offset ? c.offset[0] * c.scale : 0)) / TILE;
    const b = (ry * c.scale * (c.sy ?? 1) - (c.offset ? c.offset[1] * c.scale : 0)) / TILE;
    const foot = snapGround(cam.pitch, cam.yaw, c.x, c.z);
    return { x: foot.x + Math.cos(cam.yaw) * a, y: c.lift + b, z: foot.z + Math.sin(cam.yaw) * a };
  }

  /** Draws one figure; false when it is not drawn (dead). */
  private drawFigure(e: EntState, f: RunFrame, cam: Cam, out: FigureOut): boolean {
    const base = FIGURES[e.kind];
    if (!base) return false;
    const { s } = this.states.stateOf(e, f, f.now);
    let fig = this.figs.get(e.id);
    if (!fig) {
      const pi = isPlayerKind(e.kind) ? this.players.find((p) => p.ent === e.id) : undefined;
      // A new figure starts at rest where it stands: the pose's speed is measured from the memory's last position (0, 0).
      const mem = newPoseMemory();
      mem.lastX = s.x;
      mem.lastY = s.y;
      fig = { mem, def: pi ? { ...base, ...heroWeapons(base, pi.melee, pi.ranged) } : base, body: null };
      this.figs.set(e.id, fig);
    }
    // Reappearing in the ambush wind-up: the flicker is the entrance, the default fade-in would blur it.
    if (this.states.takeReappear(e.id, f.now) && !isPlayerKind(e.kind) && e.anim !== ANIM.Ambush) fig.mem.appearLeft = VANISH_SECS;
    const d = fig.def;
    const pose = figurePose(d, { ...s, screenAim: screenAim(cam.yaw, s.aim) }, f.dt, fig.mem, this.bounds);
    fig.body = null;
    if (!pose.visible) return false;

    const fb = this.bounds(pose.frame);
    const x = s.x / TILE;
    const z = s.y / TILE;
    const sc = pose.scale;
    const { tint, mode } = lookOf(pose.tint, pose.grey);
    const down = (pose.sink + pose.drop) / TILE;
    /** The weapon card is owned by its wielder (it is not shadowed by the wielder), but casts nothing of its own. */
    const into = (c: Card): void => {
      const l = this.lit(c, e.id);
      pushCard(l.ghost ? out.ghosts : out.cards, l.card, this.frames, cam, e.id);
    };

    if (pose.lie) {
      // Asleep: the body lies on the floor. The pose's lie layout is screen px; the lying card's axes are turned a quarter, so the offset is too.
      const lie = pose.lie;
      const headRight = !pose.left;
      // A dark figure lying on the floor stays a decal: its alpha fades (or its shape stays) like any dark card.
      const dark = this.dark.has(e.id);
      pushLying(out.decals, {
        frame: pose.frame, crop: { x: lie.cropX, y: 0, w: lie.cropW, h: pose.footY }, x, z, lift: 0, flip: pose.left, originX: pose.originX, footY: pose.footY / fb.h,
        scale: sc, sx: lie.squash, sy: 1, offset: headRight ? [lie.y, -lie.x] : [-lie.y, lie.x], tint, mode, alpha: dark && this.darkFade ? pose.alpha * this.fadeAlpha : pose.alpha, headRight, dark,
      }, this.frames, cam);
    } else {
      // The 2D body sits 1 px below the shadow (body.y 1). A card lowered into the floor would lose its foot row, so the
      // foot moves 1 / 16 tile toward the camera on the ground instead (screen down is (-sin yaw, cos yaw)).
      // `aimStep` is 2D's screen step: the melee step is (3, 1.5) along the aim (y halved for the foreshortening) but the
      // wolf's lunge is not, so the factor is not uniform and it is applied here as it is.
      const body: Card = {
        frame: pose.frame, x: x + (pose.aimStep.x * sc - Math.sin(cam.yaw) * sc) / TILE, z: z + (pose.aimStep.y * sc + Math.cos(cam.yaw) * sc) / TILE, lift: -down, flip: pose.left, originX: pose.originX, footY: pose.footY / fb.h,
        scale: sc, sx: pose.body.sx, sy: pose.body.sy, angle: rad(pose.body.angle), offset: [pose.body.x, pose.body.y - 1], tint, mode, alpha: pose.alpha,
      };
      if (pose.sink > 0) body.crop = { x: 0, y: 0, w: fb.w, h: pose.footY - pose.sink };
      if (!body.crop || body.crop.h > 0) {
        into(body);
        if (body.alpha >= 1 && this.shadowed(e.id)) {
          const k = casterOf(body, e.id, this.frames, cam);
          if (k) out.casters.push(k);
        }
        // The stored card is the lit one: a vanish image inherits `dark` and the faded alpha (`framePoint` reads geometry only).
        const l = this.lit(body, e.id);
        fig.body = l.card;
        if (pose.afterimage) {
          const k = this.dark.has(e.id) && this.darkFade ? this.fadeAlpha : 1;
          this.images.push({ card: { ...l.card, tint: rgbOf(d.base), mode: 0 }, alpha0: AFTER_ALPHA * k, secs: AFTER_SECS, left: AFTER_SECS });
        }
      }
    }

    const wp = pose.weapon;
    if (wp && !pose.lie) {
      // The weapon is a child of the figure in 2D: its offset is in figure px (scaled by the figure), not moved by the body's step.
      const wsc = wp.scale * sc;
      const wt = pose.weaponTint !== null ? rgbOf(pose.weaponTint) : ([1, 1, 1] as [number, number, number]);
      into({
        frame: wp.frame, x, z, lift: -down, flip: wp.flipX, originX: wp.originX, footY: wp.originY, scale: wsc, angle: wp.rot, offset: [wp.x / wp.scale, wp.y / wp.scale],
        tint: wt, mode: pose.grey ? 2 : 0, alpha: wp.alpha * pose.alpha, bias: wp.behind ? -WEAPON_BIAS : WEAPON_BIAS,
      });
    }

    if (pose.shadow.visible && this.shadowed(e.id)) {
      const foot = snapGround(cam.pitch, cam.yaw, x, z);
      const r = (d.baseR * sc) / TILE;
      pushShadow(out.shadows, cam, foot.x, foot.z, r * pose.shadow.sx, r * SHADOW_DEPTH * pose.shadow.sy, SHADOW_ALPHA * pose.alpha);
    }

    // The overlay anchor: the entity's own spot (the predicted one for the own hero), 2D's numbers (EntityView): the unscaled-by-pose `d.scale`.
    const ds = d.scale ?? 1;
    const mid = pose.left ? fb.w - 1 - (fb.l + fb.r) / 2 : (fb.l + fb.r) / 2;
    this.anchors.set(e.id, {
      x, z, height: fb.h * ds, tag: pose.footY * ds + 3,
      head: pose.lie ? (fb.r - fb.l + 1) * ds : (pose.footY - fb.t) * ds,
      cx: pose.lie ? 0 : (mid + 0.5 - pose.originX * fb.w) * ds,
      alpha: pose.alpha, tagShown: (s.fall ?? 0) === 0 && (s.drown ?? 0) === 0, effects: s.effects ?? 0,
    });

    const height = Math.max(0, pose.footY - fb.t - pose.sink) * sc;
    // Falling or drowning stops it opening walls; wading (pose.sink) does not.
    this.opener(e, this.states.sinking(e.id), x, z, pose.lie ? 0.15 : height / 2 / TILE, isPlayerKind(e.kind) ? 'hero' : e.side === SIDE.Hostile ? 'enemy' : 'friend', out);
    return true;
  }

  /** The fading images and afterimages: translucent cards, alpha from their start down to nothing. */
  private drawImages(dt: number, cam: Cam, out: FigureOut): void {
    const keep: Image[] = [];
    for (const im of this.images) {
      pushCard(out.ghosts, { ...im.card, alpha: im.alpha0 * (im.left / im.secs) }, this.frames, cam);
      im.left -= dt;
      if (im.left > 0) keep.push(im);
    }
    this.images = keep;
  }

  /** Server shots that are not the own hero's cosmetic copies, and the own predicted shots. */
  private drawShots(f: RunFrame, cam: Cam, out: FigureOut): void {
    for (const e of f.ents.values()) {
      if (!isProjectileKind(e.kind) || f.hiddenShots.has(e.id)) continue;
      this.shot(e.kind, e.x, e.y, e.aim, f.now, cam, out);
    }
    for (const c of f.shots) this.shot(c.kind, c.x, c.y, Math.atan2(c.vy, c.vx), f.now, cam, out);
  }

  private shot(kind: number, px: number, py: number, aim: number, now: number, cam: Cam, out: FigureOut): void {
    const pd = PROJECTILES[kind];
    if (!pd) return;
    const x = px / TILE;
    const z = py / TILE;
    if (pd.frame) {
      // Pack arrows point up; a spinning axe turns with the clock.
      const angle = pd.spin ? now * 14 : screenAim(cam.yaw, aim) + Math.PI / 2;
      pushCard(out.cards, { frame: pd.frame, x, z, lift: SHOT_LIFT, flip: false, originX: 0.5, footY: 0.5, scale: pd.scale, angle, tint: [1, 1, 1], mode: 0, alpha: 1 }, this.frames, cam);
    } else if (pd.glow !== undefined) {
      pushGlow(out.glows, x, SHOT_LIFT, z, (pd.scale * 7) / TILE, rgbOf(pd.glow), cam);
    }
  }
}
