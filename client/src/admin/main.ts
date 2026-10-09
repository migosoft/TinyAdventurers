// The admin page (/admin): login, dashboard, players, player details and the
// audit log. Plain DOM, no Phaser. Views are chosen by the URL hash:
// #/ (dashboard), #/players, #/players/<id>, #/audit.
import type { AdminStats } from '../generated/AdminStats';
import type { PlayerDetail } from '../generated/PlayerDetail';
import { adminApi, ApiFail, type PlayerSort } from './api';
import { columnChart, meter } from './charts';
import { compact, date, dateTime, duration, h, percent, since } from './dom';
import './admin.css';

const root = document.getElementById('admin')!;
const REFRESH_MS = 30_000;

let adminName = '';
let refreshTimer: number | undefined;

// ------------------------------------------------------------------ shell

function flash(msg: string, kind: 'ok' | 'error' = 'ok'): void {
  const box = document.getElementById('flash');
  if (!box) return;
  box.replaceChildren(h('div', { class: `flash ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg));
  if (kind === 'ok') setTimeout(() => box.replaceChildren(), 4000);
}

/** Handles an API failure: a lost session goes back to the login. */
function failed(e: unknown): void {
  if (e instanceof ApiFail && e.status === 401) return void showLogin('Your admin session ended. Please log in again.');
  flash(e instanceof Error ? e.message : String(e), 'error');
}

function shell(active: 'dashboard' | 'players' | 'audit', ...content: HTMLElement[]): HTMLElement {
  const link = (href: string, key: typeof active, label: string) => h('a', { href, class: key === active ? 'active' : '', 'aria-current': key === active ? 'page' : undefined }, label);
  const main = h('main', { class: 'content' }, ...content);
  // The message box outlives view changes, so "Player deleted" shows on the list.
  const flashBox = document.getElementById('flash') ?? h('div', { id: 'flash', class: 'flash-box' });
  root.replaceChildren(
    h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'brand' }, 'Tiny Adventurers ', h('span', { class: 'muted' }, 'admin')),
      h('nav', null, link('#/', 'dashboard', 'Dashboard'), link('#/players', 'players', 'Players'), link('#/audit', 'audit', 'Audit log')),
      h('span', { class: 'who' }, h('span', { class: 'muted' }, adminName), ' ', h('button', { class: 'link', on: { click: logout } }, 'Log out')),
    ),
    flashBox,
    main,
  );
  return main;
}

async function logout(): Promise<void> {
  await adminApi.logout().catch(() => undefined);
  showLogin();
}

function showLogin(message = ''): void {
  clearInterval(refreshTimer);
  adminName = '';
  const name = h('input', { name: 'name', autocomplete: 'username', required: true });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'error', role: 'alert' }, message);
  const button = h('button', { type: 'submit', class: 'primary' }, 'Log in');
  const form = h(
    'form',
    {
      class: 'card login',
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          button.disabled = true;
          try {
            adminName = (await adminApi.login(name.value, password.value)).name;
            route();
          } catch (e) {
            error.textContent = e instanceof Error ? e.message : String(e);
            password.value = '';
            password.focus();
          } finally {
            button.disabled = false;
          }
        },
      },
    },
    h('h1', null, 'Tiny Adventurers admin'),
    h('label', null, 'Admin name', name),
    h('label', null, 'Password', password),
    error,
    button,
  );
  root.replaceChildren(h('main', { class: 'login-wrap' }, form));
  name.focus();
}

// -------------------------------------------------------------- dashboard

function tile(label: string, value: string, note?: string, hero = false): HTMLElement {
  return h('div', { class: hero ? 'tile hero' : 'tile' }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value), note ? h('div', { class: 'tile-note' }, note) : null);
}

function section(title: string, ...body: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'card' }, h('h2', null, title), ...body);
}

function table(head: (string | [string, 'num'])[], rows: (HTMLElement | string | number)[][], empty = 'Nothing yet.'): HTMLElement {
  if (rows.length === 0) return h('p', { class: 'muted' }, empty);
  const th = head.map((c) => (Array.isArray(c) ? h('th', { class: 'num' }, c[0]) : h('th', null, c)));
  const numeric = head.map((c) => Array.isArray(c));
  return h(
    'div',
    { class: 'table-wrap' },
    h('table', { class: 'table' }, h('thead', null, h('tr', null, ...th)), h('tbody', null, ...rows.map((r) => h('tr', null, ...r.map((cell, i) => h('td', { class: numeric[i] ? 'num' : '' }, cell)))))),
  );
}

function playerLink(id: number, name: string): HTMLElement {
  return h('a', { href: `#/players/${id}` }, name);
}

/** "03-07" from "2026-03-07". */
const shortDay = (day: string) => day.slice(5);
const longDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const everyWeek = (i: number, n: number) => (n - 1 - i) % 7 === 0;

function renderDashboard(s: AdminStats, main: HTMLElement, updated: Date): void {
  const [d1, d7, d30] = [1, 7, 30].map((d) => s.windows.find((w) => w.days === d)!);
  const finished = (w: typeof d1) => w.victories + w.defeats;

  const live = section(
    'Right now',
    h(
      'div',
      { class: 'tiles' },
      tile('Players online', compact(s.live.online), undefined, true),
      tile('In a dungeon', compact(s.live.in_run)),
      tile('In the lobby', compact(s.live.in_lobby)),
      tile('Dungeons running', compact(s.live.runs_active)),
      tile('Rooms waiting', compact(s.live.rooms_open)),
    ),
    table(
      ['Player', 'Character', 'Where', ['Online for', 'num']],
      s.live.players.map((p) => [playerLink(p.account_id, p.account), p.character ? `${p.character} (${p.class})` : '–', p.in_run ? 'Dungeon' : 'Lobby', since(p.since)]),
      'Nobody is online.',
    ),
  );

  const windowRow = (label: string, f: (w: typeof d1) => string) => [label, f(d1), f(d7), f(d30)];
  const activity = section(
    'Activity',
    h('p', { class: 'muted small' }, 'Calendar days in UTC. "7 days" is today and the six days before. History is counted from the first deployment of the admin area.'),
    table(
      ['', ['Today', 'num'], ['7 days', 'num'], ['30 days', 'num']],
      [
        windowRow('Active players', (w) => compact(w.active_players)),
        windowRow('New accounts', (w) => compact(w.registrations)),
        windowRow('Runs', (w) => compact(w.runs)),
        windowRow('Won', (w) => compact(w.victories)),
        windowRow('Lost', (w) => compact(w.defeats)),
        windowRow('Left by everyone', (w) => compact(w.abandoned)),
        windowRow('Win rate (won ÷ finished)', (w) => percent(w.victories, finished(w))),
        windowRow('Average length', (w) => (w.runs ? duration(w.avg_duration_s) : '–')),
        windowRow('Average party size', (w) => (w.runs ? w.avg_party.toFixed(1) : '–')),
        windowRow('Enemies killed', (w) => compact(w.kills)),
        windowRow('Hero deaths', (w) => compact(w.deaths)),
      ],
    ),
  );

  const totals = section(
    'All time',
    h(
      'div',
      { class: 'tiles' },
      tile('Accounts', compact(s.totals.accounts)),
      tile('Characters', compact(s.totals.characters)),
      tile('Runs played', compact(s.totals.runs), 'since tracking began'),
      tile('XP earned', compact(s.totals.total_xp), 'all characters'),
      tile('Coins held', compact(s.totals.coins), 'unspent'),
    ),
  );

  const days = s.trend.map((p) => p.day);
  const common = { labels: days.map(shortDay), longLabel: (i: number) => longDay(days[i]), showLabel: everyWeek };
  const trends = section(
    'Last 30 days',
    h(
      'div',
      { class: 'charts' },
      columnChart({ ...common, title: 'Active players per day', series: [{ name: 'Active players', color: 'var(--series-1)', values: s.trend.map((p) => p.active_players) }] }),
      columnChart({
        ...common,
        title: 'Runs per day',
        series: [
          { name: 'Won', color: 'var(--series-1)', values: s.trend.map((p) => p.victories) },
          { name: 'Lost or left', color: 'var(--series-2)', values: s.trend.map((p) => p.runs - p.victories) },
        ],
      }),
      columnChart({ ...common, title: 'New accounts per day', series: [{ name: 'New accounts', color: 'var(--series-1)', values: s.trend.map((p) => p.registrations) }] }),
    ),
  );

  const bosses = section(
    'Bosses (last 30 days)',
    table(
      ['Boss', ['Runs', 'num'], ['Won', 'num'], ['Lost', 'num'], ['Win rate', 'num'], ['Average length', 'num']],
      s.bosses.map((b) => [b.boss, compact(b.runs), compact(b.victories), compact(b.defeats), percent(b.victories, b.victories + b.defeats), b.victories + b.defeats ? duration(b.avg_duration_s) : '–']),
      'No runs in the last 30 days.',
    ),
  );

  const maxChars = Math.max(0, ...s.classes.map((c) => c.characters));
  const maxPlayed = Math.max(0, ...s.classes.map((c) => c.played));
  const classes = section(
    'Classes',
    table(
      ['Class', ['Characters', 'num'], '', ['Runs played (30 days)', 'num'], ''],
      s.classes.map((c) => [c.class, compact(c.characters), meter(c.characters, maxChars), compact(c.played), meter(c.played, maxPlayed)]),
    ),
  );

  const levels =
    s.levels.length > 0
      ? columnChart({
          title: 'Characters by upgrades bought',
          labels: s.levels.map((l) => String(l.upgrades)),
          longLabel: (i) => `${s.levels[i].upgrades} upgrade${s.levels[i].upgrades === 1 ? '' : 's'}`,
          series: [{ name: 'Characters', color: 'var(--series-1)', values: s.levels.map((l) => l.characters) }],
        })
      : h('p', { class: 'muted' }, 'No characters yet.');

  const top = section(
    'Top characters by XP earned',
    table(
      ['Character', 'Class', 'Player', ['XP earned', 'num'], ['Upgrades', 'num'], ['Coins', 'num']],
      s.top.map((c) => [c.name, c.class, playerLink(c.account_id, c.account), compact(c.total_xp), String(c.upgrades), compact(c.coins)]),
    ),
  );

  const refresh = h('button', { class: 'link', on: { click: () => loadDashboard(main) } }, 'Refresh');
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', null, 'Dashboard'), h('span', { class: 'muted small' }, `Updated ${updated.toLocaleTimeString()} · every 30 s · `, refresh)),
    live,
    h('div', { class: 'grid-2' }, activity, h('div', { class: 'stack' }, totals, bosses)),
    trends,
    h('div', { class: 'grid-2' }, classes, section('Progress', levels)),
    top,
  );
}

async function loadDashboard(main: HTMLElement): Promise<void> {
  main.classList.add('loading'); // keep the previous render while fetching
  try {
    renderDashboard(await adminApi.stats(), main, new Date());
  } catch (e) {
    failed(e);
  } finally {
    main.classList.remove('loading');
  }
}

function dashboard(): void {
  const main = shell('dashboard', h('p', { class: 'muted' }, 'Loading…'));
  void loadDashboard(main);
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void loadDashboard(main);
  }, REFRESH_MS);
}

