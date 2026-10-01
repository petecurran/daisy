// Pedal-style note looper, locked to the drum transport.
//
// One button (pad 8), like a Boss RC-1:
//   tap        empty -> record (from the next bar)  -> play -> overdub -> play -> ...
//   double-tap stop (keeps the loop; tap again to restart from the next bar)
//   hold       undo the last layer (or clear everything when stopped)
//
// It records the notes the synth actually plays (after the chord engine), snapped to 16th steps.
// Each layer remembers the sound it was played with, and can be switched later.

const DOUBLE_TAP_MS = 350;
const HOLD_MS = 650;

let nextId = 1;

export class Looper {
  constructor(engine, seq, { onState } = {}) {
    this.engine = engine;
    this.seq = seq;
    this.onState = onState;
    this.state = 'empty'; // empty | armed | recording | playing | overdub | stopped
    this.layers = [];
    this.current = null; // layer being recorded
    this.start = 0; // global step where the loop begins
    this.length = 0; // loop length in steps
    this.pending = new Map(); // note -> { pos, vel }
    this.sounding = new Map(); // live notes held right now: note -> vel
    this.lastTap = { time: 0, action: null };
    this.pos = 0;

    engine.onLiveOn = (note, vel) => this.liveOn(note, vel);
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
      case 'playing': return this.beginOverdub();
      case 'overdub': return this.endOverdub();
      case 'stopped': return this.resume();
    }
  }

  // Second tap undoes whatever the first tap just started, then stops.
  doubleTap() {
    if (this.state === 'overdub') this.current = null;
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
      this.seq.start(); // the first bar is a count-in
      this.start = this.seq.sig.barSteps;
    } else {
      this.start = this.seq.nextBarStep();
    }
    this.current = this.newLayer();
    this.pending.clear();
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

  beginOverdub() {
    this.current = this.newLayer();
    this.pending.clear();
    this.catchHeld(this.nowPos());
    this.setState('overdub');
    return 'overdub';
  }

  endOverdub() {
    this.finishPending();
    this.commit();
    this.setState('playing');
    return 'endOverdub';
  }

  resume() {
    if (!this.seq.playing) {
      this.seq.start();
      this.start = 0;
    } else {
      this.start = this.seq.nextBarStep();
    }
    this.setState('playing');
    return 'resume';
  }

  stop() {
    this.current = null;
    this.pending.clear();
    this.engine.stopLoopVoices();
    this.setState(this.hasLoop ? 'stopped' : 'empty');
  }

  undo() {
    if (this.state === 'overdub') {
      this.current = null;
      this.pending.clear();
      this.setState('playing');
    } else {
      this.layers.pop();
      this.engine.stopLoopVoices();
      if (!this.layers.length) return this.clear();
      this.setState(this.state);
    }
  }

  clear() {
    this.layers = [];
    this.current = null;
    this.length = 0;
    this.pending.clear();
    this.engine.stopLoopVoices();
    this.setState('empty');
  }

  // ---------- layers ----------

  newLayer() {
    return { id: nextId++, preset: this.engine.preset, events: [], muted: false, byStep: new Map() };
  }

  commit() {
    const layer = this.current;
    this.current = null;
    if (!layer || !layer.events.length) return;
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

  setLayerPreset(id, preset) {
    const l = this.layers.find((l) => l.id === id);
    if (l) l.preset = preset;
    this.onState?.();
  }

  toggleMute(id) {
    const l = this.layers.find((l) => l.id === id);
    if (l) l.muted = !l.muted;
    this.onState?.();
  }

  removeLayer(id) {
    this.layers = this.layers.filter((l) => l.id !== id);
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
    return this.current && (this.state === 'armed' || this.state === 'recording' || this.state === 'overdub');
  }

  liveOn(note, vel) {
    this.sounding.set(note, vel);
    if (!this.recording() || !this.seq.playing) return;
    // Notes struck together (a strummed chord spreads them over ~50 ms) share the first one's
    // timing, so a chord never gets split across two 16ths.
    const now = performance.now();
    if (!this.lastOn || now - this.lastOn.at > 80) this.lastOn = { at: now, pos: this.nowPos() };
    const pos = this.lastOn.pos;
    // Up to an eighth note early still counts as the first beat (it gets pulled onto it); anything
    // earlier is the count-in, though if it's still held when recording starts it's caught then.
    if (this.state === 'armed' && pos < this.start - this.seq.sig.beatSteps / 2) return;
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
    let on = Math.round(pos - this.start);
    // First take: a note played early, or within the first 16th (coming in a hair late), lands on
    // the first beat.
    if (!this.length && pos - this.start < 1) on = 0;
    const len = Math.max(1, Math.round(endPos - this.start) - on);
    const step = this.length ? ((on % this.length) + this.length) % this.length : on;
    const e = { step, note, vel, len: this.length ? Math.min(len, this.length) : len };
    this.current.events.push(e);
    // Overdubs are heard on the next pass round the loop.
    if (this.state === 'overdub') {
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
        this.engine.playNote(e.note, e.vel, layer.preset, t, e.len * stepDur - 0.01);
      }
    }
  }

  setState(s) {
    this.state = s;
    this.onState?.();
  }
}
