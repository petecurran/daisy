import { KNOB_COLORS } from './palette.js';
import { KNOB_ICONS, KNOB_LABELS, svg } from './icons.js';
import { NOTE_NAMES } from '../chords.js';

// The on-screen deck: a slim strip laid out like the MPK. Pads are labelled with what they do on the
// current knob page (and what they'll do right now); the knobs are small colour rings; the keys are a
// light strip that glows in the chord's colour.

const LOOP_PAD = {
  empty: ['record', 'Record'], armed: ['record', 'Cancel'], recording: ['record', 'Close loop'],
  playing: ['loop', 'Add layer'], overdub: ['loop', 'Keep layer'], stopped: ['loop', 'Resume'],
};

// What each pad shows, per knob page. Pad index 0 = pad 1.
function padInfo(page, i, s) {
  const { seq, looper, mode, key } = s;
  const drumsOn = seq?.playing && !seq.drumsMuted;
  if (i === 0) return { icon: drumsOn ? 'stop' : 'play', label: drumsOn ? 'Stop drums' : 'Drums', sub: 'hold: stop all', state: drumsOn ? 'green' : '' };
  if (i === 4) return { icon: 'sliders', label: page === 'drums' ? 'Drum knobs' : 'Sound knobs', sub: 'tap: flip' };
  if (i === 7) {
    const st = looper?.state ?? 'empty';
    const [icon, label] = LOOP_PAD[st];
    return { icon, label, sub: st === 'empty' ? 'loop' : 'hold: undo', state: { armed: 'amber', recording: 'red', overdub: 'red', playing: 'green' }[st] ?? '' };
  }
  if (page === 'sound') {
    return [
      null,
      { icon: mode === 'chords' ? 'layers' : 'note', label: mode === 'chords' ? 'Chords' : 'Notes', sub: 'tap: switch', state: mode === 'notes' ? 'pink' : '' },
      { icon: 'prev', label: 'Sound', sub: '' },
      { icon: 'next', label: 'Sound', sub: '' },
      null,
      { icon: 'hash', label: key, sub: 'hold + press key' },
      { icon: 'pin', label: 'Sustain', sub: 'hold', state: s.sustain ? 'pink' : '' },
    ][i];
  }
  return [
    null,
    { icon: 'fill', label: 'Fill', sub: '' },
    { icon: 'prev', label: 'Groove', sub: 'hold: time sig' },
    { icon: 'next', label: 'Groove', sub: 'hold: time sig' },
    null,
    { icon: 'metronome', label: 'Tap tempo', sub: '' },
    { icon: 'pause', label: 'Break', sub: 'hold', state: seq?.breakHeld ? 'pink' : '' },
  ][i];
}

export class Deck {
  constructor(root, src) {
    this.root = root;
    this.src = src; // { seq, looper, joy, chords, knobs(), page(), preset(), mode() }
    this.cache = new Map();
    this.hits = new Map();
    root.innerHTML = `
      <div class="deck-row">
        <div class="status">
          <span class="chip sound-chip"><i></i><span></span></span>
          <span class="chip key-chip"></span>
          <span class="chip mode-chip"></span>
        </div>
        <div class="joy">
          <svg viewBox="-50 -50 100 100">
            <circle r="40" class="joy-ring"/>
            <circle r="10" class="joy-dot"/>
          </svg>
        </div>
        <div class="pads"></div>
        <div class="knobs"></div>
      </div>
      <div class="strip"></div>`;

    const pads = root.querySelector('.pads');
    for (const i of [4, 5, 6, 7, 0, 1, 2, 3]) { // the hardware has pads 5-8 on top
      const el = document.createElement('div');
      el.className = 'pad';
      el.dataset.i = i;
      el.innerHTML = `<span class="pad-icon"></span><span class="pad-text"><b></b><small></small></span><span class="pad-num">${i + 1}</span>`;
      pads.appendChild(el);
    }
    this.padEls = [...pads.children].sort((a, b) => a.dataset.i - b.dataset.i);

    const knobs = root.querySelector('.knobs');
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('div');
      el.className = 'knob';
      el.style.setProperty('--c', KNOB_COLORS[i]);
      el.innerHTML = `<div class="dial"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" class="track"/><circle cx="24" cy="24" r="19" class="value"/></svg><span class="knob-icon"></span></div><span class="knob-label"></span>`;
      knobs.appendChild(el);
    }
    this.knobEls = [...knobs.children];

