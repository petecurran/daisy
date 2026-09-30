// Chord -> colour, after Scriabin's clavier à lumières: hue follows the chord's root around the
// circle of fifths (so chords in the same key are neighbours), and the chord *type* shifts it in a
// consistent way, so a minor 7th always looks like a minor 7th.

import { NOTE_NAMES } from '../chords.js';
import { pitchColor } from './palette.js';

// Chord templates: semitones above the root. Order matters only for ties (earlier = simpler).
const TEMPLATES = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
  ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['m7♭5', [0, 3, 6, 10]],
  ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]], ['7sus4', [0, 5, 7, 10]],
  ['add9', [0, 2, 4, 7]], ['m(add9)', [0, 2, 3, 7]], ['9', [0, 2, 4, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['m9', [0, 2, 3, 7, 10]],
];

// Name + root + type from whatever notes are sounding (works for loop playback too).
export function analyzeChord(notes) {
  if (!notes.length) return null;
  const bass = Math.min(...notes) % 12;
  const pcs = [...new Set(notes.map((n) => n % 12))];
  if (pcs.length === 1) return { root: pcs[0], type: 'note', name: NOTE_NAMES[pcs[0]] };
  let best = null;
  for (const root of pcs) {
    const rel = new Set(pcs.map((p) => (p - root + 12) % 12));
    TEMPLATES.forEach(([type, iv], order) => {
      const hit = iv.filter((i) => rel.has(i)).length;
      const extra = rel.size - hit;
      const missing = iv.length - hit;
      const score = hit * 2 - extra * 3 - missing * 2 + (root === bass ? 1.5 : 0) - order * 0.01;
      if (!best || score > best.score) best = { root, type, score };
    });
  }
  return { root: best.root, type: best.type, name: NOTE_NAMES[best.root] + best.type };
}

// ---- colour maths ----
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// How each chord type colours the root: tinted towards a fixed "character" colour, so the same
// chord type reads the same whatever the root. [tint, amount, lightness x, saturation x]
const HOT = [255, 60, 150], COOL = [70, 60, 200], DREAM = [120, 230, 255], WHITE = [255, 255, 255], MUD = [60, 50, 40];
const CHARACTER = {
  note: [WHITE, 0, 1, 1],
  '': [WHITE, 0, 1, 1.1], // major: the pure colour
  m: [COOL, 0.3, 0.8, 1], // minor: cooler, deeper
  dim: [MUD, 0.45, 0.6, 0.7], // diminished: dark and murky
  sus4: [WHITE, 0.35, 1.05, 0.8], // suspended: pastel, unresolved
  sus2: [WHITE, 0.4, 1.05, 0.8],
  '7': [HOT, 0.38, 1, 1.2], // dominant 7th: hot, wants to move
  maj7: [DREAM, 0.35, 1.1, 0.9], // major 7th: dreamy
  m7: [COOL, 0.22, 0.85, 1],
  'm7♭5': [MUD, 0.4, 0.62, 0.7],
  '6': [WHITE, 0.2, 1.05, 0.9],
  m6: [COOL, 0.25, 0.85, 0.9],
  '7sus4': [HOT, 0.25, 1.05, 0.85],
  add9: [DREAM, 0.15, 1.08, 1],
  'm(add9)': [COOL, 0.25, 0.88, 1],
  '9': [HOT, 0.3, 1.05, 1.15],
  maj9: [DREAM, 0.4, 1.12, 0.95],
  m9: [COOL, 0.2, 0.92, 1],
};

// Extra sparkle for "colourful" chords (used by the pixel shimmer).
export const SHIMMER = { add9: 0.6, '9': 0.8, maj9: 0.8, m9: 0.7, 'm(add9)': 0.6, maj7: 0.4, '6': 0.3 };

export function chordColor(chord) {
  const [tint, amt, lx, sx] = CHARACTER[chord.type] ?? CHARACTER[''];
  const base = pitchColor(chord.root).map((v, i) => v + (tint[i] - v) * amt);
  const [h, s, l] = rgbToHsl(base);
  return hslToRgb([h, Math.min(1, s * sx), Math.min(0.82, l * lx)]);
}
