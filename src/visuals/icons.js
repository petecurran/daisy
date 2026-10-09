// Line icons (24x24, stroked). Kept simple so they read at a glance from a distance.
export const ICON = {
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  fill: 'M4 19v-3M8.5 19v-6M13 19v-9M17.5 19V6',
  prev: 'M11 6l-6 6 6 6M19 6l-6 6 6 6',
  next: 'M13 6l6 6-6 6M5 6l6 6-6 6',
  sliders: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4',
  metronome: 'M8.5 20.5h7L13 4h-2zM12 14.5l5-8',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  loop: 'M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4',
  layers: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5',
  note: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  hash: 'M5 9h14M5 15h14M10 3.5 8 20.5M16 3.5l-2 17',
  pin: 'M12 16.5v5M8.5 3h7l-1 6.5 3 3H6.5l3-3z',
  record: 'M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  voicing: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  sun: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  peak: 'M2.5 18h5c3 0 3-12 4.5-12s1.5 12 4.5 12h5',
  flame: 'M12 21.5c3.6 0 6.5-2.7 6.5-6.3 0-4.6-4.3-6.3-4.3-11.2-2.7 1.8-3.8 4.5-3.8 7.2-.9-.9-1.8-1.8-1.8-3.6-1.8 1.8-3.1 4.5-3.1 7.6 0 3.6 2.9 6.3 6.5 6.3z',
  waves: 'M2.5 9c2.5-3.3 4.5-3.3 7 0s4.5 3.3 7 0 3.5-2 5-2M2.5 15.5c2.5-3.3 4.5-3.3 7 0s4.5 3.3 7 0 3.5-2 5-2',
  cassette: 'M3 5.5h18v13H3zM6 13a2 2 0 1 0 4 0 2 2 0 1 0-4 0M14 13a2 2 0 1 0 4 0 2 2 0 1 0-4 0M10 13h4M7 18.5l1.5-2.5h7l1.5 2.5',
  echo: 'M5 12h.01M9 8.5a5 5 0 0 1 0 7M13 5.5a9 9 0 0 1 0 13M17 3a12.5 12.5 0 0 1 0 18',
  cloud: 'M7 18.5h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.3A3.5 3.5 0 0 0 7 18.5z',
  grid: 'M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01',
  swing: 'M3 16.5c3 0 4-9 9-9s6 9 9 9',
  drum: 'M4 9c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9M7 3l3.5 5M17 3l-3.5 5',
  room: 'M3.5 20.5v-11l8.5-6 8.5 6v11zM9.5 20.5v-6h5v6',
  heart: 'M12 20s-8-4.9-8-11a4.2 4.2 0 0 1 8-1.8A4.2 4.2 0 0 1 20 9c0 6.1-8 11-8 11z',
  bars: 'M4.5 20v-4M9.5 20v-9M14.5 20v-12M19.5 20V4',
};

export function svg(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name]}"/></svg>`;
}

export const KNOB_ICONS = {
  sound: ['voicing', 'sun', 'peak', 'flame', 'waves', 'cassette', 'echo', 'cloud'],
  drums: ['metronome', 'grid', 'swing', 'drum', 'sun', 'heart', 'loop', 'bars'],
};
export const KNOB_LABELS = {
  sound: ['Voicing', 'Bright', 'Reso', 'Drive', 'Chorus', 'Wobble', 'Echo', 'Reverb'],
  drums: ['Tempo', 'Busy', 'Swing', 'Kit', 'Tone', 'Pump', 'Loop', 'Drums'],
};
