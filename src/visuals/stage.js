import { bus } from '../bus.js';
import { NOTE_NAMES } from '../chords.js';
import { createGL } from './gl.js';
import { Rings } from './rings.js';
import { Deck } from './deck.js';
import { ICON, KNOB_ICONS, KNOB_LABELS } from './icons.js';
import { KNOB_COLORS, pitchColor } from './palette.js';
import { SHIMMER, analyzeChord, chordColor } from './chordColor.js';
import { ChordLabel } from './chordLabel.js';

const CHORD_GAP_MS = 70; // notes closer together than this belong to the same chord
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Petals per interval above the chord's root, after the harmonic series (a fifth is 3:2, a fourth
// 4:3, a major third 5:4...): the sweeter the interval, the fewer and broader the petals.
const PETALS = [2, 10, 8, 6, 5, 4, 9, 3, 7, 5, 7, 9];
const ICON_PATHS = Object.fromEntries(Object.entries(ICON).map(([k, d]) => [k, new Path2D(d)]));

// Full-screen stage: the Tree Rings (GPU) underneath, a crisp text layer on top, and
// the deck (on-screen MPK + what-to-do-next guide) along the bottom.
export class Stage {
  constructor(root, src) {
    this.root = root;
    this.src = src; // { engine, seq, looper, chords, joy, knobs(), page(), preset() }
    this.glCanvas = root.querySelector('.screen');
    this.hudCanvas = root.querySelector('.hud');
    this.h = this.hudCanvas.getContext('2d');
    this.deck = new Deck(root.querySelector('.deck'), src);
    this.label = new ChordLabel(src);
    try {
      this.glx = createGL(this.glCanvas);
      this.looks = [new Rings(this.glx)];
    } catch (e) {
      console.error(e);
      this.error = e.message;
      this.looks = [];
    }
    this.look = 0;
    this.bursts = [];
    this.pulses = []; // Claude's solo notes, bending the rings as they travel out
    this.bikes = new Map(); // solo part -> its light bike
    this.pulse = 0;
    this.shimmer = 0;
    this.flash = 0;
    this.popup = null;
    this.lookPopupAt = -1e9;
    this.step = null;
    addEventListener('resize', () => this.resize());
    // If the graphics driver resets, wait for the context to come back and rebuild the shaders.
    this.glCanvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.glCanvas.addEventListener('webglcontextrestored', () => {
      this.glx = createGL(this.glCanvas);
      this.looks = [new Rings(this.glx)];
      this.resize();
    });
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
    bus.on('solo', (e) => this.onSolo(e));
    bus.on('chord', (e) => this.label.chord(e.name));
    bus.on('drum', (e) => this.onDrum(e));
    bus.on('knob', (e) => { this.popup = { ...e, at: performance.now() }; });
    bus.on('pad', (e) => this.deck.pad(e));
    bus.on('step', (e) => { this.step = e; });
    bus.on('hint', (e) => { this.hint = e && { ...e, at: performance.now() }; });
  }

  newBurst(loop, now) {
    const b = { notes: [], held: new Set(), born: now, releasedAt: null, vel: 0, loop, ghost: 0, seed: Math.random() * 100 };
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
    if (!loop) this.label.note(note, true);
    let b = this.bursts.findLast((x) => x.loop === loop && !x.ghost && !x.drum);
    if (!b || b.releasedAt != null || (now - b.born) * 1000 > CHORD_GAP_MS) b = this.newBurst(loop, now);
    if (!b.notes.includes(note)) b.notes.push(note);
    b.held.add(note);
    b.vel = Math.max(b.vel, vel / 127);
    b.chord = analyzeChord(b.notes);
    b.color = chordColor(b.chord);
  }

