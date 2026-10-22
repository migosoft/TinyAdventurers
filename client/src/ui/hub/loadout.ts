// The Loadout tab: the primary and secondary ability cards from the server's pool, and the invalid-loadout warning.
import { ABILITY_INFO } from '../../generated/progression';
import type { CharacterInfo } from '../../generated/CharacterInfo';
import type { Pick } from '../../generated/Pick';
import type { PoolCard } from '../../generated/PoolCard';
import { esc } from '../hud';
import { abilityIcon } from '../icons';
import type { TabCtx } from './hub';
import { abilityNumbers, pickLabel, poolFor, samePick } from './model';

type Slot = 'Primary' | 'Secondary';
type Info = { category: string; uses: string; req: readonly string[]; text: string };
const USES: Record<string, string> = { Melee: 'melee weapon', Ranged: 'ranged weapon', Nothing: 'no weapon' };

function cardHtml(c: PoolCard, info: CharacterInfo, unavailable: boolean): string {
  const id = c.pick.ability;
  const a = ABILITY_INFO[id] as unknown as Info;
  const ranged = c.ability?.ranged ? ' · ranged' : '';
  const numbers = c.ability ? abilityNumbers(c.ability, a.uses) : '—';
  const last = unavailable
    ? '<em class="bad">Not available any more.</em>'
    : c.locked
      ? '<em>Unlock it in the skill tree</em>'
      : c.error
        ? `<em class="bad">${esc(c.error)}</em>`
        : `<small class="muted">Requires: ${a.req.length ? esc(a.req.join(', ')) : 'none'}</small>`;
  return `${abilityIcon(id, true)}<div><b>${esc(pickLabel(c.pick, info))}${unavailable ? ' (unavailable)' : ''}</b><small>${a.category} · ${USES[a.uses] ?? 'no weapon'}${ranged}</small>
    <span>${esc(a.text)}</span><small class="muted">${esc(numbers)}</small>${last}</div>`;
}

function hint(error: string): string {
  const m = /needs ([A-Z]{3}) \d+/.exec(error);
  if (m) return `Buy ${m[1]} on the Sheet, or wear an item that gives it.`;
  if (/needs a .* weapon|a weapon of kind/.test(error)) return 'Change the weapon on the Equipment tab.';
  return '';
}

export function renderLoadout(ctx: TabCtx): HTMLElement {
  const { info, send } = ctx;
  const saved: Record<Slot, Pick> = { Primary: info.loadout.primary, Secondary: info.loadout.secondary };
  const root = document.createElement('div');
  const split = document.createElement('div');
  split.className = 'ui-split ui-loadout';
  const column = (slot: Slot, key: string) => {
    const col = document.createElement('div');
    col.className = 'panel ui-pick';
    col.innerHTML = `<h2><kbd>${key}</kbd> ${slot} ability</h2>`;
    const cards = poolFor(info, slot);
    const mine = saved[slot];
    if (!cards.some((c) => samePick(c.pick, mine))) cards.unshift({ pick: mine, ability: null, error: null, locked: false });
    const missing = cards[0].pick === mine;
    cards.forEach((c, i) => {
      const unavailable = missing && i === 0;
      const selected = samePick(c.pick, mine);
      const b = document.createElement('button');
      b.className = ['ui-abcard', selected ? 'selected' : '', unavailable || (c.error && !c.locked) ? 'invalid' : '', c.locked ? 'locked' : ''].filter(Boolean).join(' ');
      b.dataset.pick = JSON.stringify(c.pick);
      b.innerHTML = cardHtml(c, info, unavailable);
      b.onclick = () => {
        if (c.locked) return;
        send({ t: 'SetLoadout', primary: slot === 'Primary' ? c.pick : saved.Primary, secondary: slot === 'Secondary' ? c.pick : saved.Secondary });
      };
      col.append(b);
    });
    return col;
  };
  split.append(column('Primary', 'LMB'), column('Secondary', 'RMB'));
  root.append(split);
  const err = info.sheet.loadout_error;
  if (err) {
    const w = document.createElement('div');
    w.className = 'panel ui-w ui-warn';
    const h = hint(err);
    w.innerHTML = `<b>Loadout invalid:</b> ${esc(err)} ${esc(h)} You cannot be Ready until it is fixed.`;
    root.append(w);
  }
  return root;
}
