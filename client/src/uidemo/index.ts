// Throwaway spike: mock screens of the progression redesign, for the spec's screenshots
// (`?uidemo=roster|create|sheet|tree|tree-barbarian|equipment|loadout|room`, no server needed;
// tools/e2e/ui-shots.mjs takes the pictures). Nothing here is wired to the game.
import type { ClassId } from '../generated/ClassId';
import { loadAtlas, spritePreview, type Atlas } from '../ui/atlas';
import { CLASSES, classFigure, FIG } from '../ui/classes';
import { BOSS_TEXT, CLASS_TEXT } from '../ui/text';
import { logoHeader } from '../ui/logo';
import {
  ABILITY,
  ATTR_TEXT,
  ATTRS,
  attrPrice,
  attrSources,
  BRUNHILD,
  CLASS_START,
  hp,
  ITEMS,
  MERLIN,
  reqMet,
  reqText,
  respecPrice,
  START_POOL,
  TREES,
  xpSpent,
  type Ability,
  type Attr,
  type Item,
  type MockChar,
  type TreeNode,
} from './data';
import './uidemo.css';

type Tab = 'sheet' | 'tree' | 'equipment' | 'loadout';
const TABS: [Tab, string][] = [
  ['sheet', 'Sheet'],
  ['tree', 'Skill tree'],
  ['equipment', 'Equipment'],
  ['loadout', 'Loadout'],
];

let atlas: Atlas;

export async function showUiDemo(ui: HTMLElement, screen: string): Promise<void> {
  atlas = await loadAtlas();
  await document.fonts.ready;
  const root = document.createElement('div');
  root.className = 'lobby ud';
  ui.append(root);
  switch (screen) {
    case 'create':
      return create(root);
    case 'room':
      return room(root);
    case 'sheet':
    case 'tree':
    case 'equipment':
    case 'loadout':
      return hub(root, MERLIN, screen);
    case 'tree-barbarian':
      return hub(root, BRUNHILD, 'tree');
    default:
      return roster(root);
  }
}

// ------------------------------------------------------------ helpers

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

/** An atlas frame scaled by the largest integer that fits `box` px. */
function frameIcon(frame: string, box: number): HTMLCanvasElement {
  const f = atlas.frames[frame].frame;
  const s = Math.max(1, Math.floor(box / Math.max(f.w, f.h)));
  const c = document.createElement('canvas');
  c.width = f.w * s;
  c.height = f.h * s;
  c.className = 'ud-frame';
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.img, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  return c;
}

/** Item icon: its atlas frame, or letters in a box (slots without art). */
function itemIcon(item: Item, box: number): HTMLElement {
  if (atlas.frames[item.icon]) return frameIcon(item.icon, box);
  return h(`<span class="ud-letter" style="--box:${box}px">${item.icon}</span>`);
}

/** Placeholder ability icon: two letters on its damage colour (no ability art yet). */
const abIcon = (a: Ability, big = false) => `<span class="ud-ab t-${a.tint}${big ? ' big' : ''}" title="${a.name}">${a.mono}</span>`;

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)} %`;
const sign = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}`;
const coin = '<i class="coin-icon"></i>';

/** A tooltip panel beside `anchor` (left or right, centred on it) or below it. */
function tip(anchor: HTMLElement, html: string, place: 'left' | 'right' | 'below'): void {
  const t = h(`<div class="ud-tip">${html}</div>`);
  document.body.append(t);
  const a = anchor.getBoundingClientRect();
  const [w, ht] = [t.offsetWidth, t.offsetHeight];
  const left = place === 'below' ? a.left + a.width / 2 - w / 2 : place === 'right' ? a.right + 34 : a.left - 34 - w;
  const top = place === 'below' ? a.bottom + 10 : a.top + a.height / 2 - ht / 2;
  t.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  t.style.top = `${Math.max(8, Math.min(top, window.innerHeight - ht - 8))}px`;
}

