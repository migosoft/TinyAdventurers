import Phaser from 'phaser';
import { GalleryScene } from './game/GalleryScene';
import { MimicDemoScene } from './game/MimicDemoScene';
import { DaemonDemoScene } from './game/DaemonDemoScene';
import { ChasmDemoScene, LavaDemoScene, WaterDemoScene } from './game/TerrainDemoScene';
import { KnockbackDemoScene } from './game/KnockbackDemoScene';
import { OgreDemoScene } from './game/OgreDemoScene';
import { GameScene, type GameInit } from './game/GameScene';
import type { RunStartInfo } from './generated/RunStartInfo';
import { api, ApiFail } from './api';
import type { CharacterInfo } from './generated/CharacterInfo';
import { Net } from './net';
import { loadAtlas, type Atlas } from './ui/atlas';
import { showAuth } from './ui/auth';
import { Characters } from './ui/characters';
import { Hud } from './ui/hud';
import { Lobby } from './ui/lobby';
import './style.css';

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
    this.game.events.emit('assets-ready');
  }
}

/** Integer zoom so pixels stay crisp; figures stay tiny on large screens. */
function viewSize(): { w: number; h: number; zoom: number } {
  const zoom = Math.max(1, Math.round(Math.min(window.innerWidth / 600, window.innerHeight / 340)));
  return { w: Math.ceil(window.innerWidth / zoom), h: Math.ceil(window.innerHeight / zoom), zoom };
}

/** Dev pages, no server needed: sprite gallery (?gallery), demos (?mimic, ?daemons, ?water, ?chasm, ?lava, ?knockback, ?ogre). */
const DEMOS: Record<string, string> = { mimic: 'mimic-demo', daemons: 'daemon-demo', water: 'water-demo', chasm: 'chasm-demo', lava: 'lava-demo', knockback: 'knockback-demo', ogre: 'ogre-demo' };

function gallery(): void {
  const q = new URLSearchParams(location.search);
  const start = Object.entries(DEMOS).find(([k]) => q.has(k))?.[1] ?? 'gallery';
  const v = viewSize();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    pixelArt: true,
    scale: { mode: Phaser.Scale.NONE, width: v.w, height: v.h, zoom: v.zoom },
    scene: [BootScene, GalleryScene, MimicDemoScene, DaemonDemoScene, WaterDemoScene, ChasmDemoScene, LavaDemoScene, KnockbackDemoScene, OgreDemoScene],
  });
  game.events.once('assets-ready', () => game.scene.start(start));
  document.getElementById('game')!.classList.add('active');
}

function fatal(ui: HTMLElement, msg: string): void {
  ui.innerHTML = `<div class="lobby"><h1>Tiny Adventurers</h1><div class="panel">${msg}</div></div>`;
}

/** Login, then the character screen; "Play" connects to the game. */
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

  let session: { net: Net; lobby: Lobby } | null = null;
  const characters = new Characters(ui, atlas, async (c: CharacterInfo) => {
    if (session && !session.net.connected) return location.reload();
    if (!session) {
      const net = new Net();
      try {
        await net.connect();
      } catch {
        return fatal(ui, 'Cannot reach the game server. Is it running?');
      }
      const lobby = startGame(ui, net, atlas, () => {
        lobby.hide();
        characters.show();
      });
      session = { net, lobby };
    }
    session.net.send({ t: 'SelectCharacter', id: c.id });
    characters.hide();
    session.lobby.show();
  });
  characters.show(me);
}

/** Connected: the lobby and the Phaser game. Returns the lobby. */
function startGame(ui: HTMLElement, net: Net, atlas: Atlas, onChangeCharacter: () => void): Lobby {
  const lobby = new Lobby(ui, net, atlas, onChangeCharacter);

  const v = viewSize();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    pixelArt: true,
    antialias: false,
    backgroundColor: '#000000',
    scale: { mode: Phaser.Scale.NONE, width: v.w, height: v.h, zoom: v.zoom },
    scene: [BootScene, GameScene],
    fps: { smoothStep: false },
  });
  window.addEventListener('resize', () => {
    const s = viewSize();
    game.scale.resize(s.w, s.h);
    game.scale.setZoom(s.zoom);
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
        lobby.setCharacter(m);
        break;
      case 'Error':
        lastError = { msg: m.msg, at: performance.now() };
        lobby.error(m.msg);
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
  return lobby;
}

main();
