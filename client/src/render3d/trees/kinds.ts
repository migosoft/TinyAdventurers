// The plant kinds on the wire and the pack-style palette the 3D trees and ground cover read (#203, #279, moved here by #333).
// Pure: no three, no DOM (game/woodland/ground.ts imports the `Rgba` type from here, and the main graph must never reach three).
import type { PlantInfo } from '../../generated/PlantInfo';

type Rgb = [number, number, number];
export interface Rgba { w: number; h: number; data: Uint8ClampedArray }

/** The palette letters: k outline, 0-4 and 5-9 two green ramps dark to light, a-d wood, e-h dead wood. */
export const P: Record<string, Rgb> = { k: [34, 34, 34], 0: [28, 58, 50], 1: [40, 100, 62], 2: [62, 138, 67], 3: [106, 174, 79], 4: [156, 207, 98],
  5: [22, 48, 52], 6: [30, 74, 70], 7: [44, 104, 88], 8: [74, 140, 104], 9: [118, 176, 124],
  a: [58, 35, 40], b: [98, 53, 43], c: [143, 64, 41], d: [176, 112, 74],
  // dead wood: the bark ramp a..d turned greyer and darker
  e: [40, 32, 34], f: [64, 50, 47], g: [90, 73, 64], h: [118, 99, 84] };

export type PlantKind = 'round' | 'wide' | 'tall' | 'conifer' | 'bare' | 'bush';
/** A plant kind on the wire: the kinds above and the willow (#438), which only the 3D view grows. */
export type WireKind = PlantKind | 'willow';
/** Index = wire id; the server's `PlantKind` (woodland.rs) has the same order. A dead tree is not a kind: it is looked up as 'bare' (`plantLook`). */
export const PLANT_KINDS: readonly WireKind[] = ['round', 'wide', 'tall', 'conifer', 'bush', 'willow'];

/** The look a plant has: the bare tree when it is dead, else its kind. */
export function plantLook(p: PlantInfo): WireKind {
  return p[7] ? 'bare' : PLANT_KINDS[p[0]];
}
