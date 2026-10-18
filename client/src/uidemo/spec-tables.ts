// Prints the spec's ability and skill-tree tables from data.ts (Markdown, to stdout):
// cd client && npx tsx src/uidemo/spec-tables.ts
import { ABILITIES, reqText, TREES } from './data';
import type { Req } from './data';

const reqs = (r: Req[]) => (r.length ? r.map(reqText).join(', ') : '–');
const out: string[] = [];
out.push('| Class | Ability | Slot | Category | Uses | Blocked in melee | Requirements | Damage | Stats | Light |', '|---|---|---|---|---|---|---|---|---|---|');
for (const a of ABILITIES.filter((a) => !a.start))
  out.push(`| ${a.cls} | **${a.name}** | ${a.slot} | ${a.category} | ${a.uses} | ${a.ranged ? 'yes' : 'no'} | ${reqs(a.req)} | ${a.damage} | ${a.stats} | ${a.light} |`);
for (const [cls, nodes] of Object.entries(TREES)) {
  out.push('', `**${cls}** (${nodes.length - 1} nodes, ${nodes.reduce((s, n) => s + n.cost, 0)} XP in all)`, '', '| Id | x,y | Kind | Name | Effect | XP | Requires | Links to |', '|---|---|---|---|---|---|---|---|');
  for (const n of nodes) out.push(`| \`${n.id}\` | ${n.x},${n.y} | ${n.kind} | ${n.name} | ${n.effect} | ${n.cost} | ${reqs(n.req)} | ${n.links.map((l) => `\`${l}\``).join(' ') || '–'} |`);
}
console.log(out.join('\n'));
