# Backlog

- [ ] **Stutters/crashes when lots of keys are mashed** (reported 2026-09-30, again 2026-10-03).
      Second pass 2026-10-03: stolen notes no longer come back to life on key release, chords-mode
      notes skip the pitch-bend wiring, one shared noise source, faster steals, and the chord
      lettering no longer animates out every mashed chord. Measured offline: ~45% less audio work
      when mashing, frame time 16.7 -> 3.9 ms. Needs confirming on the real keyboard.
- [x] Clean the MPK key contacts. Done 2026-10-01 (opened, cleaned, re-seated the ribbon cable): all 25
      keys now register with normal velocities.
- [ ] A way to change a loop layer's sound from the MPK (today: settings page dropdown).
- [ ] Tape tricks for the looper: reverse, half-speed, warble.
- [ ] Surprise button.
- [ ] Play along to songs (parked 2026-10-01). Ideas: (1) song charts: paste chords, stage shows
      current/next chord, drums at the song's tempo and time signature; (2) analyse a local MP3
      for tempo, beats, key and rough chords, then lock drums/looper to it; (3) strip parts out
      with Demucs stems and play them yourself.
- [ ] Delete a loop from the loop memory on the keys (today: remove `jam/loops/<note>.json`).
- [ ] Loop layers' looks should combine on the stage rather than the stage switching to the
      newest layer's sound (agreed 2026-10-01).
- [ ] Jamming with Claude, ideas not built yet: keep a solo as a loop layer; daisy asks for a solo
      itself from a pad (Claude API, no chat needed); trading fours (you play 4 bars, Claude
      answers); solos that hear what you play live.
