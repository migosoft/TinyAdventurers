import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { read, specifiers, SRC } from '../testutil/importWalk';

const listTs = (d: string) => readdirSync(join(SRC, d)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
/** Every non-test .ts file under `d` (relative to src), subdirectories included. */
const walkTs = (d: string): string[] =>
  readdirSync(join(SRC, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkTs(`${d}/${e.name}`) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.testutil.ts') ? [`${d}/${e.name}`] : [],
  );
const render3d = walkTs('render3d');
const run = listTs('run').map((f) => `run/${f}`);

const bare = (f: string) => specifiers(read(f)).filter((s) => !s.startsWith('.'));

describe('run and render3d imports', () => {
  it('holds the module files', () => {
    expect(render3d).toContain('render3d/boot.ts');
    expect(run).toContain('run/view.ts');
  });
  it('no .ts file under src, tests included, imports phaser', () => {
    const all = (d: string): string[] => readdirSync(join(SRC, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(d ? `${d}/${e.name}` : e.name) : e.name.endsWith('.ts') ? [d ? `${d}/${e.name}` : e.name] : []));
    const users = all('')
      .filter((f) => specifiers(read(f)).some((s) => s === 'phaser' || s.startsWith('phaser/')));
    expect(users).toEqual([]);
  });
  it('package.json lists no phaser dependency', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8'));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('phaser');
  });
  it('main.ts has exactly one dynamic import target, ./render3d/boot', () => {
    const targets = new Set([...read('main.ts').matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
    expect([...targets]).toEqual(['./render3d/boot']);
  });
  it('render3d/ uses only three/webgpu and three/tsl as bare specifiers', () => {
    for (const f of render3d) for (const s of bare(f)) expect(['three/webgpu', 'three/tsl'], `${f} imports ${s}`).toContain(s);
  });
  it('run/ has no bare specifier at all', () => {
    for (const f of run) expect(bare(f), f).toEqual([]);
  });
  it('main.ts has no static import of render3d', () => {
    const stat = [...read('main.ts').matchAll(/^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(stat.filter((s) => s.includes('render3d'))).toEqual([]);
  });
});
