# daisy

A warm browser synth for the Akai MPK Mini Mk II: Orchid-style chords on the keys + joystick,
built-in drum machine, a pedal-style looper and full-screen visuals. Vanilla JS + Web Audio +
WebGL, ES modules, **no build step and no dependencies**.

## Run

- `python3 tools/daisy.py` — (re)starts the local server + a full-screen Chrome/Edge/Chromium app
  window (autoplay allowed). Linux, macOS and Windows.
- Or `python3 tools/serve.py 5173` and open http://localhost:5173 (no caching, so a refresh
  always gets the latest code). `.claude/launch.json` has this as the `daisy` preview.
- `python3 tools/mpk-setup.py` reprograms the MPK (joystick up/down = CC17/16, pads on ch 10).
  Linux-only (ALSA); the guide covers Akai's editor for macOS/Windows.

## Layout

- `src/main.js` — wiring: MIDI input, pads/knob pages, modes, keyboard shortcuts, splash.
- `src/midi.js` — Web MIDI input from every connected device, normalised into note/CC/bend events.
- `src/chords.js` — chord engine (key + joystick zone → chord, voice leading, octave-aware).
- `src/audio/` — synth engine, voices, presets, effects.
- `src/drums/` — synthesized kits, step patterns (one char per 16th, digit = importance),
  sequencer, MIDI clock out.
- `src/looper.js` — one-button looper locked to the drum grid.
- `src/visuals/` — stage (Tree Rings in WebGL + canvas HUD), deck (on-screen MPK), pixel
  lettering (`pixelText.js`, `chordLabel.js`, `logo.js`), chord colours.
- `src/bus.js` — tiny event bus between audio and visuals.
- `src/jam.js` + `tools/jam.py` + `.claude/skills/solo` — Claude solos over the loop: daisy posts
  the loop to `jam/loop.json` via the server and plays `jam/solo.json` when it changes (`/solo`).
  Solos are recorded to `jam/recordings/` (capped at 300 MB) and bend the rings into petals on
  screen. Loop memory: every loop is saved on a key (`jam/loops/<note>.json`); hold pad 5 + a key
  recalls one (or saves a copy there). Test with the `daisy-test` preview (port 5174, its own
  `jam-test/` folder; point `tools/jam.py` at it with `DAISY_JAM=jam-test`).

## Working on it

- Match the surrounding style: short plain-English comments that say *why*, small functions,
  no frameworks.
- `python3 tests/smoke.py` (needs `pip install playwright`) checks daisy end to end, headless and
  muted: page loads clean, a key plays a chord, a loop is recorded and shared, `jam.py` charts it
  and hands back a solo that plays and records. CI runs it on Linux, macOS and Windows
  (`.github/workflows/smoke.yml`). Run it after changing the server, launcher, looper or jam.
- Test in the browser through `window.daisy` (`key(n, down)`, `cc(cc, value)`, `pad(i, down)`,
  plus `engine`, `seq`, `looper`, `chords`, `stage`).
- **Keep test audio silent**: the user plays the real instrument alongside. Disconnect
  `daisy.engine.fx.master` (or suspend `engine.ctx`) before driving it, and always stop the
  drums, looper and notes when done.
- The user is a guitarist, new to synths: prefers auditioning options to abstract questions.
- `BACKLOG.md` holds ideas and known issues.
