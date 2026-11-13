// Test helper: reads the import graph of the client sources (used by the tests that keep Phaser out of a module).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SRC = join(__dirname, '..');

/** Import specifiers of a source text: static, `export … from` and dynamic `import()`; `import type` is skipped. */
export function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport\s*(type\b)?\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+(type\b)?[^'"()]*?\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) if (!m[1] && !m[2]) out.push(m[3]);
  return out;
}

export function resolve(from: string, spec: string): string | null {
  const base = join(dirname(from), spec);
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(join(SRC, c))) return c;
  return null;
}

/** A relative import of a non-code file; no code in it can reach phaser. */
export const isAsset = (spec: string): boolean => /\.(css|png|json|wgsl|glsl|svg)$/.test(spec.split('?')[0]);

export const read = (f: string): string => readFileSync(join(SRC, f), 'utf8');

/** The first chain of non-type imports from `file` (relative to src) to `phaser`, or null. */
export function reachesPhaser(file: string, seen = new Set<string>()): string[] | null {
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
