import type { LineW } from '../generated/LineW';

export interface Row {
  t: number;
  kind: number;
  text: string;
  detail: boolean;
}

const recordRows = ([t, kind, head, det]: LineW, details: boolean): Row[] => {
  const out: Row[] = [{ t, kind, text: `${t.toFixed(1)}s  ${head}`, detail: false }];
  if (details) for (const d of det) out.push({ t, kind, text: d, detail: true });
  return out;
};

/** The last `cap` records the server sent, as rows for the panel. */
export class LogBuffer {
  private lines: LineW[] = [];

  constructor(private cap = 300) {}

  /**
   * Adds records. Returns what a panel needs to follow along without a rebuild: the rows of the
   * new records that stayed within the cap, and how many old records fell off the top.
   */
  push(lines: LineW[], details = true): { add: Row[][]; drop: number } {
    if (lines.length === 0) return { add: [], drop: 0 };
    const before = this.lines.length;
    this.lines.push(...lines);
    const over = Math.max(0, this.lines.length - this.cap);
    if (over > 0) this.lines.splice(0, over);
    const kept = Math.min(lines.length, this.lines.length);
    return { add: this.lines.slice(this.lines.length - kept).map((l) => recordRows(l, details)), drop: Math.min(over, before) };
  }

  /** Every record as its rows (head first, then details when asked). */
  recordRows(details: boolean): Row[][] {
    return this.lines.map((l) => recordRows(l, details));
  }

  rows(details: boolean): Row[] {
    return this.recordRows(details).flat();
  }

  clear(): void {
    this.lines = [];
  }
}
