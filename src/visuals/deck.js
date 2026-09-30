import { KNOB_COLORS } from './palette.js';
import { KNOB_ICONS, KNOB_LABELS, svg } from './icons.js';
import { ZONE_LABELS } from '../chords.js';

// The on-screen deck: the MPK laid out as it is on the desk (joystick, pads, knobs, keys). Pads are
// labelled with what they'll do right now, and the one you most likely want next glows softly.

// Pads in hardware order (index 0 = pad 1). Top row on the MPK is pads 5-8.
const PADS = [
  { hold: 'hold: stop all' },
  { icon: 'fill', label: 'Fill' },
  { icon: 'prev', label: 'Groove', hold: 'hold: time sig' },
  { icon: 'next', label: 'Groove', hold: 'hold: time sig' },
  { icon: 'sliders', hold: 'hold: next sound' },
  { icon: 'metronome', label: 'Tap tempo' },
  { icon: 'pause', label: 'Break', hold: 'hold it' },
  { hold: 'hold: undo' },
];

const LOOP_PAD = {
  empty: ['record', 'Record loop'], armed: ['record', 'Cancel'], recording: ['record', 'Close loop'],
  playing: ['loop', 'Add layer'], overdub: ['loop', 'Keep layer'], stopped: ['loop', 'Resume loop'],
};

export class Deck {
  constructor(root, src) {
    this.root = root;
    this.src = src; // { seq, looper, joy, chords, knobs(), page(), preset() }
    this.cache = new Map();
    this.hits = new Map();
    root.innerHTML = `
      <div class="deck-guide">
        <div class="chips">
          <span class="chip sound-chip"><i></i><span></span></span>
          <span class="chip page-chip"></span>
        </div>
      </div>
      <div class="deck-main">
        <div class="joy">
          <svg viewBox="-50 -50 100 100">
            <circle r="34" class="joy-ring"/>
            <text y="-39">+7th</text><text y="46">sus4</text>
            <text x="-47" y="1.5" text-anchor="end">flip</text><text x="47" y="1.5" text-anchor="start">add9</text>
            <circle r="8" class="joy-dot"/>
          </svg>
          <div class="joy-label"></div>
        </div>
        <div class="pads"></div>
        <div class="knobs"></div>
      </div>
      <div class="keys"></div>`;

    const pads = root.querySelector('.pads');
    for (const i of [4, 5, 6, 7, 0, 1, 2, 3]) {
      const el = document.createElement('div');
      el.className = 'pad';
      el.dataset.i = i;
      el.innerHTML = `<span class="pad-num">${i + 1}</span><span class="pad-icon"></span><span class="pad-label"></span><span class="pad-hold">${PADS[i].hold ?? ''}</span>`;
      pads.appendChild(el);
    }
    this.padEls = [...pads.children].sort((a, b) => a.dataset.i - b.dataset.i);

    const knobs = root.querySelector('.knobs');
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('div');
      el.className = 'knob';
      el.style.setProperty('--c', KNOB_COLORS[i]);
      el.innerHTML = `<div class="dial"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" class="track"/><circle cx="24" cy="24" r="19" class="value"/></svg><span class="knob-icon"></span></div><span class="knob-label"></span><span class="knob-value"></span>`;
      knobs.appendChild(el);
    }
    this.knobEls = [...knobs.children];

