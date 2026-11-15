import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKit, directRunner, workerRunner, type BuildRunner, type FigureKit } from './kit';
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

  it('a sprite lookup that throws gives null and one warning, not an exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: string[] = [];
    const kit = createKit(() => { throw new Error('no atlas'); }, fake(log));
    for (let i = 0; i < 3; i++) expect(kit.get('weapon_knight_sword')).toBeNull();
    await settle();
    expect(log).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/** A stand-in for the browser's Worker: records what is sent and lets the test answer. */
class FakeWorker {
  static all: FakeWorker[] = [];
  static throwOnNew = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: { id: number; key: string }[] = [];
  terminate = vi.fn();
  constructor() { if (FakeWorker.throwOnNew) throw new Error('no module workers'); FakeWorker.all.push(this); }
  postMessage(m: { id: number; key: string }): void { this.sent.push(m); }
  reply(id: number, model: FigureModel, ms: number): void { this.onmessage?.({ data: { id, model, ms } }); }
}

describe('workerRunner', () => {
  afterEach(() => { vi.unstubAllGlobals(); FakeWorker.all = []; FakeWorker.throwOnNew = false; });
  const setup = (): { kit: FigureKit; w: FakeWorker } => {
    vi.stubGlobal('Worker', FakeWorker);
    const kit = createKit(noPixels, workerRunner());
    return { kit, w: FakeWorker.all[0] };
  };

  it('matches replies to requests by id and reports the worker\'s build time', async () => {
    const { kit, w } = setup();
    kit.get('elf'); kit.get('wolf');
    await settle();
    expect(w.sent.map((m) => m.key)).toEqual(['elf', 'wolf']);
    w.reply(w.sent[1].id, stub('wolf'), 42);
    w.reply(w.sent[0].id, stub('elf'), 17);
    await settle();
    expect(kit.get('wolf')?.key).toBe('wolf');
    expect(kit.get('elf')?.key).toBe('elf');
    expect(kit.times.get('wolf')).toBe(42);
    expect(kit.times.get('elf')).toBe(17);
    expect(kit.version).toBe(2);
  });

  it('a build error from the worker warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { kit, w } = setup();
    kit.get('elf');
    w.onmessage?.({ data: { id: w.sent[0].id, error: 'bad' } });
    await settle();
    expect(kit.get('elf')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('after onerror pending and later jobs fail, one warning per key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { kit, w } = setup();
    kit.get('elf');
    w.onerror?.({ message: 'load failed' });
    await settle();
    kit.get('elf'); kit.get('wolf'); kit.get('wolf');
    await settle();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(w.sent.length).toBe(1);
    expect(kit.version).toBe(0);
  });

  it('messageerror fails the same way', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { kit, w } = setup();
    kit.get('elf');
    w.onmessageerror?.();
    await settle();
    kit.get('wolf');
    await settle();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a Worker that cannot be created fails every job once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    FakeWorker.throwOnNew = true;
    vi.stubGlobal('Worker', FakeWorker);
    const kit = createKit(noPixels, workerRunner());
    kit.get('elf'); kit.get('elf'); kit.get('wolf');
    await settle();
    expect(kit.get('elf')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('dispose terminates the worker and rejects nothing visibly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { kit, w } = setup();
    kit.get('elf');
    kit.dispose();
    await settle();
    expect(w.terminate).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(kit.version).toBe(0);
  });
});
