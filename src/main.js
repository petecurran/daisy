import { Engine } from './audio/engine.js';
import { PRESETS } from './audio/presets.js';
import { ChordPlayer, NOTE_NAMES, ZONES, ZONE_LABELS, zoneFromXY } from './chords.js';
import { KITS, PAD_SOUNDS } from './drums/kit.js';
import { SIGNATURES, Sequencer } from './drums/sequencer.js';
import { MidiClock } from './drums/clock.js';
import { connectMidi } from './midi.js';
import { Looper } from './looper.js';
import { bus } from './bus.js';
import { Stage } from './visuals/stage.js';

// MPK Mini Mk II, as reprogrammed by tools/mpk-setup.py:
//   knobs K1-K8 = CC1-8, joystick X = pitch bend, joystick up = CC17 / down = CC16,
//   pads on MIDI channel 10: bank A = notes 44-51 (controls), bank B = notes 32-39 (live drums).
// On factory settings the joystick sends CC1 for both up and down (and clashes with K1).
const JOY_UP_CC = 17;
const JOY_DOWN_CC = 16;
const PAD_CHANNEL = 9;
const PAD_A = 44;
const PAD_B = 32;

// Each pad: `down`/`up` fire instantly; `tap`/`hold` wait to see how long the pad is held.
const PAD_ACTIONS = [
  { label: 'Play / Stop drums', sub: 'hold: stop everything', tap: () => toggleDrums(), hold: () => stopEverything() },
  { label: 'Fill', down: () => seq.playing && seq.queueFill() },
  { label: '◀ Pattern', sub: 'hold: time sig', tap: () => seq.shiftPattern(-1), hold: () => seq.shiftSignature(-1) },
  { label: 'Pattern ▶', sub: 'hold: time sig', tap: () => seq.shiftPattern(1), hold: () => seq.shiftSignature(1) },
  { label: 'Knobs: Sound ⇄ Drums', sub: 'hold: next sound', tap: () => setKnobPage(knobPage === 'sound' ? 'drums' : 'sound'), hold: () => selectPreset(presetIndex + 1) },
  { label: 'Tap tempo', down: () => { seq.tap(); engine.syncEcho(seq.bpm); } },
  { label: 'Break (hold)', down: () => { seq.breakHeld = true; renderDrums(); }, up: () => { seq.breakHeld = false; renderDrums(); } },
  { label: 'Looper', sub: 'tap · 2×tap stop · hold undo', down: () => looper.padDown(), up: () => looper.padUp() },
];
const HOLD_MS = 500;

const COMPUTER_KEYS = 'awsedftgyhujk';

let engine = null;
let chords = null;
let seq = null;
let clock = null;
let looper = null;
let stage = null;
let midiOut = null;
let presetIndex = 0;
let mode = 'chords';
let knobPage = 'sound';
const joy = { x: 0, up: 0, down: 0, dual: false, zone: 'C', timer: null };

const $ = (id) => document.getElementById(id);

// ---------- Knob pages ----------

const fxKnob = (key, label) => ({
  label, get: () => engine.fx.values[key], set: (v) => engine.fx.set({ [key]: v }),
});
const macroKnob = (key, label) => ({
  label, get: () => engine.macros[key], set: (v) => engine.setMacro(key, v),
});

const KNOB_PAGES = {
  sound: [
    {
      label: 'Voicing',
      get: () => (+$('voicing').value + 12) / 24,
      set: (v) => { $('voicing').value = Math.round(v * 24 - 12); syncChordSettings(); },
      fmt: () => (+$('voicing').value > 0 ? '+' : '') + $('voicing').value,
    },
    macroKnob('brightness', 'Brightness'),
    macroKnob('resonance', 'Resonance'),
    fxKnob('drive', 'Drive'),
    fxKnob('chorus', 'Chorus'),
    fxKnob('wobble', 'Tape wobble'),
    fxKnob('echo', 'Echo'),
    fxKnob('reverb', 'Reverb'),
  ],
  drums: [
    {
      label: 'Tempo',
      get: () => (seq.bpm - 50) / 130,
      set: (v) => { seq.setBpm(50 + v * 130); engine.syncEcho(seq.bpm); },
      fmt: () => `${seq.bpm} bpm`,
    },
    { label: 'Busy', get: () => seq.busy, set: (v) => { seq.busy = v; renderGrid(); } },
    { label: 'Swing', get: () => seq.swing, set: (v) => { seq.swing = v; } },
    {
      label: 'Kit',
      get: () => engine.drums.kitIndex / (KITS.length - 1),
      set: (v) => { engine.drums.setKit(Math.min(KITS.length - 1, Math.floor(v * KITS.length))); renderDrums(); },
      fmt: () => engine.drums.kit.name,
    },
    { label: 'Drum tone', get: () => engine.drums.toneAmount, set: (v) => engine.drums.setTone(v) },
    { label: 'Room', get: () => engine.drums.roomAmount, set: (v) => engine.drums.setRoom(v) },
    { label: 'Pump', get: () => engine.pump, set: (v) => { engine.pump = v; } },
    { label: 'Drum level', get: () => engine.drums.level, set: (v) => engine.drums.setLevel(v) },
  ],
};

