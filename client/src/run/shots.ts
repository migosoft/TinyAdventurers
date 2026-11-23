// The own hero's predicted shots (the "cosmetic" copies): spawned when a shot is
// fired, advanced each frame, ended at a wall, an enemy or when the server's shot
// is gone. The server's copy of an own shot stays hidden (`hidden`).
// A view only draws `live` and reacts to `ended`.
import { CONST, ENEMY_KINDS, FLAG, HITBOX, KIND } from '../generated/defs';
import type { EntSnap } from '../generated/EntSnap';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import { isProjectileKind } from '../game/anim/defs';
import { shotPassesThrough } from '../game/shotTargets';
import { cosmeticPierce, ownPredictedShot, unseenShotLimit, type EntState } from '../game/world';
import { lineOfSight } from '../sim/collision';
import { flightTime, shotZ } from '../sim/arc';
import { arcHits, shotHits } from '../sim/hitbox';
import type { TileMap } from '../sim/map';
import type { ShotView } from './view';

export interface Shot extends ShotView {
  // ShotView's position and velocity are readonly for views; the session moves them.
  x: number;
  y: number;
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
  /** When it was fired (s). */
  born: number;
  z: number;
  /** An arcing shot (#321): its flight time (s), the time flown and where it lands. Flat shots have none. */
  flight?: number;
  flown: number;
  land?: [number, number];
}

/** Kind id -> name, to look up `ENEMY_KINDS`. */
const KIND_NAME: Record<number, string> = Object.fromEntries(Object.entries(KIND).map(([name, id]) => [id, name]));
const ENEMY_KIND: Record<string, { max_hp: number; res: Record<string, number> } | undefined> = ENEMY_KINDS;

export class Shots {
  readonly live: Shot[] = [];
  /** The own predicted shots that are on the server this frame (shot ids); filled by `hidden`. */
  private readonly onServer = new Set<number>();
  /** Own shots whose predicted copy has ended (shot id -> time, s): their server copy stays hidden. */
  private endedShots = new Map<number, number>();
  /** The ended own shots that ended `'landed'` (shot ids), kept as long as `endedShots`: the server's `Land` of such a shot adds no second arrow. */
  private landedShots = new Set<number>();
  /**
   * Own shots whose predicted copy was predicted to stop at an enemy (shot id -> the enemy's
   * position, the shot's direction and how far past the enemy's centre a shot has surely
   * passed it). If the server's shot is seen that far past, it is drawn.
   */
  private stoppedShots = new Map<number, { x: number; y: number; dx: number; dy: number; past: number }>();
  private readonly hiddenIds = new Set<number>();

  spawn(kind: number, shot: number, aim: number, a: ResolvedAbility, r: number, life: number, from: { x: number; y: number }, now: number, target?: [number, number], landDist?: number): void {
    const speed = a.speed;
    const x = from.x + Math.cos(aim) * 6;
    const y = from.y + Math.sin(aim) * 6;
    // An arcing shot lands `landDist` px from the shooter, so `landDist - 6` from here; the landing ends it (server `spawn_shot`).
    const flight = landDist === undefined ? undefined : flightTime(landDist - 6, speed);
    if (flight !== undefined) life = flight + CONST.DT;
    this.live.push({
      shot,
      kind,
      x,
      y,
      z: CONST.SHOT_HEIGHT,
      flight,
      flown: 0,
      land: landDist === undefined ? undefined : [x + Math.cos(aim) * (landDist - 6), y + Math.sin(aim) * (landDist - 6)],
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
      born: now,
    });
  }

  /**
   * Which server projectiles the view does not draw this frame, and which own predicted shots are on the server.
   * Our own projectiles are shown by the predicted copy, also once it has ended; but a shot predicted to stop at
   * an enemy that the server's shot flew on past after all is drawn from there on. Run before `update`.
   */
  hidden(ents: ReadonlyMap<number, EntState>, latest: Map<number, EntSnap> | undefined, you: number): Set<number> {
    const hidden = this.hiddenIds;
    hidden.clear();
    this.onServer.clear();
    for (const e of ents.values()) {
      if (!isProjectileKind(e.kind)) continue;
      const shot = e.extra & 0xffff;
      // Only shots the client predicted: the AI's shots of a charmed hero (ids from 0xF000) are the server's.
      const ownShot = ownPredictedShot(e.extra, you) !== null;
      if (ownShot) this.onServer.add(shot);
      const stop = ownShot ? this.stoppedShots.get(shot) : undefined;
      // Predicted to stop, but the server's shot flew on past the enemy: show it from here on.
      // Both the position it is drawn at (interpolated, so it reappears past the enemy, never before it)
      // and its newest snapshot position (so an extrapolated overshoot of a shot that did stop never shows) must be past.
      const past = (x: number, y: number) => stop !== undefined && (x - stop.x) * stop.dx + (y - stop.y) * stop.dy > stop.past;
      const raw = stop && latest?.get(e.id);
      if (raw && past(raw[2], raw[3]) && past(e.x, e.y)) {
        this.stoppedShots.delete(shot);
        this.endedShots.delete(shot);
      }
      if (ownShot && (this.endedShots.has(shot) || this.live.some((c) => c.shot === shot))) hidden.add(e.id);
    }
    return hidden;
  }

