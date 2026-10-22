import type { LineW } from '../generated/LineW';

export interface Row {
  t: number;
  kind: number;
  text: string;
  detail: boolean;
}

/** The last `cap` records the server sent, as rows for the panel. */
export class LogBuffer {
  private lines: LineW[] = [];

  constructor(private cap = 300) {}

  push(lines: LineW[]): void {
    if (lines.length === 0) return;
    this.lines.push(...lines);
    if (this.lines.length > this.cap) this.lines.splice(0, this.lines.length - this.cap);
  }

  rows(details: boolean): Row[] {
    const out: Row[] = [];
    for (const [t, kind, head, det] of this.lines) {
      out.push({ t, kind, text: `${t.toFixed(1)}s  ${head}`, detail: false });
      if (details) for (const d of det) out.push({ t, kind, text: d, detail: true });
    }
    return out;
  }

  clear(): void {
    this.lines = [];
  }
}
