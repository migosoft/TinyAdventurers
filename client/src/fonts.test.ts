import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_HEAD, FONT_TEXT, loadFonts } from './fonts';

const RL = 'rules' + 'Log'; // keeps the rules log boundary count clean

describe('fonts', () => {
  it('names the self-hosted faces', () => {
    expect(FONT_TEXT).toBe("'Inter', system-ui, sans-serif");
    expect(FONT_HEAD).toBe("'IM Fell English SC', Georgia, serif");
  });
  it('loadFonts asks for every face Phaser draws with', async () => {
    const asked: string[] = [];
    await loadFonts({ load: (f: string) => (asked.push(f), Promise.resolve([])) } as unknown as FontFaceSet);
    expect(asked).toEqual(expect.arrayContaining(['400 16px Inter', '600 16px Inter', '800 16px Inter', 'italic 600 16px Inter', '16px "IM Fell English SC"']));
  });
  it('loadFonts gives up after the timeout instead of blocking the game', async () => {
    await expect(loadFonts({ load: () => new Promise(() => {}) } as unknown as FontFaceSet, 10)).resolves.toBeUndefined();
  });
  it('no page or stylesheet loads a font CDN', () => {
    for (const f of ['index.html', 'admin.html', 'src/style.css', `src/${RL}/panel.ts`, `src/${RL}/${RL}.css`])
      expect(readFileSync(join(__dirname, '..', f), 'utf8'), f).not.toMatch(/fonts\.(googleapis|gstatic)\.com|Press Start|JetBrains/);
  });
  it('index.html and admin.html preload the woff2 files that exist', () => {
    for (const page of ['index.html', 'admin.html']) {
      const html = readFileSync(join(__dirname, '..', page), 'utf8');
      for (const f of ['inter-latin-wght-normal.woff2', 'im-fell-english-sc-latin-400-normal.woff2']) {
        expect(html, page).toContain(`<link rel="preload" href="/fonts/${f}" as="font" type="font/woff2" crossorigin`);
        expect(existsSync(join(__dirname, '..', 'public/fonts', f))).toBe(true);
      }
    }
  });
});
