// Damage number colours per damage type (`DMG_TYPE`, server/src/defs/damage.rs).
// Physical keeps the old look: white on enemies, red on heroes.
import { DMG_TYPE } from '../generated/defs';

const COLORS: Record<number, string> = {
  [DMG_TYPE.Cold]: '#80d0ff',
  [DMG_TYPE.Heat]: '#ff9030',
  [DMG_TYPE.Magical]: '#c080ff',
  [DMG_TYPE.Poison]: '#80e040',
};

export function dmgColor(ty: number, toHero: boolean): string {
  if (ty === DMG_TYPE.Physical) return toHero ? '#ff5050' : '#ffffff';
  return COLORS[ty] ?? '#ffffff';
}
