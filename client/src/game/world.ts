// Client view of the world: snapshot buffer with an adaptive interpolation
// delay for remote entities, and prediction/reconciliation for the local player.
import { CONST, EFFECTS } from '../generated/defs';
import type { EntSnap } from '../generated/EntSnap';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import type { Snapshot } from '../generated/Snapshot';
import { knocked, sinking, stepMove, type MoveState, type Solid } from '../sim/collision';
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
  effects: number;
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
  return { id: e[0], kind: e[1], x, y, hp: e[4] / 255, anim: e[5], aim, animMs: e[7], flags: e[8], extra: e[9], effects: e[10] };
}

// ------------------------------------------------------------ abilities

/**
 * What an ability does when used (server: the melee rule). In melee a ranged
 * primary strikes with the melee weapon instead (the fallback), and a ranged
 * secondary is blocked. Anything else is used as it is.
 */
export function abilityChoice(a: ResolvedAbility, slot: 0 | 1, inMelee: boolean): 'use' | 'fallback' | 'blocked' {
  if (!a.ranged || !inMelee) return 'use';
  return slot === 0 ? 'fallback' : 'blocked';
}

/** The weakness floor of the server's damage formula (`MIN_RESISTANCE` in defs/damage.rs). */
const MIN_RESISTANCE = -1;
/** `pierce` value for "no limit" (`u8::MAX`). */
const PIERCE_UNLIMITED = 255;
/** The smallest rest that flies on; at or below it the kill is exact (`OVERKILL_EPS` in defs/damage.rs). */
const OVERKILL_EPS = 1e-9;

/**
 * Whether an own shot predicted to touch an enemy flies on, and with what
 * (server `impact`): it first passes `through` enemies with full damage, then
 * flies on with the rest of its damage only if it kills with damage to spare (`overkill_rest`), while
 * `pierce` allows it. The enemy's HP is estimated from its byte share of max HP.
 * Unknown kinds and immune enemies stop it.
 */
export function cosmeticPierce(
  state: { pierce: number; through: number; damage: number },
  hpShare: number,
  maxHp: number | undefined,
  split: Record<string, number>,
  res: Record<string, number> | undefined,
): 'stop' | { pierce: number; through: number; damage: number } {
  if (state.through > 0) return { ...state, through: state.through - 1 };
  if (state.pierce <= 0 || maxHp === undefined || res === undefined) return 'stop';
  const hp = (hpShare / 255) * maxHp;
  let eff = 0;
  for (const [t, share] of Object.entries(split)) eff += share * (1 - Math.max(res[t] ?? 0, MIN_RESISTANCE));
  if (eff <= 0) return 'stop';
  const rest = state.damage - hp / eff;
  if (rest <= OVERKILL_EPS) return 'stop';
  return { pierce: state.pierce === PIERCE_UNLIMITED ? PIERCE_UNLIMITED : state.pierce - 1, through: 0, damage: rest };
}

// ------------------------------------------------------------ local prediction

interface Pending {
  seq: number;
  mx: number;
  my: number;
  /** Dash started by this input (set after the move step, like the server). */
  dash: [number, number] | null;
  /** Cooldowns started by this input's primary / secondary ability (null: not used). */
  used: Used;
}

type Used = [number | null, number | null];

export class Predictor {
  state: MoveState;
  /** Visual smoothing of small corrections (decays to 0). */
  offX = 0;
  offY = 0;
  lastCorrection = 0;
  /** Footprints of the solid objects (the world keeps this current from the snapshot). */
  solids: Solid[] = [];
  cd1 = 0;
  cd2 = 0;
  /** From the snapshot: movement factor (0 while it cannot move), no casting, no turning. */
  speedMul = 1;
  noAct = false;
  noTurn = false;
  private pending: Pending[] = [];
  private seq = 0;
  readonly speed: number;
  /** Seconds a dash lasts: the secondary's, when that is Charge. */
  private dashDuration: number;

  constructor(
    private map: TileMap,
    speed: number,
    private abilities: ResolvedAbility[],
    private fallback: ResolvedAbility,
    x: number,
    y: number,
  ) {
    this.speed = speed;
    const sec = abilities[1];
    this.dashDuration = sec.id === 'Charge' ? sec.duration : 0;
    this.state = { x, y, dashT: 0, dashDx: 0, dashDy: 0, knockVx: 0, knockVy: 0 };
  }

