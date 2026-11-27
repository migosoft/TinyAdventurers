// SPIKE (#441): every adaptation of the look can be switched off again: ?<name>=0 in the address, or the panel's tick boxes.
export const OPTS = ['traps', 'muscle', 'spine', 'tail', 'dark', 'ridges', 'slim', 'teeth', 'spread', 'sword', 'pulse', 'gaze', 'life', 'asym', 'embers', 'spikes', 'ash', 'scales', 'chain', 'crest', 'knobs', 'runes', 'whip', 'blades', 'break', 'eyes', 'eyeglow', 'flames', 'fingers', 'clear', 'fire', 'calmweb', 'iceblocks', 'brokenhorn'] as const;
export type Opt = (typeof OPTS)[number];
/** The ice demon (`?kind=ice`): the same figure, cold. */
export const ICE = new URLSearchParams(location.search).get('kind') === 'ice';
/** Switches that are off unless the address says `=1` (looks the user decided against, kept so they can come back). */
export const OFF: Opt[] = ['brokenhorn'];
export const on = (o: Opt): boolean => { const v = new URLSearchParams(location.search).get(o); return v === null ? !OFF.includes(o) : v !== '0'; };
