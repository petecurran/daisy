// Jamming with Claude. daisy shares the loop with a Claude chat through the local server
// (jam/loop.json), and plays whatever solo comes back (jam/solo.json) from the top of the loop.
// The chat side lives in .claude/skills/solo.
//
// A solo is a list of notes, each [bar, beat, note, beats, velocity?, expression?]: bar and beat
// count from 1 at the top of the loop (beats in the time signature's pulse), note is a MIDI number
// or a name like "E4", and expression is { from, slide, bend, release, vib } (see Voice.express).

import { ALL_PRESETS } from './audio/presets.js';
import { Sound } from './audio/sound.js';
import { NOTE_NAMES } from './chords.js';
import { bus } from './bus.js';

const POLL_MS = 1000;
const SHARE_MS = 400;
const AUDIBLE = ['playing', 'cued', 'overdub']; // looper states where the loop is going round
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// "F#4" -> 66 (middle C is C4).
function noteNumber(name) {
  if (typeof name === 'number') return name;
  const m = /^([A-G])(#|b|♯|♭)?(-?\d)$/.exec(String(name).trim());
  if (!m) throw new Error(`not a note: ${name}`);
  const acc = { '#': 1, '♯': 1, b: -1, '♭': -1 }[m[2]] ?? 0;
  return 12 * (+m[3] + 1) + PITCH[m[1]] + acc;
}

export class Jam {
  constructor(engine, seq, looper, { key }) {
    this.engine = engine;
    this.seq = seq;
    this.looper = looper;
    this.key = key;
    this.solo = null; // { title, sound, byStep, steps, state: 'cued' | 'playing', start, overLoop }
    this.after = Date.now() / 1000; // only solos written from now on (not one left from last time)
    this.shared = '';
    setInterval(() => this.poll(), POLL_MS);
  }

  // ---------- sharing the loop ----------

  // Called whenever the loop, drums or key might have changed; sends it once things settle.
  share() {
    clearTimeout(this.shareTimer);
    this.shareTimer = setTimeout(() => this.send(), SHARE_MS);
  }

  send() {
    const loop = this.snapshot();
    if (!loop) return; // an empty looper keeps the last loop there for Claude
    const text = JSON.stringify(loop);
    if (text === this.shared) return;
    this.shared = text;
    fetch('/jam/loop', { method: 'POST', body: JSON.stringify({ ...loop, saved: new Date().toISOString() }) })
      .catch(() => { this.shared = ''; });
  }

  snapshot() {
    const { seq, looper } = this;
    if (!looper.layers.length) return null;
    const { id, barSteps, beatSteps } = seq.sig;
    const key = this.key();
    return {
      bpm: seq.bpm, sig: id, barSteps, beatSteps, swing: seq.swing, drums: seq.pattern.name,
      key: `${NOTE_NAMES[key.tonic]} ${key.mode}`,
      steps: looper.length, bars: looper.bars,
      // Each note: [step from the top of the loop (16ths), MIDI note, length in 16ths, velocity]
      layers: looper.layers.map((l) => ({
        sound: l.sound.preset.name,
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
    return { title: data.title || 'Claude', preset, level: data.level ?? 1, byStep, steps: Math.ceil(end / barSteps) * barSteps };
  }

  // A new solo replaces any that's playing, and waits for the top of the loop.
  cue(solo) {
    this.stop();
    const sound = new Sound(this.engine, solo.preset, { level: solo.level });
    this.solo = { ...solo, sound, state: 'cued' };
    bus.emit('hint', { text: 'Claude has a solo: in at the top of the loop', color: solo.preset.color, sticky: true });
  }

  // Cut it off (replaced, or the loop went away).
  stop() {
    if (!this.solo) return;
    this.engine.dropSound(this.solo.sound);
    if (this.solo.state === 'cued') bus.emit('hint', null);
    this.solo = null;
  }

  // Played to the end: let the last notes ring out before unplugging its sound.
  finish() {
    const { sound } = this.solo;
    this.solo = null;
    setTimeout(() => this.engine.dropSound(sound), 3000);
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
      if (!this.isTop(step)) return;
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
