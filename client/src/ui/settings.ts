/** One on/off switch in the Settings view; `key` is the keyboard shortcut shown beside it. */
export interface Toggle {
  label: string;
  key: string;
  get(): boolean;
  set(on: boolean): void;
}

/** A pick-one row in the Settings view: radio buttons, one per option. */
export interface Choice {
  label: string;
  options: readonly (readonly [value: string, name: string])[];
  get(): string;
  set(value: string): void;
}

/** The Settings view of the Esc menu: one checkbox row per toggle, one radio row per choice and a Back button. */
export class SettingsView {
  readonly root: HTMLElement;
  private boxes: [Toggle, HTMLInputElement][] = [];

  private radios: [Choice, [string, HTMLInputElement][]][] = [];

  constructor(toggles: Toggle[], onBack: () => void, choices: Choice[] = []) {
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
    for (const c of choices) {
      const row = document.createElement('div');
      row.className = 'choice';
      const label = document.createElement('span');
      label.textContent = c.label;
      row.append(label);
      const inputs: [string, HTMLInputElement][] = [];
      const cur = c.get();
      for (const [value, text] of c.options) {
        const opt = document.createElement('label');
        opt.className = 'radio';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `choice-${c.label.toLowerCase()}`;
        input.value = value;
        input.checked = value === cur;
        input.onchange = () => { if (input.checked) c.set(value); };
        const name = document.createElement('span');
        name.textContent = text;
        opt.append(input, name);
        row.append(opt);
        inputs.push([value, input]);
      }
      this.root.append(row);
      this.radios.push([c, inputs]);
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
    for (const [c, inputs] of this.radios) {
      const cur = c.get();
      for (const [value, input] of inputs) {
        const on = value === cur;
        if (input.checked !== on) input.checked = on;
      }
    }
  }
}
