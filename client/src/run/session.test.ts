import { decode, encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { ANIM, CONST, EFFECT, KIND, RUNE_LOOK, TILE_ID } from '../generated/defs';
import type { ClientMsg } from '../generated/ClientMsg';
import type { Ev } from '../generated/Ev';
import type { RunStartInfo } from '../generated/RunStartInfo';
import { NO_INPUT, type StepInput } from './input';
import { RunSession } from './session';
import { ability, fakeHud, fakeNet, fakeView, snap, startInfo } from './testing';

const ROWS = ['#####', '#...#', '#####'];

function make(over: Partial<RunStartInfo> = {}, input: () => StepInput = () => NO_INPUT) {
  const net = fakeNet();
  const hud = fakeHud();
  const info = startInfo(ROWS, over);
  const session = new RunSession({ info, net, hud, myClass: 'Wizard', input });
  session.receive({ t: 'RunBegins' });
  return { net, hud, info, session };
}

const inputs = (net: ReturnType<typeof fakeNet>) => net.sent.filter((m): m is Extract<ClientMsg, { t: 'Input' }> => m.t === 'Input');

const tile = (x: number, y: number, v: number): Ev => ({ t: 'Tile', x, y, v });

describe('RunStarted stone kinds (#380)', () => {
  it('a RunStarted with stone round-trips as the same bytes', () => {
    const stone = Uint8Array.from([0, 1, 1, 0, 1]);
    const back = decode(encode({ ...startInfo(ROWS), stone })) as RunStartInfo;
    expect(back.stone).toBeInstanceOf(Uint8Array);
    expect([...back.stone]).toEqual([0, 1, 1, 0, 1]);
    const { session } = make({ stone: back.stone });
    expect([...session.info.stone]).toEqual([0, 1, 1, 0, 1]);
  });

  it('a RunStarted without the field does not throw', () => {
    const { stone: _stone, ...old } = startInfo(ROWS);
    const back = decode(encode(old)) as RunStartInfo;
    expect(back.stone ?? new Uint8Array(0)).toHaveLength(0);
    expect(() => make({ stone: back.stone })).not.toThrow();
  });
});

describe('RunSession start (#322)', () => {
  it('sends no Input and predicts nothing before RunBegins, then runs', () => {
    const net = fakeNet();
    const session = new RunSession({ info: startInfo(ROWS), net, hud: fakeHud(), myClass: 'Wizard', input: () => ({ ...NO_INPUT, mx: 1 }) });
    session.receive({ t: 'Loading', ready: 0, total: 2 }); // not the start
    const x0 = session['pred'].state.x;
    session.frame(100);
    expect(inputs(net)).toHaveLength(0);
    expect(session['pred'].state.x).toBe(x0);
    expect(session.started).toBe(false);
    session.receive({ t: 'RunBegins' });
    session.frame(100);
    expect(session.started).toBe(true);
    expect(inputs(net).length).toBeGreaterThan(0);
  });

  it('Loading sets waiting', () => {
    const { session } = make();
    expect(session.waiting).toBeNull();
    session.receive({ t: 'Loading', ready: 1, total: 2 });
    expect(session.waiting).toEqual({ ready: 1, total: 2 });
  });

  it('sendLoaded sends one Loaded', () => {
    const { net, session } = make();
    session.sendLoaded();
    session.sendLoaded();
    expect(net.sent.filter((m) => m.t === 'Loaded')).toHaveLength(1);
  });
});

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
    const { net, hud, info, session } = make({}, () => ({ ...idle, mx: 1 }));
    const abilities = info.abilities;
    net.emit({ t: 'HeroChanged', speed: 99, abilities, fallback: info.fallback, disabled: [null, null] });
    expect(hud.calls).toContainEqual(['setAbilities', abilities, [null, null]]);
    expect(session.info.speed).toBe(99);
    // The predictor moves at the new speed: one step east.
    const x0 = session['pred'].state.x;
    session.frame(STEP_MS);
    expect(session['pred'].state.x - x0).toBeCloseTo(99 * CONST.DT, 6);
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

  it("a Land of an own landed shot is dropped even with no entity in ents; another's is drawn (#321)", () => {
    const { net, session } = make();
    const view = fakeView();
    session.setView(view);
    // An own shot that lands in prediction: shot id 7, landing 30 px ahead (the room is 3 tiles wide).
    const shots = session['shots'];
    shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 200, range: 260 }), 2, 1, { x: 24, y: 24 }, 0, undefined, 30);
    for (let i = 0; i < 100 && shots.live.length > 0; i++) shots.update(0.01, i * 0.01, { map: session['map'], ents: session['ents'], rtt: 50, interpDelay: 0.1 }, () => {});
    const land = (id: number, extra: number): Ev => ({ t: 'Land', id, x: 50, y: 24, kind: KIND.Arrow, aim: 0, extra });
    net.emit(snap({ ev: [land(90, (1 << 16) | 7), land(91, (2 << 16) | 7)] }));
    expect(view.events.filter((e) => e.t === 'Land').map((e) => (e as { id: number }).id)).toEqual([91]);
  });

  it('the frame carries the dark ids of the snapshot it draws', () => {
    const { net, session } = make();
    const view = fakeView();
    session.setView(view);
    session.frame(0.016);
    expect(view.frames[view.frames.length - 1].dark.size).toBe(0);
    net.emit(snap({ dark: [5, 9] }));
    session.frame(0.016);
    expect([...view.frames[view.frames.length - 1].dark]).toEqual([5, 9]);
  });

  it('a picture event listed in dark_ev reaches the view marked dark', () => {
    const { net, session } = make();
    const view = fakeView();
    session.setView(view);
    const dmg = { t: 'Dmg', x: 1, y: 1, v: 3, crit: false, p: false, ty: 0, imm: false } as const;
    net.emit(snap({ ev: [dmg, dmg], dark_ev: [1] }));
    expect(view.eventDark).toEqual([false, true]);
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

  it('a charm that begins reconciles from the drawn own position', () => {
    const { net, session } = make();
    // The session's entity map is filled by the frame; put the drawn own figure there as that step will.
    const ents = session['ents'];
    ents.set(1, { id: 1, kind: 0, x: 100, y: 90, hp: 10, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: 2, entangled: 0 });
    const charmed = snap();
    charmed.me.charmed_by = 'Lich';
    net.emit(charmed);
    // The predicted hero stood at the spawn (24, 24); the figure glides from the drawn spot to the server hero.
    const [x, y] = session['pred'].charmedPos(24, 24, 0);
    expect([x, y]).toEqual([24 + (24 - 100), 24 + (24 - 90)]);
  });

  it('debug keys are ignored outside a debug run', () => {
    const off = make({ debug: false });
    off.session.debugImmortal();
    expect(off.net.sent).toEqual([]);
    const on = make({ debug: true });
    on.session.debugImmortal();
    expect(on.net.sent).toEqual([{ t: 'DebugImmortal', on: false }]);
  });

  it('F8 steps forward from the first effect; Ctrl+F8 from the start reaches the last, Charmed, and wraps (#287)', () => {
    const fwd = make({ debug: true });
    fwd.session.debugEffect();
    const back = make({ debug: true });
    back.session.debugEffect(true);
    back.session.debugEffect(true);
    back.session.debugEffect();
    back.session.debugEffect();
    const n = Object.keys(EFFECT).length;
    expect(fwd.net.sent).toEqual([{ t: 'DebugEffect', kind: 0 }]);
    expect(back.net.sent.map((m) => (m as { kind: number }).kind)).toEqual([EFFECT.Charmed, n - 2, n - 1, 0]);
  });

  it('destroy unsubscribes', () => {
    const { net, hud, session } = make();
    session.destroy();
    hud.calls.length = 0;
    net.emit(snap());
    expect(hud.calls).toEqual([]);
  });

  it('the log hears every snapshot, after the HUD', () => {
    const net = fakeNet();
    const hud = fakeHud();
    const order: string[] = [];
    hud.snapshot = () => void order.push('hud');
    const heard: unknown[] = [];
    const log = { onSnapshot: (s: unknown) => { order.push('log'); heard.push(s); }, destroy: () => {} };
    new RunSession({ info: startInfo(ROWS), net, hud, myClass: 'Wizard', input: () => NO_INPUT, log });
    const s = snap();
    net.emit(s);
    expect(order).toEqual(['hud', 'log']);
    expect(heard).toEqual([s]);
  });

  it('destroy ends the log', () => {
    const net = fakeNet();
    let ended = 0;
    const log = { onSnapshot: () => {}, destroy: () => { ended++; } };
    const session = new RunSession({ info: startInfo(ROWS), net, hud: fakeHud(), myClass: 'Wizard', input: () => NO_INPUT, log });
    session.destroy();
    expect(ended).toBe(1);
  });
});

