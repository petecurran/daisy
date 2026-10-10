# daisy

[![smoke test](https://github.com/petecurran/daisy/actions/workflows/smoke.yml/badge.svg)](https://github.com/petecurran/daisy/actions/workflows/smoke.yml)

A warm little chord synth for the Akai MPK Mini Mk II. One key plays a whole
chord and the joystick colours it, with built-in drums, a looper and a light show.

Named after "Daisy Bell", the first song a computer ever sang (1961).

![daisy in action](docs/daisy.gif)

```bash
python3 tools/daisy.py
```

Runs on Linux, macOS and Windows (where it's `python`, not `python3`). Needs Python 3 and Chrome,
Edge, Chromium or Brave, for Web MIDI. An MPK Mini Mk II is the intended controller, but any MIDI
keyboard or the computer keys will play it.

**Jam with Claude:** make a loop, then say *solo* to Claude Code in this folder. Claude reads your
chords through daisy's local server, writes a solo (or a duet, or one in 6/4 that drifts over
your 4/4) and daisy plays it back over the loop, bending the visuals into flowers as it goes.

Plain HTML, JavaScript and Web Audio. No build step, no dependencies. Controls and setup are in
[the guide](docs/GUIDE.md).

<img src="docs/stage.png" alt="The stage: a Cmaj7 chord over the tree-ring visuals" width="49%"> <img src="docs/splash.png" alt="The daisy splash screen" width="49%">

## Licence

Free to use, change and share for anything non-commercial, with credit: [PolyForm Noncommercial
1.0.0](LICENSE.md). The Shrikhand font is under its own [Open Font License](src/fonts/OFL.txt).
This is a personal project, so I'm not taking pull requests, but feel free to fork it.
