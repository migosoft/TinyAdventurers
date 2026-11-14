// Which world chunk each plant belongs to, and what a consumer has already seen of the chunks' versions.
import { CHUNK } from '../worldMesh';

/** Which chunk (CHUNK tiles) each plant's foot lies in: chunk index = cz * nx + cx. Values are indices into `feet`. */
export function plantChunks(feet: readonly { x: number; z: number }[], map: { w: number; h: number }): Map<number, number[]> {
  const nx = Math.ceil(map.w / CHUNK), nz = Math.ceil(map.h / CHUNK);
  const out = new Map<number, number[]>();
  feet.forEach((f, i) => {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor(f.x / CHUNK))), cz = Math.min(nz - 1, Math.max(0, Math.floor(f.z / CHUNK)));
    const k = cz * nx + cx;
    const l = out.get(k);
    if (l) l.push(i); else out.set(k, [i]);
  });
  return out;
}

/** Tracks which chunk versions a consumer has; a new consumer (a rebuilt view) sees every chunk as changed. */
export class ChunkSync {
  private seen = new Map<number, number>();
  changed(versions: ReadonlyMap<number, number>): number[] {
    const out: number[] = [];
    for (const [k, v] of versions) if (this.seen.get(k) !== v) { out.push(k); this.seen.set(k, v); }
    return out;
  }
}
