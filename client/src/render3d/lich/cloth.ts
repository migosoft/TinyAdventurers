// The lich's cloth (#358). Task 4 adds only the constants, the state and a new cloth; the logic (`clothMove`, `clothFollow`) comes with Task 5.
import { ROBE_RINGS } from './rings';

export const CLOTH = { ringRate: [30, 3.4], maxLag: 4.4, lagPow: 1.3, turnRate: [30, 2.6], maxTurn: 0.75, speedRate: 8, glideRate: 5, glideSpeed: 22, tome: { at: [5.6, -0.35], rate: 7, max: 1.6 }, jump: 16, maxDt: 0.1 } as const;

/** Per ring: its centre as an offset from the lich in world directions (builder units) and its turn (world rad). */
export interface Cloth { rx: Float32Array; rz: Float32Array; rt: Float32Array; tomeX: number; tomeZ: number; vx: number; vz: number; glide: number; mx: number; mz: number; lastX: number; lastZ: number; started: boolean }

/** A cloth at rest: every ring at offset 0 with turn 0, nothing moving. */
export function newCloth(): Cloth {
  const n = ROBE_RINGS.length;
  return { rx: new Float32Array(n), rz: new Float32Array(n), rt: new Float32Array(n), tomeX: 0, tomeZ: 0, vx: 0, vz: 0, glide: 0, mx: 0, mz: 0, lastX: 0, lastZ: 0, started: false };
}
