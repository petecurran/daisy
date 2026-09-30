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
- **Knobs** (pad 5 flips pages). Sound: Voicing, Brightness, Resonance, Drive, Chorus, Tape wobble,
  Echo, Reverb. Drums: Tempo, Busy, Swing, Kit, Drum tone, Room, Pump, Drum level.
- **Pads bank A**: 1 play/stop drums, 2 fill, 3/4 pattern (hold: time signature), 5 knob page,
  6 tap tempo, 7 break (hold), 8 looper. **Bank B**: play the drums live.
- **Looper** (pad 8 or R): tap = record from next bar -> play -> add layer -> play…, double-tap = stop,
  hold = undo last layer (clear when stopped). Notes snap to 16ths; each layer keeps its own sound.
- **← →** change sound, **↑ ↓** voicing.

## Stage view (visuals)

**V** (or hold pad 5) opens the full-screen stage; **1 / 2 / 3** (or hold pad 2) switch looks:
Tree Rings, Warp Tunnel, Ink. Chords pour out of the on-screen MPK and drift outward, labelled,
so you can read your progression back. Each knob has a fixed colour; turning one pops up its
name and value. **Esc** or holding pad 1 stops everything.

## Controller setup

On factory settings the joystick sends CC1 for both up and down (and K1 also sends CC1).
This reprograms Program 1 so up = CC17, down = CC16, pads use MIDI channel 10, and the
arpeggiator / note repeat follow the MIDI clock the page sends (locked to the drum tempo):

```bash
python3 tools/mpk-setup.py
```

`python3 tools/mpk-setup.py --restore` writes back the original settings saved in
`tools/mpk-backup-factory.txt`. Once reprogrammed, K1 controls chord voicing. Note the
arpeggiator only runs while the VibeSynth page is open (it needs the page's clock).
