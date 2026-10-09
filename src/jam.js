// Jamming with Claude. daisy shares the loop with a Claude chat through the local server
// (jam/loop.json), and plays whatever solo comes back (jam/solo.json) from the top of the loop.
// The chat side lives in .claude/skills/solo. Every solo is recorded as it plays (loop, drums and
// all) into jam/recordings, and the last loop comes back after a reload.
//
// Loop memory: every loop is saved on a key of its own (jam/loops/<note>.json) as soon as it's made
// and kept up to date as layers come and go. Hold pad 5 and press a glowing key to bring that loop
// back (it takes over at the next bar if things are playing), or any other key to save a copy there.
//
// A solo is a list of notes, each [bar, beat, note, beats, velocity?, expression?]: bar and beat
// count from 1 at the top of the loop (beats in the time signature's pulse), note is a MIDI number
// or a name like "E4", and expression is { from, slide, bend, release, vib } (see Voice.express).

import { ALL_PRESETS } from './audio/presets.js';
import { patternsFor } from './drums/patterns.js';
import { KITS } from './drums/kit.js';
import { Sound } from './audio/sound.js';
import { NOTE_NAMES } from './chords.js';
import { bus } from './bus.js';

const POLL_MS = 1000;
const SHARE_MS = 400;
const AUDIBLE = ['playing', 'cued', 'overdub']; // looper states where the loop is going round
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FIRST_KEY = 48; // the MPK's keys at its default octave: C3..C5
const LAST_KEY = 72;
const AMBER = '#e0af68';

export const keyName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

