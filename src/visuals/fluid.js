// INK: a real-time fluid simulation on the GPU (after Jos Stam's "Stable Fluids", in the style of
// Pavel Dobryakov's WebGL fluid). Held notes squirt coloured dye upward from their key on the
// on-screen keyboard; the drums push the water around; the effects change how it behaves.

const SPLAT = `
uniform sampler2D uTarget; uniform float aspect, radius; uniform vec3 color; uniform vec2 point;
void main() {
  vec2 p = vUv - point; p.x *= aspect;
  o = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, 1.0);
}`;
const ADVECT = `
uniform sampler2D uVelocity, uSource; uniform vec2 simTexel; uniform float dt, dissipation;
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * simTexel;
  o = texture(uSource, coord) / (1.0 + dissipation * dt);
}`;
const DIVERGENCE = `
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;
const CURL = `
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;
const VORTICITY = `
uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
void main() {
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x, T = texture(uCurl, vT).x, B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 v = texture(uVelocity, vUv).xy + force * dt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`;
const PRESSURE = `
uniform sampler2D uPressure, uDivergence;
void main() {
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
}`;
const GRADIENT = `
uniform sampler2D uPressure, uVelocity;
void main() {
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
}`;
const SCALE = `
uniform sampler2D uTexture; uniform float value;
void main() { o = value * texture(uTexture, vUv); }`;
const DISPLAY = `
uniform sampler2D uDye; uniform vec2 dyeTexel; uniform float exposure, split, heat, time, pulse, shimmer, cell;
uniform vec2 res;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 s = vec2(split * dyeTexel.x * 1.5, 0.0);
  vec3 c = vec3(texture(uDye, vUv + s).r, texture(uDye, vUv).g, texture(uDye, vUv - s).b);
  // Soft relief from the dye's own gradient, so it reads as liquid rather than flat paint.
  vec3 l = texture(uDye, vUv - vec2(dyeTexel.x, 0.0)).rgb, r = texture(uDye, vUv + vec2(dyeTexel.x, 0.0)).rgb;
  vec3 t = texture(uDye, vUv + vec2(0.0, dyeTexel.y)).rgb, b = texture(uDye, vUv - vec2(0.0, dyeTexel.y)).rgb;
  vec3 n = normalize(vec3(length(r) - length(l), length(t) - length(b), 0.06));
  c *= clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.72, 0.72, 1.0);
  // Hi-hats: the ink glitters in tiny cells.
  vec2 cellId = floor(gl_FragCoord.xy / cell);
  float tw = hash(cellId + floor(time * 14.0));
  c *= 1.0 + shimmer * (tw - 0.5) * 0.35;
  c = vec3(1.0) - exp(-c * exposure * (1.0 + heat * 0.8) * (1.0 + pulse * 0.35));
  // Keep the colours vivid where different chords' ink mixes; drive turns the heat up further.
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = max(vec3(0.0), mix(vec3(luma), c, 1.45 + heat * 0.9));
  o = vec4(vec3(0.051, 0.055, 0.086) + c, 1.0);
}`;

export class Ink {
  constructor(ctx) {
    this.name = 'Ink';
    this.ctx = ctx; // createGL() result
    const { program } = ctx;
    this.p = {
      splat: program(SPLAT), advect: program(ADVECT), divergence: program(DIVERGENCE), curl: program(CURL),
      vorticity: program(VORTICITY), pressure: program(PRESSURE), gradient: program(GRADIENT),
      scale: program(SCALE), display: program(DISPLAY),
    };
    this.splats = [];
  }

  resize(w, h) {
    const { double, target, gl } = this.ctx;
    const aspect = w / h;
    const simShort = 128, dyeShort = Math.min(900, Math.min(w, h));
    const dims = (short) => (aspect >= 1 ? [Math.round(short * aspect), short] : [short, Math.round(short / aspect)]);
    const [sw, sh] = dims(simShort);
    const [dw, dh] = dims(dyeShort);
    this.aspect = aspect;
    this.velocity = double(sw, sh, gl.LINEAR);
    this.dye = double(dw, dh, gl.LINEAR);
    this.divergenceT = target(sw, sh, gl.NEAREST);
    this.curlT = target(sw, sh, gl.NEAREST);
    this.pressureT = double(sw, sh, gl.NEAREST);
  }

  // x, y in 0..1 (y up). dx, dy = push in sim texels/second. color = [r,g,b] 0..1 (can exceed 1).
  splat(x, y, dx, dy, color, radius = 0.0009) {
    this.splats.push({ x, y, dx, dy, color, radius });
  }

