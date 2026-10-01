// Built-in drum patterns. Each character is one 16th-note step.
// '.' = rest; a digit 1-9 = a hit and how essential it is. The Busy knob decides the cut-off:
// at minimum only 9s play, at maximum everything down to 1 does. Higher digits also hit harder.

export const SIGNATURES = [
  { id: '4/4', barSteps: 16, beatSteps: 4 },
  { id: '3/4', barSteps: 12, beatSteps: 4 },
  { id: '6/8', barSteps: 12, beatSteps: 6 },
  { id: '12/8', barSteps: 24, beatSteps: 6 },
  { id: '5/4', barSteps: 20, beatSteps: 4 },
  { id: '5/8', barSteps: 10, beatSteps: 4 },
  { id: '7/8', barSteps: 14, beatSteps: 4 },
  { id: '9/8', barSteps: 18, beatSteps: 4 },
  { id: '11/8', barSteps: 22, beatSteps: 4 },
  { id: '15/8', barSteps: 30, beatSteps: 4 },
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
  {
    name: 'Big Rock', sig: '4/4', swing: 0,
    feel: 'Stadium rock: huge kick, crack snare on 2 & 4',
    tracks: {
      kick:  '9....6..9.......',
      snare: '....9.......9..2',
      chh:   '9.5.9.5.9.5.9.5.',
      ohh:   '...............5',
    },
  },
  {
    name: 'Half-time Grunge', sig: '4/4', swing: 0.1,
    feel: 'Kick stomps, snare only lands on 3 — big and slow',
    tracks: {
      kick:  '9.....4...7...3.',
      snare: '........9.......',
      chh:   '6.3.6.3.6.3.6.3.',
      ohh:   '..............5.',
      tom:   '...............4',
    },
  },
  {
    name: 'Driving Floor Tom', sig: '4/4', swing: 0,
    feel: 'Toms drive the riff, big and relentless',
    tracks: {
      kick:  '9.......9.......',
      tom:   '.6...6...6...6..',
      snare: '....9.......9...',
      chh:   '7.4.7.4.7.4.7.4.',
      ohh:   '...............5',
    },
  },
  {
    name: 'Funk Pocket', sig: '4/4', swing: 0.15,
    feel: 'Syncopated kick, tight closed-hat 16ths',
    tracks: {
      kick:  '9..4...7..4..6..',
      snare: '....9.2.....9.3.',
      chh:   '6464646464646464',
      ohh:   '......4.......4.',
    },
  },
  {
    name: 'Breakbeat', sig: '4/4', swing: 0.2,
    feel: 'Chopped-up Amen-style scramble',
    tracks: {
      kick:  '9...........7.4.',
      snare: '....9...6.9...3.',
      chh:   '7.5.7.5.7.5.7.5.',
      ohh:   '..7.............',
    },
  },
  {
    name: 'Trip-hop', sig: '4/4', swing: 0.3,
    feel: 'Slow, dusty, head-nod boom-bap cousin',
    tracks: {
      kick:  '9...4...6.......',
      snare: '....9...........',
      chh:   '6...6.4.6...6.4.',
      ohh:   '...............3',
      rim:   '............6...',
    },
  },
  {
    name: 'Reggae One Drop', sig: '4/4', swing: 0,
    feel: 'The drop lands on 3, guitar-skank hats',
    tracks: {
      kick:  '........9.......',
      snare: '........9.......',
      chh:   '.6..6...6..6....',
      rim:   '....4.......4...',
    },
  },
  {
    name: 'Shuffle Blues', sig: '4/4', swing: 0.6,
    feel: 'Triplet shuffle, swing it hard',
    tracks: {
      kick:  '9...3.6.9...3.6.',
      snare: '....9.......9...',
      chh:   '6.6.6.6.6.6.6.6.',
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
  {
    name: 'Jazz Waltz', sig: '3/4', swing: 0.4,
    feel: 'Brushy lilt, light ride-like pulse',
    tracks: {
      kick: '9.......4...',
      rim:  '..6...6...6.',
      chh:  '5.3.5.3.5.3.',
    },
  },
  {
    name: 'Grunge Three', sig: '3/4', swing: 0,
    feel: 'Heavy rock ballad, weight on one',
    tracks: {
      kick:  '9......6..3.',
      snare: '....9.......',
      chh:   '6.4.6.4.6.4.',
      tom:   '............',
    },
  },
  {
    name: 'Waltz Build', sig: '3/4', swing: 0,
    feel: 'Three that leans into the next bar',
    tracks: {
      kick: '9...5.......',
      tom:  '....4...4.6.',
      chh:  '6.3.6.3.6.3.',
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
  {
    name: 'Gallop 6/8', sig: '6/8', swing: 0,
    feel: 'Horse-gallop two-feel, built for riffing',
    tracks: {
      kick:  '9..6..9..6..',
      snare: '....9.......',
      chh:   '636363636363',
    },
  },
  {
    name: 'Pirate Jig', sig: '6/8', swing: 0,
    feel: 'Bouncy jig, snap on the back half',
    tracks: {
      kick:  '9......6....',
      snare: '....9.......',
      tom:   '...4......4.',
      chh:   '6.4.6.6.4.6.',
    },
  },
  {
    name: 'Krautrock 6/8', sig: '6/8', swing: 0,
    feel: 'Motorik rolled into three-plus-three',
    tracks: {
      kick: '9...5.9...5.',
      chh:  '636363636363',
      rim:  '...7......7.',
    },
  },

  // ---------- 12/8 ----------
  {
    name: 'Twelve Eight Shuffle', sig: '12/8', swing: 0,
    feel: 'Blues shuffle, triplet swagger',
    tracks: {
      kick:  '9........6..9........6..',
      snare: '..........9...........9.',
      chh:   '636363636363636363636363',
    },
  },
  {
    name: 'Twelve Eight Ballad', sig: '12/8', swing: 0,
    feel: 'Slow 6-feel power ballad, room to breathe',
    tracks: {
      kick:  '9..........59..........5',
      snare: '..........9...........9.',
      chh:   '6.4.4.6.4.4.6.4.4.6.4.4.',
      ohh:   '.......................3',
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
  {
    name: 'Gizz Five', sig: '5/4', swing: 0,
    feel: 'Riff-driven 5/4 stomp, grouped 3 + 2',
    tracks: {
      kick:  '9.......7.......6...',
      snare: '........9.......4...',
      chh:   '6.3.6.3.6.3.6.3.6.3.',
      ohh:   '...................5',
    },
  },
  {
    name: 'Odd Groove', sig: '5/4', swing: 0.1,
    feel: 'Funky five, syncopated 2 + 3',
    tracks: {
      kick:  '9.....6.....7....4..',
      snare: '....9...........9.2.',
      chh:   '64646464646464646464',
    },
  },
  {
    name: 'Five Drive', sig: '5/4', swing: 0,
    feel: 'Motorik energy stretched to five',
    tracks: {
      kick: '9...5...9...5...9...',
      chh:  '63636363636363636363',
      rim:  '......7.......7.....',
    },
  },

  // ---------- 5/8 ----------
  {
    name: 'Five Eight Stomp', sig: '5/8', swing: 0,
    feel: 'Quick limping five, King-Gizz adjacent',
    tracks: {
      kick:  '9...7...6.',
      snare: '..9.....4.',
      chh:   '6363636363',
    },
  },
  {
    name: 'Five Eight Shuffle', sig: '5/8', swing: 0.3,
    feel: 'Swung garage two-step in five',
    tracks: {
      kick:  '9.....6.7.',
      snare: '..9.......',
      chh:   '6464646464',
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
  {
    name: 'Gizz Seven', sig: '7/8', swing: 0,
    feel: 'King-Gizzard-style riff in seven (2 + 2 + 3)',
    tracks: {
      kick:  '9...7...6...4.',
      snare: '..9.......6...',
      chh:   '64646464646464',
    },
  },
  {
    name: 'Seven Swagger', sig: '7/8', swing: 0.3,
    feel: 'Swung seven, garage-psych lurch',
    tracks: {
      kick:  '9.....6...7...',
      snare: '....9.......4.',
      chh:   '63636363636363',
    },
  },

  // ---------- 9/8 ----------
  {
    name: 'Nine Eight Gizz', sig: '9/8', swing: 0,
    feel: 'Rolling 9/8, 2+2+2+3 prog motorik',
    tracks: {
      kick:  '9...7...6...9...4.',
      snare: '..9.......6.....9.',
      chh:   '636363636363636363',
    },
  },
  {
    name: 'Nine Eight Sway', sig: '9/8', swing: 0,
    feel: 'Lilting waltz-of-three-threes (3 + 3 + 3)',
    tracks: {
      kick: '9.....6.....7.....',
      rim:  '..4.....4.....4...',
      chh:  '6.4.4.6.4.4.6.4.4.',
    },
  },

  // ---------- 11/8 ----------
  {
    name: 'Eleven Eight Jam', sig: '11/8', swing: 0,
    feel: 'Long odd cycle, grouped 4 + 4 + 3',
    tracks: {
      kick:  '9.......7.......6.4...',
      snare: '..9.........9.........',
      chh:   '6363636363636363636363',
    },
  },

  // ---------- 15/8 ----------
  {
    name: 'Fifteen Eight Odyssey', sig: '15/8', swing: 0,
    feel: 'A 4/4 bar glued to a 7/8 bar, Gizzard-style long form',
    tracks: {
      kick:  '9.......7.......9...7...6...4.',
      snare: '..9.......9.......9.......6...',
      chh:   '636363636363636363636363636363',
    },
  },
];

export function patternsFor(sig) {
  return PATTERNS.filter((p) => p.sig === sig);
}
