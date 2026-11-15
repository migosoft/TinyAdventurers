// The effect triangles of the figures (#338): flat-coloured triangles the model layer draws with the figures' own pass. This file holds
// only the buffer; the shapes that fill it come with the effects.

/** Triangles as three corners of x, y, z each in `position` and four numbers r, g, b, a per corner in `rgba`; `n` is the triangle count. */
export interface FxBuf { position: number[]; rgba: number[]; n: number }

export function newFxBuf(): FxBuf {
  return { position: [], rgba: [], n: 0 };
}
