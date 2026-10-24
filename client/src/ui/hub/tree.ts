// The Skill tree tab: the class's node graph with owned / buyable / blocked / locked nodes, hover tooltips and buying.
import { ABILITIES } from '../../generated/defs';
import { ABILITY_INFO, ATTRS } from '../../generated/progression';
import type { Attr } from '../../generated/Attr';
import type { NodeId } from '../../generated/NodeId';
import { classFigure, figureWeapon } from '../classes';
import { esc } from '../hud';
import { abilityIcon } from '../icons';
import { abilityNumbers, monogram, nodeState, nodesOf, requirementStatus, spaced, unmetRequirements, type NodeState, type TreeKind, type TreeNode } from './model';
import { clearTips, showTip } from './tip';
import type { TabCtx } from './hub';


const NODE_SIZE: Record<TreeKind, number> = { Start: 46, Keystone: 40, Unlock: 38, Improve: 30, Proficiency: 32, Resist: 30 };
const SPACE_X = 84;
const SPACE_Y = 58;
const ATTR_ORDER: Attr[] = ['Str', 'Dex', 'Con', 'Int', 'Wil', 'Cha'];
const div = (cls: string, html = ''): HTMLElement => {
  const e = document.createElement('div');
  e.className = cls;
  e.innerHTML = html;
  return e;
};

function label(n: TreeNode, ctx: TabCtx): string | Node {
  switch (n.kind) {
    case 'Unlock':
      return monogram(ABILITIES[n.ability!].name);
    case 'Improve':
      return `${monogram(ABILITIES[n.ability!].name)}<i>+</i>`;
    case 'Resist':
      return '%';
    case 'Proficiency':
      return 'P';
    case 'Start':
      return classFigure(ctx.atlas, ctx.info.class, 2, figureWeapon(ctx.info));
    default:
      return '';
  }
}

const KIND_LABEL: Record<string, string> = { Resist: 'Resistance', Proficiency: 'Proficiency', Keystone: 'Keystone', Start: 'Start' };

function tipHtml(n: TreeNode, state: NodeState, ctx: TabCtx): string {
  const { info } = ctx;
  const ab = n.ability ? ABILITIES[n.ability] : null;
  const kindLine = !ab ? (KIND_LABEL[n.kind] ?? n.kind) : n.kind === 'Unlock' ? `New ${ab.slot.toLowerCase()} ability · ${spaced(ABILITY_INFO[n.ability!].category)}` : `Improves ${ab.name}`;
  let body: string;
  if (n.kind === 'Unlock') {
    const card = info.sheet.pool.find((c) => c.pick.ability === n.ability && c.pick.source === 'Own');
    const nums = card?.ability ? abilityNumbers(card.ability, ABILITY_INFO[n.ability!].uses) : '';
    body = `<p>${abilityIcon(n.ability!, true)}${esc(ABILITY_INFO[n.ability!].text)}</p>${nums ? `<p class="muted">${esc(nums)}</p>` : ''}`;
  } else body = `<p>${esc(n.text)}</p>`;
  const reqs = requirementStatus(info, n.req, true)
    .map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">Needs ${esc(r.text)} <span>(you have ${r.have})</span></li>`)
    .join('');
  const near = `<li class="${state === 'locked' ? 'bad' : 'ok'}">Next to an owned node</li>`;
  const cost = state === 'owned' || n.kind === 'Start' ? '' : ctx.debug ? `<div class="cost">${n.cost} XP · free (debug)</div>` : `<div class="cost${info.xp < n.cost ? ' bad' : ''}">${n.cost} XP</div>`;
  return `<b>${esc(n.name)}</b><small>${esc(kindLine)}</small>${body}<ul>${reqs}${state === 'owned' ? '' : near}</ul>${cost}`;
}

