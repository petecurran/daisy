import { ColourChain, FXChain, makeNoiseBuffer } from './fx.js';
import { Voice } from './voice.js';
import { DrumKit } from '../drums/kit.js';
import { bus } from '../bus.js';

// Counts notes still fading out too: released notes keep sounding through their release tail, and
// hammering a key used to pile those up until the audio engine choked.
const MAX_VOICES = 32;

export class Engine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.noiseBuffer = makeNoiseBuffer(this.ctx);
    this.fx = new FXChain(this.ctx);
    this.voiceBus = this.ctx.createGain(); // all sounds' colour chains meet here (the pump ducks it)
    this.voiceBus.connect(this.fx.post);
    this.chains = new Map(); // preset id -> ColourChain
    this.presetMacros = new Map(); // preset id -> { brightness, resonance, release }

    // Drums skip the synth's chorus/wobble and go straight to the master, with their own room send.
    this.drums = new DrumKit(this.ctx, this.noiseBuffer, this.fx.master, this.fx.reverb);
    this.pump = 0;
    this.drums.onKick = (t, v) => this.duck(t, v);

    // Shared pitch modulation, patched into every voice's detune params.
    this.bend = this.ctx.createConstantSource();
    this.bend.offset.value = 0;
    this.bend.start();
    const vibLfo = this.ctx.createOscillator();
    vibLfo.frequency.value = 5.2;
    this.vibrato = this.ctx.createGain();
    this.vibrato.gain.value = 0;
    vibLfo.connect(this.vibrato);
    vibLfo.start();

    this.voices = new Map(); // note -> Voice (live playing)
    this.loopVoices = []; // voices started by the looper
    this.all = [];
    this.preset = null;
  }

  // Each sound keeps its own colour pedals and tone settings, so loop layers keep their sound.
  chainFor(preset) {
    let c = this.chains.get(preset.id);
    if (!c) {
      c = new ColourChain(this.ctx, this.noiseBuffer, this.voiceBus);
      c.set(preset.fx);
      this.chains.set(preset.id, c);
    }
    return c;
  }

  macrosFor(preset) {
    let m = this.presetMacros.get(preset.id);
    if (!m) this.presetMacros.set(preset.id, (m = { brightness: 0.5, resonance: 0.5, release: 0.5 }));
    return m;
  }

  get macros() { return this.macrosFor(this.preset); }
  get colour() { return this.chainFor(this.preset); }

  // 0..1 knob -> x0.2 .. x5, with 0.5 = preset's own sound.
  brightnessMult(preset = this.preset) {
    return Math.pow(5, (this.macrosFor(preset).brightness - 0.5) * 2);
  }

  setPreset(preset) {
    this.preset = preset;
    this.chainFor(preset);
    // The room (echo/reverb) is shared; it starts from the first sound's taste, then it's yours.
    if (!this.roomSet) {
      this.fx.set({ echo: preset.fx.echo, reverb: preset.fx.reverb });
      this.roomSet = true;
    }
  }

  // Make room for one more voice: drop finished ones, then steal the oldest fading one (or oldest).
  makeRoom() {
    const now = this.ctx.currentTime;
    this.all = this.all.filter((v) => v.end == null || v.end > now);
    while (this.all.length >= MAX_VOICES) {
      const i = this.all.findIndex((v) => v.end != null);
      this.all.splice(i >= 0 ? i : 0, 1)[0].kill();
    }
  }

  noteOn(note, velocity = 100) {
    if (!this.preset) return;
    const existing = this.voices.get(note);
    if (existing) existing.release(0.3);
    this.makeRoom();
    const v = new Voice(this, this.preset, note, velocity);
    this.voices.set(note, v);
    this.all.push(v);
    this.onLiveOn?.(note, velocity);
    bus.emit('note', { note, vel: velocity, preset: this.preset, loop: false });
  }

  // A note with a known start and length, in any preset: used by looper playback.
  playNote(note, velocity, preset, start, duration) {
    this.loopVoices = this.loopVoices.filter((v) => v.end > this.ctx.currentTime);
    this.makeRoom();
    const v = new Voice(this, preset, note, velocity, start);
    v.release(1, start + duration);
    this.all.push(v);
    this.loopVoices.push(v);
    bus.emitAt(this.ctx, start, 'note', { note, vel: velocity, preset, loop: true });
    bus.emitAt(this.ctx, start + duration, 'noteoff', { note, loop: true });
  }

  stopLoopVoices() {
    for (const v of this.loopVoices) v.kill();
    this.loopVoices = [];
  }

  noteOff(note) {
    const v = this.voices.get(note);
    if (!v) return;
    this.voices.delete(note);
    v.release(Math.pow(4, (this.macrosFor(v.preset).release - 0.5) * 2));
    this.onLiveOff?.(note);
    bus.emit('noteoff', { note });
  }

  allOff() {
    for (const note of [...this.voices.keys()]) this.noteOff(note);
  }

  // -1..1 -> +/- 2 semitones
  pitchBend(amount) {
    this.bend.offset.setTargetAtTime(amount * 200, this.ctx.currentTime, 0.01);
  }

  // 0..1 -> vibrato depth in cents
  modWheel(amount) {
    this.vibrato.gain.setTargetAtTime(amount * 40, this.ctx.currentTime, 0.02);
  }

  setMacro(name, value) {
    this.macros[name] = value;
    const live = this.all.filter((v) => v.preset === this.preset && !v.killed);
    if (name === 'brightness') live.forEach((v) => v.applyCutoff());
    if (name === 'resonance') live.forEach((v) => v.applyResonance());
  }

  // Sidechain-style "pump": each kick briefly ducks the synth, which then breathes back in.
  duck(t, v) {
    if (!this.pump) return;
    const g = this.voiceBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1 - this.pump * 0.75 * v, t + 0.005);
    g.setTargetAtTime(1, t + 0.02, 0.09);
  }

  // Tape echo locked to the drum tempo (a dotted eighth).
  syncEcho(bpm) {
    this.fx.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), this.ctx.currentTime, 0.1);
  }

  latencyMs() {
    return {
      base: (this.ctx.baseLatency || 0) * 1000,
      output: (this.ctx.outputLatency || 0) * 1000,
    };
  }
}
