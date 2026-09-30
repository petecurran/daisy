import { Engine } from './audio/engine.js';
import { PRESETS } from './audio/presets.js';
import { ChordPlayer, NOTE_NAMES, ZONES, ZONE_LABELS, zoneFromXY } from './chords.js';
import { connectMidi } from './midi.js';

// MPK Mini Mk II factory mapping (measured): knobs K1-K8 = CC1-8, joystick X = pitch bend,
// joystick Y (up AND down) = CC1, colliding with K1. After reprogramming (tools/mpk-setup.py)
// the joystick sends up = CC17, down = CC16, pads are on channel 10, and K1 is free.
const KNOBS = [
  { cc: 2, label: 'Brightness', target: 'macro', key: 'brightness' },
  { cc: 3, label: 'Resonance', target: 'macro', key: 'resonance' },
  { cc: 4, label: 'Drive', target: 'fx', key: 'drive' },
  { cc: 5, label: 'Chorus', target: 'fx', key: 'chorus' },
  { cc: 6, label: 'Tape wobble', target: 'fx', key: 'wobble' },
  { cc: 7, label: 'Echo', target: 'fx', key: 'echo' },
  { cc: 8, label: 'Reverb', target: 'fx', key: 'reverb' },
];
const JOY_UP_CC = 17;
const JOY_DOWN_CC = 16;
const VOICING_CC = 1; // K1, only once the joystick no longer uses CC1
const PAD_CHANNEL = 9; // MIDI channel 10, once the pads are reprogrammed

const COMPUTER_KEYS = 'awsedftgyhujk';

let engine = null;
let chords = null;
let presetIndex = 0;
let mode = 'chords';
const knobEls = new Map();
// dual = joystick reprogrammed (up/down on separate CCs). This MPK has been; see tools/mpk-setup.py.
const joy = { x: 0, up: 0, down: 0, dual: false, zone: 'C', timer: null };

// ---------- Sound + knob UI ----------

const presetsEl = document.getElementById('presets');
PRESETS.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'preset';
  b.style.setProperty('--c', p.color);
  b.innerHTML = `<div class="name" style="color:${p.color}">${p.name}</div>
    <div class="insp">after ${p.inspired}</div><div class="blurb">${p.blurb}</div>`;
  b.onclick = () => { ensureEngine(); selectPreset(i); };
  presetsEl.appendChild(b);
});

const knobsEl = document.getElementById('knobs');
for (const k of KNOBS) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.innerHTML = `<div class="dial"></div><div class="label">${k.label}</div><div class="cc">K${k.cc}</div>`;
  knobsEl.appendChild(el);
  knobEls.set(k.cc, el);
}

function showKnob(cc, value01) {
  const el = knobEls.get(cc);
  if (!el) return;
  el.querySelector('.dial').style.setProperty('--rot', `${-135 + value01 * 270}deg`);
  el.classList.add('flash');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('flash'), 250);
}

function refreshKnobs() {
  for (const k of KNOBS) {
    showKnob(k.cc, k.target === 'macro' ? engine.macros[k.key] : engine.fx.values[k.key]);
  }
}

function selectPreset(i) {
  presetIndex = (i + PRESETS.length) % PRESETS.length;
  [...presetsEl.children].forEach((el, j) => el.classList.toggle('active', j === presetIndex));
  document.documentElement.style.setProperty('--accent', PRESETS[presetIndex].color);
  if (!engine) return;
  chords.allOff();
  engine.allOff();
  engine.setPreset(PRESETS[presetIndex]);
  engine.setMacro('brightness', 0.5);
  engine.setMacro('resonance', 0.5);
  refreshKnobs();
}

// ---------- Chord UI ----------

const chordNameEl = document.getElementById('chord-name');
const joyGridEl = document.getElementById('joy-grid');
for (const row of ZONES) {
  for (const z of row) {
    const cell = document.createElement('div');
    cell.className = 'joy-cell';
    cell.dataset.zone = z;
    cell.textContent = ZONE_LABELS[z];
    joyGridEl.appendChild(cell);
  }
}

function showZone(zone) {
  for (const cell of joyGridEl.children) cell.classList.toggle('on', cell.dataset.zone === zone);
}

