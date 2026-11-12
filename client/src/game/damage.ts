// Damage number colours per damage type (`DMG_TYPE`, server/src/defs/damage.rs).
// Physical keeps the old look: white on enemies, red on heroes.
import { DMG_TYPE } from '../generated/defs';
import type { Ev } from '../generated/Ev';
import { critLabel, WORLD_TEXT, type WorldTextKind } from './worldText';

/** Every damage type but physical; a new type needs its colour here (damage.test.ts checks). */
export const DMG_COLORS: Record<number, string> = {
  [DMG_TYPE.Cold]: '#80d0ff',
  [DMG_TYPE.Heat]: '#ff9030',
  [DMG_TYPE.Magical]: '#c080ff',
  [DMG_TYPE.Poison]: '#80e040',
};

/** A floating number or word for a picture event, as both views show it (`up`: art px above the event's spot). */
export interface FloatOf { text: string; color: string; opts: { big?: boolean; kind?: WorldTextKind; up?: number } }

/** The float of a `Dmg`, `Heal`, `Immune` or `Coins` event; null for the other events. */
export function floatOf(e: Ev): FloatOf | null {
  switch (e.t) {
    case 'Dmg':
      if (e.imm) return { text: 'immune', color: '#a0a0a0', opts: { kind: 'small' } };
      if (e.crit) return { text: critLabel(e.v), color: WORLD_TEXT.crit.color, opts: { big: true } };
      return { text: `${Math.round(e.v)}`, color: dmgColor(e.ty, e.p), opts: {} };
    case 'Heal':
      return { text: `+${Math.round(e.v)}`, color: '#60ff80', opts: {} };
    case 'Immune':
      return { text: 'IMMUNE', color: '#9ae0ff', opts: { kind: 'small', up: 18 } };
    case 'Coins':
      return { text: `+${e.v} coins`, color: '#ffd040', opts: { kind: 'small', up: 14 } };
    default:
      return null;
  }
}

/** The server puts a hit or heal on a creature's body: this many px (art px on screen) above its foot. */
export const BODY_RISE = 10;

/** 2D's test for a hit or heal on the own hero: the event's spot (body, `BODY_RISE` px over the foot) within 4 px of the predicted hero. */
export function onOwnHero(ev: { x: number; y: number; p: boolean }, own: { x: number; y: number }): boolean {
  return ev.p && Math.hypot(ev.x - own.x, ev.y + BODY_RISE - own.y) < 4;
}

export function dmgColor(ty: number, toHero: boolean): string {
  if (ty === DMG_TYPE.Physical) return toHero ? '#ff5050' : '#ffffff';
  return DMG_COLORS[ty] ?? '#ffffff';
}