const STEP_MS = 1000 * CONST.DT;
const idle: StepInput = { mx: 0, my: 0, primary: false, secondary: false, act: false, held: false };

describe('RunSession fixed step', () => {
  it("a fixed step sends one Input with the host's movement", () => {
    const { net, session } = make({}, () => ({ ...idle, mx: 1 }));
    session.frame(STEP_MS);
    const sent = inputs(net);
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ mx: 1, my: 0, primary: null, secondary: null, act: false });
  });

  it('a long frame runs at most five steps', () => {
    const { net, session } = make();
    session.frame(1000);
    expect(inputs(net).length).toBe(5);
    // The rest of the accumulator is dropped: half a step later still no step runs.
    session.frame(STEP_MS / 2);
    expect(inputs(net).length).toBe(5);
  });

  it('a dead hero sends no Input but the latches are read', () => {
    let calls = 0;
    const { net, session } = make({}, () => {
      calls++;
      return idle;
    });
    const dead = snap();
    dead.me.alive = false;
    net.emit(dead);
    session.frame(STEP_MS);
    expect(inputs(net).length).toBe(0);
    expect(calls).toBe(1);
  });

  it('an open menu blocks abilities', () => {
    const { net, hud, session } = make({}, () => ({ ...idle, primary: true }));
    hud.menuOpen = true;
    session.frame(STEP_MS);
    expect(inputs(net)[0].primary).toBeNull();
  });

  it('without a pointer the aim follows the movement', () => {
    const { net, session } = make({}, () => ({ ...idle, my: 1 }));
    session.setView(fakeView(null));
    session.frame(STEP_MS);
    const sent = inputs(net)[0];
    expect(sent.aim).toBe(Math.PI / 2);
    expect(sent.aim_dist).toBe(0);
  });

  it('the aim is measured from the foot: a pointer 8 px below the old chest point sends the old aim and distance', () => {
    const { net, session } = make({}, () => ({ ...idle }));
    const hero = session['pred'].state;
    session.setView(fakeView({ x: hero.x + 30, y: hero.y + 8 }));
    session.frame(STEP_MS);
    const sent = inputs(net)[0];
    expect(sent.aim).toBeCloseTo(Math.atan2(8, 30));
    const old = Math.atan2(16, 30);
    expect(sent.aim).not.toBeCloseTo(old);
    const { net: net2, session: s2 } = make({}, () => ({ ...idle }));
    const h2 = s2['pred'].state;
    s2.setView(fakeView({ x: h2.x + 30, y: h2.y }));
    s2.frame(STEP_MS);
    expect(inputs(net2)[0].aim).toBe(0);
    expect(inputs(net2)[0].aim_dist).toBe(30);
  });

  it('the frame hands the drawn aim to the view', () => {
    let t = 10;
    const net = fakeNet();
    const session = new RunSession({ info: startInfo(ROWS), net, hud: fakeHud(), myClass: 'Wizard', input: () => NO_INPUT, now: () => t });
    const view = fakeView();
    session.setView(view);
    session.frame(16);
    const hero = session['pred'].state;
    const f = view.frames.at(-1)!;
    expect(f.own.aimsAtPointer).toBe(true);
    expect(f.own.aimFromX).toBe(hero.x);
    expect(f.own.aimFromY).toBe(hero.y);
    const s = snap();
    s.me.effects = [[EFFECT.Petrified, 1]] as never;
    net.emit(s);
    t = 10.1;
    session.frame(16);
    expect(view.frames.at(-1)!.own.aimsAtPointer).toBe(false);
  });

  it('a primary shot is predicted', () => {
    const shoot = ability('Shoot', { projectile: KIND.Arrow, speed: 200, range: 150, ranged: true, cooldown: 0.5 });
    const { net, session } = make({ abilities: [shoot, ability('SummonWolf')] }, () => ({ ...idle, primary: true }));
    const hero = session['pred'].state;
    const view = fakeView({ x: hero.x + 100, y: hero.y });
    session.setView(view);
    session.frame(STEP_MS);
    expect(inputs(net)[0].primary).not.toBeNull();
    expect(view.frames.at(-1)!.shots.length).toBe(1);
  });
});

