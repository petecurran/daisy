import { KNOB_COLORS, pitchColor } from './palette.js';

// 7x7 pixel icons, Omarchy block-art style. '#' = lit.
const I = (rows) => rows.map((r) => [...r].map((c) => c === '#'));
export const ICONS = {
  play: I(['#......', '##.....', '###....', '####...', '###....', '##.....', '#......']),
  stop: I(['.......', '.#####.', '.#####.', '.#####.', '.#####.', '.#####.', '.......']),
  fill: I(['......#', '.....##', '....###', '...####', '..#####', '.######', '#######']),
  prev: I(['.....#.', '....##.', '...###.', '..####.', '...###.', '....##.', '.....#.']),
  next: I(['.#.....', '.##....', '.###...', '.####..', '.###...', '.##....', '.#.....']),
  page: I(['#####..', '#...#..', '#.#####', '#.#...#', '###...#', '..#...#', '..#####']),
  metronome: I(['...#...', '..#.#..', '..#.#..', '.#..##.', '.#.#.#.', '#.....#', '#######']),
  pause: I(['.......', '.##.##.', '.##.##.', '.##.##.', '.##.##.', '.##.##.', '.......']),
  loop: I(['..###..', '.#...#.', '#.....#', '#.....#', '#...#.#', '.#..##.', '..#####']),
  voicing: I(['...#...', '..###..', '.#.#.#.', '...#...', '.#.#.#.', '..###..', '...#...']),
  sun: I(['#..#..#', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '#..#..#']),
  peak: I(['.......', '...#...', '...#...', '..#.#..', '..#.#..', '##...##', '.......']),
  flame: I(['...#...', '..##...', '..###..', '.#####.', '####.##', '###.###', '.#####.']),
  chorus: I(['.......', '.##..##', '#..##..', '.......', '.##..##', '#..##..', '.......']),
  cassette: I(['#######', '#.....#', '#.#.#.#', '#.....#', '#.###.#', '#######', '.......']),
  echo: I(['#......', '##.#...', '##.##.#', '##.##.#', '##.##.#', '##.#...', '#......']),
  cloud: I(['.......', '..##...', '.####..', '.######', '#######', '#######', '.......']),
  dots: I(['#.#.#.#', '.......', '#.#.#.#', '.......', '#.#.#.#', '.......', '#.#.#.#']),
  swing: I(['.......', '.......', '.##...#', '#..#..#', '#...##.', '.......', '.......']),
  drum: I(['.#####.', '#.....#', '#######', '#.....#', '#.....#', '.#####.', '.......']),
  room: I(['#######', '#.....#', '#.###.#', '#.#.#.#', '#.###.#', '#.....#', '#######']),
  heart: I(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...', '.......']),
  bars: I(['.......', '.....#.', '...#.#.', '.#.#.#.', '.#.#.#.', '##.#.#.', '#######']),
};

export const KNOB_ICONS = {
  sound: [ICONS.voicing, ICONS.sun, ICONS.peak, ICONS.flame, ICONS.chorus, ICONS.cassette, ICONS.echo, ICONS.cloud],
  drums: [ICONS.metronome, ICONS.dots, ICONS.swing, ICONS.drum, ICONS.sun, ICONS.room, ICONS.heart, ICONS.bars],
};

export function drawIcon(g, icon, x, y, scale, color) {
  g.fillStyle = color;
  icon.forEach((row, j) => row.forEach((on, i) => on && g.fillRect(x + i * scale, y + j * scale, scale, scale)));
}

export const KNOB_LABELS = {
  sound: ['VOICING', 'BRIGHT', 'RESO', 'DRIVE', 'CHORUS', 'WOBBLE', 'ECHO', 'REVERB'],
  drums: ['TEMPO', 'BUSY', 'SWING', 'KIT', 'TONE', 'ROOM', 'PUMP', 'LEVEL'],
};
const PAD_LABELS = ['PLAY', 'FILL', '◀ PATT', 'PATT ▶', 'PAGE', 'TAP', 'BREAK', 'LOOP'];

// Drawn in design units, scaled to the screen at full resolution.
const OW = 244, OH = 100;
const LINE = '#3b4261';
const DIM = '#565f89';
const TEXT = '#a9b1d6';
const FONT = (u, w = 700) => `${w} ${u}px ui-monospace, "JetBrainsMono Nerd Font", monospace`;

// The MPK Mini, drawn as a neon outline: joystick, pads, knobs, 25 keys, each labelled. It lights up
// with what you touch and dims a little when you're just playing.
export class Controller {
  constructor(canvas, src) {
    this.canvas = canvas;
    this.src = src;
    this.g = canvas.getContext('2d');
    this.held = new Map();
    this.pads = new Map();
    this.lastTouch = 0;
  }

  resize() {
    const cssW = Math.min(980, innerWidth * 0.6);
    this.unit = cssW / OW;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(OH * this.unit * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${OH * this.unit}px`;
    this.scale = this.unit * dpr;
  }

  heightPx() { return OH * this.unit; }

  touch() { this.lastTouch = performance.now(); }
  noteOn(note, loop) { if (!loop) { this.held.set(note, true); this.touch(); } }
  noteOff(note, loop) { if (!loop) this.held.delete(note); }
  pad({ index, down }) { if (down) this.pads.set(index, performance.now()); this.touch(); }

  draw() {
    const g = this.g;
    const t = performance.now();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const idle = (t - this.lastTouch) / 1000;
    this.canvas.style.opacity = String(Math.max(0.55, Math.min(1, 1.6 - idle * 0.3)));

    g.fillStyle = 'rgba(13, 14, 22, 0.85)';
    g.strokeStyle = LINE;
    g.lineWidth = 0.6;
    roundRect(g, 0.5, 0.5, OW - 1, OH - 1, 4);
    g.fill();
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    this.drawJoystick(g);
    this.drawPads(g, t);
    this.drawKnobs(g);
    this.drawKeys(g);
  }

  drawJoystick(g) {
    const { joy, chords } = this.src;
    const cx = 20, cy = 24;
    g.strokeStyle = LINE;
    g.lineWidth = 0.6;
    g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.stroke();
    // Faint 3x3 guide: the chord-colour zones.
    g.strokeStyle = '#24283b';
    g.beginPath(); g.moveTo(cx - 13, cy - 4.3); g.lineTo(cx + 13, cy - 4.3); g.moveTo(cx - 13, cy + 4.3); g.lineTo(cx + 13, cy + 4.3);
    g.moveTo(cx - 4.3, cy - 13); g.lineTo(cx - 4.3, cy + 13); g.moveTo(cx + 4.3, cy - 13); g.lineTo(cx + 4.3, cy + 13); g.stroke();
    const x = joy?.x ?? 0, y = joy ? joy.up - joy.down : 0;
    const zone = joy?.zone ?? 'C';
    const root = chords?.held.size ? [...chords.held.keys()].pop() : null;
    const col = zone !== 'C' ? (root != null ? `rgb(${pitchColor(root)})` : '#ff4fa8') : DIM;
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = zone !== 'C' ? 6 : 0;
    g.beginPath(); g.arc(cx + x * 9, cy - y * 9, 3, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.font = FONT(4.2);
    g.fillStyle = zone !== 'C' ? col : DIM;
    g.fillText(zone === 'C' ? 'CHORD' : ZONE_SHORT[zone], cx, cy + 18);
  }

  drawPads(g, t) {
    const { seq, looper } = this.src;
    const icons = [
      seq?.playing && !seq.drumsMuted ? ICONS.stop : ICONS.play, ICONS.fill, ICONS.prev, ICONS.next,
      ICONS.page, ICONS.metronome, ICONS.pause, ICONS.loop,
    ];
    const x0 = 42, y0 = 4, pw = 24, ph = 21, gap = 2.5;
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = i < 4 ? 1 : 0; // pads 5-8 on top, 1-4 below, like the hardware
      const x = x0 + col * (pw + gap), y = y0 + row * (ph + gap);
      const hit = (t - (this.pads.get(i) ?? -1e9)) / 1000 < 0.25;
      let color = DIM;
      if (i === 0 && seq?.playing && !seq.drumsMuted) color = '#9ece6a';
      if (i === 7 && looper) {
        color = { armed: '#e0af68', recording: '#f7768e', overdub: '#f7768e', playing: '#9ece6a', stopped: DIM, empty: DIM }[looper.state];
      }
      if (i === 6 && seq?.breakHeld) color = '#ff4fa8';
      if (i === 4) color = this.src.page() === 'drums' ? '#e0af68' : '#c0caf5';
      g.lineWidth = 0.6;
      if (hit) { g.fillStyle = '#ff4fa8'; roundRect(g, x, y, pw, ph, 2); g.fill(); color = '#0d0e16'; }
      g.strokeStyle = hit ? '#ff4fa8' : LINE;
      roundRect(g, x, y, pw, ph, 2);
      g.stroke();
      drawIcon(g, icons[i], x + pw / 2 - 4.2, y + 3, 1.2, color);
      g.font = FONT(3.6);
      g.fillStyle = hit ? '#0d0e16' : color === DIM ? '#737aa2' : color;
      g.fillText(i === 4 ? (this.src.page() === 'drums' ? 'DRUMS' : 'SOUND') : PAD_LABELS[i], x + pw / 2, y + ph - 4);
    }
  }

  drawKnobs(g) {
    const page = this.src.page();
    const knobs = this.src.knobs();
    const x0 = 152, step = 22.5;
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = i < 4 ? 0 : 1;
      const cx = x0 + col * step, cy = 12 + row * 24;
      const v = this.src.engine ? knobs[i].get() : 0.5;
      g.lineCap = 'round';
      g.lineWidth = 1.6;
      g.strokeStyle = '#24283b';
      g.beginPath(); g.arc(cx, cy, 8, 0.75 * Math.PI, 2.25 * Math.PI); g.stroke();
      g.strokeStyle = KNOB_COLORS[i];
      g.beginPath(); g.arc(cx, cy, 8, 0.75 * Math.PI, (0.75 + v * 1.5) * Math.PI); g.stroke();
      g.lineCap = 'butt';
      drawIcon(g, KNOB_ICONS[page][i], cx - 3.15, cy - 3.6, 0.9, KNOB_COLORS[i]);
      g.font = FONT(3.6);
      g.fillStyle = KNOB_COLORS[i];
      g.fillText(KNOB_LABELS[page][i], cx, cy + 10.5);
    }
  }

  drawKeys(g) {
    const x0 = 6, y0 = 52, wh = 44, bh = 26;
    const ww = (OW - 12) / 15, bw = ww * 0.6;
    const whites = [0, 2, 4, 5, 7, 9, 11];
    const fold = (note) => ((note % 24) + 24) % 24; // fold everything onto the 2-octave keybed
    const lit = new Set([...this.held.keys()].map(fold));
    g.lineWidth = 0.6;
    for (let k = 0; k < 15; k++) {
      const note = k === 14 ? 0 : whites[k % 7] + Math.floor(k / 7) * 12;
      const x = x0 + k * ww;
      if (lit.has(note)) {
        const c = `rgb(${pitchColor(note)})`;
        g.fillStyle = c;
        g.shadowColor = c;
        g.shadowBlur = 8;
        roundRect(g, x + 0.8, y0 + 0.8, ww - 1.6, wh - 1.6, 1.5);
        g.fill();
        g.shadowBlur = 0;
      }
      g.strokeStyle = LINE;
      roundRect(g, x + 0.3, y0, ww - 0.6, wh, 1.5);
      g.stroke();
    }
    const blackAfter = [0, 1, 3, 4, 5];
    const blackSemi = [1, 3, 6, 8, 10];
    for (let oct = 0; oct < 2; oct++) {
      blackAfter.forEach((w, j) => {
        const note = blackSemi[j] + oct * 12;
        const x = x0 + (w + oct * 7 + 1) * ww - bw / 2;
        g.fillStyle = lit.has(note) ? `rgb(${pitchColor(note)})` : '#0d0e16';
        roundRect(g, x, y0, bw, bh, 1);
        g.fill();
        g.strokeStyle = LINE;
        g.stroke();
      });
    }
  }
}

const ZONE_SHORT = { U: '+7TH', D: 'SUS4', L: 'FLIP', R: 'ADD9', UL: 'FLIP7', UR: '9TH', DL: 'SUS2', DR: '6TH' };

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
