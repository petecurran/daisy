import { NOTE_NAMES } from '../chords.js';
import { analyzeChord, chordColor } from './chordColor.js';
import { pitchColor, HOT_PINK } from './palette.js';

// The chord name at the top of the stage: 70s record-sleeve lettering (Shrikhand) built from the
// same square pixels as the rings, with a "sunset stripes" shadow stacked behind it: cream on top,
// then the chord's colour, mustard, orange, rust. The front gathers when a chord lands and the
// stripes cascade in behind it. Knobs: echo adds stripes, wobble sways the rows, drive makes them
// slip and run hot, the kick swells it, the hats make the front glint.
// In notes mode it's just the note (or the chord, once three or more notes are held).

const FONT = 'Shrikhand';
const CREAM = [246, 231, 200];
const STRIPES = [[224, 175, 104], [255, 158, 100], [200, 85, 61], [120, 52, 38]]; // after the chord colour
const LEAVE_S = 0.6;

// Plain # and b like a chord chart (the font has no ♯ or ♭).
const plain = (s) => s.replace('♭', 'b');
const pcName = (pc) => NOTE_NAMES[((pc % 12) + 12) % 12];
const hash = (a, b = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const clamp = (v) => Math.max(0, Math.min(1, v));
const springy = (t) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(9 * t)); // overshoots, settles

export class ChordLabel {
  constructor(src) {
    this.src = src; // { mode(), ... }
    this.cur = null;
    this.leaving = [];
    this.held = new Set(); // notes mode: what's sounding from the keys
    this.mode = null;
    document.fonts?.load(`40px ${FONT}`).catch(() => {});
  }

