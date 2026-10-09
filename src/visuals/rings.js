// TREE RINGS: after Josef Albers' nested colour fields. Every chord is a band of its colour that
// grows out of the keyboard and fills back to the chord before it, so the screen is mostly colour.
// Each band is made of its own pixels: they ride outward with the wave and fan apart as it grows,
// and near the edges of the screen they scatter and drop out, so waves dissolve into dust.
// Knobs reshape the waves: wobble bends, resonance makes the edges ring, chorus doubles, echo
// leaves ghost edges, drive turns it grungy (dark, gritty, glitching), reverb pulls the camera
// back into the distance.
// Claude's solos reshape the rings: each note fires a pulse out from the centre that bends the
// rings it passes into a flower of petals (see Stage.pulseList).

const MAX = 32;
const MAXD = 24;

const FRAG = `
#define MAX ${MAX}
#define MAXD ${MAXD}
#define PI 3.14159265
uniform int count;
uniform float radii[MAX];     // leading edge of each chord's band (px), newest first
uniform vec3 colors[MAX];
uniform float alive[MAX];     // 1 while held, fading after release
uniform float seeds[MAX];
uniform vec4 phase[MAX];      // cos/sin of each ring's two wobble phases (worked out on the CPU)
uniform float sparkle[MAX];   // extra glitter for colourful chords (9ths etc.)
uniform int dropCount;
uniform vec4 drops[MAXD];     // solo pulses: radius, angle the petals point at, petals, depth (px)
uniform vec4 dropInfo[MAXD];  // the note's colour, and how square (driven) its petals are
uniform vec2 origin, res;
uniform float maxR;
uniform float time, pulse, ripple, rippleAmp, shimmer, scatter, wobble, ringing, split, echoGap, echo, cell, heat, exposure, zoom, reverb, dpr;

// Dave Hoskins' sine-free hash: the usual fract(sin(...)) one turns into visible stripes once
// its inputs get large (pixel coordinates x a running clock), which read as VHS lines.
float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// The wave's edge, bent by tape wobble: sin(6 ang + phase1) and sin(13 ang + phase2), opened up
// with the angle-sum rule so the per-pixel part (a = sin/cos of 6 ang and 13 ang) is worked out
// once per pixel and the per-ring part (w = cos/sin of the phases) once per frame. The loop over
// the rings then has no trig in it at all.
float shapeOffset(vec4 w, vec4 a) {
  return (a.x * w.x + a.y * w.y) * wobble * 22.0 + (a.z * w.z + a.w * w.w) * wobble * 7.0;
}

// The kick ripple dents every wave's edge the same amount at a given radius.
float dent(float r) {
  float x = (r - ripple) / 40.0;
  return rippleAmp * 16.0 * exp(-x * x);
}

// Colour of ring i's band at radius r, whose (bent) edge is at radius edge.
vec3 paint(int i, float r, float ang, float edge) {
  vec3 col = colors[i] * (0.4 + 0.6 * alive[i]);
  // Dissolve: dense and solid for most of the screen, breaking into dust towards the edges.
  float age = smoothstep(0.5, 1.0, r / maxR);
  float depth = edge - r;                  // px behind the leading edge: travels with the wave

  // The wave's own pixel lattice: rows in depth, a fixed number of columns around the arc, so
  // the columns fan apart as the wave grows.
  float cols = 300.0; // around the full circle
  float arc = max(r, 1.0) * 2.0 * PI / cols;
  float rowF = depth / cell, colF = (ang + PI) / (2.0 * PI) * cols;
  vec2 id = floor(vec2(rowF, colF));
  float h = hash(vec3(id, seeds[i]));
  float h2 = hash(vec3(id.yx, seeds[i] + 7.0));
  // Scatter: with age (and snare hits) each pixel drifts off its spot and some drop out.
  float drift = (age * 0.9 + scatter) * cell;
  vec2 local = vec2(fract(rowF) * cell, fract(colF) * arc);
  vec2 centre = vec2(cell * 0.5 + (h - 0.5) * drift, arc * 0.5 + (h2 - 0.5) * drift * 1.5);
  float size = cell * 0.42;
  float inside = step(abs(local.x - centre.x), size) * step(abs(local.y - centre.y), size);
  float survive = step(age * 1.05, h * 0.95 + 0.05);
  float twinkle = hash(vec3(id, floor(time * 12.0) + seeds[i]));
  float glow = 0.75 + 0.35 * h + (shimmer + sparkle[i]) * (twinkle - 0.5) * 0.9;
  vec3 c = col * inside * survive * glow;

  // A soft wash of the band's colour behind its pixels, so the screen reads as colour.
  c += col * 0.16 * (1.0 - age * 0.8);
  // Bright leading edge; resonance makes it ring, with faint lines just behind it.
  c += col * (0.7 + ringing * 0.8) * smoothstep(cell * (1.6 - ringing * 0.8), 0.0, depth);
  if (ringing > 0.0) {
    float rg = cell * 1.3;
    c += col * ringing * 0.5 * (smoothstep(1.2, 0.0, abs(depth - rg * 1.5)) + 0.5 * smoothstep(1.2, 0.0, abs(depth - rg * 3.0)));
  }
  // Echo: ghost edges trailing behind it.
  if (echo > 0.0) {
    float k = depth / echoGap;
    float ghost = smoothstep(0.08, 0.0, abs(fract(k) - 0.02)) * step(1.0, k) * step(k, 4.0);
    c += col * ghost * echo * pow(0.6, floor(k));
  }
  // Kick ripple glow.
  float x = (r - ripple) / 26.0;
  c += c * rippleAmp * 1.3 * exp(-x * x);
  return c;
}

// Newest first: the first wave whose edge is still beyond r is the band r sits in.
vec3 shade(float r, float ang, vec4 a) {
  float d = dent(r);
  for (int i = 0; i < MAX; i++) {
    if (i >= count) break;
    float edge = radii[i] + shapeOffset(phase[i], a) - d;
    if (r < edge) return paint(i, r, ang, edge);
  }
  return vec3(0.0);
}

// Chorus: each wave splits into a pink and a cyan copy. The three radii look for their bands in
// one pass over the rings, so the edges are only worked out once.
vec3 chorus(float r, float ang, vec4 a) {
  float ra = r + split, rb = r - split;
  float da = dent(ra), db = dent(rb), dm = dent(r);
  int ia = -1, ib = -1, im = -1;
  float ea = 0.0, eb = 0.0, em = 0.0;
  for (int i = 0; i < MAX; i++) {
    if (i >= count || (ia >= 0 && ib >= 0 && im >= 0)) break;
    float base = radii[i] + shapeOffset(phase[i], a);
    if (ia < 0 && ra < base - da) { ia = i; ea = base - da; }
    if (ib < 0 && rb < base - db) { ib = i; eb = base - db; }
    if (im < 0 && r < base - dm) { im = i; em = base - dm; }
  }
  vec3 A = ia < 0 ? vec3(0.0) : paint(ia, ra, ang, ea);
  vec3 B = ib < 0 ? vec3(0.0) : paint(ib, rb, ang, eb);
  vec3 M = im < 0 ? vec3(0.0) : paint(im, r, ang, em);
  return M * 0.55 + A * vec3(1.0, 0.35, 0.75) * 0.5 + B * vec3(0.2, 0.8, 1.0) * 0.5;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float grunge = smoothstep(0.3, 1.0, heat);

  // Drive, very top of the knob: block smears. The odd chunk of the picture freezes and smears
  // sideways, like a corrupted video file.
  float B = 56.0 * dpr;
  vec2 block = floor(frag / B);
  float smear = smoothstep(0.75, 1.0, heat);
  if (smear > 0.0 && hash(vec3(block, floor(time * 5.0) + 11.0)) > 1.0 - smear * 0.14) {
    frag.x = block.x * B + fract(frag.x / B) * B * 0.06;
  }

  // Reverb pulls the camera back: everything shrinks into the distance.
  vec2 d = (frag - origin) / zoom;

  float r = length(d);
  float ang = atan(d.y, d.x); // full circle: the waves carry on below and around the deck

  // Drive: ring slips. Arcs of the waves jolt round the circle like a skipping record, more
  // often and further the harder you drive it, and on the kick.
  if (grunge > 0.0) {
    float seg = floor((ang + PI) / (2.0 * PI) * 28.0);
    float ringBand = floor(r / (46.0 * dpr));
    float slot = floor(time * 7.0);
    float slip = hash(vec3(seg, ringBand, slot));
    if (slip > 1.0 - grunge * (0.3 + pulse * 0.25)) {
      ang += (hash(vec3(ringBand, seg, slot + 5.0)) - 0.5) * 0.5 * grunge;
      r += (hash(vec3(seg, slot, ringBand + 9.0)) - 0.5) * 20.0 * dpr * grunge;
    }
  }
  // Solo pulses: as one passes, the rings bend into petals around the circle (few broad petals for
  // notes that sit sweetly on the chord, many fine ones for the ones that clash), faintly lit in
  // the note's colour.
  vec3 tint = vec3(0.0);
  float petals = 0.0;
  for (int i = 0; i < MAXD; i++) {
    if (i >= dropCount) break;
    float x = (r - drops[i].x) / (130.0 * dpr);
    float w = exp(-x * x);
    if (w < 0.01) continue;
    float l = cos(drops[i].z * (ang - drops[i].y));
    l = mix(l, sign(l) * sqrt(abs(l)), dropInfo[i].w); // driven: fat, square petals
    petals += drops[i].w * w * l;
    tint += dropInfo[i].rgb * w * drops[i].w / (55.0 * dpr) * 0.4;
  }
  r -= 80.0 * dpr * tanh(petals / (80.0 * dpr)); // a pile of shred notes folds, but never tears
  tint /= 1.0 + 2.0 * max(tint.r, max(tint.g, tint.b)); // many notes at once: colour, not a white-out
  vec4 a = vec4(sin(ang * 6.0), cos(ang * 6.0), sin(ang * 13.0), cos(ang * 13.0));
  vec3 c = split > 0.5 ? chorus(r, ang, a) : shade(r, ang, a);
  c += tint;
  c = vec3(1.0) - exp(-c * exposure * (1.0 + pulse * 0.3));
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = max(vec3(0.0), mix(vec3(luma), c, 1.15 + heat * 0.4));

  // Distance haze: thicker the further away (reverb) and the further out.
  vec3 haze = vec3(0.09, 0.07, 0.16);
  c = mix(c, haze + c * 0.35, reverb * (0.25 + 0.55 * clamp(r / 1400.0, 0.0, 1.0)));

  // Drive: Hotline Miami grunge. Crushed shadows, hot pink/magenta grade, fewer colours,
  // grain and a dark vignette.
  if (heat > 0.02) {
    c = pow(c, vec3(1.0 + heat * 1.3));
    float l2 = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, l2 * vec3(2.2, 0.45, 1.35), heat * 0.6); // pulled towards hot pink / magenta
    c *= mix(vec3(1.0), vec3(1.25, 0.6, 1.0), heat * 0.6);
    float levels = mix(24.0, 4.0, heat);
    c = floor(c * levels + 0.5) / levels;
    c += (hash(vec3(frag, floor(time * 24.0))) - 0.5) * 0.16 * heat;
    vec2 uv = gl_FragCoord.xy / res - 0.5;
    c *= 1.0 - heat * 0.75 * smoothstep(0.25, 0.75, length(uv * vec2(1.0, 1.3)));
  }
  o = vec4(vec3(0.051, 0.055, 0.086) + max(c, 0.0), 1.0);
}`;

