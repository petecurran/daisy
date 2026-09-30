// One sounding note. Built fresh per note-on, thrown away after release.

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Voice {
  constructor(engine, preset, note, velocity, when) {
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.engine = engine;
    this.preset = preset;
    this.note = note;
    this.sources = [];
    this.pitchParams = []; // every AudioParam (cents) that pitch bend / vibrato / drift should move

    const t = Math.max(when ?? 0, ctx.currentTime);
    const vel = velocity / 127;
    const freq = mtof(note);
    const drift = (Math.random() * 2 - 1) * 4; // a little analog slop per voice

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(engine.chainFor(preset).input);
    this.end = null; // audio time this voice falls silent (set on release)

    // Two cascaded lowpasses = a smooth 24dB slope; resonance only on the second.
    const f = preset.filter;
    this.f1 = ctx.createBiquadFilter();
    this.f2 = ctx.createBiquadFilter();
    this.f1.type = this.f2.type = 'lowpass';
    this.f1.Q.value = 0.6;
    this.f2.Q.value = f.q * engine.macrosFor(preset).resonance * 2;
    this.baseCutoff = f.cutoff * Math.pow(freq / 261.6, f.keytrack);
    this.applyCutoff(t, true);
    this.f1.connect(this.f2);

    let signal = this.f2;
    if (preset.trem) {
      const trem = ctx.createGain();
      trem.gain.value = 1 - preset.trem.depth;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = preset.trem.rate;
      const depth = ctx.createGain();
      depth.gain.value = preset.trem.depth;
      lfo.connect(depth).connect(trem.gain);
      lfo.start(t);
      this.sources.push(lfo);
      this.f2.connect(trem);
      signal = trem;
    }
    signal.connect(this.out);

    // Filter envelope rides on the filters' detune param (cents), so the brightness knob can
    // move the base cutoff independently while the envelope is running.
    const fe = preset.fenv;
    const envCents = f.env * (0.5 + vel * 0.5);
    if (envCents) {
      for (const flt of [this.f1, this.f2]) {
        flt.detune.setValueAtTime(0, t);
        flt.detune.linearRampToValueAtTime(envCents, t + fe.a + 0.001);
        flt.detune.setTargetAtTime(envCents * fe.s, t + fe.a, fe.d / 3);
      }
    }

    if (preset.fm) this.buildFM(freq, vel, t);
    else this.buildSubtractive(freq, t);

    for (const p of this.pitchParams) {
      p.value = drift;
      engine.bend.connect(p);
      engine.vibrato.connect(p);
      if (preset.pitchEnv) {
        p.setValueAtTime(drift + preset.pitchEnv.cents, t);
        p.setTargetAtTime(drift, t, preset.pitchEnv.time / 3);
      }
    }

    // Amp envelope
    const a = preset.aenv;
    const peak = 0.16 * (0.35 + vel * 0.65);
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(peak, t + a.a + 0.002);
    this.out.gain.setTargetAtTime(peak * a.s, t + a.a + 0.002, a.d / 3);
    this.releaseTime = a.r;
  }

  buildSubtractive(freq, t) {
    const ctx = this.ctx, p = this.preset;
    for (const o of p.oscs) {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.value = freq * Math.pow(2, o.octave);
      const g = ctx.createGain();
      g.gain.value = o.level;
      osc.connect(g).connect(this.f1);
      const det = ctx.createConstantSource(); // per-osc static detune, summed with pitch params
      det.offset.value = o.detune;
      det.connect(osc.detune);
      det.start(t);
      osc.start(t);
      this.sources.push(osc, det);
      this.pitchParams.push(osc.detune);
    }
    if (p.noise) {
      const n = ctx.createBufferSource();
      n.buffer = this.engine.noiseBuffer;
      n.loop = true;
      n.loopStart = Math.random();
      const g = ctx.createGain();
      g.gain.value = p.noise;
      n.connect(g).connect(this.f1);
      n.start(t, Math.random());
      this.sources.push(n);
    }
  }

  buildFM(freq, vel, t) {
    const ctx = this.ctx, fm = this.preset.fm;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * fm.ratio;
    const modGain = ctx.createGain();
    const index = fm.index * (0.4 + vel * fm.velToIndex);
    modGain.gain.setValueAtTime(freq * index, t);
    modGain.gain.setTargetAtTime(freq * index * 0.15, t, fm.indexDecay / 3);
    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(this.f1);
    carrier.start(t); mod.start(t);
    this.sources.push(carrier, mod);
    this.pitchParams.push(carrier.detune, mod.detune);

    if (fm.bark) {
      // Short metallic "tine" click at the start of Rhodes-style notes, louder on hard hits.
      const b = ctx.createOscillator();
      b.frequency.value = freq * fm.bark.ratio;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(fm.bark.level * vel * vel, t);
      bg.gain.setTargetAtTime(0, t, fm.bark.decay);
      b.connect(bg).connect(this.f1);
      b.start(t);
      this.sources.push(b);
      this.pitchParams.push(b.detune);
    }
  }

  applyCutoff(t = this.ctx.currentTime, immediate = false) {
    const hz = Math.min(18000, this.baseCutoff * this.engine.brightnessMult(this.preset));
    if (immediate) {
      this.f1.frequency.value = this.f2.frequency.value = hz;
    } else {
      this.f1.frequency.setTargetAtTime(hz, t, 0.02);
      this.f2.frequency.setTargetAtTime(hz, t, 0.02);
    }
  }

  applyResonance(t = this.ctx.currentTime) {
    this.f2.Q.setTargetAtTime(this.preset.filter.q * this.engine.macrosFor(this.preset).resonance * 2, t, 0.02);
  }

  release(extra = 1, at) {
    const t = Math.max(at ?? 0, this.ctx.currentTime);
    const r = this.releaseTime * extra;
    this.out.gain.cancelAndHoldAtTime(t);
    this.out.gain.setTargetAtTime(0, t, r / 4);
    const fe = this.preset.fenv;
    for (const flt of [this.f1, this.f2]) {
      flt.detune.cancelAndHoldAtTime(t);
      flt.detune.setTargetAtTime(0, t, fe.r / 4);
    }
    const end = t + r * 1.6 + 0.05;
    this.end = end;
    for (const s of this.sources) s.stop(end);
    setTimeout(() => this.out.disconnect(), (end - this.ctx.currentTime) * 1000 + 100);
    this.done = true;
  }

  kill() {
    // Fast fade for voice stealing.
    const t = this.ctx.currentTime;
    this.out.gain.cancelAndHoldAtTime(t);
    this.out.gain.setTargetAtTime(0, t, 0.01);
    for (const s of this.sources) s.stop(t + 0.08);
    setTimeout(() => this.out.disconnect(), 200);
    this.end = t + 0.08;
    this.killed = true;
    this.done = true;
  }
}
