import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { reachesPhaser, read, specifiers, SRC } from '../testutil/importWalk';

const listTs = (d: string) => readdirSync(join(SRC, d)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const render3d = listTs('render3d').map((f) => `render3d/${f}`);
const run = listTs('run').map((f) => `run/${f}`);

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