// ---------------------------------------------------------------- players

const playersState = { q: '', sort: 'name' as PlayerSort, page: 0 };

function players(): void {
  const results = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search by name', value: playersState.q, 'aria-label': 'Search players by name' });
  const sort = h(
    'select',
    { 'aria-label': 'Sort players' },
    h('option', { value: 'name' }, 'Name A–Z'),
    h('option', { value: 'active' }, 'Last active'),
    h('option', { value: 'created' }, 'Newest'),
  );
  sort.value = playersState.sort;

  const load = async () => {
    results.classList.add('loading');
    try {
      const p = await adminApi.players(playersState.q, playersState.sort, playersState.page);
      const pages = Math.max(1, Math.ceil(p.total / p.page_size));
      const go = (page: number) => () => {
        playersState.page = page;
        void load();
      };
      results.replaceChildren(
        h('p', { class: 'muted small' }, `${compact(p.total)} player${p.total === 1 ? '' : 's'}`),
        table(
          ['Name', 'Status', ['Characters', 'num'], 'Last active', 'Registered'],
          p.players.map((r) => [playerLink(r.id, r.name), r.online ? h('span', { class: 'badge on' }, 'Online') : h('span', { class: 'muted' }, 'Offline'), String(r.characters), r.last_active ?? '–', date(r.created)]),
          'No players match.',
        ),
        h(
          'div',
          { class: 'pager', hidden: pages <= 1 },
          h('button', { disabled: p.page === 0, on: { click: go(p.page - 1) } }, '← Previous'),
          h('span', { class: 'muted' }, `Page ${p.page + 1} of ${pages}`),
          h('button', { disabled: p.page + 1 >= pages, on: { click: go(p.page + 1) } }, 'Next →'),
        ),
      );
    } catch (e) {
      failed(e);
    } finally {
      results.classList.remove('loading');
    }
  };

  let debounce: number | undefined;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      playersState.q = search.value;
      playersState.page = 0;
      void load();
    }, 250);
  });
  sort.addEventListener('change', () => {
    playersState.sort = sort.value as PlayerSort;
    playersState.page = 0;
    void load();
  });

  shell('players', h('div', { class: 'page-head' }, h('h1', null, 'Players')), h('section', { class: 'card' }, h('div', { class: 'filters' }, search, sort), results));
  void load();
}