function attrEffect(a: Attr, v: number): string {
  const d = v - 10;
  switch (a) {
    case 'STR':
      return `melee/thrown dmg ${pct(5 * d)} · push power ${v}`;
    case 'DEX':
      return `finesse/ranged dmg ${pct(5 * d)} · arc ${pct(3 * d)} · speed ${pct(2 * d)}`;
    case 'CON':
      return `HP ${sign(5 * d)} · move speed ${pct(d)} · non-magical save ${v}`;
    case 'INT':
      return `spell dmg and power ${pct(5 * d)}`;
    case 'WIL':
      return `magical save ${v}`;
    case 'CHA':
      return `innate dmg, heals, power ${pct(5 * d)}`;
  }
}

function unlocked(c: MockChar): Ability[] {
  const ids = [...START_POOL[c.cls], ...TREES[c.cls].filter((n) => n.kind === 'unlock' && c.nodes.includes(n.id)).map((n) => n.ability!)];
  return ids.map((id) => ABILITY[id]);
}

/** Why an equipped ability is invalid, or null. */
function invalid(c: MockChar, a: Ability): string | null {
  const miss = a.req.filter((q) => q.attr && !reqMet(c, q));
  if (!miss.length) return null;
  return miss.map((q) => `Needs ${reqText(q)} (you have ${attrSources(c, q.attr!).total})`).join('; ');
}

// ------------------------------------------------------------ roster

function roster(root: HTMLElement): void {
  const chars: [string, ClassId, number, number, number][] = [
    ['Merlin', 'Wizard', 840, 3490, 137],
    ['Brunhild', 'Barbarian', 410, 2210, 64],
    ['Shade', 'Assassin', 95, 610, 12],
  ];
  root.append(
    h(logoHeader),
    h(`<div class="panel account ud-w"><span>Logged in as <b>michael</b></span>
      <span class="row"><button>Log out</button><button class="danger">Delete account</button></span></div>`),
  );
  const panel = h(`<div class="panel ud-w"><h2>Your characters (3/8)</h2><div class="ud-roster"></div></div>`);
  const grid = panel.querySelector('.ud-roster')!;
  for (const [name, cls, xp, total, coins] of chars) {
    const card = h(`<button class="ud-char c-${cls.toLowerCase()}"></button>`);
    card.append(classFigure(atlas, cls, 4));
    card.append(h(`<div class="cinfo"><b>${name}</b><small>${cls}</small><small>${xp} XP <span class="muted">(${total} earned)</span></small><small>${coin}${coins}</small></div>`));
    grid.append(card);
  }
  grid.append(h(`<button class="ud-char ud-new"><span class="plus">+</span><b>New character</b><small>5 slots left</small></button>`));
  root.append(panel);
}

// ------------------------------------------------------------ create

