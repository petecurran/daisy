import { Strip } from './fx.js';

// A sound: a preset plus everything the knobs set on it (tone macros, colour pedals, room sends),
// playing through a channel strip of its own. Live playing has one per preset (so each keeps your
// tweaks); a loop layer gets a copy, frozen when the layer is locked in.
export class Sound {
  constructor(engine, preset, { macros, values, level = 1 } = {}) {
    this.engine = engine;
    this.preset = preset;
    this.macros = { brightness: 0.5, resonance: 0.5, release: 0.5, ...macros };
    this.strip = new Strip(engine.ctx, engine.noise, engine.fx);
    this.strip.set(values ?? preset.fx);
    this.strip.level.gain.value = level;
  }

  get values() { return this.strip.values; }

  // 0..1 knob -> x0.2 .. x5, with 0.5 = the preset's own sound.
  get brightnessMult() { return Math.pow(5, (this.macros.brightness - 0.5) * 2); }
  get releaseMult() { return Math.pow(4, (this.macros.release - 0.5) * 2); }

  copy(level) {
    return new Sound(this.engine, this.preset, { macros: { ...this.macros }, values: { ...this.values }, level });
  }

  // Take on another sound's preset and settings (the layer being recorded follows the live sound).
  follow(other) {
    this.preset = other.preset;
    Object.assign(this.macros, other.macros);
    this.strip.set(other.values);
  }
}