export function renderTree(ctx: TabCtx): HTMLElement {
  const { info, send } = ctx;
  const nodes = nodesOf(info).nodes;
  const entries = Object.entries(nodes) as [NodeId, TreeNode][];
  const xs = entries.map(([, n]) => n.pos[0]);
  const ys = entries.map(([, n]) => n.pos[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const w = (Math.max(...xs) - x0) * SPACE_X + 120;
  const ht = (Math.max(...ys) - y0) * SPACE_Y + 70;
  const px = (n: TreeNode): [number, number] => [(n.pos[0] - x0) * SPACE_X + 60, (n.pos[1] - y0) * SPACE_Y + 35];
  const state = new Map(entries.map(([id]) => [id, nodeState(info, id, ctx.debug)]));
  const owned = (id: string) => state.get(id as NodeId) === 'owned';

  const el = div('ui-split ui-treewrap');
  const graph = div('ui-graph');
  graph.style.width = `${w}px`;
  graph.style.height = `${ht}px`;
  let lines = '';
  for (const [id, n] of entries)
    for (const l of n.links) {
      const [a, b] = [px(n), px(nodes[l])];
      const cls = owned(id) && owned(l) ? 'lit' : owned(id) || owned(l) ? 'half' : '';
      lines += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${cls}"/>`;
    }
  graph.innerHTML = `<svg width="${w}" height="${ht}">${lines}</svg>`;

  for (const [id, n] of entries) {
    const st = state.get(id)!;
    const [x, y] = px(n);
    const s = NODE_SIZE[n.kind];
    const unmet = st === 'blocked' && unmetRequirements(info, n.req, true).length > 0;
    const e = div(`ui-node k-${n.kind.toLowerCase()} ${st}${unmet ? ' unmet' : ''}`, '<span></span>');
    e.dataset.node = id;
    e.style.cssText = `left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px`;
    const inner = e.firstElementChild!;
    const l = label(n, ctx);
    if (typeof l === 'string') inner.innerHTML = l;
    else inner.append(l);
    if (n.kind === 'Unlock') e.classList.add(`t-${(ABILITY_INFO[n.ability!].tint ?? 'none').toLowerCase()}`);
    if (n.kind === 'Unlock' || n.kind === 'Keystone') {
      const lab = div(`ui-nlabel ${st === 'owned' ? 'owned' : st === 'buyable' || st === 'blocked' ? 'reach' : ''}`, esc(n.name));
      lab.style.cssText = `left:${x - 50}px;top:${y + s / 2 + 2}px`;
      graph.append(lab);
    }
    e.onmouseenter = () => showTip(e, tipHtml(n, st, ctx), 'left');
    e.onmouseleave = () => clearTips();
    e.onclick = () => {
      if (st !== 'buyable') return;
      if (ctx.debug) send({ t: 'DebugBuyNode', node: id });
      else if (confirm(`Buy ${n.name} for ${n.cost} XP?`)) send({ t: 'BuyNode', node: id });
    };
    graph.append(e);
  }
  const tree = div('panel ui-tree');
  tree.append(graph);
  el.append(tree);

  const legend = div(
    'ui-col',
    `<div class="panel ui-legend"><h2>Legend</h2><ul>
    <li><span class="ui-node k-unlock owned mini t-magical"><span>MM</span></span>New ability</li>
    <li><span class="ui-node k-improve owned mini"><span>MM<i>+</i></span></span>Improves an ability (only while equipped)</li>
    <li><span class="ui-node k-proficiency owned mini"><span>P</span></span>Proficiency</li>
    <li><span class="ui-node k-resist owned mini"><span>%</span></span>Resistance</li>
    <li><span class="ui-node k-keystone owned mini"><span></span></span>Keystone</li>
    </ul><p class="ui-small"><span class="gold">Gold</span>: owned. <span class="lit">Bright</span>: can buy (next to an owned node). Dim: not yet reachable.</p></div>
    <div class="panel ui-mini"><h2>${esc(info.name)}</h2><div class="ui-attrs">${ATTR_ORDER.map((a) => `<span><i>${ATTRS[a].short}</i>${info.sheet.attrs.find((l) => l.attr === a)?.total ?? 0}</span>`).join('')}</div>
    <p class="ui-small">${info.xp} XP to spend · ${info.nodes.length} nodes owned</p>${ctx.debug ? '<p class="ui-small">Debug: nodes are free (saved on this character).</p>' : ''}</div>`,
  );
  el.append(legend);
  return el;
}