// ----------------------------------------------------------- player detail

async function player(id: number): Promise<void> {
  const main = shell('players', h('p', { class: 'muted' }, 'Loading…'));
  let d: PlayerDetail;
  try {
    d = await adminApi.player(id);
  } catch (e) {
    main.replaceChildren(h('p', null, h('a', { href: '#/players' }, '← All players')));
    return failed(e);
  }
  const p = d.player;
  const reload = () => void player(id);

  const characters = table(
    ['Character', 'Class', ['XP earned', 'num'], ['Unspent XP', 'num'], ['Coins', 'num'], 'Upgrades', 'Created', ''],
    d.characters.map((c) => {
      const u = c.info.upgrades;
      const del = h(
        'button',
        {
          class: 'danger small',
          on: {
            click: async () => {
              const warn = c.in_use ? ' They are playing it right now and will be logged out.' : '';
              if (!confirm(`Delete the character "${c.info.name}" of ${p.name}? Its XP, coins and upgrades are lost.${warn}`)) return;
              try {
                await adminApi.deleteCharacter(c.info.id);
                reload();
                flash(`Character ${c.info.name} deleted.`);
              } catch (e) {
                failed(e);
              }
            },
          },
        },
        'Delete',
      );
      return [
        h('span', null, c.info.name, c.in_use ? h('span', { class: 'badge on' }, 'Playing') : null),
        c.info.class,
        compact(c.info.total_xp),
        compact(c.info.xp),
        compact(c.info.coins),
        `Damage ${u.damage} · Speed ${u.attack_speed} · Move ${u.move_speed} · Life ${u.life} · Armor ${u.armor}`,
        date(c.created),
        del,
      ];
    }),
    'No characters.',
  );

  const pw1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, maxlength: 128, required: true });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const pwForm = h(
    'form',
    {
      class: 'form-row',
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          if (pw1.value !== pw2.value) return flash('The two passwords differ.', 'error');
          try {
            await adminApi.setPassword(id, pw1.value);
            pw1.value = pw2.value = '';
            flash(`Password of ${p.name} changed. All their sessions were ended.`);
          } catch (e) {
            failed(e);
          }
        },
      },
    },
    h('label', null, 'New password', pw1),
    h('label', null, 'Repeat', pw2),
    h('button', { type: 'submit', class: 'primary' }, 'Change password'),
  );

  const confirmName = h('input', { autocomplete: 'off', 'aria-label': `Type ${p.name} to confirm` });
  const delButton = h('button', { type: 'submit', class: 'danger', disabled: true }, 'Delete player');
  confirmName.addEventListener('input', () => (delButton.disabled = confirmName.value !== p.name));
  const delForm = h(
    'form',
    {
      class: 'form-row',
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          if (confirmName.value !== p.name) return;
          try {
            await adminApi.deletePlayer(id);
            location.hash = '#/players';
            flash(`Player ${p.name} deleted.`);
          } catch (e) {
            failed(e);
          }
        },
      },
    },
    h('label', null, h('span', null, 'Type ', h('strong', null, p.name), ' to confirm'), confirmName),
    delButton,
  );

  const runs = table(
    ['Started', 'Character', 'Boss', 'Result', ['Length', 'num'], ['Party', 'num'], ['Kills', 'num'], ['XP', 'num'], ['Coins', 'num']],
    d.recent_runs.map((r) => [
      dateTime(r.started),
      `${r.character ?? '(deleted)'} (${r.class})`,
      r.boss,
      r.outcome === 'victory' ? 'Won' : r.outcome === 'defeat' ? 'Lost' : 'Left',
      duration(r.duration_s),
      String(r.players),
      compact(r.kills),
      compact(r.xp),
      compact(r.coins),
    ]),
    'No runs recorded.',
  );

  main.replaceChildren(
    h('p', null, h('a', { href: '#/players' }, '← All players')),
    h('div', { class: 'page-head' }, h('h1', null, p.name), p.online ? h('span', { class: 'badge on' }, 'Online') : h('span', { class: 'badge' }, 'Offline')),
    h(
      'div',
      { class: 'tiles' },
      tile('Registered', date(p.created)),
      tile('Last active', p.last_active ?? '–'),
      tile('Active days', compact(d.active_days)),
      tile('Runs played', compact(d.runs_played)),
      tile('Characters', String(d.characters.length)),
    ),
    section('Characters', characters),
    section('Recent runs', runs),
    section('Change password', h('p', { class: 'muted small' }, 'The player is logged out everywhere and must use the new password. There is no e-mail, so tell them yourself.'), pwForm),
    h('section', { class: 'card danger-zone' }, h('h2', null, 'Delete player'), h('p', { class: 'muted small' }, 'Deletes the account and all its characters for good. The player is logged out at once.'), delForm),
  );
}