// "F#4" -> 66 (middle C is C4).
function noteNumber(name) {
  if (typeof name === 'number') return name;
  const m = /^([A-G])(#|b|♯|♭)?(-?\d)$/.exec(String(name).trim());
  if (!m) throw new Error(`not a note: ${name}`);
  const acc = { '#': 1, '♯': 1, b: -1, '♭': -1 }[m[2]] ?? 0;
  return 12 * (+m[3] + 1) + PITCH[m[1]] + acc;
}

export class Jam {
  constructor(engine, seq, looper, { key, setKey }) {
    this.engine = engine;
    this.seq = seq;
    this.looper = looper;
    this.key = key;
    this.setKey = setKey;
    this.solo = null; // { title, sound, byStep, steps, state: 'cued' | 'playing', start, overLoop }
    this.after = Date.now() / 1000; // only solos written from now on (not one left from last time)
    this.shared = '';
    this.recorders = 0;
    this.slot = null; // the key the current loop is saved on
    this.slots = new Set(); // keys with a loop saved on them
    setInterval(() => this.poll(), POLL_MS);
    this.loadSlots().then(() => this.restore());
  }

  // ---------- the last loop, back after a reload ----------

  async restore() {
    let loop;
    try {
      const res = await fetch('/jam/loop.json', { cache: 'no-store' });
      if (!res.ok) return;
      loop = await res.json();
    } catch {
      return;
    }
    if (this.looper.state !== 'empty' || this.seq.playing || !loop.layers?.length) return; // already playing
    this.load(loop);
    bus.emit('hint', { text: 'Your last loop is back: pad 8 plays it, hold pad 8 to clear it', color: AMBER });
  }

  // Make a shared loop the current one: its drums, tempo, key and layers.
  load(loop) {
    const { seq } = this;
    if (seq.sigId !== loop.sig) seq.setSignature(loop.sig);
    const pattern = patternsFor(loop.sig).find((p) => p.name === loop.drums);
    if (pattern) seq.setPattern(pattern);
    // The whole drum setup, as the loop was made with it (older loops only kept the tempo).
    const { drums } = this.engine;
    if (loop.swing != null) seq.swing = loop.swing;
    if (loop.busy != null) seq.busy = loop.busy;
    const kit = KITS.findIndex((k) => k.name === loop.kit);
    if (kit >= 0) drums.setKit(kit);
    if (loop.drumTone != null) drums.setTone(loop.drumTone);
    if (loop.drumLevel != null) drums.setLevel(loop.drumLevel);
    if (loop.pump != null) this.engine.pump = loop.pump;
    seq.setBpm(loop.bpm); // last: it redraws the drum page with all of the above
    this.engine.syncEcho(seq.bpm);
    const [tonic, mode] = loop.key.split(' ');
    this.setKey(NOTE_NAMES.indexOf(tonic), mode);
    // Loops from before drumPhase was kept were nearly always recorded from stopped drums, after
    // a one-bar count-in.
    this.looper.restore({ ...loop, drumPhase: loop.drumPhase ?? loop.barSteps });
    this.slot = Number.isInteger(loop.slot) ? loop.slot : null;
    this.shared = JSON.stringify(this.snapshot());
    if (this.slot == null) {
      this.shared = ''; // from before loop memory: give it a key now
      this.send();
    }
  }

  // ---------- loop memory ----------

  async loadSlots() {
    try {
      this.slots = new Set((await (await fetch('/jam/loops', { cache: 'no-store' })).json()).slots);
    } catch {
      // An old server without loop memory: loops just aren't kept.
    }
  }

  // Hold pad 5 + a key: a key with a loop on it brings that loop back; any other key gets a copy
  // of the current loop (and from then on the loop's changes are saved there).
  async pick(note) {
    if (this.slots.has(note)) {
      if (note === this.slot) return bus.emit('hint', { text: `That's the loop you have now (${keyName(note)})`, color: AMBER });
      let loop;
      try {
        loop = await (await fetch(`/jam/loops/${note}.json`, { cache: 'no-store' })).json();
      } catch {
        return bus.emit('hint', { text: `Couldn't load the loop on ${keyName(note)}` });
      }
      const playing = this.seq.playing;
      this.stop(); // a solo belongs to the loop it was written for
      this.load(loop);
      if (playing) this.looper.resume(); // takes over at the next bar
      return bus.emit('hint', { text: `Loop from ${keyName(note)}${playing ? '' : ': pad 8 plays it'}`, color: AMBER });
    }
    if (!this.looper.layers.length) return bus.emit('hint', { text: `No loop on ${keyName(note)} yet` });
    this.slot = note;
    this.shared = '';
    this.send();
    bus.emit('hint', { text: `Loop saved on ${keyName(note)}`, color: AMBER });
  }

  // While pad 5 is held: which keys have loops, and which is playing now.
  slotView() {
    return { slots: [...this.slots], current: this.slot };
  }

  // ---------- sharing the loop ----------

  // Called whenever the loop, drums or key might have changed; sends it once things settle.
  share() {
    if (!this.looper.layers.length) {
      this.slot = null; // cleared: the next loop gets a key of its own
      this.shared = '';
    }
    clearTimeout(this.shareTimer);
    this.shareTimer = setTimeout(() => this.send(), SHARE_MS);
  }

  send() {
    const loop = this.snapshot();
    if (!loop) return; // an empty looper keeps the last loop there for Claude
    const text = JSON.stringify(loop);
    if (text === this.shared) return;
    this.shared = text;
    if (this.slot == null) this.claimSlot();
    if (this.slot != null) this.slots.add(this.slot);
    fetch('/jam/loop', { method: 'POST', body: JSON.stringify({ ...loop, slot: this.slot, saved: new Date().toISOString() }) })
      .catch(() => { this.shared = ''; });
  }

  // A brand-new loop goes on the lowest free key.
  claimSlot() {
    for (let n = FIRST_KEY; n <= LAST_KEY; n++) {
      if (this.slots.has(n)) continue;
      this.slot = n;
      bus.emit('hint', { text: `Loop saved on ${keyName(n)}`, color: AMBER });
      return;
    }
  }

  snapshot() {
    const { seq, looper } = this;
    if (!looper.layers.length) return null;
    const { id, barSteps, beatSteps } = seq.sig;
    const key = this.key();
    const { drums } = this.engine;
    return {
      bpm: seq.bpm, sig: id, barSteps, beatSteps, swing: seq.swing, drums: seq.pattern.name,
      kit: drums.kit.name, busy: seq.busy, drumTone: drums.toneAmount, drumLevel: drums.level, pump: this.engine.pump,
      drumPhase: looper.drumPhase,
      key: `${NOTE_NAMES[key.tonic]} ${key.mode}`,
      steps: looper.length, bars: looper.bars,
      // Each note: [step from the top of the loop (16ths), MIDI note, length in 16ths, velocity]
      layers: looper.layers.map((l) => ({
        sound: l.sound.preset.name,
        preset: l.sound.preset.id,
        muted: l.muted,
        notes: l.events.map((e) => [e.step, e.note, Math.round(e.len * 100) / 100, e.vel]).sort((a, b) => a[0] - b[0]),
      })),
    };
  }

  // ---------- receiving a solo ----------

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const res = await fetch(`/jam/solo?after=${this.after}`, { cache: 'no-store' });
      if (res.status === 200) {
        this.after = +res.headers.get('X-Written') || Date.now() / 1000;
        try {
          this.cue(this.parse(await res.json()));
        } catch (e) {
          console.warn('Claude\'s solo didn\'t make sense:', e);
          bus.emit('hint', { text: 'Claude\'s solo didn\'t load' });
        }
      }
    } catch {
      // Server not running, or an old one without the jam: try again next time.
    }
    this.polling = false;
  }

  parse(data) {
    const { barSteps, beatSteps } = this.seq.sig;
    const byStep = new Map();
    let end = 0;
    let prev = null;
    for (const [bar, beat, name, beats, ...rest] of data.notes) {
      const note = noteNumber(name);
      const vel = rest.find((x) => typeof x === 'number') ?? 96;
      const expr = { ...rest.find((x) => x && typeof x === 'object') };
      if (expr.slide && prev != null) expr.from = prev - note;
      prev = note;
      const at = (bar - 1) * barSteps + (beat - 1) * beatSteps;
      const len = beats * beatSteps;
      if (!(at >= 0 && len > 0 && note > 20 && note < 109)) throw new Error(`odd note: ${JSON.stringify([bar, beat, name, beats])}`);
      const step = Math.floor(at);
      if (!byStep.has(step)) byStep.set(step, []);
      byStep.get(step).push({ at, note, vel, len, expr: Object.keys(expr).length ? expr : null });
      end = Math.max(end, at + len);
    }
    if (!byStep.size) throw new Error('no notes');
    const preset = ALL_PRESETS.find((p) => p.id === data.sound) ?? ALL_PRESETS.find((p) => p.id === 'lead');
    // `fx` overrides the sound's own pedals and sends (drive, chorus, wobble, echo, reverb: 0..1).
    const fx = { ...preset.fx, ...data.fx };
    return { title: data.title || 'Claude', preset, fx, level: data.level ?? 1, byStep, steps: Math.ceil(end / barSteps) * barSteps };
  }

  // A new solo replaces any that's playing, and waits for the top of the loop.
  cue(solo) {
    this.stop();
    const sound = new Sound(this.engine, solo.preset, { values: solo.fx, level: solo.level });
    this.solo = { ...solo, sound, state: 'cued' };
    bus.emit('hint', { text: 'Claude has a solo: in at the top of the loop', color: solo.preset.color, sticky: true });
  }

  // Cut it off (replaced, or the loop went away).
  stop() {
    if (!this.solo) return;
    this.stopRecording(this.solo, 0);
    this.engine.dropSound(this.solo.sound);
    if (this.solo.state === 'cued') bus.emit('hint', null);
    this.solo = null;
  }

  // Played to the end: let the last notes ring out before unplugging its sound.
  finish() {
    const { sound } = this.solo;
    this.stopRecording(this.solo, 3000);
    this.solo = null;
    setTimeout(() => this.engine.dropSound(sound), 3000);
  }

  // ---------- recording ----------

  // Everything you hear (after the master compressor), from a bar before the solo comes in.
  startRecording(solo) {
    if (solo.recorder || !window.MediaRecorder) return;
    this.tap ??= this.engine.ctx.createMediaStreamDestination();
    if (!this.recorders++) this.engine.fx.comp.connect(this.tap); // two can overlap while one rings out
    const rec = new MediaRecorder(this.tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      if (!--this.recorders) this.engine.fx.comp.disconnect(this.tap);
      if (solo.state !== 'playing') return; // never got going
      fetch(`/jam/recording?name=${encodeURIComponent(solo.title)}`, { method: 'POST', body: new Blob(chunks, { type: 'audio/webm' }) })
        .catch((e) => console.warn('Couldn\'t save the recording:', e));
    };
    rec.start();
    solo.recorder = rec;
  }

  // Once the last notes and echoes have rung out.
  stopRecording(solo, afterMs) {
    const rec = solo.recorder;
    if (rec?.state === 'recording') setTimeout(() => rec.stop(), afterMs);
  }

  // The top of the loop (or of a bar, when it's just the drums).
  isTop(step) {
    const { looper } = this;
    if (looper.hasLoop) return AUDIBLE.includes(looper.state) && step >= looper.start && (step - looper.start) % looper.length === 0;
    return looper.state === 'empty' && step % this.seq.sig.barSteps === 0;
  }

  // ---------- playback: called by the sequencer for every scheduled step ----------

  onSchedule(step, t) {
    const s = this.solo;
    if (!s) return;
    if (s.state === 'cued') {
      if (this.isTop(step + this.seq.sig.barSteps)) this.startRecording(s);
      if (!this.isTop(step)) return;
      this.startRecording(s); // came in with less than a bar to go
      Object.assign(s, { state: 'playing', start: step, overLoop: this.looper.hasLoop });
      bus.emitAt(this.engine.ctx, t, 'hint', { text: s.title, color: s.preset.color });
    }
    const rel = step - s.start;
    if (rel < 0 || (s.overLoop && !AUDIBLE.includes(this.looper.state))) return this.stop();
    if (rel >= s.steps) return this.finish();
    const stepDur = this.seq.stepDur;
    for (const n of s.byStep.get(rel) || []) {
      this.engine.playNote(n.note, n.vel, s.sound, t + (n.at - rel) * stepDur, Math.max(0.03, n.len * stepDur - 0.01), n.expr);
    }
  }
}
