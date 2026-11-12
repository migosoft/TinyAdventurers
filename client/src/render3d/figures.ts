// Every figure and every shot of a real run as cards (#303): the Phaser-free twin of EntityView and the projectile part of
// PhaserRunView. The look of a figure is `figurePose` (game/anim/pose.ts), shared with the 2D view; this file turns the pose
// into cards in the 3D view's passes (render3d/cards.ts). Walls, props and the objects (torches, chests, barrels, mimics,
// hazards) are not figures and not drawn here.
import { ANIM, KIND, SIDE } from '../generated/defs';
import { FIGURES, heroWeapons, isHazardKind, isPlayerKind, isProjectileKind, PROJECTILES, type FigureDef, type FramePoints } from '../game/anim/defs';
import { VANISH_SECS } from '../game/anim/entityAlpha';
import { FigureStates } from '../game/anim/figureState';
import { figurePose, newPoseMemory, type FrameBounds, type PoseMemory, type Tint } from '../game/anim/pose';
import type { EntState } from '../game/world';
import type { PictureEv, RunFrame, RunViewInit, ShotView } from '../run/view';
import { snapGround, type Cam } from './camera';
import { newCardBuf, newGlowBuf, newShadowBuf, pushCard, pushGlow, pushLying, pushShadow, sortBackToFront, WEAPON_BIAS, type Card, type CardBuf, type GlowBuf, type ShadowBuf } from './cards';
import type { FrameRects } from './worldMesh';

const TILE = 16;
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The 2D ground shadow: an ellipse 0.45 as deep as it is wide, 0.45 strong at the centre. */
const SHADOW_DEPTH = 0.45;
const SHADOW_ALPHA = 0.45;
/** A dash afterimage lives this long (s) and starts at half alpha. */
const AFTER_SECS = 0.25;
const AFTER_ALPHA = 0.5;
/** Height (tiles) of a shot above the ground: 2D draws them 8 px up. */
const SHOT_LIFT = 0.5;
/** Skull tokens kept (the oldest go first). */
const SKULL_CAP = 256;

/**
 * The aim as it appears on screen (rad, y down). The camera's right vector is (cos yaw, sin yaw) and its ground-down vector
 * (-sin yaw, cos yaw) (`project`); the world direction (cos a, sin a) is screen right by cos(a - yaw) and down by sin(a - yaw),
 * so the screen angle is a - yaw: yaw 0 leaves the aim as it is, and at yaw 90 degrees an aim along +x runs up the screen.
 */
export function screenAim(yaw: number, aim: number): number {
  return aim - yaw;
}

/** Something that may open walls this frame (#303 Task 7): its foot in tiles, its middle height in tiles, and why. */
export interface Opener { id: number; x: number; z: number; mid: number; who: 'hero' | 'enemy' | 'friend' | 'chest' | 'mimic' | 'neutral' | 'object' }

export interface FigureOut {
  cards: CardBuf; ghosts: CardBuf; decals: CardBuf; shadows: ShadowBuf; glows: GlowBuf; emissive: CardBuf;
  openers: Opener[];
}

interface Fig {
  mem: PoseMemory;
  def: FigureDef;
  /** The standing body card of the last frame (null while lying, hidden or before the first). */
  body: Card | null;
}

