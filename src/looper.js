// Pedal-style note looper, locked to the drum transport.
//
// One button (pad 8), like a Boss RC-1:
//   tap        empty -> record (from the next bar) -> play -> overdub (from the top of the loop)
//              -> play -> ...
//   double-tap stop (keeps the loop; tap again to restart from the next bar)
//   hold       undo the last layer (or clear everything when stopped)
//
// It records the notes the synth actually plays (after the chord engine): starts snapped to 16th
// steps, lengths kept exactly as played (so short arp notes stay crisp).
//
// Each layer plays through a sound of its own (engine.loopSound: preset, knob settings and channel
// strip). While a take is being recorded its sound follows the live sound and knobs; once it's
// locked in, nothing you do to the live sound touches it. The whole loop has one level (the Loop
// knob), so it can be pulled down while you play a new layer over it.

import { ALL_PRESETS } from './audio/presets.js';

const DOUBLE_TAP_MS = 350;
const HOLD_MS = 650;

let nextId = 1;

export class Looper {
  constructor(engine, seq, { onState } = {}) {
    this.engine = engine;
    this.seq = seq;
    this.onState = onState;
    this.state = 'empty'; // empty | armed | recording | playing | cued | overdub | stopped
    this.layers = [];
    this.current = null; // layer being recorded
    this.start = 0; // global step where the loop begins
    this.length = 0; // loop length in steps
    this.pending = new Map(); // note -> { pos, vel }
    this.sounding = new Map(); // live notes held right now: note -> vel
    this.lastTap = { time: 0, action: null };
    this.pos = 0;

    engine.onLiveOn = (note, vel, strike) => this.liveOn(note, vel, strike);
    engine.onLiveOff = (note) => this.liveOff(note);
  }

  get hasLoop() { return this.length > 0; }
  get bars() { return this.length / this.seq.sig.barSteps; }

  // ---------- the one-button pedal ----------

