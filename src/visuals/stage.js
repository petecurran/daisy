import { bus } from '../bus.js';
import { NOTE_NAMES } from '../chords.js';
import { createGL } from './gl.js';
import { Ink } from './fluid.js';
import { Rings } from './rings.js';
import { Deck } from './deck.js';
import { ICON, KNOB_ICONS, KNOB_LABELS } from './icons.js';
import { KNOB_COLORS } from './palette.js';
import { SHIMMER, analyzeChord, chordColor } from './chordColor.js';

const CHORD_GAP_MS = 70; // notes closer together than this belong to the same chord
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ICON_PATHS = Object.fromEntries(Object.entries(ICON).map(([k, d]) => [k, new Path2D(d)]));

// Full-screen stage: a GPU "look" (Ink or Tree Rings) underneath, a crisp text layer on top, and
// the deck (on-screen MPK + what-to-do-next guide) along the bottom.
export class Stage {
  constructor(root, src) {
    this.root = root;
    this.src = src; // { engine, seq, looper, chords, joy, knobs(), page(), preset() }
    this.glCanvas = root.querySelector('.screen');
    this.hudCanvas = root.querySelector('.hud');
    this.h = this.hudCanvas.getContext('2d');
    this.deck = new Deck(root.querySelector('.deck'), src);
    try {
      this.glx = createGL(this.glCanvas);
      this.looks = [new Ink(this.glx), new Rings(this.glx)];
    } catch (e) {
      console.error(e);
      this.error = e.message;
      this.looks = [];
    }
    this.look = 0;
    this.bursts = [];
    this.pulse = 0;
    this.shimmer = 0;
    this.flash = 0;
    this.popup = null;
    this.lookPopupAt = -1e9;
    this.step = null;
    this.labels = [];
    addEventListener('resize', () => this.resize());
    this.listen();
  }

  get visible() { return !this.root.classList.contains('hidden'); }