    // 25 keys: 15 white, 10 black, folded onto two octaves.
    const keys = root.querySelector('.keys');
    const whites = [0, 2, 4, 5, 7, 9, 11];
    for (let k = 0; k < 15; k++) {
      const el = document.createElement('div');
      el.className = 'key white';
      el.dataset.note = k === 14 ? 24 : whites[k % 7] + Math.floor(k / 7) * 12;
      el.style.left = `${(k / 15) * 100}%`;
      keys.appendChild(el);
    }
    const blackAfter = [0, 1, 3, 4, 5], blackSemi = [1, 3, 6, 8, 10];
    for (let oct = 0; oct < 2; oct++) {
      blackAfter.forEach((w, j) => {
        const el = document.createElement('div');
        el.className = 'key black';
        el.dataset.note = blackSemi[j] + oct * 12;
        el.style.left = `${((w + oct * 7 + 1) / 15) * 100}%`;
        keys.appendChild(el);
      });
    }
    this.keyEls = new Map([...keys.children].map((el) => [+el.dataset.note, el]));
  }

  set(key, el, prop, value) {
    const k = key;
    if (this.cache.get(k) === value) return;
    this.cache.set(k, value);
    if (prop === 'html') el.innerHTML = value;
    else if (prop === 'text') el.textContent = value;
    else if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else if (prop.startsWith('.')) el.classList.toggle(prop.slice(1), value);
    else el.setAttribute(prop, value);
  }

  pad({ index, down }) { if (down) this.hits.set(index, performance.now()); }

  // Where a (folded) note's key sits on screen, for the ink to pour from.
  keyCenter(note) {
    const el = this.keyEls.get(((note % 24) + 24) % 24) ?? this.keyEls.get(0);
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, this.root.getBoundingClientRect().top];
  }

  top() { return this.root.getBoundingClientRect().top; }

  // The pad you most likely want next: drums first, then the loop pedal.
  suggestedPad() {
    const { seq, looper } = this.src;
    return !seq?.playing && (looper?.state ?? 'empty') === 'empty' ? 0 : 7;
  }

  update() {
    const { seq, looper, joy, chords } = this.src;
    const now = performance.now();
    const page = this.src.page();
    const preset = this.src.preset();

    const padIdx = this.suggestedPad();
    const chip = this.root.querySelector('.sound-chip');
    this.set('sound', chip.lastElementChild, 'text', preset.name);
    this.set('soundc', chip, '--c', preset.color);
    this.set('page', this.root.querySelector('.page-chip'), 'text', page === 'drums' ? 'Knobs: DRUMS' : 'Knobs: SOUND');

    // Pads.
    const drumsOn = seq?.playing && !seq.drumsMuted;
    this.padEls.forEach((el, i) => {
      let icon = PADS[i].icon, label = PADS[i].label, state = '';
      if (i === 0) { icon = drumsOn ? 'stop' : 'play'; label = drumsOn ? 'Stop drums' : 'Start drums'; state = drumsOn ? 'green' : ''; }
      if (i === 4) label = 'Knob page';
      if (i === 6 && seq?.breakHeld) state = 'pink';
      if (i === 7) {
        const ls = looper?.state ?? 'empty';
        [icon, label] = LOOP_PAD[ls];
        state = { armed: 'amber', recording: 'red', overdub: 'red', playing: 'green' }[ls] ?? '';
      }
      this.set(`padi${i}`, el.querySelector('.pad-icon'), 'html', svg(icon));
      this.set(`padl${i}`, el.querySelector('.pad-label'), 'text', label);
      this.set(`pads${i}`, el, 'data-state', state);
      this.set(`padn${i}`, el, '.suggest', i === padIdx);
      el.classList.toggle('hit', now - (this.hits.get(i) ?? -1e9) < 180);
    });

    // Knobs.
    const knobs = this.src.knobs();
    this.knobEls.forEach((el, i) => {
      const k = knobs[i];
      const v = k.get();
      this.set(`ki${i}${page}`, el.querySelector('.knob-icon'), 'html', svg(KNOB_ICONS[page][i]));
      this.set(`kl${i}`, el.querySelector('.knob-label'), 'text', KNOB_LABELS[page][i]);
      this.set(`kv${i}`, el.querySelector('.knob-value'), 'text', k.fmt ? k.fmt() : `${Math.round(v * 100)}`);
      this.set(`kd${i}`, el, '--v', v.toFixed(3));
    });

    // Joystick.
    const x = joy?.x ?? 0, y = joy ? joy.up - joy.down : 0;
    const dot = this.root.querySelector('.joy-dot');
    this.set('jx', dot, 'cx', (x * 26).toFixed(1));
    this.set('jy', dot, 'cy', (-y * 26).toFixed(1));
    const zone = joy?.zone ?? 'C';
    this.set('jz', this.root.querySelector('.joy-label'), 'text', zone === 'C' ? 'chord colour' : ZONE_LABELS[zone]);
    this.set('jzon', this.root.querySelector('.joy'), '.on', zone !== 'C');
  }

  // Light the keys that are sounding, in the chord's colour.
  lightKeys(notes, color) {
    const lit = new Set(notes.map((n) => ((n % 24) + 24) % 24));
    for (const [n, el] of this.keyEls) {
      const on = lit.has(n);
      el.classList.toggle('lit', on);
      if (on) el.style.setProperty('--c', `rgb(${color})`);
    }
  }
}
