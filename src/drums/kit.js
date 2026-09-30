import { bus } from '../bus.js';

// Synthesised drum kits. Every hit builds a few throwaway nodes, scheduled at an exact audio time.

export const KITS = [
  {
    name: 'Dusty',
    blurb: 'CR-78 / lo-fi: soft, dark, a bit crunchy',
    kick: { f0: 125, f1: 48, sweep: 0.06, decay: 0.32, click: 0.25 },
    snare: { tone: 190, toneAmt: 0.5, bp: 1800, decay: 0.15, attack: 0.001 },
    hat: { decay: 0.045, hp: 6000, metal: 0.4 },
    tone: 5200, drive: 0.4,
  },
  {
    name: 'Warm 808',
    blurb: 'Round boomy kick, snappy snare, silky hats',
    kick: { f0: 110, f1: 44, sweep: 0.09, decay: 0.9, click: 0.08 },
    snare: { tone: 220, toneAmt: 0.6, bp: 2500, decay: 0.19, attack: 0.001 },
    hat: { decay: 0.05, hp: 7500, metal: 1 },
    tone: 12000, drive: 0.15,
  },
  {
    name: 'Punchy',
    blurb: 'Tight, bright, hits hard',
    kick: { f0: 180, f1: 52, sweep: 0.045, decay: 0.42, click: 0.6 },
    snare: { tone: 200, toneAmt: 0.45, bp: 3400, decay: 0.21, attack: 0.001 },
    hat: { decay: 0.04, hp: 8500, metal: 0.8 },
    tone: 16000, drive: 0.3,
  },
  {
    name: 'Brushes',
    blurb: 'Soft jazz kit: swishy snare, gentle kick',
    kick: { f0: 90, f1: 50, sweep: 0.05, decay: 0.28, click: 0 },
    snare: { tone: 0, toneAmt: 0, bp: 3200, decay: 0.3, attack: 0.025 },
    hat: { decay: 0.06, hp: 5000, metal: 0.15 },
    tone: 7000, drive: 0.05,
  },
];

// Live-playable order: pad 1..8 on bank B.
export const PAD_SOUNDS = ['kick', 'snare', 'chh', 'ohh', 'clap', 'rim', 'tom', 'shaker'];

