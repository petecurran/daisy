# VibeSynth

A warm, tactile browser synth for the Akai MPK Mini Mk II, inspired by the Telepathic Instruments Orchid.

## Run

```bash
tools/vibesynth.sh
```

Starts the local server and opens VibeSynth full-screen in its own Chromium app window. Touch the
MPK (or press any key) to start; that window is allowed to start sound without a click. Allow MIDI
the first time. **V** flips to the settings/debug page.

Or manually: `python3 -m http.server 5173 --bind 127.0.0.1` and open http://localhost:5173.

## Controls

- **Chords mode** (Tab toggles): a key picks the chord root, the joystick colours it
  (up = 7th, down = sus4, left = flip major/minor, right = add9, diagonals = combos).
- **Notes mode**: plain synth; joystick = pitch bend / vibrato.
- **Knobs** (pad 5 flips pages). Sound: Voicing, Brightness, Resonance, Drive, Chorus, Tape wobble,
  Echo, Reverb. Drums: Tempo, Busy, Swing, Kit, Drum tone, Room, Pump, Drum level.
- **Pads bank A** change with the knob page (pad 5 flips it):
  - Sound page: 1 drums · 2 Chords ⇄ Notes · 3/4 previous/next sound · 5 page ·
    6 Key (hold + press a key sets the key; tap flips major/minor) · 7 sustain (hold) · 8 looper
  - Drums page: 1 drums · 2 fill · 3/4 groove (hold: time signature) · 5 page · 6 tap tempo ·
    7 break (hold) · 8 looper
  - Pad 1 held = stop everything. **Bank B**: play the drums live.
- **Looper** (pad 8 or R): tap = record from next bar -> play -> add layer -> play…, double-tap = stop,
  hold = undo last layer (clear when stopped). Notes snap to 16ths; each layer keeps its own sound.
- **← →** change sound, **↑ ↓** voicing.

## Stage view (visuals)

Opens when you wake the synth (**V** flips to the settings page). Every chord is a band of its
colour (root on the circle of fifths, tinted by chord type) growing out of the on-screen MPK.
The bands are made of pixels that ride outward, fan apart and dissolve near the edges. Knobs
reshape the waves: wobble bends, resonance makes the edges ring, chorus doubles, echo leaves ghost
edges, drive turns it grungy (dark, gritty, glitching, hot pink), reverb pulls the camera back. The kick sends a ripple, the snare
scatters pixels, the hats make them glitter. **Esc** or holding pad 1 stops everything.

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
