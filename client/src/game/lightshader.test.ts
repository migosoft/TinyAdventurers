import { describe, expect, it, vi } from 'vitest';
import { catmullRom } from './lightview';
import { lightFrag, packDv, packTile } from './lightshader';

vi.mock('phaser', () => ({ default: {} }));

/** The four weight expressions inside `vec4(...)` of the GLSL `catmullRom`, split at top-level commas. */
function glslWeights(src: string): string[] {
  const m = /vec4 catmullRom\(float t\)\s*\{[\s\S]*?return vec4\(([\s\S]*?)\);\s*\}/.exec(src);
  expect(m).not.toBeNull();
  const body = m![1];
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(body.slice(from).trim());
  return parts;
}

describe('texel packing', () => {
  it('packTile writes r, g, b, dark at texel i, rounded and clamped', () => {
    const d = new Uint8Array(12);
    packTile(d, 1, 255, 140.6, -3, 300);
    expect(Array.from(d.slice(4, 8))).toEqual([255, 141, 0, 255]);
    expect(Array.from(d.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(d.slice(8, 12))).toEqual([0, 0, 0, 0]);
  });
  it('packDv writes the strength in red, alpha 255', () => {
    const d = new Uint8Array(4);
    packDv(d, 0, 127.6);
    expect(Array.from(d)).toEqual([128, 0, 0, 255]);
  });
});

describe('light fragment source', () => {
  it("the GLSL weights are catmullRom's", () => {
    for (const dv of [false, true]) {
      const w = glslWeights(lightFrag(dv));
      expect(w).toHaveLength(4);
      const fns = w.map((e) => new Function('t', 't2', 't3', 'return ' + e) as (t: number, t2: number, t3: number) => number);
      for (const t of [0, 0.25, 0.5, 0.75, 0.9]) {
        const want = catmullRom(t);
        fns.forEach((f, k) => expect(f(t, t * t, t * t * t)).toBeCloseTo(want[k], 12));
      }
    }
    expect(glslWeights(lightFrag(true))).toEqual(glslWeights(lightFrag(false)));
  });
  it('the darkvision variant defines DV and the light variant does not', () => {
    expect(lightFrag(true)).toContain('#define DV');
    expect(lightFrag(false)).not.toContain('#define DV');
  });
  it('blackens fully dark tiles in the light branch only, not in the darkvision branch', () => {
    const src = lightFrag(false);
    const dvBranch = src.slice(src.indexOf('#ifdef DV'), src.indexOf('#else'));
    const lightBranch = src.slice(src.indexOf('#else'), src.indexOf('#endif'));
    expect(dvBranch).toContain('sum.r');
    expect(dvBranch).not.toContain('254.5');
    expect(lightBranch).toContain('254.5');
  });
});
