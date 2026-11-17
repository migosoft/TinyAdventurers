// The stored quality choice. No three.js import: the UI code and main.ts use it.
import { isQuality, type Quality } from './quality';

export const QUALITY_KEY = 'ta.quality';
export type QualityStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The stored quality; 'balanced' when it is missing, not a quality, or the store throws. */
export function loadQuality(store: Pick<Storage, 'getItem'> | null): Quality {
  try {
    const v = store?.getItem(QUALITY_KEY);
    return isQuality(v) ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}

/** Stores the quality; never throws. */
export function saveQuality(store: Pick<Storage, 'setItem'> | null, q: Quality): void {
  try {
    store?.setItem(QUALITY_KEY, q);
  } catch {
    // Storage blocked or full: the choice lasts for this session only.
  }
}

/** The browser's localStorage, or null when even reading the property throws. */
export function browserStore(): QualityStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