function create(root: HTMLElement): void {
  root.append(h(`<div class="ud-bar ud-w"><button>&lt; Roster</button><h1 class="ud-title">New character</h1><span></span></div>`));
  const grid = h(`<div class="ud-classes ud-w"></div>`);
  for (const cls of CLASSES) {
    const s = CLASS_START[cls];
    const max = Math.max(...ATTRS.map((a) => s.attrs[a]));
    const min = Math.min(...ATTRS.map((a) => s.attrs[a]));
    const card = h(`<button class="ud-class c-${cls.toLowerCase()}${cls === 'Wizard' ? ' selected' : ''}"></button>`);
    const fig = classFigure(atlas, cls, 4);
    card.append(h(`<div class="ud-classhead"></div>`));
    card.firstElementChild!.append(fig, h(`<div><b>${cls}</b><small>${CLASS_TEXT[cls].blurb}</small></div>`));
    card.append(
      h(`<div class="ud-attrs">${ATTRS.map((a) => `<span class="${s.attrs[a] === max ? 'hi' : s.attrs[a] === min ? 'lo' : ''}"><i>${a}</i>${s.attrs[a]}</span>`).join('')}</div>`),
    );
    const melee = ITEMS[s.melee];
    const ranged = s.ranged ? ITEMS[s.ranged] : null;
    const gear = h(`<div class="ud-gear"><span class="lbl">Starts with</span></div>`);
    gear.append(itemIcon(melee, 30), h(`<span>${melee.name}</span>`));
    if (ranged) gear.append(itemIcon(ranged, 30), h(`<span>${ranged.name}</span>`));
    card.append(
      h(`<div class="ud-kv"><span>HP</span><b>${hp(cls, s.attrs.CON)}</b><span>Weight</span><b>${s.weight}</b><span>Speed</span><b>${s.speed}</b></div>`),
      gear,
      h(`<div class="ud-abl"><p>${abIcon(ABILITY[s.primary])}<kbd>LMB</kbd> ${ABILITY[s.primary].name}</p><p>${abIcon(ABILITY[s.secondary])}<kbd>RMB</kbd> ${ABILITY[s.secondary].name}</p></div>`),
      h(`<div class="ud-prof"><span class="lbl">Proficient with</span> ${s.prof.join(', ')}</div>`),
    );
    grid.append(card);
  }
  root.append(grid);
  root.append(
    h(`<form class="panel ud-w ud-createbar"><input maxlength="16" placeholder="Character name" value="Merlin"><button type="button" class="primary">Create Wizard</button>
      <small class="hint">The class cannot be changed later. Each class has its own skill tree.</small></form>`),
  );
}

// ------------------------------------------------------------ character hub

