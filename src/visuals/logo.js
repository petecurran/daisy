// The splash logo: "daisy" in 60s poster lettering that melts and sways, slowly cycling through
// Hotline Miami neons with a second colour printed slightly off behind it. Before the synth wakes,
// the MPK's knobs warp the lettering and the joystick pushes it about; on waking it melts away
// into the stage.

const NEON = ['#ff2a8a', '#b026ff', '#00e5ff', '#ff7a18', '#ff3df2', '#2dfcb8'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const neonAt = (t) => {
  const i = Math.floor(t), k = t - i, e = k * k * (3 - 2 * k); // smooth glide between neons
  return mix(NEON[i % NEON.length], NEON[(i + 1) % NEON.length], e);
};

export class Logo {
  constructor(root) {
    this.root = root; // the splash element
    this.knobs = new Array(8).fill(0);
    this.kick = 0; // a burst of extra wobble when a knob moves
    this.joy = { x: 0, y: 0 };
    this.melt = 0;
    root.querySelector('.logo').innerHTML = `
      <svg viewBox="0 0 1000 380" aria-label="daisy">
        <defs>
          <filter id="logo-melt" x="-20%" y="-40%" width="140%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.03" numOctaves="2" seed="7"/>
            <feDisplacementMap in="SourceGraphic" scale="14" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
        </defs>
        <g class="logo-art" filter="url(#logo-melt)">
          <text class="logo-back" x="512" y="252" text-anchor="middle">daisy</text>
          <text class="logo-front" x="500" y="240" text-anchor="middle">daisy</text>
        </g>
      </svg>`;
    this.svg = root.querySelector('svg');
    this.art = root.querySelector('.logo-art');
    this.front = root.querySelector('.logo-front');
    this.back = root.querySelector('.logo-back');
    this.noise = root.querySelector('feTurbulence');
    this.warp = root.querySelector('feDisplacementMap');
    this.last = performance.now();
    const frame = (ms) => {
      this.draw(ms);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  knob(i, v) {
    this.kick = Math.min(1, this.kick + Math.abs(v - this.knobs[i]) * 4);
    this.knobs[i] = v;
  }

  joystick(x, y) { this.joy = { x, y }; }

  draw(ms) {
    const dt = Math.min(0.05, (ms - this.last) / 1000);
    this.last = ms;
    const awake = this.root.closest('.stage')?.classList.contains('awake');
    // Melt out when the synth wakes (and back in if it's put to sleep again).
    this.melt += ((awake ? 1 : 0) - this.melt) * Math.min(1, dt * (awake ? 2.2 : 6));
    if (awake && this.melt > 0.995) return;
    const t = ms / 1000;
    this.kick *= 0.3 ** dt;
    const k = this.knobs;
    const avg = k.reduce((a, b) => a + b, 0) / k.length;

    // Neon cycle: the face and its off-register shadow are a couple of colours apart.
    const face = neonAt(t / 6), shadow = neonAt(t / 6 + 2.3);
    this.front.setAttribute('fill', rgb(face));
    this.back.setAttribute('fill', rgb(shadow));
    this.svg.style.filter = `drop-shadow(0 0 ${(18 + this.kick * 30).toFixed(1)}px ${rgb(face)})`;

    // Knobs: overall warp depth, ripple size, and how much it wobbles; a turn adds a burst.
    const scale = 14 + avg * 60 + this.kick * 50 + this.melt * 420;
    this.warp.setAttribute('scale', scale.toFixed(1));
    const fx = 0.006 + k[0] * 0.02 + Math.sin(t * 0.4) * 0.002;
    const fy = 0.03 + k[1] * 0.05 + Math.cos(t * 0.3) * 0.006;
    this.noise.setAttribute('baseFrequency', `${fx.toFixed(4)} ${fy.toFixed(4)}`);

    // Hotline Miami sway, plus the joystick: left/right leans and shoves it, up stretches, down squashes.
    const { x, y } = this.joy;
    const rot = Math.sin(t * 0.7) * 3 + x * 8;
    const sy = (1 + y * 0.35) * (1 + Math.sin(t * 1.3) * 0.015);
    const grow = 1 + this.melt * 0.6;
    this.art.setAttribute('transform', `translate(${500 + x * 90} 190) rotate(${rot.toFixed(2)}) skewX(${(-x * 18).toFixed(2)}) scale(${grow.toFixed(3)} ${(sy * grow).toFixed(3)}) translate(-500 -190)`);
    this.svg.style.opacity = (1 - this.melt).toFixed(3);
  }
}
