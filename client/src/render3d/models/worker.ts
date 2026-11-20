// The model builder's Web Worker (#338): only the message handler around the pure builders (see kit.ts). It answers each job with
// the model and the time the build took; the typed arrays are transferred, not copied. A picture job (`picture: true`, #358) is the
// same message: it answers with the painted image under `image`.

import { buildJob, paintJob, transferList } from './build';

/** The little of the worker scope this file uses (the project's tsconfig has the DOM lib, not WebWorker). */
interface Scope {
  onmessage: ((e: { data: { id: number; key: string; px: import('./weapons').SpritePixels | null; height?: number | null; picture?: boolean } }) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}
const scope = self as unknown as Scope;

scope.onmessage = (e) => {
  const { id, key, px, height, picture } = e.data;
  try {
    const t = performance.now();
    if (picture) {
      const image = paintJob(key);
      scope.postMessage({ id, image, ms: performance.now() - t }, [image.data.buffer as ArrayBuffer]);
      return;
    }
    const model = buildJob(key, px, height);
    const ms = performance.now() - t;
    scope.postMessage({ id, model, ms }, transferList(model));
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
