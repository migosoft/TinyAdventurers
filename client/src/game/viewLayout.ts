// How the integer zoom is split between the canvas and the camera (#62, #295).

/**
 * Where the integer zoom lives. `screen` (the default): the canvas is at screen resolution and the
 * zoom is on each scene's camera, so text is crisp. `world`: the canvas is at world resolution and
 * Phaser's `scale.zoom` upscales it by CSS, as before the screen-resolution canvas; a debug A/B of
 * the per-pixel cost (`?res=world`, debug accounts only).
 */
export type Resolution = 'screen' | 'world';

export interface ViewLayout {
  /** The canvas's pixel size. */
  canvasW: number;
  canvasH: number;
  /** Phaser's `scale.zoom`: the CSS upscale of the canvas. */
  cssZoom: number;
  /** The main camera's zoom. */
  camZoom: number;
}

/** Integer zoom so pixels stay crisp; figures stay tiny on large screens. Both modes show the same world area. */
export function viewLayout(innerW: number, innerH: number, res: Resolution): ViewLayout {
  const zoom = Math.max(1, Math.round(Math.min(innerW / 600, innerH / 340)));
  const w = Math.ceil(innerW / zoom);
  const h = Math.ceil(innerH / zoom);
  return res === 'world' ? { canvasW: w, canvasH: h, cssZoom: zoom, camZoom: 1 } : { canvasW: w * zoom, canvasH: h * zoom, cssZoom: 1, camZoom: zoom };
}

/** The resolution a page asks for: `world` only with `?res=world` on a debug account. */
export function requestedResolution(search: string, debug: boolean): Resolution {
  return debug && new URLSearchParams(search).get('res') === 'world' ? 'world' : 'screen';
}
