// Every figure and every shot of a real run as cards (#303): the Phaser-free twin of EntityView and the projectile part of
// PhaserRunView. The look of a figure is `figurePose` (game/anim/pose.ts), shared with the 2D view; this file turns the pose
// into cards in the 3D view's passes (render3d/cards.ts). The board objects (torches, chests, barrels, mimics) and the coin
// burst are drawn here too, from the poses in game/objectPose.ts; walls, props and hazards are not.
import { ANIM, EFFECT, FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
import { has } from '../game/effectBits';
import { ACCEL_TINT } from '../game/fxLooks';
import { barrelPose, CHEST_HEIGHT, chestFrame, MimicTracker, mimicPose, torchFrame, type MimicState } from '../game/objectPose';
import { FIGURES, heroWeapons, isHazardKind, isPlayerKind, isProjectileKind, PROJECTILES, type FigureDef, type FramePoints } from '../game/anim/defs';
import { skimsTerrain, VANISH_SECS } from '../game/anim/entityAlpha';
import { FigureStates } from '../game/anim/figureState';
import { figurePose, newPoseMemory, type FrameBounds, type Pose, type PoseMemory, type Tint, type ViewState } from '../game/anim/pose';
import type { EntState } from '../game/world';
import type { TileMap } from '../sim/map';
import type { WorldTextKind } from '../game/worldText';
import type { PictureEv, RunFrame, RunViewInit, ShotView } from '../run/view';
import { SHOT_LIFT, snapGround, viewRay, type Cam } from './camera';
import { casterOf, newCardBuf, newGlowBuf, newShadowBuf, pushCard, pushFlat, pushGlow, pushLying, pushShadow, pushWall, sortBackToFront, WALL_SIGHT_PUSH, WEAPON_BIAS, type Card, type CardBuf, type GlowBuf, type ShadowBuf } from './cards';
import { AMBIENT, darkAlpha, torchFlicker } from './light';
import type { ShadowCaster } from './lights';
import { Descents, type Descent } from './dips/descents';
import { drownY, FALL_BED, standY, stepLavaSink } from './dips/descent';
import { bedAt, depthFade, surfaceAt } from './dips/shape';
import { opensWalls } from './openers';
import type { DrawnFig, MimicCue } from './fx/types';
import type { MV3 } from './fx/shapes';
import type { FigureInst } from './models/instances';
import type { FigureKit } from './models/kit';
import { BONES, BOW_WEAPONS } from './models/bones';
import type { FigureModel } from './models/model';
import { LIE_SINK, copyPose, newPose3dMemory, poseFigure, restPose, sideReach, type Pose3d, type Pose3dMemory } from './models/pose3d';
import { modelKeyOf } from './models/table';
import type { FrameRects } from './worldMesh';

const TILE = 16;
/** A biter's fangs hang this far (sprite px) in front of the figure; the bite's `u` while it holds its wind-up (the page's `u0`); a card wolf's bite lasts this long (s). */
const BITE_AHEAD = 18.5;
const BITE_HELD = 0.25;
const BITE_SECS = 0.3;
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The 2D ground shadow: an ellipse 0.45 as deep as it is wide, 0.45 strong at the centre. */
const SHADOW_DEPTH = 0.45;
const SHADOW_ALPHA = 0.45;
/** A dash afterimage lives this long (s) and starts at half alpha. */
const AFTER_SECS = 0.25;
const AFTER_ALPHA = 0.5;
/** An Accelerated figure leaves a golden copy every 0.08 s; it lives 0.2 s and starts at 0.35 (2D `status.ts`). */
const ACCEL_EVERY = 0.08;
const ACCEL_SECS = 0.2;
const ACCEL_ALPHA = 0.35;
/** The dying Shade's body fades over this long (s). */
const SHADE_FADE = 0.3;
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
export interface FigureLook {
  ambient: [number, number, number]; dark: 'fade' | 'shape'; torchGlow: boolean;
  /** Multiplies the alpha of every ground oval (figures, chests, barrels, mimics): 1 in the dungeon, `0.5 + 0.5 * night` on the woodland. */
  oval: number;
  /** The ground cover's top (tiles) under a spot with a reach `r`: ovals, lying bodies and skulls are lifted onto it (#330). Absent: 0. */
  ground?: (x: number, z: number, r: number) => number;
  /**
   * The 3D models (#338): the entities `is` chooses are handed to the model layer as `FigureInst`s (`FigureOut.models`) instead of
   * cards, once their model is built (until then they are cards). Absent: every figure is a card. The stage alone decides, so a run
   * never mixes the two by accident.
   */
  models?: { kit: FigureKit; is(e: EntState): boolean };
}
const DEFAULT_LOOK: FigureLook = { ambient: AMBIENT, dark: 'shape', torchGlow: true, oval: 1 };

/** Something that may open walls this frame (#303 Task 7): its foot in tiles, its middle height in tiles, and why. */
export interface Opener { id: number; x: number; z: number; mid: number; who: 'hero' | 'enemy' | 'friend' | 'chest' | 'mimic' | 'object' }

/** Where overlays hang from a drawn thing (#311). Foot in tiles; heights in art px above the foot on screen. */
export interface FigureAnchor {
  x: number; z: number;
  /** The drawn foot's height in tiles: the bed of a dip under it, a faller's height, 0 in the air (#324). */
  y: number;
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
  /** The figures drawn as 3D models this frame (the model layer's input; empty without `FigureLook.models`). */
  models: FigureInst[];
  /** Every figure drawn this frame, card or model, for the effects tied to one (#308). The objects are reused: valid until the next frame. */
  figs: DrawnFig[];
  /** The mimics' one-shot cues of this frame (the reveal and the landing), for the effects. */
  cues: MimicCue[];
  /** The falls into a chasm that began this frame (a figure or a barrel the hero can see), at the rim they began on, in tiles. */
  falls: Array<{ id: number; x: number; z: number }>;
}

/** A thing's drawn motion: where it was drawn last frame, its eased speed (tiles/s), its foot's last height and its lava sink. */
interface Motion { px: number; pz: number; vx: number; vz: number; y: number; lava: number }

/** One card of a faller, as it was drawn: the card before the dark of the depth, and its offsets from the faller's spot. */
interface FallCard { base: Card; ox: number; oz: number; dl: number }
/** The same for a model instance. */
interface FallInst { base: FigureInst; ox: number; oz: number; dl: number }
/** What a faller is drawn from once its entity is gone. */
interface FallParts { cards: FallCard[]; insts: FallInst[] }

/** The foot of a figure or a barrel this frame: where it is drawn, and the descent it is in. */
interface Foot { x: number; z: number; y: number; d: Descent | undefined; started: boolean; gone: boolean }

interface Fig {
  mem: PoseMemory;
  def: FigureDef;
  /** The standing body card of the last frame (null while lying, hidden or before the first). */
  body: Card | null;
  /** The model path's state: its pose memory, whether the last frame drew a model, and the instances of that frame (a vanish image copies them). */
  mem3?: Pose3dMemory;
  /** Seconds until the next Accelerated afterimage. */
  accelT?: number;
  model?: boolean;
  last?: FigureInst[] | null;
}

/** An image left behind: a vanished figure fading out, or a dash afterimage. */
interface Image { card: Card; alpha0: number; secs: number; left: number }
/** The same for a model figure: instances with their own pose copy; each one's alpha is scaled by `left / secs`. */
interface ModelImage { insts: FigureInst[]; secs: number; left: number }
/** `model`: the model's scale when the figure that died was drawn as a model (its skull is an instance), else undefined. */
/** `model`: the figure that died was drawn as a model, so its skull is an instance (one size for all: the fitted skeleton's scale), not a decal. */
interface Skull { x: number; z: number; flip: boolean; model?: boolean }
/** A coin in flight: spot in tiles, launch speed in screen px/s (right, up), `born` null until the next frame stamps it. */
interface Coin { x: number; z: number; /** The bed under its spot (tiles): where it rests. */ bed: number; vx: number; vy: number; life: number; born: number | null; frame: string }
/** A mimic's clocks: the wake and rattle tracker and the pose's one-shot memory. */
interface MimicMem { tracker: MimicTracker; mem: { lastHop: number; wakeFx: boolean } }

/**
 * The overlay anchor of a standing figure, 2D's numbers (EntityView): from the opaque bounds `fb` of the frame it shows, its foot row and the
 * game's figure scale `ds`. The card path and the model path both use it, so a model's bar and name sit where its card's would.
 */
function standingAnchor(fb: FrameBounds, footY: number, ds: number): { height: number; tag: number; head: number } {
  return { height: fb.h * ds, tag: footY * ds + 3, head: (footY - fb.t) * ds };
}

const rgbOf = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** The tint of a body card from the pose: `mode` 0 multiply, 1 fill, 2 grey then multiply (stone). */
function lookOf(t: Tint, grey: boolean): { tint: [number, number, number]; mode: 0 | 1 | 2 } {
  if (t.mode === 'fill') return { tint: rgbOf(t.rgb), mode: 1 };
  return { tint: t.mode === 'mul' ? rgbOf(t.rgb) : [1, 1, 1], mode: grey ? 2 : 0 };
}

/** Not a figure: its own look is the object's (torches, chests, barrels, mimics, hazards) or the shot's. */
const isFigureKind = (k: number): boolean => !(k === KIND.Torch || k === KIND.Chest || k === KIND.Barrel || k === KIND.Mimic || isHazardKind(k) || isProjectileKind(k));

/** The frozen figure's cool tint (multiplies), as in the 2D view. */
const FROZEN_TINT = 0xa8d8ff;

/**
 * The tint of a model figure: the pose's multiply tint. A fill (the hurt flash, a silhouette) and the wind-up's red flash are not
 * carried over (the model shows hits and wind-ups by moving), so a wind-up wears the figure's own tint; frozen adds a cool one.
 * Whatever else `figurePose` chose (poison, slowed, the dark of a fall) is passed on as it is; nothing is added for minions.
 */
function modelTint(pose: Pose, d: FigureDef, s: ViewState): [number, number, number] {
  // The hurt flash is a fill: the tint the pose chose without it is worn instead (a silhouette's fill stays a fill and is dropped as before).
  const chosen = pose.tint.mode === 'fill' && pose.tintUnhurt.mode === 'mul' ? pose.tintUnhurt : pose.tint;
  let rgb = chosen.mode === 'mul' ? chosen.rgb : 0xffffff;
  const fx = s.effects ?? 0, iced = has(fx, EFFECT.Frozen);
  // The red flash is only shown by `figurePose` when the figure is neither stone nor ice (pose.ts), so only then is there something to undo.
  if ((s.anim === ANIM.Windup || s.anim === ANIM.Slam) && !s.fall && !s.drown && !has(fx, EFFECT.Petrified) && !iced) rgb = d.tint ?? 0xffffff;
  const t = rgbOf(rgb);
  if (iced) { const f = rgbOf(FROZEN_TINT); t[0] *= f[0]; t[1] *= f[1]; t[2] *= f[2]; }
  return t;
}

const silhouettes = new WeakMap<FigureModel, number>();
/**
 * The radius batching needs (tiles): the screen circle is centred `radius` above the foot, so it encloses the whole figure when it is
 * at least half the figure's height, add-ons (hat, horns) included, and at least the model's reach from its axis. The top of the
 * geometry is found once per model (`baseHeight` leaves the add-ons out).
 */
function silhouetteRadius(m: FigureModel): number {
  let r = silhouettes.get(m);
  if (r === undefined) {
    let top = 0;
    for (let i = 1; i < m.position.length; i += 3) top = Math.max(top, m.position[i]);
    r = Math.max(m.radius, (top * m.scale) / TILE / 2);
    silhouettes.set(m, r);
  }
  return r;
}

export class Figures3d {
  /** Figures drawn last frame. */
  count = 0;
  /** The overlay anchors of the last frame, by entity id (rebuilt every frame): figures, chests, barrels and mimics. */
  readonly anchors = new Map<number, FigureAnchor>();
  private readonly states: FigureStates;
  private readonly figs = new Map<number, Fig>();
  private images: Image[] = [];
  private modelImages: ModelImage[] = [];
  /** The `DrawnFig` objects, reused every frame, and how many this frame used. */
  private readonly figPool: DrawnFig[] = [];
  private figUsed = 0;
  /** The mouth and nostril vectors of the listed figures, by slot (reused). */
  private readonly mouthPool: MV3[] = [];
  private readonly nostrilPool: MV3[] = [];
  private models: FigureLook['models'] | null = null;
  private skulls: Skull[] = [];
  private coins: Coin[] = [];
  private readonly mimics = new Map<number, MimicMem>();
  /** The clock of the last frame (`f.now`), which stamps the events; null before the first frame, so an early event starts on that frame (#319). */
  private now: number | null = null;
  private cam: Cam | null = null;
  /** This frame's look: the entities the server marks dark, whether they fade (else keep their shape), by how much, and whether a torch has a glow quad. */
  private dark: ReadonlySet<number> = new Set();
  private darkFade = false;
  private fadeAlpha = 1;
  private torchGlow = true;
  private oval = 1;
  /** The height of what stands at a spot: the ground cover's top (#330) plus the bed of a dip. */
  private ground: (x: number, z: number, r: number) => number = (x, z) => this.bedAt(x, z);
  private readonly myKind: number;
  private readonly players: RunViewInit['info']['players'];
  private readonly map: TileMap;
  /** The descents (falls into a chasm, drownings) of the entities and the fallers that outlived theirs (#324). */
  private readonly descents = new Descents<FallParts>();
  /** The motion of every figure and barrel drawn, and the pieces a falling one was drawn from last frame (by id). */
  private readonly motions = new Map<number, Motion>();
  private readonly parts = new Map<number, FallParts>();
  /** The falls that began this frame (the output's). */
  private falls: FigureOut['falls'] = [];
  /** The things falling this frame: entities and the fallers that outlived theirs. */
  fallers = 0;

  constructor(init: RunViewInit, private readonly frames: FrameRects, private readonly bounds: (frame: string) => FrameBounds) {
    this.states = new FigureStates(init.map);
    this.map = init.map;
    this.myKind = init.myKind;
    this.players = init.info.players;
  }

  /** The bed of the ground at a spot (tiles): 0 on the floor, down in a dip. */
  private bedAt(x: number, z: number): number {
    return bedAt(this.map, x, z);
  }

  /** Sink, Invisible and Died bookkeeping; a Died adds a skull unless the figure was lost to a chasm or the deep, or comes apart (Ghost, Shade) or is a shot. */
  event(ev: PictureEv): boolean {
    if (ev.t === 'Coins') {
      // Like `fx.coins`: min(10, 3 + v / 4) coins, aimed up the screen within +-0.8 rad, 50..90 px/s, living 0.7..1 s.
      const n = Math.min(10, 3 + Math.floor(ev.v / 4));
      const bed = this.bedAt(ev.x / TILE, ev.y / TILE);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const s = 50 + Math.random() * 40;
        this.coins.push({ x: ev.x / TILE, z: ev.y / TILE, bed, vx: Math.cos(a) * s, vy: -Math.sin(a) * s, life: 0.7 + Math.random() * 0.3, born: null, frame: `coin_anim_f${i % 4}` });
      }
      if (this.coins.length > COIN_CAP) this.coins.splice(0, this.coins.length - COIN_CAP);
      return false;
    }
    const lost = this.states.event(ev, this.now);
    // A debug climb-out: the figure is back on safe ground, its fall (and a faller that outlived it) ends.
    if (ev.t === 'Sink' && ev.how === 2) { this.descents.end(ev.id); this.parts.delete(ev.id); }
    if (ev.t !== 'Died') return false;
    if (lost === 'lost') return true;
    if (ev.kind === KIND.Shade) {
      // The Shade's body fades out over 0.3 s as its veil (the effects') drifts apart (2D `Effects.shadeDeath`).
      const fig = this.figs.get(ev.id);
      if (fig?.model && fig.last) this.modelImages.push({ insts: this.copied(fig.last.map((i) => ({ ...i, alpha: i.alpha * 0.75 }))), secs: SHADE_FADE, left: SHADE_FADE });
      else if (fig?.body) this.images.push({ card: { ...fig.body }, alpha0: 0.75, secs: SHADE_FADE, left: SHADE_FADE });
      return false;
    }
    if (ev.kind === KIND.Ghost || isProjectileKind(ev.kind)) return false;
    const fig = this.figs.get(ev.id);
    this.skulls.push({ x: ev.x / TILE, z: ev.y / TILE, flip: Math.random() < 0.5, model: !!fig?.model });
    if (this.skulls.length > SKULL_CAP) this.skulls.shift();
    return false;
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
    this.oval = look.oval;
    const cover = look.ground ?? (() => 0);
    this.ground = (x, z, r) => cover(x, z, r) + this.bedAt(x, z);
    this.models = look.models ?? null;
    const out: FigureOut = { cards: newCardBuf(), ghosts: newCardBuf(), decals: newCardBuf(), shadows: newShadowBuf(), glows: newGlowBuf(), emissive: newCardBuf(), openers: [], casters: [], floats: [], models: [], figs: [], cues: [], falls: [] };
    this.falls = out.falls;
    this.figUsed = 0;
    const seen = new Set<number>();
    this.anchors.clear();
    let drawn = 0;
    // The skulls first: the floor decals draw in buffer order without depth writes, so a figure sleeping on a skull's spot covers it (2D: the skull is under every figure).
    this.drawSkulls(cam, out);
    for (const e of f.ents.values()) {
      seen.add(e.id);
      if (isFigureKind(e.kind)) { if (this.figure(e, f, cam, out)) drawn++; }
      else if (e.kind === KIND.Torch) this.drawTorch(e, f.now, cam, out);
      else if (e.kind === KIND.Chest) this.drawChest(e, cam, out);
      else if (e.kind === KIND.Barrel) this.drawBarrel(e, f, cam, out);
      else if (e.kind === KIND.Mimic) this.drawMimic(e, f, cam, out);
    }
    for (const id of this.mimics.keys()) if (!seen.has(id)) this.mimics.delete(id);
    // The own figure is always drawn from prediction.
    if (!seen.has(f.you) && f.own.alive) {
      seen.add(f.you);
      if (this.figure(this.states.ownEntity(f, this.myKind), f, cam, out)) drawn++;
    }
    this.count = drawn;
    this.states.prune(f.now);
    for (const [id, fig] of this.figs) {
      if (seen.has(id)) continue;
      // A figure that went invisible leaves its image fading out where it was last drawn.
      const vanished = this.states.takeVanish(id, f.now);
      if (vanished && fig.body) this.images.push({ card: fig.body, alpha0: fig.body.alpha, secs: VANISH_SECS, left: VANISH_SECS });
      else if (vanished && fig.last) this.modelImages.push({ insts: this.copied(fig.last), secs: VANISH_SECS, left: VANISH_SECS });
      this.figs.delete(id);
    }
    // An entity that is gone: a falling one lives on with the pieces it was last drawn from, a drowning one is dropped.
    for (const id of this.descents.ids()) {
      if (seen.has(id)) continue;
      this.descents.detach(id, this.parts.get(id));
      this.parts.delete(id);
    }
    for (const id of this.motions.keys()) if (!seen.has(id)) this.motions.delete(id);

    this.drawFallen(f.dt, cam, out);
    this.fallers = this.descents.falling;
    this.drawImages(f.dt, cam, out);
    this.drawShots(f, cam, out);
    this.drawCoins(f.now, cam, out);
    sortBackToFront(out.ghosts, cam);
    return out;
  }

  /** What the fallen left: a skull decal on the floor, or the skull model where the figure was drawn as a model. */
  private drawSkulls(cam: Cam, out: FigureOut): void {
    let skullPose: Pose3d | null = null;
    for (let si = 0; si < this.skulls.length; si++) {
      const sk = this.skulls[si];
      // 2D puts the token 2 px up the screen from the death spot: 2 / 16 tile away from the camera on the ground.
      const x = sk.x + (Math.sin(cam.yaw) * 2) / TILE;
      const z = sk.z - (Math.cos(cam.yaw) * 2) / TILE;
      // A model figure leaves the skull model instead of the decal (the same pose for all: turned to face the camera, i.e. along the screen's down on the ground).
      const sm = sk.model ? this.models?.kit.get('skull') : null;
      if (sk.model && sm) {
        skullPose ??= restPose(sm, cam.yaw + Math.PI / 2);
        out.models.push({
          // Its own negative owner (no entity has one: no caster slot, no sight), so overlapping skulls batch apart.
          owner: -1 - si, model: 'skull', x, z, lift: this.ground(x, z, 0.3), scale: this.models?.kit.get('skelet')?.scale ?? 1, pose: skullPose, bone: -1, boneScale: 1,
          tint: [1, 1, 1], stone: false, alpha: 1, dark: false, cut: false, sight: { hard: 0, soft: 0 }, radius: silhouetteRadius(sm),
        });
        continue;
      }
      pushFlat(out.decals, { frame: 'skull', x, z, lift: 0, flip: sk.flip, originX: 0.5, footY: 0.5, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 0.85, scenery: true, base: this.ground(x, z, 0.3) }, this.frames, cam);
    }
  }

  /** The torch's foot is the wall's edge: its face plane is the tile line it sits on, and its card hangs `TORCH_OFF` in front. */
  private drawTorch(e: EntState, now: number, cam: Cam, out: FigureOut): void {
    const x = e.x / TILE;
    const z = e.y / TILE;
    const lit = e.anim === 1;
    const ph = e.id * 1.7;
    // side 0 (Face): the south face of the wall cell north of the floor; 1 (West): the east face of the wall west of the floor; 2 (East): the west face of the wall east of it
    const [cx, cz, nx, nz] = e.extra === 0 ? [x, Math.floor(z) + TORCH_OFF, 0, 1] : e.extra === 1 ? [Math.floor(x) + TORCH_OFF, z, 1, 0] : [Math.floor(x) + 1 - TORCH_OFF, z, -1, 0];
    // Only a burning torch is self-lit: one that is out takes the room's light like the wall it hangs on (#325).
    pushWall(out.emissive, torchFrame(lit, now + ph / 8, TORCH_FRAMES), cx, TORCH_MID, cz, nx, nz, e.extra === 2, this.frames, !lit);
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

  private objShadow(id: number, x: number, z: number, scale: number, alpha: number, cam: Cam, out: FigureOut, y = this.bedAt(x, z)): void {
    if (!this.shadowed(id) || !this.ovalOk(x, z, y)) return;
    const foot = snapGround(cam.pitch, cam.yaw, x, z);
    const rx = (OBJ_SHADOW_RX * scale) / TILE;
    pushShadow(out.shadows, cam, foot.x, foot.z, rx, (OBJ_SHADOW_RY * scale) / TILE, alpha * this.oval, this.ground(foot.x, foot.z, rx));
  }

  private drawChest(e: EntState, cam: Cam, out: FigureOut): void {
    const x = e.x / TILE;
    const z = e.y / TILE;
    const [bx, bz] = this.bodyFoot(x, z, cam);
    const bed = this.bedAt(x, z);
    this.body({ frame: chestFrame(e.anim === 1 ? e.animMs / 1000 : -1), x: bx, z: bz, lift: bed, flip: false, originX: 0.5, footY: 1, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 1, scenery: true }, e.id, cam, out);
    this.objShadow(e.id, x, z, 1, OBJ_SHADOW_ALPHA, cam, out, bed);
    this.objectAnchor(e, x, z, bed);
    this.opener(e, false, x, z, bed + CHEST_HEIGHT / 2 / TILE, 'chest', out);
  }

  /**
   * A barrel: the fuse's flash and shake (anim 0 and 1, `barrelPose`); anim 2 is a fall into a chasm and anim 3 a drowning, drawn as a
   * figure's are (a fall starts from the barrel's drawn speed, a drowning sinks onto the bed): the server sends it no Sink and no Died.
   */
  private drawBarrel(e: EntState, f: RunFrame, cam: Cam, out: FigureOut): void {
    const p = barrelPose(e.anim === 2 || e.anim === 3 ? 0 : e.anim, e.animMs);
    const ex = e.x / TILE;
    const ez = e.y / TILE;
    const foot = this.foot(e.id, ex, ez, f.dt, f.now, { skims: false, start: e.anim === 2 ? 'fall' : e.anim === 3 ? 'drown' : null });
    if (foot.started && foot.d?.kind === 'fall' && !this.dark.has(e.id)) this.falls.push({ id: e.id, x: foot.x, z: foot.z });
    const falling = foot.d?.kind === 'fall';
    // The fuse's shake moves the body along screen right.
    const x = foot.x + (Math.cos(cam.yaw) * p.dx) / TILE;
    const z = foot.z + (Math.sin(cam.yaw) * p.dx) / TILE;
    const [bx, bz] = this.bodyFoot(x, z, cam);
    const frame = 'barrel_explosive';
    let kept: FallParts | null = null;
    if (this.frames[frame] && !foot.gone) {
      const card: Card = { frame, x: bx, z: bz, lift: foot.y, flip: false, originX: 0.5, footY: 1, scale: p.scale, tint: p.fill !== null ? rgbOf(p.fill) : [1, 1, 1], mode: p.fill !== null ? 1 : 0, alpha: p.alpha, scenery: true };
      if (falling) {
        kept = { cards: [{ base: card, ox: card.x - foot.x, oz: card.z - foot.z, dl: card.lift - foot.y }], insts: [] };
        const l = this.lit({ ...card, tint: Figures3d.dim(card.tint, depthFade(foot.y)) }, e.id);
        pushCard(l.ghost ? out.ghosts : out.cards, l.card, this.frames, cam, e.id);
      } else this.body(card, e.id, cam, out);
    }
    if (kept) this.parts.set(e.id, kept); else this.parts.delete(e.id);
    if (p.shadow && !foot.d) this.objShadow(e.id, x, z, 1, OBJ_SHADOW_ALPHA, cam, out, foot.y);
    this.objectAnchor(e, foot.x, foot.z, foot.y);
    this.opener(e, !!foot.d, x, z, foot.y + CHEST_HEIGHT / 2 / TILE, 'object', out);
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
    if ((p.wakeCue || p.landCue) && !f.dark.has(e.id)) out.cues.push({ id: e.id, x, z, land: !p.wakeCue });
    const [bx, bz] = this.bodyFoot(x, z, cam);
    const bed = this.bedAt(x, z);
    this.body({
      frame: `chest_mimic_open_anim_f${p.frame}`, x: bx, z: bz, lift: bed + p.lift / TILE, flip: p.flip, originX: 0.5, footY: 1, scale: 1, sx: p.sx, sy: p.sy,
      angle: rad(p.angle), offset: [p.bx, p.by], tint: [1, 1, 1], mode: p.hurtFill ? 1 : 0, alpha: 1, scenery: !!(e.flags & FLAG.HIDING), // a revealed mimic is a creature
    }, e.id, cam, out);
    this.objShadow(e.id, x, z, p.shadowScale, p.shadowAlpha, cam, out, bed);
    this.objectAnchor(e, x, z, bed);
    this.opener(e, false, x, z, bed + CHEST_HEIGHT / 2 / TILE, 'mimic', out);
  }

  /** A chest, a barrel or a mimic: 2D's `CHEST_HEIGHT` for the bar and the use hint. */
  private objectAnchor(e: EntState, x: number, z: number, y: number): void {
    this.anchors.set(e.id, { x, z, y, height: CHEST_HEIGHT, tag: CHEST_HEIGHT + 3, head: CHEST_HEIGHT, cx: 0, alpha: 1, tagShown: false, effects: e.effects });
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
      const rest = c.bed + (this.frames[c.frame]?.h ?? 0) / 2 / TILE;
      pushCard(out.ghosts, {
        frame: c.frame, x: c.x + Math.cos(cam.yaw) * right, z: c.z + Math.sin(cam.yaw) * right, lift: Math.max(rest, c.bed + up), flip: false, originX: 0.5, footY: 0.5, scale: 1,
        tint: [1, 1, 1], mode: 0, alpha: 1 - t / c.life, scenery: true,
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

  /**
   * One figure, as a model when the stage chose it (`look.models.is`), its kind has a description and the model is built; else as
   * cards. A figure that is drawn as cards forgets the model path's last instances (a vanish image would copy stale ones).
   */
  private figure(e: EntState, f: RunFrame, cam: Cam, out: FigureOut): boolean {
    const key = this.models && FIGURES[e.kind] && this.models.is(e) ? modelKeyOf(e.kind) : null;
    const m = key ? this.models!.kit.get(key) : null;
    if (key && m) return this.drawModel(e, f, cam, out, key, m, this.models!.kit);
    const drawn = this.drawFigure(e, f, cam, out);
    const fig = this.figs.get(e.id);
    if (fig) { fig.last = null; fig.model = false; }
    return drawn;
  }

  /** The figure's state and its memory (made on the first frame), with the reappear rule: the lookup both ways of drawing share. */
  private figOf(e: EntState, f: RunFrame, base: FigureDef): { s: ViewState; fig: Fig; foot: Foot } {
    const st = this.states.stateOf(e, f, f.now);
    // The 3D view stands the figure on the bed and lets it fall by itself: the pose gets no sink, fall or drown (#324).
    const s: ViewState = { ...st.s, sink: 0, fall: 0, drown: 0 };
    const flags = st.s.flags ?? 0;
    const skims = skimsTerrain(flags, st.predicted ? f.own.dashing : e.anim === ANIM.Dash) || (flags & FLAG.AIRBORNE) !== 0;
    const foot = this.foot(e.id, st.s.x / TILE, st.s.y / TILE, f.dt, f.now, { skims, start: this.states.sinking(e.id) ? (st.drowning ? 'drown' : 'fall') : null });
    if (foot.started && foot.d?.kind === 'fall' && !this.dark.has(e.id)) this.falls.push({ id: e.id, x: foot.x, z: foot.z });
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
    return { s, fig, foot };
  }

  private readonly bedFn = (x: number, z: number): number => this.bedAt(x, z);

  /**
   * Where a figure or a barrel is drawn and how high its foot is this frame (#324). In a descent: the faller's spot and height (a fall),
   * or `drownY` from the height it began at (a drowning). Else it stands on the bed of the dip under it, floats in lava (`standY`), or
   * is at 0 when it skims the terrain or flies. `o.start` begins a descent on the first frame it is asked for, from the foot's last
   * height and its drawn speed (which are not updated once it is in one). A fall is not stepped on its first frame.
   */
  private foot(id: number, x: number, z: number, dt: number, now: number, o: { skims: boolean; start: 'fall' | 'drown' | null }): Foot {
    let mo = this.motions.get(id);
    if (!mo) this.motions.set(id, (mo = { px: x, pz: z, vx: 0, vz: 0, y: 0, lava: 0 }));
    let d = this.descents.get(id);
    let started = false;
    let start = o.start;
    // Over a chasm's wall without a Sink (yet): a snapshot's interpolation can bring the figure over the rim before the event. It falls.
    let bed = Number.NaN;
    if (!d && !o.skims) {
      bed = this.bedAt(x, z);
      if (!start && bed < FALL_BED) start = 'fall';
    }
    if (!d && start) {
      d = start === 'fall' ? this.descents.startFall(id, x, z, mo.y, mo.vx, mo.vz) : this.descents.startDrown(id, mo.y, now);
      started = true;
    }
    if (d?.kind === 'fall') {
      if (!started && !d.gone) d.gone = !this.descents.advance(d.faller, dt, this.bedFn);
      return { x: d.faller.x, z: d.faller.z, y: d.faller.y, d, started, gone: d.gone };
    }
    if (d) return { x, z, y: drownY(d.y0, this.bedAt(x, z), now - d.t0), d, started, gone: false };
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * 20);
      mo.vx += ((x - mo.px) / dt - mo.vx) * k;
      mo.vz += ((z - mo.pz) / dt - mo.vz) * k;
    }
    mo.px = x;
    mo.pz = z;
    const inLava = !o.skims && this.map.get(Math.floor(x), Math.floor(z)) === TILE_ID.Lava;
    mo.lava = stepLavaSink(mo.lava, inLava, dt);
    mo.y = o.skims ? 0 : standY(bed, inLava || mo.lava > 0.001 ? mo.lava : null);
    return { x, z, y: mo.y, d: undefined, started, gone: false };
  }

  /** Whether the oval under a foot is drawn: the foot stands on the bed (not hovering over a chasm or floating in lava) and is not under a liquid. */
  private ovalOk(x: number, z: number, y: number): boolean {
    return y - this.bedAt(x, z) <= 0.05 && y >= surfaceAt(this.map, x, z);
  }

  /** The tint of a faller: the depth's dark (`depthFade` of its height) on each channel. */
  private static dim(t: readonly [number, number, number], k: number): [number, number, number] {
    return [t[0] * k, t[1] * k, t[2] * k];
  }

  /** The detached fallers of this frame: stepped, then drawn from their pieces as the entity's were (no oval, caster, opener or image). */
  private drawFallen(dt: number, cam: Cam, out: FigureOut): void {
    this.descents.stepDetached(dt, this.bedFn, (id, f, parts) => {
      const k = depthFade(f.y);
      for (const c of parts.cards) {
        const l = this.lit({ ...c.base, x: f.x + c.ox, z: f.z + c.oz, lift: f.y + c.dl, tint: Figures3d.dim(c.base.tint, k) }, id);
        pushCard(l.ghost ? out.ghosts : out.cards, l.card, this.frames, cam, id);
      }
      for (const i of parts.insts) out.models.push({ ...i.base, x: f.x + i.ox, z: f.z + i.oz, lift: f.y + i.dl, tint: Figures3d.dim(i.base.tint, k), sight: { ...i.base.sight } });
    });
  }

  /** Instances with a pose of their own, for an image that outlives the memory's pose (all of a figure's instances share one pose). */
  private copied(insts: readonly FigureInst[]): FigureInst[] {
    const pose = copyPose(insts[0].pose);
    return insts.map((i) => ({ ...i, pose, tint: [...i.tint], sight: { ...i.sight } }));
  }

  /**
   * Draws one figure as 3D model instances (#338): `figurePose` still gives the alpha, sink, drop, visibility, shadow and tint, and
   * `poseFigure` the bones. No card is pushed. The root's hop (`pose.root.y`) is not in `lift`: the instance row adds it itself.
   * False when it is not drawn (dead).
   */
  private drawModel(e: EntState, f: RunFrame, cam: Cam, out: FigureOut, key: string, m: FigureModel, kit: FigureKit): boolean {
    const { s, fig, foot } = this.figOf(e, f, FIGURES[e.kind]);
    const d = fig.def;
    const pose = figurePose(d, { ...s, screenAim: screenAim(cam.yaw, s.aim) }, f.dt, fig.mem, this.bounds);
    fig.body = null;
    fig.last = null;
    fig.model = true;
    if (!pose.visible || foot.gone) return false;
    const p3 = poseFigure(m, d, s, f.dt, (fig.mem3 ??= newPose3dMemory()));

    const { x, z, y } = foot;
    const falling = foot.d?.kind === 'fall';
    const kept: FallParts | null = falling ? { cards: [], insts: [] } : null;
    const sc = pose.scale;
    const dark = this.dark.has(e.id);
    const k = dark && this.darkFade ? this.fadeAlpha : 1;
    const radius = silhouetteRadius(m);
    // The sight reach is the card's: half the opaque width of the body frame the card would show, in tiles.
    const fb = this.bounds(pose.frame);
    const reach = pose.lie ? 0 : ((fb.r - fb.l + 1) * sc) / 2 / TILE;   // a lying card (a decal) carries none
    const tint = modelTint(pose, d, s);
    const insts: FigureInst[] = [];
    const body: FigureInst = {
      // A lying body rests on the ground cover, as the lying card does.
      owner: e.id, model: key, x, z, lift: pose.lie ? this.ground(x, z, 0.3) : y, scale: m.scale, pose: p3, bone: -1, boneScale: 1, tint, stone: pose.grey, alpha: pose.alpha * k, dark,
      cut: false, sight: { hard: 0, soft: 0 }, radius, reach,
    };
    /** Hands an instance to the model layer; a faller's goes out in the depth's dark, and is kept as it was (its offsets from the faller). */
    const push = (i: FigureInst): void => {
      kept?.insts.push({ base: i, ox: i.x - x, oz: i.z - z, dl: i.lift - y });
      out.models.push(falling ? { ...i, tint: Figures3d.dim(i.tint, depthFade(y)) } : i);
    };
    {
      push(body);
      insts.push(body);
      const wp = pose.weapon;
      if (wp && !pose.lie) {
        // The kit logs a weapon it cannot make (once) and gives nothing until the model is built; the figure goes without it.
        const wm = kit.get(wp.frame);
        if (wm) {
          const bone = BONES.indexOf(BOW_WEAPONS.has(wp.frame) ? 'weaponL' : 'weaponR');
          // The instance is scaled by `m.scale` (the hand's place follows the fitted body); the weapon's own size is what the card path
          // draws (the game's weapon scale times the figure's `FigureDef.scale`), shrunk with the figure by its
          // `size`, so `boneScale` makes up the difference.
          const bs = (wp.scale * (d.scale ?? 1) * m.size) / m.scale;
          const w: FigureInst = {
            owner: e.id, model: wp.frame, x, z, lift: y, scale: m.scale, pose: p3, bone, boneScale: bs, pivot: [m.pivots[bone * 3], m.pivots[bone * 3 + 1], m.pivots[bone * 3 + 2]],
            tint: pose.weaponTint !== null ? rgbOf(pose.weaponTint) : [1, 1, 1], stone: pose.grey, alpha: wp.alpha * pose.alpha * k, dark, cut: false, sight: { hard: 0, soft: 0 }, radius, reach,
          };
          // A raised weapon can reach past the body's circle: the figure's circle grows by the weapon's own size.
          body.radius = w.radius = radius + wm.radius * bs * m.scale;
          if (has(s.effects ?? 0, EFFECT.Frozen)) { const t = rgbOf(FROZEN_TINT); w.tint[0] *= t[0]; w.tint[1] *= t[1]; w.tint[2] *= t[2]; }
          push(w);
          insts.push(w);
        }
      }
      // The shadow caster: the box of the standing idle card at the foot (no card is pushed); a faller casts none.
      if (pose.alpha >= 1 && !pose.lie && this.shadowed(e.id) && !falling) {
        const cf = `${d.idle}0`, cb = this.bounds(cf), fy = d.footY ?? cb.h;
        // Scaled by the model's `size` from the foot, so the box fits the smaller figure.
        const card: Card = { frame: cf, x, z, lift: y, flip: pose.left, originX: pose.originX, footY: fy / cb.h, scale: sc * m.size, tint: [1, 1, 1], mode: 0, alpha: 1 };
        const c = casterOf(card, e.id, this.frames, cam);
        if (c) out.casters.push(c);
      }
      fig.last = insts;
      if (pose.afterimage && !falling) this.modelImages.push({ insts: this.copied([{ ...body, tint: rgbOf(d.base), stone: false, alpha: AFTER_ALPHA * k }]), secs: AFTER_SECS, left: AFTER_SECS });
      if (this.accelDue(fig, s, f.dt) && !falling) this.modelImages.push({ insts: this.copied([{ ...body, tint: rgbOf(ACCEL_TINT), stone: false, alpha: ACCEL_ALPHA * pose.alpha * k }]), secs: ACCEL_SECS, left: ACCEL_SECS });
    }
    if (kept) {
      // The pose is shared by the instances and mutated by the memory: a copy outlives the entity.
      const frozen = copyPose(p3);
      for (const i of kept.insts) i.base = { ...i.base, pose: frozen, sight: { ...i.base.sight } };
      this.parts.set(e.id, kept);
    } else this.parts.delete(e.id);

    if (pose.shadow.visible && this.shadowed(e.id) && !foot.d && this.ovalOk(x, z, y)) {
      const gf = snapGround(cam.pitch, cam.yaw, x, z);
      const r = (d.baseR * sc * m.size) / TILE;
      // A hop shrinks the oval by how high the figure is; a lying figure's oval is stretched (the pose's own numbers).
      const hop = 1 - 0.35 * p3.air;
      const rx = r * (pose.lie ? pose.shadow.sx : hop);
      pushShadow(out.shadows, cam, gf.x, gf.z, rx, r * SHADOW_DEPTH * (pose.lie ? pose.shadow.sy : hop), SHADOW_ALPHA * pose.alpha * this.oval, this.ground(gf.x, gf.z, rx));
    }

    // The anchors are the card's numbers times the model's `size`, from the standing idle frame the model replaces (`standingAnchor`, the
    // card path's own): the bar and the name sit just above the smaller model. Lying, only `head` changes (the body's thickness on the floor); the bar and the name stay at the standing height.
    const idle = `${d.idle}0`, ib = this.bounds(idle), footY = d.footY ?? ib.h;
    const sa = standingAnchor(ib, footY, (d.scale ?? 1) * m.size);   // the smaller model's: the bar sits just above it
    this.anchors.set(e.id, { x, z, y, height: sa.height, tag: sa.tag, head: pose.lie ? Math.min(sa.head, (2 - LIE_SINK) * sideReach(m) * m.scale) : sa.head, cx: 0, alpha: pose.alpha, tagShown: !foot.d && !this.states.sinking(e.id), effects: s.effects ?? 0 });
    // The swoosh lies at the shoulder; a bite (an armless model's attack) has its fangs before the muzzle.
    const stretch = 1 / Math.cos(cam.pitch), shoulder = (m.shoulderY * m.scale) / TILE;
    const bite = m.armLength > 0 ? -1 : p3.attack?.style === 'bite' ? p3.attack.u : s.anim === ANIM.Windup ? BITE_HELD : -1;
    const lf = this.listFig(out, cam, e, s, d, x, z, pose.lie ? 3 : sa.height, pose.alpha * k, true, p3.yaw, (shoulder + y) * stretch, bite);
    if (bite >= 0) this.muzzle(lf, cam, p3.yaw, (0.8 * shoulder + y) * stretch, m.baseHeight / TILE + m.radius);
    const standing = Math.max(0, (footY - ib.t) * m.size) * sc;   // as the card path's `height`: the smaller model's opaque height, times the pose scale
    this.opener(e, !!foot.d || this.states.sinking(e.id), x, z, y + (pose.lie ? 0.15 : standing / 2 / TILE), isPlayerKind(e.kind) ? 'hero' : e.side === SIDE.Hostile ? 'enemy' : 'friend', out);
    return true;
  }

  /**
   * What an attack or a channel adds round a model figure (#338): the swoosh of a melee swing at the shoulder, the wolf's fangs in front
   * of its muzzle, the channel's swirl. A stone or frozen figure holds its pose and shows none. The sleeper's Z is the overlay's
   * (`overlayLayout`), from the anchor's effects.
   */
  private listFig(out: FigureOut, cam: Cam, e: EntState, s: ViewState, d: FigureDef, x: number, z: number, height: number, alpha: number, model: boolean, yaw: number, handY: number, bite: number): DrawnFig {
    // The camera passes stretch the figure by 1 / cos(pitch) (nodes.ts): so is the top.
    const top = height / TILE / Math.cos(cam.pitch);
    const f = (this.figPool[this.figUsed] ??= { id: 0, kind: 0, x: 0, z: 0, top: 0, hand: [0, 0, 0], aim: 0, anim: 0, animT: 0, effects: 0, alpha: 1, model: false, side: 0, def: d, yaw: 0, swingY: 0, arc: 0, bite: -1 });
    this.figUsed++;
    f.id = e.id; f.kind = e.kind; f.x = x; f.z = z; f.top = top;
    // The weapon hand (the model's shoulder, the card's hand height): a hand's reach in front of the body, along its facing.
    const h = f.hand as MV3, reach = model ? 0.3 : 10 / TILE;
    h[0] = x + Math.cos(yaw) * reach; h[1] = handY; h[2] = z + Math.sin(yaw) * reach;
    f.aim = s.aim; f.anim = s.anim; f.animT = s.animT; f.effects = s.effects ?? 0; f.alpha = alpha; f.model = model; f.side = e.side; f.def = d;
    f.yaw = yaw; f.swingY = handY; f.arc = s.swingArc ?? d.swing?.arc ?? 0; f.bite = bite;
    f.mouth = undefined; f.nostril = undefined;
    out.figs.push(f);
    return f;
  }

  /** Sets the mouth or nostril of the figure just listed to a point in the pooled vectors of its slot. */
  private point(pool: MV3[], x: number, y: number, z: number): MV3 {
    const v = (pool[this.figUsed - 1] ??= [0, 0, 0]);
    v[0] = x; v[1] = y; v[2] = z;
    return v;
  }

  /** A biter's fangs hang in front of its muzzle, lifted along the view ray (the view is orthographic: the picture does not change) past everything of the figure, so its own head does not hide them. */
  private muzzle(f: DrawnFig, cam: Cam, yaw: number, y: number, lift: number): void {
    const ahead = BITE_AHEAD / TILE, ray = viewRay(cam.pitch, cam.yaw), l = ahead + lift;
    f.mouth = this.point(this.mouthPool, f.x + Math.cos(yaw) * ahead + ray[0] * l, y + ray[1] * l, f.z + Math.sin(yaw) * ahead + ray[2] * l);
  }

  /** True when an Accelerated figure is due its next golden afterimage (a stone, frozen or sleeping one holds still and leaves none). */
  private accelDue(fig: Fig, s: ViewState, dt: number): boolean {
    const fx = s.effects ?? 0;
    if (!has(fx, EFFECT.Accelerated) || has(fx, EFFECT.Petrified) || has(fx, EFFECT.Frozen) || has(fx, EFFECT.Sleep)) { fig.accelT = 0; return false; }
    fig.accelT = (fig.accelT ?? 0) - dt;
    if (fig.accelT > 0) return false;
    fig.accelT = ACCEL_EVERY;
    return true;
  }

  /** Draws one figure; false when it is not drawn (dead). */
  private drawFigure(e: EntState, f: RunFrame, cam: Cam, out: FigureOut): boolean {
    const base = FIGURES[e.kind];
    if (!base) return false;
    const { s, fig, foot } = this.figOf(e, f, base);
    const d = fig.def;
    const pose = figurePose(d, { ...s, screenAim: screenAim(cam.yaw, s.aim) }, f.dt, fig.mem, this.bounds);
    fig.body = null;
    if (!pose.visible || foot.gone) return false;

    const fb = this.bounds(pose.frame);
    const { x, z, y } = foot;
    const falling = foot.d?.kind === 'fall';
    // A faller's pieces, kept for when its entity is gone; its cards wear the depth's dark.
    const kept: FallParts | null = falling ? { cards: [], insts: [] } : null;
    const fade = falling ? depthFade(y) : 1;
    const sc = pose.scale;
    const { tint, mode } = lookOf(pose.tint, pose.grey);
    // A frozen body wears the cool tint, as the model does (a fill, the hurt flash, stays).
    const iced = has(s.effects ?? 0, EFFECT.Frozen);
    if (iced && mode !== 1) { const t = rgbOf(FROZEN_TINT); tint[0] *= t[0]; tint[1] *= t[1]; tint[2] *= t[2]; }
    // The sight mask's wide-figure rule (`footSight`): half the body frame's opaque width, in tiles, on the body and its weapon.
    const reach = ((fb.r - fb.l + 1) * sc) / 2 / TILE;
    /** The weapon card is owned by its wielder (it is not shadowed by the wielder), but casts nothing of its own. A faller's cards are kept as they were (before the depth's dark). */
    const into = (c: Card): void => {
      kept?.cards.push({ base: c, ox: c.x - x, oz: c.z - z, dl: c.lift - y });
      const l = this.lit(falling ? { ...c, tint: Figures3d.dim(c.tint, fade) } : c, e.id);
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
        scale: sc, sx: lie.squash, sy: 1, offset: headRight ? [lie.y, -lie.x] : [-lie.y, lie.x], tint, mode, alpha: dark && this.darkFade ? pose.alpha * this.fadeAlpha : pose.alpha, headRight, dark, base: this.ground(x, z, 0.3),
      }, this.frames, cam);
    } else {
      // The 2D body sits 1 px below the shadow (body.y 1). A card lowered into the floor would lose its foot row, so the
      // foot moves 1 / 16 tile toward the camera on the ground instead (screen down is (-sin yaw, cos yaw)).
      // `aimStep` is 2D's screen step: the melee step is (3, 1.5) along the aim (y halved for the foreshortening) but the
      // wolf's lunge is not, so the factor is not uniform and it is applied here as it is.
      const body: Card = {
        frame: pose.frame, x: x + (pose.aimStep.x * sc - Math.sin(cam.yaw) * sc) / TILE, z: z + (pose.aimStep.y * sc + Math.cos(cam.yaw) * sc) / TILE, lift: y, flip: pose.left, originX: pose.originX, footY: pose.footY / fb.h,
        scale: sc, sx: pose.body.sx, sy: pose.body.sy, angle: rad(pose.body.angle), offset: [pose.body.x, pose.body.y - 1], tint, mode, alpha: pose.alpha, reach,
      };
      {
        into(body);
        if (body.alpha >= 1 && this.shadowed(e.id) && !falling) {
          const k = casterOf(body, e.id, this.frames, cam);
          if (k) out.casters.push(k);
        }
        // The stored card is the lit one: a vanish image inherits `dark` and the faded alpha (`framePoint` reads geometry only).
        const l = this.lit(body, e.id);
        fig.body = l.card;
        if (pose.afterimage && !falling) {
          const k = this.dark.has(e.id) && this.darkFade ? this.fadeAlpha : 1;
          this.images.push({ card: { ...l.card, tint: rgbOf(d.base), mode: 0 }, alpha0: AFTER_ALPHA * k, secs: AFTER_SECS, left: AFTER_SECS });
        }
        if (this.accelDue(fig, s, f.dt) && !falling) {
          const k = this.dark.has(e.id) && this.darkFade ? this.fadeAlpha : 1;
          this.images.push({ card: { ...l.card, tint: rgbOf(ACCEL_TINT), mode: 0 }, alpha0: ACCEL_ALPHA * pose.alpha * k, secs: ACCEL_SECS, left: ACCEL_SECS });
        }
      }
    }

    const wp = pose.weapon;
    if (wp && !pose.lie) {
      // The weapon is a child of the figure in 2D: its offset is in figure px (scaled by the figure), not moved by the body's step.
      const wsc = wp.scale * sc;
      const wt = pose.weaponTint !== null ? rgbOf(pose.weaponTint) : ([1, 1, 1] as [number, number, number]);
      if (iced) { const t = rgbOf(FROZEN_TINT); wt[0] *= t[0]; wt[1] *= t[1]; wt[2] *= t[2]; }
      into({
        frame: wp.frame, x, z, lift: y, flip: wp.flipX, originX: wp.originX, footY: wp.originY, scale: wsc, angle: wp.rot, offset: [wp.x / wp.scale, wp.y / wp.scale],
        tint: wt, mode: pose.grey ? 2 : 0, alpha: wp.alpha * pose.alpha, bias: wp.behind ? -WEAPON_BIAS : WEAPON_BIAS, reach,
      });
    }

    if (pose.shadow.visible && this.shadowed(e.id) && !foot.d && this.ovalOk(x, z, y)) {
      const gf = snapGround(cam.pitch, cam.yaw, x, z);
      const r = (d.baseR * sc) / TILE;
      const rx = r * pose.shadow.sx;
      pushShadow(out.shadows, cam, gf.x, gf.z, rx, r * SHADOW_DEPTH * pose.shadow.sy, SHADOW_ALPHA * pose.alpha * this.oval, this.ground(gf.x, gf.z, rx));
    }

    // The overlay anchor: the entity's own spot (the predicted one for the own hero), 2D's numbers (EntityView): the unscaled-by-pose `d.scale`.
    const ds = d.scale ?? 1;
    const mid = pose.left ? fb.w - 1 - (fb.l + fb.r) / 2 : (fb.l + fb.r) / 2;
    const sa = standingAnchor(fb, pose.footY, ds);
    this.anchors.set(e.id, {
      x, z, y, height: sa.height, tag: sa.tag,
      head: pose.lie ? (fb.r - fb.l + 1) * ds : sa.head,
      cx: pose.lie ? 0 : (mid + 0.5 - pose.originX * fb.w) * ds,
      alpha: pose.alpha, tagShown: !foot.d && !this.states.sinking(e.id), effects: s.effects ?? 0,
    });

    // The hand's height is the card's; the wolf bites with fangs (as its model does); the dragon's mouth and nostrils are points of its frame.
    const stretch = 1 / Math.cos(cam.pitch), wolf = e.kind === KIND.DireWolf;
    const bite = !wolf ? -1 : s.anim === ANIM.Windup ? BITE_HELD : s.anim === ANIM.Melee ? BITE_HELD + (1 - BITE_HELD) * (s.animT / BITE_SECS) : -1;
    const lf = this.listFig(out, cam, e, s, d, x, z, pose.lie ? 3 : sa.height, pose.alpha, false, s.aim, (d.handY * ds * stretch) / TILE, bite);
    if (bite >= 0) this.muzzle(lf, cam, s.aim, lf.top * 0.55, 0.4);
    if (d.mouth && !pose.lie) {
      const mp = this.framePoint(e.id, d.mouth), np = this.framePoint(e.id, d.nostrils);
      if (mp) lf.mouth = this.point(this.mouthPool, mp.x, mp.y * stretch, mp.z);
      if (np) lf.nostril = this.point(this.nostrilPool, np.x, np.y * stretch, np.z);
    }
    if (kept) this.parts.set(e.id, kept); else this.parts.delete(e.id);
    const height = Math.max(0, pose.footY - fb.t) * sc;
    // Falling or drowning stops it opening walls; wading does not.
    this.opener(e, !!foot.d || this.states.sinking(e.id), x, z, y + (pose.lie ? 0.15 : height / 2 / TILE), isPlayerKind(e.kind) ? 'hero' : e.side === SIDE.Hostile ? 'enemy' : 'friend', out);
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
    const keepModels: ModelImage[] = [];
    for (const im of this.modelImages) {
      const k = im.left / im.secs;
      for (const i of im.insts) out.models.push({ ...i, alpha: i.alpha * k });
      im.left -= dt;
      if (im.left > 0) keepModels.push(im);
    }
    this.modelImages = keepModels;
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
    }
    // glowing shots are drawn by the effects system (`fx/shots.ts`)
  }
}
