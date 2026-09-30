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

## Controller setup

On factory settings the joystick sends CC1 for both up and down (and K1 also sends CC1).
This reprograms Program 1 so up = CC17, down = CC16 and pads use MIDI channel 10:

```bash
python3 tools/mpk-setup.py
```

`python3 tools/mpk-setup.py --restore` writes back the original settings saved in
`tools/mpk-backup-factory.txt`. Once reprogrammed, K1 controls chord voicing.
