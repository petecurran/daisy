import { FXChain, makeNoiseBuffer } from './fx.js';
import { Sound } from './sound.js';
import { Voice } from './voice.js';
import { DrumKit } from '../drums/kit.js';
import { bus } from '../bus.js';

// Every note still sounding, live or looped, counts, including ones fading out after release.
// Past this the oldest note is stolen, so however many keys go down at once the audio thread
// never has more than this to render.
const MAX_VOICES = 32;

export class Engine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.noiseBuffer = makeNoiseBuffer(this.ctx);
    // One noise source shared by every voice's breath and every strip's tape hiss.
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = this.noiseBuffer;
    this.noise.loop = true;
    this.noise.start();
    this.fx = new FXChain(this.ctx);

    // Drums skip the synth strips and go straight to the master, with their own room send.
    this.drums = new DrumKit(this.ctx, this.noiseBuffer, this.fx.master, this.fx.reverb);
    this.pump = 0;
    this.drums.onKick = (t, v) => this.duck(t, v);

    // Pitch bend and vibrato (notes mode only), patched into the live voices' detune params.
    this.bend = this.ctx.createConstantSource();
    this.bend.offset.value = 0;
    this.bend.start();
    const vibLfo = this.ctx.createOscillator();
    vibLfo.frequency.value = 5.2;
    this.vibrato = this.ctx.createGain();
    this.vibrato.gain.value = 0;
    vibLfo.connect(this.vibrato);
    vibLfo.start();
    this.expressive = false;

    this.live = new Map(); // preset id -> its live Sound
    this.sound = null; // the live sound the keys play
    this.room = null; // echo/reverb: shared by all the live sounds
    this.loopSounds = new Set(); // loop layers' sounds (all at the loop level)
    this.loopLevel = 1;
    this.follower = null; // the layer being recorded: follows the knobs until it's locked in

    this.voices = new Map(); // note -> Voice (live playing)
    this.all = []; // every voice still sounding, oldest first
  }

  get preset() { return this.sound?.preset; }

  liveSound(preset) {
    let s = this.live.get(preset.id);
    if (!s) {
      // The room starts from the first sound's taste, then it's yours.
      this.room ??= { echo: preset.fx.echo, reverb: preset.fx.reverb };
      s = new Sound(this, preset, { values: { ...preset.fx, ...this.room } });
      this.live.set(preset.id, s);
    }
    return s;
  }

  setPreset(preset) {
    this.sound = this.liveSound(preset);
    this.syncFollower();
  }

  // Knobs: tone macros and colour pedals belong to the current sound; echo/reverb to the room.
  setMacro(name, value) {
    this.sound.macros[name] = value;
    this.retune(this.sound);
    this.syncFollower();
  }

  setPedal(key, value) {
    if (key === 'echo' || key === 'reverb') {
      this.room[key] = value;
      for (const s of this.live.values()) s.strip.set({ [key]: value });
    } else {
      this.sound.strip.set({ [key]: value });
    }
    this.syncFollower();
  }

  // Notes already sounding in this sound pick up its brightness/resonance.
  retune(sound) {
    for (const v of this.all) if (v.sound === sound && !v.killed) v.retune();
  }

  // ---------- loop layers' sounds ----------

  loopSound(from = this.sound) {
    const s = from.copy(this.loopLevel);
    this.loopSounds.add(s);
    return s;
  }

  follow(sound) {
    this.follower = sound;
    this.syncFollower();
  }

  syncFollower() {
    if (!this.follower || !this.sound) return;
    this.follower.follow(this.sound);
    this.retune(this.follower);
  }

  // A layer is gone: silence it and unplug its strip once the notes have faded.
  dropSound(sound) {
    if (this.follower === sound) this.follower = null;
    this.loopSounds.delete(sound);
    for (const v of this.all) if (v.sound === sound) v.kill();
    setTimeout(() => sound.strip.dispose(), 300);
  }

  setLoopLevel(v) {
    this.loopLevel = v;
    for (const s of this.loopSounds) if (!s.muted) s.strip.fade(v);
  }

  setMuted(sound, muted) {
    sound.muted = muted;
    sound.strip.fade(muted ? 0 : this.loopLevel, 0.02);
  }

  // ---------- notes ----------

  // Make room for one more voice: forget finished ones, then steal: same kind (live/loop) first,
  // a fading one before a held one, oldest first.
  makeRoom(loop) {
    const now = this.ctx.currentTime;
    this.all = this.all.filter((v) => v.end == null || v.end > now);
    let count = 0;
    for (const v of this.all) if (!v.killed) count++;
    while (count >= MAX_VOICES) {
      const pick = (fn) => this.all.find((v) => !v.killed && fn(v));
      const v = pick((v) => v.loop === loop && v.done) ?? pick((v) => v.loop === loop) ?? pick((v) => v.done) ?? pick(() => true);
      v.kill();
      count--;
    }
  }

  // `strike` groups the notes of one strummed chord (so the looper keeps them together).
  noteOn(note, velocity = 100, strike) {
    if (!this.sound) return;
    this.voices.get(note)?.release(0.3);
    this.makeRoom(false);
    const v = new Voice(this, this.sound, note, velocity, null, this.expressive);
    this.voices.set(note, v);
    this.all.push(v);
    this.onLiveOn?.(note, velocity, strike);
    bus.emit('note', { note, vel: velocity, preset: this.sound.preset, loop: false });
  }

  noteOff(note) {
    const v = this.voices.get(note);
    if (!v) return;
    this.voices.delete(note);
    v.release(v.sound.releaseMult);
    this.onLiveOff?.(note);
    bus.emit('noteoff', { note });
  }

  allOff() {
    for (const note of [...this.voices.keys()]) this.noteOff(note);
  }

  // A note with a known start and length, in a loop layer's sound: looper playback (and Claude's
  // solos, which can bend and slide: see Voice.express).
  playNote(note, velocity, sound, start, duration, expression) {
    this.makeRoom(true);
    const v = new Voice(this, sound, note, velocity, start, false);
    if (expression) v.express(expression, Math.max(start, this.ctx.currentTime), duration);
    v.loop = true;
    v.release(sound.releaseMult, start + duration);
    this.all.push(v);
    bus.emitAt(this.ctx, start, 'note', { note, vel: velocity, preset: sound.preset, loop: true });
    bus.emitAt(this.ctx, start + duration, 'noteoff', { note, loop: true });
  }

  stopLoopVoices() {
    for (const v of this.all) if (v.loop) v.kill();
  }

  // Notes mode bends and wobbles the live notes; chords mode uses the joystick for chords, so its
  // notes skip that wiring (it costs the audio thread on every oscillator).
  setExpressive(on) {
    this.expressive = on;
    this.pitchBend(0);
    this.modWheel(0);
  }

  // -1..1 -> +/- 2 semitones
  pitchBend(amount) {
    this.bend.offset.setTargetAtTime(amount * 200, this.ctx.currentTime, 0.01);
  }

  // 0..1 -> vibrato depth in cents
  modWheel(amount) {
    this.vibrato.gain.setTargetAtTime(amount * 40, this.ctx.currentTime, 0.02);
  }

  // Sidechain-style "pump": each kick briefly ducks the synth, which then breathes back in.
  duck(t, v) {
    if (!this.pump) return;
    for (const { gain: g } of this.fx.synthInputs) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(1 - this.pump * 0.75 * v, t + 0.005);
      g.setTargetAtTime(1, t + 0.02, 0.09);
    }
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
