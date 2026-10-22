/** One on/off switch in the Settings view; `key` is the keyboard shortcut shown beside it. */
export interface Toggle {
  label: string;
  key: string;
  get(): boolean;
  set(on: boolean): void;
}

/** The Settings view of the Esc menu: one checkbox row per toggle and a Back button. */
export class SettingsView {
  readonly root: HTMLElement;
  private boxes: [Toggle, HTMLInputElement][] = [];

  constructor(toggles: Toggle[], onBack: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'settings';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Settings';
    this.root.append(title);
    for (const t of toggles) {
      const row = document.createElement('label');
      row.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = t.get();
      box.onchange = () => t.set(box.checked);
      const name = document.createElement('span');
      name.textContent = t.label;
      const kbd = document.createElement('kbd');
      kbd.textContent = t.key;
      row.append(box, name, kbd);
      this.root.append(row);
      this.boxes.push([t, box]);
    }
    const back = document.createElement('button');
    back.textContent = 'Back';
    back.onclick = onBack;
    this.root.append(back);
  }

  sync(): void {
    for (const [t, box] of this.boxes) {
      const on = t.get();
      if (box.checked !== on) box.checked = on;
    }
  }
}
