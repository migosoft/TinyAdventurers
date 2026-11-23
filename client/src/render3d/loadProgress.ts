// The loading screen's progress: weighted steps of the stage's build, the line of the first unfinished one.

export interface LoadParts {
  assets: boolean; // the host has its assets and the stage exists
  cover: number; // 0..1
  stone: number | null; // 0..1, null: the level has no stone
  trees: number | null; // 0..1, null: no forest
  warmFrames: number; // full frames drawn after everything above is done
  waiting: { ready: number; total: number } | null; // the last `Loading`, null before one
}

export const WARM_FRAMES = 2;
export const LOAD_WEIGHTS = { assets: 0.1, cover: 0.3, stone: 0.3, trees: 0.25, shaders: 0.05 };

export function loadState(p: LoadParts): { fraction: number; line: string; ready: boolean } {
  const steps: { weight: number; progress: number; line: string }[] = [
    { weight: LOAD_WEIGHTS.assets, progress: p.assets ? 1 : 0, line: 'Loading assets…' },
    { weight: LOAD_WEIGHTS.cover, progress: p.cover, line: 'Building the map…' },
  ];
  if (p.stone !== null) steps.push({ weight: LOAD_WEIGHTS.stone, progress: p.stone, line: 'Building the map…' });
  if (p.trees !== null) steps.push({ weight: LOAD_WEIGHTS.trees, progress: p.trees, line: 'Growing the trees…' });
  steps.push({
    weight: LOAD_WEIGHTS.shaders,
    progress: Math.min(p.warmFrames, WARM_FRAMES) / WARM_FRAMES,
    line: 'Preparing shaders…',
  });
  const total = steps.reduce((a, s) => a + s.weight, 0);
  const open = steps.find((s) => s.progress < 1);
  if (!open) {
    const w = p.waiting;
    return {
      fraction: 1,
      line: w ? `Waiting for players (${w.ready} of ${w.total} ready)…` : 'Waiting for players…',
      ready: true,
    };
  }
  return { fraction: steps.reduce((a, s) => a + s.weight * s.progress, 0) / total, line: open.line, ready: false };
}
