import { bus } from '../bus.js';
import { HOT_PINK, KNOB_COLORS, NEON_CYAN, WHITE, pitchColor } from './palette.js';
import { MODES } from './modes.js';
import { Controller, drawIcon, KNOB_ICONS, KNOB_LABELS } from './controller.js';
import { NOTE_NAMES, ZONE_LABELS } from '../chords.js';

const CHORD_GAP_MS = 70; // notes closer together than this belong to the same chord burst
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Full-screen visual stage, drawn at native resolution.
// Layers: a trail canvas (history that drifts outward and fades) + crisp shapes + a readable HUD.
// Musical events arrive through the bus; continuous values are read from the engine every frame.
export class Stage {
  constructor(root, src) {
    this.root = root;
    this.src = src; // { engine, seq, looper, chords, joy, knobs(), page() }
    this.canvas = root.querySelector('.screen');
    this.g = this.canvas.getContext('2d');
    this.trailA = document.createElement('canvas');
    this.trailB = document.createElement('canvas');
    this.mode = 0;
    this.bursts = [];
    this.particles = [];
    this.pulse = 0;
    this.flash = 0;
    this.swirl = 0;
    this.chord = null;
    this.popup = null;
    this.modePopupAt = -1e9;
    this.step = null;
    this.controller = new Controller(root.querySelector('.mpk'), src);
    this.resize();
    addEventListener('resize', () => this.resize());
    this.listen();
  }

  get visible() { return !this.root.classList.contains('hidden'); }

