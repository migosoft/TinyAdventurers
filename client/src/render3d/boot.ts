// The ?r3d=demo page: #301's scene on the shared host core.

import { createDemoStage } from './demoStage';
import { parseParams } from './params';
import { startHost } from './host';

export async function bootDemo(el: HTMLElement, search: string): Promise<void> {
  const p = parseParams(search);
  await startHost(el, search, 'demo', (assets) => createDemoStage(assets, p));
}