  // Chords mode: the chord player says what it's playing (null = all keys up).
  chord(name) {
    if (!name) {
      this.held.clear();
      return this.release();
    }
    if (this.src.mode() !== 'chords') return;
    const [, root, type] = name.match(/^([A-G][#b]?)(.*)$/);
    this.set(name, root, plain(type), chordColor({ root: NOTE_NAMES.indexOf(root), type }));
  }

  note(note, on) {
    if (this.src.mode() !== 'notes') return;
    if (!on) {
      this.held.delete(note);
      if (!this.held.size) this.release();
      return;
    }
    this.held.add(note);
    const held = [...this.held];
    if (new Set(held.map((n) => n % 12)).size >= 3) {
      const c = analyzeChord(held);
      return this.set(c.name, pcName(c.root), c.type === 'note' ? '' : plain(c.type), chordColor(c));
    }
    this.set(`n${note}`, pcName(note), '', pitchColor(note), true);
  }

  set(id, root, sup, color, again = false) {
    const now = performance.now() / 1000;
    if (this.cur?.id === id && this.cur.releasedAt == null && !again) return;
    if (this.cur) {
      this.cur.leftAt = now;
      this.leaving.push(this.cur);
    }
    this.cur = { id, root, sup, color, at: now, releasedAt: null };
  }

  release() {
    if (this.cur && this.cur.releasedAt == null) this.cur.releasedAt = performance.now() / 1000;
  }

  // Rasterise the name onto the pixel grid once per chord. The chord type is smaller, so it gets
  // finer pixels to stay readable.
  pixelate(card, cell, d) {
    card.cell = cell;
    card.fontReady = document.fonts?.check(`40px ${FONT}`) ?? true;
    const root = this.raster(card.root, 116 * d, cell, 0, 0);
    const sup = card.sup ? this.raster(card.sup, 66 * d, Math.max(2, Math.round(cell * 0.6)), root.w + 4 * d, 10 * d) : { w: 0, px: [] };
    const half = (root.w + sup.w + 4 * d) / 2;
    card.pixels = [...root.px, ...sup.px.map((p) => ({ ...p, small: true }))].map((p) => ({ ...p, x: p.x - half }));
  }

  raster(text, px, cell, ox, oy) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d', { willReadFrequently: true });
    const font = `${px}px ${FONT}, Inter, sans-serif`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width);
    c.width = Math.ceil(w + px * 0.3); // Shrikhand leans right, past its advance width
    c.height = Math.ceil(px * 1.35);
    g.font = font;
    g.textBaseline = 'top';
    g.fillStyle = '#fff';
    g.fillText(text, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const at = (x, y) => data[(Math.min(c.height - 1, y | 0) * c.width + Math.min(c.width - 1, x | 0)) * 4 + 3];
    const out = [];
    for (let y = 0; y < c.height; y += cell) {
      for (let x = 0; x < c.width; x += cell) {
        const cover = at(x + cell * 0.3, y + cell * 0.3) + at(x + cell * 0.7, y + cell * 0.3) + at(x + cell * 0.3, y + cell * 0.7) + at(x + cell * 0.7, y + cell * 0.7);
        if (cover > 2 * 255) out.push({ x: ox + x, y: oy + y, row: Math.round((oy + y) / cell), r: hash(ox + x, oy + y), cell, size: cell * 0.82 });
      }
    }
    return { w, px: out };
  }

  draw(g, W, top, d, fx) {
    const mode = this.src.mode();
    if (mode !== this.mode) { // fresh slate when switching chords <-> notes
      this.mode = mode;
      this.cur = null;
      this.leaving = [];
      this.held.clear();
    }
    const now = performance.now() / 1000;
    this.leaving = this.leaving.filter((c) => now - c.leftAt < LEAVE_S);
    for (const card of [...this.leaving, this.cur]) if (card) this.paint(g, card, W, top, d, fx, now);
    g.globalAlpha = 1;
  }

  paint(g, card, W, top, d, fx, now) {
    const cell = Math.max(3, Math.round(5 * d));
    if (card.cell !== cell || (!card.fontReady && document.fonts?.check(`40px ${FONT}`))) this.pixelate(card, cell, d);
    const t = now - card.at;
    const leave = card.leftAt != null ? clamp((now - card.leftAt) / LEAVE_S) : 0;
    const alpha = (card.releasedAt == null ? 1 : Math.max(0.35, 1 - (now - card.releasedAt) * 0.25)) * (1 - leave);
    const hot = Math.max(0, fx.heat - 0.2) * 0.7; // drive pulls everything towards hot pink
    const swell = 1 + fx.pulse * 0.035; // the kick pushes it out a touch
    const slipClock = Math.floor(now * 12);

    const place = (p, arrive) => {
      const spread = (1 - arrive) ** 2 + leave * leave;
      let x = p.x * swell + (hash(p.r, 1) - 0.5) * 90 * d * spread;
      let y = p.y * swell + (hash(p.r, 2) - 0.5) * 50 * d * spread - leave * 24 * d;
      x += Math.sin(now * 2.1 + p.row * 0.45) * fx.wobble * 7 * d;
      if (fx.heat > 0.2 && hash(p.row, slipClock) < (fx.heat - 0.2) * 0.35) x += (hash(p.row, slipClock + 7) - 0.5) * fx.heat * 46 * d;
      return [W / 2 + x, top + y];
    };

    // Back to front: the stripes (echo adds more), then the cream face.
    const colours = [card.color, ...STRIPES].slice(0, 2 + Math.round(fx.echo * 3));
    for (let k = colours.length; k >= 0; k--) {
      const face = k === 0;
      const col = mix(face ? CREAM : colours[k - 1], HOT_PINK, hot);
      const delay = k * 0.045; // the stripes cascade in after the face
      const pop = springy(clamp((t - delay) / 0.35));
      const bright = rgb(mix(col, [255, 255, 255], 0.7));
      g.fillStyle = rgb(col);
      for (const p of card.pixels) {
        if (p.small && k > 1) continue; // the small chord type keeps just one stripe, to stay readable
        const arrive = clamp((t - delay - p.r * 0.12) / 0.2);
        if (arrive <= 0) continue;
        const [x, y] = place(p, arrive);
        const glint = face && hash(p.r, Math.floor(now * 18)) < fx.shimmer * 0.12;
        g.globalAlpha = alpha * arrive;
        if (glint) g.fillStyle = bright;
        const off = k * p.cell * pop; // whole pixels apart, so the grid stays crisp
        g.fillRect(x + off, y + off, p.size, p.size);
        if (glint) g.fillStyle = rgb(col);
      }
    }
  }
}
