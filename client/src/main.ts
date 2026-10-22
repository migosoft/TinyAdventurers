import Phaser from 'phaser';
import { GalleryScene } from './game/GalleryScene';
import { MimicDemoScene } from './game/MimicDemoScene';
import { DaemonDemoScene } from './game/DaemonDemoScene';
import { ChasmDemoScene, LavaDemoScene, WaterDemoScene } from './game/TerrainDemoScene';
import { KnockbackDemoScene } from './game/KnockbackDemoScene';
import { OgreDemoScene } from './game/OgreDemoScene';
import { LichDemoScene } from './game/LichDemoScene';
import { DragonDemoScene } from './game/DragonDemoScene';
import { DemonDemoScene } from './game/DemonDemoScene';
import { LightsDemoScene } from './game/LightsDemoScene';
import { DARKVISION_FX, DarkvisionFX } from './game/darkvisionfx';
import { GameScene, type GameInit } from './game/GameScene';
import type { RunStartInfo } from './generated/RunStartInfo';
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
import './style.css';
import './ui/screens.css';

class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }
  preload(): void {
    this.load.atlas('atlas', 'assets/atlas.png', 'assets/atlas.json');
  }
  create(): void {
    // Tiny runtime textures for particles and magic glows (the pack has no effect sprites).
    const g = this.make.graphics({}, false);
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
    g.generateTexture('dot', 2, 2);
    g.clear().fillStyle(0xffffff, 1).fillRect(1, 0, 1, 3).fillRect(0, 1, 3, 1); // clear() resets the fill to black
    g.generateTexture('spark', 3, 3);
    g.clear();
    for (let r = 6; r >= 1; r--) g.fillStyle(0xffffff, 0.12 + (6 - r) * 0.16).fillCircle(7, 7, r);
    g.generateTexture('glow', 14, 14);
    g.destroy();
    // The darkvision greyscale, a camera post pipeline set by name. (The game config's
    // `pipeline` option would do the same, but its typings expect a config constructor.)
    (this.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.addPostPipeline(DARKVISION_FX, DarkvisionFX);
    this.game.events.emit('assets-ready');
  }
}

/** Integer zoom so pixels stay crisp; figures stay tiny on large screens. */
function viewSize(): { w: number; h: number; zoom: number } {
  const zoom = Math.max(1, Math.round(Math.min(window.innerWidth / 600, window.innerHeight / 340)));
  return { w: Math.ceil(window.innerWidth / zoom), h: Math.ceil(window.innerHeight / zoom), zoom };
}

/**
 * The canvas is at screen resolution (so Inter text is crisp) and the integer zoom lives on each scene's
 * main camera, which shows the same world area as a world-resolution canvas scaled up by CSS would.
 * Every scene except the game keeps the world's (0, 0) at the top left (origin 0, 0), like a plain canvas;
 * the game centres its camera. LightsDemoScene fits its own zoom.
 */
function applyView(sc: Phaser.Scene): void {
  const key = sc.sys.settings.key;
  if (key === 'lights-demo') return;
  const cam = sc.cameras?.main;
  if (!cam) return;
  if (key !== 'game') cam.setOrigin(0, 0);
  cam.setZoom(viewSize().zoom);
}

/** Applies the view to every scene when it is created (before its first frame); the returned function re-applies it to the running scenes (resize). */
function watchViews(game: Phaser.Game): () => void {
  game.events.once('assets-ready', () => {
    for (const sc of game.scene.getScenes(false)) sc.events.on(Phaser.Scenes.Events.CREATE, () => applyView(sc));
  });
  return () => game.scene.getScenes(true).forEach(applyView);
}

