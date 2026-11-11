import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import type { Ev } from '../generated/Ev';
import type { RunStartInfo } from '../generated/RunStartInfo';
import { NO_INPUT } from './input';
import { RunSession } from './session';
import { fakeHud, fakeNet, fakeView, snap, startInfo } from './testing';

const ROWS = ['#####', '#...#', '#####'];

function make(over: Partial<RunStartInfo> = {}) {
  const net = fakeNet();
  const hud = fakeHud();
  const info = startInfo(ROWS, over);
  const session = new RunSession({ info, net, hud, myClass: 'Wizard', input: () => NO_INPUT });
  return { net, hud, info, session };
}

const tile = (x: number, y: number, v: number): Ev => ({ t: 'Tile', x, y, v });

describe('RunSession messages', () => {
  it('a Tile event changes the map, then reaches the view', () => {
    const { net, session } = make();
    const view = fakeView();
    let seen = -1;
    view.onTile = (x, y) => {
      seen = session.map.get(x, y);
    };
    session.setView(view);
    net.emit(snap({ ev: [tile(2, 1, TILE_ID.DoorClosed)] }));
    expect(seen).toBe(TILE_ID.DoorClosed);
    expect(view.tiles).toEqual([[2, 1, TILE_ID.DoorClosed]]);
  });

  it('a Tile event without a view still changes the map', () => {
    const { net, session } = make();
    net.emit(snap({ ev: [tile(2, 1, TILE_ID.DoorClosed)] }));
    expect(session.map.get(2, 1)).toBe(TILE_ID.DoorClosed);
    expect(session.viewInit().map).toBe(session.map);
  });

  it('two sealed entrance tiles announce the force field once', () => {
    const { net, hud } = make();
    net.emit(snap({ ev: [tile(1, 1, TILE_ID.DoorClosed), tile(2, 1, TILE_ID.DoorClosed)] }));
    const said = hud.calls.filter((c) => c[0] === 'message' && c[1] === 'A force field seals the hall behind you!');
    expect(said).toEqual([['message', 'A force field seals the hall behind you!', 'game']]);
  });

  it('HeroChanged reaches the predictor and the HUD', () => {
    const { net, hud, info, session } = make();
    const abilities = info.abilities;
    net.emit({ t: 'HeroChanged', speed: 99, abilities, fallback: info.fallback, disabled: [null, null] });
    expect(hud.calls).toContainEqual(['setAbilities', abilities, [null, null]]);
    expect(session.info.speed).toBe(99);
  });

  it('picture events go to the view, state events do not', () => {
    const { net, hud, session } = make();
    const view = fakeView();
    session.setView(view);
    net.emit(snap({ ev: [{ t: 'Dmg', x: 1, y: 1, v: 3, crit: false, p: false, ty: 0, imm: false }, { t: 'Light', id: 1, on: true, colour: 0xffffff }, { t: 'Msg', text: 'hi' }] }));
    expect(view.events.length).toBe(1);
    expect(view.events[0].t).toBe('Dmg');
    expect(hud.calls.filter((c) => c[0] === 'message' && c[1] === 'hi').length).toBe(1);
  });

  it('Coins reach the view and, while alive, the HUD', () => {
    const { net, hud, session } = make();
    const view = fakeView();
    session.setView(view);
    net.emit(snap({ ev: [{ t: 'Coins', x: 1, y: 1, v: 5 }] }));
    expect(hud.calls.filter((c) => c[0] === 'addCoins')).toEqual([['addCoins', 5]]);
    const dead = snap({ ev: [{ t: 'Coins', x: 1, y: 1, v: 7 }] });
    dead.me.alive = false;
    net.emit(dead);
    expect(hud.calls.filter((c) => c[0] === 'addCoins').length).toBe(1);
    expect(view.events.filter((e) => e.t === 'Coins').length).toBe(2);
  });

  it('dying shows the fallen message once', () => {
    const { net, hud, session } = make();
    const dead = snap();
    dead.me.alive = false;
    net.emit(dead);
    net.emit(dead);
    expect(hud.calls.filter((c) => c[0] === 'message')).toEqual([['message', 'You have fallen. Q / E to watch your party.']]);
    expect(session.alive).toBe(false);
  });

  it('debug keys are ignored outside a debug run', () => {
    const off = make({ debug: false });
    off.session.debugImmortal();
    expect(off.net.sent).toEqual([]);
    const on = make({ debug: true });
    on.session.debugImmortal();
    expect(on.net.sent).toEqual([{ t: 'DebugImmortal', on: false }]);
  });

  it('destroy unsubscribes', () => {
    const { net, hud, session } = make();
    session.destroy();
    hud.calls.length = 0;
    net.emit(snap());
    expect(hud.calls).toEqual([]);
  });
});
