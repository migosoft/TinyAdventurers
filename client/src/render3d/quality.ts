// The quality rule: how many render px per art px, and where the copy lands.

export type Quality = 'high' | 'balanced' | 'fast';

/** The largest whole zoom that shows about 15 x 9.5 tiles, clamped to 2..8. */
export function pickZoom(w: number, h: number): number {
  const z = Math.floor(Math.min(w / (16 * 15), h / (16 * 9.5)));
  return Math.min(8, Math.max(2, z));
}

/** Render px per art px of the scene pass. */
export function effZoom(q: Quality, zoom: number): number {
  if (q === 'high') return zoom;
  if (q === 'fast') return Math.min(2, zoom);
  for (let d = Math.floor(zoom / 2); d >= 2; d--) {
    if (zoom % d === 0) return d;
  }
  return Math.max(2, Math.ceil(zoom / 2));
}

export interface RenderPlan {
  direct: boolean;
  ze: number;
  targetW: number; targetH: number;
  halfW: number; halfH: number;
  linear: boolean;
  dstX: number; dstY: number; dstW: number; dstH: number;
}

export function renderPlan(q: Quality, zoom: number, canvasW: number, canvasH: number): RenderPlan {
  const ze = effZoom(q, zoom);
  const artW = Math.ceil(canvasW / zoom);
  const artH = Math.ceil(canvasH / zoom);
  const direct = ze === zoom;
  const dstW = artW * zoom;
  const dstH = artH * zoom;
  return {
    direct,
    ze,
    targetW: direct ? canvasW : Math.max(1, artW * ze),
    targetH: direct ? canvasH : Math.max(1, artH * ze),
    halfW: direct ? canvasW / (32 * zoom) : artW / 32,
    halfH: direct ? canvasH / (32 * zoom) : artH / 32,
    linear: zoom % ze !== 0,
    dstX: direct ? 0 : Math.floor((canvasW - dstW) / 2),
    dstY: direct ? 0 : Math.floor((canvasH - dstH) / 2),
    dstW: direct ? canvasW : dstW,
    dstH: direct ? canvasH : dstH,
  };
}
