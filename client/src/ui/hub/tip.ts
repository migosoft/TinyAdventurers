// Hover tooltips: one `.ui-tip` panel in the page body beside an anchor.
const tipEl = (html: string): HTMLElement => {
  const t = document.createElement('div');
  t.className = 'ui-tip';
  t.innerHTML = html;
  return t;
};

/** Removes every tooltip (each render of a screen starts with this, so none is left open for a node that is gone). */
export function clearTips(): void {
  document.querySelectorAll('.ui-tip').forEach((e) => e.remove());
}

/** A tooltip beside `anchor` (left or right, centred on it) or below it. */
export function showTip(anchor: HTMLElement, html: string, place: 'left' | 'right' | 'below'): void {
  clearTips();
  const t = tipEl(html);
  document.body.append(t);
  const a = anchor.getBoundingClientRect();
  const [w, h] = [t.offsetWidth, t.offsetHeight];
  const left = place === 'below' ? a.left + a.width / 2 - w / 2 : place === 'right' ? a.right + 34 : a.left - 34 - w;
  const top = place === 'below' ? a.bottom + 10 : a.top + a.height / 2 - h / 2;
  t.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  t.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
}
