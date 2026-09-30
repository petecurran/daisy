import { Engine } from './audio/engine.js';
import { PRESETS } from './audio/presets.js';
import { connectMidi } from './midi.js';

// MPK Mini Mk II factory mapping (measured): knobs K1-K8 = CC1-8, joystick X = pitch bend,
// joystick Y (up AND down) = CC1, which collides with K1, so K1 is left to the joystick for now.
const KNOBS = [
  { cc: 2, label: 'Brightness', target: 'macro', key: 'brightness' },
  { cc: 3, label: 'Resonance', target: 'macro', key: 'resonance' },
  { cc: 4, label: 'Drive', target: 'fx', key: 'drive' },
  { cc: 5, label: 'Chorus', target: 'fx', key: 'chorus' },
  { cc: 6, label: 'Tape wobble', target: 'fx', key: 'wobble' },
  { cc: 7, label: 'Echo', target: 'fx', key: 'echo' },
  { cc: 8, label: 'Reverb', target: 'fx', key: 'reverb' },
];

const COMPUTER_KEYS = 'awsedftgyhujk';

let engine = null;
let presetIndex = 0;
const knobEls = new Map();

// ---------- UI ----------

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
  el.innerHTML = `<div class="dial"></div><div class="label">${k.label}</div><div class="cc">K${k.cc} · CC${k.cc}</div>`;
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

function currentKnobValue(k) {
  if (!engine) return 0.5;
  return k.target === 'macro' ? engine.macros[k.key] : engine.fx.values[k.key];
}

function refreshKnobs() {
  for (const k of KNOBS) showKnob(k.cc, currentKnobValue(k));
}

function selectPreset(i) {
  presetIndex = (i + PRESETS.length) % PRESETS.length;
  [...presetsEl.children].forEach((el, j) => el.classList.toggle('active', j === presetIndex));
  if (!engine) return;
  engine.allOff();
  engine.setPreset(PRESETS[presetIndex]);
  engine.setMacro('brightness', 0.5);
  engine.setMacro('resonance', 0.5);
  refreshKnobs();
}

const monitorEl = document.getElementById('monitor');
const monitorLines = [];
function log(line) {
  monitorLines.push(line);
  if (monitorLines.length > 60) monitorLines.shift();
  monitorEl.textContent = monitorLines.join('\n');
  monitorEl.scrollTop = monitorEl.scrollHeight;
}

// ---------- Audio ----------

const startBtn = document.getElementById('start');
startBtn.onclick = () => ensureEngine();

function ensureEngine() {
  if (!engine) {
    engine = new Engine();
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

function noteOn(n, v) {
  if (!engine || engine.ctx.state !== 'running') return;
  engine.noteOn(n, velocityCurve(v));
}
function noteOff(n) { engine?.noteOff(n); }

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
  onNoteOn: (n, v) => noteOn(n, v),
  onNoteOff: (n) => noteOff(n),
  onPitchBend: (amt) => engine?.pitchBend(amt),
  onCC(cc, value) {
    if (!engine) return;
    const v = value / 127;
    if (cc === 1) { engine.modWheel(v); return; }
    const k = KNOBS.find((k) => k.cc === cc);
    if (!k) return;
    if (k.target === 'macro') engine.setMacro(k.key, v);
    else engine.fx.set({ [k.key]: v });
    showKnob(cc, v);
  },
}).catch((err) => {
  document.getElementById('midi-status').textContent = `MIDI: ${err.message}`;
});

const held = new Set();
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') return selectPreset(presetIndex + 1);
  if (e.key === 'ArrowLeft') return selectPreset(presetIndex - 1);
  const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
  if (i < 0 || e.repeat || held.has(i)) return;
  ensureEngine();
  held.add(i);
  noteOn(60 + i, 100);
});
window.addEventListener('keyup', (e) => {
  const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
  if (i < 0) return;
  held.delete(i);
  noteOff(60 + i);
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