function hub(root: HTMLElement, c: MockChar, tab: Tab): void {
  const head = h(`<div class="ud-bar ud-w c-${c.cls.toLowerCase()}"><button>&lt; Roster</button><div class="ud-who"></div>
    <span class="ud-purse"><b>${c.xp} XP</b><span>${coin}${c.coins}</span></span><button class="primary">To the dungeon</button></div>`);
  head.querySelector('.ud-who')!.append(classFigure(atlas, c.cls, 2), h(`<div class="cinfo"><b>${c.name}</b><small>${c.cls}</small></div>`));
  const tabs = h(`<div class="ud-tabs ud-w">${TABS.map(([t, n]) => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${n}</button>`).join('')}</div>`);
  const body = h(`<div class="ud-body ud-w"></div>`);
  root.append(head, tabs, body);
  const show = (t: Tab) => {
    document.querySelectorAll('.ud-tip').forEach((e) => e.remove());
    tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    body.innerHTML = '';
    ({ sheet, tree, equipment, loadout })[t](body, c);
  };
  tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab as Tab)));
  show(tab);
}

function sheet(body: HTMLElement, c: MockChar): void {
  const rows = ATTRS.map((a) => {
    const s = attrSources(c, a);
    const noItems = s.total - s.items;
    const price = attrPrice(a, noItems);
    const parts = [`class ${s.cls}`, s.shop && `shop +${s.shop}`, s.tree && `tree +${s.tree}`, s.items && `items +${s.items}`].filter(Boolean).join(' · ');
    return `<li><span class="ab">${a}</span><span class="nm">${ATTR_TEXT[a].name}<small>${parts}</small></span><b class="val">${s.total}</b>
      <span class="eff">${attrEffect(a, s.total)}</span><button${price > c.xp ? ' disabled' : ''}>+1 · ${price} XP</button></li>`;
  }).join('');
  const con = attrSources(c, 'CON').total;
  const res: [string, number][] = [
    ['Physical', 5],
    ['Cold', 0],
    ['Heat', 15],
    ['Magical', 10],
    ['Poison', 0],
  ];
  const left = h(`<div class="panel ud-attrshop"><h2>Attributes <span class="muted">· Attribute shop</span></h2><ul>${rows}</ul>
    <small class="hint">Price per point: (100 + 25 × points above 10) × weight. Weights: DEX 1.25, WIL 0.8, others 1. Item points do not raise the price.</small></div>`);
  const right = h(`<div class="ud-col">
    <div class="panel ud-derived"><h2>Derived</h2><dl>
      <dt>HP</dt><dd>${hp(c.cls, con)} <small>${CLASS_START[c.cls].baseHp} + 5 × (CON − 10)</small></dd>
      <dt>Move speed</dt><dd>78 <small>70.6 base · CON +5 % · shoes +5 %</small></dd>
      <dt>Weight</dt><dd>10 <small>9 body · +1 robe</small></dd>
      <dt>Push power</dt><dd>${attrSources(c, 'STR').total} <small>STR vs target weight</small></dd>
      <dt>Saves</dt><dd>WIL ${attrSources(c, 'WIL').total} · CON ${con} <small>magical · other</small></dd>
    </dl><h2>Resistances</h2><div class="ud-res">${res.map(([n, v]) => `<span class="r-${n.toLowerCase()}${v ? '' : ' zero'}"><i>${n}</i>${v} %</span>`).join('')}</div>
    <h2>Proficiencies</h2><p class="ud-small">${CLASS_START[c.cls].prof.join(', ')}</p></div>
    <div class="panel ud-respec"><h2>Respec</h2><p class="ud-small">Resets the skill tree <b>and</b> the bought Attributes and refunds all ${xpSpent(c)} XP spent. Items stay.</p>
      <button class="danger">Respec for ${coin}${respecPrice(c)}</button></div></div>`);
  body.append(h(`<div class="ud-split"></div>`));
  body.firstElementChild!.append(left, right);
}

const NODE_SIZE: Record<TreeNode['kind'], number> = { start: 46, keystone: 40, unlock: 38, improve: 30, prof: 32, resist: 30, attr: 30 };
const SPACE_X = 84;
const SPACE_Y = 58;

function tree(body: HTMLElement, c: MockChar): void {
  const nodes = TREES[c.cls];
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const owned = new Set(c.nodes);
  const neighbours = (n: TreeNode) => nodes.filter((m) => m.links.includes(n.id) || n.links.includes(m.id));
  const reachable = (n: TreeNode) => neighbours(n).some((m) => owned.has(m.id));
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const w = (Math.max(...xs) - x0) * SPACE_X + 120;
  const ht = (Math.max(...ys) - y0) * SPACE_Y + 70;
  const px = (n: TreeNode) => [(n.x - x0) * SPACE_X + 60, (n.y - y0) * SPACE_Y + 35];

  const wrap = h(`<div class="ud-split ud-treewrap"><div class="panel ud-tree"><div class="ud-graph" style="width:${w}px;height:${ht}px"></div></div></div>`);
  const graph = wrap.querySelector<HTMLElement>('.ud-graph')!;
  let lines = '';
  for (const n of nodes)
    for (const l of n.links) {
      const [a, b] = [px(n), px(by[l])];
      const lit = owned.has(n.id) && owned.has(l);
      const half = owned.has(n.id) || owned.has(l);
      lines += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${lit ? 'lit' : half ? 'half' : ''}"/>`;
    }
  graph.innerHTML = `<svg width="${w}" height="${ht}">${lines}</svg>`;

  let tipNode: [HTMLElement, TreeNode] | null = null;
  // The Wizard shows a node whose requirement is not met; the Barbarian's tree stays clear.
  const want = c.cls === 'Wizard' ? 'w_a3' : null;
  for (const n of nodes) {
    const [x, y] = px(n);
    const state = owned.has(n.id) ? 'owned' : reachable(n) ? 'open' : 'locked';
    const reqOk = n.req.every((q) => reqMet(c, q));
    const s = NODE_SIZE[n.kind];
    const el = h(`<div class="ud-node k-${n.kind} ${state}${state === 'open' && !reqOk ? ' unmet' : ''}" style="left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px"><span></span></div>`);
    const inner = el.firstElementChild as HTMLElement;
    if (n.kind === 'attr') inner.textContent = n.attr!;
    else if (n.kind === 'unlock' || n.kind === 'improve') inner.innerHTML = n.kind === 'improve' ? `${ABILITY[n.ability!].mono}<i>+</i>` : ABILITY[n.ability!].mono;
    else if (n.kind === 'prof') inner.append(n.icon!.startsWith('weapon_') ? frameIcon(n.icon!, 26) : h(`<b>${n.icon}</b>`));
    else if (n.kind === 'resist') inner.textContent = '%';
    else if (n.kind === 'start') inner.append(spritePreview(atlas, FIG[c.cls][0], 2));
    if (n.kind === 'unlock') el.classList.add(`t-${ABILITY[n.ability!].tint}`);
    if (n.kind === 'unlock' || n.kind === 'keystone') graph.append(h(`<div class="ud-nlabel ${state}" style="left:${x - 50}px;top:${y + s / 2 + 2}px">${n.name}</div>`));
    graph.append(el);
    if (n.id === want) tipNode = [el, n];
  }

  const legend = h(`<div class="ud-col"><div class="panel ud-legend"><h2>Legend</h2><ul>
    <li><span class="ud-node k-attr owned mini"><span>INT</span></span>+1 Attribute</li>
    <li><span class="ud-node k-unlock owned mini t-magical"><span>MM</span></span>New ability</li>
    <li><span class="ud-node k-improve owned mini"><span>MM<i>+</i></span></span>Improves an ability (only while equipped)</li>
    <li><span class="ud-node k-prof owned mini"><span><b>L</b></span></span>Proficiency</li>
    <li><span class="ud-node k-resist owned mini"><span>%</span></span>Resistance</li>
    <li><span class="ud-node k-keystone owned mini"><span></span></span>Keystone</li>
    </ul><p class="ud-small"><span class="gold">Gold</span>: owned. <span class="lit">Bright</span>: can buy (next to an owned node). Dim: not yet reachable.</p></div>
    <div class="panel ud-mini"><h2>${c.name}</h2><div class="ud-attrs">${ATTRS.map((a) => `<span><i>${a}</i>${attrSources(c, a).total}</span>`).join('')}</div>
    <p class="ud-small">${c.xp} XP to spend · ${c.nodes.length - 1} nodes owned</p></div></div>`);
  wrap.append(legend);
  body.append(wrap);

  if (tipNode) {
    const [el, n] = tipNode;
    const reqs = n.req.map((q) => {
      const ok = reqMet(c, q);
      return `<li class="${ok ? 'ok' : 'bad'}">Needs ${reqText(q)} <span>(you have ${attrSources(c, q.attr!).total})</span></li>`;
    });
    const ab = n.ability ? ABILITY[n.ability] : null;
    tip(
      el,
      `<b>${n.name}</b><small>${ab ? `${n.kind === 'unlock' ? 'New' : 'Improves'} ${ab.slot} ability · ${ab.category}` : n.kind}</small>
      ${ab && n.kind === 'unlock' ? `<p>${abIcon(ab, true)}${ab.text}</p><p class="muted">${ab.damage} · ${ab.stats}</p>` : `<p>${n.effect}</p>`}
      <ul>${reqs.join('')}<li class="ok">Next to an owned node</li></ul><div class="cost">${n.cost} XP</div>`,
      'left',
    );
  }
}