  /** Whether the server projectile with this `extra` is an own predicted shot whose predicted copy already landed (its `Land` is then a duplicate). */
  ownLanded(extra: number, you: number): boolean {
    const shot = ownPredictedShot(extra, you);
    return shot !== null && this.landedShots.has(shot);
  }

  /** Advances the shots;`ended` is called for each that ends, with how. */
  update(
    dt: number,
    now: number,
    // `rtt` in milliseconds, `interpDelay` in seconds (as `Net.rtt` and `Interpolator.delay`; `unseenShotLimit` expects them so).
    ctx: { map: TileMap; ents: ReadonlyMap<number, EntState>; rtt: number; interpDelay: number },
    ended: (s: Shot, how: 'wall' | 'enemy' | 'gone' | 'landed') => void,
  ): void {
    for (const [shot, t] of this.endedShots) {
      if (now - t <= 2) continue;
      this.endedShots.delete(shot);
      this.landedShots.delete(shot);
      this.stoppedShots.delete(shot);
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      const onServer = this.onServer.has(c.shot);
      if (onServer) c.seenOnServer = true;
      c.life -= dt;
      let nx = c.x + c.vx * dt;
      let ny = c.y + c.vy * dt;
      const nflown = c.flown + dt;
      // The landing step ends at the landing point, not past it.
      const landing = c.flight !== undefined && c.land !== undefined && nflown >= c.flight - 1e-9;
      if (landing) [nx, ny] = c.land!;
      const reachedTarget = c.target && (c.target[0] - nx) * c.vx + (c.target[1] - ny) * c.vy <= 0;
      const hitWall = !lineOfSight(ctx.map, c.x, c.y, nx, ny) || ctx.map.opaqueAt(nx, ny);
      // The server projectile hit something: ours ends too.
      const goneOnServer = c.seenOnServer && !onServer;
      // Predicted to pass an enemy, but the server's shot never showed up: it ended there (or soon after).
      const neverSeen = !c.seenOnServer && c.hit.size > 0 && now - c.born > unseenShotLimit(ctx.rtt, ctx.interpDelay);
      // Shots stop at the first enemy they touch unless they are predicted to pierce it
      // (the server decides the damage), checked every 4 px like there.
      const touched = hitWall ? null : this.touchesEnemy(c, nx, ny, nflown, ctx.ents);
      const hitEnemy = touched !== null && !this.passes(c, touched);
      if (c.life <= 0 || landing || hitWall || goneOnServer || neverSeen || reachedTarget || hitEnemy) {
        // The view draws a spark at a wall; a wrongly predicted pass needs none of its own: the server's `Dmg` draws one at that enemy.
        if (landing && !hitWall && !hitEnemy) {
          c.x = nx;
          c.y = ny;
          c.z = 0;
        }
        ended(c, hitWall ? 'wall' : hitEnemy ? 'enemy' : landing ? 'landed' : 'gone');
        this.live.splice(i, 1);
        this.endedShots.set(c.shot, now);
        if (landing && !hitWall && !hitEnemy) this.landedShots.add(c.shot);
        else this.landedShots.delete(c.shot);
        // Predicted to stop: if the server's shot flies on past this enemy after all, it is drawn
        // (`hidden`).
        if (hitEnemy) {
          const v = Math.hypot(c.vx, c.vy) || 1;
          this.stoppedShots.set(c.shot, { x: touched.x, y: touched.y, dx: c.vx / v, dy: c.vy / v, past: (HITBOX[touched.kind]?.r ?? 6) + c.r });
        }
        continue;
      }
      c.x = nx;
      c.y = ny;
      c.flown = nflown;
      if (c.flight !== undefined) c.z = shotZ(c.flight, nflown);
    }
  }

  /** The first thing the shot touches on its way to (nx, ny), skipping the enemies it passed. */
  private touchesEnemy(c: Shot, nx: number, ny: number, nflown: number, ents: ReadonlyMap<number, EntState>): EntState | null {
    const steps = Math.max(1, Math.ceil(Math.hypot(nx - c.x, ny - c.y) / 4));
    for (const e of ents.values()) {
      if (e.flags & FLAG.DEAD || c.hit.has(e.id)) continue;
      // An opened chest lets shots pass; a closed one stops them (server `stops_shots`).
      if (e.kind === KIND.Chest && e.anim !== 0) continue;
      // Neutral and recruited creatures are not targets of a hero's shot.
      if (shotPassesThrough(e)) continue;
      const air = (e.flags & FLAG.AIRBORNE) !== 0;
      for (let k = 1; k <= steps; k++) {
        const px = c.x + ((nx - c.x) * k) / steps;
        const py = c.y + ((ny - c.y) * k) / steps;
        // Objects have no body height (HITBOX h 0): they stop an arc at any height, as on the server.
        const hit = c.flight === undefined || e.kind === KIND.Chest || e.kind === KIND.Barrel
          ? shotHits(e.kind, e.x, e.y, air, px, py, c.r)
          : arcHits(e.kind, e.x, e.y, air, px, py, shotZ(c.flight, c.flown + ((nflown - c.flown) * k) / steps), c.r);
        if (hit) return e;
      }
    }
    return null;
  }

  /** Whether the shot flies on past `e` (server `impact`); updates its piercing and damage if so. */
  private passes(c: Shot, e: EntState): boolean {
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
}