  show(on = !this.visible) {
    this.root.classList.toggle('hidden', !on);
    if (on) this.resize();
    if (on && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  nextMode(dir = 1) {
    this.mode = (this.mode + dir + MODES.length) % MODES.length;
    this.modePopupAt = performance.now();
    this.particles = [];
    for (const t of [this.trailA, this.trailB]) t.getContext('2d').clearRect(0, 0, t.width, t.height);
  }

  resize() {
    const dpr = (this.dpr = Math.min(1.5, devicePixelRatio || 1));
    const W = (this.W = Math.round(innerWidth * dpr));
    const H = (this.H = Math.round(innerHeight * dpr));
    this.canvas.width = W;
    this.canvas.height = H;
    // The history layer is soft glow anyway, so it runs at half resolution (4x cheaper to blend).
    this.ts = 0.5;
    for (const c of [this.trailA, this.trailB]) { c.width = Math.round(W * this.ts); c.height = Math.round(H * this.ts); }
    this.controller.resize();
    // Chords are born at the top edge of the on-screen MPK, as if pouring out of the instrument.
    this.ox = W / 2;
    this.oy = H - (this.controller.heightPx() + innerHeight * 0.03) * dpr;
    this.maxR = Math.hypot(W / 2, this.oy) + 40 * dpr;
  }

  // ---------- events ----------

  listen() {
    bus.on('note', (e) => this.onNote(e));
    bus.on('noteoff', (e) => this.onNoteOff(e));
    bus.on('drum', (e) => this.onDrum(e));
    bus.on('knob', (e) => { this.popup = { ...e, at: performance.now() }; this.controller.touch(); });
    bus.on('pad', (e) => this.controller.pad(e));
    bus.on('chord', (e) => this.onChord(e));
    bus.on('step', (e) => { this.step = e; });
  }

  onChord({ name }) {
    if (!name) return;
    this.chord = { name, at: performance.now() };
    // Label the chord that just started, so the history reads as a progression.
    const b = this.bursts.findLast((b) => !b.loop && !b.ghost);
    if (b && performance.now() / 1000 - b.born < 0.15) b.name = name;
  }

  onNote({ note, vel, loop }) {
    const now = performance.now() / 1000;
    this.controller.noteOn(note, loop);
    let b = this.bursts[this.bursts.length - 1];
    if (!b || b.loop !== loop || b.ghost || b.releasedAt != null || (now - b.born) * 1000 > CHORD_GAP_MS) {
      b = { notes: [], colors: [], held: new Set(), born: now, releasedAt: null, vel: 0, loop, ghost: 0, seed: Math.random() * 10, name: null };
      this.bursts.push(b);
      this.spawnEchoes(b);
    }
    b.notes.push(note);
    b.notes.sort((a, c) => a - c);
    b.colors = b.notes.map(pitchColor);
    b.held.add(note);
    b.vel = Math.max(b.vel, vel / 127);
    if (!b.name && b.notes.length === 1) b.name = NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
  }

  onNoteOff({ note, loop = false }) {
    this.controller.noteOff(note, loop);
    const now = performance.now() / 1000;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      if (b.loop === loop && b.held.has(note)) {
        b.held.delete(note);
        if (!b.held.size) b.releasedAt = now;
        return;
      }
    }
  }

  // Echo knob: each chord leaves fading ghost copies at the echo's delay time.
  spawnEchoes(b) {
    const fx = this.src.engine.fx;
    const amount = fx.values.echo;
    if (amount < 0.05) return;
    const gap = fx.echoDelay.delayTime.value;
    const count = Math.round(1 + amount * 3);
    for (let k = 1; k <= count; k++) {
      setTimeout(() => {
        const t = performance.now() / 1000;
        this.bursts.push({
          notes: b.notes, colors: b.colors, held: new Set(), born: t, releasedAt: t + 0.1,
          vel: b.vel * Math.pow(0.55, k), loop: b.loop, ghost: k, seed: b.seed + k, name: null,
        });
      }, gap * 1000 * k);
    }
  }

  onDrum({ sound, vel }) {
    const last = this.bursts[this.bursts.length - 1];
    const color = last ? last.colors[last.colors.length - 1] : WHITE;
    switch (sound) {
      case 'kick': this.pulse = Math.min(1.5, this.pulse + vel); break;
      case 'snare':
      case 'clap':
        this.spray(30 + vel * 40, WHITE, 1.4);
        this.swirl += (Math.random() - 0.5) * 0.03 * vel;
        break;
      case 'crash': this.flash = 1; this.spray(90, HOT_PINK, 2); break;
      case 'chh': case 'shaker': this.sparkle(8 + vel * 14, color, 0.5); break;
      case 'ohh': this.sparkle(30, NEON_CYAN, 0.7); break;
      default: this.spray(10, color, 0.9);
    }
  }

  spray(n, color, speed) {
    const d = this.dpr;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.08 + Math.random() * 0.84);
      const v = (0.4 + Math.random()) * speed * 420 * d;
      this.particles.push({ x: this.ox, y: this.oy, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, life: 1, color, size: 2 * d, spark: true });
    }
  }

  sparkle(n, color, strength) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: Math.random() * this.W, y: Math.random() * this.oy, vx: 0, vy: 0,
        life: strength * (0.4 + Math.random() * 0.6), color, size: 2 * this.dpr, spark: true, still: true,
      });
    }
  }

  // ---------- frame ----------

  params() {
    const e = this.src.engine;
    const v = e.fx.values;
    return {
      reverb: v.reverb, echo: v.echo, wobble: v.wobble, chorus: v.chorus, drive: v.drive,
      brightness: e.macros.brightness, resonance: e.macros.resonance,
      voicing: this.src.chords ? (this.src.chords.voicing + 12) / 24 : 0.5,
    };
  }

  frame(tms) {
    if (!this.visible) { this.raf = null; return; }
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (tms - this.last) / 1000);
    this.last = tms;
    const now = tms / 1000;
    const p = this.params();
    const mode = MODES[this.mode];
    const { W, H, g } = this;

    // 1. History: last frame's trails, pushed outward from the origin and faded.
    const fb = mode.feedback(p, this);
    const tg = this.trailB.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    const ts = this.ts;
    tg.clearRect(0, 0, this.trailB.width, this.trailB.height);
    tg.globalAlpha = fb.decay;
    tg.translate(this.ox * ts, this.oy * ts);
    tg.rotate((fb.rot || 0) + this.swirl);
    tg.scale(fb.zoom, fb.zoom);
    tg.translate(-this.ox * ts, -this.oy * ts);
    tg.drawImage(this.trailA, 0, 0);
    tg.setTransform(ts, 0, 0, ts, 0, 0); // modes draw into the trail in screen coordinates
    tg.globalAlpha = 1;
    tg.globalCompositeOperation = 'lighter';

    // 2. Scene background: Tokyo Night navy, Miami stripes (drive), reverb haze.
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#0d0e16';
    g.fillRect(0, 0, W, H);
    if (p.drive > 0.04) this.stripes(g, p, now);
    if (p.reverb > 0.02) {
      const r = this.maxR * (0.7 + p.reverb * 0.5);
      const grad = g.createRadialGradient(this.ox, this.oy, 0, this.ox, this.oy, r);
      grad.addColorStop(0, `rgba(187,154,247,${p.reverb * 0.22})`);
      grad.addColorStop(1, 'rgba(187,154,247,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }

    // 3. Mode draws: faint copies into the trail, crisp shapes onto the screen.
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.9;
    g.drawImage(this.trailA, 0, 0, W, H); // last frame's history, scaled up (one frame behind)
    g.globalAlpha = 1;
    mode.draw(this, p, now, dt, g, tg);
    this.drawParticles(dt, g, tg);
    if (this.flash > 0.02) {
      g.fillStyle = `rgba(255,79,168,${this.flash * 0.25})`;
      g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';

    // 4. Readouts.
    this.hud(now, p);
    this.controller.draw(now);

    // Hotline Miami camera: the scene sways and tilts with tape wobble; the kick punches in.
    const sway = p.wobble;
    const rot = Math.sin(now * 0.55) * sway * 2.5 + Math.sin(now * 1.7) * sway * 0.6;
    const scale = 1 + sway * 0.05 + this.pulse * 0.012;
    this.canvas.style.transform = `rotate(${rot}deg) scale(${scale})`;

    [this.trailA, this.trailB] = [this.trailB, this.trailA];
    this.pulse *= Math.pow(0.02, dt);
    this.flash *= Math.pow(0.01, dt);
    this.swirl *= Math.pow(0.3, dt);
    this.bursts = this.bursts.filter((b) => b.held.size || now - (b.releasedAt ?? now) < 30);
  }

  // Hotline Miami title-screen colour cycling, throbbing with the kick.
  stripes(g, p, now) {
    const band = 38 * this.dpr;
    const shift = (now * 40 * this.dpr) % (band * 2);
    const a = p.drive * 0.13 * (1 + this.pulse * 0.8);
    for (let y = -band * 2 + shift; y < this.H; y += band * 2) {
      g.fillStyle = `rgba(255,79,168,${a})`;
      g.fillRect(0, y, this.W, band);
      g.fillStyle = `rgba(120,60,220,${a})`;
      g.fillRect(0, y + band, this.W, band);
    }
  }

  drawParticles(dt, g, tg) {
    for (const q of this.particles) {
      if (!q.still) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 260 * this.dpr * dt;
      }
      q.life -= dt * (q.spark ? 1.2 : 0.35);
      const a = Math.max(0, q.life);
      g.fillStyle = rgba(q.color, a);
      g.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
      tg.fillStyle = rgba(q.color, a * 0.35);
      tg.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    this.particles = this.particles.filter((q) => q.life > 0 && q.y < this.H && q.x > -10 && q.x < this.W + 10);
  }

  // ---------- readable HUD ----------

  hud(now, p) {
    const g = this.g, d = this.dpr, W = this.W;
    const { seq, looper, chords, joy, engine } = this.src;
    const tnow = performance.now();
    const pad = 22 * d;
    const font = (px, weight = 600) => `${weight} ${px * d}px ui-monospace, "JetBrainsMono Nerd Font", monospace`;
    g.textBaseline = 'top';

    // Top left: tempo, time signature, pattern, kit, and beat dots.
    if (seq) {
      g.textAlign = 'left';
      g.font = font(28, 800);
      g.fillStyle = seq.playing && !seq.drumsMuted ? '#c0caf5' : '#565f89';
      g.fillText(`${seq.bpm}`, pad, pad);
      const bw = g.measureText(`${seq.bpm}`).width;
      g.font = font(13, 600);
      g.fillStyle = '#565f89';
      g.fillText('BPM', pad + bw + 6 * d, pad + 12 * d);
      g.font = font(14, 600);
      g.fillStyle = '#a9b1d6';
      const kit = engine.drums.kit.name;
      g.fillText(`${seq.sigId}  ·  ${seq.pattern.name}  ·  ${kit}${seq.drumsMuted ? '  ·  muted' : ''}`, pad, pad + 36 * d);
      const { barSteps, beatSteps } = seq.sig;
      const inBar = seq.playing && this.step ? this.step.inBar : -1;
      for (let i = 0; i < barSteps; i++) {
        const beat = i % beatSteps === 0;
        const s = (beat ? 7 : 4) * d;
        g.fillStyle = i === inBar ? '#ff4fa8' : beat ? '#565f89' : '#2f334d';
        g.fillRect(pad + i * 11 * d, pad + 60 * d + (beat ? 0 : 1.5 * d), s, s);
      }
    }

    // Top centre: the chord, big, in its root colour; the key and joystick colour underneath.
    const held = chords?.held.size;
    if (this.chord) {
      const age = (tnow - this.chord.at) / 1000;
      const a = held ? 1 : Math.max(0.25, 1 - Math.max(0, age - 1.5) * 0.5);
      const rootKey = held ? [...chords.held.keys()].pop() : null;
      const c = rootKey != null ? pitchColor(rootKey) : [192, 202, 245];
      g.textAlign = 'center';
      g.font = font(64, 800);
      g.fillStyle = rgba(c, a);
      g.shadowColor = rgba(c, 0.6 * a);
      g.shadowBlur = 24 * d;
      g.fillText(this.chord.name, W / 2, pad - 6 * d);
      g.shadowBlur = 0;
    }
    if (chords) {
      g.textAlign = 'center';
      g.font = font(14, 600);
      g.fillStyle = '#565f89';
      const zone = joy?.zone && joy.zone !== 'C' ? `  ·  ${ZONE_LABELS[joy.zone]}` : '';
      g.fillText(`key of ${NOTE_NAMES[chords.key.tonic]} ${chords.key.mode}${zone}`, W / 2, pad + 66 * d);
    }

    // Top right: looper.
    if (looper) {
      g.textAlign = 'right';
      const st = looper.state;
      const label = { empty: 'LOOP', armed: 'GET READY', recording: '● REC', playing: '▶ LOOP', overdub: '● LAYER', stopped: '■ LOOP' }[st];
      const col = { empty: '#414868', armed: '#e0af68', recording: '#f7768e', playing: '#9ece6a', overdub: '#f7768e', stopped: '#565f89' }[st];
      const blink = (st === 'armed' || st === 'recording' || st === 'overdub') && Math.floor(now * 2.5) % 2;
      g.font = font(18, 800);
      g.fillStyle = blink ? '#0d0e16' : col;
      g.fillText(label, W - pad, pad);
      if (looper.hasLoop) {
        g.font = font(13, 600);
        g.fillStyle = '#565f89';
        g.fillText(`${looper.bars} bar${looper.bars === 1 ? '' : 's'} · ${looper.layers.length} layer${looper.layers.length === 1 ? '' : 's'}`, W - pad, pad + 26 * d);
        // Progress bar + one coloured dot per layer (the layer's sound colour).
        const bw = 150 * d, bx = W - pad - bw, by = pad + 48 * d;
        g.fillStyle = '#24283b';
        g.fillRect(bx, by, bw, 4 * d);
        if (this.step && (st === 'playing' || st === 'overdub')) {
          const frac = ((((this.step.global - looper.start) % looper.length) + looper.length) % looper.length + 1) / looper.length;
          g.fillStyle = col;
          g.fillRect(bx, by, bw * frac, 4 * d);
        }
        looper.layers.forEach((l, i) => {
          g.fillStyle = l.muted ? '#2f334d' : l.preset.color;
          g.beginPath();
          g.arc(W - pad - 5 * d - i * 16 * d, by + 18 * d, 5 * d, 0, Math.PI * 2);
          g.fill();
        });
      }
    }

    // Knob popup: big ring + icon + name + value, in the knob's colour.
    if (this.popup) {
      const age = (tnow - this.popup.at) / 1000;
      const a = Math.max(0, Math.min(1, 1.8 - age * 1.2));
      if (a > 0) {
        const { index, page } = this.popup;
        const knob = this.src.knobs()[index];
        const value = knob.get();
        const col = KNOB_COLORS[index];
        const cx = W / 2, cy = this.oy * 0.5, r = 70 * d;
        g.globalAlpha = a;
        g.lineCap = 'round';
        g.lineWidth = 10 * d;
        g.strokeStyle = '#24283b';
        g.beginPath(); g.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI); g.stroke();
        g.strokeStyle = col;
        g.shadowColor = col;
        g.shadowBlur = 20 * d;
        g.beginPath(); g.arc(cx, cy, r, 0.75 * Math.PI, (0.75 + value * 1.5) * Math.PI); g.stroke();
        g.shadowBlur = 0;
        g.lineCap = 'butt';
        drawIcon(g, KNOB_ICONS[page][index], cx - 21 * d, cy - 38 * d, 6 * d, col);
        g.textAlign = 'center';
        g.font = font(16, 800);
        g.fillStyle = col;
        g.fillText(KNOB_LABELS[page][index], cx, cy + 12 * d);
        g.font = font(22, 800);
        g.fillStyle = '#c0caf5';
        g.fillText(knob.fmt ? knob.fmt() : `${Math.round(value * 100)}%`, cx, cy + 34 * d);
        g.globalAlpha = 1;
      } else {
        this.popup = null;
      }
    }

    // Look name, briefly, after switching.
    const ma = 2 - (tnow - this.modePopupAt) / 1000;
    if (ma > 0) {
      g.globalAlpha = Math.min(1, ma);
      g.textAlign = 'center';
      g.font = font(20, 800);
      g.fillStyle = '#ff4fa8';
      g.fillText(MODES[this.mode].name.toUpperCase(), W / 2, this.oy * 0.5);
      g.globalAlpha = 1;
    }
    g.textBaseline = 'alphabetic';
  }
}
