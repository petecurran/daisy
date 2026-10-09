# daisy — guide

A warm, tactile browser synth for the Akai MPK Mini Mk II, inspired by the Telepathic Instruments Orchid.

## Run

```bash
tools/daisy.sh
```

Starts the local server and opens daisy full-screen in its own Chromium app window. Press a key
or pad on the MPK (or any computer key) to start; until then the knobs warp the logo and the
joystick pushes it about. That window is allowed to start sound without a click. Allow MIDI
the first time. **V** flips to the settings/debug page.

Or manually: `python3 tools/serve.py` and open http://localhost:5173 (this server disables caching,
so a refresh always gets the latest code).

## Controls

- **Chords mode** (Tab toggles): a key picks the chord root and its octave (low C, middle C and high C give low, middle and high C chords), the joystick colours it
  (up = 7th, down = sus4, left = flip major/minor, right = add9, diagonals = combos).
- **Notes mode**: plain synth; joystick = pitch bend / vibrato.
- **Knobs** (pad 5 flips pages). Sound: Voicing, Brightness, Resonance, Drive, Chorus, Tape wobble,
  Echo, Reverb. Drums: Tempo, Busy, Swing, Kit, Drum tone, Pump, Loop level, Drum level.
- **Sounds** (pads 3/4 or ← →): Velvet Pad, Sunday Keys, Honey Bass, Cassette Dream, Pub Piano,
  Rhythm Guitar, Crunch Guitar and Metal Chug (which plays power chords: root, fifth and octave).
- **Pads bank A** change with the knob page (pad 5 flips it):
  - Sound page: 1 drums · 2 Chords ⇄ Notes · 3/4 previous/next sound · 5 page (hold: loop memory) ·
    6 Key (hold + press a key sets the key; tap flips major/minor) · 7 sustain (hold) · 8 looper
  - Drums page: 1 drums · 2 fill · 3/4 groove (hold: time signature) · 5 page (hold: loop memory) · 6 tap tempo ·
    7 break (hold) · 8 looper
  - With a loop going, pad 1 (or Space) **pauses** drums and loop on the spot and carries on from
    the same place. Pad 1 held = stop everything. **Bank B**: play the drums live.
- **Looper** (pad 8 or R): tap = record from next bar -> play -> add a layer (starts at the top of the loop) -> play…, double-tap = stop,
  hold = undo last layer (clear when stopped). Note starts snap to 16ths (lengths are kept as played); each layer keeps its own sound.
- **← →** change sound, **↑ ↓** voicing.

## Loop memory

Every loop you make is saved on a key of its own (the lowest free one, from the bottom C), with
its drums, tempo, kit, swing and key, and kept up to date as you add or remove layers. **Hold
pad 5** and the on-screen keys show the memory: amber = a saved loop, white = the one you have
now. Still holding, press an amber key to bring that loop back (at the next bar if you're
playing, so you can switch song sections mid-jam), or any other key to save a copy there.
After a reload daisy brings back the last loop, stopped: pad 8 plays it, holding pad 8 clears it.
The loops live in `jam/loops/`.

## Jamming with Claude

Make a loop, then ask Claude (Claude Code, opened in this folder) for a solo: type **solo** or
`/solo`, with any direction you like ("start chill, build, then shred", "bluesier", "a duet:
call and response"). Claude reads your loop through daisy's local server, writes the solo and
hands it back; it comes in at the top of your loop a few seconds later. No copying and pasting.

- **Parts**: several solos can play at once (a lead and a drunk keyboardist; a singer and a
  guitar answering). A duet is handed over as one, so the voices always start together.
- **Time signatures**: a solo can be phrased in its own time signature (6/4 or 9/8 over your
  4/4) so it drifts against the loop and comes back into line every so often.
- **Repeating**: a solo can go round with the loop until you stop it ("stop the solos", or stop
  the loop with a double tap on pad 8).
- **On screen**: every solo note fires a pulse out from the centre that bends the rings into
  petals as it passes. The interval the note makes with your chord picks the petals (a fifth
  gives three broad ones, a third five, clashing notes many fine ones), the note's colour lights
  them, and how hard and long it's played sets how deep they go. A gentle melody blooms into
  flowers; a shred crinkles the rings into contour lines.
- **Recordings**: every solo is recorded with your loop and drums into `jam/recordings/`
  (small audio files; the oldest are removed past 300 MB). Listen back at
  http://localhost:5173/jam/recordings/. Ask for a video and Claude films the stage too.
- **Takes**: each solo is kept in `jam/takes/` with the loop it was played over, so "again" or
  "go back to take 3" works.

Behind the scenes: `src/jam.js` shares the loop and plays solos, `tools/serve.py` is the hand-off,
`tools/jam.py` is the chat side (chord chart, play, stop) and `.claude/skills/solo` tells Claude
how to do it. After pulling new code, restart with `tools/daisy.sh` so the server is current.

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
arpeggiator only runs while the daisy page is open (it needs the page's clock).
