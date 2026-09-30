#!/usr/bin/env python3
"""Reprogram an Akai MPK Mini Mk II for VibeSynth (or restore the factory Program 1).

  python3 tools/mpk-setup.py            # joystick up/down -> CC17/CC16, pads -> MIDI ch 10
  python3 tools/mpk-setup.py --restore  # write back the backup in mpk-backup-factory.txt

Writes Program 1 (saved) and RAM (live). Protocol from soyersoyer/sysex-controls:
query F0 47 7F 26 66 00 01 <prog> F7, reply/write body = 108 bytes after <prog>.
Byte 0 = pad channel, 16 = joystick vertical mode (2 = dual CC), 17/18 = its CCs.
"""
import os, subprocess, sys

PORT = 'hw:3,0,0'
HERE = os.path.dirname(os.path.abspath(__file__))


def find_port():
    out = subprocess.run(['amidi', '-l'], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if 'MPKmini2' in line:
            return line.split()[1]
    sys.exit('MPK Mini Mk II not found (amidi -l)')


def read(port, prog):
    out = subprocess.run(['amidi', '-p', port, '-S', f'F0 47 7F 26 66 00 01 {prog:02X} F7', '-d', '-t', '1'],
                         capture_output=True, text=True).stdout.split()
    b = [int(x, 16) for x in out]
    assert b[:5] == [0xF0, 0x47, 0x00, 0x26, 0x67] and b[7] == prog and len(b) == 117, 'unexpected reply'
    return b[8:-1]


def write(port, prog, body):
    msg = [0xF0, 0x47, 0x7F, 0x26, 0x64, 0x00, 0x6D, prog] + body + [0xF7]
    subprocess.run(['amidi', '-p', port, '-S', ' '.join(f'{x:02X}' for x in msg)], check=True)


def main():
    port = find_port()
    if '--restore' in sys.argv:
        line = next(l for l in open(os.path.join(HERE, 'mpk-backup-factory.txt')) if l.startswith('prog 1:'))
        body = [int(x, 16) for x in line.split(':')[1].split()][8:-1]
    else:
        body = read(port, 1)
        body[0] = 9            # pads -> MIDI channel 10
        body[16] = 2           # joystick vertical: dual CC
        body[17], body[18] = 16, 17
    for prog in (1, 0):
        write(port, prog, body)
    now = read(port, 1)
    print(f'pad channel {now[0] + 1}, joystick vertical mode {now[16]}, CCs {now[17]}/{now[18]}')


if __name__ == '__main__':
    main()
