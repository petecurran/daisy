import { FXChain, makeNoiseBuffer } from './fx.js';
import { Voice } from './voice.js';
import { DrumKit } from '../drums/kit.js';

const MAX_VOICES = 28;

export class Engine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.noiseBuffer = makeNoiseBuffer(this.ctx);
    this.voiceBus = this.ctx.createGain();
    this.fx = new FXChain(this.ctx, this.noiseBuffer);
    this.voiceBus.connect(this.fx.input);

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

    this.macros = { brightness: 0.5, resonance: 0.5, release: 0.5 };
    this.voices = new Map(); // note -> Voice (live playing)
    this.loopVoices = []; // voices started by the looper
    this.all = [];
    this.preset = null;
  }

  // 0..1 knob -> x0.2 .. x5, with 0.5 = preset's own sound.
  brightnessMult() {
    return Math.pow(5, (this.macros.brightness - 0.5) * 2);
  }

  setPreset(preset) {
    this.preset = preset;
    this.fx.set(preset.fx);
  }

  noteOn(note, velocity = 100) {
    if (!this.preset) return;
    const existing = this.voices.get(note);
    if (existing) existing.release(0.3);
    this.all = this.all.filter((v) => !v.done);
    if (this.all.length >= MAX_VOICES) this.all.shift().kill();
    const v = new Voice(this, this.preset, note, velocity);
    this.voices.set(note, v);
    this.all.push(v);
    this.onLiveOn?.(note, velocity);
  }

  // A note with a known start and length, in any preset: used by looper playback.
  playNote(note, velocity, preset, start, duration) {
    this.all = this.all.filter((v) => !v.done || v.loopEnd > this.ctx.currentTime);
    this.loopVoices = this.loopVoices.filter((v) => v.loopEnd > this.ctx.currentTime);
    const live = this.all.filter((v) => !v.done);
    if (live.length >= MAX_VOICES) live[0].kill();
    const v = new Voice(this, preset, note, velocity, start);
    v.release(1, start + duration);
    v.done = false; // still sounding until its scheduled release
    v.loopEnd = start + duration;
    this.all.push(v);
    this.loopVoices.push(v);
  }

  stopLoopVoices() {
    for (const v of this.loopVoices) v.kill();
    this.loopVoices = [];
  }

  noteOff(note) {
    const v = this.voices.get(note);
    if (!v) return;
    this.voices.delete(note);
    v.release(Math.pow(4, (this.macros.release - 0.5) * 2));
    this.onLiveOff?.(note);
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
    const live = this.all.filter((v) => !v.done);
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