const SLOTS: [keyof MockChar['equip'], string][] = [
  ['melee', 'Melee'],
  ['ranged', 'Ranged'],
  ['offhand', 'Off-hand'],
  ['armor', 'Armor'],
  ['shoes', 'Shoes'],
  ['belt', 'Belt'],
  ['ring1', 'Ring'],
  ['ring2', 'Ring'],
];

function itemTip(c: MockChar, it: Item): string {
  const reqs = it.req.map((q) => `<li class="${reqMet(c, q) ? 'ok' : 'bad'}">Needs ${reqText(q)} <span>(you have ${attrSources(c, q.attr!).total})</span></li>`).join('');
  return `<b>${it.name}</b><small>${it.kind} · proficient</small><p>${it.base}</p>
    <ul>${it.props.map((p) => `<li class="prop">${p.text} <span class="${p.magical ? 'mag' : 'non'}">${p.magical ? 'magical' : 'non-magical'}</span></li>`).join('')}${reqs}</ul>
    <p class="muted">Weapon effects ride only on attacks that use the weapon: your staff strike in melee poisons, your spells do not.</p>`;
}

function equipment(body: HTMLElement, c: MockChar): void {
  const doll = h(`<div class="panel ud-doll"><h2>Equipped <span class="muted">· fixed for the whole run</span></h2><div class="ud-dollgrid"><div class="ud-figure"></div></div></div>`);
  const grid = doll.querySelector('.ud-dollgrid')!;
  grid.querySelector('.ud-figure')!.append(classFigure(atlas, c.cls, 6));
  let tipEl: HTMLElement | null = null;
  for (const [key, label] of SLOTS) {
    const id = c.equip[key];
    const slot = h(`<div class="ud-slot s-${key}${key === 'offhand' ? ' reserved' : ''}"><div class="box"></div><span>${label}</span></div>`);
    const box = slot.querySelector<HTMLElement>('.box')!;
    if (id) box.append(itemIcon(ITEMS[id], 40));
    else box.innerHTML = key === 'offhand' ? '<small>shields<br>later</small>' : '<small>empty</small>';
    grid.append(slot);
  }
  doll.append(h(`<p class="ud-small">From items: +1 CON · +5 % physical, +10 % magical, +15 % heat resistance · +5 % move speed · weight +1</p>`));

  const bag = h(`<div class="panel ud-bag"><h2>Inventory <span class="muted">· placeholder</span></h2><div class="ud-baggrid"></div>
    <p class="ud-small"><span class="bad">Red</span>: not proficient, or a requirement is not met. Where items come from is out of scope.</p></div>`);
  const bg = bag.querySelector('.ud-baggrid')!;
  for (let i = 0; i < 20; i++) {
    const id = c.bag[i];
    const cell = h(`<div class="ud-cell"></div>`);
    if (id) {
      const it = ITEMS[id];
      const bad = it.noProf || it.req.some((q) => !reqMet(c, q));
      cell.classList.toggle('bad', !!bad);
      cell.append(itemIcon(it, 36));
      cell.title = it.name;
      if (id === 'rot_staff') {
        cell.classList.add('hover');
        tipEl = cell;
      }
    }
    bg.append(cell);
  }
  body.append(h(`<div class="ud-split ud-equip"></div>`));
  body.firstElementChild!.append(doll, bag);
  if (tipEl) tip(tipEl, itemTip(c, ITEMS['rot_staff']), 'below');
}