    // 25 keys as a light strip; the black keys are shorter, so the keyboard's shape is still there.
    const strip = root.querySelector('.strip');
    const blacks = new Set([1, 3, 6, 8, 10]);
    this.keyEls = new Map();
    for (let n = 0; n <= 24; n++) {
      const el = document.createElement('i');
      if (blacks.has(n % 12)) el.className = 'black';
      strip.appendChild(el);
      this.keyEls.set(n, el);
    }
  }

  set(key, el, prop, value) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (prop === 'html') el.innerHTML = value;
    else if (prop === 'text') el.textContent = value;
    else if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else if (prop.startsWith('.')) el.classList.toggle(prop.slice(1), value);
    else el.setAttribute(prop, value);
  }

  pad({ index, down }) { if (down) this.hits.set(index, performance.now()); }

  top() { return this.root.getBoundingClientRect().top; }

  // The pad you most likely want next: drums first, then the loop.
  suggestedPad() {
    const { seq, looper } = this.src;
    return !seq?.playing && (looper?.state ?? 'empty') === 'empty' ? 0 : 7;
  }

  update(extra = {}) {
    const { joy, chords } = this.src;
    const now = performance.now();
    const page = this.src.page();
    const preset = this.src.preset();
    const mode = this.src.mode();
    const key = chords ? `${NOTE_NAMES[chords.key.tonic]} ${chords.key.mode === 'major' ? 'maj' : 'min'}` : 'Key';
    const info = { ...this.src, mode, key: `Key ${key}`, sustain: extra.sustain };

    const chip = this.root.querySelector('.sound-chip');
    this.set('sound', chip.lastElementChild, 'text', preset.name);
    this.set('soundc', chip, '--c', preset.color);
    this.set('key', this.root.querySelector('.key-chip'), 'text', key);
    this.set('mode', this.root.querySelector('.mode-chip'), 'text', mode === 'chords' ? 'Chords' : 'Notes');
    this.set('modeon', this.root.querySelector('.mode-chip'), '.notes', mode === 'notes');

    const suggest = this.suggestedPad();
    this.padEls.forEach((el, i) => {
      const p = padInfo(page, i, info);
      this.set(`pi${i}`, el.querySelector('.pad-icon'), 'html', svg(p.icon));
      this.set(`pl${i}`, el.querySelector('b'), 'text', p.label);
      this.set(`ps${i}`, el.querySelector('small'), 'text', p.sub);
      this.set(`pst${i}`, el, 'data-state', p.state ?? '');
      this.set(`psg${i}`, el, '.suggest', i === suggest);
      el.classList.toggle('hit', now - (this.hits.get(i) ?? -1e9) < 180);
    });

    const knobs = this.src.knobs();
    this.knobEls.forEach((el, i) => {
      this.set(`ki${i}${page}`, el.querySelector('.knob-icon'), 'html', svg(KNOB_ICONS[page][i]));
      this.set(`kl${i}`, el.querySelector('.knob-label'), 'text', KNOB_LABELS[page][i]);
      this.set(`kd${i}`, el, '--v', knobs[i].get().toFixed(3));
    });

    const x = joy?.x ?? 0, y = joy ? joy.up - joy.down : 0;
    const dot = this.root.querySelector('.joy-dot');
    this.set('jx', dot, 'cx', (x * 28).toFixed(1));
    this.set('jy', dot, 'cy', (-y * 28).toFixed(1));
    this.set('jzon', this.root.querySelector('.joy'), '.on', (joy?.zone ?? 'C') !== 'C');
  }

  // Light the keys that are sounding, in the chord's colour.
  lightKeys(notes, color) {
    const lit = new Set(notes.map((n) => ((n % 24) + 24) % 24));
    for (const [n, el] of this.keyEls) {
      const on = lit.has(n) || (n === 24 && lit.has(0));
      el.classList.toggle('lit', on);
      if (on) el.style.setProperty('--c', `rgb(${color})`);
    }
  }
}
