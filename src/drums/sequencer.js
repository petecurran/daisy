import { PATTERNS, SIGNATURES, patternsFor } from './patterns.js';

const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead of time
const TICK_MS = 25;
const GROOVE_SOUNDS = new Set(['chh', 'ohh', 'shaker', 'rim', 'bell']); // what's left during a Break

// Schedules patterns against the audio clock (not setTimeout), so timing stays tight even when
// the page is busy. Busy/Swing/Fill/Break shape the pattern live.
export class Sequencer {
  constructor(ctx, kit, { onStep, onState } = {}) {
    this.ctx = ctx;
    this.kit = kit;
    this.onStep = onStep;
    this.onState = onState;
    this.bpm = 92;
    this.busy = 0.5;
    this.swing = 0;
    this.playing = false; // the transport (clock) is running
    this.drumsMuted = false; // transport keeps running for the looper, drums silent
    this.breakHeld = false;
    this.fillQueued = false;
    this.fill = null;
    this.crashNext = false;
    this.taps = [];
    this.setSignature('4/4');
  }

  get sig() { return SIGNATURES.find((s) => s.id === this.sigId); }
  get stepDur() { return 60 / this.bpm / 4; }
  get threshold() { return 9 - this.busy * 8; }

  setSignature(id) {
    this.sigId = id;
    this.setPattern(patternsFor(id)[0]);
  }

  shiftSignature(dir) {
    const i = SIGNATURES.findIndex((s) => s.id === this.sigId);
    this.setSignature(SIGNATURES[(i + dir + SIGNATURES.length) % SIGNATURES.length].id);
  }

  setPattern(p) {
    this.pattern = p;
    this.swing = p.swing;
    this.length = Object.values(p.tracks)[0].length;
    this.onState?.();
  }

  // Step through patterns in the current time signature.
  shiftPattern(dir) {
    const list = patternsFor(this.sigId);
    const i = list.indexOf(this.pattern);
    this.setPattern(list[(i + dir + list.length) % list.length]);
  }

  // From the top (or from step `from`), or after a pause from exactly where it was frozen.
  start(from = 0) {
    if (this.playing) return;
    this.playing = true;
    if (!this.paused) this.step = from;
    this.paused = false;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.onStart?.(this.nextTime);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.onState?.();
  }

  // Freeze on the spot: the loop and the bar position wait here until start().
  pause() {
    if (!this.playing) return;
    this.stop();
    this.paused = true;
    this.onState?.();
  }

  stop() {
    this.playing = false;
    this.paused = false;
    this.drumsMuted = false;
    clearInterval(this.timer);
    this.fill = null;
    this.fillQueued = false;
    this.onState?.();
  }

  toggle() { this.playing ? this.stop() : this.start(); }

  queueFill() { this.fillQueued = true; this.onState?.(); }

  tap() {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 5) this.taps.shift();
    if (this.taps.length >= 2) {
      const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      this.setBpm(60000 / avg);
    }
  }

  setBpm(bpm) {
    this.bpm = Math.max(50, Math.min(180, Math.round(bpm)));
    this.onState?.();
  }

  tick() {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  scheduleStep(step, time) {
    const { barSteps } = this.sig;
    const inBar = step % barSteps;
    const fillLen = barSteps >= 16 ? 8 : 6;

    // Fills always land on the end of a bar, so they resolve onto the next downbeat.
    if (inBar === barSteps - fillLen && this.fillQueued) {
      this.fillQueued = false;
      this.fill = { type: Math.floor(Math.random() * 3), start: inBar, len: fillLen };
      this.onState?.();
    }

    let t = time;
    if (step % 2 === 1) t += this.swing * this.stepDur * 0.45;
    const human = () => (Math.random() - 0.5) * 0.006;

    this.onSchedule?.(step, t);
    const delay = Math.max(0, (t - this.ctx.currentTime) * 1000);
    setTimeout(() => this.onStep?.(step % this.length, inBar, step), delay);
    if (this.drumsMuted) {
      this.fill = null;
      return;
    }

    if (inBar === 0 && this.crashNext) {
      this.crashNext = false;
      this.kit.play('crash', t, 0.9);
      this.kit.play('kick', t, 1);
    }

    if (this.fill && inBar >= this.fill.start) {
      this.playFill(inBar - this.fill.start, t);
      if (inBar === barSteps - 1) {
        this.fill = null;
        this.crashNext = true;
        this.onState?.();
      }
    } else {
      const thr = this.threshold;
      for (const [sound, line] of Object.entries(this.pattern.tracks)) {
        if (this.breakHeld && !GROOVE_SOUNDS.has(sound)) continue;
        const ch = line[step % this.length];
        const d = ch === '.' ? 0 : +ch;
        if (d && d >= thr) {
          const vel = (0.5 + (d / 9) * 0.5) * (0.92 + Math.random() * 0.16);
          this.kit.play(sound, t + human(), vel);
        } else if (!d && this.busy > 0.7 && (sound === 'chh' || sound === 'snare')) {
          // Very busy: sprinkle quiet ghost notes into the gaps.
          if (Math.random() < (this.busy - 0.7) * 0.5) this.kit.play(sound, t + human(), 0.18);
        }
      }
    }
  }

  // Where in the global step count an audio-clock time falls (fractional).
  posAt(time) {
    return this.step + (time - this.nextTime) / this.stepDur;
  }

  // First step of the next bar that hasn't been scheduled yet.
  nextBarStep() {
    const bar = this.sig.barSteps;
    return Math.ceil(this.step / bar) * bar;
  }

  playFill(i, t) {
    const { len, type } = this.fill;
    const ramp = 0.45 + (i / (len - 1)) * 0.55;
    const k = this.kit;
    if (type === 0) {
      // Snare roll that builds.
      k.play('snare', t, ramp);
      if (i === 0) k.play('kick', t, 0.9);
    } else if (type === 1) {
      // Tom cascade, high to low.
      if (i % 2 === 0 || i > len / 2) k.play('tom', t, ramp, { pitch: 1.6 - (i / len) * 0.9 });
      if (i === 0 || i === len - 1) k.play('kick', t, 0.9);
    } else {
      // Stutter: kick + snare trading.
      if (i % 3 === 0) k.play('kick', t, 0.9);
      else k.play('snare', t, ramp * 0.9);
      if (i === len - 1) k.play('clap', t, 1);
    }
  }
}

export { PATTERNS, SIGNATURES };
