import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = join(__dirname, '..');
const listTs = (d: string) => readdirSync(join(SRC, d)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const render3d = listTs('render3d').map((f) => `render3d/${f}`);
const run = listTs('run').map((f) => `run/${f}`);

/** Import specifiers of a source text: static, `export … from` and dynamic `import()`; `import type` is skipped. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport\s*(type\b)?\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+(type\b)?[^'"()]*?\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) if (!m[1] && !m[2]) out.push(m[3]);
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = join(dirname(from), spec);
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(join(SRC, c))) return c;
  return null;
}

/** A relative import of a non-code file; no code in it can reach phaser. */
const isAsset = (spec: string): boolean => /\.(css|png|json|wgsl|glsl|svg)$/.test(spec.split('?')[0]);

const read = (f: string) => readFileSync(join(SRC, f), 'utf8');

/** The first chain of non-type imports from `file` to `phaser`, or null. */
function reachesPhaser(file: string, seen = new Set<string>()): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const s of specifiers(read(file))) {
    if (s === 'phaser' || s.startsWith('phaser/')) return [file, 'phaser'];
    if (!s.startsWith('.')) continue;
    const next = resolve(file, s);
    if (!next) {
      // An unresolved import must not stop the walk silently: only a known asset (a Vite `?raw` or `?url` included) may be skipped.
      if (isAsset(s)) continue;
      return [file, `unresolved import '${s}'`];
    }
    const chain = reachesPhaser(next, seen);
    if (chain) return [file, ...chain];
  }
  return null;
}

const bare = (f: string) => specifiers(read(f)).filter((s) => !s.startsWith('.'));

describe('run and render3d imports', () => {
  it('holds the module files', () => {
    expect(render3d).toContain('render3d/boot.ts');
    expect(run).toContain('run/view.ts');
  });
  it('no file in run/ or render3d/ reaches phaser through non-type imports', () => {
    for (const f of [...run, ...render3d]) {
      const chain = reachesPhaser(f);
      expect(chain && chain.join(' > '), `${f} reaches phaser`).toBeNull();
    }
  });
  it('render3d/ uses only three/webgpu and three/tsl as bare specifiers', () => {
    for (const f of render3d) for (const s of bare(f)) expect(['three/webgpu', 'three/tsl'], `${f} imports ${s}`).toContain(s);
  });
  it('run/ has no bare specifier at all', () => {
    for (const f of run) expect(bare(f), f).toEqual([]);
  });
  it('the files the session and the 3D view import do not reach phaser', () => {
    for (const f of ['game/useHint.ts', 'game/terrain-layers.ts', 'game/world.ts', 'game/light.ts', 'game/anim/lying.ts', 'game/anim/pose.ts', 'game/anim/figureState.ts', 'game/objectPose.ts', 'game/woodland/ground.ts', 'ui/hud.ts', 'net.ts']) {
      const chain = reachesPhaser(f);
      expect(chain && chain.join(' > '), `${f} reaches phaser`).toBeNull();
    }
  });
  it('main.ts has no static import of render3d', () => {
    const stat = [...read('main.ts').matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(stat.filter((s) => s.includes('render3d'))).toEqual([]);
  });
});
