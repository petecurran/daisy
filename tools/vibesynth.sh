#!/usr/bin/env bash
# Start VibeSynth: the local server plus a full-screen Chromium app window with its own profile.
# The autoplay flag lets the sound start from the MPK alone, with no click needed.
cd "$(dirname "$0")/.."
if ! curl -s -o /dev/null http://127.0.0.1:5173; then
  python3 -m http.server 5173 --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 0.5
fi
exec chromium \
  --app=http://localhost:5173 \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$HOME/.config/vibesynth-chromium" \
  --start-fullscreen "$@"