// -------------------------------------------------------------- audit log

async function audit(): Promise<void> {
  const main = shell('audit', h('p', { class: 'muted' }, 'Loading…'));
  try {
    const rows = await adminApi.actions();
    const label: Record<string, string> = { delete_account: 'Deleted player', set_password: 'Changed password', delete_character: 'Deleted character' };
    main.replaceChildren(
      h('div', { class: 'page-head' }, h('h1', null, 'Audit log'), h('span', { class: 'muted small' }, 'The last 100 changes made in the admin area.')),
      h('section', { class: 'card' }, table(['When', 'Admin', 'Action', 'Target', 'Detail'], rows.map((a) => [dateTime(a.at), a.admin, label[a.action] ?? a.action, a.target, a.detail ?? '']), 'No changes yet.')),
    );
  } catch (e) {
    failed(e);
  }
}

// ------------------------------------------------------------------ router

function route(): void {
  clearInterval(refreshTimer);
  if (!adminName) return showLogin();
  const path = location.hash.replace(/^#/, '') || '/';
  const m = path.match(/^\/players\/(\d+)$/);
  if (m) void player(Number(m[1]));
  else if (path === '/players') players();
  else if (path === '/audit') void audit();
  else dashboard();
}

window.addEventListener('hashchange', route);

async function start(): Promise<void> {
  try {
    adminName = (await adminApi.me())?.name ?? '';
  } catch (e) {
    root.replaceChildren(h('main', { class: 'login-wrap' }, h('div', { class: 'card login' }, h('h1', null, 'Tiny Adventurers admin'), h('p', { class: 'error' }, e instanceof Error ? e.message : String(e)))));
    return;
  }
  route();
}

void start();
