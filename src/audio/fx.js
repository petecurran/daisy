// The "pedalboard": drive -> chorus -> tape wobble -> (echo + reverb sends) -> master.

function tanhCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + amount * 12;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = amount < 0.001 ? x : Math.tanh(k * x) / norm;
  }
  return curve;
}

// Soft, dark stereo reverb impulse: decaying noise, one-pole lowpassed so it doesn't hiss.
function makeReverbIR(ctx, seconds = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * (0.35 - t * 0.25); // gets darker as it decays
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < 200 ? i / 200 : 1);
    }
  }
  return ir;
}

export function makeNoiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class FXChain {
  constructor(ctx, noiseBuffer) {
    this.ctx = ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const lfo = (freq, type = 'sine') => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); return o;
    };

    this.input = g();

    // Drive
    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.oversample = '2x';
    this.driveMakeup = g();
    this.input.connect(this.driveShaper).connect(this.driveMakeup);

    // Juno-style chorus: two modulated delays, opposite LFO phase, split hard left/right.
    this.chorusOut = g();
    const dry = g(1);
    this.chorusWet = g(0);
    const dL = ctx.createDelay(0.05), dR = ctx.createDelay(0.05);
    dL.delayTime.value = dR.delayTime.value = 0.0035;
    const cl = lfo(0.52, 'triangle');
    const cDepth = g(0.0018), cDepthInv = g(-0.0018);
    cl.connect(cDepth).connect(dL.delayTime);
    cl.connect(cDepthInv).connect(dR.delayTime);
    const merger = ctx.createChannelMerger(2);
    this.driveMakeup.connect(dry).connect(this.chorusOut);
    this.driveMakeup.connect(dL).connect(merger, 0, 0);
    this.driveMakeup.connect(dR).connect(merger, 0, 1);
    merger.connect(this.chorusWet).connect(this.chorusOut);

    // Tape wobble: slow wow + fast flutter on a short delay, a darkening lowpass, and hiss.
    this.tapeDelay = ctx.createDelay(0.1);
    this.tapeDelay.delayTime.value = 0.012;
    this.wowDepth = g(0); this.flutterDepth = g(0);
    lfo(0.55).connect(this.wowDepth).connect(this.tapeDelay.delayTime);
    lfo(6.3).connect(this.flutterDepth).connect(this.tapeDelay.delayTime);
    this.tapeTone = ctx.createBiquadFilter();
    this.tapeTone.type = 'lowpass'; this.tapeTone.frequency.value = 18000; this.tapeTone.Q.value = 0.5;
    this.chorusOut.connect(this.tapeDelay).connect(this.tapeTone);
    this.hiss = g(0);
    const hissSrc = ctx.createBufferSource();
    hissSrc.buffer = noiseBuffer; hissSrc.loop = true; hissSrc.start();
    const hissTone = ctx.createBiquadFilter();
    hissTone.type = 'bandpass'; hissTone.frequency.value = 5000; hissTone.Q.value = 0.4;
    hissSrc.connect(hissTone).connect(this.hiss);

    this.post = g();
    this.tapeTone.connect(this.post);
    this.hiss.connect(this.post);

    // Master
    this.master = g(0.8);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.comp.connect(this.analyser);

    this.post.connect(this.master);

    // Tape echo send: dark feedback loop.
    this.echoSend = g(0);
    this.echoDelay = ctx.createDelay(2);
    this.echoDelay.delayTime.value = 0.42;
    this.echoFb = g(0.42);
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass'; echoTone.frequency.value = 2600;
    this.post.connect(this.echoSend).connect(this.echoDelay).connect(echoTone).connect(this.echoFb).connect(this.echoDelay);
    echoTone.connect(this.master);

    // Reverb send.
    this.reverbSend = g(0);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeReverbIR(ctx);
    this.post.connect(this.reverbSend).connect(this.reverb).connect(this.master);

    this.values = {};
    this.set({ drive: 0, chorus: 0, wobble: 0, echo: 0, reverb: 0, volume: 0.8 });
  }

  set(params) {
    const t = this.ctx.currentTime, tc = 0.03;
    for (const [k, v] of Object.entries(params)) {
      this.values[k] = v;
      switch (k) {
        case 'drive':
          this.driveShaper.curve = tanhCurve(v);
          this.driveMakeup.gain.setTargetAtTime(1 - v * 0.45, t, tc);
          break;
        case 'chorus':
          this.chorusWet.gain.setTargetAtTime(v * 0.9, t, tc);
          break;
        case 'wobble':
          this.wowDepth.gain.setTargetAtTime(v * 0.0022, t, tc);
          this.flutterDepth.gain.setTargetAtTime(v * 0.00025, t, tc);
          this.tapeTone.frequency.setTargetAtTime(18000 * Math.pow(0.22, v), t, tc);
          this.hiss.gain.setTargetAtTime(v * 0.006, t, tc);
          break;
        case 'echo':
          this.echoSend.gain.setTargetAtTime(v * 0.6, t, tc);
          break;
        case 'reverb':
          this.reverbSend.gain.setTargetAtTime(v * 0.9, t, tc);
          break;
        case 'volume':
          this.master.gain.setTargetAtTime(v, t, tc);
          break;
      }
    }
  }
}