function showChord(name) {
  if (name) {
    chordNameEl.textContent = name;
    chordNameEl.classList.add('lit');
  } else {
    chordNameEl.classList.remove('lit');
  }
}

const tonicEl = document.getElementById('key-tonic');
NOTE_NAMES.forEach((n, i) => tonicEl.add(new Option(n, i)));
const modeSelEl = document.getElementById('key-mode');
const voicingEl = document.getElementById('voicing');
const strumEl = document.getElementById('strum');
const bassEl = document.getElementById('bass');

function syncChordSettings() {
  if (!chords) return;
  chords.key = { tonic: +tonicEl.value, mode: modeSelEl.value };
  chords.voicing = +voicingEl.value;
  chords.strumMs = +strumEl.value;
  chords.bass = bassEl.checked;
}
[tonicEl, modeSelEl, voicingEl, strumEl, bassEl].forEach((el) => el.addEventListener('input', syncChordSettings));

function setMode(m) {
  mode = m;
  chords?.allOff();
  engine?.allOff();
  engine?.pitchBend(0);
  engine?.modWheel(0);
  document.getElementById('mode-chords').classList.toggle('active', m === 'chords');
  document.getElementById('mode-notes').classList.toggle('active', m === 'notes');
  document.getElementById('chord-panel').classList.toggle('dim', m !== 'chords');
}
document.getElementById('mode-chords').onclick = () => setMode('chords');
document.getElementById('mode-notes').onclick = () => setMode('notes');

// Worn key contacts sometimes never send a note-off, leaving a note droning. Esc clears everything.
function panic() {
  chords?.allOff();
  if (chords) chords.refs.clear();
  engine?.allOff();
  engine?.all.forEach((v) => v.done || v.kill());
  showChord(null);
}
document.getElementById('panic').onclick = panic;

// ---------- Joystick ----------

function updateJoystick() {
  if (mode !== 'chords' || !chords) return;
  const y = joy.dual ? joy.up - joy.down : joy.up;
  const zone = zoneFromXY(joy.x, y, joy.zone);
  if (zone === joy.zone) return;
  joy.zone = zone;
  showZone(zone);
  // Tiny debounce so sweeping through a diagonal doesn't strike every chord on the way.
  clearTimeout(joy.timer);
  joy.timer = setTimeout(() => chords.setZone(joy.zone), 35);
}

function markDualJoystick() {
  if (joy.dual) return;
  joy.dual = true;
  const el = document.getElementById('joy-status');
  el.textContent = 'Joystick: dual CC ✓';
  el.classList.add('ok');
}

// ---------- Monitor ----------

const monitorEl = document.getElementById('monitor');
const monitorLines = [];
function log(line) {
  monitorLines.push(line);
  if (monitorLines.length > 80) monitorLines.shift();
  if (monitorEl.parentElement.open) {
    monitorEl.textContent = monitorLines.join('\n');
    monitorEl.scrollTop = monitorEl.scrollHeight;
  }
}

// ---------- Audio ----------

const startBtn = document.getElementById('start');
startBtn.onclick = () => ensureEngine();

function ensureEngine() {
  if (!engine) {
    engine = new Engine();
    chords = new ChordPlayer(engine, (name) => showChord(name));
    syncChordSettings();
    selectPreset(presetIndex);
    startBtn.classList.add('hidden');
    drawScope();
    setInterval(showLatency, 1000);
  }
  if (engine.ctx.state !== 'running') engine.ctx.resume();
  return engine;
}

function showLatency() {
  const { base, output } = engine.latencyMs();
  const el = document.getElementById('latency');
  el.textContent = `Audio latency ≈ ${(base + output).toFixed(0)} ms`;
  el.classList.add('ok');
}

// ---------- Inputs ----------

// Some of this MPK's keys have worn contacts and report velocity 1 however hard they're hit.
// Treat those as a normal hit, and lift the soft end of the range so nothing plays near-silent.
function velocityCurve(v) {
  if (v <= 4) return 96;
  return Math.round(45 + (v / 127) * 82);
}