  onNoteOff({ note, loop = false }) {
    const now = performance.now() / 1000;
    if (!loop) this.label.note(note, false);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      if (b.loop === loop && b.held.has(note)) {
        b.held.delete(note);
        if (!b.held.size) b.releasedAt = now;
        return;
      }
    }
  }

  // A solo note fires a pulse out from the centre that bends the rings into petals as it passes
  // (see rings.js). The interval it makes with the loop's chord picks the petals: sweet intervals
  // make a few broad ones, clashing ones many fine ones. They point at the light bike that
  // played it, and the pulse glows faintly in the note's own colour.
  onSolo({ part, note, vel, dur, expr, frac, sweepSec, color, square }) {
    const now = performance.now() / 1000;
    const root = this.bursts.findLast((b) => b.loop && b.chord)?.chord.root ?? this.src.chords?.key.tonic ?? 0;
    const petals = PETALS[(note - root + 120) % 12];
    const angle = Math.PI * (1 - frac);
    this.pulses.push({ born: now, angle, petals, note, vel, dur, expr, color: pitchColor(note), square });
    if (this.pulses.length > 60) this.pulses.shift();
    const bike = this.bikes.get(part) ?? { trail: [], ring: null };
    Object.assign(bike, { frac, at: now, sweepSec, color: hexRgb(color), last: now });
    this.bikes.set(part, bike);
  }

  // Where a ring's leading edge is now (as in ringList).
  ringEdge(ring, now) {
    return (now - ring.born) * (this.ringSpeed ?? 100) + 14 * this.dpr;
  }

  get rideRadius() { return (this.maxR ?? 800) * 0.3; }

  // The ring whose band covers radius r: the newest one whose edge is already past it.
  ringAt(r, now) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      if (!b.ghost && b.color && this.ringEdge(b, now) > r) return b;
    }
    return null;
  }

  // Each pulse travels out with the rings. Its petals are deepest for loud, held notes; vibrato
  // sways them; they soften as they go.
  pulseList(now) {
    const speed = this.ringSpeed ?? 100, d = this.dpr;
    this.pulses = this.pulses.filter((p) => (now - p.born) * speed < (this.maxR ?? 2000) * 1.3);
    return this.pulses.slice(-24).map((p) => {
      const age = now - p.born;
      const vib = p.expr?.vib ? Math.sin(age * 34) * 0.05 * p.expr.vib : 0;
      const hold = Math.min(1, Math.sqrt(p.dur / 0.3));
      return {
        radius: age * speed + 14 * d, angle: p.angle + vib, petals: p.petals,
        depth: (p.vel / 127) * 26 * d * hold / Math.sqrt(p.petals / 2) * Math.exp(-age / 10),
        color: p.color, square: p.square,
      };
    });
  }

  // How far the pulses have bent the rings at (r, angle), as the shader does it.
  bendAt(r, ang, pulses) {
    let s = 0;
    for (const p of pulses) {
      const x = (r - p.radius) / (90 * this.dpr);
      s += p.depth * Math.exp(-x * x) * Math.cos(p.petals * (ang - p.angle));
    }
    return s;
  }

  // Light bikes: each solo part rides a ring edge (bent with the petals) round the circle, once a
  // bar of the solo's own time, leaving a hard neon trail. When its ring has carried it too far
  // out it cuts straight back in to the ring passing a third of the way out.
  drawBikes(g, now, pulses, zoom) {
    const d = this.dpr, ox = this.originCss[0] * d, oy = this.originCss[1] * d, R0 = this.rideRadius;
    for (const [part, bike] of this.bikes) {
      if (now - bike.last > 2.5) {
        bike.trail = bike.trail.filter((p) => now - p.t < 1.4);
        if (!bike.trail.length) this.bikes.delete(part);
      } else {
        if (!bike.ring || this.ringEdge(bike.ring, now) > R0 * 1.5) bike.ring = this.ringAt(R0, now);
        const frac = (bike.frac + (now - bike.at) / bike.sweepSec) % 1;
        const ang = Math.PI * (1 - frac);
        const edge = bike.ring ? this.ringEdge(bike.ring, now) : R0;
        const r = edge + this.bendAt(edge, ang, pulses) - 5 * d;
        const prev = bike.trail[bike.trail.length - 1];
        // Coming back round to the start: a new trail, not a line across the screen.
        bike.trail.push({ x: ox + Math.cos(ang) * r * zoom, y: oy - Math.sin(ang) * r * zoom, t: now, gap: prev && frac < prev.frac, frac });
        bike.trail = bike.trail.filter((p) => now - p.t < 1.4);
      }
      const [cr, cg, cb] = bike.color;
      g.lineCap = 'square';
      for (let i = 1; i < bike.trail.length; i++) {
        const a = bike.trail[i - 1], b = bike.trail[i];
        if (b.gap) continue;
        const fade = 1 - (now - b.t) / 1.4;
        g.strokeStyle = `rgba(${cr},${cg},${cb},${0.85 * fade})`;
        g.lineWidth = 4 * d;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.strokeStyle = `rgba(255,255,255,${0.9 * fade})`;
        g.lineWidth = 1.2 * d;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      const head = bike.trail[bike.trail.length - 1];
      if (head && now - bike.last <= 2.5) {
        g.fillStyle = `rgb(${cr},${cg},${cb})`;
        g.fillRect(head.x - 5 * d, head.y - 5 * d, 10 * d, 10 * d);
        g.fillStyle = '#ffffff';
        g.fillRect(head.x - 2.5 * d, head.y - 2.5 * d, 5 * d, 5 * d);
      }
    }
  }

  onDrum({ sound, vel }) {
    const rings = this.looks[0];
    switch (sound) {
      case 'kick':
        this.pulse = Math.min(1.5, this.pulse + vel);
        rings?.kick(vel); // a bright ripple runs out through the rings
        this.kickRing(vel);
        break;
      case 'snare':
      case 'clap':
        rings?.snare(vel); // the pixels jump off their spots
        this.shimmer = Math.min(1.5, this.shimmer + 0.4 * vel);
        break;
      case 'crash':
        this.flash = 1;
        break;
      case 'chh': case 'shaker': case 'ohh':
        this.shimmer = Math.min(1.5, this.shimmer + (sound === 'ohh' ? 0.6 : 0.25) * vel); // glitter
        break;
    }
  }

  // With no chord held, each kick sends out a dim ring in the last chord's colour, so the drums
  // alone keep the picture alive instead of every ring drifting off and leaving it dark.
  kickRing(vel) {
    if (this.bursts.some((b) => !b.drum && b.held.size)) return;
    const last = this.bursts.findLast((b) => !b.drum && b.color);
    const now = performance.now() / 1000;
    this.bursts.push({
      notes: [], held: new Set(), born: now, releasedAt: now, vel, loop: false, ghost: 0, drum: true,
      seed: Math.random() * 100, color: last?.color ?? [90, 110, 220], chord: last?.chord ?? null,
    });
  }

  // ---------- frame ----------

  fx() {
    const e = this.src.engine;
    const v = e.sound.values, m = e.sound.macros; // the live sound's pedals and room
    return {
      exposure: 0.45 + m.brightness * 1.1,
      split: v.chorus,
      heat: v.drive,
      resonance: m.resonance,
      echo: v.echo,
      pulse: this.pulse,
      shimmer: this.shimmer * 0.8,
      cell: 7 * this.dpr,
      wobble: v.wobble,
      rippleSpeed: 1100 * this.dpr,
      reverb: v.reverb,
      dpr: this.dpr,
    };
  }

  frame(tms) {
    if (!this.visible) { this.raf = null; return; }
    this.raf = requestAnimationFrame((t) => this.frame(t));
    try {
      this.draw(tms);
    } catch (e) {
      // Never let one bad frame stop the visuals for good; log it (once a second at most).
      if (!this.lastErrorAt || tms - this.lastErrorAt > 1000) console.error('stage frame', e);
      this.lastErrorAt = tms;
    }
  }

  draw(tms) {
    const dt = Math.min(0.04, (tms - this.last) / 1000);
    this.last = tms;
    const now = tms / 1000;
    if (!this.originCss) this.resize();
    const fx = this.fx();

    const look = this.looks[this.look];
    const rings = this.ringList(now, fx);
    this.pulseNow = this.pulseList(now);
    look?.render(dt, now, fx, rings, [this.originCss[0] * this.dpr, this.H - this.originCss[1] * this.dpr], this.pulseNow);

    this.hud(now, fx);
    this.deck.update({ sustain: this.src.sustain?.() });
    const live = this.bursts.findLast((b) => !b.loop && !b.ghost && b.held.size);
    this.deck.lightKeys(live ? [...live.held] : [], live?.color ?? [0, 0, 0], this.src.loopSlots?.());

    // Hotline Miami camera: sway and tilt with tape wobble, punch in on the kick.
    const sway = fx.wobble;
    const rot = Math.sin(now * 0.55) * sway * 2.2 + Math.sin(now * 1.7) * sway * 0.5;
    this.glCanvas.style.transform = `rotate(${rot}deg) scale(${1 + sway * 0.05 + this.pulse * 0.01})`;

    this.pulse *= 0.02 ** dt;
    this.shimmer *= 0.05 ** dt;
    this.flash *= 0.01 ** dt;
    // Forget old chords, but always keep the most recent one: its band fills the screen, so the
    // stage never goes black between ideas.
    const newest = this.bursts.findLast((b) => !b.drum && !b.ghost);
    this.bursts = this.bursts.filter((b) => b === newest || b.held.size || now - (b.releasedAt ?? now) < 40);
    if (this.bursts.length > 40) this.bursts.splice(0, this.bursts.length - 40);
  }

  // Newest chord first; each band runs from the previous (newer) chord's edge to its own.
  ringList(now, fx) {
    const history = 12 + fx.reverb * 5; // reverb: slower waves that linger (and the camera pulls back)
    const speed = (this.ringSpeed = this.maxR / history);
    fx.echoGap = this.src.engine.fx.echoDelay.delayTime.value * speed; // echo ghosts, one delay apart
    fx.maxR = this.maxR;
    const rings = [];
    for (let i = this.bursts.length - 1; i >= 0 && rings.length < 32; i--) {
      const b = this.bursts[i];
      if (b.ghost || !b.color) continue;
      const alive = b.drum ? 0.3 * Math.exp(-(now - b.born) / 4) : b.held.size ? 1 : Math.exp(-(now - b.releasedAt) / 6);
      rings.push({
        radius: (now - b.born) * speed + 14 * this.dpr, color: b.color, alive,
        seed: b.seed, sparkle: SHIMMER[b.chord?.type] ?? 0,
      });
    }
    return rings;
  }

  // ---------- readable text layer ----------

  hud(now, fx) {
    const g = this.h, d = this.dpr, W = this.W, H = this.H;
    g.clearRect(0, 0, W, H);
    this.drawBikes(g, now, this.pulseNow ?? [], 1 - fx.reverb * 0.45); // under the text
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
      g.fillText(`${seq.sigId} · ${seq.pattern.name} · ${engine.drums.kit.name}${seq.drumsMuted ? ' · muted' : on ? '' : seq.paused ? ' · paused' : ' · stopped'}`, pad, pad + 44 * d);
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

    // Top centre: the chord (or, in notes mode, the note), in pixels like the rings.
    shadow(false);
    this.label.draw(g, W, pad - 14 * d, d, this.fx());
    shadow(true);

    // Top right: loop.
    if (looper) {
      const st = looper.state;
      const label = { empty: 'No loop yet', armed: 'Get ready', cued: 'Layer from the top…', recording: '● Recording', playing: seq?.paused ? '❚❚ Paused' : '▶ Looping', overdub: '● Adding layer', stopped: '■ Loop stopped' }[st];
      const col = { empty: '#565f89', armed: '#e0af68', cued: '#e0af68', recording: '#f7768e', playing: '#9ece6a', overdub: '#f7768e', stopped: '#737aa2' }[st];
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

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const oy = this.originCss[1] * d;

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

    // Short popups: sound / mode / key changes, and the key-select prompt while pad 6 is held.
    if (this.hint) {
      const a = this.hint.sticky ? 1 : Math.max(0, Math.min(1, 2 - ((tnow - this.hint.at) / 1000) * 1.3));
      if (a > 0) {
        g.globalAlpha = a;
        g.font = font(24, 800);
        const tw = g.measureText(this.hint.text).width;
        const cy = oy - 46 * d;
        g.fillStyle = 'rgba(13,14,22,0.8)';
        g.beginPath();
        g.roundRect(W / 2 - tw / 2 - 22 * d, cy - 22 * d, tw + 44 * d, 44 * d, 22 * d);
        g.fill();
        shadow(false);
        g.fillStyle = this.hint.color ?? '#c0caf5';
        g.fillText(this.hint.text, W / 2, cy);
        shadow(true);
        g.globalAlpha = 1;
      } else {
        this.hint = null;
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
