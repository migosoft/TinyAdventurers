// Trunk-side helpers shared by the leafy trees and the conifer (#279).
import { type Canvas, isLeaf } from './canvas';

/** Moss on the lit root pixels around the foot (leafy greens '2'/'3'), shared by the leafy trees and the conifer. */
export function rootMoss(cv: Canvas, r: () => number, cx: number, footY: number, s: number): void {
  for (let k = 0; k < 40 * s; k++) { const x = cx + (-26 + r() * 52) * s, y = footY - 4 * s + r() * 8 * s; const c = cv.getRef(x, y); if (c && 'cd'.includes(c) && cv.get(x, y - 1) !== null) cv.set(x, y, r() < 0.5 ? '2' : '3'); }
}

/** The crown's shadow on the trunk: the first bark pixels below the leaves in each column, `depth` px deep, one step darker. */
export function canopyShadow(cv: Canvas, depth: number): void {
  const darker: Record<string, string> = { d: 'c', c: 'b', b: 'a', a: 'a' };
  for (let x = 0; x < cv.w; x++) { let y = 0, seen = false; for (; y < cv.h; y++) { const c = cv.px[y * cv.w + x]; if (isLeaf(c)) seen = true; else if (seen && c && c in darker) break; }
    for (let i = 0; i < depth && y + i < cv.h; i++) { const c = cv.get(x, y + i); if (c && c in darker) cv.set(x, y + i, darker[c]); } }
}
