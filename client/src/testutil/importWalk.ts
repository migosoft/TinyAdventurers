// Test helper: reads the import graph of the client sources (used by the tests that guard what a module may import).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SRC = join(__dirname, '..');

/** Import specifiers of a source text: static, `export … from` and dynamic `import()`; `import type` is skipped. */
export function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport\s*(type\b)?\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+(type\b)?[^'"()]*?\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) if (!m[1] && !m[2]) out.push(m[3]);
  return out;
}

export const read = (f: string): string => readFileSync(join(SRC, f), 'utf8');