/** An image left behind: a vanished figure fading out, or a dash afterimage. */
interface Image { card: Card; alpha0: number; secs: number; left: number }
interface Skull { x: number; z: number; headRight: boolean }

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
  private readonly states: FigureStates;
  private readonly figs = new Map<number, Fig>();
  private images: Image[] = [];
  private skulls: Skull[] = [];
  private now = 0;
  private cam: Cam | null = null;
  private readonly myKind: number;
  private readonly players: RunViewInit['info']['players'];

  constructor(init: RunViewInit, private readonly frames: FrameRects, private readonly bounds: (frame: string) => FrameBounds) {
    this.states = new FigureStates(init.map);
    this.myKind = init.myKind;
    this.players = init.info.players;
  }

  /** Sink, Invisible and Died bookkeeping; a Died adds a skull unless the figure was lost to a chasm or the deep, or comes apart (Ghost, Shade) or is a shot. */
  event(ev: PictureEv): void {
    const lost = this.states.event(ev, this.now);
    if (ev.t !== 'Died' || lost === 'lost') return;
    if (ev.kind === KIND.Ghost || ev.kind === KIND.Shade || isProjectileKind(ev.kind)) return;
    this.skulls.push({ x: ev.x / TILE, z: ev.y / TILE, headRight: Math.random() < 0.5 });
    if (this.skulls.length > SKULL_CAP) this.skulls.shift();
  }

  /** The 3D view has no picture for a shot's end yet (the sparks are a later task). */
  shotEnded(_shot: ShotView): void {}

  frame(f: RunFrame, cam: Cam): FigureOut {
    this.now = f.now;
    this.cam = cam;
    const out: FigureOut = { cards: newCardBuf(), ghosts: newCardBuf(), decals: newCardBuf(), shadows: newShadowBuf(), glows: newGlowBuf(), emissive: newCardBuf(), openers: [] };
    const seen = new Set<number>();
    let drawn = 0;
    for (const e of f.ents.values()) {
      seen.add(e.id);
      if (isFigureKind(e.kind) && this.drawFigure(e, f, cam, out)) drawn++;
    }
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
      pushLying(out.decals, { frame: 'skull', x: sk.x, z: sk.z, lift: 0, flip: false, originX: 0.5, footY: 0.5, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 0.85, headRight: sk.headRight }, this.frames, cam);
    }
    sortBackToFront(out.ghosts, cam);
    return out;
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
    const into = (c: Card): void => pushCard(c.alpha < 1 ? out.ghosts : out.cards, c, this.frames, cam);

    if (pose.lie) {
      // Asleep: the body lies on the floor. The pose's lie layout is screen px; the lying card's axes are turned a quarter, so the offset is too.
      const lie = pose.lie;
      const headRight = !pose.left;
      pushLying(out.decals, {
        frame: pose.frame, crop: { x: lie.cropX, y: 0, w: lie.cropW, h: pose.footY }, x, z, lift: 0, flip: pose.left, originX: pose.originX, footY: pose.footY / fb.h,
        scale: sc, sx: lie.squash, sy: 1, offset: headRight ? [lie.y, -lie.x] : [-lie.y, lie.x], tint, mode, alpha: pose.alpha, headRight,
      }, this.frames, cam);
    } else {
      // The 2D body sits 1 px below the feet (body.y 1); a card there would lose its foot row under the floor.
      const body: Card = {
        frame: pose.frame, x: x + (pose.aimStep.x * sc) / TILE, z: z + (pose.aimStep.y * sc) / TILE, lift: -down, flip: pose.left, originX: pose.originX, footY: pose.footY / fb.h,
        scale: sc, sx: pose.body.sx, sy: pose.body.sy, angle: rad(pose.body.angle), offset: [pose.body.x, pose.body.y - 1], tint, mode, alpha: pose.alpha,
      };
      if (pose.sink > 0) body.crop = { x: 0, y: 0, w: fb.w, h: pose.footY - pose.sink };
      if (!body.crop || body.crop.h > 0) {
        into(body);
        fig.body = body;
        if (pose.afterimage) this.images.push({ card: { ...body, tint: rgbOf(d.base), mode: 0 }, alpha0: AFTER_ALPHA, secs: AFTER_SECS, left: AFTER_SECS });
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

    if (pose.shadow.visible) {
      const foot = snapGround(cam.pitch, cam.yaw, x, z);
      const r = (d.baseR * sc) / TILE;
      pushShadow(out.shadows, foot.x, foot.z, r * pose.shadow.sx, r * SHADOW_DEPTH * pose.shadow.sy, SHADOW_ALPHA * pose.alpha);
    }

    const height = Math.max(0, pose.footY - fb.t - pose.sink) * sc;
    out.openers.push({ id: e.id, x, z, mid: pose.lie ? 0.15 : height / 2 / TILE, who: isPlayerKind(e.kind) ? 'hero' : e.side === SIDE.Hostile ? 'enemy' : e.side === SIDE.Friendly ? 'friend' : 'neutral' });
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