const knobsEl = $('knobs');
const knobEls = [];
for (let i = 0; i < 8; i++) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.innerHTML = `<div class="dial"></div><div class="label"></div><div class="val"></div><div class="cc">K${i + 1}</div>`;
  knobsEl.appendChild(el);
  knobEls.push(el);
}

function showKnob(i, flash = true) {
  const k = KNOB_PAGES[knobPage][i];
  const el = knobEls[i];
  el.querySelector('.label').textContent = k.label;
  const v = engine ? k.get() : 0.5;
  el.querySelector('.dial').style.setProperty('--rot', `${-135 + v * 270}deg`);
  el.querySelector('.val').textContent = engine ? (k.fmt ? k.fmt() : `${Math.round(v * 100)}%`) : '';
  if (!flash) return;
  el.classList.add('flash');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('flash'), 250);
}

function renderKnobs() {
  for (let i = 0; i < 8; i++) showKnob(i, false);
  document.querySelectorAll('.knob-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.page === knobPage));
}

function setKnobPage(page) {
  knobPage = page;
  renderKnobs();
}
document.querySelectorAll('.knob-tabs button').forEach((b) => (b.onclick = () => setKnobPage(b.dataset.page)));

// ---------- Sounds ----------

const presetsEl = $('presets');
PRESETS.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'preset';
  b.style.setProperty('--c', p.color);
  b.innerHTML = `<div class="name" style="color:${p.color}">${p.name}</div>
    <div class="insp">after ${p.inspired}</div><div class="blurb">${p.blurb}</div>`;
  b.onclick = () => { ensureEngine(); selectPreset(i); };
  presetsEl.appendChild(b);
});

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
  renderKnobs();
}

// ---------- Chords ----------

const chordNameEl = $('chord-name');
const joyGridEl = $('joy-grid');
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
  const keys = chords ? [...chords.held.keys()] : [];
  bus.emit('chord', { name, root: keys.length ? keys[keys.length - 1] : null });
  if (name) {
    chordNameEl.textContent = name;
    chordNameEl.classList.add('lit');
  } else {
    chordNameEl.classList.remove('lit');
  }
}

NOTE_NAMES.forEach((n, i) => $('key-tonic').add(new Option(n, i)));

function syncChordSettings() {
  if (!chords) return;
  chords.key = { tonic: +$('key-tonic').value, mode: $('key-mode').value };
  chords.voicing = +$('voicing').value;
  chords.strumMs = +$('strum').value;
  chords.bass = $('bass').checked;
}
['key-tonic', 'key-mode', 'voicing', 'strum', 'bass'].forEach((id) => $(id).addEventListener('input', syncChordSettings));

function setMode(m) {
  mode = m;
  chords?.allOff();
  engine?.allOff();
  engine?.pitchBend(0);
  engine?.modWheel(0);
  $('mode-chords').classList.toggle('active', m === 'chords');
  $('mode-notes').classList.toggle('active', m === 'notes');
  $('chord-panel').classList.toggle('dim', m !== 'chords');
}
$('mode-chords').onclick = () => setMode('chords');
$('mode-notes').onclick = () => setMode('notes');

// Worn key contacts sometimes never send a note-off, leaving a note droning. Esc clears everything.
function panic() {
  stopEverything();
  chords?.allOff();
  chords?.refs.clear();
  engine?.allOff();
  engine?.all.forEach((v) => v.done || v.kill());
  showChord(null);
}
$('panic').onclick = panic;

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
  joy.dual = true;
  $('joy-status').textContent = 'Joystick: dual CC ✓';
  $('joy-status').classList.add('ok');
}

// ---------- Drums ----------

