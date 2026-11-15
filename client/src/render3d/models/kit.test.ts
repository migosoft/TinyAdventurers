import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKit, directRunner, type BuildRunner } from './kit';
import type { FigureModel } from './model';

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const stub = (key: string): FigureModel => ({ key } as FigureModel);
const fake = (log: string[] = []): BuildRunner => async (job) => { log.push(job.key); return stub(job.key); };
const noPixels = (): null => null;

afterEach(() => { vi.restoreAllMocks(); });

describe('createKit', () => {
  it('builds in the background: null first, the model after the build, version up by one per arrival', async () => {
    const kit = createKit(noPixels, fake());
    expect(kit.version).toBe(0);
    expect(kit.get('elf')).toBeNull();
    expect(kit.get('wolf')).toBeNull();
    await settle();
    expect(kit.get('elf')?.key).toBe('elf');
    expect(kit.get('wolf')?.key).toBe('wolf');
    expect(kit.version).toBe(2);
    expect(kit.times.has('elf')).toBe(true);
  });

  it('starts one build per key', async () => {
    const log: string[] = [];
    const kit = createKit(noPixels, fake(log));
    kit.get('elf'); kit.get('elf'); kit.get('skull');
    await settle();
    kit.get('elf');
    expect(log.sort()).toEqual(['elf', 'skull']);
  });

  it('an unknown key stays null, known is false, and one warning is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: string[] = [];
    const kit = createKit(noPixels, fake(log));
    expect(kit.known('weapon_lich_staff')).toBe(false);
    for (let i = 0; i < 5; i++) expect(kit.get('weapon_lich_staff')).toBeNull();
    await settle();
    expect(kit.known('elf')).toBe(true);
    expect(kit.known('skull')).toBe(true);
    expect(kit.known('weapon_knight_sword')).toBe(true);
    expect(log).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a weapon without pixels (and without art) cannot be built: null, one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: string[] = [];
    const kit = createKit(noPixels, fake(log));
    expect(kit.known('weapon_knight_sword')).toBe(true);
    for (let i = 0; i < 3; i++) expect(kit.get('weapon_knight_sword')).toBeNull();
    await settle();
    expect(log).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(kit.get('weapon_big_hammer')).toBeNull();
    await settle();
    expect(log).toEqual(['weapon_big_hammer']);
  });

  it('a build that fails stays null, is not retried, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const kit = createKit(noPixels, async () => { calls++; throw new Error('boom'); });
    for (let i = 0; i < 3; i++) expect(kit.get('elf')).toBeNull();
    await settle();
    for (let i = 0; i < 3; i++) expect(kit.get('elf')).toBeNull();
    await settle();
    expect(calls).toBe(1);
    expect(kit.version).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a runner that throws at once is handled the same way', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kit = createKit(noPixels, () => { throw new Error('sync boom'); });
    expect(kit.get('elf')).toBeNull();
    expect(kit.get('elf')).toBeNull();
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('dispose makes late arrivals do nothing', async () => {
    const kit = createKit(noPixels, fake());
    expect(kit.get('elf')).toBeNull();
    kit.dispose();
    await settle();
    expect(kit.version).toBe(0);
    expect(kit.get('elf')).toBeNull();
    expect(kit.times.size).toBe(0);
  });

  it('builds a real model with the direct runner and measures the build', async () => {
    const kit = createKit(noPixels, directRunner);
    expect(kit.get('skull')).toBeNull();
    await settle();
    const m = kit.get('skull');
    expect(m).not.toBeNull();
    expect(m!.key).toBe('skull');
    expect(m!.position.length).toBeGreaterThan(0);
    expect(kit.version).toBe(1);
    expect(kit.times.get('skull')!).toBeGreaterThan(0);
  });

  it('builds the redrawn hammer without sprite pixels', async () => {
    const kit = createKit(noPixels, directRunner);
    kit.get('weapon_big_hammer');
    await settle();
    expect(kit.get('weapon_big_hammer')?.key).toBe('weapon_big_hammer');
  });
});
