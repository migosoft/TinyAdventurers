// Atlas access for DOM UI (class previews in the lobby).
export interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}

export interface Atlas {
  img: HTMLImageElement;
  frames: Record<string, AtlasFrame>;
}

export async function loadAtlas(): Promise<Atlas> {
  const json = await (await fetch('assets/atlas.json')).json();
  const img = new Image();
  img.src = 'assets/atlas.png';
  await img.decode();
  return { img, frames: json.frames };
}

/** A small pixel-scaled canvas cycling through the pack's `<fig>_idle/run_anim_f0..3`
 * (or `<fig>_anim_f0..3` for figures without idle/run, e.g. the necromancer). */
export function spritePreview(atlas: Atlas, fig: string, scale = 4, extra?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const plain = !atlas.frames[`${fig}_idle_anim_f0`];
  const name = (i: number) => (plain ? `${fig}_anim_f${i % 4}` : `${fig}_${i % 8 < 4 ? 'idle' : 'run'}_anim_f${i % 4}`);
  const f0 = atlas.frames[name(0)].frame;
  const ex = extra ? atlas.frames[extra]?.frame : undefined;
  const w = Math.max(f0.w, 16) + (ex ? 10 : 0);
  c.width = w * scale;
  c.height = f0.h * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  let i = 0;
  const draw = () => {
    if (!c.isConnected && i > 0) return;
    const f = atlas.frames[name(i)].frame;
    ctx.clearRect(0, 0, c.width, c.height);
    // Pack weapon held in front (weapons are drawn pointing up in the pack).
    if (ex) ctx.drawImage(atlas.img, ex.x, ex.y, ex.w, ex.h, (f.w - 2) * scale, c.height - (10 + ex.h * 0.6) * scale, ex.w * scale * 0.6, ex.h * scale * 0.6);
    ctx.drawImage(atlas.img, f.x, f.y, f.w, f.h, 0, c.height - f.h * scale, f.w * scale, f.h * scale);
    i++;
    setTimeout(draw, 140);
  };
  draw();
  return c;
}