const sigButtons = $('sig-buttons');
for (const s of SIGNATURES) {
  const b = document.createElement('button');
  b.textContent = s.id;
  b.dataset.sig = s.id;
  b.onclick = () => { ensureEngine(); seq.setSignature(s.id); };
  sigButtons.appendChild(b);
}

const padMapEl = $('pad-map');
// Physical layout: pads 5-8 on the top row, 1-4 on the bottom.
for (const i of [4, 5, 6, 7, 0, 1, 2, 3]) {
  const el = document.createElement('div');
  el.className = 'pad';
  el.dataset.pad = i;
  const a = PAD_ACTIONS[i];
  el.innerHTML = `<span class="num">${i + 1}</span>${a.label}${a.sub ? `<span class="sub">${a.sub}</span>` : ''}`;
  padMapEl.appendChild(el);
}
function flashPad(i, on) {
  padMapEl.querySelector(`[data-pad="${i}"]`)?.classList.toggle('hit', on);
}

let gridCells = []; // [track][step] -> element
let gridPattern = null;
function renderGrid() {
  if (!seq) return;
  const grid = $('drum-grid');
  if (gridPattern !== seq.pattern) {
    gridPattern = seq.pattern;
    grid.innerHTML = '';
    gridCells = [];
    const { barSteps, beatSteps } = seq.sig;
    grid.style.setProperty('--steps', seq.length);
    for (const [sound, line] of Object.entries(seq.pattern.tracks)) {
      const label = document.createElement('div');
      label.className = 'track-label';
      label.textContent = sound;
      grid.appendChild(label);
      const row = [];
      [...line].forEach((ch, i) => {
        const c = document.createElement('div');
        c.className = 'step';
        if (i % beatSteps === 0) c.classList.add('beat');
        if (i % barSteps === 0) c.classList.add('bar');
        c.dataset.d = ch === '.' ? 0 : ch;
        grid.appendChild(c);
        row.push(c);
      });
      gridCells.push(row);
    }
  }
  const thr = seq.threshold;
  for (const row of gridCells) {
    for (const c of row) {
      const d = +c.dataset.d;
      c.classList.toggle('on', d > 0 && d >= thr);
      c.classList.toggle('ghost', d > 0 && d < thr);
      c.style.setProperty('--level', d / 9);
    }
  }
}

let lastStep = -1;
function showStep(step, inBar, globalStep) {
  if (seq && step >= 0) bus.emit('step', { inBar, barSteps: seq.sig.barSteps, beatSteps: seq.sig.beatSteps, global: globalStep });
  if (looper?.hasLoop && globalStep >= looper.start) {
    const pos = (globalStep - looper.start) % looper.length;
    $('loop-progress').style.width = `${((pos + 1) / looper.length) * 100}%`;
  }
  for (const row of gridCells) {
    row[lastStep]?.classList.remove('now');
    row[step]?.classList.add('now');
  }
  lastStep = step;
}

function renderDrums() {
  if (!seq) return;
  const drumsOn = seq.playing && !seq.drumsMuted;
  $('drum-play').textContent = drumsOn ? '■ Stop' : '▶ Play';
  $('drum-play').classList.toggle('playing', drumsOn);
  $('pattern-name').textContent = seq.pattern.name;
  $('pattern-feel').textContent = seq.pattern.feel;
  $('tempo').textContent = `${seq.bpm} bpm`;
  $('kit-name').textContent = engine.drums.kit.name;
  $('drum-fill').classList.toggle('armed', seq.fillQueued || !!seq.fill);
  $('drum-stage').classList.toggle('breaking', seq.breakHeld);
  sigButtons.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.sig === seq.sigId));
  if (!seq.playing) showStep(-1);
  renderGrid();
  if (knobPage === 'drums') renderKnobs();
}

// Drums, loop playback and every sounding note: all off.
function stopEverything() {
  if (looper?.hasLoop && looper.state !== 'stopped') looper.stop();
  seq?.stop();
  renderDrums();
}

// With a loop going, the transport has to keep running, so Play/Stop just mutes the drums.
function toggleDrums() {
  if (looper.hasLoop && seq.playing) {
    seq.drumsMuted = !seq.drumsMuted;
    renderDrums();
  } else {
    seq.toggle();
  }
}
$('drum-play').onclick = () => { ensureEngine(); toggleDrums(); };
$('drum-fill').onclick = () => seq?.playing && seq.queueFill();
$('pattern-prev').onclick = () => { ensureEngine(); seq.shiftPattern(-1); };
$('pattern-next').onclick = () => { ensureEngine(); seq.shiftPattern(1); };
$('tap').onclick = () => { ensureEngine(); seq.tap(); engine.syncEcho(seq.bpm); };

