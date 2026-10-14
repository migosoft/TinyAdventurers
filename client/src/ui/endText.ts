import type { BossId } from '../generated/BossId';
import type { LevelId } from '../generated/LevelId';
import { BOSS_TEXT, LEVEL_TEXT } from './text';

/** The end screen's first line: the slain boss on a win if the level has one, else the level's own line. */
export function endText(victory: boolean, level: LevelId, boss: BossId | null): string {
  if (!victory) return LEVEL_TEXT[level].defeat;
  return boss ? `${BOSS_TEXT[boss].name} has been slain.` : LEVEL_TEXT[level].victory;
}