function loadout(body: HTMLElement, c: MockChar): void {
  const pool = unlocked(c);
  const locked = TREES[c.cls].filter((n) => n.kind === 'unlock' && !c.nodes.includes(n.id)).map((n) => ABILITY[n.ability!]);
  const col = (slot: 'primary' | 'secondary', key: string, chosen: string) => {
    const cards = [...pool.filter((a) => a.slot === slot), ...locked.filter((a) => a.slot === slot)]
      .map((a) => {
        const isLocked = !pool.includes(a);
        const why = isLocked ? null : invalid(c, a);
        const cls = [a.id === chosen ? 'selected' : '', why ? 'invalid' : '', isLocked ? 'locked' : ''].join(' ');
        const reqs = a.req.length ? a.req.map((q) => reqText(q)).join(', ') : 'none';
        return `<button class="ud-abcard ${cls}">${abIcon(a, true)}<div><b>${a.name}</b><small>${a.category} · ${a.uses === 'none' ? 'no weapon' : `${a.uses} weapon`}${a.ranged ? ' · ranged' : ''}</small>
          <span>${a.text}</span><small class="muted">${a.damage} · ${a.stats}</small>
          ${isLocked ? '<em>Unlock it in the skill tree</em>' : why ? `<em class="bad">${why}</em>` : `<small class="muted">Requires: ${reqs}</small>`}</div></button>`;
      })
      .join('');
    return `<div class="panel ud-pick"><h2><kbd>${key}</kbd> ${slot === 'primary' ? 'Primary' : 'Secondary'} ability</h2>${cards}</div>`;
  };
  body.append(h(`<div class="ud-split ud-loadout">${col('primary', 'LMB', c.primary)}${col('secondary', 'RMB', c.secondary)}</div>`));
  body.append(
    h(`<div class="panel ud-w ud-warn"><b>Loadout invalid:</b> Frost Nova needs INT 17. Wear the Ring of Insight (Equipment) or buy INT (Sheet). You cannot be Ready until it is fixed.
      <span class="muted">In melee, ranged primaries strike with the Ember Staff.</span></div>`),
  );
}

