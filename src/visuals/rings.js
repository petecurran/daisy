// TREE RINGS: after Josef Albers' nested colour fields. Every chord is a band of its colour that
// grows out of the keyboard and fills back to the chord before it, so the screen is mostly colour.
// Each band is made of its own pixels: they ride outward with the wave and fan apart as it grows,
// and near the edges of the screen they scatter and drop out, so waves dissolve into dust.
// Knobs reshape the waves: wobble bends, resonance makes the edges ring, chorus doubles, echo
// leaves ghost edges, drive turns it grungy (dark, gritty, glitching), reverb pulls the camera
// back into the distance.

const MAX = 32;

const FRAG = `
#define MAX ${MAX}
#define PI 3.14159265
uniform int count;
uniform float radii[MAX];     // leading edge of each chord's band (px), newest first
uniform vec3 colors[MAX];
uniform float alive[MAX];     // 1 while held, fading after release
uniform float seeds[MAX];
uniform float sparkle[MAX];   // extra glitter for colourful chords (9ths etc.)
uniform vec2 origin, res;
uniform float maxR;
uniform float time, pulse, ripple, rippleAmp, shimmer, scatter, wobble, ringing, split, echoGap, echo, cell, heat, exposure, zoom, reverb, dpr;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

// The wave's edge, bent by tape wobble.
float shapeOffset(float ang, float seed) {
  return sin(ang * 6.0 + time * 2.3 + seed) * wobble * 22.0
       + sin(ang * 13.0 - time * 1.7 + seed * 2.0) * wobble * 7.0;
}

vec3 shade(float r, float ang) {
  for (int i = 0; i < MAX; i++) {
    if (i >= count) break;
    float edge = radii[i] + shapeOffset(ang, seeds[i]) - rippleAmp * 16.0 * exp(-pow((r - ripple) / 40.0, 2.0));
    if (r >= edge) continue;

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
    c += c * rippleAmp * 1.3 * exp(-pow((r - ripple) / 26.0, 2.0));
    return c;
  }
  return vec3(0.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  // Drive, at the top end: horizontal glitch tears, jumping with the kick.
  float band = floor(frag.y / (14.0 * dpr));
  float tear = hash(vec3(band, floor(time * 9.0), 3.0));
  float grunge = smoothstep(0.35, 1.0, heat);
  frag.x += step(1.0 - grunge * 0.35 - pulse * 0.1, tear) * (hash(vec3(band, time, 1.0)) - 0.5) * 90.0 * dpr * grunge;

  // Reverb pulls the camera back: everything shrinks into the distance.
  vec2 d = (frag - origin) / zoom;
  float r = length(d);
  float ang = atan(d.y, d.x); // full circle: the waves carry on below and around the deck
  vec3 c;
  if (split > 0.5) {
    // Chorus: each wave splits into a pink and a cyan copy.
    vec3 a = shade(r + split, ang), b = shade(r - split, ang), m = shade(r, ang);
    c = m * 0.55 + a * vec3(1.0, 0.35, 0.75) * 0.5 + b * vec3(0.2, 0.8, 1.0) * 0.5;
  } else {
    c = shade(r, ang);
  }
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
  }

  resize() {}

  kick(vel) {
    this.ripple = 0;
    this.rippleAmp = Math.min(1.2, 0.5 + vel);
  }

  snare(vel) { this.scatter = Math.min(1.2, this.scatter + vel * 0.6); }

  // rings: [{ radius, color: [r,g,b] 0..255, alive, seed, sparkle }], newest first, radius px.
  render(dt, now, fx, rings, origin) {
    const { gl, blit } = this.ctx;
    this.ripple += dt * fx.rippleSpeed;
    this.rippleAmp *= 0.15 ** dt;
    this.scatter *= 0.02 ** dt;
    const n = Math.min(MAX, rings.length);
    const f = (k) => new Float32Array(MAX * k);
    const radii = f(1), colors = f(3), alive = f(1), seeds = f(1), sparkle = f(1);
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      radii[i] = r.radius;
      colors.set(r.color.map((v) => (v / 255) * 1.25), i * 3);
      alive[i] = r.alive;
      seeds[i] = r.seed;
      sparkle[i] = r.sparkle;
    }
    const u = this.p.use().u;
    const d = fx.dpr;
    gl.uniform1i(u.count, n);
    gl.uniform1fv(u.radii, radii);
    gl.uniform3fv(u.colors, colors);
    gl.uniform1fv(u.alive, alive);
    gl.uniform1f(u.maxR, fx.maxR);
    gl.uniform1fv(u.seeds, seeds);
    gl.uniform1fv(u.sparkle, sparkle);
    gl.uniform2f(u.origin, origin[0], origin[1]);
    gl.uniform1f(u.time, now);
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
    blit(null);
  }
}