export class Rings {
  constructor(ctx) {
    this.name = 'Tree Rings';
    this.ctx = ctx;
    this.p = ctx.program(FRAG);
    this.ripple = 1e9;
    this.rippleAmp = 0;
    this.scatter = 0;
    const f = (k) => new Float32Array(MAX * k); // reused every frame
    this.buf = { radii: f(1), colors: f(3), alive: f(1), seeds: f(1), phase: f(4), sparkle: f(1) };
    this.dropBuf = { drops: new Float32Array(MAXD * 4), info: new Float32Array(MAXD * 4) };
  }

  resize() {}

  kick(vel) {
    this.ripple = 0;
    this.rippleAmp = Math.min(1.2, 0.5 + vel);
  }

  snare(vel) { this.scatter = Math.min(1.2, this.scatter + vel * 0.6); }

  // rings: [{ radius, color: [r,g,b] 0..255, alive, seed, sparkle }], newest first, radius px.
  // drops: [{ radius, angle, petals, depth, color: [r,g,b] 0..255, square }], solo pulses.
  render(dt, now, fx, rings, origin, drops = []) {
    const { gl, blit } = this.ctx;
    this.ripple += dt * fx.rippleSpeed;
    this.rippleAmp *= 0.15 ** dt;
    this.scatter *= 0.02 ** dt;
    const n = Math.min(MAX, rings.length);
    const { radii, colors, alive, seeds, phase, sparkle } = this.buf;
    const time = now % 1000; // keep it small so float precision holds up
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      radii[i] = r.radius;
      for (let k = 0; k < 3; k++) colors[i * 3 + k] = (r.color[k] / 255) * 1.25;
      alive[i] = r.alive;
      seeds[i] = r.seed;
      sparkle[i] = r.sparkle;
      // The wobble's two phases for this ring (see shapeOffset).
      const p1 = time * 2.3 + r.seed, p2 = -time * 1.7 + r.seed * 2;
      phase[i * 4] = Math.cos(p1);
      phase[i * 4 + 1] = Math.sin(p1);
      phase[i * 4 + 2] = Math.cos(p2);
      phase[i * 4 + 3] = Math.sin(p2);
    }
    const u = this.p.use().u;
    const d = fx.dpr;
    gl.uniform1i(u.count, n);
    gl.uniform1fv(u.radii, radii);
    gl.uniform3fv(u.colors, colors);
    gl.uniform1fv(u.alive, alive);
    gl.uniform1f(u.maxR, fx.maxR);
    gl.uniform1fv(u.seeds, seeds);
    gl.uniform4fv(u.phase, phase);
    gl.uniform1fv(u.sparkle, sparkle);
    gl.uniform2f(u.origin, origin[0], origin[1]);
    gl.uniform1f(u.time, time);
    gl.uniform1f(u.pulse, fx.pulse);
    gl.uniform1f(u.ripple, this.ripple);
    gl.uniform1f(u.rippleAmp, this.rippleAmp);
    gl.uniform1f(u.shimmer, fx.shimmer);
    gl.uniform1f(u.scatter, this.scatter);
    gl.uniform1f(u.wobble, fx.wobble * d);
    gl.uniform1f(u.ringing, Math.max(0, fx.resonance - 0.4) / 0.6);
    gl.uniform1f(u.split, fx.split * 9 * d);
    gl.uniform1f(u.echo, fx.echo);
    gl.uniform1f(u.echoGap, Math.max(8 * d, fx.echoGap));
    gl.uniform1f(u.cell, fx.cell * (1 + fx.heat * 2)); // drive: chunkier pixels
    gl.uniform1f(u.heat, fx.heat);
    gl.uniform1f(u.exposure, fx.exposure);
    gl.uniform1f(u.zoom, 1 - fx.reverb * 0.45);
    gl.uniform1f(u.reverb, fx.reverb);
    gl.uniform1f(u.dpr, d);
    gl.uniform2f(u.res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const nd = Math.min(MAXD, drops.length);
    const db = this.dropBuf;
    for (let i = 0; i < nd; i++) {
      const p = drops[i];
      db.drops.set([p.radius, p.angle, p.petals, p.depth], i * 4);
      db.info.set([p.color[0] / 255, p.color[1] / 255, p.color[2] / 255, p.square], i * 4);
    }
    gl.uniform1i(u.dropCount, nd);
    gl.uniform4fv(u.drops, db.drops);
    gl.uniform4fv(u.dropInfo, db.info);
    blit(null);
  }
}
