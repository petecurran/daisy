#!/usr/bin/env python3
"""The chat side of jamming with daisy (see .claude/skills/solo).

    python3 tools/jam.py              the shared loop as a chord chart
    python3 tools/jam.py play FILE    check a solo and hand it to daisy (it comes in at the top of
                                      the next time round the loop)
    python3 tools/jam.py stop [PART]  stop the solos playing (or just one part)

daisy keeps jam/loop.json up to date with the last loop made; it picks up jam/solo.json within a
second of it changing.
"""
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
JAM = os.environ.get('DAISY_JAM') or os.path.join(ROOT, 'jam')

NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
PITCH = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
SCALES = {'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10]}

# Interval sets -> chord suffix, roughly what daisy's chord engine can make.
CHORDS = {
    (0, 4, 7): '', (0, 3, 7): 'm', (0, 3, 6): 'dim', (0, 5, 7): 'sus4', (0, 2, 7): 'sus2',
    (0, 4, 7, 10): '7', (0, 4, 7, 11): 'maj7', (0, 3, 7, 10): 'm7', (0, 3, 7, 11): 'm(maj7)',
    (0, 3, 6, 10): 'm7b5', (0, 5, 7, 10): '7sus4', (0, 4, 7, 9): '6', (0, 3, 7, 9): 'm6',
    (0, 2, 4, 7): 'add9', (0, 2, 3, 7): 'm(add9)', (0, 2, 4, 7, 10): '9', (0, 2, 4, 7, 11): 'maj9',
    (0, 2, 3, 7, 10): 'm9', (0, 2, 3, 6): 'dim(add9)', (0, 4): '(no5)', (0, 3): 'm(no5)', (0, 7): '5',
}


def name(n):
    return f'{NAMES[n % 12]}{n // 12 - 1}'


def note_number(x):
    if isinstance(x, (int, float)):
        return int(x)
    s = str(x).strip().replace('♯', '#').replace('♭', 'b')
    acc = {'#': 1, 'b': -1}.get(s[1:2], 0)
    return 12 * (int(s[1 + (acc != 0):]) + 1) + PITCH[s[0]] + acc


def chord_name(notes):
    """Name a set of sounding MIDI notes, preferring the bass note as the root."""
    if not notes:
        return '-'
    pcs = sorted({n % 12 for n in notes})
    bass = min(notes) % 12
    if len(pcs) == 1:
        return NAMES[bass]
    for root in [bass] + [p for p in pcs if p != bass]:
        iv = tuple(sorted((p - root) % 12 for p in pcs))
        if iv in CHORDS:
            return NAMES[root] + CHORDS[iv] + (f'/{NAMES[bass]}' if root != bass else '')
    return '?(' + ' '.join(NAMES[p] for p in pcs) + ')'


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def sounding(loop):
    """For every 16th of the loop, the notes that are sounding (unmuted layers, wrapping round)."""
    steps = loop['steps']
    at = [set() for _ in range(steps)]
    for layer in loop['layers']:
        if layer['muted']:
            continue
        for step, note, length, _vel in layer['notes']:
            for i in range(max(1, round(length))):
                at[(step + i) % steps].add(note)
    return at


def chart():
    path = os.path.join(JAM, 'loop.json')
    if not os.path.exists(path):
        sys.exit('No loop shared yet: make a loop in daisy (with the server from tools/serve.py running).')
    loop = load(path)
    bar, beat = loop['barSteps'], loop['beatSteps']
    age = datetime.now(timezone.utc) - datetime.fromisoformat(loop['saved'].replace('Z', '+00:00'))
    print(f"Loop: {loop['bars']:g} bars of {loop['sig']} at {loop['bpm']} bpm, key {loop['key']}, "
          f"drums {loop['drums']}{' on the ' + loop['kit'] + ' kit' if loop.get('kit') else ''} (swing {loop['swing']}). Shared {int(age.total_seconds() // 60)} min ago.")
    print(f"One bar = {bar} sixteenths, one beat = {beat}.")
    for i, layer in enumerate(loop['layers'], 1):
        notes = [n[1] for n in layer['notes']]
        rng = f"{name(min(notes))}-{name(max(notes))}" if notes else 'empty'
        print(f"Layer {i}: {layer['sound']}{' (muted)' if layer['muted'] else ''}, {len(notes)} notes, {rng}")

    at = sounding(loop)
    print('\nChords, beat by beat ("." = same as before):')
    prev = None
    for b in range(0, loop['steps'], bar):
        cells = []
        for s in range(b, b + bar, beat):
            # A beat is named by what's sounding most of it (a re-strike can leave a gap at its top).
            notes = max((at[i] for i in range(s, s + beat)), key=lambda x: sum(at[i] == x for i in range(s, s + beat)))
            c = chord_name(notes)
            cells.append('.' if c == prev else c)
            prev = c
        print(f'  bar {b // bar + 1}: | ' + ' | '.join(f'{c:<8}' for c in cells) + ' |')

    print('\nEvery change (bar.beat, 16ths from the top):')
    prev = None
    for s, notes in enumerate(at):
        if notes == prev:
            continue
        prev = notes
        pos = f'{s // bar + 1}.{(s % bar) / beat + 1:g}'
        print(f'  {pos:<7} step {s:<3} {chord_name(notes):<10} {" ".join(name(n) for n in sorted(notes))}')


def play(file):
    solo = load(file)
    loop = load(os.path.join(JAM, 'loop.json'))
    bar, beat = loop['barSteps'], loop['beatSteps']
    key_root, key_mode = loop['key'].split()
    scale = {(PITCH[key_root[0]] + {'#': 1, 'b': -1}.get(key_root[1:2], 0) + i) % 12 for i in SCALES[key_mode]}
    notes, end, outside = [], 0, []
    for n in solo['notes']:
        b, bt, nm, beats = n[:4]
        pitch = note_number(nm)
        start = (b - 1) * bar + (bt - 1) * beat
        assert start >= 0 and beats > 0 and 20 < pitch < 109, f'odd note: {n}'
        notes.append(pitch)
        end = max(end, start + beats * beat)
        if pitch % 12 not in scale:
            outside.append(f'{name(pitch)} at {b}.{bt:g}')
    bars = solo.get('bars') or -(-end // bar)
    assert end <= bars * bar, f'notes run past bar {bars}'
    extra = f", part '{solo.get('part', 'lead')}'" + (', repeating' if solo.get('repeat') else '')
    print(f"{solo.get('title', 'Untitled')}{extra}: {len(notes)} notes over {bars:g} bars "
          f"({bars / loop['bars']:g}x round the {loop['bars']:g}-bar loop), {name(min(notes))}-{name(max(notes))}.")
    if outside:
        print(f'Outside {loop["key"]} (fine if meant): ' + ', '.join(outside))
    os.makedirs(JAM, exist_ok=True)
    tmp = os.path.join(JAM, 'solo.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(solo, f)
    os.replace(tmp, os.path.join(JAM, 'solo.json'))  # daisy never sees a half-written file
    # Keep the loop it was first played over next to the take, so the pair can be heard again.
    paired = re.sub(r'\.json$', '', file) + '.loop.json'
    if not os.path.exists(paired):
        shutil.copyfile(os.path.join(JAM, 'loop.json'), paired)
    print('Handed to daisy: it comes in at the top of the loop.')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == 'play':
        play(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] == 'stop':
        os.makedirs(JAM, exist_ok=True)
        with open(os.path.join(JAM, 'solo.json.tmp'), 'w', encoding='utf-8') as f:
            json.dump({'stop': sys.argv[2] if len(sys.argv) > 2 else True}, f)
        os.replace(os.path.join(JAM, 'solo.json.tmp'), os.path.join(JAM, 'solo.json'))
        print('Stopped.')
    else:
        chart()
