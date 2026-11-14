/** The ground image is larger than the device's texture limit. (Own file so the cover layer can throw it without importing the view.) */
export class GroundTooLargeError extends Error {
  constructor(w: number, h: number, limit: number) {
    super(`The ground image (${w} x ${h} px) is larger than this device's texture limit (${limit} px).`);
    this.name = 'GroundTooLargeError';
  }
}
