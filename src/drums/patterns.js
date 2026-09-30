// Built-in drum patterns. Each character is one 16th-note step.
// '.' = rest; a digit 1-9 = a hit and how essential it is. The Busy knob decides the cut-off:
// at minimum only 9s play, at maximum everything down to 1 does. Higher digits also hit harder.

export const SIGNATURES = [
  { id: '4/4', barSteps: 16, beatSteps: 4 },
  { id: '3/4', barSteps: 12, beatSteps: 4 },
  { id: '6/8', barSteps: 12, beatSteps: 6 },
  { id: '5/4', barSteps: 20, beatSteps: 4 },
  { id: '7/8', barSteps: 14, beatSteps: 4 },
];

export const PATTERNS = [
  // ---------- 4/4 ----------
  {
    name: 'Motorik', sig: '4/4', swing: 0,
    feel: 'Krautrock highway: steady, hypnotic, forward',
    tracks: {
      kick:  '9..3....9.7..4..',
      snare: '....9..2....9.3.',
      chh:   '6363636363636363',
      ohh:   '..............5.',
    },
  },
  {
    name: 'Boom Bap', sig: '4/4', swing: 0.55,
    feel: 'Lazy head-nod hip-hop',
    tracks: {
      kick:  '9.....7.8....4..',
      snare: '....9..3....9..2',
      chh:   '6.636.6.6.636.6.',
      ohh:   '..............4.',
      rim:   '..........3.....',
    },
  },
  {
    name: 'Bossa', sig: '4/4', swing: 0,
    feel: 'Gentle Brazilian sway',
    tracks: {
      kick:   '8..68..68..68..6',
      rim:    '7..7..7...7..7..',
      shaker: '5353535353535353',
      tom:    '.........3.....3',
    },
  },
  {
    name: 'Glitter Floor', sig: '4/4', swing: 0,
    feel: 'Four-on-the-floor disco',
    tracks: {
      kick:   '9...9...9...9...',
      clap:   '....8.......8...',
      ohh:    '..7...7...7...7.',
      chh:    '4..34..34..34..3',
      shaker: '.2.2.2.2.2.2.2.2',
    },
  },
  {
    name: 'Half-time Dream', sig: '4/4', swing: 0.35,
    feel: 'Slow, spacious, lo-fi',
    tracks: {
      kick:   '9.........6...3.',
      snare:  '........9.......',
      chh:    '6.3.6.3.6.3.6.3.',
      shaker: '..4...4...4...4.',
      rim:    '...........2....',
    },
  },

  // ---------- 3/4 ----------
  {
    name: 'Waltz', sig: '3/4', swing: 0,
    feel: 'ONE two three',
    tracks: {
      kick: '9.......3...',
      rim:  '....7...7...',
      chh:  '5.2.5.2.5.2.',
    },
  },
  {
    name: 'Campfire', sig: '3/4', swing: 0.25,
    feel: 'Folky strum-along in three',
    tracks: {
      kick:   '9.....6...3.',
      snare:  '....8.......',
      chh:    '6.3.6.3.6.3.',
      tom:    '..........4.',
      shaker: '.2.2.2.2.2.2',
    },
  },

  // ---------- 6/8 ----------
  {
    name: 'Ballad 6/8', sig: '6/8', swing: 0,
    feel: 'Rolling slow-dance',
    tracks: {
      kick:  '9.....5.....',
      snare: '......9.....',
      chh:   '6.4.4.6.4.4.',
      ohh:   '..........3.',
    },
  },
  {
    name: 'Afro 6/8', sig: '6/8', swing: 0,
    feel: 'West African bell groove',
    tracks: {
      bell:   '8...6...7.7...6...7...6.',
      kick:   '9.....5.....8.....5.....',
      shaker: '5.3.3.5.3.3.5.3.3.5.3.3.',
      tom:    '.........4...........4..',
      rim:    '......6...........6.....',
    },
  },

  // ---------- 5/4 ----------
  {
    name: 'Five Easy', sig: '5/4', swing: 0.45,
    feel: 'Cool-jazz in five (3 + 2)',
    tracks: {
      kick:  '9.....4.....7.......',
      rim:   '........8.......8...',
      chh:   '6.3.6.3.6.3.6.3.6.3.',
      ohh:   '..................4.',
    },
  },

  // ---------- 7/8 ----------
  {
    name: 'Seven Step', sig: '7/8', swing: 0,
    feel: 'Limping, lopsided, catchy (2 + 2 + 3)',
    tracks: {
      kick:  '9.......7.....',
      snare: '....9.......6.',
      chh:   '6.4.6.4.6.4.4.',
    },
  },
];

export function patternsFor(sig) {
  return PATTERNS.filter((p) => p.sig === sig);
}
