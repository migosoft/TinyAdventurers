import './rulesLog.css';
import type { Row } from './buffer';

/** The log panel: bottom-left, newest line at the bottom, sticking there unless the player scrolled up. */
export class LogPanel {
  private root = document.createElement('div');
  private body = document.createElement('div');
  private toggle = document.createElement('button');
  private details = true;

  constructor(parent: HTMLElement, private onDetails: (on: boolean) => void) {
    this.root.className = 'rules-log';
    const head = document.createElement('div');
    head.className = 'rl-head';
    const title = document.createElement('span');
    title.className = 'rl-title';
    title.textContent = 'Rules log';
    this.toggle.className = 'rl-toggle';
    this.toggle.type = 'button';
    this.toggle.textContent = 'details';
    this.toggle.title = 'Shift+L';
    this.toggle.addEventListener('click', () => this.onDetails(!this.details));
    head.append(title, this.toggle);
    this.body.className = 'rl-body';
    this.root.append(head, this.body);
    // Before #ui in the page, so the pause menu and the end screen (inside #ui) paint above the log.
    const ui = parent.querySelector(':scope > #ui');
    if (ui) ui.before(this.root);
    else parent.append(this.root);
    this.setDetails(this.details);
  }

  show(on: boolean): void {
    this.root.classList.toggle('open', on);
  }

  /** Rows per record on screen, oldest first: lets `append` trim from the top without a rebuild. */
  private counts: number[] = [];

  private rowEl(r: Row): HTMLElement {
    const d = document.createElement('div');
    d.className = `rl-row k${r.kind}${r.detail ? ' detail' : ''}`;
    d.textContent = r.text;
    return d;
  }

  /** Full rebuild: a details toggle or a clear. */
  render(recs: Row[][]): void {
    const stick = this.sticks();
    const frag = document.createDocumentFragment();
    for (const rows of recs) for (const r of rows) frag.append(this.rowEl(r));
    this.body.replaceChildren(frag);
    this.counts = recs.map((rows) => rows.length);
    if (stick) this.body.scrollTop = this.body.scrollHeight;
  }

  /** Follows along: `drop` records leave the top, `add` come in at the bottom; nothing else is touched. */
  append(add: Row[][], drop: number): void {
    const stick = this.sticks();
    for (const n of this.counts.splice(0, drop)) for (let i = 0; i < n; i++) this.body.firstElementChild?.remove();
    const frag = document.createDocumentFragment();
    for (const rows of add) {
      for (const r of rows) frag.append(this.rowEl(r));
      this.counts.push(rows.length);
    }
    this.body.append(frag);
    if (stick) this.body.scrollTop = this.body.scrollHeight;
  }

  private sticks(): boolean {
    return this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 4;
  }

  setDetails(on: boolean): void {
    this.details = on;
    this.toggle.classList.toggle('on', on);
    this.toggle.setAttribute('aria-pressed', String(on));
  }

  destroy(): void {
    this.root.remove();
  }
}
