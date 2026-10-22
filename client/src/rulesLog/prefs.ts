export interface LogPrefs {
  on: boolean;
  details: boolean;
}

const KEY = 'ta.rulesLog';
const DEFAULTS: LogPrefs = { on: false, details: true };

/** The saved prefs; a throwing or missing store, or bad JSON, gives the defaults. */
export function loadPrefs(store: Pick<Storage, 'getItem'> | null): LogPrefs {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<LogPrefs> | null;
    if (!p || typeof p !== 'object') return { ...DEFAULTS };
    return {
      on: typeof p.on === 'boolean' ? p.on : DEFAULTS.on,
      details: typeof p.details === 'boolean' ? p.details : DEFAULTS.details,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(store: Pick<Storage, 'setItem'> | null, p: LogPrefs): void {
  try {
    store?.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private window or blocked site data: the prefs last for the session only.
  }
}
