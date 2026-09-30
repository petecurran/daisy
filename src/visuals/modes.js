// The looks. Each mode says how the trail layer should move (zoom/rotate/decay) and draws the
// current light: crisp onto the screen (g), and a faint copy into the trail (tg) for history.
// Bursts = chords (or single notes): { notes, colors, held, born, releasedAt, vel, ghost, seed, name }.

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, a)})`;
const age = (b, now) => now - b.born;
const releasedAge = (b, now) => (b.releasedAt == null ? 0 : Math.max(0, now - b.releasedAt));
const PINK = [255, 79, 168];
const CYAN = [13, 185, 215];

// Half-ring path from angle a0 to a1 (0 = right, PI = left), wobbling with tape wobble.
function arcPath(g, st, r, a0, a1, wobble, now, seed, moveFirst = true) {
  const segs = Math.max(6, Math.ceil(((a1 - a0) * r) / (5 * st.dpr)));
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    const rr = r + Math.sin(a * 6 + now * 2.3 + seed) * wobble * 10 * st.dpr;
    const x = st.ox + Math.cos(a) * rr, y = st.oy - Math.sin(a) * rr;
    if (i === 0 && moveFirst) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

// 1. TREE RINGS: every chord is a band expanding from the MPK. Holding the chord thickens the band;
// each note is a coloured segment (low notes left, high notes right); the chord name rides on top.
const rings = {
  name: 'Tree Rings',
  feedback: (p) => ({ zoom: 1.004, decay: 0.72 + p.reverb * 0.22 }),
  draw(st, p, now, dt, g, tg) {
    const d = st.dpr;
    const history = 10 + p.reverb * 8;
    const speed = st.maxR / history;
    const dash = p.resonance > 0.6 ? [3 * d, (2 + (p.resonance - 0.6) * 20) * d] : [];
    for (const b of st.bursts) {
      const grow = 1 + st.pulse * 0.02;
      const outer = (age(b, now) * speed + 8 * d) * grow;
      const inner = Math.max(8 * d, releasedAge(b, now) * speed + 8 * d) * grow;
      if (inner > st.maxR) continue;
      const fade = Math.exp(-releasedAge(b, now) / (history * 0.5)) * (b.ghost ? 0.4 : 1);
      const alpha = (0.45 + b.vel * 0.55) * fade;
      const n = b.colors.length;
      g.setLineDash(dash);
      for (let j = 0; j < n; j++) {
        const a1 = Math.PI * (1 - j / n), a0 = Math.PI * (1 - (j + 1) / n);
        const col = b.colors[j];
        // Band body.
        if (outer - inner > 3 * d) {
          g.fillStyle = rgba(col, alpha * 0.1);
          g.beginPath();
          arcPath(g, st, outer, a0, a1, p.wobble, now, b.seed);
          arcPath(g, st, inner, a1, a0, p.wobble, now, b.seed, false);
          g.closePath();
          g.fill();
        }
        // Bright leading edge (and trailing edge once released).
        g.lineWidth = (2.2 + st.pulse * 2.5) * d;
        g.strokeStyle = rgba(col, alpha);
        g.beginPath(); arcPath(g, st, outer, a0, a1, p.wobble, now, b.seed); g.stroke();
        if (b.releasedAt != null && outer - inner > 3 * d) {
          g.lineWidth = 1.2 * d;
          g.strokeStyle = rgba(col, alpha * 0.6);
          g.beginPath(); arcPath(g, st, inner, a0, a1, p.wobble, now, b.seed); g.stroke();
        }
        // Chorus: pink/cyan doubled edges.
        if (p.chorus > 0.05) {
          const off = p.chorus * 7 * d;
          g.lineWidth = 1.2 * d;
          g.strokeStyle = rgba(PINK, alpha * 0.4);
          g.beginPath(); arcPath(g, st, outer + off, a0, a1, p.wobble, now, b.seed + 1); g.stroke();
          g.strokeStyle = rgba(CYAN, alpha * 0.4);
          g.beginPath(); arcPath(g, st, outer - off, a0, a1, p.wobble, now, b.seed + 2); g.stroke();
        }
        tg.lineWidth = 2 * d;
        tg.strokeStyle = rgba(col, alpha * 0.18);
        tg.beginPath(); arcPath(tg, st, outer, a0, a1, p.wobble, now, b.seed); tg.stroke();
      }
      g.setLineDash([]);
      // Chord name on top of its ring: the rings read as your progression, newest at the bottom.
      if (b.name && !b.ghost) {
        g.font = `700 ${14 * d}px ui-monospace, monospace`;
        g.textAlign = 'center';
        g.fillStyle = rgba(b.colors[Math.floor(n / 2)], Math.min(1, alpha * 1.3));
        g.fillText(b.name, st.ox, st.oy - outer - 7 * d);
      }
    }
  },
};

// 2. WARP TUNNEL: every chord is a mountain line (a peak per note, low notes left) born small just
// above the MPK and flying up and out towards you. Unknown Pleasures on a synthwave highway.
const tunnel = {
  name: 'Warp Tunnel',
  feedback: (p, st) => ({ zoom: 1.012 + st.pulse * 0.01, decay: 0.8 + p.reverb * 0.15 }),
  draw(st, p, now, dt, g, tg) {
    const { W, ox, oy, dpr: d } = st;
    // Horizon.
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(255,79,168,0)');
    grad.addColorStop(0.5, `rgba(255,79,168,${0.5 + st.pulse * 0.4})`);
    grad.addColorStop(1, 'rgba(255,79,168,0)');
    g.fillStyle = grad;
    g.fillRect(0, oy - 1 * d, W, 2 * d);

    const growth = 0.55 - p.reverb * 0.2;
    for (const b of st.bursts) {
      const s = 0.06 * Math.exp(age(b, now) * growth);
      const y0 = oy - s * oy * 0.6;
      if (y0 < -oy * 0.3) continue;
      const width = W * 1.05 * s;
      const fade = (b.held.size ? 1 : Math.exp(-releasedAge(b, now) * 0.3)) * (b.ghost ? 0.4 : 1);
      const alpha = (0.45 + b.vel * 0.55) * fade;
      const peakH = s * oy * 0.28 * (1 + st.pulse * 0.6) * (0.6 + p.resonance);
      const sharp = 0.015 + (1 - p.resonance) * 0.035;
      const pts = 120;
      const xs = [], ys = [], cs = [];
      for (let i = 0; i <= pts; i++) {
        const u = i / pts;
        let h = 0, best = 0, col = b.colors[0];
        b.notes.forEach((note, j) => {
          const pos = Math.min(1, Math.max(0, (note - 30) / 66));
          const v = Math.max(0, 1 - Math.abs(u - pos) / sharp);
          h += v * v * (3 - 2 * v);
          if (v > best) { best = v; col = b.colors[j]; }
        });
        h += Math.sin(u * 40 + now * 5 + b.seed) * 0.04 * p.wobble;
        xs.push(ox + (u - 0.5) * width);
        ys.push(y0 - h * peakH);
        cs.push(col);
      }
      const lw = (1 + s * 1.5) * d * (1 + st.pulse);
      // One path per run of same-coloured segments.
      const strokeRuns = (dx, width, colorFor) => {
        g.lineWidth = width;
        let i = 1;
        while (i <= pts) {
          const col = cs[i];
          g.strokeStyle = colorFor(col);
          g.beginPath();
          g.moveTo(xs[i - 1] + dx, ys[i - 1]);
          while (i <= pts && cs[i] === col) { g.lineTo(xs[i] + dx, ys[i]); i++; }
          g.stroke();
        }
      };
      strokeRuns(0, lw, (col) => rgba(col, alpha));
      if (p.chorus > 0.05) {
        const off = p.chorus * 5 * d;
        strokeRuns(-off, d, () => rgba(PINK, alpha * 0.35));
        strokeRuns(off, d, () => rgba(CYAN, alpha * 0.35));
      }
      tg.lineWidth = lw;
      tg.strokeStyle = rgba(b.colors[0], alpha * 0.12);
      tg.beginPath(); xs.forEach((x, i) => (i ? tg.lineTo(x, ys[i]) : tg.moveTo(x, ys[i]))); tg.stroke();
      if (b.name && !b.ghost && s > 0.12) {
        g.font = `700 ${Math.min(26, 10 + s * 12) * d}px ui-monospace, monospace`;
        g.textAlign = 'right';
        g.fillStyle = rgba(b.colors[0], alpha);
        g.fillText(b.name, xs[0] - 6 * d, ys[0]);
      }
    }
  },
};

// 3. INK: thousands of particles poured out of the MPK while a chord is held, carried outward on a
// swirling current and streaking as they go. Kick shoves the current; tape wobble stirs it.
const ink = {
  name: 'Ink',
  feedback: (p) => ({ zoom: 1.0, decay: 0.9 + p.reverb * 0.08 }),
  draw(st, p, now, dt, g, tg) {
    const d = st.dpr;
    st.ink ??= [];
    st.inkLabels ??= [];
    // Pour.
    for (const b of st.bursts) {
      const a = age(b, now);
      if (!(b.held.size || a < 0.25)) continue;
      if (b.name && !b.ghost && !b.labelled) {
        b.labelled = true;
        st.inkLabels.push({ name: b.name, color: b.colors[Math.floor(b.colors.length / 2)], born: now });
      }
      const n = b.colors.length;
      const rate = (a < 0.2 ? 900 : 160) * (0.5 + b.vel) * (b.ghost ? 0.4 : 1);
      b.colors.forEach((col, j) => {
        const count = Math.floor(rate * dt + Math.random());
        const dir = Math.PI * (1 - (j + 0.5) / n); // low notes pour left, high notes right
        for (let k = 0; k < count && st.ink.length < 4000; k++) {
          const ang = dir + (Math.random() - 0.5) * (Math.PI / n);
          const v = (60 + Math.random() * 90) * d;
          st.ink.push({ x: st.ox + Math.cos(ang) * 8 * d, y: st.oy - Math.sin(ang) * 8 * d, vx: Math.cos(ang) * v, vy: -Math.sin(ang) * v, col, life: 1 });
        }
      });
    }
    // Flow: outward push + a slow curling current.
    const turb = (40 + p.wobble * 160) * d;
    const push = (1 + st.pulse * 5) * 30 * d;
    const size = 2.2 * d;
    const t = now * 0.35;
    // Batch by colour and brightness step: a handful of fills instead of one per particle.
    const batches = new Map();
    for (const q of st.ink) {
      const dx = q.x - st.ox, dy = q.y - st.oy;
      const r = Math.hypot(dx, dy) + 1;
      const nx = (q.x * 0.0035) / d, ny = (q.y * 0.0035) / d;
      const ang = Math.sin(nx + t) * 2 + Math.cos(ny * 1.3 - t * 1.1) * 2 + Math.sin((nx + ny) * 0.7 + t * 0.6);
      q.vx += (Math.cos(ang) * turb + (dx / r) * push) * dt;
      q.vy += (Math.sin(ang) * turb + (dy / r) * push) * dt;
      q.vx *= 1 - 0.6 * dt;
      q.vy *= 1 - 0.6 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt * (0.12 + (1 - p.reverb) * 0.12);
      const step = Math.min(3, Math.floor(q.life * 4));
      let byCol = batches.get(q.col);
      if (!byCol) batches.set(q.col, (byCol = [[], [], [], []]));
      byCol[step].push(q.x - size / 2, q.y - size / 2);
    }
    for (const [col, steps] of batches) {
      steps.forEach((pts, i) => {
        if (!pts.length) return;
        const a = (i + 0.5) / 4;
        g.fillStyle = rgba(col, a * 0.9);
        g.beginPath();
        for (let k = 0; k < pts.length; k += 2) g.rect(pts[k], pts[k + 1], size, size);
        g.fill();
        tg.fillStyle = rgba(col, a * 0.25);
        tg.beginPath();
        for (let k = 0; k < pts.length; k += 2) tg.rect(pts[k], pts[k + 1], size, size);
        tg.fill();
      });
    }
    st.ink = st.ink.filter((q) => q.life > 0 && q.y > -20 && q.y < st.H && q.x > -20 && q.x < st.W + 20);
    // Chord names drift up out of the ink and fade: a readable history.
    g.textAlign = 'center';
    for (const l of st.inkLabels) {
      const a = now - l.born;
      g.font = `700 ${15 * d}px ui-monospace, monospace`;
      g.fillStyle = rgba(l.color, Math.max(0, 1 - a / 10));
      g.fillText(l.name, st.ox, st.oy - 20 * d - a * 38 * d);
    }
    st.inkLabels = st.inkLabels.filter((l) => now - l.born < 10);
  },
};

export const MODES = [rings, tunnel, ink];