// ------------------------------------------------------------ waiting room

function room(root: HTMLElement): void {
  const party: [string, ClassId, string[], string, string, string, boolean][] = [
    ['Brunhild', 'Barbarian', ['great_axe'], 'strike', 'charge', 'host', true],
    ['Merlin', 'Wizard', ['ember_staff'], 'frost_shard', 'fireball', 'you', false],
    ['Shade', 'Assassin', ['knife', 'crossbow'], 'shoot', 'hide', 'ready', true],
    ['Aldric', 'Paladin', ['knight_sword'], 'judgement', 'holy_light', 'not ready', false],
  ];
  root.append(h(`<h1>Brunhild's run</h1>`));
  const rows = party
    .map(([name, cls, weapons, p, s, status]) => {
      const me = status === 'you';
      const ab = (id: string, key: string) =>
        me ? `<button class="ud-abpick">${abIcon(ABILITY[id])}<kbd>${key}</kbd>${ABILITY[id].name}<i>v</i></button>` : `<span class="ud-abshow">${abIcon(ABILITY[id])}<kbd>${key}</kbd>${ABILITY[id].name}</span>`;
      return `<li class="c-${cls.toLowerCase()}${me ? ' me' : ''}"><span class="pn">${name}${status === 'host' ? ' *' : ''}</span><span class="pc">${cls}</span>
        <span class="wp" data-w="${weapons.join(',')}"></span>${ab(p, 'LMB')}${ab(s, 'RMB')}
        <span class="${status === 'host' || status === 'ready' ? 'ok' : 'wait'}">${me ? 'not ready' : status}</span></li>`;
    })
    .join('');
  const partyEl = h(`<div class="panel ud-party"><h2>Party (4/4) <span class="muted">· your loadout can change until you are Ready</span></h2><ul class="players">${rows}</ul></div>`);
  partyEl.querySelectorAll<HTMLElement>('.wp').forEach((el) => el.dataset.w!.split(',').forEach((id) => el.append(itemIcon(ITEMS[id], 28))));
  root.append(partyEl);
  const bosses = h(`<div class="panel"><h2>End boss (chosen by the host)</h2><div class="bosses"></div></div>`);
  const bg = bosses.querySelector('.bosses')!;
  const figs: Record<string, [string, number]> = { Demon: ['demon', 2], Lich: ['lich', 3], Dragon: ['dragon', 2] };
  for (const b of [null, 'Demon', 'Lich', 'Dragon'] as const) {
    const card = h(`<button class="boss-card${b === 'Lich' ? ' selected' : ''}" disabled></button>`);
    if (b) card.append(spritePreview(atlas, figs[b][0], figs[b][1]));
    else card.append(h(`<div class="random">?</div>`));
    card.append(h(b ? `<div><b>${BOSS_TEXT[b].short}</b></div>` : `<div><b>Random</b></div>`));
    bg.append(card);
  }
  root.append(bosses, h(`<div class="row actions"><button>Leave</button><button class="primary">Ready!</button></div>`));
}
