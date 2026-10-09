---
name: solo
description: Improvise a solo over the loop the user just made in daisy, and have daisy play it. Use when the user says "solo", "improvise", "take a solo", "play over this", "another take", or asks for a different feel ("sparser", "bluesier", "build it up").
---

# Solo over the loop

daisy shares its last loop with this chat through the local server, and plays any solo written
to `jam/solo.json` from the top of the next time round the loop, on a guest lead sound. No copying
and pasting: read the loop, write the solo, hand it over. **Be quick**: the user is sitting at the
keyboard with the loop going round, waiting for you.

## 1. Read the loop

```bash
python3 tools/jam.py
```

This prints the tempo, time signature, key, drum pattern, each layer, a beat-by-beat chord chart,
and every note change. If it says the loop was shared a long time ago, say so (maybe daisy's
server is an old one: `tools/daisy.sh` restarts it).

## 2. Write the solo

Write it to `jam/takes/<NN>-<short-name>.json` (count up from the takes already there):

```json
{
  "title": "Take 1: easing in",
  "sound": "lead",
  "notes": [
    [1, 1,   "E4", 1.5, 90],
    [1, 2.5, "G4", 0.5, 70],
    [1, 3,   "A4", 2,   100, {"bend": 2, "release": true, "vib": 0.5}],
    [2, 1.5, "C5", 1,   95,  {"from": -1}],
    [2, 2.5, "B4", 0.5, 80,  {"slide": true}]
  ]
}
```

- Each note is `[bar, beat, note, length in beats, velocity 1-127 (optional), expression (optional)]`.
- Bar 1 beat 1 is the top of the loop. Beats are the time signature's pulse (`beatSteps` 16ths:
  a quarter note in 4/4 and 3/4; in 6/8 and 12/8 a dotted quarter, so `1.5` is three 16ths in).
  Fractions are fine (`2.75` = the last 16th of beat 2 in 4/4). Odd 16ths pick up the drums' swing.
- Notes are names (`"F#4"`, `"Bb3"`, middle C = `"C4"`) or MIDI numbers. Overlaps are allowed
  (double stops), but a lead mostly plays one note at a time.
- Expression (semitones): `from` scoops in from below/above; `slide: true` glides from the
  previous note; `bend` bends up partway through (`release: true` lets it back down before the
  end); `vib` 0-1 is vibrato that blooms on long notes. These make it sound played, not typed.
- `fx` (optional) sets the sound's pedals for this solo, each 0-1: `{"drive": 1, "echo": 0.1}`
  (also `chorus`, `wobble`, `reverb`). Drive at 1 is as filthy as daisy goes. A page loaded before
  2026-10-09 20:50 ignores `fx` until it's reloaded.
- The solo can last several times round the loop (e.g. 8 bars over a 4-bar loop). It plays once,
  then stops.
- `sound` is optional: `lead` (Singing Lead, the default) or any daisy preset id (`velvet`,
  `sunday`, `honey`, `cassette`, `crunch`). `crunch` (Crunch Guitar) is an overdriven electric
  guitar: the one to use when the user asks for guitar, rock or metal. (`chug`, Metal Chug, is a
  rhythm sound for the user's loops, not for solos: it plays power chords, so the chart shows
  `E5`-style chords with no third. Take major or minor from the key and the riff.)

## 3. Hand it over

```bash
python3 tools/jam.py play jam/takes/01-easing-in.json
```

It checks the notes, lists any outside the key (fine if they're meant), and hands it to daisy.
Then tell the user in a line or two what you went for, and offer to take another. "Again" means
running `play` on the same file. To change something, write a new take (keep the old ones, so they
can go back to one).

## Playing well

You can't hear it, so play from the chart like a session player reading changes:

- **Leave space.** Phrases of 1-2 bars with rests between them. Fewer notes, more feeling. A first
  take should be calm and melodic; save the flurries for when the user asks for more.
- **Land on chord tones** (the notes in the chart) on strong beats, especially where the chord
  changes; passing notes from the key go in between. Anticipating a change by an 8th note sounds
  great.
- **Use a motif.** State a short idea, repeat it, then vary it (shift it to fit the next chord,
  change its rhythm, answer it). Build across the solo: lower and sparser at the start, higher and
  busier towards the end, then come back down to land on the tonic.
- **Sit above the loop.** Look at the layers' ranges and play mostly above the chords (often
  C4-C6), so the solo doesn't muddy them.
- **Shape velocity.** Accents on phrase peaks, quieter passing notes. Bend into the high points;
  vibrato on held notes.
- **Match the groove.** Swung drums want swung 8ths (odd 16ths already swing); straight drums
  want straight lines. At slow tempos longer notes, at fast tempos fewer, punchier notes.
- The user is a guitarist: minor/major pentatonic and blues-scale language with bends will feel
  familiar, but follow the chords rather than parking on one scale.