function onPad(note, velocity, isDown) {
  if (!engine) return;
  if (note >= PAD_A && note < PAD_A + 8) {
    const i = note - PAD_A;
    flashPad(i, isDown);
    bus.emit('pad', { index: i, down: isDown });
    const action = PAD_ACTIONS[i];
    if (action.tap) {
      if (isDown) {
        action.held = false;
        action.timer = setTimeout(() => { action.held = true; action.hold(); }, HOLD_MS);
      } else {
        clearTimeout(action.timer);
        if (!action.held) action.tap();
      }
    } else if (isDown) action.down();
    else action.up?.();
  } else if (isDown && note >= PAD_B && note < PAD_B + 8) {
    engine.drums.play(PAD_SOUNDS[note - PAD_B], null, 0.35 + (velocity / 127) * 0.65);
  }
}

// ---------- Looper ----------

const LOOP_STATES = {
  empty: ['Empty', 'Pad 8 (or R) to record. Recording starts on the next bar.'],
  armed: ['Get ready…', 'Recording starts on the next bar. Tap again to cancel.'],
  recording: ['Recording', 'Tap pad 8 at the end of your phrase to close the loop.'],
  playing: ['Playing', 'Tap to add a layer (pick a new sound first!). Hold to undo. Double-tap to stop.'],
  overdub: ['Adding layer', 'Tap to keep this layer. Hold to throw it away.'],
  stopped: ['Stopped', 'Tap to play from the next bar. Hold to clear everything.'],
};

function renderLooper() {
  if (!looper) return;
  const [title, hint] = LOOP_STATES[looper.state];
  $('loop-state').textContent = title;
  $('loop-state').dataset.state = looper.state;
  $('loop-hint').textContent = hint;
  $('loop-length').textContent = looper.hasLoop ? `${looper.bars} bar${looper.bars === 1 ? '' : 's'}` : '';
  if (!looper.hasLoop) $('loop-progress').style.width = '0';
  $('looper').classList.toggle('active', looper.state !== 'empty');

  const list = $('loop-layers');
  list.innerHTML = '';
  const rows = [...looper.layers];
  if (looper.current && looper.state !== 'armed') rows.push({ ...looper.current, recording: true });
  rows.forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'layer' + (l.muted ? ' muted' : '') + (l.recording ? ' rec' : '');
    row.style.setProperty('--c', l.preset.color);
    const options = PRESETS.map((p) => `<option value="${p.id}" ${p.id === l.preset.id ? 'selected' : ''}>${p.name}</option>`).join('');
    row.innerHTML = `<span class="dot"></span><span class="lname">Layer ${i + 1}</span>
      <select ${l.recording ? 'disabled' : ''}>${options}</select>
      <span class="count">${l.recording ? 'recording…' : `${l.events.length} notes`}</span>
      ${l.recording ? '' : '<button class="small mute">Mute</button><button class="small del" title="Delete layer">✕</button>'}`;
    if (!l.recording) {
      row.querySelector('select').onchange = (e) => looper.setLayerPreset(l.id, PRESETS.find((p) => p.id === e.target.value));
      row.querySelector('.mute').onclick = () => looper.toggleMute(l.id);
      row.querySelector('.mute').textContent = l.muted ? 'Unmute' : 'Mute';
      row.querySelector('.del').onclick = () => looper.removeLayer(l.id);
    }
    list.appendChild(row);
  });
  renderDrums();
}

$('loop-tap').onclick = () => { ensureEngine(); looper.tap(); };
$('loop-stop').onclick = () => { if (looper?.hasLoop) looper.stop(); };
$('loop-undo').onclick = () => looper?.undo();
$('loop-clear').onclick = () => looper?.clear();

// ---------- Monitor ----------

const monitorEl = $('monitor');
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

$('start').onclick = () => ensureEngine();
$('stage-btn').onclick = () => { ensureEngine(); stage.show(true); };

