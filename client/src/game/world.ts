// Client view of the world: snapshot buffer with an adaptive interpolation
// delay for remote entities, and prediction/reconciliation for the local player.
import { ABILITIES, CLASSES, CONST } from '../generated/defs';
import type { ClassId } from '../generated/ClassId';
import type { EntSnap } from '../generated/EntSnap';
import type { Modifiers } from '../generated/Modifiers';
import type { Snapshot } from '../generated/Snapshot';
import { sinking, stepMove, type MoveState } from '../sim/collision';
import type { TileMap } from '../sim/map';

export interface EntState {
  id: number;
  kind: number;
  x: number;
  y: number;
  hp: number;
  anim: number;
  aim: number;
  animMs: number;
  flags: number;
  extra: number;
}

interface TimedSnap {
  serverTime: number;
  ents: Map<number, EntSnap>;
}

const SNAP_INTERVAL = 1 / CONST.SNAPSHOT_HZ;
const MAX_EXTRAPOLATE = 0.1;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Remote entities: rendered slightly in the past, interpolated between snapshots. */
export class Interpolator {
  private snaps: TimedSnap[] = [];
  /** local clock - server clock, tracked as a low envelope of arrival offsets. */
  private offset: number | null = null;
  jitter = 0;
  delay = 2 * SNAP_INTERVAL;

  push(snap: Snapshot, now: number): void {
    const serverTime = snap.tick * CONST.DT;
    const off = now - serverTime;
    if (this.offset === null) this.offset = off;
    // Follow drops immediately, rises slowly (clock drift / route changes).
    this.offset = off < this.offset ? off : this.offset + (off - this.offset) * 0.01;
    const late = off - this.offset;
    this.jitter = this.jitter * 0.95 + late * 0.05;
    const target = Math.min(Math.max(SNAP_INTERVAL * 1.5 + this.jitter * 2.5, 0.05), 0.3);
    this.delay += (target - this.delay) * 0.05;
    const ents = new Map<number, EntSnap>();
    for (const e of snap.ents) ents.set(e[0], e);
    this.snaps.push({ serverTime, ents });
    while (this.snaps.length > 2 && this.snaps[1].serverTime < this.renderTime(now) - 0.5) this.snaps.shift();
  }

  renderTime(now: number): number {
    return now - (this.offset ?? now) - this.delay;
  }

  /** All entities at render time. Entities only in the older snapshot are dropped. */
  sample(now: number, out: Map<number, EntState>): void {
    out.clear();
    if (this.snaps.length === 0) return;
    const t = this.renderTime(now);
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].serverTime > t) i--;
    const b = this.snaps[i];
    const a = i > 0 ? this.snaps[i - 1] : b;
    let f: number;
    if (b.serverTime <= t) {
      // Past the newest snapshot: extrapolate a little from the last two.
      const prev = this.snaps.length > 1 ? this.snaps[this.snaps.length - 2] : b;
      const span = b.serverTime - prev.serverTime || SNAP_INTERVAL;
      const ext = Math.min(t - b.serverTime, MAX_EXTRAPOLATE);
      for (const [id, e] of b.ents) {
        const p = prev.ents.get(id);
        const k = p ? ext / span : 0;
        out.set(id, toState(e, p ? e[2] + (e[2] - p[2]) * k : e[2], p ? e[3] + (e[3] - p[3]) * k : e[3], e[6]));
      }
      return;
    }
    f = a === b ? 1 : (t - a.serverTime) / (b.serverTime - a.serverTime);
    f = Math.min(Math.max(f, 0), 1);
    for (const [id, eb] of b.ents) {
      const ea = a.ents.get(id);
      if (!ea) {
        out.set(id, toState(eb, eb[2], eb[3], eb[6]));
        continue;
      }
      out.set(id, toState(eb, ea[2] + (eb[2] - ea[2]) * f, ea[3] + (eb[3] - ea[3]) * f, lerpAngle(ea[6], eb[6], f)));
    }
  }

  latest(): Map<number, EntSnap> | undefined {
    return this.snaps[this.snaps.length - 1]?.ents;
  }
}

function toState(e: EntSnap, x: number, y: number, aim: number): EntState {
  return { id: e[0], kind: e[1], x, y, hp: e[4] / 255, anim: e[5], aim, animMs: e[7], flags: e[8], extra: e[9] };
}

// ------------------------------------------------------------ local prediction

