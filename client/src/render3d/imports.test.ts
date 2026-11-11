import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname);
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const ALLOWED = new Set(['three/webgpu', 'three/tsl', '../ui/atlas', '../game/frameTimer']);

function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s[^'"()]*?\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

describe('render3d imports', () => {
  it('holds the module files', () => {
    expect(files).toContain('boot.ts');
  });
  it('imports only three/webgpu, three/tsl, local files and the two allowed outside modules', () => {
    for (const f of files) {
      for (const s of specifiers(readFileSync(join(dir, f), 'utf8'))) {
        expect(s.startsWith('./') || ALLOWED.has(s), `${f} imports ${s}`).toBe(true);
      }
    }
  });
  it('keeps the two outside modules free of imports, so they cannot pull Phaser into the 3D view', () => {
    for (const f of ['../ui/atlas.ts', '../game/frameTimer.ts']) {
      expect(
        specifiers(readFileSync(join(dir, f), 'utf8')),
        `${f} has an import: check that it cannot pull Phaser into the 3D view, then update this test`,
      ).toEqual([]);
    }
  });
  it('main.ts has no static import of render3d', () => {
    const src = readFileSync(join(dir, '..', 'main.ts'), 'utf8');
    const stat = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(stat.filter((s) => s.includes('render3d'))).toEqual([]);
  });
});