  applySplats() {
    const { gl, blit } = this.ctx;
    const s = this.p.splat.use();
    gl.uniform1f(s.u.aspect, this.aspect);
    for (const q of this.splats) {
      gl.uniform2f(s.u.texel, ...this.velocity.texel);
      gl.uniform1f(s.u.radius, q.radius);
      gl.uniform2f(s.u.point, q.x, q.y);
      if (q.dx || q.dy) {
        gl.uniform1i(s.u.uTarget, this.velocity.read.bind(0));
        gl.uniform3f(s.u.color, q.dx, q.dy, 0);
        blit(this.velocity.write);
        this.velocity.swap();
      }
      if (q.color) {
        gl.uniform1i(s.u.uTarget, this.dye.read.bind(0));
        gl.uniform3f(s.u.color, ...q.color);
        blit(this.dye.write);
        this.dye.swap();
      }
    }
    this.splats = [];
  }

  step(dt, fx) {
    const { gl, blit } = this.ctx;
    const vel = this.velocity;
    this.applySplats();

    let pr = this.p.curl.use();
    gl.uniform2f(pr.u.texel, ...vel.texel);
    gl.uniform1i(pr.u.uVelocity, vel.read.bind(0));
    blit(this.curlT);

    pr = this.p.vorticity.use();
    gl.uniform2f(pr.u.texel, ...vel.texel);
    gl.uniform1i(pr.u.uVelocity, vel.read.bind(0));
    gl.uniform1i(pr.u.uCurl, this.curlT.bind(1));
    gl.uniform1f(pr.u.curl, fx.curl);
    gl.uniform1f(pr.u.dt, dt);
    blit(vel.write);
    vel.swap();

    pr = this.p.divergence.use();
    gl.uniform2f(pr.u.texel, ...vel.texel);
    gl.uniform1i(pr.u.uVelocity, vel.read.bind(0));
    blit(this.divergenceT);

    pr = this.p.scale.use();
    gl.uniform1i(pr.u.uTexture, this.pressureT.read.bind(0));
    gl.uniform1f(pr.u.value, 0.8);
    blit(this.pressureT.write);
    this.pressureT.swap();

    pr = this.p.pressure.use();
    gl.uniform2f(pr.u.texel, ...vel.texel);
    gl.uniform1i(pr.u.uDivergence, this.divergenceT.bind(1));
    for (let i = 0; i < 20; i++) {
      gl.uniform1i(pr.u.uPressure, this.pressureT.read.bind(0));
      blit(this.pressureT.write);
      this.pressureT.swap();
    }

    pr = this.p.gradient.use();
    gl.uniform2f(pr.u.texel, ...vel.texel);
    gl.uniform1i(pr.u.uPressure, this.pressureT.read.bind(0));
    gl.uniform1i(pr.u.uVelocity, vel.read.bind(1));
    blit(vel.write);
    vel.swap();

    pr = this.p.advect.use();
    gl.uniform2f(pr.u.texel, ...vel.texel);
    gl.uniform2f(pr.u.simTexel, ...vel.texel);
    gl.uniform1f(pr.u.dt, dt);
    gl.uniform1i(pr.u.uVelocity, vel.read.bind(0));
    gl.uniform1i(pr.u.uSource, vel.read.bind(0));
    gl.uniform1f(pr.u.dissipation, 0.25);
    blit(vel.write);
    vel.swap();

    gl.uniform2f(pr.u.texel, ...this.dye.texel);
    gl.uniform1i(pr.u.uVelocity, vel.read.bind(0));
    gl.uniform1i(pr.u.uSource, this.dye.read.bind(1));
    gl.uniform1f(pr.u.dissipation, fx.dyeFade);
    blit(this.dye.write);
    this.dye.swap();
  }

  render(dt, now, fx) {
    this.step(dt, fx);
    const { gl, blit } = this.ctx;
    const pr = this.p.display.use();
    gl.uniform2f(pr.u.texel, ...this.dye.texel);
    gl.uniform2f(pr.u.dyeTexel, ...this.dye.texel);
    gl.uniform1i(pr.u.uDye, this.dye.read.bind(0));
    gl.uniform1f(pr.u.exposure, fx.exposure);
    gl.uniform1f(pr.u.split, fx.split);
    gl.uniform1f(pr.u.heat, fx.heat);
    gl.uniform1f(pr.u.time, now);
    gl.uniform1f(pr.u.pulse, fx.pulse);
    gl.uniform1f(pr.u.shimmer, fx.shimmer);
    gl.uniform1f(pr.u.cell, fx.cell);
    gl.uniform2f(pr.u.res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    blit(null);
  }
}