/** Dev pages, no server needed: sprite gallery (?gallery), demos (?mimic, ?daemons, ?water, ?chasm, ?lava, ?knockback, ?ogre, ?dragon, ?lich, ?demon, ?lights). */
const DEMOS: Record<string, string> = { mimic: 'mimic-demo', daemons: 'daemon-demo', water: 'water-demo', chasm: 'chasm-demo', lava: 'lava-demo', knockback: 'knockback-demo', ogre: 'ogre-demo', dragon: 'dragon-demo', lich: 'lich-demo', demon: 'demon-demo', lights: 'lights-demo' };

async function gallery(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const start = Object.entries(DEMOS).find(([k]) => q.has(k))?.[1] ?? 'gallery';
  const v = viewSize();
  await loadFonts();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    pixelArt: true,
    scale: { mode: Phaser.Scale.NONE, width: v.w * v.zoom, height: v.h * v.zoom, zoom: 1 },
    scene: [BootScene, GalleryScene, MimicDemoScene, DaemonDemoScene, WaterDemoScene, ChasmDemoScene, LavaDemoScene, KnockbackDemoScene, OgreDemoScene, DragonDemoScene, LichDemoScene, DemonDemoScene, LightsDemoScene],
  });
  watchViews(game);
  game.events.once('assets-ready', () => game.scene.start(start));
  document.getElementById('game')!.classList.add('active');
}

function fatal(ui: HTMLElement, msg: string): void {
  ui.innerHTML = `<div class="lobby">${logoHeader}<div class="panel">${msg}</div></div>`;
}

/** Login, then the roster; opening a character connects to the game and shows its hub. */
async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (q.has('gallery') || Object.keys(DEMOS).some((k) => q.has(k))) return gallery();
  const ui = document.getElementById('ui')!;
  let me;
  try {
    me = await api.me();
  } catch (e) {
    return fatal(ui, e instanceof ApiFail ? e.message : 'Cannot reach the game server. Is it running?');
  }
  const atlas = await loadAtlas();
  if (!me) me = await showAuth(ui);

  // The session (WebSocket, lobby, hub, Phaser) starts with the first opened character.
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

/** Connected: the hub, the lobby and the Phaser game. */
async function startGame(ui: HTMLElement, net: Net, atlas: Atlas, onRoster: () => void): Promise<{ net: Net; lobby: Lobby; hub: Hub }> {
  const hub = new Hub(ui, atlas, (m) => net.send(m), onRoster, () => {
    hub.hide();
    lobby.show();
  });
  const lobby = new Lobby(ui, net, atlas, () => {
    lobby.hide();
    hub.show();
  });

  const v = viewSize();
  await loadFonts();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    pixelArt: true,
    antialias: false,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.NONE, width: v.w * v.zoom, height: v.h * v.zoom, zoom: 1 },
    scene: [BootScene, GameScene],
    fps: { smoothStep: false },
  });
  const refreshViews = watchViews(game);
  window.addEventListener('resize', () => {
    const s = viewSize();
    game.scale.resize(s.w * s.zoom, s.h * s.zoom);
    refreshViews();
  });
  const ready = new Promise<void>((r) => game.events.once('assets-ready', r));
  const gameEl = document.getElementById('game')!;

  const backToLobby = () => {
    game.scene.stop('game');
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

  // The server explains why it closes a connection (logged in elsewhere, logged out)
  // in an Error right before closing.
  let lastError = { msg: '', at: 0 };
  net.onClose = () => {
    const why = performance.now() - lastError.at < 2000 ? lastError.msg : 'Connection lost.';
    const msg = `${why} Reload the page to reconnect.`;
    hud.message(msg);
    lobby.error(msg);
    hub.error(msg);
  };

  net.on(async (m) => {
    switch (m.t) {
      case 'Welcome':
        lobby.myId = m.id;
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
        await ready;
        const info = m as RunStartInfo;
        const me = info.players.find((p) => p.ent === info.you)!;
        lobby.hide();
        gameEl.classList.add('active');
        const data: GameInit = { info, net, hud, myClass: me.class };
        game.scene.stop('game');
        game.scene.start('game', data);
        break;
      }
    }
  });
  return { net, lobby, hub };
}

main();