interface Pending {
  seq: number;
  mx: number;
  my: number;
  /** Dash started by this input (set after the move step, like the server). */
  dash: [number, number] | null;
}

type AbilityName = keyof typeof ABILITIES;

export class Predictor {
  state: MoveState;
  /** Visual smoothing of small corrections (decays to 0). */
  offX = 0;
  offY = 0;
  lastCorrection = 0;
  cd1 = 0;
  cd2 = 0;
  hidden = 0;
  private pending: Pending[] = [];
  private seq = 0;
  readonly speed: number;
  readonly primary: AbilityName;
  readonly secondary: AbilityName;

  constructor(
    private map: TileMap,
    cls: ClassId,
    private mods: Modifiers,
    x: number,
    y: number,
  ) {
    const c = CLASSES[cls];
    this.speed = c.speed * mods.move_speed;
    this.primary = c.primary as AbilityName;
    this.secondary = c.secondary as AbilityName;
    this.state = { x, y, dashT: 0, dashDx: 0, dashDy: 0 };
  }

  /** Lost to a chasm or deep water (no more moves or attacks). */
  get sinking(): boolean {
    return sinking(this.map, this.state);
  }

  cooldownOf(name: AbilityName, daggerUsed = false): number {
    const base = daggerUsed ? CONST.DAGGER_COOLDOWN : ABILITIES[name].cooldown;
    return base / this.mods.attack_speed;
  }

  /** Advance one fixed step. Returns the sequence number for the input message. */
  step(mx: number, my: number, dash: [number, number] | null): number {
    this.seq++;
    this.cd1 = Math.max(this.cd1 - CONST.DT, 0);
    this.cd2 = Math.max(this.cd2 - CONST.DT, 0);
    this.hidden = Math.max(this.hidden - CONST.DT, 0);
    // Falling or drowning: the server ignores moves and attacks from now on.
    if (this.sinking) [mx, my, dash] = [0, 0, null];
    else this.state = stepMove(this.map, this.state, mx, my, this.speed, CONST.DASH_SPEED, CONST.PLAYER_RADIUS, CONST.DT);
    if (dash) this.state = { ...this.state, dashT: ABILITIES.Dash.duration, dashDx: dash[0], dashDy: dash[1] };
    this.pending.push({ seq: this.seq, mx, my, dash });
    if (this.pending.length > 240) this.pending.shift();
    return this.seq;
  }

  /** Server says: after input `ack` I was here. Replay what it has not seen yet. */
  reconcile(snap: Snapshot): void {
    const me = snap.me;
    this.pending = this.pending.filter((p) => p.seq > snap.ack);
    let s: MoveState = { x: me.x, y: me.y, dashT: me.dash_t, dashDx: me.dash_dx, dashDy: me.dash_dy };
    for (const p of this.pending) {
      if (sinking(this.map, s)) break;
      s = stepMove(this.map, s, p.mx, p.my, this.speed, CONST.DASH_SPEED, CONST.PLAYER_RADIUS, CONST.DT);
      if (p.dash) s = { ...s, dashT: ABILITIES.Dash.duration, dashDx: p.dash[0], dashDy: p.dash[1] };
    }
    const ex = this.state.x - s.x;
    const ey = this.state.y - s.y;
    const err = Math.hypot(ex, ey);
    this.lastCorrection = err;
    if (err > 0.01) {
      if (err < 24) {
        // Blend small errors out visually instead of snapping.
        this.offX += ex;
        this.offY += ey;
      } else {
        this.offX = 0;
        this.offY = 0;
      }
    }
    this.state = s;
    // Cooldowns: trust the server when we disagree noticeably.
    const unacked = this.pending.length * CONST.DT;
    const s1 = Math.max(me.cd1 - unacked, 0);
    const s2 = Math.max(me.cd2 - unacked, 0);
    if (Math.abs(s1 - this.cd1) > 0.15) this.cd1 = s1;
    if (Math.abs(s2 - this.cd2) > 0.15) this.cd2 = s2;
    const sh = Math.max(me.hidden - unacked, 0);
    if (Math.abs(sh - this.hidden) > 0.3) this.hidden = sh;
  }

  /** Render position including decaying correction offset. */
  renderPos(dt: number): [number, number] {
    const k = Math.exp(-dt / 0.1);
    this.offX *= k;
    this.offY *= k;
    return [this.state.x + this.offX, this.state.y + this.offY];
  }
}
