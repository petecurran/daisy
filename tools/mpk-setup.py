#!/usr/bin/env python3
"""Reprogram an Akai MPK Mini Mk II for daisy (or restore the factory Program 1).

  python3 tools/mpk-setup.py            # joystick up/down -> CC17/CC16, pads -> MIDI ch 10,
                                        # arp/note-repeat follow daisy's clock
  python3 tools/mpk-setup.py --restore  # write back the backup in mpk-backup-factory.txt

Writes Program 1 (saved) and RAM (live). Protocol from soyersoyer/sysex-controls:
query F0 47 7F 26 66 00 01 <prog> F7, reply/write body = 108 bytes after <prog>.
Byte 0 = pad channel, 6 = arp clock source (0 internal, 1 external), 16 = joystick vertical mode (2 = dual CC), 17/18 = its CCs.
"""
import os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))

# Uses the shared ALSA sequencer (aseqsend/aseqdump), so it works while the synth page is open.


def find_port():
    if not shutil.which('aseqdump') or not shutil.which('aseqsend'):
        sys.exit('This needs Linux\'s ALSA tools (aseqdump/aseqsend, in alsa-utils). On macOS or Windows, '
                 'set the MPK up with Akai\'s MPK mini mkII Editor instead: see "Controller setup" in docs/GUIDE.md.')
    out = subprocess.run(['aseqdump', '-l'], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if 'MPKmini2' in line:
            return line.split()[0]
    sys.exit('MPK Mini Mk II not found (aseqdump -l)')


def read(port, prog):
    dump = subprocess.Popen(['stdbuf', '-oL', 'aseqdump', '-p', port], stdout=subprocess.PIPE, text=True)
    time.sleep(0.3)
    subprocess.run(['aseqsend', '-p', port, f'F0 47 7F 26 66 00 01 {prog:02X} F7'], check=True)
    deadline = time.time() + 3
    try:
        for line in dump.stdout:
            m = re.search(r'System exclusive\s+(F0 47 00 26 67 .*F7)', line)
            if m:
                b = [int(x, 16) for x in m.group(1).split()]
                if b[7] == prog and len(b) == 117:
                    return b[8:-1]
            if time.time() > deadline:
                break
    finally:
        dump.kill()
    sys.exit('no program dump received from the MPK')


def write(port, prog, body):
    msg = [0xF0, 0x47, 0x7F, 0x26, 0x64, 0x00, 0x6D, prog] + body + [0xF7]
    subprocess.run(['aseqsend', '-p', port, ' '.join(f'{x:02X}' for x in msg)], check=True)
    time.sleep(0.2)


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
        body[6] = 1            # arpeggiator + note repeat follow external MIDI clock (sent by the page)
    for prog in (1, 0):
        write(port, prog, body)
    now = read(port, 1)
    print(f'pad channel {now[0] + 1}, arp clock {"external" if now[6] else "internal"}, '
          f'joystick vertical mode {now[16]}, CCs {now[17]}/{now[18]}')


if __name__ == '__main__':
    main()