  show(on = !this.visible) {
    this.root.classList.toggle('hidden', !on);
    if (on) requestAnimationFrame(() => this.resize());
    if (on && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  nextLook(dir = 1) {
    if (!this.looks.length) return;
    this.look = (this.look + dir + this.looks.length) % this.looks.length;
    this.lookPopupAt = performance.now();
  }

  setLook(i) {
    if (i >= 0 && i < this.looks.length) { this.look = i; this.lookPopupAt = performance.now(); }
  }

  resize() {
    const dpr = (this.dpr = Math.min(2, devicePixelRatio || 1));
    this.W = Math.round(innerWidth * dpr);
    this.H = Math.round(innerHeight * dpr);
    for (const c of [this.glCanvas, this.hudCanvas]) { c.width = this.W; c.height = this.H; }
    for (const l of this.looks) l.resize(this.W, this.H);
    this.originCss = [innerWidth / 2, this.deck.top() || innerHeight * 0.7];
    this.maxR = Math.hypot(innerWidth / 2, this.originCss[1]) * dpr;
  }

  // ---------- events ----------

  listen() {
    bus.on('note', (e) => this.onNote(e));
    bus.on('noteoff', (e) => this.onNoteOff(e));
    bus.on('drum', (e) => this.onDrum(e));
    bus.on('knob', (e) => { this.popup = { ...e, at: performance.now() }; });
    bus.on('pad', (e) => this.deck.pad(e));
    bus.on('step', (e) => { this.step = e; });
  }

  newBurst(loop, now) {
    const b = { notes: [], held: new Set(), born: now, releasedAt: null, vel: 0, loop, ghost: 0, attacked: false };
    // A new chord while the old one is still held (joystick re-voicing, legato playing): the new
    // ring takes over the notes that are still sounding, so it is analysed as the whole chord.
    for (const old of this.bursts) {
      if (old.loop === loop && !old.ghost && old.held.size) {
        for (const n of old.held) { b.held.add(n); b.notes.push(n); }
        old.held.clear();
        old.releasedAt = now;
      }
    }
    this.bursts.push(b);
    return b;
  }

  onNote({ note, vel, loop }) {
    const now = performance.now() / 1000;
    let b = this.bursts.findLast((x) => x.loop === loop && !x.ghost);
    if (!b || b.releasedAt != null || (now - b.born) * 1000 > CHORD_GAP_MS) b = this.newBurst(loop, now);
    if (!b.notes.includes(note)) b.notes.push(note);
    b.held.add(note);
    b.vel = Math.max(b.vel, vel / 127);
    b.chord = analyzeChord(b.notes);
    b.color = chordColor(b.chord);
    if (!b.echoes) { b.echoes = true; this.spawnEchoes(b); }
  }

  onNoteOff({ note, loop = false }) {
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

  // Echo knob: ghost splashes of the chord at the echo's delay time.
  spawnEchoes(b) {
    const fx = this.src.engine.fx;
    if (fx.values.echo < 0.05) return;
    const gap = fx.echoDelay.delayTime.value;
    const count = Math.round(1 + fx.values.echo * 3);
    for (let k = 1; k <= count; k++) {
      setTimeout(() => {
        const t = performance.now() / 1000;
        this.bursts.push({ ...b, notes: [...b.notes], held: new Set(), born: t, releasedAt: t, vel: b.vel * 0.55 ** k, ghost: k, attacked: false });
      }, gap * 1000 * k);
    }
  }

  onDrum({ sound, vel }) {
    const ink = this.looks[0];
    const rings = this.looks[1];
    const inkOn = this.look === 0 && ink;
    const top = this.uvTop();
    switch (sound) {
      case 'kick':
        this.pulse = Math.min(1.5, this.pulse + vel);
        rings?.kick(vel);
        if (inkOn) for (let i = 0; i < 5; i++) ink.splat(0.1 + i * 0.2, top, 0, 420 * vel, null, 0.004);
        break;
      case 'snare':
      case 'clap':
        this.flash = Math.max(this.flash, 0.5 * vel);
        this.shimmer = Math.min(1.5, this.shimmer + 0.5 * vel);
        if (inkOn) {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2;
            ink.splat(0.15 + Math.random() * 0.7, top + Math.random() * (1 - top) * 0.8, Math.cos(a) * 420, Math.sin(a) * 420, null, 0.0012);
          }
        }
        break;
      case 'crash':
        this.flash = 1;
        if (inkOn) ink.splat(0.5, top + 0.1, 0, 700, [1.4, 0.3, 0.9], 0.01);
        break;
      case 'chh': case 'shaker': case 'ohh':
        this.shimmer = Math.min(1.5, this.shimmer + (sound === 'ohh' ? 0.6 : 0.25) * vel);
        break;
      default:
        if (inkOn) ink.splat(Math.random(), top + 0.05, (Math.random() - 0.5) * 200, 200, null, 0.0008);
    }
  }

  // Ink coordinates are 0..1 with y pointing up; the deck's top edge is where ink appears.
  uvTop() { return 1 - (this.originCss?.[1] ?? innerHeight * 0.7) / innerHeight; }

  // ---------- frame ----------

  fx() {
    const e = this.src.engine;
    const v = e.fx.values;
    return {
      exposure: 0.45 + e.macros.brightness * 1.1,
      split: v.chorus,
      heat: v.drive,
      pulse: this.pulse,
      shimmer: this.shimmer * 0.8,
      cell: 3 * this.dpr,
      wobble: v.wobble,
      curl: 8 + v.wobble * 45,
      dyeFade: 1.5 - v.reverb * 1.2,
      rippleSpeed: 1100 * this.dpr,
      reverb: v.reverb,
      dpr: this.dpr,
    };
  }

  frame(tms) {
    if (!this.visible) { this.raf = null; return; }
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.04, (tms - this.last) / 1000);
    this.last = tms;
    const now = tms / 1000;
    if (!this.originCss) this.resize();
    const fx = this.fx();

    const look = this.looks[this.look];
    if (look instanceof Ink) {
      this.pourInk(look, dt, now);
      look.render(dt, now, fx);
    } else if (look) {
      look.render(dt, now, fx, this.ringList(now, fx), [this.originCss[0] * this.dpr, this.H - this.originCss[1] * this.dpr]);
    }

    this.hud(now);
    this.deck.update();
    const live = this.bursts.findLast((b) => !b.loop && !b.ghost && b.held.size);
    this.deck.lightKeys(live ? [...live.held] : [], live?.color ?? [0, 0, 0]);

    // Hotline Miami camera: sway and tilt with tape wobble, punch in on the kick.
    const sway = fx.wobble;
    const rot = Math.sin(now * 0.55) * sway * 2.2 + Math.sin(now * 1.7) * sway * 0.5;
    this.glCanvas.style.transform = `rotate(${rot}deg) scale(${1 + sway * 0.05 + this.pulse * 0.01})`;

    this.pulse *= 0.02 ** dt;
    this.shimmer *= 0.05 ** dt;
    this.flash *= 0.01 ** dt;
    this.bursts = this.bursts.filter((b) => b.held.size || now - (b.releasedAt ?? now) < 40);
  }

  pourInk(ink, dt, now) {
    const top = this.uvTop();
    for (const b of this.bursts) {
      if (!b.color || !b.notes.length) continue;
      const strength = b.ghost ? 0.5 : 1;
      const col = b.color.map((c) => c / 255);
      if (!b.attacked) {
        // The splash when a chord starts: every note shoots up from its key.
        b.notes.forEach((note, j) => {
          const u = this.deck.keyCenter(note)[0] / innerWidth;
          const shade = 0.85 + (j % 3) * 0.15;
          ink.splat(u, top, (Math.random() - 0.5) * 60, (260 + b.vel * 260) * strength, col.map((c) => c * 0.9 * shade * strength * (0.5 + b.vel)), 0.0014);
        });
        if (!b.ghost && b.chord) this.labels.push({ name: b.chord.name, color: b.color, born: now });
        b.attacked = true;
      } else if (!b.ghost) {
        // While held, the keys keep pouring.
        [...b.held].forEach((note, j) => {
          const u = this.deck.keyCenter(note)[0] / innerWidth;
          const shade = 0.85 + (j % 3) * 0.15;
          ink.splat(u, top, (Math.random() - 0.5) * 30, 170, col.map((c) => c * 0.05 * shade * dt * 60), 0.0006);
        });
      }
    }
  }

  // Newest chord first; each band runs from the previous (newer) chord's edge to its own.
  ringList(now, fx) {
    const history = 12 + fx.reverb * 12;
    const speed = this.maxR / history;
    const rings = [];
    for (let i = this.bursts.length - 1; i >= 0 && rings.length < 32; i--) {
      const b = this.bursts[i];
      if (b.ghost || !b.color) continue;
      const alive = b.held.size ? 1 : Math.exp(-(now - b.releasedAt) / 6);
      rings.push({
        radius: (now - b.born) * speed + 14 * this.dpr, color: b.color, alive,
        sparkle: SHIMMER[b.chord?.type] ?? 0, name: b.chord?.name,
      });
    }
    this.rings = rings;
    return rings;
  }

  // ---------- readable text layer ----------

  hud(now) {
    const g = this.h, d = this.dpr, W = this.W, H = this.H;
    g.clearRect(0, 0, W, H);
    const { seq, looper, chords, engine } = this.src;
    const tnow = performance.now();
    const pad = 26 * d;
    const font = (px, w = 700) => `${w} ${px * d}px Inter, ui-sans-serif, system-ui, sans-serif`;
    // Legibility over the visuals: a dark outline under text (much cheaper than a blurred shadow).
    let outline = true;
    const shadow = (on) => { outline = on; };
    const text = g.fillText.bind(g);
    g.fillText = (str, x, y) => {
      if (outline) {
        g.lineWidth = 5 * d;
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(13,14,22,0.6)';
        g.strokeText(str, x, y);
      }
      text(str, x, y);
    };
    g.textBaseline = 'top';
    // Soft dark fade behind the top readouts so they stay legible over any colour.
    const fade = g.createLinearGradient(0, 0, 0, 150 * d);
    fade.addColorStop(0, 'rgba(13,14,22,0.82)');
    fade.addColorStop(1, 'rgba(13,14,22,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, W, 150 * d);
    shadow(true);

    if (this.error) {
      g.font = font(18);
      g.fillStyle = '#f7768e';
      g.textAlign = 'center';
      g.fillText(`Visuals unavailable: ${this.error}`, W / 2, H / 3);
    }

    // Top left: drums.
    if (seq) {
      const on = seq.playing && !seq.drumsMuted;
      g.textAlign = 'left';
      g.font = font(34, 800);
      g.fillStyle = on ? '#c0caf5' : '#565f89';
      g.fillText(`${seq.bpm}`, pad, pad);
      const bw = g.measureText(`${seq.bpm}`).width;
      g.font = font(13, 700);
      g.fillStyle = '#737aa2';
      g.fillText('BPM', pad + bw + 8 * d, pad + 16 * d);
      g.font = font(15, 600);
      g.fillStyle = '#a9b1d6';
      g.fillText(`${seq.sigId} · ${seq.pattern.name} · ${engine.drums.kit.name}${seq.drumsMuted ? ' · muted' : on ? '' : ' · stopped'}`, pad, pad + 44 * d);
      const { barSteps, beatSteps } = seq.sig;
      const inBar = seq.playing && this.step ? this.step.inBar : -1;
      shadow(false);
      for (let i = 0; i < barSteps; i++) {
        const beat = i % beatSteps === 0;
        g.fillStyle = i === inBar ? '#ff4fa8' : beat ? '#737aa2' : '#3b4261';
        const s = (beat ? 8 : 5) * d;
        g.beginPath();
        g.roundRect(pad + i * 13 * d, pad + 72 * d + (beat ? 0 : 1.5 * d), s, s, 2 * d);
        g.fill();
      }
      shadow(true);
    }

    // Top centre: the chord, in its colour.
    const live = this.bursts.findLast((b) => !b.loop && !b.ghost && b.chord);
    if (live) {
      const held = live.held.size > 0;
      const a = held ? 1 : Math.max(0.3, 1 - (now - live.releasedAt) * 0.25);
      g.textAlign = 'center';
      g.font = font(76, 800);
      g.fillStyle = rgba(live.color, a);
      g.fillText(live.chord.name, W / 2, pad - 8 * d);
    }
    if (chords) {
      g.textAlign = 'center';
      g.font = font(15, 600);
      g.fillStyle = '#737aa2';
      g.fillText(`key of ${NOTE_NAMES[chords.key.tonic]} ${chords.key.mode}`, W / 2, pad + 78 * d);
    }

    // Top right: loop.
    if (looper) {
      const st = looper.state;
      const label = { empty: 'No loop yet', armed: 'Get ready', recording: '● Recording', playing: '▶ Looping', overdub: '● Adding layer', stopped: '■ Loop paused' }[st];
      const col = { empty: '#565f89', armed: '#e0af68', recording: '#f7768e', playing: '#9ece6a', overdub: '#f7768e', stopped: '#737aa2' }[st];
      g.textAlign = 'right';
      g.font = font(20, 800);
      g.fillStyle = col;
      g.fillText(label, W - pad, pad);
      if (looper.hasLoop) {
        g.font = font(14, 600);
        g.fillStyle = '#a9b1d6';
        g.fillText(`${looper.bars} bar${looper.bars === 1 ? '' : 's'} · ${looper.layers.length} layer${looper.layers.length === 1 ? '' : 's'}`, W - pad, pad + 30 * d);
        const bw = 180 * d, bx = W - pad - bw, by = pad + 56 * d;
        shadow(false);
        g.fillStyle = 'rgba(36,40,59,0.9)';
        g.fillRect(bx, by, bw, 5 * d);
        if (this.step && (st === 'playing' || st === 'overdub')) {
          const pos = ((((this.step.global - looper.start) % looper.length) + looper.length) % looper.length + 1) / looper.length;
          g.fillStyle = col;
          g.fillRect(bx, by, bw * pos, 5 * d);
        }
        looper.layers.forEach((l, i) => {
          g.fillStyle = l.muted ? '#3b4261' : l.preset.color;
          g.beginPath();
          g.arc(W - pad - 6 * d - i * 18 * d, by + 20 * d, 6 * d, 0, Math.PI * 2);
          g.fill();
        });
        shadow(true);
      }
    }

    // Chord names in the picture: on each ring, or rising out of the ink.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const ox = this.originCss[0] * d, oy = this.originCss[1] * d;
    if (this.look === 1 && this.rings) {
      let inner = 14 * d;
      shadow(false);
      for (const r of this.rings) {
        const mid = (inner + r.radius) / 2;
        if (r.radius - inner > 26 * d && r.name && oy - mid > 130 * d) {
          g.font = font(17, 800);
          g.fillStyle = `rgba(13,14,22,${0.5 + 0.4 * r.alive})`;
          g.fillText(r.name, ox, oy - mid);
        }
        inner = r.radius;
      }
      shadow(true);
    } else if (this.look === 0) {
      for (const l of this.labels) {
        const age = now - l.born;
        g.font = font(18, 800);
        g.fillStyle = rgba(l.color, Math.max(0, 1 - age / 9));
        g.fillText(l.name, ox, oy - 30 * d - age * 42 * d);
      }
      this.labels = this.labels.filter((l) => now - l.born < 9);
    }

    // Knob popup.
    if (this.popup) {
      const a = Math.max(0, Math.min(1, 1.8 - ((tnow - this.popup.at) / 1000) * 1.2));
      if (a > 0) {
        const { index, page } = this.popup;
        const knob = this.src.knobs()[index];
        const v = knob.get();
        const col = KNOB_COLORS[index];
        const cx = W / 2, cy = oy * 0.52, r = 74 * d;
        g.globalAlpha = a;
        shadow(false);
        g.fillStyle = 'rgba(13,14,22,0.75)';
        g.beginPath(); g.arc(cx, cy, r + 26 * d, 0, Math.PI * 2); g.fill();
        g.lineCap = 'round';
        g.lineWidth = 10 * d;
        g.strokeStyle = '#2f334d';
        g.beginPath(); g.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI); g.stroke();
        g.strokeStyle = col;
        g.beginPath(); g.arc(cx, cy, r, 0.75 * Math.PI, (0.75 + v * 1.5) * Math.PI); g.stroke();
        g.save();
        g.translate(cx - 22 * d, cy - 52 * d);
        g.scale((44 * d) / 24, (44 * d) / 24);
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.strokeStyle = col;
        g.stroke(ICON_PATHS[KNOB_ICONS[page][index]]);
        g.restore();
        g.lineCap = 'butt';
        g.font = font(18, 800);
        g.fillStyle = col;
        g.fillText(KNOB_LABELS[page][index].toUpperCase(), cx, cy + 16 * d);
        g.font = font(26, 800);
        g.fillStyle = '#c0caf5';
        g.fillText(knob.fmt ? knob.fmt() : `${Math.round(v * 100)}%`, cx, cy + 44 * d);
        g.globalAlpha = 1;
      } else {
        this.popup = null;
      }
    }

    // Look name after switching.
    const la = 2 - (tnow - this.lookPopupAt) / 1000;
    if (la > 0 && this.looks[this.look]) {
      g.globalAlpha = Math.min(1, la);
      g.font = font(28, 800);
      g.fillStyle = '#ff4fa8';
      g.fillText(this.looks[this.look].name.toUpperCase(), W / 2, oy * 0.5);
      g.globalAlpha = 1;
    }
    if (this.flash > 0.02) {
      g.fillStyle = `rgba(255,79,168,${this.flash * 0.12})`;
      g.fillRect(0, 0, W, H);
    }
    shadow(false);
    g.fillText = text;
    g.textBaseline = 'alphabetic';
  }
}