function driveCurve(amount) {
  const n = 1024, c = new Float32Array(n), k = 1 + amount * 6, norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

export class DrumKit {
  constructor(ctx, noiseBuffer, destination, reverbInput) {
    this.ctx = ctx;
    this.noise = noiseBuffer;
    this.input = ctx.createGain();
    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.Q.value = 0.5;
    this.shaper = ctx.createWaveShaper();
    this.out = ctx.createGain();
    this.room = ctx.createGain();
    this.input.connect(this.toneFilter).connect(this.shaper).connect(this.out);
    this.out.connect(destination);
    this.out.connect(this.room).connect(reverbInput);
    this.openHats = [];
    this.toneAmount = 0.5;
    this.setKit(0);
    this.setLevel(0.8);
    this.setRoom(0.15);
  }

  setKit(i) {
    this.kitIndex = i;
    this.kit = KITS[i];
    this.shaper.curve = driveCurve(this.kit.drive);
    this.setTone(this.toneAmount);
  }

  // 0..1, 0.5 = the kit's own tone
  setTone(v) {
    this.toneAmount = v;
    const hz = Math.min(18000, this.kit.tone * Math.pow(4, (v - 0.5) * 2));
    this.toneFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
  }

  setLevel(v) { this.level = v; this.out.gain.setTargetAtTime(v * 1.1, this.ctx.currentTime, 0.02); }
  setRoom(v) { this.roomAmount = v; this.room.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.02); }

  play(sound, t, vel = 1, opts = {}) {
    const fn = this[sound];
    if (!fn) return;
    const at = t ?? this.ctx.currentTime;
    fn.call(this, at, vel, opts);
    bus.emitAt(this.ctx, at, 'drum', { sound, vel });
  }

  // ---- helpers ----
  env(t, peak, decay, attack = 0.001) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 4);
    return g;
  }
  noiseSrc(t, dur) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur);
    return n;
  }
  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }
  metal(t, dur) {
    // 808-style: six detuned square waves, bandpassed.
    const mix = this.ctx.createGain();
    mix.gain.value = 0.18;
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 40 * r * (1 + (Math.random() - 0.5) * 0.004);
      o.connect(mix);
      o.start(t); o.stop(t + dur);
    }
    return mix;
  }

  // ---- voices ----
  kick(t, v) {
    const k = this.kit.kick;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(k.f0, t);
    o.frequency.exponentialRampToValueAtTime(k.f1, t + k.sweep);
    const g = this.env(t, v * 0.95, k.decay, 0.002);
    o.connect(g).connect(this.input);
    o.start(t); o.stop(t + k.decay * 1.6 + 0.1);
    if (k.click) {
      const cg = this.env(t, v * k.click * 0.5, 0.012);
      this.noiseSrc(t, 0.05).connect(this.filter('highpass', 1800)).connect(cg).connect(this.input);
    }
    this.onKick?.(t, v);
  }

  snare(t, v) {
    const s = this.kit.snare;
    if (s.toneAmt) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(s.tone * 1.3, t);
      o.frequency.exponentialRampToValueAtTime(s.tone, t + 0.03);
      const g = this.env(t, v * s.toneAmt * 0.6, 0.09);
      o.connect(g).connect(this.input);
      o.start(t); o.stop(t + 0.3);
    }
    const g = this.env(t, v * 0.55, s.decay, s.attack);
    this.noiseSrc(t, s.decay * 2 + 0.1)
      .connect(this.filter('bandpass', s.bp, 0.7))
      .connect(this.filter('highpass', 700))
      .connect(g).connect(this.input);
  }

  clap(t, v) {
    const bp = this.filter('bandpass', 1200, 1.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (const [dt, a] of [[0, 1], [0.011, 0.8], [0.022, 0.9]]) {
      g.gain.setValueAtTime(v * a * 0.7, t + dt);
      g.gain.setTargetAtTime(0, t + dt + 0.001, 0.003);
    }
    g.gain.setValueAtTime(v * 0.45, t + 0.032);
    g.gain.setTargetAtTime(0, t + 0.033, 0.04);
    this.noiseSrc(t, 0.4).connect(bp).connect(g).connect(this.input);
  }

  chh(t, v) {
    this.chokeOpen(t);
    this.hat(t, v * 0.55, this.kit.hat.decay);
  }

  ohh(t, v, { decay = 0.32 } = {}) {
    const g = this.hat(t, v * 0.45, decay);
    this.openHats.push({ g, end: t + decay * 2 });
  }

  crash(t, v) {
    this.hat(t, v * 0.5, 1.3, 4500);
  }

  hat(t, v, decay, hp) {
    const h = this.kit.hat;
    const dur = decay * 2.5 + 0.05;
    const g = this.env(t, v, decay);
    const hpf = this.filter('highpass', hp ?? h.hp);
    if (h.metal) {
      const m = this.metal(t, dur);
      const mg = this.ctx.createGain();
      mg.gain.value = h.metal;
      m.connect(this.filter('bandpass', 10000, 0.6)).connect(mg).connect(hpf);
    }
    const ng = this.ctx.createGain();
    ng.gain.value = 1 - h.metal * 0.6;
    this.noiseSrc(t, dur).connect(ng).connect(hpf);
    hpf.connect(g).connect(this.input);
    return g;
  }

  chokeOpen(t) {
    this.openHats = this.openHats.filter((h) => h.end > t);
    for (const h of this.openHats) {
      h.g.gain.cancelScheduledValues(t);
      h.g.gain.setTargetAtTime(0, t, 0.008);
    }
    this.openHats = [];
  }

  rim(t, v) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 1700;
    const o2 = this.ctx.createOscillator();
    o2.frequency.value = 480;
    const g = this.env(t, v * 0.45, 0.028);
    const hp = this.filter('highpass', 400);
    o.connect(hp); o2.connect(hp);
    hp.connect(g).connect(this.input);
    o.start(t); o2.start(t); o.stop(t + 0.15); o2.stop(t + 0.15);
  }

  tom(t, v, { pitch = 1 } = {}) {
    const o = this.ctx.createOscillator();
    const f = 165 * pitch;
    o.frequency.setValueAtTime(f * 1.35, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const g = this.env(t, v * 0.7, 0.28, 0.002);
    o.connect(g).connect(this.input);
    o.start(t); o.stop(t + 0.6);
  }

  shaker(t, v) {
    const g = this.env(t, v * 0.3, 0.05, 0.012);
    this.noiseSrc(t, 0.2).connect(this.filter('bandpass', 6500, 1.2)).connect(g).connect(this.input);
  }

  bell(t, v) {
    const bp = this.filter('bandpass', 800, 1.2);
    for (const f of [540, 800]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(bp);
      o.start(t); o.stop(t + 0.5);
    }
    const g = this.env(t, v * 0.22, 0.14);
    bp.connect(g).connect(this.input);
  }
}
