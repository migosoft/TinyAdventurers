// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import type { ClientMsg } from '../generated/ClientMsg';
import { fakeNet, startInfo } from '../run/testing';
import { RulesLog } from '.';

const made: RulesLog[] = [];
function make() {
  const net = fakeNet();
  const log = new RulesLog(net, startInfo(['#####', '#...#', '#####']), null);
  made.push(log);
  return { net, log };
}
const logMsgs = (sent: ClientMsg[]) => sent.filter((m) => m.t === 'RulesLog');
const key = (shiftKey = false, repeat = false) => ({ shiftKey, repeat });
const hero = { id: 1, kind: KIND.Wizard, extra: 0, side: 2 };

afterEach(() => {
  while (made.length) made.pop()!.destroy();
  document.body.innerHTML = '';
});

describe('RulesLog without Phaser', () => {
  it('L turns the log on and asks the server', () => {
    const { net, log } = make();
    expect(log.on).toBe(false);
    log.key(key());
    expect(log.on).toBe(true);
    expect(logMsgs(net.sent)).toEqual([{ t: 'RulesLog', on: true, details: true }]);
  });

  it('Shift+L flips the calculation lines', () => {
    const { net, log } = make();
    log.key(key(true));
    expect(log.on).toBe(false);
    expect(logMsgs(net.sent)).toEqual([{ t: 'RulesLog', on: false, details: false }]);
  });

  it('a repeat does nothing', () => {
    const { net, log } = make();
    log.key(key(false, true));
    expect(log.on).toBe(false);
    expect(net.sent).toEqual([]);
  });

  it('tagOf is null while the log is off', () => {
    const { log } = make();
    expect(log.tagOf(hero)).toBeNull();
    log.key(key());
    expect(log.tagOf(hero)).toBe('Hero');
    log.key(key());
    expect(log.tagOf(hero)).toBeNull();
  });

  it('destroy removes the panel', () => {
    const { log } = make();
    expect(document.querySelector('.rules-log')).not.toBeNull();
    log.destroy();
    expect(document.querySelector('.rules-log')).toBeNull();
  });
});
