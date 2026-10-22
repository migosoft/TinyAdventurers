// Pins the client hooks of the rules log (the table in the plan): outside
// `src/rulesLog/` and `src/generated/`, only GameScene.ts and wire.ts may name the module.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p === join(SRC, 'rulesLog') || p === join(SRC, 'generated')) continue;
      walk(p, out);
    } else if (e.name.endsWith('.ts')) out.push(p);
  }
}

describe('rules log boundary', () => {
  it('is reached only through its hooks', () => {
    const files: string[] = [];
    walk(SRC, files);
    // Lines containing `rulesLog` (case-sensitive; the import path '../rulesLog' counts too), per file.
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('rulesLog')).length;
      if (n > 0) found[relative(SRC, f)] = n;
    }
    // GameScene: import, field, create, onSnapshot, cleanup + draw = 6.
    expect(found).toEqual({ 'game/GameScene.ts': 6 });
  });

  it('wire.ts passes the raw log element through once', () => {
    const src = readFileSync(join(SRC, 'wire.ts'), 'utf8');
    expect(src.split('w[10]').length - 1).toBe(1);
  });
});
