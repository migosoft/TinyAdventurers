// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Atlas } from './atlas';
import type { ClientMsg } from '../generated/ClientMsg';
import type { Net } from '../net';
import type { Pick } from '../generated/Pick';
import type { PoolCard } from '../generated/PoolCard';
import { fixtureInfo } from './hub/fixture';
import { debugReject, debugWeapons, isBuildRefusal, isDebugGuardError, Lobby, pickOptionLabel } from './lobby';

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ imageSmoothingEnabled: false, clearRect() {}, drawImage() {} } as unknown as CanvasRenderingContext2D);
const atlas = { img: new Image(), frames: new Proxy({}, { get: () => ({ frame: { x: 0, y: 0, w: 16, h: 16 } }) }) } as unknown as Atlas;
const own = (ability: Pick['ability']): Pick => ({ ability, source: 'Own' });
const card = (pick: Pick, o: Partial<PoolCard> = {}): PoolCard => ({ pick, ability: null, error: null, locked: false, ...o });
const pool = [card(own('MagicMissile')), card(own('FrostShard'), { error: 'Frost Shard needs INT 14.' }), card(own('Fireball')), card(own('FrostNova'), { locked: true })];

let sent: ClientMsg[];
function make(debug = false): Lobby {
  sent = [];
  // The URL says debug whatever the account is: only the flag from Welcome counts.
  window.history.replaceState(null, '', '/?debug&boss=dragon');
  document.body.replaceChildren();
  const net = { send: (m: ClientMsg) => sent.push(m) } as unknown as Net;
  const l = new Lobby(document.body, net, atlas, () => {});
  l.myId = 2;
  l.debug = debug;
  l.show();
  return l;
}
const player = (id: number, ready: boolean, cls: 'Wizard' | 'Barbarian' = 'Barbarian') => ({
  id,
  name: `P${id}`,
  class: cls,
  ready,
  loadout: { primary: own(cls === 'Wizard' ? 'MagicMissile' : 'Strike'), secondary: own(cls === 'Wizard' ? 'Fireball' : 'Charge') },
  weapons: cls === 'Wizard' ? ['RedStaff'] : ['WarHammer', 'ThrowingAxes'],
});
function inRoom(l: Lobby, meReady: boolean): void {
  l.setCharacter(fixtureInfo('Wizard', { pool }));
  l.setRoom({ run_id: 5, name: 'Run', host: 1, level: 'Level1', boss: null, players: [player(1, true), player(2, meReady, 'Wizard')] } as never);
}
const sel = (name: string) => document.querySelector<HTMLSelectElement>(`[data-own="${name}"]`);
afterEach(() => window.history.replaceState(null, '', '/'));

const NONE = { loadout: false, melee: false, ranged: false };
const ALL = { loadout: true, melee: true, ranged: true };

describe('debugWeapons', () => {
  it('lists the weapons a class is trained in, per slot', () => {
    const barbMelee = debugWeapons('Barbarian', 'Melee');
    expect(barbMelee).toContain('WarHammer');
    expect(barbMelee).toContain('GreatAxe');
    expect(barbMelee).not.toContain('RedStaff');
    expect(debugWeapons('Barbarian', 'Ranged')).toEqual(['ThrowingAxes']);
  });
  it('leaves out weapons of a kind the class is not proficient with', () => {
    expect(debugWeapons('Wizard', 'Melee')).not.toContain('WarHammer');
    expect(debugWeapons('Wizard', 'Ranged')).toEqual([]);
    expect(debugWeapons('ElvenRanger', 'Ranged')).not.toContain('ThrowingAxes');
  });
});

describe('isDebugGuardError', () => {
  it('knows the messages that mean the debug pick was never stored', () => {
    for (const m of ['Debug is off.', 'Join a dungeon first.', 'Not during a run.', 'Not while ready.', 'Choose a character first.', 'Only weapons.']) {
      expect(isDebugGuardError(m), m).toBe(true);
    }
    expect(isDebugGuardError('You are not trained in Hammer.')).toBe(false);
  });
});

describe('debugReject', () => {
  it('does nothing when the user changed no debug pick', () => {
    for (const m of ['Not everyone is ready yet.', 'Debug is off.', 'Strike needs STR 20.']) {
      expect(debugReject(m, NONE, [])).toEqual({ reset: NONE, resend: NONE });
    }
  });
  it('ignores errors that are not about a pick', () => {
    expect(debugReject('Not everyone is ready yet.', ALL, ['Bob'])).toEqual({ reset: NONE, resend: NONE });
  });
  it('resets a pick the guards refused, and sends nothing', () => {
    expect(debugReject('Debug is off.', { ...NONE, ranged: true }, [])).toEqual({ reset: { ...NONE, ranged: true }, resend: NONE });
  });
  it('resets and resends only the picks the user changed when the sheet refuses them', () => {
    const touched = { ...NONE, melee: true };
    expect(debugReject('The item in the melee slot needs STR 20.', touched, [])).toEqual({ reset: touched, resend: touched });
    expect(debugReject('Ground Slam needs STR 17.', { ...NONE, loadout: true }, [])).toEqual({ reset: { ...NONE, loadout: true }, resend: { ...NONE, loadout: true } });
  });
  it('leaves my picks alone when the error is another player\'s build', () => {
    expect(debugReject('Bob: Ground Slam needs STR 17.', ALL, ['Bob'])).toEqual({ reset: NONE, resend: NONE });
  });
});

