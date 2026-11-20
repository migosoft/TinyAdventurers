import type { RunStartInfo } from './generated/RunStartInfo';
import type { ServerMsg } from './generated/ServerMsg';
import { api, ApiFail } from './api';
import type { CharacterInfo } from './generated/CharacterInfo';
import { Net } from './net';
import { loadAtlas, type Atlas } from './ui/atlas';
import { showAuth } from './ui/auth';
import { Create } from './ui/create';
import { Hub } from './ui/hub/hub';
import { Hud } from './ui/hud';
import { Lobby } from './ui/lobby';
import { logoHeader } from './ui/logo';
import { Roster } from './ui/roster';
import { loadFonts } from './fonts';
import { isR3dDemo, r3dPage } from './r3dFlag';
import './style.css';
import './ui/screens.css';

function fatal(ui: HTMLElement, msg: string): void {
  ui.innerHTML = `<div class="lobby">${logoHeader}<div class="panel">${msg}</div></div>`;
}

/** Login, then the roster; opening a character connects to the game and shows its hub. */
async function main(): Promise<void> {
  if (isR3dDemo(location.search)) {
    const host = document.getElementById('game')!;
    host.classList.add('active');
    const { bootCove, bootDemo, bootFx, bootGallery, bootLights, bootLiquids, bootMood, bootStone, bootSunlight, bootWoodland } = await import('./render3d/boot');
    const page = r3dPage(location.search);
    const boot = ({ gallery: bootGallery, lights: bootLights, woodland: bootWoodland, cove: bootCove, mood: bootMood, sunlight: bootSunlight, fx: bootFx, liquids: bootLiquids, stone: bootStone } as Record<string, typeof bootDemo>)[page ?? ''] ?? bootDemo;
    return boot(host, location.search);
  }
  const ui = document.getElementById('ui')!;
  let me;
  try {
    me = await api.me();
  } catch (e) {
    return fatal(ui, e instanceof ApiFail ? e.message : 'Cannot reach the game server. Is it running?');
  }
  const atlas = await loadAtlas();
  if (!me) me = await showAuth(ui);

  // The session (WebSocket, lobby, hub, the 3D view) starts with the first opened character.
  let session: { net: Net; lobby: Lobby; hub: Hub } | null = null;
  let starting: Promise<boolean> | null = null;
  const toRoster = () => {
    session?.hub.hide();
    void roster.show();
  };
  /** Connects on first use; false when the server cannot be reached. */
  const ensureSession = (): Promise<boolean> =>
    (starting ??= (async () => {
      const net = new Net();
      try {
        await net.connect();
      } catch {
        starting = null;
        return false;
      }
      session = await startGame(ui, net, atlas, toRoster);
      return true;
    })());
  const open = async (c: CharacterInfo) => {
    if (session && !session.net.connected) return location.reload();
    if (!(await ensureSession())) return fatal(ui, 'Cannot reach the game server. Is it running?');
    const s = session!;
    roster.hide();
    create.hide();
    s.hub.open(c.id);
    s.net.send({ t: 'SelectCharacter', id: c.id });
    s.hub.show();
  };
  const roster = new Roster(ui, atlas, open, () => {
    roster.hide();
    create.show();
  });
  // The roster reloads the account whenever it is shown again, so a new character needs no refresh here.
  const create = new Create(ui, atlas, open, () => {
    create.hide();
    void roster.show();
  });
  roster.show(me);
}

/** Connected: the hub, the lobby and the 3D view of a run. */
async function startGame(ui: HTMLElement, net: Net, atlas: Atlas, onRoster: () => void): Promise<{ net: Net; lobby: Lobby; hub: Hub }> {
  const hub = new Hub(ui, atlas, (m) => net.send(m), onRoster, () => {
    hub.hide();
    lobby.show();
  });
  const lobby = new Lobby(ui, net, atlas, () => {
    lobby.hide();
    hub.show();
  });

  // The server explains why it closes a connection (logged in elsewhere, logged out)
  // in an Error right before closing.
  let lastError = { msg: '', at: 0 };
  // (installed before the font wait, so a close during it still shows the message; the Hud exists later)
  let hudForClose: Hud | undefined;
  net.onClose = () => {
    const why = performance.now() - lastError.at < 2000 ? lastError.msg : 'Connection lost.';
    const msg = `${why} Reload the page to reconnect.`;
    hudForClose?.message(msg);
    lobby.error(msg);
    hub.error(msg);
  };

  await loadFonts();
  const gameEl = document.getElementById('game')!;
  let debugAccount = false;
  let run3d: { stop(): void } | null = null; // the render3d `Run3d` (main.ts has no static render3d import)
  let boot3d: Promise<typeof import('./render3d/boot')> | null = null; // the chunk, loaded at most once (a failed load is retried)
  let run3dStarts = 0; // a second RunStarted while the import is pending drops the stale start

  const backToLobby = () => {
    run3d?.stop();
    run3d = null;
    hud.hide();
    gameEl.classList.remove('active');
    lobby.leftRoom();
    lobby.show();
  };
  const hud = new Hud(
    ui,
    () => {
      net.send({ t: 'LeaveRun' });
      backToLobby();
    },
    backToLobby,
  );
  hudForClose = hud;

  net.on(async (m) => {
    switch (m.t) {
      case 'Welcome':
        lobby.myId = m.id;
        lobby.debug = m.debug;
        hub.setDebug(m.debug);
        debugAccount = m.debug;
        if (!boot3d) {
          // so the chunk is usually there at RunStarted (a failed preload is retried then)
          const p = import('./render3d/boot');
          boot3d = p;
          p.catch(() => {
            if (boot3d === p) boot3d = null;
          });
        }
        break;
      case 'Lobby':
        lobby.setRuns(m.runs);
        break;
      case 'Room':
        lobby.setRoom(m);
        break;
      case 'Character':
        hub.setCharacter(m);
        lobby.setCharacter(m);
        break;
      case 'Error':
        lastError = { msg: m.msg, at: performance.now() };
        if (hub.visible) hub.error(m.msg);
        else lobby.error(m.msg);
        break;
      case 'RunStarted': {
        const info = m as RunStartInfo;
        const me = info.players.find((p) => p.ent === info.you)!;
        const mine = ++run3dStarts;
        lobby.hide();
        gameEl.classList.add('active');
        run3d?.stop();
        run3d = null;
        // Messages that arrive while the chunk loads are buffered and replayed into the session.
        const early: ServerMsg[] = [];
        const off = net.on((x) => early.push(x));
        let mod: typeof import('./render3d/boot');
        try {
          mod = await (boot3d ??= import('./render3d/boot'));
        } catch (e) {
          off();
          boot3d = null;
          if (mine !== run3dStarts) break;
          console.error('The 3D view could not load:', e);
          net.send({ t: 'LeaveRun' }); // else the server keeps the hero in the run
          backToLobby();
          lobby.error(`The 3D view could not load: ${String(e)}`);
          break;
        }
        off();
        if (mine !== run3dStarts) break; // a newer RunStarted took over while the chunk loaded
        // `dev` (the host's run mode with the dev tools) only for a debug account that asked with `?r3d`.
        run3d = mod.startRun3d(gameEl, location.search, { info, net, hud, myClass: me.class, early, dev: debugAccount && new URLSearchParams(location.search).has('r3d') });
        break;
      }
    }
  });
  return { net, lobby, hub };
}

main();