function ensureEngine() {
  if (!engine) {
    engine = new Engine();
    chords = new ChordPlayer(engine, (name) => showChord(name));
    seq = new Sequencer(engine.ctx, engine.drums, { onStep: showStep, onState: renderDrums });
    engine.syncEcho(seq.bpm);
    clock = new MidiClock(engine.ctx, () => seq.bpm);
    clock.setOutput(midiOut);
    seq.onStart = (t) => clock.align(t); // arp locks to the drum grid
    looper = new Looper(engine, seq, { onState: renderLooper });
    seq.onSchedule = (step, t) => looper.onSchedule(step, t);
    stage = new Stage($('stage'), {
      engine, seq, looper, chords, joy,
      knobs: () => KNOB_PAGES[knobPage],
      page: () => knobPage,
      preset: () => PRESETS[presetIndex],
    });
    stage.show(true); // the stage is the main view; V flips to the settings page
    window.vibesynth = { engine, seq, looper, chords, stage }; // handy in the devtools console
    syncChordSettings();
    selectPreset(presetIndex);
    $('start').classList.add('hidden');
    document.body.classList.add('awake');
    renderDrums();
    drawScope();
    setInterval(showLatency, 1000);
  }
  if (engine.ctx.state !== 'running') engine.ctx.resume();
  return engine;
}

function showLatency() {
  const { base, output } = engine.latencyMs();
  $('latency').textContent = `Audio latency ≈ ${(base + output).toFixed(0)} ms`;
  $('latency').classList.add('ok');
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
    const mpk = names.find((n) => /mpk/i.test(n));
    $('midi-status').textContent = names.length ? `MIDI: ${mpk || names.join(', ')}` : 'MIDI: no devices';
    $('midi-status').classList.toggle('ok', names.length > 0);
  },
  onOutputs(outputs) {
    midiOut = outputs.find((o) => /mpk/i.test(o.name)) || null;
    clock?.setOutput(midiOut);
  },
  onRaw({ type, channel, d1, d2 }) {
    const kind = { 0x80: 'note off', 0x90: 'note on ', 0xb0: 'CC      ', 0xe0: 'bend    ' }[type] || type.toString(16);
    if (type === 0xe0) log(`${kind} ch${channel + 1}  ${(((d2 << 7) | d1) - 8192)}`);
    else log(`${kind} ch${channel + 1}  ${d1.toString().padStart(3)}  ${d2}`);
  },
  onNoteOn(n, v, ch) {
    if (ch === PAD_CHANNEL) onPad(n, v, true);
    else keyDown(n, v);
  },
  onNoteOff(n, ch) {
    if (ch === PAD_CHANNEL) onPad(n, 0, false);
    else keyUp(n);
  },
  onPitchBend(amt) {
    joy.x = amt;
    if (mode === 'chords') updateJoystick();
    else engine?.pitchBend(amt);
  },
  onCC(cc, value) {
    const v = value / 127;
    if (cc === JOY_UP_CC || cc === JOY_DOWN_CC) {
      if (cc === JOY_UP_CC) joy.up = v; else joy.down = v;
      if (mode === 'chords') updateJoystick();
      else engine?.modWheel(Math.max(joy.up, joy.down));
      return;
    }
    if (!engine || cc < 1 || cc > 8) return;
    KNOB_PAGES[knobPage][cc - 1].set(v);
    showKnob(cc - 1);
    bus.emit('knob', { index: cc - 1, page: knobPage, value: v });
  },
}).catch((err) => {
  $('midi-status').textContent = `MIDI: ${err.message}`;
});

const heldKeys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') return panic();
  if (e.key.toLowerCase() === 'r') {
    if (!e.repeat) { ensureEngine(); looper.padDown(); }
    return;
  }
  if (e.key.toLowerCase() === 'v') { ensureEngine(); return stage.show(); }
  if (e.key === 'Tab') { e.preventDefault(); return setMode(mode === 'chords' ? 'notes' : 'chords'); }
  if (e.key === ' ') { e.preventDefault(); ensureEngine(); return seq.toggle(); }
  if (e.key === 'ArrowRight') return selectPreset(presetIndex + 1);
  if (e.key === 'ArrowLeft') return selectPreset(presetIndex - 1);
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    $('voicing').value = +$('voicing').value + (e.key === 'ArrowUp' ? 1 : -1);
    syncChordSettings();
    return knobPage === 'sound' && showKnob(0, false);
  }
  const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
  if (i < 0 || e.repeat || heldKeys.has(i)) return;
  ensureEngine();
  heldKeys.add(i);
  keyDown(60 + i, 100);
});
window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'r' && looper) return looper.padUp();
  const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
  if (i < 0 || !heldKeys.has(i)) return;
  heldKeys.delete(i);
  keyUp(60 + i);
});

// ---------- Scope (a first taste of visuals) ----------

function drawScope() {
  const canvas = $('scope');
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
renderKnobs();
