/** The ground image is larger than the device's texture limit. (Own file so the cover layer can throw it without importing the view.) */
export class GroundTooLargeError extends Error {
  constructor(w: number, h: number, limit: number) {
    super(`The ground image (${w} x ${h} px) is larger than this device's texture limit (${limit} px).`);
    this.name = 'GroundTooLargeError';
  }
}

/**
 * A device limit as the backend reports it, or `fallback` when it is missing: a WebGL context that is lost (or not yet ready after a device
 * loss) answers `getParameter` with null, a WebGPU device may have no `limits`. A missing limit is "unknown, try", never "too large" (#353):
 * the ground check passes `Infinity`, the shaders' sizing a safe default.
 */
export const limitOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
