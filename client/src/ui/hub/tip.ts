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

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/** Where a w x h tooltip goes: beside the anchor on the asked side, flipped to the other side when it does not fit the window; clamped to it. */
export function tipPosition(a: Box, w: number, h: number, place: 'left' | 'right' | 'below', winW: number, winH: number): { left: number; top: number } {
  const toRight = a.right + 34;
  const toLeft = a.left - 34 - w;
  let left = a.left + a.width / 2 - w / 2;
  if (place === 'right') left = toRight + w + 8 > winW && toLeft >= 8 ? toLeft : toRight;
  else if (place === 'left') left = toLeft < 8 && toRight + w + 8 <= winW ? toRight : toLeft;
  const top = place === 'below' ? a.bottom + 10 : a.top + a.height / 2 - h / 2;
  return { left: Math.max(8, Math.min(left, winW - w - 8)), top: Math.max(8, Math.min(top, winH - h - 8)) };
}

/** A tooltip beside `anchor` (left or right, centred on it) or below it. */
export function showTip(anchor: HTMLElement, html: string, place: 'left' | 'right' | 'below'): void {
  clearTips();
  const t = tipEl(html);
  document.body.append(t);
  const p = tipPosition(anchor.getBoundingClientRect(), t.offsetWidth, t.offsetHeight, place, window.innerWidth, window.innerHeight);
  t.style.left = `${p.left}px`;
  t.style.top = `${p.top}px`;
}
