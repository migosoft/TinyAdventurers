// Hand-written SVG column charts for the admin dashboard (no chart library).
// Marks follow the dataviz rules: columns at most 24 px wide with a 4 px
// rounded top and a square base, 2 px surface gaps between stacked segments,
// hairline grid, one axis, a legend for two or more series, a tooltip per
// column (hover and keyboard focus) and a table view under every chart.
import { append, h, s } from './dom';

export interface Series {
  name: string;
  /** A CSS colour, normally a `var(--series-n)` token. */
  color: string;
  values: number[];
}

export interface ColumnChartOptions {
  title: string;
  /** One label per column (x axis), e.g. days. */
  labels: string[];
  /** Stacked bottom-up in this order. */
  series: Series[];
  /** Long form of a column label for the tooltip and the table. */
  longLabel?: (i: number) => string;
  /** Which x labels to print (all others stay in tooltip and table). */
  showLabel?: (i: number, n: number) => boolean;
  format?: (n: number) => string;
}

/** The smallest "nice" number (1, 2, 5 × 10^k) at or above `v`; 1 for 0. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * mag >= v - 1e-9) return m * mag;
  return 10 * mag;
}

/** 2-6 evenly spaced whole-number ticks from 0 to a `niceMax` value, both ends included. */
export function ticks(max: number): number[] {
  const count = [4, 5, 2, 1].find((c) => max % c === 0 && (max / c) % 1 === 0) ?? 1;
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/** Path of a column with a rounded top (radius r) and a square base. */
export function columnPath(x: number, y: number, w: number, hgt: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, hgt));
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

/** Plot height in CSS pixels; the width follows the container. */
const H = 180;
const PAD = { left: 36, right: 8, top: 10, bottom: 24 };

export function columnChart(o: ColumnChartOptions): HTMLElement {
  const fmt = o.format ?? ((v: number) => v.toLocaleString('en-US'));
  const long = o.longLabel ?? ((i: number) => o.labels[i]);
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip', role: 'status' });
  const plot = h('div', { class: 'chart-plot', style: `height:${H}px` }, tip);

  // Drawn at the container's real pixel width (and again when it changes),
  // so text and marks keep their size instead of scaling with the SVG.
  let drawnWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.floor(entry.contentRect.width);
    if (width > 0 && width !== drawnWidth) {
      drawnWidth = width;
      plot.querySelector('svg')?.remove();
      plot.prepend(drawColumns(o, width, tip, fmt, long));
    }
  }).observe(plot);

  const head = h('div', { class: 'chart-head' }, h('h3', null, o.title));
  if (o.series.length > 1) {
    const legend = h('div', { class: 'legend' });
    for (const se of o.series) legend.append(h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch', style: `background:${se.color}` }), se.name));
    head.append(legend);
  }
  append(wrap, [head, plot, dataTable(o, long, fmt)]);
  return wrap;
}

function drawColumns(o: ColumnChartOptions, W: number, tip: HTMLElement, fmt: (n: number) => string, long: (i: number) => string): SVGSVGElement {
  const n = o.labels.length;
  const totals = o.labels.map((_, i) => o.series.reduce((a, se) => a + (se.values[i] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const band = plotW / Math.max(1, n);
  const barW = Math.max(2, Math.min(24, band - 4));

  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': o.title });
  for (const t of ticks(max)) {
    svg.append(s('line', { x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t), class: t === 0 ? 'chart-base' : 'chart-grid' }));
    svg.append(s('text', { x: PAD.left - 6, y: y(t) + 4, class: 'chart-tick', 'text-anchor': 'end' }, fmt(t)));
  }

  const showTip = (i: number, cx: number) => {
    tip.replaceChildren(h('div', { class: 'tip-title' }, long(i)));
    for (const se of [...o.series].reverse()) {
      tip.append(h('div', { class: 'tip-row' }, h('span', { class: 'tip-key', style: `background:${se.color}` }), h('strong', null, fmt(se.values[i] ?? 0)), ' ', h('span', { class: 'muted' }, se.name)));
    }
    // Keep the tooltip inside the chart near the edges.
    tip.style.left = `${Math.min(Math.max(cx, 70), W - 70)}px`;
    tip.classList.add('on');
  };
  const hideTip = () => tip.classList.remove('on');

  for (let i = 0; i < n; i++) {
    const cx = PAD.left + band * i + band / 2;
    const g = s('g', { class: 'chart-col', tabindex: 0, 'aria-label': `${long(i)}: ${o.series.map((se) => `${se.name} ${fmt(se.values[i] ?? 0)}`).join(', ')}` });
    // Hit target: the whole band, not just the painted column.
    g.append(s('rect', { x: PAD.left + band * i, y: PAD.top, width: band, height: plotH, class: 'chart-hit' }));
    let base = 0;
    const filled = o.series.filter((se) => (se.values[i] ?? 0) > 0);
    filled.forEach((se, k) => {
      const v = se.values[i] ?? 0;
      const top = y(base + v);
      const bottom = y(base);
      const gap = k > 0 ? 2 : 0; // surface gap between stacked segments
      const hgt = Math.max(0, bottom - top - gap);
      const last = k === filled.length - 1;
      g.append(s('path', { d: columnPath(cx - barW / 2, top, barW, hgt, last ? 4 : 0), fill: se.color, class: 'chart-mark' }));
      base += v;
    });
    if (o.showLabel ? o.showLabel(i, n) : true) {
      g.append(s('text', { x: cx, y: H - 6, class: 'chart-tick', 'text-anchor': 'middle' }, o.labels[i]));
    }
    g.addEventListener('pointerenter', () => showTip(i, cx));
    g.addEventListener('focus', () => showTip(i, cx));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('blur', hideTip);
    svg.append(g);
  }
  return svg;
}

function dataTable(o: ColumnChartOptions, long: (i: number) => string, fmt: (n: number) => string): HTMLElement {
  const table = h('table', { class: 'table compact' }, h('thead', null, h('tr', null, h('th', null, ''), ...o.series.map((se) => h('th', { class: 'num' }, se.name)))));
  const body = h('tbody');
  o.labels.forEach((_, i) => body.append(h('tr', null, h('td', null, long(i)), ...o.series.map((se) => h('td', { class: 'num' }, fmt(se.values[i] ?? 0))))));
  table.append(body);
  return h('details', { class: 'chart-table' }, h('summary', null, 'Show as table'), table);
}

/** A thin horizontal meter for table cells: share of the column's maximum. */
export function meter(value: number, max: number, color = 'var(--series-1)'): HTMLElement {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return h('span', { class: 'meter', 'aria-hidden': 'true' }, h('span', { class: 'meter-fill', style: `width:${pct}%;background:${color}` }));
}
