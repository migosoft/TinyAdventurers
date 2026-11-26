import { describe, expect, it } from 'vitest';
import { buildModelOutlines } from './model-frames';
import { buildFigure } from '../src/render3d/models/model';
import { BONES } from '../src/render3d/models/model';
import { buildTubeFigure } from '../src/render3d/models/tubeModel';
import { DESCS, outlineFrame, TUBE_DESCS } from '../src/render3d/models/table';

import { LICH, LICH_TOP } from '../src/render3d/lich/shape';

const WIDTH = 512;
const keys = [...Object.keys(DESCS), ...Object.keys(TUBE_DESCS)];
const build = (key: string) => (key in DESCS ? buildFigure(key, DESCS[key as keyof typeof DESCS]) : buildTubeFigure(key, TUBE_DESCS[key as keyof typeof TUBE_DESCS]));

const { img, frames } = buildModelOutlines(WIDTH);
const alpha = (x: number, y: number): number => img.data[(y * img.w + x) * 4 + 3];
/** The opaque bounding box of a frame, relative to it. */
function opaque(key: string): { x0: number; x1: number; y0: number; y1: number } {
  const f = frames[outlineFrame(key)];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (alpha(f.x + x, f.y + y)) (x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y));
  return { x0, x1, y0, y1 };
}

describe('buildModelOutlines', () => {
  it('has a frame for every model, an even width, inside the strip and apart from the others', () => {
    expect(img.w).toBe(WIDTH);
    for (const key of keys) {
      const f = frames[outlineFrame(key)];
      expect(f, key).toBeDefined();
      expect(f.w % 2, `${key} width`).toBe(0);
      expect(f.x + f.w, key).toBeLessThanOrEqual(WIDTH);
      expect(f.y + f.h, key).toBeLessThanOrEqual(img.h);
    }
    const list = keys.map((k) => frames[outlineFrame(k)]);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${keys[i]} and ${keys[j]} overlap`).toBe(true);
      }
  });

  it('is transparent or opaque 0x222222 only', () => {
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3];
      expect(a === 0 || (a === 255 && img.data[i] === 0x22 && img.data[i + 1] === 0x22 && img.data[i + 2] === 0x22)).toBe(true);
    }
  });

  it('covers the model seen from the side: the wolf and the stag fill their extent, centred, with the feet on the bottom row', () => {
    for (const key of ['wolf', 'stag']) {
      const m = build(key), f = frames[outlineFrame(key)];
      let minX = 0, maxX = 0, maxY = 0;
      for (let i = 0; i < m.position.length; i += 3) (minX = Math.min(minX, m.position[i]), maxX = Math.max(maxX, m.position[i]), maxY = Math.max(maxY, m.position[i + 1]));
      expect(f.w, key).toBe(2 * Math.ceil(Math.max(maxX, -minX)));
      expect(f.h, key).toBe(Math.ceil(maxY));
      const o = opaque(key);
      expect(o.y1, `${key} feet`).toBe(f.h - 1);
      expect(o.y0, `${key} top`).toBe(0);
      // x 0 is the middle column boundary; the outline spans the model's x extent rounded out
      expect(o.x0, `${key} left`).toBe(Math.max(0, Math.floor(f.w / 2 + minX)));
      expect(o.x1, `${key} right`).toBe(Math.min(f.w - 1, Math.floor(f.w / 2 + maxX)));
    }
  });

  it('gives the stag antlers above the head and the deer none', () => {
    /** Opaque pixels in the rows above the highest vertex of the head bone (the head, its ears and its nose; the antlers are on the hat bone). */
    const above = (key: string): number => {
      const m = build(key), f = frames[outlineFrame(key)], head = BONES.indexOf('head');
      let top = 0;
      for (let v = 0; v < m.position.length / 3; v++) if (m.skin[v * 4] === head) top = Math.max(top, m.position[v * 3 + 1]);
      let n = 0;
      for (let y = 0; y < f.h - Math.ceil(top); y++) for (let x = 0; x < f.w; x++) if (alpha(f.x + x, f.y + y)) n++;
      return n;
    };
    expect(above('stag')).toBeGreaterThan(0);
    expect(above('deer')).toBe(0);
  });
});

describe('buildModelOutlines, the built figures (#358)', () => {
  it('has model_lich, as tall as the figure at rest, with the collar or skull on top and the hem on the bottom row', () => {
    const f = frames['model_lich'];
    expect(f).toBeDefined();
    expect(Object.keys(frames).length).toBe(keys.length + 2);   // the lich and the demon
    expect(f.h).toBe(Math.ceil(LICH_TOP * LICH.unit));
    expect(f.w % 2).toBe(0);
    expect(f.w).toBeGreaterThanOrEqual(11);
    let top = 0, bottom = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (alpha(f.x + x, f.y + y)) (y < f.h / 4 ? top++ : 0, y === f.h - 1 ? bottom++ : 0);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
  });

  it('has model_demon (#379): the standing demon with its wings, taller and far wider than its 54 px body, feet on the bottom rows', () => {
    const f = frames['model_demon'];
    expect(f).toBeDefined();
    expect(f.h).toBeGreaterThanOrEqual(54);
    expect(f.w % 2).toBe(0);
    expect(f.w).toBeGreaterThan(54);
    expect(f.w).toBeLessThanOrEqual(WIDTH);
    let low = 0;
    for (let y = f.h - 4; y < f.h; y++) for (let x = 0; x < f.w; x++) if (alpha(f.x + x, f.y + y)) low++;
    expect(low).toBeGreaterThan(0);
  });
});
