// Minimal WebGL2 helpers: full-screen quad programs and (double-buffered) render targets.

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 texel;
out vec2 vUv, vL, vR, vT, vB;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texel.x, 0.0);
  vR = vUv + vec2(texel.x, 0.0);
  vT = vUv + vec2(0.0, texel.y);
  vB = vUv - vec2(0.0, texel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error('WebGL2 is not available');
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
  const internal = floatTargets ? gl.RGBA16F : gl.RGBA8;
  const type = floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const compile = (typ, src) => {
    const s = gl.createShader(typ);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  };

  const vert = compile(gl.VERTEX_SHADER, VERT);

  function program(frag) {
    const p = gl.createProgram();
    gl.attachShader(p, vert);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;
${frag}`));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return {
      use() { gl.useProgram(p); return this; },
      u,
    };
  }

  function target(w, h, filter = gl.LINEAR) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      tex, fb, w, h, texel: [1 / w, 1 / h],
      bind(unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit; },
    };
  }

  function double(w, h, filter) {
    return {
      read: target(w, h, filter),
      write: target(w, h, filter),
      swap() { [this.read, this.write] = [this.write, this.read]; },
      get w() { return this.read.w; },
      get h() { return this.read.h; },
      get texel() { return this.read.texel; },
    };
  }

  // Draw the quad into a target (or the screen when null).
  function blit(t) {
    if (t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.viewport(0, 0, t.w, t.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return { gl, program, target, double, blit, floatTargets };
}
