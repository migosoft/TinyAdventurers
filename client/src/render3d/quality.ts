// The quality rule: how many render px per art px, and where the copy lands.

export type Quality = 'high' | 'balanced' | 'fast';

export const QUALITIES: readonly (readonly [Quality, string])[] = [['high', 'High'], ['balanced', 'Balanced'], ['fast', 'Fast']];

export function isQuality(v: unknown): v is Quality {
  return v === 'high' || v === 'balanced' || v === 'fast';
}

/** The largest whole zoom that shows about 15 x 9.5 tiles, clamped to 2..8. */
export function pickZoom(w: number, h: number): number {
  const z = Math.floor(Math.min(w / (16 * 15), h / (16 * 9.5)));
  return Math.min(8, Math.max(2, z));
}

/** Render px per art px of the scene pass: a whole number >= 1 for any zoom > 0. */
export function effZoom(q: Quality, zoom: number): number {
  const up = Math.ceil(zoom);
  if (q === 'high') return up;
  if (q === 'fast') return Math.min(2, up);
  return Math.min(up, Math.max(2, Math.ceil(zoom / 2)));
}

export interface RenderPlan {
  direct: boolean;
  ze: number;
  targetW: number; targetH: number;
  halfW: number; halfH: number;
  /** The picture's size in art px (one per 1/zoom of the canvas), the same in both modes: the shaft pass works at this size. */
  artW: number; artH: number;
  /** Canvas px per target texel of the copy (1 when direct); a whole number filters nearest, a fraction linear. */
  scaleX: number; scaleY: number;
  dstX: number; dstY: number; dstW: number; dstH: number;
}

export function renderPlan(q: Quality, zoom: number, canvasW: number, canvasH: number): RenderPlan {
  const ze = effZoom(q, zoom);
  const artW = Math.ceil(canvasW / zoom);
  const artH = Math.ceil(canvasH / zoom);
  const direct = ze === zoom;
  const dstW = Math.round(artW * zoom);
  const dstH = Math.round(artH * zoom);
  const targetW = direct ? canvasW : Math.max(1, artW * ze);
  const targetH = direct ? canvasH : Math.max(1, artH * ze);
  const copyW = direct ? canvasW : dstW;
  const copyH = direct ? canvasH : dstH;
  return {
    artW, artH,
    direct,
    ze,
    targetW, targetH,
    halfW: direct ? canvasW / (32 * zoom) : artW / 32,
    halfH: direct ? canvasH / (32 * zoom) : artH / 32,
    scaleX: copyW / targetW,
    scaleY: copyH / targetH,
    dstX: direct ? 0 : Math.floor((canvasW - dstW) / 2),
    dstY: direct ? 0 : Math.floor((canvasH - dstH) / 2),
    dstW: copyW,
    dstH: copyH,
  };
}
