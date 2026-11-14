// The cove's plants for the 3D view (#306): atlas cards, all ready at once, gathered per world chunk. No three.js: the view uploads what a frame holds.
import { newPlantBuf, pushPlant, type PlantBuf, type PlantPlace, type PlantSprite } from './plants';
import { plantChunks } from './trees/chunks';

export interface AtlasPlantFrame {
  /** Chunk index (cz * nx + cx) to its cards. */
  chunks: ReadonlyMap<number, PlantBuf>;
  /** Chunk index to a number that grows when a plant was added to it. */
  versions: ReadonlyMap<number, number>;
  wind: boolean;
  t: number;
}

export class AtlasPlants {
  private readonly chunkMap = new Map<number, PlantBuf>();
  private readonly versionMap = new Map<number, number>();

  constructor(items: readonly { place: PlantPlace; sprite: PlantSprite }[], map: { w: number; h: number }) {
    const feet = items.map((it) => ({ x: it.place.x, z: it.place.z }));
    for (const [chunk, list] of plantChunks(feet, map)) {
      const buf = newPlantBuf();
      for (const i of list) pushPlant(buf, items[i].place, items[i].sprite);
      this.chunkMap.set(chunk, buf);
      this.versionMap.set(chunk, list.length);
    }
  }

  frame(wind: boolean, t: number): AtlasPlantFrame {
    return { chunks: this.chunkMap, versions: this.versionMap, wind, t };
  }
}