  padDown() {
    this.held = false;
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.held = true;
      this.hold();
    }, HOLD_MS);
  }

  padUp() {
    clearTimeout(this.holdTimer);
    if (!this.held) this.tap();
  }

  tap() {
    const now = performance.now();
    if (now - this.lastTap.time < DOUBLE_TAP_MS && this.lastTap.action) {
      this.lastTap = { time: 0, action: null };
      return this.doubleTap();
    }
    const action = this.singleTap();
    this.lastTap = { time: now, action };
  }

  singleTap() {
    switch (this.state) {
      case 'empty': return this.arm();
      case 'armed':
      case 'recording': return this.close();
      case 'playing': return this.cueOverdub();
      case 'cued': this.dropTake(); this.setState('playing'); return 'cancel';
      case 'overdub': return this.endOverdub();
      case 'stopped': return this.resume();
    }
  }

  // Second tap undoes whatever the first tap just started, then stops.
  doubleTap() {
    if (this.state === 'overdub' || this.state === 'cued') this.dropTake();
    if (this.state === 'armed' || this.state === 'recording') return this.clear();
    this.stop();
  }

  hold() {
    if (this.state === 'stopped' || this.state === 'armed' || this.state === 'recording') return this.clear();
    this.undo();
  }

  // ---------- actions ----------

  arm() {
    if (!this.seq.playing) {
      this.start = this.resumeBar() + this.seq.sig.barSteps; // the first bar is a count-in
      this.seq.start();
    } else {
      this.start = this.seq.nextBarStep();
    }
    this.newTake();
    this.setState('armed');
    return 'arm';
  }

  close() {
    const rel = this.nowPos() - this.start;
    if (rel <= 1) return this.clear(); // closed before anything began
    const bar = this.seq.sig.barSteps;
    // Round to whole bars; a tap slightly late (first quarter of a bar) still closes the bar before.
    const bars = Math.max(1, Math.ceil(rel / bar - 0.25));
    this.length = bars * bar;
    this.finishPending();
    this.current.events = this.current.events.map((e) => ({ ...e, step: e.step % this.length }));
    this.commit();
    this.setState('playing');
    this.catchUp();
    return 'close';
  }

  // A new layer waits for the top of the loop, like the first take waits for the bar.
  cueOverdub() {
    this.newTake();
    this.layerStart = this.start + Math.ceil((this.seq.step - this.start) / this.length) * this.length;
    this.setState('cued');
    return 'cue';
  }

  endOverdub() {
    this.finishPending();
    this.commit();
    this.setState('playing');
    return 'endOverdub';
  }

  resume() {
    if (!this.seq.playing) {
      this.start = this.resumeBar();
      this.seq.start();
    } else {
      this.start = this.seq.nextBarStep();
    }
    this.setState('playing');
    return 'resume';
  }

  // The first bar line the transport will reach once started: the top if it's stopped, the next
  // bar if it's paused part-way through one (it carries on from where it was paused).
  resumeBar() {
    const bar = this.seq.sig.barSteps;
    return this.seq.paused ? Math.ceil(this.seq.step / bar) * bar : 0;
  }

  stop() {
    this.dropTake();
    this.engine.stopLoopVoices();
    this.setState(this.hasLoop ? 'stopped' : 'empty');
  }

  undo() {
    if (this.state === 'overdub' || this.state === 'cued') {
      this.dropTake();
      this.setState('playing');
    } else {
      const last = this.layers.pop();
      if (last) this.engine.dropSound(last.sound);
      if (!this.layers.length) return this.clear();
      this.setState(this.state);
    }
  }

  clear() {
    this.dropTake();
    for (const l of this.layers) this.engine.dropSound(l.sound);
    this.layers = [];
    this.length = 0;
    this.engine.stopLoopVoices();
    this.engine.setLoopLevel(1); // a fresh loop starts at full level
    this.setState('empty');
  }

  // Bring back a shared loop (jam/loop.json) after a reload, stopped: tap to play it.
  restore({ steps, layers }) {
    this.clear();
    for (const l of layers) {
      const preset = ALL_PRESETS.find((p) => p.id === l.preset) ?? ALL_PRESETS.find((p) => p.name === l.sound);
      if (!preset || !l.notes.length) continue;
      const layer = {
        id: nextId++, sound: this.engine.loopSound(this.engine.liveSound(preset)), muted: l.muted, byStep: new Map(),
        events: l.notes.map(([step, note, len, vel]) => ({ step, note, len, vel })),
        get preset() { return this.sound.preset; },
      };
      if (layer.muted) this.engine.setMuted(layer.sound, true);
      this.index(layer);
      this.layers.push(layer);
    }
    if (!this.layers.length) return;
    this.length = steps;
    this.setState('stopped');
  }

  // ---------- layers ----------

  // A take: the layer being recorded. Its sound follows the live one until it's locked in.
  newTake() {
    this.dropTake();
    const sound = this.engine.loopSound();
    this.engine.follow(sound);
    this.current = {
      id: nextId++, sound, events: [], muted: false, byStep: new Map(),
      get preset() { return this.sound.preset; },
    };
  }

  // Throw the take away (cancelled, undone, or stopped before it was kept).
  dropTake() {
    if (this.current) this.engine.dropSound(this.current.sound);
    this.current = null;
    this.pending.clear();
  }

  // Lock the take in as a layer: from now on its sound is fixed.
  commit() {
    const layer = this.current;
    this.current = null;
    if (!layer) return;
    this.engine.follow(null);
    if (!layer.events.length) return this.engine.dropSound(layer.sound);
    this.index(layer);
    this.layers.push(layer);
  }

  index(layer) {
    layer.byStep = new Map();
    for (const e of layer.events) {
      if (!layer.byStep.has(e.step)) layer.byStep.set(e.step, []);
      layer.byStep.get(e.step).push(e);
    }
  }

  // Re-voice a layer with another sound (as that sound is set up live right now).
  setLayerPreset(id, preset) {
    const l = this.layers.find((l) => l.id === id);
    if (!l) return;
    this.engine.dropSound(l.sound);
    l.sound = this.engine.loopSound(this.engine.liveSound(preset));
    if (l.muted) this.engine.setMuted(l.sound, true);
    this.onState?.();
  }

  toggleMute(id) {
    const l = this.layers.find((l) => l.id === id);
    if (!l) return;
    l.muted = !l.muted;
    this.engine.setMuted(l.sound, l.muted); // silences its notes that are already sounding too
    this.onState?.();
  }

  removeLayer(id) {
    const l = this.layers.find((l) => l.id === id);
    if (!l) return;
    this.engine.dropSound(l.sound);
    this.layers = this.layers.filter((x) => x !== l);
    if (!this.layers.length && this.state !== 'overdub') return this.clear();
    this.onState?.();
  }

  // ---------- recording ----------

  // The player hears everything a little after it's scheduled, so they play along to the past.
  nowPos() {
    const ctx = this.engine.ctx;
    const heardLag = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    return this.seq.posAt(ctx.currentTime - heardLag);
  }

  recording() {
    return this.current && ['armed', 'recording', 'cued', 'overdub'].includes(this.state);
  }

  // Where the take being recorded begins: the first bar, or the top of the loop for a new layer.
  get takeStart() {
    if (this.state === 'armed' || this.state === 'recording') return this.start;
    if (this.state === 'cued' || this.state === 'overdub') return this.layerStart;
    return null;
  }

  liveOn(note, vel, strike) {
    this.sounding.set(note, vel);
    if (!this.recording() || !this.seq.playing) return;
    // The notes of one strummed chord (spread over ~50 ms) share the first one's timing, so a
    // chord never gets split across two 16ths.
    let pos = this.nowPos();
    if (strike != null && this.lastStrike?.id === strike) pos = this.lastStrike.pos;
    else this.lastStrike = { id: strike, pos };
    // Up to an eighth note early still counts as the first beat (it gets pulled onto it); anything
    // earlier is the count-in, though if it's still held when recording starts it's caught then.
    const waiting = this.state === 'armed' || this.state === 'cued';
    if (waiting && pos < this.takeStart - this.seq.sig.beatSteps / 2) return;
    this.pending.set(note, { pos, vel });
  }

  // Notes already held when recording (or a new layer) starts are part of the take from its start.
  catchHeld(pos) {
    for (const [note, vel] of this.sounding) if (!this.pending.has(note)) this.pending.set(note, { pos, vel });
  }

  liveOff(note) {
    this.sounding.delete(note);
    const p = this.pending.get(note);
    if (!p || !this.recording()) return;
    this.pending.delete(note);
    this.addEvent(note, p, this.nowPos());
  }

  finishPending() {
    const end = this.nowPos();
    for (const [note, p] of this.pending) this.addEvent(note, p, end);
    this.pending.clear();
  }

  addEvent(note, { pos, vel }, endPos) {
    const len = Math.max(0.1, endPos - pos); // in steps, exactly as long as it was held
    // A note played early, or within the first 16th of a take (coming in a hair late), lands on
    // the take's first beat.
    const from = this.takeStart;
    if (from != null && pos - from < 1) pos = from;
    const on = Math.round(pos - this.start);
    const step = this.length ? ((on % this.length) + this.length) % this.length : on;
    const e = { step, note, vel, len: this.length ? Math.min(len, this.length) : len };
    this.current.events.push(e);
    // Overdubs are heard on the next pass round the loop.
    if (this.state === 'overdub' || this.state === 'cued') {
      if (!this.current.byStep.has(step)) this.current.byStep.set(step, []);
      this.current.byStep.get(step).push(e);
    }
  }

  // ---------- playback: called by the sequencer for every scheduled step ----------

  onSchedule(step, t) {
    if (this.state === 'armed' && step >= this.start) {
      this.catchHeld(this.start);
      this.setState('recording');
    }
    if (this.state === 'cued' && step >= this.layerStart) {
      this.catchHeld(this.layerStart);
      this.setState('overdub');
    }
    if (!this.hasLoop || !(this.state === 'playing' || this.state === 'overdub')) return;
    if (step < this.start) return;
    this.playStep(step, t);
  }

  // The sequencer schedules a little ahead, so by the time the loop is closed (often with a tap
  // that's a touch late) its first step may already have gone by without it. Play those now:
  // on time if they're still ahead, straight away if they're only just late.
  catchUp() {
    const { seq } = this;
    const ctx = this.engine.ctx;
    for (let step = this.start + this.length; step < seq.step; step++) {
      const t = seq.nextTime - (seq.step - step) * seq.stepDur;
      if (t > ctx.currentTime - 0.25) this.playStep(step, Math.max(t, ctx.currentTime + 0.005));
    }
  }

  playStep(step, t) {
    const pos = (step - this.start) % this.length;
    this.pos = pos;
    const stepDur = this.seq.stepDur;
    const layers = this.current && this.state === 'overdub' ? [...this.layers, this.current] : this.layers;
    for (const layer of layers) {
      if (layer.muted) continue;
      for (const e of layer.byStep.get(pos) || []) {
        this.engine.playNote(e.note, e.vel, layer.sound, t, Math.max(0.02, e.len * stepDur - 0.01));
      }
    }
  }

  setState(s) {
    this.state = s;
    this.onState?.();
  }
}