function keyDown(n, v) {
  if (!engine || engine.ctx.state !== 'running') return;
  if (mode === 'chords') chords.press(n, velocityCurve(v));
  else engine.noteOn(n, velocityCurve(v));
}
function keyUp(n) {
  if (!engine) return;
  if (mode === 'chords') chords.release(n);
  else engine.noteOff(n);
}

connectMidi({
  onDevices(names) {
    const el = document.getElementById('midi-status');
    const mpk = names.find((n) => /mpk/i.test(n));
    el.textContent = names.length ? `MIDI: ${mpk || names.join(', ')}` : 'MIDI: no devices';
    el.classList.toggle('ok', names.length > 0);
  },
  onRaw({ type, channel, d1, d2 }) {
    const kind = { 0x80: 'note off', 0x90: 'note on ', 0xb0: 'CC      ', 0xe0: 'bend    ' }[type] || type.toString(16);
    if (type === 0xe0) log(`${kind} ch${channel + 1}  ${(((d2 << 7) | d1) - 8192)}`);
    else log(`${kind} ch${channel + 1}  ${d1.toString().padStart(3)}  ${d2}`);
  },
  onNoteOn(n, v, ch) {
    if (ch === PAD_CHANNEL) return; // pads: reserved for drums
    keyDown(n, v);
  },
  onNoteOff(n, ch) {
    if (ch === PAD_CHANNEL) return;
    keyUp(n);
  },
  onPitchBend(amt) {
    joy.x = amt;
    if (mode === 'chords') updateJoystick();
    else engine?.pitchBend(amt);
  },
  onCC(cc, value) {
    const v = value / 127;
    if (cc === JOY_UP_CC || cc === JOY_DOWN_CC) {
      markDualJoystick();
      if (cc === JOY_UP_CC) joy.up = v; else joy.down = v;
      if (mode === 'chords') updateJoystick();
      else engine?.modWheel(Math.max(joy.up, joy.down));
      return;
    }
    if (cc === 1 && !joy.dual) {
      joy.up = v;
      if (mode === 'chords') updateJoystick();
      else engine?.modWheel(v);
      return;
    }
    if (cc === VOICING_CC && joy.dual) {
      voicingEl.value = Math.round(v * 24 - 12);
      syncChordSettings();
      return;
    }
    if (!engine) return;
    const k = KNOBS.find((k) => k.cc === cc);
    if (!k) return;
    if (k.target === 'macro') engine.setMacro(k.key, v);
    else engine.fx.set({ [k.key]: v });
    showKnob(cc, v);
  },
}).catch((err) => {
  document.getElementById('midi-status').textContent = `MIDI: ${err.message}`;
});

const heldKeys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') return panic();
  if (e.key === 'Tab') { e.preventDefault(); return setMode(mode === 'chords' ? 'notes' : 'chords'); }
  if (e.key === 'ArrowRight') return selectPreset(presetIndex + 1);
  if (e.key === 'ArrowLeft') return selectPreset(presetIndex - 1);
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    voicingEl.value = +voicingEl.value + (e.key === 'ArrowUp' ? 1 : -1);
    return syncChordSettings();
  }
  const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
  if (i < 0 || e.repeat || heldKeys.has(i)) return;
  ensureEngine();
  heldKeys.add(i);
  keyDown(60 + i, 100);
});
window.addEventListener('keyup', (e) => {
  const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
  if (i < 0 || !heldKeys.has(i)) return;
  heldKeys.delete(i);
  keyUp(60 + i);
});

// ---------- Scope (a first taste of visuals) ----------

function drawScope() {
  const canvas = document.getElementById('scope');
  const g = canvas.getContext('2d');
  const an = engine.fx.analyser;
  const buf = new Float32Array(an.fftSize);
  const frame = () => {
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    an.getFloatTimeDomainData(buf);
    // Find a rising zero crossing so the wave stands still.
    let start = 0;
    for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
    const color = PRESETS[presetIndex].color;
    g.lineWidth = 2 * devicePixelRatio;
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.beginPath();
    const span = buf.length / 2;
    for (let i = 0; i < span; i++) {
      const x = (i / span) * w;
      const y = h / 2 - buf[start + i] * h * 0.9;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    requestAnimationFrame(frame);
  };
  frame();
}

selectPreset(0);
showZone('C');
markDualJoystick();
