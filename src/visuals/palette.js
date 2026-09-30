// Tokyo Night neon (Omarchy's current theme) + a little Hotline Miami heat.

export const BG = [13, 14, 22]; // #0d0e16, a touch darker than Tokyo Night's #1a1b26

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Pitch colours laid around the circle of fifths, so related chords get neighbouring colours:
// C blue -> G -> D cyan -> A teal -> E green -> B lime -> F# amber -> C# orange -> G# pink
// -> D# hot magenta -> A# violet -> F purple -> back to blue.
const FIFTHS = [
  '#7aa2f7', '#7dcfff', '#0db9d7', '#73daca', '#9ece6a', '#b9f27c',
  '#e0af68', '#ff9e64', '#f7768e', '#ff4fa8', '#bb9af7', '#9d7cd8',
].map(hex);

export function pitchColor(note) {
  const pc = ((note % 12) + 12) % 12;
  return FIFTHS[(pc * 7) % 12];
}

// Fixed colour per physical knob (OP-1 style): the same knob is always the same colour, and the
// thing it controls shows up on screen in that colour.
export const KNOB_COLORS = ['#c0caf5', '#e0af68', '#ff9e64', '#f7768e', '#0db9d7', '#9ece6a', '#7aa2f7', '#bb9af7'];
export const KNOB_RGB = KNOB_COLORS.map(hex);

export const HOT_PINK = hex('#ff4fa8');
export const NEON_CYAN = hex('#0db9d7');
export const WHITE = hex('#c0caf5');
export const RED = hex('#f7768e');
export const GREEN = hex('#9ece6a');
export { hex };
