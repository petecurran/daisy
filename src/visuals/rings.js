// TREE RINGS: after Josef Albers' nested colour fields. Every chord is a solid band of its colour
// that grows out of the keyboard and fills all the way to the chord before it, so the screen is
// mostly colour: your progression as rings, newest in the middle. The band is made of living
// pixels that shimmer; the kick sends a bright ripple outward, the hats make the pixels sparkle.

const MAX = 32;

const FRAG = `
#define MAX ${MAX}
uniform int count;
uniform float radii[MAX];     // outer edge of each chord's band (px), newest first
uniform vec3 colors[MAX];
uniform float alive[MAX];     // 1 while held, fading after release
uniform float sparkle[MAX];   // extra shimmer for colourful chords (9ths etc.)
uniform vec2 origin, res;
uniform float time, pulse, ripple, rippleAmp, shimmer, wobble, split, cell, heat, exposure;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Which band a radius falls in, and how far through it (0 inner .. 1 outer edge).
int bandAt(float r, out float t) {
  float inner = 0.0;
  for (int i = 0; i < MAX; i++) {
    if (i >= count) break;
    if (r < radii[i]) { t = (r - inner) / max(1.0, radii[i] - inner); return i; }
    inner = radii[i];
  }
  t = 0.0;
  return -1;
}

vec3 shade(float r, float ang, vec2 frag) {
  float t;
  // Tape wobble bends the rings; the kick's ripple pushes them outward as it passes.
  float rr = r + sin(ang * 6.0 + time * 2.3) * wobble * 14.0
               - rippleAmp * 18.0 * exp(-pow((r - ripple) / 40.0, 2.0));
  int i = bandAt(rr, t);
  if (i < 0) return vec3(0.0);
  vec3 c = colors[i] * (0.35 + 0.65 * alive[i]);
  // Living pixels: each cell pulses at its own rate; hats and colourful chords make them glitter.
  vec2 cid = floor(frag / cell);
  float h = hash(cid);
  float beat = 0.5 + 0.5 * sin(time * (1.5 + h * 3.0) + h * 40.0);
  float glitter = hash(cid + floor(time * 12.0));
  c *= 0.78 + 0.22 * beat + (shimmer + sparkle[i]) * (glitter - 0.5) * 0.8;
  // Grid between the pixels, faint.
  vec2 g = fract(frag / cell);
  c *= 0.86 + 0.14 * step(0.12, min(g.x, g.y));
  // Bright leading edge + a dark seam between chords.
  float edge = radii[i] - rr;
  c += colors[i] * 0.9 * smoothstep(5.0, 0.0, edge);
  c *= smoothstep(0.0, 2.5, edge + 0.5) * 0.7 + 0.3;
  // Kick ripple glow.
  c += c * rippleAmp * 1.4 * exp(-pow((r - ripple) / 26.0, 2.0));
  return c;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 d = frag - origin;
  float r = length(d);
  float ang = atan(d.y, d.x);
  vec3 c;
  if (split > 0.01) {
    // Chorus: the rings split into pink/cyan fringes.
    c = vec3(shade(r + split, ang, frag).r, shade(r, ang, frag).g, shade(r - split, ang, frag).b);
  } else {
    c = shade(r, ang, frag);
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
  }

  resize() {}

  kick(vel) {
    this.ripple = 0;
    this.rippleAmp = Math.min(1.2, 0.5 + vel);
  }

  // rings: [{ radius, color: [r,g,b] 0..255, alive 0..1, sparkle }], newest first, radius in px.
  render(dt, now, fx, rings, origin) {
    const { gl, blit } = this.ctx;
    this.ripple += dt * fx.rippleSpeed;
    this.rippleAmp *= Math.pow(0.15, dt);
    const n = Math.min(MAX, rings.length);
    const radii = new Float32Array(MAX), colors = new Float32Array(MAX * 3), alive = new Float32Array(MAX), sparkle = new Float32Array(MAX);
    for (let i = 0; i < n; i++) {
      radii[i] = rings[i].radius;
      colors.set(rings[i].color.map((v) => (v / 255) * 1.25), i * 3);
      alive[i] = rings[i].alive;
      sparkle[i] = rings[i].sparkle;
    }
    const u = this.p.use().u;
    gl.uniform1i(u.count, n);
    gl.uniform1fv(u.radii, radii);
    gl.uniform3fv(u.colors, colors);
    gl.uniform1fv(u.alive, alive);
    gl.uniform1fv(u.sparkle, sparkle);
    gl.uniform2f(u.origin, origin[0], origin[1]);
    gl.uniform2f(u.res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(u.time, now);
    gl.uniform1f(u.pulse, fx.pulse);
    gl.uniform1f(u.ripple, this.ripple);
    gl.uniform1f(u.rippleAmp, this.rippleAmp);
    gl.uniform1f(u.shimmer, fx.shimmer);
    gl.uniform1f(u.wobble, fx.wobble * fx.dpr);
    gl.uniform1f(u.split, fx.split * 6 * fx.dpr);
    gl.uniform1f(u.cell, fx.cell * 2); // chunkier living pixels in the rings
    gl.uniform1f(u.heat, fx.heat);
    gl.uniform1f(u.exposure, fx.exposure);
    blit(null);
  }
}