describe('RunSession frame', () => {
  const entity = (id: number, x: number, y: number): [number, number, number, number, number, number, number, number, number, number, number, number, number, number] => [id, KIND.Wizard, x, y, 255, 0, 0, 0, 0, 0, 0, 1, 0, 128];

  /** A session on a fake clock, with a view; `at(s)` moves the clock. */
  function running(input: () => StepInput = () => NO_INPUT, over: Partial<RunStartInfo> = {}) {
    let t = 10;
    const net = fakeNet();
    const hud = fakeHud();
    const session = new RunSession({ info: startInfo(ROWS, over), net, hud, myClass: 'Wizard', input, now: () => t });
    session.receive({ t: 'RunBegins' });
    const view = fakeView();
    session.setView(view);
    return { net, hud, session, view, at: (s: number) => void (t = s) };
  }

  it("a dead hero's camera target is the watched teammate", () => {
    const { net, session, view, at } = running();
    const dead = (tick: number) => {
      const s = snap({ tick, ents: [entity(7, 200, 120)] });
      s.me.alive = false;
      s.me.spectating = 7;
      return s;
    };
    at(10);
    net.emit(dead(1));
    at(10.05);
    net.emit(dead(4));
    at(10.2);
    session.frame(16);
    const f = view.frames.at(-1)!;
    expect(f.camera).toEqual({ x: 200, y: 120 });
    expect(f.watching).toBe(7);
  });

  it("a living hero's camera target is the predicted position", () => {
    const { session, view } = running();
    session.frame(16);
    const f = view.frames.at(-1)!;
    expect(f.camera).toEqual({ x: f.own.x, y: f.own.y });
    expect(f.own.alive).toBe(true);
  });

  it('the predicted shot is in the frame', () => {
    const shoot = ability('Shoot', { projectile: KIND.Arrow, speed: 200, range: 150, ranged: true, cooldown: 0.5 });
    const { session, view } = running(() => ({ ...idle, primary: true }), { abilities: [shoot, ability('SummonWolf')] });
    const hero = session['pred'].state;
    view.pointerWorld = () => ({ x: hero.x + 100, y: hero.y });
    session.frame(STEP_MS);
    expect(view.frames.at(-1)!.shots.length).toBe(1);
    expect(view.frames.at(-1)!.shots[0].kind).toBe(KIND.Arrow);
  });

  it('ownCast follows a predicted primary', () => {
    const mm = ability('MagicMissile', { projectile: KIND.Missile, speed: 200, range: 150, ranged: true, cooldown: 0.5 });
    const { session, view } = running(() => ({ ...idle, primary: true }), { abilities: [mm, ability('SummonWolf')] });
    const hero = session['pred'].state;
    view.pointerWorld = () => ({ x: hero.x + 100, y: hero.y });
    expect(view.frames.length).toBe(0);
    session.frame(STEP_MS);
    const c = view.frames.at(-1)!.ownCast!;
    expect(c).toMatchObject({ seq: 1, look: RUNE_LOOK.Arcane, primary: true });
    expect(c.aim).toBeCloseTo(0, 1);
  });

  it('without a magical use ownCast stays null', () => {
    const { session, view } = running();
    session.frame(16);
    expect(view.frames.at(-1)!.ownCast).toBeNull();
  });

  it('without a view the HUD still gets a frame', () => {
    const net = fakeNet();
    const hud = fakeHud();
    const session = new RunSession({ info: startInfo(ROWS), net, hud, myClass: 'Wizard', input: () => NO_INPUT });
    session.frame(16);
    const frames = hud.calls.filter((c) => c[0] === 'frame');
    expect(frames.length).toBe(1);
    expect(frames[0][1]).toMatchObject({ drawCalls: 0, ents: 0 });
  });

  it("the view's numbers reach the HUD", () => {
    const { net, hud, session, view, at } = running();
    view.stats = { ...view.stats, drawCalls: 42 };
    at(10);
    net.emit(snap({ ents: [entity(7, 200, 120), entity(8, 100, 24)] }));
    at(10.2);
    session.frame(16);
    const arg = hud.calls.filter((c) => c[0] === 'frame').at(-1)![1] as { drawCalls: number; ents: number; rtt: number; cd1: number };
    expect(arg.drawCalls).toBe(42);
    expect(arg.ents).toBe(2);
    expect(arg.rtt).toBe(50);
  });

  it("the frame's own data is the snapshot's", () => {
    const { net, hud, session, view } = running();
    const s = snap();
    s.me.effects = [[EFFECT.Sleep, 1]] as never;
    net.emit(s);
    session.frame(16);
    expect(view.frames.at(-1)!.own.effects & (1 << EFFECT.Sleep)).not.toBe(0);
    expect(hud.calls).toContainEqual(['setAsleep', true]);
  });

  it('holding A and D together still plays the walk animation', () => {
    const { session, view } = running(() => ({ ...idle, held: true }));
    session.frame(STEP_MS);
    expect(view.frames.at(-1)!.own.anim).toBe(ANIM.Move);
    const still = running();
    still.session.frame(STEP_MS);
    expect(still.view.frames.at(-1)!.own.anim).toBe(ANIM.Idle);
  });

  it('the drawn weapon follows the pointer on a frame without a step', () => {
    const { session, view } = running();
    const hero = session['pred'].state;
    view.pointerWorld = () => ({ x: hero.x + 50, y: hero.y });
    session.frame(STEP_MS);
    expect(view.frames.at(-1)!.own.aim).toBeCloseTo(0);
    view.pointerWorld = () => ({ x: hero.x, y: hero.y + 50 });
    session.frame(1);
    expect(view.frames.at(-1)!.own.aim).toBeCloseTo(Math.PI / 2);
  });

  describe('the aim reading (#321)', () => {
    const shoot = ability('Shoot', { projectile: KIND.Arrow, speed: 200, range: 150, ranged: true, cooldown: 0.5 });
    const magic = ability('MagicMissile', { projectile: KIND.Missile, speed: 200, range: 150, ranged: true, cooldown: 0.5 });
    // The ground reading is 60 px away, the shot-height reading 100 px.
    const setup = (primary: boolean, secondary: boolean, abilities: [ReturnType<typeof ability>, ReturnType<typeof ability>]) => {
      const r = running(() => ({ ...idle, primary, secondary }), { abilities });
      const hero = r.session['pred'].state;
      r.view.pointerWorld = (ground?: boolean) => ({ x: hero.x + (ground ? 60 : 100), y: hero.y });
      r.session.frame(STEP_MS);
      return inputs(r.net)[0];
    };
    it('an arcing primary sends the ground reading', () => expect(setup(true, false, [shoot, magic]).aim_dist).toBe(60));
    it('a magic secondary alone sends the shot-height reading', () => expect(setup(false, true, [shoot, magic]).aim_dist).toBe(100));
    it('both fire: the primary decides', () => {
      expect(setup(true, true, [shoot, magic]).aim_dist).toBe(60);
      expect(setup(true, true, [magic, shoot]).aim_dist).toBe(100);
    });
    it('an arcing shot lands at the ground reading', () => {
      const r = running(() => ({ ...idle, primary: true }), { abilities: [shoot, magic] });
      const hero = r.session['pred'].state;
      r.view.pointerWorld = (ground?: boolean) => ({ x: hero.x + (ground ? 60 : 100), y: hero.y });
      r.session.frame(STEP_MS);
      const live = r.session['shots'].live[0];
      expect(live.land![0]).toBeCloseTo(hero.x + 60, 6);
      expect(live.land![1]).toBeCloseTo(hero.y, 6);
    });
  });

  it('the shots seen on the server end the predicted copy when they are gone', () => {
    const shoot = ability('Shoot', { projectile: KIND.Arrow, speed: 20, range: 150, ranged: true, cooldown: 5 });
    let fire = true;
    const { net, session, view, at } = running(() => ({ ...idle, primary: fire }), { abilities: [shoot, ability('SummonWolf')] });
    const hero = session['pred'].state;
    view.pointerWorld = () => ({ x: hero.x + 100, y: hero.y });
    at(10);
    session.frame(STEP_MS);
    fire = false;
    const sent = net.sent.find((m) => m.t === 'Input' && m.primary !== null) as Extract<ClientMsg, { t: 'Input' }>;
    const arrow = (extra: number) => [99, KIND.Arrow, 40, 24, 255, 0, 0, 0, 0, extra, 0, 2, 0, 128] as ReturnType<typeof entity>;
    at(10.1);
    net.emit(snap({ tick: 1, ents: [arrow((1 << 16) | sent.primary!)] }));
    at(10.15);
    net.emit(snap({ tick: 2, ents: [arrow((1 << 16) | sent.primary!)] }));
    at(10.2);
    session.frame(1);
    expect(view.frames.at(-1)!.shots.length).toBe(1);
    // The server's shot is gone from the next snapshot: ours ends too.
    at(10.5);
    net.emit(snap({ tick: 30, ents: [] }));
    at(10.7);
    session.frame(1);
    expect(view.ended.map((e) => e[1])).toEqual(['gone']);
  });

  it('while charmed the own figure follows the interpolated hero, gliding from where it was drawn', () => {
    const { net, session, view, at } = running();
    at(10);
    net.emit(snap({ tick: 1, ents: [entity(1, 100, 90)] }));
    at(10.05);
    net.emit(snap({ tick: 4, ents: [entity(1, 100, 90)] }));
    at(10.2);
    session.frame(16);
    expect(view.frames.at(-1)!.own.charmed).toBe(false);
    const charmed = snap({ tick: 7, ents: [entity(1, 100, 90)] });
    charmed.me.charmed_by = 'Lich';
    at(10.25);
    net.emit(charmed);
    at(10.3);
    session.frame(16);
    const first = view.frames.at(-1)!;
    expect(first.own.charmed).toBe(true);
    // Between the spawn (24, 24) where it stood and the server hero at (100, 90): no jump.
    expect(first.own.x).toBeGreaterThan(24);
    expect(first.own.x).toBeLessThan(100);
    expect(first.own.y).toBeGreaterThan(24);
    expect(first.own.y).toBeLessThan(90);
    expect(first.camera).toEqual({ x: first.own.x, y: first.own.y });
    session.frame(100);
    const later = view.frames.at(-1)!;
    expect(later.own.x).toBeGreaterThan(first.own.x);
    expect(later.own.x).toBeLessThan(100);
    for (let i = 0; i < 20; i++) session.frame(100);
    expect(view.frames.at(-1)!.own.x).toBeCloseTo(100, 0);
    expect(view.frames.at(-1)!.own.y).toBeCloseTo(90, 0);
  });

  it('the frame marks the dark ids of the snapshot its entities are drawn from, not the newest', () => {
    const { net, session, view, at } = running();
    at(10);
    net.emit(snap({ tick: 1, ents: [], dark: [] }));
    at(10.1);
    net.emit(snap({ tick: 7, ents: [entity(5, 100, 90)], dark: [5] }));
    at(10.2);
    net.emit(snap({ tick: 13, ents: [], dark: [] }));
    // Render time lies between the first two snapshots: entities come from the second, so entity 5 is drawn, and marked.
    at(10.13);
    session.frame(16);
    const f = view.frames.at(-1)!;
    expect(f.ents.has(5)).toBe(true);
    expect([...f.dark]).toEqual([5]);
  });

  it('dodge lines older than 0.6 s are removed before the view sees them, and none while dead', () => {
    const { net, session, view, at } = running(() => NO_INPUT, { debug: true });
    at(10);
    net.emit({ t: 'DebugDodge', from: [1, 2], to: [3, 4] });
    session.frame(16);
    expect(view.frames.at(-1)!.debug.dodges.length).toBe(1);
    at(10.7);
    session.frame(16);
    expect(view.frames.at(-1)!.debug.dodges).toEqual([]);
    net.emit({ t: 'DebugDodge', from: [1, 2], to: [3, 4] });
    const dead = snap();
    dead.me.alive = false;
    net.emit(dead);
    session.frame(16);
    expect(view.frames.at(-1)!.debug.dodges).toEqual([]);
  });
});

