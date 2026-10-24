// The Sheet tab: the Attribute shop, the derived numbers, resistances, proficiencies, keystones and respec.
import { ATTRS, RESPEC } from '../../generated/progression';
import type { Attr } from '../../generated/Attr';
import { esc } from '../hud';
import { attrEffect, spaced } from './model';
import { showTip, clearTips } from './tip';
import type { TabCtx } from './hub';

/** The `prices` order, which is the `Attr` order. */
const ORDER: Attr[] = ['Str', 'Dex', 'Con', 'Int', 'Wil', 'Cha'];
const NAME: Record<Attr, string> = { Str: 'Strength', Dex: 'Dexterity', Con: 'Constitution', Int: 'Intelligence', Wil: 'Willpower', Cha: 'Charisma' };
const COIN = '<i class="coin-icon"></i>';

/** The server sends resistances as fractions (0.1 = 10 %); a negative one keeps its sign. */
export const fraction = (v: number): string => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))} %`;
const num = (v: number): number => Math.round(v * 10) / 10;

export function renderSheet(ctx: TabCtx): HTMLElement {
  const { info, send, debug } = ctx;
  const s = info.sheet;
  const el = document.createElement('div');
  el.className = 'ui-split';

  const rows = ORDER.map((attr, i) => {
    const l = s.attrs.find((x) => x.attr === attr)!;
    const parts = [`class ${l.class}`, l.shop && `shop +${l.shop}`, l.items && `items +${l.items}`].filter(Boolean).join(' · ');
    const price = info.prices[i];
    return `<li data-row="${attr}"><span class="ab">${ATTRS[attr].short}</span><span class="nm">${NAME[attr]}<small>${parts}</small></span><b class="val">${l.total}</b>
      <span class="eff">${esc(attrEffect(attr, l.total))}</span>${debug ? `<button data-attr="${attr}">+1 · free</button>` : `<button data-attr="${attr}"${info.xp < price ? ' disabled' : ''}>+1 · ${price} XP</button>`}</li>`;
  }).join('');
  const weights = ORDER.filter((a) => ATTRS[a].weight !== 1).map((a) => `${ATTRS[a].short} ${ATTRS[a].weight}`).join(', ');
  const left = document.createElement('div');
  left.className = 'panel ui-attrshop';
  left.innerHTML = `<h2>Attributes <span class="muted">· Attribute shop</span></h2><ul>${rows}</ul>
    <small class="hint">Price per point: (100 + 25 × points above 10) × weight. Weights: ${weights}, others 1. Item points do not raise the price.</small>`;
  left.querySelectorAll<HTMLButtonElement>('[data-attr]').forEach((b) => {
    b.onclick = () => send({ t: debug ? 'DebugBuyAttribute' : 'BuyAttribute', attr: b.dataset.attr as Attr });
  });
  left.querySelectorAll<HTMLElement>('li[data-row]').forEach((li) => {
    const attr = li.dataset.row as Attr;
    li.onmouseenter = () => showTip(li, `<b>${NAME[attr]}</b><p>${esc(ATTRS[attr].text)}</p>`, 'below');
    li.onmouseleave = clearTips;
  });

  const resist = (list: [string, number][]) =>
    list.length
      ? `<div class="ui-res">${list.map(([n, v]) => `<span class="r-${esc(n.toLowerCase())}"><i>${esc(spaced(n))}</i>${fraction(v)}</span>`).join('')}</div>`
      : '<p class="ui-small">None.</p>';
  const keystones = s.keystones.length ? s.keystones.map(spaced).join(', ') : 'None.';
  const right = document.createElement('div');
  right.className = 'ui-col';
  right.innerHTML = `
    <div class="panel ui-derived"><h2>Derived</h2><dl>
      <dt>HP</dt><dd>${num(s.hp)}</dd>
      <dt>Move speed</dt><dd>${num(s.speed)}</dd>
      <dt>Weight</dt><dd>${num(s.weight)}</dd>
      <dt>Push power</dt><dd>${num(s.push)} <small>STR vs target weight</small></dd>
      <dt>Saves</dt><dd>WIL ${s.save_wil} · CON ${s.save_con} <small>magical · other</small></dd>
    </dl>
    <h2>Resistances</h2>${resist([...s.res, ...s.effect_res])}
    <h2>Proficiencies</h2><p class="ui-small">${esc(s.profs.join(', ')) || 'None.'}</p>
    <h2>Keystones</h2><p class="ui-small">${esc(keystones)}</p></div>
    <div class="panel ui-respec"><h2>Respec</h2>
      <p class="ui-small">Resets the skill tree <b>and</b> the bought Attributes and refunds all ${info.xp_spent} XP spent. Items stay. ${debug ? 'Debug: free (free buys refund nothing).' : `It costs ${COIN}${RESPEC.base} plus ${COIN}1 per ${RESPEC.per} XP spent.`}</p>
      ${debug
        ? `<button id="respec" class="danger"${info.nodes.length === 0 && s.attrs.every((l) => !l.shop) ? ' disabled' : ''}>Respec for free (debug)</button>`
        : `<button id="respec" class="danger"${info.coins < info.respec_price || info.xp_spent === 0 ? ' disabled' : ''}>Respec for ${COIN}${info.respec_price}</button>`}</div>`;
  right.querySelector<HTMLButtonElement>('#respec')!.onclick = () => {
    if (confirm('Reset your skill tree and bought Attributes, and get all spent XP back?')) send(debug ? { t: 'DebugRespec' } : { t: 'Respec' });
  };

  el.append(left, right);
  return el;
}