describe('isBuildRefusal', () => {
  it('is true for build refusals and debug guards, false for other errors', () => {
    expect(isBuildRefusal('Frost Shard needs INT 14.')).toBe(true);
    expect(isBuildRefusal('Not while ready.')).toBe(true);
    expect(isBuildRefusal('That run is full.')).toBe(false);
  });
});

describe('Lobby', () => {
  it('keeps a half-typed run name when an unrelated error arrives', () => {
    const l = make();
    document.querySelector<HTMLInputElement>('#runname')!.value = 'abc';
    l.error('That run is full.');
    expect(document.querySelector<HTMLInputElement>('#runname')!.value).toBe('abc');
    expect(document.querySelector('.error')!.textContent).toBe('That run is full.');
  });
  it('shows the own loadout selects while not ready, listing the non-locked cards with the reason', () => {
    const l = make();
    inRoom(l, false);
    expect(document.querySelectorAll('[data-own]').length).toBe(2);
    const opts = [...sel('Primary')!.options].map((o) => o.textContent);
    expect(opts).toEqual(['Magic Missile', 'Frost Shard (needs INT 14.)']);
    expect([...sel('Secondary')!.options].map((o) => o.textContent)).toEqual(['Fireball']);
  });
  it('sends SetLoadout with the other select\'s pick when one changes', () => {
    const l = make();
    inRoom(l, false);
    const p = sel('Primary')!;
    p.value = JSON.stringify(own('FrostShard'));
    p.dispatchEvent(new Event('change'));
    expect(sent).toEqual([{ t: 'SetLoadout', primary: own('FrostShard'), secondary: own('Fireball') }]);
  });
  it('shows no selects once ready', () => {
    const l = make();
    inRoom(l, true);
    expect(document.querySelectorAll('[data-own]').length).toBe(0);
  });
  it('draws one weapon icon per weapon in the other rows', () => {
    const l = make();
    inRoom(l, false);
    const rows = document.querySelectorAll('.players li');
    expect(rows[0].querySelectorAll('.wp canvas, .wp .ui-letter').length).toBe(2);
    expect(rows[1].classList.contains('me')).toBe(true);
    expect(document.querySelector('.players li kbd')!.textContent).toBe('LMB');
  });
  it('lets the debug row follow a real SetLoadout', () => {
    const l = make(true);
    inRoom(l, false);
    const dbg = () => document.querySelector<HTMLSelectElement>('.debug-loadout [data-slot="primary"]')!;
    expect(dbg().value).toBe('MagicMissile');
    const p = sel('Primary')!;
    p.value = JSON.stringify(own('FrostShard'));
    p.dispatchEvent(new Event('change'));
    expect(dbg().value).toBe('FrostShard');
  });
});

describe('debug UI', () => {
  it('follows the account flag, not the URL', () => {
    const off = make(false);
    inRoom(off, false);
    expect(document.querySelector('.debug-loadout')).toBeNull();
    expect(sent.some((m) => m.t === 'SelectBoss')).toBe(false);
    const on = make(true);
    inRoom(on, false);
    expect(document.querySelector('.debug-loadout')).not.toBeNull();
    expect(sent.some((m) => m.t === 'SelectBoss')).toBe(false);
  });
  it('titles the room list for debug accounts', () => {
    const l = make(true);
    l.setCharacter(fixtureInfo('Wizard', { pool }));
    l.setRuns([]);
    expect(document.querySelector('h2')!.textContent).toBe('Debug dungeons');
  });
});

describe('pickOptionLabel', () => {
  it('adds the needs part, the whole error otherwise, nothing without one', () => {
    expect(pickOptionLabel('Frost Shard', 'Frost Shard needs INT 14.')).toBe('Frost Shard (needs INT 14.)');
    expect(pickOptionLabel('Strike', 'Strike is not one of your abilities.')).toBe('Strike (Strike is not one of your abilities.)');
    expect(pickOptionLabel('Fireball', null)).toBe('Fireball');
  });
});

describe('Lobby with a saved pick that left the pool', () => {
  it('keeps it selected as unavailable, and the other select sends it unchanged', () => {
    const l = make();
    const info = fixtureInfo('Wizard', { pool: [card(own('FrostShard')), card(own('Fireball')), card(own('Fireball'))] });
    l.setCharacter(info); // saved primary MagicMissile is not in the pool
    l.setRoom({ run_id: 5, name: 'Run', host: 1, level: 'Level1', boss: null, players: [player(1, true), player(2, false, 'Wizard')] } as never);
    const p = sel('Primary')!;
    expect(p.selectedOptions[0].textContent).toBe('Magic Missile (unavailable)');
    const s = sel('Secondary')!;
    s.dispatchEvent(new Event('change'));
    expect(sent).toEqual([{ t: 'SetLoadout', primary: own('MagicMissile'), secondary: own('Fireball') }]);
  });
});
