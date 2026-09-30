# VibeSynth

A warm, tactile browser synth for the Akai MPK Mini Mk II, inspired by the Telepathic Instruments Orchid.

## Run

```bash
python3 -m http.server 5173 --bind 127.0.0.1
```

Open http://localhost:5173 in Chromium, allow MIDI, click to wake the synth.

## Controls

- **Chords mode** (Tab toggles): a key picks the chord root, the joystick colours it
  (up = 7th, down = sus4, left = flip major/minor, right = add9, diagonals = combos).
- **Notes mode**: plain synth; joystick = pitch bend / vibrato.
- **K2–K8**: Brightness, Resonance, Drive, Chorus, Tape wobble, Echo, Reverb.
- **← →** change sound, **↑ ↓** voicing.

## Controller setup (recommended)

On factory settings the joystick sends the same CC1 for up and down. Using
[SysEx Controls](https://github.com/soyersoyer/sysex-controls) (`yay -S sysex-controls`):

1. Joystick → Vertical → **Dual CC**, CCs **16** (up) and **17** (down).
2. Pads (banks A and B) → MIDI channel **10**.
3. Send to the active program.

The page detects dual-CC automatically ("Joystick: dual CC ✓"). If up/down come out
reversed, swap the two CC numbers.
