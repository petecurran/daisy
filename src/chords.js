// Orchid-style chord engine: one key picks the root, the joystick picks the chord colour.

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// Joystick zones, laid out as the 3x3 grid shown on screen.
export const ZONES = [
  ['UL', 'U', 'UR'],
  ['L', 'C', 'R'],
  ['DL', 'D', 'DR'],
];
export const ZONE_LABELS = {
  C: 'as in key', U: '+7th', D: 'sus4', L: 'flip maj/min', R: 'add9',
  UL: 'flip +7th', UR: '9th', DL: 'sus2', DR: '6th',
};

// A chord is { third: 3|4|2|5, fifth: 6|7, seventh: null|10|11|9, ninth: bool }, all in
// semitones above the root (seventh 9 = a 6th).
function diatonicChord(rootPc, key) {
  const scale = SCALES[key.mode];
  const rel = (rootPc - key.tonic + 12) % 12;
  const d = scale.indexOf(rel);
  if (d < 0) return { third: 4, fifth: 7, seventh: 10, ninth: false, outside: true }; // borrowed: dominant flavour
  const step = (n) => {
    const i = d + n;
    return (scale[i % 7] + 12 * Math.floor(i / 7) - scale[d] + 12) % 12;
  };
  return { third: step(2), fifth: step(4), seventh: step(6), ninth: false };
}

export function buildChord(rootPc, key, zone) {
  const dia = diatonicChord(rootPc, key);
  const c = { third: dia.third, fifth: dia.fifth, seventh: null, ninth: false };
  const flip = () => {
    c.third = c.third === 4 ? 3 : 4;
    c.fifth = 7;
  };
  switch (zone) {
    case 'U': c.seventh = dia.seventh; break;
    case 'D': c.third = 5; c.fifth = 7; break;
    case 'L': flip(); break;
    case 'R': c.ninth = true; break;
    case 'UL': flip(); c.seventh = 10; break;
    case 'UR': c.seventh = dia.seventh; c.ninth = true; if (c.fifth === 6) c.fifth = 7; break;
    case 'DL': c.third = 2; c.fifth = 7; break;
    case 'DR': c.seventh = 9; c.fifth = 7; break;
  }
  return c;
}

export function chordName(rootPc, c) {
  const r = NOTE_NAMES[rootPc];
  const { third, fifth, seventh, ninth } = c;
  if (third === 5) return r + (seventh === 10 ? '7sus4' : 'sus4');
  if (third === 2) return r + 'sus2';
  const minor = third === 3;
  if (minor && fifth === 6) return r + (seventh === 10 ? 'm7♭5' : ninth ? 'dim(add9)' : 'dim');
  const m = minor ? 'm' : '';
  if (seventh === 9) return r + m + '6';
  if (seventh === 10) return r + m + (ninth ? '9' : '7');
  if (seventh === 11) return r + (minor ? 'm(maj7)' : ninth ? 'maj9' : 'maj7');
  return r + m + (ninth ? (minor ? '(add9)' : 'add9') : '');
}

function intervals(c) {
  const iv = [0, c.third, c.fifth];
  if (c.seventh != null) iv.push(c.seventh);
  if (c.ninth) iv.push(14);
  return iv;
}

// Pick an inversion of the upper chord that sits near `center` and moves smoothly from `prev`.
function voiceUpper(rootPc, c, center, prev) {
  const pcs = intervals(c).map((i) => (rootPc + i) % 12);
  let best = null;
  for (let rot = 0; rot < pcs.length; rot++) {
    const order = [...pcs.slice(rot), ...pcs.slice(0, rot)];
    for (let base = center - 18; base <= center + 6; base++) {
      if ((base % 12 + 12) % 12 !== order[0]) continue;
      const notes = [base];
      for (const pc of order.slice(1)) {
        let n = notes[notes.length - 1] + 1;
        while ((n % 12 + 12) % 12 !== pc) n++;
        notes.push(n);
      }
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let cost = Math.abs(mean - center);
      if (prev?.length) {
        const move = notes.reduce((s, n) => s + Math.min(...prev.map((p) => Math.abs(p - n))), 0);
        cost += (move / notes.length) * 0.8;
      }
      if (!best || cost < best.cost) best = { notes, cost };
    }
  }
  return best.notes;
}

