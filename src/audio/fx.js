// The pedalboard: a channel strip per sound (Strip) -> the shared room (FXChain).

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

const gain = (ctx, v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
const osc = (ctx, freq, type = 'sine') => {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); return o;
};

// Knobs send 128 steps, so the drive curve for each step is only ever worked out once.
const curves = new Map();
function driveCurve(amount) {
  const k = Math.round(amount * 127);
  if (!curves.has(k)) curves.set(k, tanhCurve(k / 127));
  return curves.get(k);
}

// One channel strip per sound, like a mixing desk: its own colour pedals (drive -> chorus -> tape
// wobble), a level fader and echo/reverb sends into the shared room. Live playing has a strip per
// preset; every loop layer gets a strip of its own, so its sound stays exactly as it was recorded
// whatever the knobs do afterwards.
export const STRIP_KEYS = ['drive', 'chorus', 'wobble', 'echo', 'reverb'];

export class Strip {
  constructor(ctx, noise, room) {
    this.ctx = ctx;
    const g = (v) => gain(ctx, v);
    this.input = g();
    this.lfos = [];
    const lfo = (freq, type) => { const o = osc(ctx, freq, type); this.lfos.push(o); return o; };

    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.oversample = '2x';
    this.driveMakeup = g();
    this.input.connect(this.driveShaper).connect(this.driveMakeup);

    // Juno-style chorus: two modulated delays, opposite LFO phase, split hard left/right.
    this.chorusOut = g();
    this.chorusWet = g(0);
    const dL = ctx.createDelay(0.05), dR = ctx.createDelay(0.05);
    dL.delayTime.value = dR.delayTime.value = 0.0035;
    const cl = lfo(0.52, 'triangle');
    cl.connect(g(0.0018)).connect(dL.delayTime);
    cl.connect(g(-0.0018)).connect(dR.delayTime);
    const merger = ctx.createChannelMerger(2);
    this.driveMakeup.connect(this.chorusOut);
    this.driveMakeup.connect(dL).connect(merger, 0, 0);
    this.driveMakeup.connect(dR).connect(merger, 0, 1);
    merger.connect(this.chorusWet).connect(this.chorusOut);

    // Tape wobble: slow wow + fast flutter on a short delay, a darkening lowpass, and hiss.
    this.tapeDelay = ctx.createDelay(0.1);
    this.tapeDelay.delayTime.value = 0.012;
    this.wowDepth = g(0);
    this.flutterDepth = g(0);
    lfo(0.55).connect(this.wowDepth).connect(this.tapeDelay.delayTime);
    lfo(6.3).connect(this.flutterDepth).connect(this.tapeDelay.delayTime);
    this.tapeTone = ctx.createBiquadFilter();
    this.tapeTone.type = 'lowpass';
    this.tapeTone.frequency.value = 18000;
    this.tapeTone.Q.value = 0.5;
    this.level = g(1); // the fader (loop level, mute)
    this.chorusOut.connect(this.tapeDelay).connect(this.tapeTone).connect(this.level);
    this.hiss = g(0);
    this.hissTone = ctx.createBiquadFilter();
    this.hissTone.type = 'bandpass';
    this.hissTone.frequency.value = 5000;
    this.hissTone.Q.value = 0.4;
    this.noise = noise; // shared noise source
    noise.connect(this.hissTone).connect(this.hiss).connect(this.level);

    // Out to the room: dry, plus the echo and reverb sends.
    this.echoSend = g(0);
    this.reverbSend = g(0);
    this.level.connect(room.dry);
    this.level.connect(this.echoSend).connect(room.echoIn);
    this.level.connect(this.reverbSend).connect(room.reverbIn);

    this.values = {};
    this.set({ drive: 0, chorus: 0, wobble: 0, echo: 0, reverb: 0 });
  }

  set(params) {
    const t = this.ctx.currentTime, tc = 0.03;
    for (const [k, v] of Object.entries(params)) {
      if (!STRIP_KEYS.includes(k) || this.values[k] === v) continue;
      this.values[k] = v;
      if (k === 'drive') {
        this.driveShaper.curve = driveCurve(v);
        this.driveMakeup.gain.setTargetAtTime(1 - v * 0.45, t, tc);
      } else if (k === 'chorus') {
        this.chorusWet.gain.setTargetAtTime(v * 0.9, t, tc);
      } else if (k === 'wobble') {
        this.wowDepth.gain.setTargetAtTime(v * 0.0022, t, tc);
        this.flutterDepth.gain.setTargetAtTime(v * 0.00025, t, tc);
        this.tapeTone.frequency.setTargetAtTime(18000 * Math.pow(0.22, v), t, tc);
        this.hiss.gain.setTargetAtTime(v * 0.006, t, tc);
      } else if (k === 'echo') {
        this.echoSend.gain.setTargetAtTime(v * 0.6, t, tc);
      } else {
        this.reverbSend.gain.setTargetAtTime(v * 0.9, t, tc);
      }
    }
  }

  fade(level, tc = 0.05) {
    this.level.gain.setTargetAtTime(level, this.ctx.currentTime, tc);
  }

  // Unplug everything and stop its LFOs (only once nothing is sounding through it any more).
  dispose() {
    this.noise.disconnect(this.hissTone);
    this.level.disconnect();
    this.input.disconnect();
    for (const o of this.lfos) o.stop();
  }
}

// The shared room everything sits in: the synth strips' dry signal and their echo and reverb
// sends meet here, then the master bus. (The pump ducks the three synth inputs, not the drums.)
export class FXChain {
  constructor(ctx) {
    this.ctx = ctx;
    const g = (v) => gain(ctx, v);

    this.dry = g();
    this.master = g(0.8);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.comp.connect(this.analyser);
    this.dry.connect(this.master);

    // Tape echo: dark feedback loop.
    this.echoIn = g();
    this.echoDelay = ctx.createDelay(2);
    this.echoDelay.delayTime.value = 0.42;
    this.echoFb = g(0.42);
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2600;
    this.echoIn.connect(this.echoDelay).connect(echoTone).connect(this.echoFb).connect(this.echoDelay);
    echoTone.connect(this.master);

    // Reverb (the drums send to the convolver directly).
    this.reverbIn = g();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeReverbIR(ctx);
    this.reverbIn.connect(this.reverb).connect(this.master);
    this.synthInputs = [this.dry, this.echoIn, this.reverbIn];
  }
}