  /** Pushed by a strong hit: no moves or abilities until the slide ends (the server ignores them). */
  get knocked(): boolean {
    return this.state.dashT <= 0 && knocked(this.state);
  }

  /** Lost to a chasm or deep water (no more moves or attacks). */
  get sinking(): boolean {
    return sinking(this.map, this.state);
  }

  /** Cooldown the server resolved for the slot (or for the melee fallback). */
  cooldownOf(slot: 0 | 1, fallback = false): number {
    return (fallback ? this.fallback : this.abilities[slot]).cooldown;
  }

  /**
   * Advance one fixed step; `used` holds the cooldowns of the abilities this input
   * uses. Returns the sequence number for the input message.
   */
  step(mx: number, my: number, dash: [number, number] | null, used: Used = [null, null]): number {
    this.seq++;
    // Like the server: cooldowns tick, then the abilities of this input start theirs.
    this.cd1 = used[0] ?? Math.max(this.cd1 - CONST.DT, 0);
    this.cd2 = used[1] ?? Math.max(this.cd2 - CONST.DT, 0);
    // Falling or drowning: the server ignores moves and attacks from now on.
    // Pushed: it ignores them until the slide ends.
    // The move is kept as sent, not as predicted: if the server sees no sinking
    // (or a debug climb-out already happened there), it applies it.
    this.pending.push({ seq: this.seq, mx, my, dash, used });
    if (this.sinking) dash = null;
    else {
      if (this.knocked) dash = null;
      this.state = stepMove(this.map, this.state, mx, my, this.speed * this.speedMul, CONST.DASH_SPEED, CONST.PLAYER_RADIUS, CONST.DT, this.solids);
    }
    if (dash) this.state = { ...this.state, dashT: this.dashDuration, dashDx: dash[0], dashDy: dash[1] };
    if (this.pending.length > 240) this.pending.shift();
    return this.seq;
  }

  /** Server says: after input `ack` I was here. Replay what it has not seen yet. */
  reconcile(snap: Snapshot): void {
    const me = snap.me;
    this.speedMul = me.speed_mul;
    this.noAct = me.no_act;
    this.noTurn = me.effects.some(([k]) => EFFECTS[k]?.no_turn);
    this.pending = this.pending.filter((p) => p.seq > snap.ack);
    let s: MoveState = { x: me.x, y: me.y, dashT: me.dash_t, dashDx: me.dash_dx, dashDy: me.dash_dy, knockVx: me.knock_vx, knockVy: me.knock_vy };
    for (const p of this.pending) {
      if (sinking(this.map, s)) break;
      // A push the client learned of late still voids the dashes sent during it, as on the server.
      const wasKnocked = s.dashT <= 0 && knocked(s);
      s = stepMove(this.map, s, p.mx, p.my, this.speed * this.speedMul, CONST.DASH_SPEED, CONST.PLAYER_RADIUS, CONST.DT, this.solids);
      if (p.dash && !wasKnocked) s = { ...s, dashT: this.dashDuration, dashDx: p.dash[0], dashDy: p.dash[1] };
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
    // Cooldowns: trust the server when we disagree noticeably,
    // after replaying the abilities it has not seen yet (else a held button
    // fires again).
    let s1 = me.cd1;
    let s2 = me.cd2;
    for (const p of this.pending) {
      s1 = p.used[0] ?? Math.max(s1 - CONST.DT, 0);
      s2 = p.used[1] ?? Math.max(s2 - CONST.DT, 0);
    }
    if (Math.abs(s1 - this.cd1) > 0.15) this.cd1 = s1;
    if (Math.abs(s2 - this.cd2) > 0.15) this.cd2 = s2;
  }

  /** Render position including decaying correction offset. */
  renderPos(dt: number): [number, number] {
    const k = Math.exp(-dt / 0.1);
    this.offX *= k;
    this.offY *= k;
    return [this.state.x + this.offX, this.state.y + this.offY];
  }
}