// Turns key presses + joystick zone into sounding notes on the engine, sharing notes between
// chords (ref-counted) so changing chord colour only re-strikes the notes that actually change.
export class ChordPlayer {
  constructor(engine, onChange) {
    this.engine = engine;
    this.onChange = onChange;
    this.key = { tonic: 0, mode: 'major' };
    this.zone = 'C';
    this.voicing = 0; // semitones up/down from the default register
    this.bass = true;
    this.strumMs = 18;
    this.held = new Map(); // physical key -> { notes, velocity }
    this.refs = new Map(); // midi note -> count
    this.lastUpper = null;
    this.lastCenter = null;
  }

  // The register follows the octave of the key that was pressed (middle C = 60 up to B sits around
  // 64, the octave below an octave lower, ...), so low, middle and high C give low, middle and
  // high C chords, while chords within an octave still voice-lead into each other.
  chordFor(key) {
    const rootPc = key % 12;
    const c = buildChord(rootPc, this.key, this.zone);
    const center = 64 + this.voicing + 12 * Math.floor((key - 60) / 12);
    // Voice-lead from the last chord, moved by whole octaves with the register so a jump to
    // another octave isn't pulled back towards where the last chord was.
    let prev = this.lastUpper;
    if (prev && this.lastCenter != null) {
      const shift = 12 * Math.round((center - this.lastCenter) / 12);
      prev = prev.map((n) => n + shift);
    }
    const upper = voiceUpper(rootPc, c, center, prev);
    this.lastUpper = upper;
    this.lastCenter = center;
    const notes = [...upper];
    if (this.bass) {
      let b = key - 12; // root an octave below the key
      while (b >= upper[0] && b - 12 >= 28) b -= 12; // keep it under the chord
      while (b < 28) b += 12;
      notes.unshift(b);
    }
    return { notes, name: chordName(rootPc, c) };
  }

  press(key, velocity) {
    if (this.held.has(key)) this.release(key);
    const { notes, name } = this.chordFor(key);
    this.held.set(key, { notes, velocity, name });
    notes.forEach((n, i) => this.on(n, velocity, i * this.strumMs));
    this.onChange?.(name);
  }

  release(key) {
    const h = this.held.get(key);
    if (!h) return;
    this.held.delete(key);
    h.notes.forEach((n) => this.off(n));
    if (!this.held.size) this.onChange?.(null);
  }

  setZone(zone) {
    if (zone === this.zone) return;
    this.zone = zone;
    // Re-voice every held chord; only notes that differ get struck/released.
    let name = null;
    for (const [key, h] of this.held) {
      const next = this.chordFor(key);
      const added = next.notes.filter((n) => !h.notes.includes(n));
      const removed = h.notes.filter((n) => !next.notes.includes(n));
      added.forEach((n, i) => this.on(n, h.velocity * 0.85, i * 8));
      removed.forEach((n) => this.off(n));
      h.notes = next.notes;
      name = next.name;
    }
    this.onChange?.(name, zone);
  }

  on(note, velocity, delayMs) {
    const count = this.refs.get(note) || 0;
    this.refs.set(note, count + 1);
    if (count > 0) return;
    if (delayMs > 0) {
      setTimeout(() => {
        if (this.refs.get(note)) this.engine.noteOn(note, velocity);
      }, delayMs);
    } else {
      this.engine.noteOn(note, velocity);
    }
  }

  off(note) {
    const count = (this.refs.get(note) || 0) - 1;
    if (count > 0) return this.refs.set(note, count);
    this.refs.delete(note);
    this.engine.noteOff(note);
  }

  allOff() {
    for (const key of [...this.held.keys()]) this.release(key);
  }
}

// Joystick position -> zone, with a little hysteresis so it doesn't flicker at the edges.
export function zoneFromXY(x, y, prevZone) {
  const t = (v, prevDir) => {
    const enter = 0.45, stay = 0.3;
    if (prevDir !== 0 && Math.sign(v) === prevDir && Math.abs(v) > stay) return prevDir;
    return Math.abs(v) > enter ? Math.sign(v) : 0;
  };
  const prev = findZone(prevZone);
  const col = t(x, prev.col - 1) + 1;
  const row = 1 - t(y, 1 - prev.row);
  return ZONES[row][col];
}

function findZone(z) {
  for (let row = 0; row < 3; row++) {
    const col = ZONES[row].indexOf(z);
    if (col >= 0) return { row, col };
  }
  return { row: 1, col: 1 };
}
