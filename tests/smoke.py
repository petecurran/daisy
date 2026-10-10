#!/usr/bin/env python3
"""Smoke test: daisy starts and jams on this machine, with no MPK and no sound.

    pip install playwright && python3 tests/smoke.py

It uses the browser tools/daisy.py would pick and a throwaway jam folder, then checks: the page
loads without errors, a key plays a chord, the looper records a loop and shares it, tools/jam.py
charts it and hands back a solo, and daisy plays and records that solo. The browser is headless
and muted. GitHub Actions runs this on Linux, macOS and Windows (.github/workflows/smoke.yml).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import daisy  # noqa: E402

PORT = 5179  # out of the way of a daisy you might be playing on 5173


def step(text):
    print(f'- {text}', flush=True)


def jam_py(jam, *args):
    run = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'jam.py'), *args],
                         env={**os.environ, 'DAISY_JAM': jam}, capture_output=True, text=True)
    print('  ' + (run.stdout + run.stderr).strip().replace('\n', '\n  '))
    assert run.returncode == 0, f'jam.py {" ".join(args)} failed'
    return run.stdout


def wait_for(check, what, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError(f'timed out waiting for {what}')


def main():
    exe = daisy.browser()
    assert exe, 'no Chrome, Chromium, Edge or Brave found'
    step(f'browser: {exe}')
    jam = tempfile.mkdtemp(prefix='daisy-smoke-')
    daisy.start_server(PORT, jam)
    step(f'server up on {PORT}, jam folder {jam}')
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=exe, headless=True, args=[
                '--mute-audio', '--autoplay-policy=no-user-gesture-required',
                '--enable-unsafe-swiftshader',  # WebGL without a GPU, as on CI machines
            ])
            page = browser.new_page()
            page.on('pageerror', lambda e: errors.append(f'page error: {e}'))
            page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text
                    and errors.append(f'console: {m.text}'))
            # 404s from an empty jam folder are expected; anything else missing is not.
            page.on('response', lambda r: r.status >= 400 and '/jam/' not in r.url and 'favicon' not in r.url
                    and errors.append(f'{r.status} {r.url}'))

            page.goto(f'http://localhost:{PORT}')
            page.evaluate("document.getElementById('start').click()")
            page.wait_for_function("window.daisy?.engine.ctx.state === 'running'", timeout=15000)
            step('page loaded, audio running (muted)')

            page.evaluate('daisy.key(60, true)')
            page.wait_for_function("document.getElementById('chord-name').textContent.startsWith('C')", timeout=5000)
            step(f"middle C plays {page.text_content('#chord-name')}")
            page.evaluate('daisy.key(60, false)')

            # A one-bar loop, fast so the test is quick: count-in bar, hold C for most of a bar, close.
            page.evaluate('daisy.seq.setBpm(180); daisy.looper.tap()')
            page.wait_for_function('daisy.looper.nowPos() >= daisy.looper.start', timeout=10000)
            page.evaluate('daisy.key(60, true)')
            page.wait_for_function('daisy.looper.nowPos() - daisy.looper.start >= daisy.seq.sig.barSteps * 0.8', timeout=10000)
            page.evaluate('daisy.key(60, false)')
            page.wait_for_function('daisy.looper.nowPos() - daisy.looper.start >= daisy.seq.sig.barSteps * 1.05', timeout=10000)
            page.evaluate('daisy.looper.tap()')
            page.wait_for_function("daisy.looper.state === 'playing'", timeout=5000)
            wait_for(lambda: os.path.exists(os.path.join(jam, 'loop.json')), 'the loop to be shared')
            step('looper recorded a loop and shared it')

            chart = jam_py(jam)
            # Headless timing is loose, so the loop may be a bar longer or start a 16th late: no matter.
            assert 'key C major' in chart and '| C ' in chart, 'the chart should show the C chord'

            takes = os.path.join(jam, 'takes')
            os.makedirs(takes)
            take = os.path.join(takes, '01-smoke.json')
            with open(take, 'w', encoding='utf-8') as f:
                json.dump({'title': 'Smoke test', 'notes': [
                    [1, 1, 'E4', 1, 90], [1, 2, 'G4', 1, 80], [1, 3, 'C5', 1.5, 100, {'vib': 0.5}]]}, f)
            assert 'Handed to daisy' in jam_py(jam, 'play', take)
            page.wait_for_function("daisy.jam.solos.get('lead')?.state === 'playing'", timeout=15000)
            step('daisy picked the solo up and is playing it')

            recordings = os.path.join(jam, 'recordings')
            wait_for(lambda: os.path.isdir(recordings) and any(
                os.path.getsize(os.path.join(recordings, n)) > 0 for n in os.listdir(recordings)), 'the recording')
            step(f'recorded: {os.listdir(recordings)[0]}')

            jam_py(jam, 'stop')
            page.evaluate('daisy.looper.clear(); daisy.seq.stop(); daisy.engine.ctx.close()')
            browser.close()
    finally:
        daisy.stop_server(PORT)
        shutil.rmtree(jam, ignore_errors=True)
    assert not errors, 'the page had errors:\n  ' + '\n  '.join(errors)
    print('All good.')


if __name__ == '__main__':
    main()
