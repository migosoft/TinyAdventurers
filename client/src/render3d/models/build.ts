// What the kit and its worker share (#338): the build of one key and the list of buffers a model hands over.

import { buildFigure, buildSkull, type FigureModel } from './model';
import { DESCS, TUBE_DESCS, type DescKey, type TubeKey } from './table';
import { buildTubeFigure } from './tubeModel';
import { WEAPONS, buildWeapon, type SpritePixels } from './weapons';

export const isFigureKey = (key: string): key is DescKey => Object.prototype.hasOwnProperty.call(DESCS, key);
export const isTubeKey = (key: string): key is TubeKey => Object.prototype.hasOwnProperty.call(TUBE_DESCS, key);
export const isWeaponKey = (key: string): boolean => Object.prototype.hasOwnProperty.call(WEAPONS, key);

/** Builds the model of a figure key (fitted to `height` sprite px when given), 'skull' or a weapon name; throws for anything else. */
export function buildJob(key: string, px: SpritePixels | null, height?: number | null): FigureModel {
  if (isFigureKey(key)) return buildFigure(key, DESCS[key], height ?? undefined);
  if (isTubeKey(key)) return buildTubeFigure(key, TUBE_DESCS[key]);
  if (key === 'skull') return buildSkull();
  if (isWeaponKey(key)) return buildWeapon(key, px);
  throw new Error(`no model for ${key}`);
}

/** The distinct buffers behind the typed arrays of a model. */
export function transferList(m: FigureModel): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [m.position, m.normal, m.uv, m.skin, m.look, m.index, m.pieceIndex, m.lineIndex, m.pivots, m.parents, m.paint.data];
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];
}
