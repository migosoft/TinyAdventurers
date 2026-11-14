// The cove's small plants in the 3D view (#306): an upright atlas card per plant. Pure: no three.js, and nothing here depends on the camera.

/** Pixels per tile in a plant's image. */
const PX = 16;

/** A plant frame in the atlas. rect in atlas px; foot in the frame's px. */
export interface PlantSprite { rect: { x: number; y: number; w: number; h: number }; foot: { x: number; y: number } }
export interface PlantPlace { x: number; z: number; mirrored: boolean; amp: number; seed: number }
/** Per vertex: foot (x, z), corner (u tiles across the card, signed; y tiles up), uv (atlas px), sway (amp, card height in tiles). `n` counts vertices. */
export interface PlantBuf { foot: number[]; corner: number[]; uv: number[]; sway: number[]; n: number }

export const newPlantBuf = (): PlantBuf => ({ foot: [], corner: [], uv: [], sway: [], n: 0 });

// Corners run top-left, top-right, bottom-right, bottom-left; two triangles (as cards.ts).
const ORDER = [0, 3, 2, 0, 2, 1];

/** The upright card: the frame's rows above the foot. A mirrored plant reads its columns back to front, so its u runs the other way and its uv swaps. */
export function pushPlant(out: PlantBuf, p: PlantPlace, s: PlantSprite): void {
  const { w } = s.rect, fy = s.foot.y, fx = s.foot.x;
  const uL = p.mirrored ? -(w - fx) / PX : -fx / PX, uR = p.mirrored ? fx / PX : (w - fx) / PX;
  const xL = p.mirrored ? w : 0, xR = p.mirrored ? 0 : w;
  const h = fy / PX;
  const cs: [number, number][] = [[uL, h], [uR, h], [uR, 0], [uL, 0]];
  const us: [number, number][] = [[xL, 0], [xR, 0], [xR, fy], [xL, fy]];
  for (const k of ORDER) {
    out.foot.push(p.x, p.z);
    out.corner.push(cs[k][0], cs[k][1]);
    out.uv.push(s.rect.x + us[k][0], s.rect.y + us[k][1]);
    out.sway.push(p.amp, h);
  }
  out.n += 6;
}
