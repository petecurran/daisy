#!/usr/bin/env python3
"""Start daisy: the local server plus a full-screen browser app window with its own profile.

    python3 tools/daisy.py [extra browser flags]

Works on Linux, macOS and Windows with Chrome, Chromium, Edge or Brave (they have Web MIDI). Set
DAISY_BROWSER to a browser's path to pick one yourself. The autoplay flag lets the sound start
from the MPK alone, with no click needed.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PORT = 5173

# Where each system keeps the browsers that have Web MIDI, most likely first.
MAC_APPS = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser']
WINDOWS_EXES = [r'Google\Chrome\Application\chrome.exe', r'Microsoft\Edge\Application\msedge.exe',
                r'Chromium\Application\chrome.exe', r'BraveSoftware\Brave-Browser\Application\brave.exe']
LINUX_COMMANDS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable',
                  'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'brave']


def browser():
    """The path of a browser daisy can use, or None."""
    if os.environ.get('DAISY_BROWSER'):
        return os.environ['DAISY_BROWSER']
    if sys.platform == 'darwin':
        for folder in ['/Applications', os.path.expanduser('~/Applications')]:
            for app in MAC_APPS:
                path = os.path.join(folder, f'{app}.app', 'Contents', 'MacOS', app)
                if os.path.exists(path):
                    return path
    elif sys.platform == 'win32':
        for env in ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']:
            for exe in WINDOWS_EXES:
                path = os.path.join(os.environ.get(env, ''), exe)
                if os.environ.get(env) and os.path.exists(path):
                    return path
    else:
        for command in LINUX_COMMANDS:
            if shutil.which(command):
                return shutil.which(command)
    return None


def profile():
    """daisy's own browser profile, so its MIDI permission and window stay separate."""
    if sys.platform == 'darwin':
        return os.path.expanduser('~/Library/Application Support/daisy-chromium')
    if sys.platform == 'win32':
        return os.path.join(os.environ['LOCALAPPDATA'], 'daisy-chromium')
    return os.path.expanduser('~/.config/daisy-chromium')


# Straight to this machine: never through a proxy the system settings might name.
local = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def answers(port):
    try:
        local.open(f'http://127.0.0.1:{port}/jam/loops', timeout=0.5)
        return True
    except OSError:
        return False


def detached():
    """Popen options for a process that outlives this script (and its terminal)."""
    if sys.platform == 'win32':
        return {'creationflags': subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
    return {'start_new_session': True}


def stop_server(port=PORT):
    if not answers(port):
        return
    try:
        local.open(urllib.request.Request(f'http://127.0.0.1:{port}/quit', method='POST'), timeout=1)
    except OSError:
        return  # a server from before /quit existed: it carries on, and that's fine
    for _ in range(20):
        if not answers(port):
            return
        time.sleep(0.1)


def start_server(port=PORT, jam=None):
    """(Re)start the local server, so it's always the current version of tools/serve.py."""
    stop_server(port)
    args = [sys.executable, os.path.join(ROOT, 'tools', 'serve.py'), str(port)] + ([jam] if jam else [])
    log = os.path.join(tempfile.gettempdir(), f'daisy-server-{port}.log')  # its errors, if it has any
    with open(log, 'w') as out:
        subprocess.Popen(args, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=out, stderr=out, **detached())
    for _ in range(50):
        if answers(port):
            return
        time.sleep(0.1)
    with open(log) as f:
        sys.exit(f'The daisy server didn\'t start on port {port}. Its output ({log}):\n{f.read()}')


def main():
    exe = browser()
    if not exe:
        sys.exit('No Chrome, Chromium, Edge or Brave found (daisy needs one for Web MIDI). '
                 'Install one, or set DAISY_BROWSER to its path.')
    start_server()
    subprocess.Popen([exe, f'--app=http://localhost:{PORT}', '--autoplay-policy=no-user-gesture-required',
                      f'--user-data-dir={profile()}', '--start-fullscreen', *sys.argv[1:]],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **detached())


if __name__ == '__main__':
    main()
