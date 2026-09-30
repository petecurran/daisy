// TREE RINGS: after Josef Albers' nested colour fields. Every chord is a band of its colour that
// grows out of the keyboard and fills back to the chord before it, so the screen is mostly colour.
// Each band is made of its own pixels: they ride outward with the wave and fan apart as it grows,
// and near the edges of the screen they scatter and drop out, so waves dissolve into dust.
// Knobs reshape the waves: wobble bends, resonance spikes, chorus doubles, echo leaves ghost
// edges, drive makes the pixels bigger and hotter, reverb slows everything down.

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
uniform vec2 origin;
uniform float maxR;
uniform float time, pulse, ripple, rippleAmp, shimmer, scatter, wobble, spikes, split, echoGap, echo, cell, heat, exposure;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

// The wave's edge, bent by the knobs.
float shapeOffset(float ang, float seed) {
  float w = sin(ang * 6.0 + time * 2.3 + seed) * wobble * 22.0
          + sin(ang * 13.0 - time * 1.7 + seed * 2.0) * wobble * 7.0;
  float s = pow(abs(sin(ang * 18.0 + seed)), 10.0) * spikes * 38.0;
  return w + s;
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
    float cols = 150.0;
    float arc = max(r, 1.0) * PI / cols;
    float rowF = depth / cell, colF = ang / PI * cols;
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
    // Bright leading edge, and echo: ghost edges trailing behind it.
    c += col * 0.9 * smoothstep(cell * 1.6, 0.0, depth);
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
  vec2 d = gl_FragCoord.xy - origin;
  float r = length(d);
  float ang = atan(max(d.y, 0.0), d.x);
  vec3 c;
  if (split > 0.5) {
    // Chorus: each wave splits into a pink and a cyan copy.
    vec3 a = shade(r + split, ang), b = shade(r - split, ang), m = shade(r, ang);
    c = m * 0.55 + a * vec3(1.0, 0.35, 0.75) * 0.5 + b * vec3(0.2, 0.8, 1.0) * 0.5;
  } else {
    c = shade(r, ang);
  }
  c = vec3(1.0) - exp(-c * exposure * (1.0 + heat * 0.8) * (1.0 + pulse * 0.3));
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = max(vec3(0.0), mix(vec3(luma), c, 1.15 + heat * 0.9)); // drive: hotter colour
  o = vec4(vec3(0.051, 0.055, 0.086) + c, 1.0);
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
    gl.uniform1f(u.spikes, Math.max(0, fx.resonance - 0.5) * 2 * d);
    gl.uniform1f(u.split, fx.split * 9 * d);
    gl.uniform1f(u.echo, fx.echo);
    gl.uniform1f(u.echoGap, Math.max(8 * d, fx.echoGap));
    gl.uniform1f(u.cell, fx.cell * (1 + fx.heat * 1.2));
    gl.uniform1f(u.heat, fx.heat);
    gl.uniform1f(u.exposure, fx.exposure);
    blit(null);
  }
}
