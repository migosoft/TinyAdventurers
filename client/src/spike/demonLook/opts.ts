// SPIKE (#441): every adaptation of the look can be switched off again: ?<name>=0 in the address, or the panel's tick boxes.
export const OPTS = ['traps', 'muscle', 'spine', 'tail', 'dark', 'ridges', 'slim', 'teeth', 'spread', 'sword', 'pulse', 'gaze', 'life', 'asym', 'embers', 'spikes', 'ash', 'scales', 'chain', 'crest', 'knobs', 'runes', 'whip', 'blades', 'break', 'eyes', 'eyeglow', 'flames', 'fingers'] as const;
export type Opt = (typeof OPTS)[number];
export const on = (o: Opt): boolean => new URLSearchParams(location.search).get(o) !== '0';
