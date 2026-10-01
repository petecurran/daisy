#!/usr/bin/env bash
# Start daisy: the local server plus a full-screen Chromium app window with its own profile.
# The autoplay flag lets the sound start from the MPK alone, with no click needed.
cd "$(dirname "$0")/.."
# (Re)start the local server, so it's always the current version of tools/serve.py.
pkill -f "http.server 5173" 2>/dev/null
pkill -f "^python3 tools/serve" 2>/dev/null
sleep 0.2
setsid python3 tools/serve.py 5173 >/dev/null 2>&1 &
sleep 0.5
# Keep the Chromium profile (MIDI permission etc.) from when this was called VibeSynth.
[ -d "$HOME/.config/vibesynth-chromium" ] && [ ! -e "$HOME/.config/daisy-chromium" ] && \
  mv "$HOME/.config/vibesynth-chromium" "$HOME/.config/daisy-chromium"
exec chromium \
  --app=http://localhost:5173 \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$HOME/.config/daisy-chromium" \
  --start-fullscreen "$@"
